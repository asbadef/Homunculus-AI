"""The shadow engine is a copy of the real one plus monitor samples (spec D5, D9): copying and
un-linking must move exactly the per-patient memory and nothing shared."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.profile import PatientProfile
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)


def _obs(pid, code, value, at, source="bridge"):
    return Observation(pid, code, value, "u", at, source)


def test_drop_source_removes_only_that_prefix_and_optionally_only_before():
    state = PatientState("bed-1")
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0, "bridge"))
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 80, T0 + timedelta(minutes=1), "infinity:10.0.0.5:hr"))
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 90, T0 + timedelta(minutes=2), "infinity:10.0.0.5:pls"))
    state.ingest(_obs("bed-1", SignalCode.SPO2, 97, T0 + timedelta(minutes=2), "infinity:10.0.0.5:spo2"))
    state.drop_source("infinity:", before=T0 + timedelta(minutes=2))
    assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [70, 90]
    assert state.latest(SignalCode.SPO2).value == 97
    state.drop_source("infinity:")
    assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [70]
    assert state.latest(SignalCode.SPO2) is None and SignalCode.SPO2 not in state._history


def test_copy_is_deep_and_independent():
    real = Engine()
    real.set_profile(PatientProfile(patient_id="bed-1"))
    real.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    shadow.ingest(_obs("bed-1", SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"), now=T0 + timedelta(minutes=1))
    assert real.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 150
    assert shadow.profile("bed-1") is not None and shadow.profile("bed-1") is not real.profile("bed-1")


def test_adopt_replaces_one_patient_from_the_other_engine_and_leaves_the_rest():
    real, shadow = Engine(), Engine()
    for pid in ("bed-1", "bed-2"):
        real.ingest(_obs(pid, SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    for pid in ("bed-1", "bed-2"):
        shadow.ingest(_obs(pid, SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"), now=T0 + timedelta(minutes=1))
    real.ingest(_obs("bed-1", SignalCode.SPO2, 92, T0 + timedelta(minutes=2)), now=T0 + timedelta(minutes=2))
    shadow.adopt(real, "bed-1")
    s1 = shadow.state("bed-1")
    assert s1.latest(SignalCode.HEART_RATE).value == 70 and s1.latest(SignalCode.SPO2).value == 92
    assert shadow.state("bed-2").latest(SignalCode.HEART_RATE).value == 150
    assert real.state("bed-1").latest(SignalCode.SPO2).value == 92      # the real engine is untouched
    assert [a.kind for a in shadow.active_alerts("bed-1")] == [a.kind for a in real.active_alerts("bed-1")]


def test_adopt_of_a_patient_the_other_engine_does_not_know_forgets_it():
    real, shadow = Engine(), Engine()
    shadow.ingest(_obs("bed-9", SignalCode.HEART_RATE, 150, T0, "infinity:x:hr"), now=T0)
    shadow.adopt(real, "bed-9")
    assert "bed-9" not in shadow.patient_ids() and shadow.active_alerts("bed-9") == []
