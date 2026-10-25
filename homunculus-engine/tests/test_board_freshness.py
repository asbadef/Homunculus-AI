"""G2-A2 (D5): when a NEWS2 input stops counting, the board is pushed again.

A reading's window closes with no frame to say so — a feed that stops is exactly when nothing else
arrives — so without a push the card would read fresh until a reload. `board.freshness_turned` is
the pure test the escalation cycle (every 20 s) asks of each measured patient: did one of its
`fresh_until` instants fall in [the previous cycle, this one) — fresh then, stale now? The board it
then publishes is judged at the cycle's own instant. A hospital's first cycle counts from the app's
start, so a window that closes before the first cycle is still pushed; one that closed before the
start is not: `/patients` on (re)connect is judged at its own moment.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.board import freshness_turned
from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

WHEN = datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc)
TOKEN = {"Authorization": "Bearer tok"}
PATIENT = "G2A-1"   # synthetic


def _state(code: SignalCode, at: datetime) -> PatientState:
    st = PatientState(PATIENT)
    st.ingest(Observation(PATIENT, code, 1.0, "", at, "dev"))
    return st


def test_a_window_that_closes_inside_the_interval_has_turned():
    # [since, until): an age equal to the window is still fresh (rules/news2.py), so at `closes`
    # the reading still counts and it is stale only after — the cycle at `closes` has not seen it
    # turn, the next one has (Task 2 review).
    st = _state(SignalCode.SPO2, WHEN)                   # SpO2's window closes at WHEN + 1 h
    closes = WHEN + timedelta(hours=1)
    assert freshness_turned(st, closes - timedelta(seconds=20), closes) is False    # until is not
    assert freshness_turned(st, closes, closes + timedelta(seconds=20)) is True     # since is in
    assert freshness_turned(st, WHEN, closes - timedelta(seconds=1)) is False


def test_a_charted_oxygen_turns_at_eight_hours():
    st = _state(SignalCode.SUPPLEMENTAL_OXYGEN, WHEN)
    expires = WHEN + timedelta(hours=8)
    assert freshness_turned(st, expires - timedelta(seconds=20), expires) is False
    assert freshness_turned(st, expires, expires + timedelta(seconds=20)) is True
    assert freshness_turned(st, WHEN + timedelta(hours=1), WHEN + timedelta(hours=7)) is False


def test_a_patient_with_nothing_measured_never_turns():
    assert freshness_turned(PatientState(PATIENT), WHEN, WHEN + timedelta(days=1)) is False


def _ingest(client: TestClient, code: str, value: float, at: datetime,
            headers: dict = TOKEN) -> None:
    r = client.post("/ingest", headers=headers, json={
        "resourceType": "Observation", "code": {"coding": [{"code": code}]},
        "subject": {"reference": f"Patient/{PATIENT}"}, "effectiveDateTime": at.isoformat(),
        "valueQuantity": {"value": value, "unit": ""}})
    assert r.status_code == 200, r.text


def test_the_cycle_republishes_a_board_once_when_a_window_closes():
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)
        # Its 2 h window is open at the cycle below and long closed at the wall clock: a board
        # judged at the wall clock would name it stale too (X2, Task 2 review).
        _ingest(client, "temperature", 37.0, WHEN)
        queue = app.state.broadcaster.subscribe("h1")

        def cycle(at: datetime) -> None:
            client.portal.call(app.state.escalation_cycle, at)

        cycle(WHEN + timedelta(minutes=59, seconds=30))
        cycle(WHEN + timedelta(minutes=59, seconds=50))      # the window is still open
        assert queue.empty()
        cycle(WHEN + timedelta(hours=1, seconds=10))         # it closed at +1 h, in this interval
        board = queue.get_nowait()
        assert board["patient_id"] == PATIENT
        assert board["latest"]["news2"]["stale"] == ["spo2"]    # judged at the cycle's instant
        assert queue.empty()
        cycle(WHEN + timedelta(hours=1, seconds=30))         # nothing else closed
        assert queue.empty()


def test_the_first_cycle_after_a_start_pushes_a_window_that_closed_since_the_start():
    # The restart hole (Task 2 review): `since` is seeded when the app starts, so the first cycle
    # covers [start, first cycle) — a window closing in between is pushed, not left until a reload.
    before = datetime.now(timezone.utc)
    closes = before + timedelta(seconds=30)              # after the start, before the first cycle
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, closes - timedelta(hours=1))
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, closes + timedelta(seconds=30))
        assert queue.get_nowait()["latest"]["news2"]["stale"] == ["spo2"]
        assert queue.empty()


def test_the_first_cycle_after_a_start_does_not_push_a_window_that_closed_before_it():
    # `/patients` on (re)connect is judged after it: there is nothing to push.
    app = create_app({"tok": "h1"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)                # closed at WHEN + 1 h, before the start
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, datetime.now(timezone.utc))
        assert queue.empty()


def test_a_tenant_whose_republish_fails_does_not_hold_back_the_others(monkeypatch):
    # `since` is kept per hospital and advanced after each one's republish (Task 2 review): with one
    # `since` for all, a tenant failing in its republish would leave every other tenant's window
    # ends to be pushed again, cycle after cycle, until it recovered.
    app = create_app({"tok": "h1", "tok2": "h2"}, run_escalation_loop=False)
    with TestClient(app) as client:
        _ingest(client, "spo2", 97, WHEN)                                        # h1, cycled first
        _ingest(client, "spo2", 97, WHEN, headers={"Authorization": "Bearer tok2"})
        queue, queue2 = (app.state.broadcaster.subscribe(h) for h in ("h1", "h2"))
        publish = app.state.broadcaster.publish
        failing = {"h2"}

        async def failing_for_h2(hospital: str, message: dict) -> None:
            if hospital in failing:
                raise RuntimeError("synthetic: h2's push fails")
            await publish(hospital, message)

        monkeypatch.setattr(app.state.broadcaster, "publish", failing_for_h2)

        def cycle(at: datetime) -> None:
            client.portal.call(app.state.escalation_cycle, at)

        cycle(WHEN + timedelta(minutes=59, seconds=50))
        with pytest.raises(RuntimeError):
            cycle(WHEN + timedelta(hours=1, seconds=10))     # both windows close; h2's push fails
        assert queue.get_nowait()["patient_id"] == PATIENT
        failing.clear()                                      # h2 recovers
        cycle(WHEN + timedelta(hours=1, seconds=30))
        assert queue.empty(), "h1's since moved on: its window end is not pushed a second time"
        assert queue2.get_nowait()["latest"]["news2"]["stale"] == ["spo2"], \
            "h2's since did not: the push it failed is made now"
        assert queue2.empty()


def test_a_patient_escalated_in_the_same_cycle_is_published_once_judged_at_the_cycle():
    # NEWS2 9 is HIGH and immediate; it escalates an hour after it was first seen (the wall clock),
    # in the cycle in which its readings' windows close. One frame, not two — and that frame is
    # judged at the cycle's instant too, so it already says the readings are stale (X2).
    start = datetime.now(timezone.utc)
    app = create_app({"tok": "h1"}, run_escalation_loop=False, escalate_after=timedelta(hours=1))
    with TestClient(app) as client:
        for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):
            _ingest(client, code, value, start)
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, start + timedelta(minutes=59, seconds=30))
        assert queue.empty()
        client.portal.call(app.state.escalation_cycle, start + timedelta(hours=1, seconds=10))
        board = queue.get_nowait()
        assert queue.empty(), "escalated and turned in one cycle: one frame"
        assert next(a for a in board["alerts"] if a["kind"] == "news2")["escalated"] is True
        assert board["latest"]["news2"]["stale"] == ["respiration_rate", "spo2", "systolic_bp"]
