"""Aşama B's bridge: which monitor cell feeds which engine code (spec D2, D3), and the stage."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.api.infinity_rules import (
    DEFAULT_PARAMETERS, Candidate, RulesSettings, pick, rules_from_env,
)
from homunculus.api.infinity_shadow import DeviceView, shadow_settings_from_env
from homunculus.canonical import SignalCode

SHADOW = "s" * 40
HOSPITAL = "h1"
ENV = {"INFINITY_CLINICAL_STAGE": "rules", "INFINITY_SHADOW_TOKEN": SHADOW,
       "INFINITY_SHADOW_HOSPITAL": HOSPITAL, "INFINITY_DEVICE_BEDS_PATH": "/dev/null"}
T0 = 1_800_000_000.0


def _cell(name, state="value", value=80.0, unit="bpm", age=2.0, **extra):
    at = datetime.fromtimestamp(T0 - age, timezone.utc).isoformat()
    return {"parameter": name, "state": state, "value": value if state == "value" else None,
            "unit": unit, "age_s": age, "last_at": at, "evidence": "screen_match", "partial": False, **extra}


def _nbp(state="value", sys=120, dia=70, mean=87, measured_age=600.0, age=2.0):
    changed = datetime.fromtimestamp(T0 - measured_age, timezone.utc).isoformat()
    at = datetime.fromtimestamp(T0 - age, timezone.utc).isoformat()
    return {"parameter": "nbp", "state": state, "systolic": sys if state == "value" else None,
            "diastolic": dia if state == "value" else None, "mean": mean if state == "value" else None,
            "unit": "mmHg", "age_s": age, "last_at": at, "changed_at": changed,
            "measured_age_s": measured_age, "evidence": "screen_match", "partial": False}


def _view(*params):
    return DeviceView("10.0.0.5", "239.0.0.1", 2050, "streaming", 1.0, 100.0, tuple(params))


def test_the_stage_rules_is_implemented_and_shadow_is_still_shadow():
    settings = shadow_settings_from_env(ENV, {"d": HOSPITAL})
    assert settings.stage == "rules" and settings.on and settings.rules
    plain = shadow_settings_from_env({**ENV, "INFINITY_CLINICAL_STAGE": "shadow"}, {"d": HOSPITAL})
    assert plain.stage == "shadow" and plain.on and not plain.rules
    off = shadow_settings_from_env({**ENV, "INFINITY_CLINICAL_STAGE": "alarms"}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "stage_not_implemented"


def test_the_allowlist_defaults_and_refuses_an_unknown_name():
    assert rules_from_env({}).allowed == DEFAULT_PARAMETERS
    assert rules_from_env({"INFINITY_RULES_PARAMETERS": " hr, spo2 "}).allowed == ("hr", "spo2")
    with pytest.raises(ValueError, match="parameters_unknown"):
        rules_from_env({"INFINITY_RULES_PARAMETERS": "hr,respirations"})
    off = shadow_settings_from_env({**ENV, "INFINITY_RULES_PARAMETERS": "hr,bogus"}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "parameters_unknown"


def test_pick_hr_feeds_pulse_and_pls_only_when_hr_is_not_a_value():
    both = pick(_view(_cell("hr", value=88), _cell("pls", value=90)), DEFAULT_PARAMETERS, now=T0)
    assert [(c.code, c.value, c.via) for c in both] == [(SignalCode.HEART_RATE, 88.0, "hr")]
    pls = pick(_view(_cell("hr", state="invalid"), _cell("pls", value=90)), DEFAULT_PARAMETERS, now=T0)
    assert [(c.code, c.value, c.via) for c in pls] == [(SignalCode.HEART_RATE, 90.0, "pls")]
    assert pick(_view(_cell("hr", state="old"), _cell("pls", state="old")), DEFAULT_PARAMETERS, now=T0) == []


def test_pick_art_feeds_sbp_and_map_and_nbp_only_without_art_and_within_an_hour():
    art = pick(_view(_cell("art_systolic", value=130, unit="mmHg"), _cell("art_mean", value=95, unit="mmHg"),
                     _nbp(sys=110, mean=80)), DEFAULT_PARAMETERS, now=T0)
    assert {(c.code, c.value, c.via) for c in art} == {(SignalCode.SBP, 130.0, "art"), (SignalCode.MAP, 95.0, "art")}
    nbp = pick(_view(_cell("art_systolic", state="invalid", unit="mmHg"), _nbp(sys=110, mean=80, measured_age=3000)),
               DEFAULT_PARAMETERS, now=T0)
    assert {(c.code, c.value, c.via) for c in nbp} == {(SignalCode.SBP, 110.0, "nbp"), (SignalCode.MAP, 80.0, "nbp")}
    # NBP is stamped at the time its value last CHANGED, an upper bound of the cuff's time (D3).
    assert all(c.stamp == T0 - 3000 for c in nbp)
    too_old = pick(_view(_nbp(sys=110, mean=80, measured_age=3601)), DEFAULT_PARAMETERS, now=T0)
    assert too_old == []
    assert pick(_view(_nbp(state="invalid")), DEFAULT_PARAMETERS, now=T0) == []


def test_pick_honours_the_allowlist_and_the_units():
    only_spo2 = pick(_view(_cell("hr"), _cell("spo2", value=97, unit="%")), ("spo2",), now=T0)
    assert [(c.code, c.value, c.unit, c.via) for c in only_spo2] == [(SignalCode.SPO2, 97.0, "%", "spo2")]
    # RESP and temperature never feed, even when a misconfigured allowlist names them: the engine
    # mapping has no row for them (D2), and a name with no row is `parameters_unknown` upstream.
    assert pick(_view(_cell("respiration", unit="/min"), _cell("temperature", unit="C")), DEFAULT_PARAMETERS, now=T0) == []
    # A wire unit the engine does not expect feeds nothing (fed values carry the lane's units).
    assert pick(_view(_cell("hr", unit="/min")), DEFAULT_PARAMETERS, now=T0) == []


def test_a_candidate_is_stamped_at_the_cell_time_and_named_by_its_source():
    [c] = pick(_view(_cell("spo2", value=97, unit="%", age=4.0)), DEFAULT_PARAMETERS, now=T0)
    assert c.stamp == T0 - 4.0 and c.source == "10.0.0.5" and c.source_device == "infinity:10.0.0.5:spo2"
