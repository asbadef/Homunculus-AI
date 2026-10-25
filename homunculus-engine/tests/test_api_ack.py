# tests/test_api_ack.py
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.api.app as app_module
import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
WALL0 = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _Wall(datetime):
    """The doors' wall clock, set by the test. The escalation clock is wall time, and since X13 the
    gap between an alert's clear and its return decides whether its clock goes on — a gap the real
    clock would make a test wait for."""
    at = WALL0

    @classmethod
    def now(cls, tz=None):
        return cls.at


@pytest.fixture
def wall(monkeypatch):
    _Wall.at = WALL0                  # a test that failed half-way must not leak its time
    monkeypatch.setattr(app_module, "datetime", _Wall)
    return _Wall


def _client():
    return TestClient(create_app({"tok": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False))


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client, token="tok"):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr(token))
    return "bed-3"


def test_ack_marks_the_alert_acknowledged_in_the_board():
    c = _client()
    p = _drive_shock(c)
    r = c.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 200
    board = c.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == p for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is True
    assert shock["acknowledged_by"] == "nurse"


def test_ack_of_unknown_alert_is_404():
    c = _client()
    _drive_shock(c)
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "no_such_kind", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 404


def test_ack_requires_a_tenant_token():
    c = _client()
    assert c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}).status_code == 401


def test_ack_is_tenant_isolated():
    c = _client()
    _drive_shock(c, "tok")
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok2"))
    assert r.status_code == 404


@pytest.mark.anyio
async def test_escalation_cycle_flips_unacked_immediate_alert(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))     # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))
    assert key in store.escalated
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["escalated"] is True


@pytest.mark.anyio
async def test_ack_clears_escalation(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))     # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))
    assert key in store.escalated
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=_hdr("tok"))
    assert key not in store.escalated


# --- G2-A1 (O17): an alert ends with its rule; a critical nobody acknowledged latches -------------
#
# septic_shock.yaml starts at 10:00 and meets the shock criterion at 11:00 (lactate 3.4). Minutes
# below are from its start; the readings after it are made up, as every value in it is.

START = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
SHOCK = ("bed-3", "septic_shock")


def _reading(client, code, value, minute, token="tok"):
    fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
            "subject": {"reference": "Patient/bed-3"},
            "effectiveDateTime": (START + timedelta(minutes=minute)).isoformat(),
            "valueQuantity": {"value": value, "unit": ""}}
    assert client.post("/ingest", json=fhir, headers=_hdr(token)).status_code == 200


def _ack(client, kind="septic_shock"):
    return client.post("/ack", json={"patient_id": "bed-3", "kind": kind, "role": "nurse"},
                       headers=_hdr("tok"))


def _on_board(client, kind="septic_shock"):
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    return next((a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"]
                 if a["kind"] == kind), None)


def _trail(client, kind="septic_shock"):
    rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                      headers=_hdr("tok")).json()["records"]
    return [(r["event_type"], r["payload"].get("reason")) for r in rows
            if r["subject"] == kind and r["event_type"] in ("first_seen", "ack", "alert_cleared")]


def test_a_critical_that_resolves_unacknowledged_stays_until_acknowledged_and_the_ack_removes_it():
    c = _client()
    _drive_shock(c)
    _reading(c, "lactate", 1.5, minute=61)              # back under 2: the criterion stops
    shock = _on_board(c)
    assert shock is not None, "a critical nobody saw must not vanish (D2)"
    assert shock["resolved_at"] is not None and shock["acknowledged"] is False
    r = _ack(c)
    assert r.status_code == 200
    assert all(a["kind"] != "septic_shock" for a in r.json()["alerts"])
    assert _on_board(c) is None
    assert _trail(c) == [("first_seen", None), ("alert_cleared", "resolved"), ("ack", None),
                         ("alert_cleared", "acked_after_resolve")]


def test_an_alert_that_ended_and_did_not_latch_is_not_found_to_acknowledge():
    c = _client()
    _drive_shock(c)
    _reading(c, "suspected_infection", 0, minute=61)    # the physician: no infection after all
    assert _on_board(c, "sepsis") is None, "HIGH does not latch"
    assert _ack(c, "sepsis").status_code == 404
    assert _on_board(c)["resolved_at"] is not None, "the unacknowledged shock latched"


def test_an_acknowledged_critical_leaves_with_its_rule():
    c = _client()
    _drive_shock(c)
    assert _ack(c).status_code == 200
    _reading(c, "lactate", 1.5, minute=61)
    assert _on_board(c) is None
    assert _trail(c) == [("first_seen", None), ("ack", None), ("alert_cleared", "resolved")]
    assert _ack(c).status_code == 404


@pytest.mark.anyio
async def test_a_latched_alert_never_escalates_and_its_next_episode_has_its_own_clock(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)                                            # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=6))  # long unanswered
    assert SHOCK in store.escalated
    wall.at = WALL0 + timedelta(minutes=7)
    _reading(client, "lactate", 1.5, minute=61)                     # latched
    assert SHOCK not in store.escalated
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=9))
    assert SHOCK not in store.escalated, "a latched alert is a to-do, not an unanswered active finding"
    assert _on_board(client)["escalated"] is False
    wall.at = WALL0 + timedelta(minutes=10)
    _ack(client)                                                    # removes the latch
    wall.at = WALL0 + timedelta(minutes=16)                         # more than the delay later (X13)
    _reading(client, "lactate", 3.4, minute=62)                     # a new episode, a new chain
    fresh = store.first_seen[SHOCK]
    assert fresh == WALL0 + timedelta(minutes=16)
    await app.state.escalation_cycle(fresh + timedelta(minutes=4))
    assert SHOCK not in store.escalated, "the new episode's clock started at its own first sight"
    await app.state.escalation_cycle(fresh + timedelta(minutes=5))
    assert SHOCK in store.escalated


def _told(client, kind="septic_shock"):
    """What the nurse was told about `kind`: the trigger of each notification, oldest first."""
    rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                      headers=_hdr("tok")).json()["records"]
    return [r["payload"]["trigger"] for r in rows
            if r["subject"] == kind and r["event_type"] == "notification"]


def test_a_new_episode_after_an_acknowledged_latch_tells_the_nurse_again():
    """Pins the notifier prune on the latched /ack path (D5): the acknowledgement removes the latch,
    so the kind leaves the live keys, and a critical that comes back is told as a new one."""
    c = _client()
    _drive_shock(c)
    _reading(c, "lactate", 1.5, minute=61)              # latched: the same episode, still told
    assert _ack(c).status_code == 200                   # removed
    _reading(c, "lactate", 3.4, minute=62)              # a new episode
    assert _told(c) == ["new", "new"]


def _pages(client, kind="septic_shock"):
    """How often the doctor was paged about `kind`: the `escalation` audit rows, and the doctor
    notifications that went out with them."""
    rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                      headers=_hdr("tok")).json()["records"]
    mine = [r for r in rows if r["subject"] == kind]
    return (sum(r["event_type"] == "escalation" for r in mine),
            sum(r["event_type"] == "notification" and r["payload"]["trigger"] == "escalation"
                for r in mine))


@pytest.mark.anyio
async def test_a_latched_critical_that_returns_pages_the_doctor_once_per_episode(wall):
    """G2-A1 final review: the latch drops `escalated` and each return raises it again, so every
    flap used to read as a fresh escalation — a never-acknowledged shock whose lactate swung 3.4 / 1.5
    every two minutes paged the doctor on each swing. One episode is one page; the board's
    `escalated` flag still follows the clock; an acknowledgement ends the episode, and the next
    one — more than the escalation delay later, so a new chain (X13) — pages anew."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)
    store = app.state.ack_stores["HOSP1"]
    first = WALL0                                                    # the door's first sight
    cycle_at = first + timedelta(minutes=6)                          # long unanswered
    await app.state.escalation_cycle(cycle_at)
    assert SHOCK in store.escalated and _pages(client) == (1, 1)
    for flap in range(3):
        _reading(client, "lactate", 1.5, minute=61 + 2 * flap)       # latched: off the clock
        await app.state.escalation_cycle(cycle_at)
        assert SHOCK not in store.escalated
        _reading(client, "lactate", 3.4, minute=62 + 2 * flap)       # the same episode, back
        await app.state.escalation_cycle(cycle_at)
        assert SHOCK in store.escalated, "the board's flag follows the clock"
    assert store.first_seen[SHOCK] == first, "never acknowledged: still the first episode"
    assert _pages(client) == (1, 1), "one episode, one page"
    wall.at = first + timedelta(minutes=7)
    _reading(client, "lactate", 1.5, minute=67)                      # latched once more
    assert _ack(client).status_code == 200                           # answered: the episode ends
    assert SHOCK not in store.paged
    wall.at = first + timedelta(minutes=13)                          # more than the delay later
    _reading(client, "lactate", 3.4, minute=68)                      # a new episode, a new chain
    fresh = store.first_seen[SHOCK]
    await app.state.escalation_cycle(fresh + timedelta(minutes=4))
    assert _pages(client) == (1, 1), "the new episode's clock has not run out"
    await app.state.escalation_cycle(fresh + timedelta(minutes=5))
    assert _pages(client) == (2, 2), "a new episode pages the doctor again"


# --- G2-A1, X13: the escalation clock survives a gap of at most the escalation delay -------------
#
# Heart rate 115 and temperature 39.5 score 2 NEWS2 points each. A respiratory rate of 26 adds 3:
# NEWS2 7, a HIGH and immediate `news2`. One of 16 adds none: NEWS2 4 with no single parameter at 3
# raises nothing, so the alert clears. Made-up values on a synthetic bed.

NEWS2 = ("bed-3", "news2")


def _news2_base(client):
    _reading(client, "heart_rate", 115, minute=0)
    _reading(client, "temperature", 39.5, minute=0)


@pytest.mark.anyio
async def test_a_high_alert_flapping_faster_than_the_escalation_delay_still_reaches_the_doctor_once(wall):
    """NEWS2 7 / 4 every two minutes for twenty, never acknowledged. Each return is a new episode — its
    own first sight and a nurse told again (D5) — but none was off the board for longer than the
    escalation delay, so they are one chain on one clock. Before X13 each return restarted the clock,
    no episode lasted five minutes, and the doctor was never paged."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    paged_at = None
    for minute in range(21):
        wall.at = WALL0 + timedelta(minutes=minute)
        if minute % 2 == 0:
            _reading(client, "resp_rate", 26 if minute % 4 == 0 else 16, minute=minute)
        await app.state.escalation_cycle(wall.at)
        if paged_at is None and _pages(client, "news2") != (0, 0):
            paged_at = minute
    assert paged_at == 5, f"five minutes after the chain's first sight, saw {paged_at}"
    assert _pages(client, "news2") == (1, 1), "one chain, one page"
    trail = [event for event, _reason in _trail(client, "news2")]
    assert trail.count("first_seen") == 6 and trail.count("alert_cleared") == 5, "six episodes"
    assert _told(client, "news2").count("new") == 6, "the nurse is told of every return (D5)"
    assert store.first_seen[NEWS2] == WALL0 + timedelta(minutes=20), "the board's ▲ is the episode's"
    assert store.clock_from[NEWS2] == WALL0, "the escalation clock is the chain's"
    assert _on_board(client, "news2")["escalated"] is True


@pytest.mark.anyio
async def test_a_return_after_a_gap_longer_than_the_escalation_delay_starts_the_clock_over(wall):
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    _reading(client, "resp_rate", 26, minute=0)                      # first seen at WALL0
    wall.at = WALL0 + timedelta(minutes=2)
    _reading(client, "resp_rate", 16, minute=2)                      # cleared
    wall.at = WALL0 + timedelta(minutes=8)
    _reading(client, "resp_rate", 26, minute=8)                      # back six minutes later
    assert store.clock_from[NEWS2] == store.first_seen[NEWS2] == WALL0 + timedelta(minutes=8)
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=12))
    assert NEWS2 not in store.escalated and _pages(client, "news2") == (0, 0), \
        "a new chain: its clock started at the return, four minutes ago"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=13))
    assert NEWS2 in store.escalated and _pages(client, "news2") == (1, 1)


@pytest.mark.anyio
async def test_an_acknowledged_alert_that_returns_within_the_delay_starts_a_new_clock(wall):
    """The acknowledgement belongs to the episode it answered (D5): the return is unacknowledged. And
    an answer ends the chain (X13 review): only an episode that ended unanswered leaves one, so the
    return's clock starts at its own first sight, though it came two minutes after the clear."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    _reading(client, "resp_rate", 26, minute=0)                      # first seen at WALL0
    wall.at = WALL0 + timedelta(minutes=1)
    assert _ack(client, "news2").status_code == 200
    wall.at = WALL0 + timedelta(minutes=2)
    _reading(client, "resp_rate", 16, minute=2)                      # cleared, answered
    wall.at = WALL0 + timedelta(minutes=4)
    _reading(client, "resp_rate", 26, minute=4)                      # back two minutes later
    news2 = _on_board(client, "news2")
    assert news2["acknowledged"] is False, "the old answer belongs to the old episode"
    assert news2["first_seen_at"] == (WALL0 + timedelta(minutes=4)).isoformat()
    assert store.clock_from[NEWS2] == WALL0 + timedelta(minutes=4), "answered: no chain to continue"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=5))
    assert NEWS2 not in store.escalated and _pages(client, "news2") == (0, 0), \
        "the answered episode's minutes are not the return's: its clock started a minute ago"
    await app.state.escalation_cycle(WALL0 + timedelta(minutes=9))
    assert NEWS2 in store.escalated and _pages(client, "news2") == (1, 1)


# --- G2-A1, X13 review: an answer ends the chain --------------------------------------------------
#
# The ward minute by minute on the injected wall clock: each minute's readings and acknowledgements,
# then the escalation cycle, as the loop runs it. What is measured is the minute the doctor is paged.


def _answered(client, kind="septic_shock"):
    assert _ack(client, kind).status_code == 200


async def _page_minutes(app, client, wall, script, last, kind):
    """Run minutes 0..`last` of `script` ({minute: [step, ...]}), and say in which minutes the doctor
    was paged about `kind` — each page an `escalation` row and its doctor notification."""
    minutes, seen = [], (0, 0)
    for minute in range(last + 1):
        wall.at = WALL0 + timedelta(minutes=minute)
        for step in script.get(minute, ()):
            step()
        await app.state.escalation_cycle(wall.at)
        pages = _pages(client, kind)
        assert pages[0] == pages[1], "every escalation row has its doctor notification"
        if pages != seen:
            minutes.append(minute)
            seen = pages
    return minutes


@pytest.mark.anyio
async def test_an_acknowledged_high_alert_that_returns_unanswered_within_the_delay_pages_the_doctor_anew(wall):
    """The reviewer's case: NEWS2 7 at 0, the doctor paged at 5, the nurse acknowledges at 6, it clears
    at 7 and is back at 9, and this time nobody answers. Before the review the acknowledged episode
    left its chain — its clock and its page — and the return two minutes later continued it: escalated
    on the board, but never paged. Five minutes unanswered after the return, the doctor is paged."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    script = {0: [lambda: _reading(client, "resp_rate", 26, minute=0)],
              6: [lambda: _answered(client, "news2")],
              7: [lambda: _reading(client, "resp_rate", 16, minute=7)],      # cleared, answered
              9: [lambda: _reading(client, "resp_rate", 26, minute=9)]}      # back, unanswered
    assert await _page_minutes(app, client, wall, script, 20, "news2") == [5, 14], \
        "paged five minutes after the first sight, and again five minutes after the return"
    assert store.clock_from[NEWS2] == store.first_seen[NEWS2] == WALL0 + timedelta(minutes=9)


@pytest.mark.anyio
async def test_an_acknowledged_latch_whose_critical_returns_unanswered_within_the_delay_pages_the_doctor_anew(wall):
    """A septic shock paged at 5 latches at 6 and is acknowledged at 8, which removes it; it is back at
    10, unanswered. The acknowledgement ended the episode and its chain, so the return pages anew."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)                                             # first seen at WALL0
    store = app.state.ack_stores["HOSP1"]
    script = {6: [lambda: _reading(client, "lactate", 1.5, minute=61)],     # latched
              8: [lambda: _answered(client)],                               # the latch removed
              10: [lambda: _reading(client, "lactate", 3.4, minute=62)]}    # back, unanswered
    assert await _page_minutes(app, client, wall, script, 20, "septic_shock") == [5, 15]
    assert store.first_seen[SHOCK] == store.clock_from[SHOCK] == WALL0 + timedelta(minutes=10)


@pytest.mark.anyio
async def test_an_unanswered_high_alert_that_returns_within_the_delay_keeps_its_chain_and_its_one_page(wall):
    """X13, pinned beside the review's rule: nobody answered, so the clear at 3 leaves the chain behind,
    the return at 5 continues it, and the doctor is paged at 5 — five minutes after the first sight —
    and once."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _news2_base(client)
    store = app.state.ack_stores["HOSP1"]
    script = {0: [lambda: _reading(client, "resp_rate", 26, minute=0)],
              3: [lambda: _reading(client, "resp_rate", 16, minute=3)],      # cleared, unanswered
              5: [lambda: _reading(client, "resp_rate", 26, minute=5)]}      # back two minutes later
    assert await _page_minutes(app, client, wall, script, 20, "news2") == [5]
    assert store.first_seen[NEWS2] == WALL0 + timedelta(minutes=5), "a new episode (D5)"
    assert store.clock_from[NEWS2] == WALL0, "on its chain's clock"
