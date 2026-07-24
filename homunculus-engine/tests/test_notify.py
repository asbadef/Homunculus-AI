# tests/test_notify.py
from homunculus.api.notify import Notifier, Notification
from homunculus.reco.engine import Alert


def _alert(kind, urgency):
    return Alert(patient_id="bed-3", kind=kind, severity="critical", urgency=urgency,
                 summary=f"{kind} summary", clinical_reasoning="r", supporting_evidence=["s"],
                 recommended_actions=["Review."], confidence="c")


def test_for_new_emits_nurse_notification_for_immediate():
    n = Notifier()
    out = n.for_new("HOSP1", [_alert("septic_shock", "immediate")])
    assert len(out) == 1
    assert out[0].audience == "nurse" and out[0].trigger == "new"
    assert out[0].patient_id == "bed-3" and "bed-3" in out[0].body


def test_for_new_ignores_non_immediate():
    n = Notifier()
    assert n.for_new("HOSP1", [_alert("sepsis", "soon")]) == []


def test_for_new_dedups_same_key():
    n = Notifier()
    a = [_alert("septic_shock", "immediate")]
    assert len(n.for_new("HOSP1", a)) == 1
    assert n.for_new("HOSP1", a) == []          # second time: already notified


def test_prune_lets_recurrence_notify_again():
    n = Notifier()
    a = [_alert("septic_shock", "immediate")]
    n.for_new("HOSP1", a)
    n.prune("HOSP1", set())                      # alert no longer live
    assert len(n.for_new("HOSP1", a)) == 1       # recurrence notifies again


def test_for_escalation_emits_doctor_notifications():
    n = Notifier()
    a = _alert("septic_shock", "immediate")
    out = n.for_escalation("HOSP1", {("bed-3", "septic_shock")}, {("bed-3", "septic_shock"): a})
    assert len(out) == 1
    assert out[0].audience == "doctor" and out[0].trigger == "escalation"
