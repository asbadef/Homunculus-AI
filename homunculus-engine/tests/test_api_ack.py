# tests/test_api_ack.py
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


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
async def test_escalation_cycle_flips_unacked_immediate_alert():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    store.first_seen[key] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert key in store.escalated
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["escalated"] is True


@pytest.mark.anyio
async def test_ack_clears_escalation():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    store.first_seen[key] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
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
async def test_a_latched_alert_never_escalates_and_its_next_episode_has_its_own_clock():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)
    store = app.state.ack_stores["HOSP1"]
    store.first_seen[SHOCK] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)   # long unanswered
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert SHOCK in store.escalated
    _reading(client, "lactate", 1.5, minute=61)                     # latched
    assert SHOCK not in store.escalated
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 9, tzinfo=timezone.utc))
    assert SHOCK not in store.escalated, "a latched alert is a to-do, not an unanswered active finding"
    assert _on_board(client)["escalated"] is False
    _ack(client)                                                    # removes the latch
    _reading(client, "lactate", 3.4, minute=62)                     # a new episode
    fresh = store.first_seen[SHOCK]
    assert fresh != datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
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
async def test_a_latched_critical_that_returns_pages_the_doctor_once_per_episode():
    """G2-A1 final review: the latch drops `escalated` and each return raises it again, so every
    flap used to read as a fresh escalation — a never-acknowledged shock whose lactate swung 3.4 / 1.5
    every two minutes paged the doctor on each swing. One episode is one page; the board's
    `escalated` flag still follows the clock; an acknowledgement ends the episode, and the next
    one pages anew."""
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    _drive_shock(client)
    store = app.state.ack_stores["HOSP1"]
    first = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    store.first_seen[SHOCK] = first                                  # long unanswered
    cycle_at = first + timedelta(minutes=6)
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
    _reading(client, "lactate", 1.5, minute=67)                      # latched once more
    assert _ack(client).status_code == 200                           # answered: the episode ends
    assert SHOCK not in store.paged
    _reading(client, "lactate", 3.4, minute=68)                      # a new episode
    fresh = store.first_seen[SHOCK]
    await app.state.escalation_cycle(fresh + timedelta(minutes=4))
    assert _pages(client) == (1, 1), "the new episode's clock has not run out"
    await app.state.escalation_cycle(fresh + timedelta(minutes=5))
    assert _pages(client) == (2, 2), "a new episode pages the doctor again"
