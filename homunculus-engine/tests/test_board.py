# tests/test_board.py
from datetime import datetime, timezone

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
