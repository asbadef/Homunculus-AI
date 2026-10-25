# tests/test_board.py
from datetime import datetime, timedelta, timezone

from homunculus.api.ackstore import AckStore
from homunculus.api.board import _merge_alert, _risk, board_snapshot, patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert

T0 = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)


def _alert(severity):
    return Alert(
        patient_id="p", kind="k", severity=severity, urgency="soon",
        summary="", clinical_reasoning="", supporting_evidence=[],
        recommended_actions=[], confidence="",
    )


def test_risk_is_none_when_no_alerts_else_max_severity():
    assert _risk([]) == "none"
    assert _risk([_alert("moderate"), _alert("critical")]) == "critical"
    assert _risk([_alert("low")]) == "low"


def test_patient_board_carries_risk_alerts_and_latest_values():
    eng = Engine()
    eng.ingest(Observation("bed-3", SignalCode.HEART_RATE, 118.0, "bpm", T0, "mon"), now=T0)
    board = patient_board(eng, "bed-3", AckStore())
    assert board["patient_id"] == "bed-3"
    assert board["risk"] == "none"
    assert board["latest"]["heart_rate"] == 118.0
    assert board["latest"]["sofa"] == 0
    assert board["alerts"] == []


def test_board_snapshot_lists_every_patient():
    eng = Engine()
    for pid in ("bed-3", "bed-5"):
        eng.ingest(Observation(pid, SignalCode.HEART_RATE, 90.0, "bpm", T0, "mon"), now=T0)
    ids = {b["patient_id"] for b in board_snapshot(eng, AckStore())}
    assert ids == {"bed-3", "bed-5"}


def test_merge_alert_carries_ack_and_escalation_fields():
    a = Alert(patient_id="bed-3", kind="septic_shock", severity="critical", urgency="immediate",
              summary="s", clinical_reasoning="r", supporting_evidence=["sepsis-3-jama-2016"],
              recommended_actions=["Consider repeat lactate."], confidence="c")
    store = AckStore()
    store.stamp_first_seen("bed-3", "septic_shock", T0)
    store.acknowledge("bed-3", "septic_shock", "nurse", T0)
    store.escalated.add(("bed-3", "septic_shock"))
    d = _merge_alert("bed-3", a, store)
    assert d["acknowledged"] is True
    assert d["acknowledged_by"] == "nurse"
    assert d["escalated"] is True
    assert d["first_seen_at"] == T0.isoformat()
    assert d["kind"] == "septic_shock" and d["supporting_evidence"] == ["sepsis-3-jama-2016"]
    assert d["resolved_at"] is None, "a firing alert has not resolved"


# --- G2-A1 (O17): a latched critical on the board ------------------------------------------------

_SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
          (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
          (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]


def _latched():
    """bed-3 in septic shock, first seen at T0; two minutes later the lactate is back under 2. The
    shock latches — nobody acknowledged it — while sepsis and the antibiotic clock still fire."""
    from homunculus.api.alert_lifecycle import sync_alerts
    eng, store = Engine(), AckStore()
    for code, value in _SHOCK:
        eng.ingest(Observation("bed-3", code, value, "u", T0, "mon"), now=T0)
        sync_alerts(eng, store, "bed-3", T0)
    for a in eng.active_alerts("bed-3"):
        store.stamp_first_seen("bed-3", a.kind, T0)
    eng.ingest(Observation("bed-3", SignalCode.LACTATE, 1.5, "u", T0, "lab"), now=T0)
    sync_alerts(eng, store, "bed-3", T0 + timedelta(minutes=2))
    return eng, store


def test_a_latched_critical_is_listed_after_the_firing_alerts_and_is_no_part_of_the_risk():
    eng, store = _latched()
    board = patient_board(eng, "bed-3", store)
    kinds = [a["kind"] for a in board["alerts"]]
    assert kinds[-1] == "septic_shock" and set(kinds[:-1]) == {"sepsis", "antibiotic_due"}
    shock = board["alerts"][-1]
    assert shock["resolved_at"] == (T0 + timedelta(minutes=2)).isoformat()
    assert (shock["acknowledged"], shock["acknowledged_by"], shock["escalated"]) == (False, None, False)
    assert shock["first_seen_at"] == T0.isoformat()
    assert (shock["severity"], shock["summary"]) == ("critical", "Septic shock criteria met")
    assert all(a["resolved_at"] is None for a in board["alerts"][:-1])
    assert board["risk"] == "high", "the risk is what fires now (D10): sepsis and the antibiotic clock"


def test_an_alert_both_firing_and_latched_is_listed_once_as_firing():
    # The hook replaces a latch the moment its kind fires again; the board does not rely on it.
    eng, store = _latched()
    eng.ingest(Observation("bed-3", SignalCode.LACTATE, 3.4, "u", T0, "lab"), now=T0)
    shocks = [a for a in patient_board(eng, "bed-3", store)["alerts"] if a["kind"] == "septic_shock"]
    assert len(shocks) == 1 and shocks[0]["resolved_at"] is None
