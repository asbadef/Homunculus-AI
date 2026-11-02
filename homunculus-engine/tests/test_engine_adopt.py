"""The shadow engine is a copy of the real one plus monitor samples (spec D5, D9): copying and
un-linking must move exactly the per-patient memory and nothing shared. Synthetic beds and made-up
values only (CLAUDE.md rule 6)."""
from __future__ import annotations

import copy as _copy
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.profile import PatientProfile
from homunculus.state.repository import InMemoryPatientRepository
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 10, 27, 9, 0, tzinfo=timezone.utc)

# Suspected infection, 100 kg, 30 mL/kg given, MAP 60 on noradrenaline 0.12, lactate 3.1: septic
# shock, sepsis and a running antibiotic clock (the same bed as tests/test_engine_forget.py).
SHOCK = [(SignalCode.SUSPECTED_INFECTION, 1.0), (SignalCode.WEIGHT_KG, 100),
         (SignalCode.CRYSTALLOID_BOLUS_ML, 3000), (SignalCode.MAP, 60),
         (SignalCode.NOREPINEPHRINE_RATE, 0.12), (SignalCode.LACTATE, 3.1)]

#: The per-patient structures whose values are mutable objects: a copy that shared one of them
#: would let the shadow lane write the real engine's memory (D1).
_MUTABLE = ("_alerts", "_held_news2_alert", "_profiles")


def _obs(pid, code, value, at, source="bridge"):
    return Observation(pid, code, value, "u", at, source)


def _put(engine, pid, code, value, minute=0, source="bridge"):
    o = _obs(pid, code, value, T0 + timedelta(minutes=minute), source)
    return engine.ingest(o, now=o.timestamp)


def _rich_engine():
    """A real engine in which every one of the six per-patient structures holds something:
    bed-3 a running antibiotic-clock anchor, alerts and a profile; bed-4 a NEWS2 alert held on a
    stale pressure; bed-5 a dropped anchor (infection charted absent after the recognition);
    bed-6 a profile and no reading at all, as after a restart."""
    real = Engine()
    for code, value in SHOCK:
        _put(real, "bed-3", code, value)
    real.set_profile(PatientProfile(patient_id="bed-3"))
    _put(real, "bed-4", SignalCode.SBP, 88)                       # NEWS2 3: a single red parameter
    _put(real, "bed-4", SignalCode.HEART_RATE, 72, minute=240)    # the pressure is stale: held
    for code, value in SHOCK:
        _put(real, "bed-5", code, value)
    _put(real, "bed-5", SignalCode.SUSPECTED_INFECTION, 0.0, minute=1)
    real.set_profile(PatientProfile(patient_id="bed-6"))
    for name in Engine._PER_PATIENT:
        assert getattr(real, name), f"the fixture left {name} empty"
    assert "bed-6" not in real.patient_ids()
    return real


def _snapshot(engine):
    return {name: _copy.deepcopy(getattr(engine, name)) for name in Engine._PER_PATIENT}


def test_per_patient_names_list_every_dict_the_engine_keeps():
    # A per-patient dict added to Engine later must be listed in _PER_PATIENT, or forget, copy and
    # adopt would silently leave it behind.
    assert {n for n, v in vars(Engine()).items() if isinstance(v, dict)} == set(Engine._PER_PATIENT)
    assert len(set(Engine._PER_PATIENT)) == len(Engine._PER_PATIENT)


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


def test_patient_state_copy_has_its_own_series_and_still_makes_new_ones():
    # Not a deep copy: an Observation is frozen and the state only ever appends to a series or
    # replaces it, so sharing the observations is safe and copying the lists is what is needed.
    state = PatientState("bed-1")
    state.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0))
    twin = state.copy()
    assert twin is not state and twin.patient_id == "bed-1"
    assert twin.history(SignalCode.HEART_RATE) == state.history(SignalCode.HEART_RATE)
    assert twin._history[SignalCode.HEART_RATE] is not state._history[SignalCode.HEART_RATE]
    assert isinstance(twin._history, defaultdict), "ingest relies on the default list"
    twin.ingest(_obs("bed-1", SignalCode.HEART_RATE, 80, T0 + timedelta(minutes=1)))
    twin.ingest(_obs("bed-1", SignalCode.SPO2, 97, T0 + timedelta(minutes=1)))   # a code the original never had
    assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [70]
    assert state.latest(SignalCode.SPO2) is None
    twin.drop_source("bridge")
    assert twin.latest(SignalCode.HEART_RATE) is None
    assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [70]


def test_repository_put_installs_a_state_and_replaces_one():
    repo = InMemoryPatientRepository()
    first, second = PatientState("bed-1"), PatientState("bed-1")
    repo.put("bed-1", first)
    assert repo.get_or_create("bed-1") is first and repo.patient_ids() == ["bed-1"]
    repo.put("bed-1", second)
    assert repo.get_or_create("bed-1") is second and repo.patient_ids() == ["bed-1"]


def test_copy_is_deep_and_independent():
    real = Engine()
    real.set_profile(PatientProfile(patient_id="bed-1"))
    real.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    shadow.ingest(_obs("bed-1", SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"), now=T0 + timedelta(minutes=1))
    assert real.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 150
    assert shadow.profile("bed-1") is not None and shadow.profile("bed-1") is not real.profile("bed-1")


def test_copy_gives_the_twin_its_own_series_lists():
    real = Engine()
    real.ingest(_obs("bed-1", SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    before = real.state("bed-1").history(SignalCode.HEART_RATE)
    shadow.state("bed-1").ingest(_obs("bed-1", SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"))
    assert real.state("bed-1").history(SignalCode.HEART_RATE) == before
    assert len(shadow.state("bed-1").history(SignalCode.HEART_RATE)) == 2
    assert shadow.state("bed-1").history(SignalCode.HEART_RATE) is not real.state("bed-1").history(SignalCode.HEART_RATE)
    assert (shadow.state("bed-1")._history[SignalCode.HEART_RATE]
            is not real.state("bed-1")._history[SignalCode.HEART_RATE])


def test_copy_carries_every_per_patient_structure_and_shares_none_of_them():
    real = _rich_engine()
    shadow = real.copy()
    for name in Engine._PER_PATIENT:
        assert getattr(shadow, name) == getattr(real, name), name
        assert getattr(shadow, name) is not getattr(real, name), name
    for name in _MUTABLE:
        for pid, value in getattr(real, name).items():
            assert getattr(shadow, name)[pid] is not value, (name, pid)
    assert shadow.patient_ids() == real.patient_ids()

    # D1: whatever the shadow lane does next never reaches the real engine's memory.
    before = _snapshot(real)
    _put(shadow, "bed-3", SignalCode.SUSPECTED_INFECTION, 0.0, minute=2, source="infinity:x:hr")
    _put(shadow, "bed-4", SignalCode.SBP, 120, minute=241, source="infinity:x:sbp")
    _put(shadow, "bed-5", SignalCode.HEART_RATE, 150, minute=3, source="infinity:x:hr")
    assert _snapshot(real) == before
    assert shadow._alerts != real._alerts and shadow._news2_judged_at != real._news2_judged_at
    assert shadow._recognized_at != real._recognized_at, "the shadow dropped bed-3's anchor, the real one kept it"


def test_adopt_replaces_one_patient_from_the_other_engine_and_leaves_the_rest():
    real = Engine()
    for pid in ("bed-1", "bed-2"):
        real.ingest(_obs(pid, SignalCode.HEART_RATE, 70, T0), now=T0)
    shadow = real.copy()
    for pid in ("bed-1", "bed-2"):
        shadow.ingest(_obs(pid, SignalCode.HEART_RATE, 150, T0 + timedelta(minutes=1), "infinity:x:hr"), now=T0 + timedelta(minutes=1))
    real.ingest(_obs("bed-1", SignalCode.SPO2, 92, T0 + timedelta(minutes=2)), now=T0 + timedelta(minutes=2))
    bed2_kinds = [a.kind for a in shadow.active_alerts("bed-2")]
    assert bed2_kinds == ["news2"], "the fixture: a heart rate of 150 raises NEWS2 on the shadow's bed-2"

    shadow.adopt(real, "bed-1")

    s1 = shadow.state("bed-1")
    assert s1.latest(SignalCode.HEART_RATE).value == 70 and s1.latest(SignalCode.SPO2).value == 92
    assert s1 is not real.state("bed-1")
    assert shadow.state("bed-2").latest(SignalCode.HEART_RATE).value == 150
    assert [a.kind for a in shadow.active_alerts("bed-2")] == bed2_kinds
    assert real.state("bed-1").latest(SignalCode.SPO2).value == 92      # the real engine is untouched
    assert [a.kind for a in shadow.active_alerts("bed-1")] == [a.kind for a in real.active_alerts("bed-1")]
    for name in Engine._PER_PATIENT:                                    # all six, for the adopted patient
        assert getattr(shadow, name).get("bed-1") == getattr(real, name).get("bed-1"), name
    assert shadow._alerts["bed-1"] is not real._alerts["bed-1"]

    # D1: a monitor reading the shadow takes in afterwards stays in the shadow.
    alerts_before = real.active_alerts("bed-1")
    bucket_before = _copy.deepcopy(real._alerts.get("bed-1"))
    judged_before = real._news2_judged_at.get("bed-1")
    shadow.ingest(_obs("bed-1", SignalCode.HEART_RATE, 160, T0 + timedelta(minutes=3), "infinity:x:hr"), now=T0 + timedelta(minutes=3))
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 160
    assert real.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert real.state("bed-1").latest(SignalCode.SPO2).value == 92
    assert real.active_alerts("bed-1") == alerts_before
    assert real._alerts.get("bed-1") == bucket_before
    assert real._news2_judged_at.get("bed-1") == judged_before
    assert [a.kind for a in shadow.active_alerts("bed-2")] == bed2_kinds


def test_adopt_carries_every_per_patient_structure_and_shares_none_of_them():
    real = _rich_engine()
    shadow = Engine()
    before = _snapshot(real)
    for pid in ("bed-3", "bed-4", "bed-5", "bed-6"):
        shadow.adopt(real, pid)
    for name in Engine._PER_PATIENT:
        assert getattr(shadow, name) == getattr(real, name), name
    for name in _MUTABLE:
        for pid, value in getattr(real, name).items():
            assert getattr(shadow, name)[pid] is not value, (name, pid)
    assert sorted(shadow.patient_ids()) == sorted(real.patient_ids())
    assert "bed-6" not in real.patient_ids(), "adopting must not create the patient in the engine it reads"
    assert _snapshot(real) == before


def test_adopt_keeps_the_profile_of_a_patient_with_a_profile_and_no_readings():
    # After a restart the replay only sets a profile. The copy holds it; a monitor link then gives
    # the shadow a reading; when the link ends the real engine's picture is that profile and no
    # readings. Losing the profile there would judge every later monitor sample without its baseline.
    real = Engine()
    real.set_profile(PatientProfile(patient_id="bed-1"))
    shadow = real.copy()
    shadow.ingest(_obs("bed-1", SignalCode.HEART_RATE, 150, T0, "infinity:x:hr"), now=T0)
    assert "bed-1" in shadow.patient_ids()

    shadow.adopt(real, "bed-1")

    assert shadow.profile("bed-1") is not None and shadow.profile("bed-1") == real.profile("bed-1")
    assert shadow.profile("bed-1") is not real.profile("bed-1")
    assert "bed-1" not in shadow.patient_ids() and shadow.active_alerts("bed-1") == []
    assert "bed-1" not in real.patient_ids(), "the real engine was not touched"


def test_adopt_of_a_patient_the_other_engine_does_not_know_forgets_it():
    real, shadow = Engine(), Engine()
    shadow.ingest(_obs("bed-9", SignalCode.HEART_RATE, 150, T0, "infinity:x:hr"), now=T0)
    shadow.adopt(real, "bed-9")
    assert "bed-9" not in shadow.patient_ids() and shadow.active_alerts("bed-9") == []
