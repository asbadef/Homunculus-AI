# tests/test_rrt_call.py
"""G2-B5 (spec 2026-11-09-g2b-b5-rrt-design.md, D3-D5): «RRT çağır» on the live alarm system.

A person calls the rapid-response team to one active alarm by hand (`POST /alerts/rrt-call`); the call is
a trail row first and the store's second, rides on the board card's alert as `rrt_call`, is answered by an
acknowledgement (ordinary or latched), leaves with its episode, and survives a restart by replay.
Synthetic patients and values only."""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.ackstore import AckStore
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.rehydrate import rehydrate
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
START = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
T0 = "2026-07-14T10:00:00+00:00"
SHOCK = ("bed-3", "septic_shock")
REASON = "Tansiyon düşüyor, ekip gelsin"

DEVICE = {"Authorization": "Bearer tok"}
CHARGE = {"Authorization": "Bearer charge-jwt"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {
    "charge-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("charge_nurse",),
                         perms=frozenset({"board.view", "alerts.ack", "alerts.escalate"})),
    "nurse-jwt": Caller(hospital="h1", actor="hem.leyla", groups=("nurse",),
                        perms=frozenset({"board.view", "alerts.ack"})),
}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def audit():
    return InMemoryAuditLog()


@pytest.fixture()
def app(audit):
    return create_app({"tok": "h1"}, run_escalation_loop=False, audit=audit, resolve_jwt=_resolve)


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


def _drive_shock(client):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        assert client.post("/ingest", json=fhir, headers=DEVICE).status_code == 200


def _reading(client, code, value, minute):
    fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
            "subject": {"reference": "Patient/bed-3"},
            "effectiveDateTime": (START + timedelta(minutes=minute)).isoformat(),
            "valueQuantity": {"value": value, "unit": ""}}
    assert client.post("/ingest", json=fhir, headers=DEVICE).status_code == 200


def _alerts(client):
    board = client.get("/patients", headers=DEVICE).json()["patients"]
    return {a["kind"]: a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"]}


def _kinds(client):
    """The kinds the shock scenario raised on `bed-3`, read off the card — not assumed."""
    kinds = _alerts(client)
    assert "septic_shock" in kinds and len(kinds) >= 2, kinds
    return "septic_shock", next(k for k in kinds if k != "septic_shock")


def _call(client, kind="septic_shock", reason=REASON, headers=CHARGE, patient="bed-3"):
    body = {"patient_id": patient, "kind": kind, "reason": reason}
    return client.post("/alerts/rrt-call", json=body, headers=headers)


def _ack(client, kind="septic_shock"):
    return client.post("/ack", json={"patient_id": "bed-3", "kind": kind, "role": "nurse"}, headers=DEVICE)


def _rows(audit):
    return audit.records(tenant="h1", event_type="rrt_call", limit=10_000)


def _store(app):
    return app.state.ack_stores["h1"]


# --- the call --------------------------------------------------------------------------------------

def test_a_call_puts_the_rrt_call_on_the_card_and_one_row_in_the_trail(client, audit):
    _drive_shock(client)
    assert _alerts(client)["septic_shock"]["rrt_call"] is None, "nobody has called yet"
    r = _call(client)
    assert r.status_code == 200, r.text
    answered = next(a for a in r.json()["alerts"] if a["kind"] == "septic_shock")
    call = answered["rrt_call"]
    assert call == {"by": "hem.ayse", "at": call["at"], "reason": REASON}
    assert datetime.fromisoformat(call["at"]).tzinfo is not None
    assert _alerts(client)["septic_shock"]["rrt_call"] == call, "the board carries the same call"
    rows = _rows(audit)
    assert len(rows) == 1
    row = rows[0]
    assert (row.patient_id, row.subject) == SHOCK
    assert row.payload["actor"] == "hem.ayse" and row.payload["via"] == "user"
    assert row.payload["reason"] == REASON and row.payload["at"] == call["at"]


def test_a_call_leaves_the_other_alerts_alone(client):
    _drive_shock(client)
    called, other = _kinds(client)
    assert _call(client, called).status_code == 200
    assert _alerts(client)[other]["rrt_call"] is None


def test_a_second_call_answers_the_card_and_writes_nothing(client, audit):
    _drive_shock(client)
    first = _call(client)
    assert first.status_code == 200
    again = _call(client, reason="Başka bir gerekçe")
    assert again.status_code == 200, again.text
    assert len(_rows(audit)) == 1, "the first call stands"
    shock = next(a for a in again.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["rrt_call"]["reason"] == REASON, "and so does its reason"


def test_who_may_call(client, audit):
    _drive_shock(client)
    assert _call(client, headers=NURSE).status_code == 403, "an acknowledging nurse may not call"
    assert _call(client, headers=DEVICE).status_code == 403, "a device is exempt from permission checks; the call is a person's"
    assert _call(client, headers={}).status_code == 401
    assert _call(client, headers={"Authorization": "Bearer nobody"}).status_code == 401
    assert _rows(audit) == []
    assert _alerts(client)["septic_shock"]["rrt_call"] is None


def test_the_reason_is_required(client, audit):
    _drive_shock(client)
    called, other = _kinds(client)
    for reason in ("", "   ", "  a ", "ab", "x" * 501, 123, None, ["gerekçe"], {"a": "bcd"}):
        r = _call(client, reason=reason)
        assert r.status_code == 400, (reason, r.status_code)
    assert _call(client, reason=None, kind=called).status_code == 400
    r = client.post("/alerts/rrt-call", json={"patient_id": "bed-3", "kind": called}, headers=CHARGE)
    assert r.status_code == 400, "no reason at all"
    assert _rows(audit) == [] and _alerts(client)[called]["rrt_call"] is None
    # The bounds are inclusive and the text is trimmed: three characters once trimmed, five hundred whole.
    assert _call(client, called, reason="  abc  ").status_code == 200
    assert _call(client, other, reason="x" * 500).status_code == 200
    alerts = _alerts(client)
    assert alerts[called]["rrt_call"]["reason"] == "abc"
    assert alerts[other]["rrt_call"]["reason"] == "x" * 500
    assert len(_rows(audit)) == 2


def test_a_body_that_does_not_name_an_alert_is_400(client, audit):
    _drive_shock(client)
    assert _call(client, kind=7).status_code == 400
    assert _call(client, patient="").status_code == 400
    assert _call(client, patient=["bed-3"]).status_code == 400
    assert _rows(audit) == []


def test_an_unknown_alert_is_404_and_an_acknowledged_one_409(client, audit):
    _drive_shock(client)
    assert _call(client, kind="no_such_kind").status_code == 404
    assert _call(client, patient="bed-99").status_code == 404
    assert "bed-99" not in {p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]}, \
        "a refused probe creates no patient"
    assert _rows(audit) == []
    assert _ack(client).status_code == 200
    r = _call(client)
    assert r.status_code == 409, r.text
    assert _rows(audit) == []


def test_an_acknowledgement_answers_the_call(app, client):
    _drive_shock(client)
    assert _call(client).status_code == 200
    assert _alerts(client)["septic_shock"]["rrt_call"] is not None
    assert _ack(client).status_code == 200
    shock = _alerts(client)["septic_shock"]
    assert shock["acknowledged"] is True
    assert shock["rrt_call"] is None, "an answer ends the call"
    assert _store(app).rrt_calls == {}


def test_a_nurse_acknowledging_by_token_answers_the_call_too(client):
    """The person who acknowledges needs no special right: the call ends the same way."""
    _drive_shock(client)
    assert _call(client).status_code == 200
    r = client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock"}, headers=NURSE)
    assert r.status_code == 200, r.text
    assert _alerts(client)["septic_shock"]["rrt_call"] is None


def test_a_latched_alert_can_be_called_and_its_acknowledgement_answers_it(app, client):
    _drive_shock(client)
    _reading(client, "lactate", 1.5, minute=61)             # back under 2: the shock latches, unacknowledged
    latched = _alerts(client)["septic_shock"]
    assert latched["resolved_at"] is not None and latched["acknowledged"] is False
    r = _call(client)
    assert r.status_code == 200, r.text
    on_card = next(a for a in r.json()["alerts"] if a["kind"] == "septic_shock")
    assert on_card["resolved_at"] is not None
    assert on_card["rrt_call"]["reason"] == REASON, "the latched card alert carries the call"
    assert _alerts(client)["septic_shock"]["rrt_call"]["by"] == "hem.ayse"
    assert _ack(client).status_code == 200
    assert "septic_shock" not in _alerts(client), "the acknowledgement removed the latch"
    assert SHOCK not in _store(app).rrt_calls, "and answered the call"


# --- a restart ---------------------------------------------------------------------------------------

def _shock_trail():
    audit = InMemoryAuditLog()
    for slug, val in [("suspected_infection", 1.0), ("weight_kg", 100.0), ("crystalloid_bolus_ml", 3000.0),
                      ("map", 60.0), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
        audit.append(AuditEvent("HOSP1", "ingest", "bed-3", slug,
                                {"value": val, "unit": "", "obs_ts": T0, "device": "mon"}))
    return audit


def _call_row(kind="septic_shock", patient="bed-3", **payload):
    body = {"role": "hem.ayse", "via": "user", "actor": "hem.ayse", "groups": ["charge_nurse"],
            "reason": REASON, "at": T0} | payload
    return AuditEvent("HOSP1", "rrt_call", patient, kind, body)


def _replayed(audit):
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, audit.records(tenant="HOSP1"))
    return engine, store


def test_a_restart_brings_an_open_call_back_and_not_an_answered_one():
    # (a) an open call survives the replay, with who, when and why
    audit = _shock_trail()
    audit.append(_call_row())
    _engine, store = _replayed(audit)
    assert store.rrt_calls[SHOCK] == {"by": "hem.ayse", "at": datetime.fromisoformat(T0), "reason": REASON}

    # (b) a call followed by an acknowledgement is answered: nothing comes back
    audit = _shock_trail()
    audit.append(_call_row())
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock", {"role": "doctor", "at": T0}))
    _engine, store = _replayed(audit)
    assert SHOCK in store.acks
    assert store.rrt_calls == {}

    # (c) a row for a kind that is not on the board at that point is ignored: before the readings that raise
    # it, for a kind this patient never raises, and for a patient with no readings at all
    audit = InMemoryAuditLog()
    audit.append(_call_row())                       # nothing is firing yet
    for ev in _shock_trail().records(tenant="HOSP1"):
        audit.append(AuditEvent(ev.tenant, ev.event_type, ev.patient_id, ev.subject, ev.payload))
    audit.append(_call_row("no_such_kind"))
    audit.append(_call_row(patient="bed-9"))
    engine, store = _replayed(audit)
    assert "septic_shock" in {a.kind for a in engine.active_alerts("bed-3")}
    assert store.rrt_calls == {}

    # (d) the live door refuses a call on an acknowledged alarm (409), so a later row is not replayed either
    audit = _shock_trail()
    audit.append(AuditEvent("HOSP1", "ack", "bed-3", "septic_shock", {"role": "doctor", "at": T0}))
    audit.append(_call_row())
    _engine, store = _replayed(audit)
    assert store.rrt_calls == {}

    # (e) a row whose time cannot be read is passed over, and does not fail the whole replay
    audit = _shock_trail()
    audit.append(_call_row(at="not a time"))
    audit.append(_call_row("sepsis", at=None))
    audit.append(_call_row("sepsis"))               # and a good row after them still counts
    _engine, store = _replayed(audit)
    assert set(store.rrt_calls) == {("bed-3", "sepsis")}


def test_the_replayed_call_is_attributed_like_an_acknowledgement():
    """`actor` names a person; a row without one falls back to the bounded role, as `_replay_ack` does."""
    audit = _shock_trail()
    audit.append(_call_row(actor=None, role={"name": "dr.x"}))
    _engine, store = _replayed(audit)
    assert store.rrt_calls[SHOCK]["by"] == "unknown"


def test_a_running_app_restarts_with_the_open_call_on_the_card(audit):
    """The whole path: the call made through the route, the app rebuilt from the same trail."""
    first = create_app({"tok": "h1"}, run_escalation_loop=False, audit=audit, resolve_jwt=_resolve)
    with TestClient(first) as live:
        _drive_shock(live)
        assert _call(live).status_code == 200
        called = _alerts(live)["septic_shock"]["rrt_call"]
    second = create_app({"tok": "h1"}, run_escalation_loop=False, audit=audit, resolve_jwt=_resolve)
    with TestClient(second) as restarted:
        card = _alerts(restarted)["septic_shock"]
        assert card["rrt_call"] == called
        assert len(_rows(audit)) == 1, "the replay writes nothing"


# --- the store ---------------------------------------------------------------------------------------

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


def test_the_store_keeps_the_first_call_only():
    store = AckStore()
    assert store.call_rrt("p", "k", "u", "why", NOW) is True
    assert store.call_rrt("p", "k", "other", "again", NOW + timedelta(minutes=1)) is False
    assert store.rrt_calls == {("p", "k"): {"by": "u", "at": NOW, "reason": "why"}}


def test_an_acknowledgement_in_the_store_ends_the_call():
    store = AckStore()
    store.call_rrt("p", "k", "u", "why", NOW)
    store.call_rrt("p", "other", "u", "why", NOW)
    store.acknowledge("p", "k", "nurse", NOW)
    assert ("p", "k") not in store.rrt_calls and ("p", "other") in store.rrt_calls


def test_a_discharge_forgets_the_call():
    store = AckStore()
    store.call_rrt("p", "k", "u", "why", NOW)
    store.call_rrt("p", "j", "u", "why", NOW)
    store.call_rrt("q", "k", "u", "why", NOW)
    store.forget_patient("p")
    assert set(store.rrt_calls) == {("q", "k")}


def test_prune_drops_the_call_with_its_episode():
    store = AckStore()
    store.call_rrt("p", "k", "u", "why", NOW)
    store.prune(live_keys={("p", "k")})
    assert ("p", "k") in store.rrt_calls, "the episode is still on the board"
    store.prune(live_keys=set())
    assert store.rrt_calls == {}, "the episode left the board and took its call with it"
