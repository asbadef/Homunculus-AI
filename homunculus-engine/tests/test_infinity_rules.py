"""Aşama B's bridge: which monitor cell feeds which engine code (spec D2, D3), and the stage."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.infinity_rules import (
    ALLOWED_NAMES, DEFAULT_PARAMETERS, REPLAY_HOURS, SAMPLE_INTERVAL_S, Candidate, RulesSettings, Sampler,
    ShadowLane, pick, relation, rules_from_env,
)
from homunculus.api.infinity_shadow import DeviceView, ShadowSettings, shadow_settings_from_env
from homunculus.api.monitor_samples import InMemorySamples
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert

SHADOW = "s" * 40
HOSPITAL = "h1"
ENV = {"INFINITY_CLINICAL_STAGE": "rules", "INFINITY_SHADOW_TOKEN": SHADOW,
       "INFINITY_SHADOW_HOSPITAL": HOSPITAL, "INFINITY_DEVICE_BEDS_PATH": "/dev/null"}
T0 = 1_800_000_000.0
DT0 = datetime.fromtimestamp(T0, timezone.utc)


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
    assert settings.parameters == DEFAULT_PARAMETERS
    plain = shadow_settings_from_env({**ENV, "INFINITY_CLINICAL_STAGE": "shadow"}, {"d": HOSPITAL})
    assert plain.stage == "shadow" and plain.on and not plain.rules
    assert plain.parameters == ()
    # An explicit allowlist reaches the settings the lane is built from, in its own order.
    chosen = shadow_settings_from_env({**ENV, "INFINITY_RULES_PARAMETERS": "spo2,nbp"}, {"d": HOSPITAL})
    assert chosen.rules and chosen.parameters == ("spo2", "nbp")
    off = shadow_settings_from_env({**ENV, "INFINITY_CLINICAL_STAGE": "alarms"}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "stage_not_implemented"


def test_the_allowlist_defaults_and_refuses_an_unknown_name():
    assert rules_from_env({}) == RulesSettings() and rules_from_env({}).allowed == DEFAULT_PARAMETERS
    assert rules_from_env({"INFINITY_RULES_PARAMETERS": " hr, spo2 "}).allowed == ("hr", "spo2")
    # A strip parameter with no engine row is accepted (D2: the strip's names), and feeds nothing.
    assert rules_from_env({"INFINITY_RULES_PARAMETERS": "hr,respiration"}).allowed == ("hr", "respiration")
    with pytest.raises(ValueError, match="parameters_unknown"):
        rules_from_env({"INFINITY_RULES_PARAMETERS": "hr,respirations"})
    off = shadow_settings_from_env({**ENV, "INFINITY_RULES_PARAMETERS": "hr,bogus"}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "parameters_unknown"


@pytest.mark.parametrize("raw", [",", " , ,", ",,"])
def test_an_allowlist_of_no_names_is_refused(raw):
    # Not the default: the operator wrote something, and a `rules` stage feeding nothing would
    # look switched on while it never takes a sample.
    with pytest.raises(ValueError, match="parameters_unknown"):
        rules_from_env({"INFINITY_RULES_PARAMETERS": raw})
    off = shadow_settings_from_env({**ENV, "INFINITY_RULES_PARAMETERS": raw}, {"d": HOSPITAL})
    assert off.stage == "off" and off.problem == "parameters_unknown"


def test_a_name_that_feeds_nothing_is_named_once_in_the_log(caplog):
    with caplog.at_level("WARNING", logger="homunculus.api.infinity_rules"):
        rules_from_env({"INFINITY_RULES_PARAMETERS": "hr,respiration,temperature"})
    [record] = [r for r in caplog.records if r.name == "homunculus.api.infinity_rules"]
    assert record.levelname == "WARNING" and "respiration,temperature" in record.getMessage()
    caplog.clear()
    with caplog.at_level("WARNING", logger="homunculus.api.infinity_rules"):
        rules_from_env({"INFINITY_RULES_PARAMETERS": "hr,nbp"})
        rules_from_env({})
    assert not [r for r in caplog.records if r.name == "homunculus.api.infinity_rules"]


def test_a_rules_stage_cannot_be_built_without_parameters():
    # Only the env reader builds a `rules` stage today; by hand it must carry its allowlist too.
    with pytest.raises(ValueError):
        ShadowSettings("rules", "rules", None, SHADOW, HOSPITAL)
    built = ShadowSettings("rules", "rules", None, SHADOW, HOSPITAL, parameters=DEFAULT_PARAMETERS)
    assert built.rules and built.parameters == DEFAULT_PARAMETERS
    assert ShadowSettings("shadow", "shadow", None, SHADOW, HOSPITAL).parameters == ()   # A needs none


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
    # RESP, temperature, ART diastolic and EtCO2 never feed, whatever the allowlist says: they are
    # accepted by the allowlist (strip parameters, D2) but FEEDS has no row for them.
    assert pick(_view(_cell("respiration", unit="/min"), _cell("temperature", unit="C"),
                      _cell("art_diastolic", unit="mmHg"), _cell("etco2", unit="mmHg")),
                tuple(ALLOWED_NAMES), now=T0) == []
    # A wire unit the engine does not expect feeds nothing (fed values carry the lane's units).
    assert pick(_view(_cell("hr", unit="/min")), DEFAULT_PARAMETERS, now=T0) == []


def test_a_candidate_is_stamped_at_the_cell_time_and_named_by_its_source():
    [c] = pick(_view(_cell("spo2", value=97, unit="%", age=4.0)), DEFAULT_PARAMETERS, now=T0)
    assert c.stamp == T0 - 4.0 and c.source == "10.0.0.5" and c.source_device == "infinity:10.0.0.5:spo2"


@pytest.mark.parametrize("cells, allowed, expected", [
    pytest.param((_cell("art_systolic", value=130, unit="mmHg"), _cell("art_mean", state="invalid", unit="mmHg"),
                  _nbp(sys=110, mean=80)), DEFAULT_PARAMETERS,
                 {(SignalCode.SBP, 130.0, "art"), (SignalCode.MAP, 80.0, "nbp")}, id="art_mean_invalid_map_from_nbp"),
    pytest.param((_cell("pls", value=90),), DEFAULT_PARAMETERS, {(SignalCode.HEART_RATE, 90.0, "pls")},
                 id="no_hr_cell_pulse_from_pls"),
    pytest.param((_cell("hr", value=0),), DEFAULT_PARAMETERS, {(SignalCode.HEART_RATE, 0.0, "hr")},
                 id="a_zero_feeds"),
    pytest.param((_nbp(sys=110, mean=80, measured_age=3600.0),), DEFAULT_PARAMETERS,
                 {(SignalCode.SBP, 110.0, "nbp"), (SignalCode.MAP, 80.0, "nbp")}, id="nbp_at_exactly_an_hour"),
    pytest.param((_cell("art_systolic", value=130, unit="mmHg"), _cell("art_mean", value=95, unit="mmHg"),
                  _nbp(sys=110, mean=80)), ("hr", "nbp"),
                 {(SignalCode.SBP, 110.0, "nbp"), (SignalCode.MAP, 80.0, "nbp")}, id="art_off_nbp_on"),
])
def test_pick_pins_each_branch_and_its_observation(cells, allowed, expected):
    found = pick(_view(*cells), allowed, now=T0)
    assert {(c.code, c.value, c.via) for c in found} == expected and len(found) == len(expected)
    for c in found:
        obs = c.observation("bed-1")
        assert obs.timestamp.tzinfo is not None and obs.timestamp.utcoffset() == timedelta(0)
        assert obs.timestamp.timestamp() == c.stamp and obs.source_device == f"infinity:10.0.0.5:{c.via}"
        assert type(obs.value) is float and obs.patient_id == "bed-1" and obs.code == c.code


def test_a_candidate_built_by_hand_still_observes_a_float():
    obs = Candidate(SignalCode.HEART_RATE, 88, "bpm", T0, "10.0.0.5", "pls").observation("bed-1")
    assert type(obs.value) is float and obs.value == 88.0 and obs.source_device == "infinity:10.0.0.5:pls"


def test_a_stamp_without_a_time_zone_feeds_nothing():
    # Read as the server's local time it would move the sample by the server's offset; refused.
    assert pick(_view(_cell("hr", last_at="2027-01-15T08:00:00")), DEFAULT_PARAMETERS, now=T0) == []
    naive_nbp = {**_nbp(sys=110, mean=80), "changed_at": "2027-01-15T08:00:00"}
    assert pick(_view(naive_nbp), DEFAULT_PARAMETERS, now=T0) == []
    # The same instant with its offset feeds, stamped at that instant.
    [c] = pick(_view(_cell("hr", last_at="2027-01-15T12:00:00+04:00")), DEFAULT_PARAMETERS, now=T0)
    assert c.stamp == datetime(2027, 1, 15, 8, 0, tzinfo=timezone.utc).timestamp()


def _alert(kind, severity="high"):
    return Alert("bed-1", kind, severity, "immediate", kind, "", [], [], "high")


def test_sampler_takes_one_per_minute_per_patient_and_code_and_never_back_fills():
    sampler = Sampler()
    cand = pick(_view(_cell("hr", value=88)), DEFAULT_PARAMETERS, now=T0)
    assert sampler.due("bed-1", cand[0], now=T0)
    sampler.taken("bed-1", cand[0], now=T0)
    assert not sampler.due("bed-1", cand[0], now=T0 + 59.0)
    assert sampler.due("bed-1", cand[0], now=T0 + SAMPLE_INTERVAL_S)
    assert sampler.due("bed-2", cand[0], now=T0 + 1.0)                     # another patient
    other = pick(_view(_cell("spo2", value=97, unit="%")), DEFAULT_PARAMETERS, now=T0)[0]
    assert sampler.due("bed-1", other, now=T0 + 1.0)                      # another code
    sampler.forget("bed-1")
    assert sampler.due("bed-1", cand[0], now=T0 + 1.0)


def test_relation_of_a_shadow_finding_to_the_real_alerts():
    real = {"news2": _alert("news2", "high")}
    assert relation(_alert("news2", "high"), real) == "same"
    assert relation(_alert("news2", "critical"), real) == "level_differs"
    assert relation(_alert("sepsis"), real) == "shadow_only"


def _lane(stage_rules=True):
    audit = InMemoryAuditLog()
    lane = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=InMemorySamples(), audit=audit,
                      enabled=stage_rules)
    real = Engine()
    return lane, real, audit


def test_the_lane_feeds_only_the_shadow_engine_and_writes_sample_rows_and_finding_rows():
    lane, real, audit = _lane()
    lane.install("h1", real)                                  # start-up: a copy of the real engine
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    changed = lane.sample("h1", views, cards, now=T0)
    assert changed == ["bed-1"]
    assert real.patient_ids() == []                              # the real engine never saw it
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).source_device == "infinity:10.0.0.5:hr"
    kinds = {a.kind for a in shadow.active_alerts("bed-1")}
    assert "news2" in kinds
    assert [(r.event_type, r.subject) for r in audit.records(tenant="h1", limit=50)] == [("shadow_alert", "news2")]
    assert [(s.code, s.via, s.value) for s in lane.samples.since("h1", DT0 - timedelta(hours=1), now=DT0)] == [
        ("heart_rate", "hr", 140.0), ("spo2", "spo2", 85.0)]
    # Within the minute nothing more is taken; after it, no new row for an unchanged finding.
    assert lane.sample("h1", views, cards, now=T0 + 30.0) == []
    lane.sample("h1", views, cards, now=T0 + 61.0)
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1


def test_findings_carry_the_relation_and_null_without_a_link():
    lane, real, _ = _lane()
    lane.install("h1", real)
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    lane.sample("h1", views, cards, now=T0)
    found = lane.findings("h1", "bed-1", real, now=DT0)
    assert found["news2"]["total"] >= 5 and found["vitals"]["heart_rate"]["source"] == "infinity:10.0.0.5:hr"
    assert found["vitals"]["heart_rate"]["via"] == "hr"
    assert [f["relation"] for f in found["findings"]] == ["shadow_only"] * len(found["findings"])
    assert lane.findings("h1", "bed-2", real, now=DT0) is None
    assert lane.findings("h1", "bed-1", real, now=DT0, linked=False) is None


def test_unlink_returns_the_patient_to_the_real_picture_and_clears_the_findings():
    lane, real, audit = _lane()
    real.ingest(Observation("bed-1", SignalCode.HEART_RATE, 70, "bpm", DT0, "bridge"), now=DT0)
    lane.install("h1", real)
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    lane.sample("h1", views, cards, now=T0)
    # The next cycle: the bed is empty (the patient was discharged or moved).
    assert lane.sample("h1", views, [{**cards[0], "link": "none", "patient_id": None}], now=T0 + 61.0) == ["bed-1"]
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert [r.event_type for r in audit.records(tenant="h1", limit=50)] == ["shadow_alert", "shadow_alert_cleared"]
    assert audit.records(tenant="h1", event_type="shadow_alert_cleared", limit=5)[0].payload["reason"] == "unlinked"


def test_mirror_reaches_the_shadow_engine_only_and_is_a_no_op_below_rules():
    lane, real, _ = _lane()
    lane.install("h1", real)
    obs = Observation("bed-1", SignalCode.SPO2, 90, "%", DT0, "bridge")
    real.ingest(obs, now=DT0)
    lane.mirror_observation("h1", obs, now=DT0)
    assert lane.engines["h1"].state("bed-1").latest(SignalCode.SPO2).value == 90
    off, real2, _ = _lane(stage_rules=False)
    off.install("h1", real2)
    off.mirror_observation("h1", obs, now=DT0)
    assert "h1" not in off.engines


def test_restart_replays_the_last_24_hours_of_samples_and_seeds_the_clock_and_the_open_findings():
    lane, real, audit = _lane()
    lane.install("h1", real)
    cards = [{"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}]
    views = {"10.0.0.5": _view(_cell("hr", value=140), _cell("spo2", value=85, unit="%"))}
    lane.sample("h1", views, cards, now=T0)
    again = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=audit, enabled=True)
    again.install("h1", Engine(), now=DT0 + timedelta(seconds=30))
    shadow = again.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert not again.sampler.due("bed-1", pick(views["10.0.0.5"], DEFAULT_PARAMETERS, now=T0 + 30)[0], now=T0 + 30)
    # The finding is open from before: replaying does not open it twice.
    again.sample("h1", views, cards, now=T0 + 61.0)
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1
    # Samples older than the replay window are not replayed.
    stale = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=InMemoryAuditLog(), enabled=True)
    stale.install("h1", Engine(), now=DT0 + timedelta(hours=REPLAY_HOURS, minutes=1))
    assert "bed-1" not in stale.engines["h1"].patient_ids()


def test_a_lane_failure_is_swallowed_and_logged_once(caplog):
    lane, real, _ = _lane()
    lane.install("h1", real)
    calls = []
    def boom(): calls.append(1); raise RuntimeError("x")
    with caplog.at_level("ERROR"):
        assert lane.guard("sample", boom) is None
        assert lane.guard("sample", boom) is None
    assert len(calls) == 2 and sum("gölge motor" in r.message for r in caplog.records) == 1
    assert lane.state == "error"
    assert lane.guard("sample", lambda: 1) == 1 and lane.state == "ok"
