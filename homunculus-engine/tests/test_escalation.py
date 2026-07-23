# tests/test_escalation.py
from datetime import datetime, timedelta, timezone

from homunculus.api.escalation import escalate
from homunculus.reco.engine import Alert

T0 = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
THRESH = timedelta(minutes=5)


def _alert(kind, urgency):
    return Alert(patient_id="bed-3", kind=kind, severity="critical", urgency=urgency,
                 summary="", clinical_reasoning="", supporting_evidence=[],
                 recommended_actions=[], confidence="")


def test_unacked_immediate_alert_past_threshold_escalates():
    alerts = [("bed-3", _alert("septic_shock", "immediate"))]
    first_seen = {("bed-3", "septic_shock"): T0}
    now = T0 + timedelta(minutes=6)
    assert escalate(alerts, acks={}, first_seen=first_seen, now=now, threshold=THRESH) == {("bed-3", "septic_shock")}


def test_acknowledged_alert_does_not_escalate():
    alerts = [("bed-3", _alert("septic_shock", "immediate"))]
    first_seen = {("bed-3", "septic_shock"): T0}
    acks = {("bed-3", "septic_shock"): {"by": "nurse", "at": T0}}
    now = T0 + timedelta(minutes=6)
    assert escalate(alerts, acks=acks, first_seen=first_seen, now=now, threshold=THRESH) == set()


def test_non_immediate_alert_does_not_escalate():
    alerts = [("bed-3", _alert("sepsis", "soon"))]
    first_seen = {("bed-3", "sepsis"): T0}
    now = T0 + timedelta(minutes=60)
    assert escalate(alerts, acks={}, first_seen=first_seen, now=now, threshold=THRESH) == set()


def test_before_threshold_does_not_escalate():
    alerts = [("bed-3", _alert("septic_shock", "immediate"))]
    first_seen = {("bed-3", "septic_shock"): T0}
    now = T0 + timedelta(minutes=4, seconds=59)
    assert escalate(alerts, acks={}, first_seen=first_seen, now=now, threshold=THRESH) == set()
