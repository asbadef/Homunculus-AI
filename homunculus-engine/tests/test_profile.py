# tests/test_profile.py
"""Clinician-entered patient profile: comorbidities + baseline vital ranges."""
from __future__ import annotations

from homunculus.canonical import SignalCode
from homunculus.state.profile import BaselineRange, PatientProfile


def test_baseline_range_contains_is_inclusive():
    r = BaselineRange(100, 110)
    assert r.contains(100) is True
    assert r.contains(105) is True
    assert r.contains(110) is True
    assert r.contains(99) is False
    assert r.contains(111) is False


def test_profile_defaults_are_empty():
    p = PatientProfile("bed-3")
    assert p.comorbidities == frozenset()
    assert p.baselines == {}


def test_profile_carries_comorbidities_and_baselines():
    p = PatientProfile(
        "bed-3",
        comorbidities=frozenset({"chronic_af"}),
        baselines={SignalCode.HEART_RATE: BaselineRange(100, 110)},
    )
    assert "chronic_af" in p.comorbidities
    assert p.baselines[SignalCode.HEART_RATE].contains(105)
