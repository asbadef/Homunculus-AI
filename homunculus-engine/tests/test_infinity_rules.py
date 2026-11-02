"""Aşama B's bridge: which monitor cell feeds which engine code (spec D2, D3), and the stage."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.infinity_rules import (
    ALLOWED_NAMES, DEFAULT_PARAMETERS, ERROR_WINDOW_S, INSTALL_RETRY_MAX_S, INSTALL_RETRY_S, PROVISIONAL_GRACE_S,
    REPLAY_HOURS, RETIRED_GRACE_S, SAMPLE_INTERVAL_S, SHADOW_ALERT, SHADOW_CLEARED,
    Candidate, RulesSettings, Sampler, ShadowLane, pick, relation, rules_from_env,
)
from homunculus.api.infinity_shadow import DeviceView, ShadowSettings, shadow_settings_from_env
from homunculus.api.monitor_samples import InMemorySamples, Sample
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.state.profile import PatientProfile

SHADOW = "s" * 40
HOSPITAL = "h1"
ENV = {"INFINITY_CLINICAL_STAGE": "rules", "INFINITY_SHADOW_TOKEN": SHADOW,
       "INFINITY_SHADOW_HOSPITAL": HOSPITAL, "INFINITY_DEVICE_BEDS_PATH": "/dev/null"}
T0 = 1_800_000_000.0
DT0 = datetime.fromtimestamp(T0, timezone.utc)


def _cell(name, state="value", value=80.0, unit="bpm", age=2.0, now=T0, **extra):
    at = datetime.fromtimestamp(now - age, timezone.utc).isoformat()
    return {"parameter": name, "state": state, "value": value if state == "value" else None,
            "unit": unit, "age_s": age, "last_at": at, "evidence": "screen_match", "partial": False, **extra}


def _nbp(state="value", sys=120, dia=70, mean=87, measured_age=600.0, age=2.0, now=T0):
    changed = datetime.fromtimestamp(now - measured_age, timezone.utc).isoformat()
    at = datetime.fromtimestamp(now - age, timezone.utc).isoformat()
    return {"parameter": "nbp", "state": state, "systolic": sys if state == "value" else None,
            "diastolic": dia if state == "value" else None, "mean": mean if state == "value" else None,
            "unit": "mmHg", "age_s": age, "last_at": at, "changed_at": changed,
            "measured_age_s": measured_age, "evidence": "screen_match", "partial": False}


def _view(*params, source="10.0.0.5"):
    return DeviceView(source, "239.0.0.1", 2050, "streaming", 1.0, 100.0, tuple(params))


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


def test_pick_never_feeds_an_nbp_whose_measurement_time_is_unknown():
    # NBP-2 (D5): `value_untimed` is the strip's alone. Its numbers are there, its change time is not,
    # and neither SBP nor MAP is fed, ART absent; nor would they be if it were labelled a value.
    untimed = {**_nbp(sys=110, mean=80), "state": "value_untimed", "changed_at": None, "measured_age_s": None}
    assert (untimed["systolic"], untimed["mean"]) == (110, 80)
    assert pick(_view(untimed), DEFAULT_PARAMETERS, now=T0) == []
    assert pick(_view({**untimed, "state": "value"}), DEFAULT_PARAMETERS, now=T0) == []


def test_pick_feeds_nothing_from_the_untimed_nbp_the_store_itself_shows():
    # The same end to end: the hub's untimed body, through the store's own board entry, into `pick`.
    from homunculus.api.infinity_shadow import ShadowStore
    from test_infinity_shadow_store import Clock, body, device, untimed

    store = ShadowStore(Clock(T0))
    store.ingest(body(device("192.0.2.10", *untimed(captured_at=T0 - 0.5))))
    view = store.devices(T0)["192.0.2.10"]
    [cell] = view.parameters
    assert (cell["state"], cell["changed_at"], cell["systolic"]) == ("value_untimed", None, 118)
    assert pick(view, DEFAULT_PARAMETERS, now=T0) == []


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


def test_sampler_takes_one_per_minute_per_patient_and_code_never_the_same_reading_twice_nor_before_the_link():
    sampler = Sampler()
    [cand] = pick(_view(_cell("hr", value=88)), DEFAULT_PARAMETERS, now=T0)            # stamped T0 - 2
    assert not sampler.due("bed-1", cand, now=T0, since=T0)                            # before the link (D5)
    assert sampler.due("bed-1", cand, now=T0, since=T0 - 10.0)
    sampler.taken("bed-1", cand, now=T0)
    [newer] = pick(_view(_cell("hr", value=90, now=T0 + 60.0)), DEFAULT_PARAMETERS, now=T0 + 60.0)
    assert not sampler.due("bed-1", newer, now=T0 + 59.0, since=0.0)                   # within the minute
    assert sampler.due("bed-1", newer, now=T0 + SAMPLE_INTERVAL_S, since=0.0)
    assert not sampler.due("bed-1", cand, now=T0 + SAMPLE_INTERVAL_S, since=0.0)      # the same reading: never twice
    assert sampler.due("bed-2", cand, now=T0 + 1.0, since=0.0)                         # another patient
    other = pick(_view(_cell("spo2", value=97, unit="%")), DEFAULT_PARAMETERS, now=T0)[0]
    assert sampler.due("bed-1", other, now=T0 + 1.0, since=0.0)                        # another code
    # D4: the minute is the code's, whichever cell fed it — PLS standing in for HR waits for it too;
    # the stamp is the source's own, so PLS's older reading is not "the same reading" as HR's.
    [pls] = pick(_view(_cell("hr", state="invalid"), _cell("pls", value=91, age=30.0)), DEFAULT_PARAMETERS, now=T0)
    assert not sampler.due("bed-1", pls, now=T0 + 1.0, since=0.0)
    assert sampler.due("bed-1", pls, now=T0 + SAMPLE_INTERVAL_S, since=0.0)
    sampler.forget("bed-1")
    assert sampler.due("bed-1", cand, now=T0 + 1.0, since=0.0)


def test_relation_of_a_shadow_finding_to_the_real_alerts():
    real = {"news2": _alert("news2", "high")}
    assert relation(_alert("news2", "high"), real) == "same"
    assert relation(_alert("news2", "critical"), real) == "level_differs"
    assert relation(_alert("sepsis"), real) == "shadow_only"


CARD = {"bed_id": "b-1", "link": "one", "patient_id": "bed-1", "source": "10.0.0.5"}
BED2 = {"bed_id": "b-2", "link": "one", "patient_id": "bed-2", "source": "10.0.0.6"}


class _Clock:
    """The lane's clock (epoch s), moved by the test."""

    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


def _lane(stage_rules=True, *, samples=None, audit=None, clock=None):
    audit = audit if audit is not None else InMemoryAuditLog()
    extra = {} if clock is None else {"clock": clock}
    lane = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=samples if samples is not None else InMemorySamples(),
                      audit=audit, enabled=stage_rules, **extra)
    return lane, Engine(), audit


def _at(t):
    return datetime.fromtimestamp(t, timezone.utc)


def _vitals(now=T0, hr=140.0, spo2=85.0, source="10.0.0.5"):
    """HR 140 and SpO2 85 (NEWS2 3 + 3: a moderate finding), stamped 2 s before `now`."""
    return {source: _view(_cell("hr", value=hr, now=now), _cell("spo2", value=spo2, unit="%", now=now), source=source)}


def _link(lane, real, cards=(CARD,), *, at=T0 - 10.0):
    """The pass that first SEES the links: nothing stamped before it is ever taken for them (D5).
    It returns the newly linked patients — their `shadow` key goes from None to a picture."""
    assert lane.sample("h1", {}, list(cards), real, now=at) == sorted(c["patient_id"] for c in cards)


def _rows(audit):
    return [(r.event_type, r.subject, r.payload.get("reason")) for r in audit.records(tenant="h1", limit=500)]


def _restarted(at=T0 + 30.0, admitted=None):
    """bed-1 sampled on 10.0.0.5 with a finding open, then a second lane installed from the records."""
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    again, real2 = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=audit, enabled=True), Engine()
    again.install("h1", real2, now=_at(at), admitted=admitted)
    return again, real2, audit


def test_the_lane_feeds_only_the_shadow_engine_and_writes_sample_rows_and_finding_rows():
    lane, real, audit = _lane()
    lane.install("h1", real)                                  # start-up: a copy of the real engine
    _link(lane, real)
    assert lane.sample("h1", _vitals(), [CARD], real, now=T0) == ["bed-1"]
    assert real.patient_ids() == []                           # the real engine never saw it
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).source_device == "infinity:10.0.0.5:hr"
    assert "news2" in {a.kind for a in shadow.active_alerts("bed-1")}
    [opened] = audit.records(tenant="h1", limit=50)
    assert (opened.event_type, opened.subject) == ("shadow_alert", "news2")
    # D6: the row says how the finding stood to the real engine — the weekly list's `shadow_only`.
    assert opened.payload["relation"] == "shadow_only"
    assert opened.payload["sources"] == ["infinity:10.0.0.5:hr", "infinity:10.0.0.5:spo2"]
    assert [(s.code, s.via, s.value) for s in lane.samples.since("h1", DT0 - timedelta(hours=1), now=DT0)] == [
        ("heart_rate", "hr", 140.0), ("spo2", "spo2", 85.0)]
    # Within the minute nothing more is taken; after it, no new row for an unchanged finding.
    assert lane.sample("h1", _vitals(T0 + 30.0), [CARD], real, now=T0 + 30.0) == []
    assert lane.sample("h1", _vitals(T0 + 61.0), [CARD], real, now=T0 + 61.0) == ["bed-1"]
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1


def test_findings_carry_the_relation_the_since_and_the_news2_line_and_null_without_a_link():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    found = lane.findings("h1", "bed-1", real, now=DT0)
    news2 = found["news2"]
    assert news2["total"] >= 5 and news2["red_param"] is True
    assert news2["measured_at"]["pulse"] == _at(T0 - 2.0).isoformat() and news2["measured_at"]["temperature"] is None
    assert isinstance(news2["fresh_until"]["pulse"], str) and news2["fresh_until"]["temperature"] is None
    assert "last_charted" not in news2                  # the charted inputs: the real card's own line
    assert found["vitals"]["heart_rate"]["source"] == "infinity:10.0.0.5:hr"
    assert found["vitals"]["heart_rate"]["via"] == "hr"
    assert [f["relation"] for f in found["findings"]] == ["shadow_only"] * len(found["findings"])
    # D6: since when the finding stands — the pass that opened it, on the lane's clock.
    assert [f["since"] for f in found["findings"] if f["kind"] == "news2"] == [DT0.isoformat()]
    assert lane.findings("h1", "bed-2", real, now=DT0) is None


def test_a_linked_patient_with_no_sample_yet_has_an_empty_picture_not_none():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real)                                         # the card says `one`; nothing has fed yet
    found = lane.findings("h1", "bed-1", real, now=DT0)
    assert found["vitals"] == {} and found["findings"] == []
    assert found["news2"]["total"] == 0 and sorted(found["news2"]["missing"]) == sorted(
        ["respiration_rate", "spo2", "systolic_bp", "pulse", "temperature"])
    assert "bed-1" not in lane.engines["h1"].patient_ids()  # read, not created


def test_unlink_returns_the_patient_to_the_real_picture_and_leaves_the_real_engine_alone():
    lane, real, audit = _lane()
    real.ingest(Observation("bed-1", SignalCode.HEART_RATE, 70, "bpm", DT0, "bridge"), now=DT0)
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    real_before = (real.patient_ids(), real.state("bed-1").history(SignalCode.HEART_RATE),
                   real.state("bed-1").history(SignalCode.SPO2), real.active_alerts("bed-1"))
    # The next cycle: the bed is empty (the patient was discharged or moved).
    empty = {**CARD, "link": "none", "patient_id": None}
    assert lane.sample("h1", _vitals(T0 + 61.0), [empty], real, now=T0 + 61.0) == ["bed-1"]
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 70
    assert shadow.state("bed-1").latest(SignalCode.SPO2) is None
    assert "bed-1" not in lane.linked["h1"] and lane.findings("h1", "bed-1", real, now=DT0) is None
    opened, cleared = audit.records(tenant="h1", limit=50)
    assert (opened.event_type, cleared.event_type) == ("shadow_alert", "shadow_alert_cleared")
    assert cleared.payload["reason"] == "unlinked" and cleared.payload["opened_id"] == opened.id
    # D1: `adopt` read the real engine and wrote nothing into it.
    assert (real.patient_ids(), real.state("bed-1").history(SignalCode.HEART_RATE),
            real.state("bed-1").history(SignalCode.SPO2), real.active_alerts("bed-1")) == real_before


def test_the_link_is_forward_only_a_new_patient_never_gets_the_last_patients_cuff():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real, at=T0 - 100.0)

    def monitor(now, changed):
        return {"10.0.0.5": _view(_cell("hr", value=80, now=now),
                                  _nbp(sys=85, mean=60, measured_age=now - changed, now=now))}

    lane.sample("h1", monitor(T0, T0 - 50.0), [CARD], real, now=T0)
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.SBP).source_device == "infinity:10.0.0.5:nbp"
    # The bed's patient changes; the monitor still shows bed-1's cuff, well within its hour.
    card = {**CARD, "patient_id": "bed-2"}
    assert lane.sample("h1", monitor(T0 + 61.0, T0 - 50.0), [card], real, now=T0 + 61.0) == ["bed-1", "bed-2"]
    assert lane.sample("h1", monitor(T0 + 122.0, T0 - 50.0), [card], real, now=T0 + 122.0) == ["bed-2"]
    new = shadow.state("bed-2")
    assert new.latest(SignalCode.HEART_RATE).timestamp == _at(T0 + 120.0)       # its own, after the link
    assert new.latest(SignalCode.SBP) is None and new.latest(SignalCode.MAP) is None
    assert shadow.state("bed-1").latest(SignalCode.SBP) is None                 # the old patient's dropped
    # A new cuff measurement — a later change — is the new patient's own.
    lane.sample("h1", monitor(T0 + 183.0, T0 + 150.0), [card], real, now=T0 + 183.0)
    assert new.latest(SignalCode.SBP).value == 85 and new.latest(SignalCode.SBP).timestamp == _at(T0 + 150.0)
    assert new.latest(SignalCode.MAP).value == 60


def test_one_cuff_measurement_is_one_sample_however_long_the_monitor_shows_it():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real, at=T0 - 1000.0)
    for minute in range(10):                                  # one measurement, on the screen for ten minutes
        now = T0 + 60.0 * minute
        lane.sample("h1", {"10.0.0.5": _view(_nbp(measured_age=30.0 + 60.0 * minute, now=now))}, [CARD], real, now=now)
    window = (_at(T0 - 3600.0), _at(T0 + 3600.0))
    rows = lane.samples.since("h1", window[0], now=window[1])
    assert [(s.code, s.via, s.captured_at) for s in rows] == [("sbp", "nbp", _at(T0 - 30.0)), ("map", "nbp", _at(T0 - 30.0))]
    assert len(lane.engines["h1"].state("bed-1").history(SignalCode.SBP)) == 1
    now = T0 + 600.0                                          # the next cuff measurement
    lane.sample("h1", {"10.0.0.5": _view(_nbp(sys=118, measured_age=10.0, now=now))}, [CARD], real, now=now)
    assert len(lane.samples.since("h1", window[0], now=window[1])) == 4


def test_a_restart_seeds_the_minute_from_the_receipt_and_the_stamp_from_the_capture():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real, at=T0 - 4000.0)
    # One cuff measurement, changed half an hour before it was sampled (received) at T0.
    lane.sample("h1", {"10.0.0.5": _view(_nbp(measured_age=1800.0))}, [CARD], real, now=T0)

    def restarted():
        again, real2 = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=audit, enabled=True), Engine()
        again.install("h1", real2, now=_at(T0 + 30.0))
        return again, real2

    def cuff(now, changed):
        return {"10.0.0.5": _view(_nbp(measured_age=now - changed, now=now))}

    def count(a_lane):
        return len(a_lane.samples.since("h1", _at(T0 - 7200.0), now=_at(T0 + 7200.0)))

    assert count(lane) == 2                                   # its SBP and MAP
    # The stamp: the cuff on the screen since before the restart is not taken again, however late.
    again, real2 = restarted()
    again.sample("h1", cuff(T0 + 61.0, T0 - 1800.0), [CARD], real2, now=T0 + 61.0)
    again.sample("h1", cuff(T0 + 600.0, T0 - 1800.0), [CARD], real2, now=T0 + 600.0)
    assert count(again) == 2
    # The minute runs from the RECEIPT: a new measurement 31 s after it waits for the minute
    # (seeded from the cuff's change, half an hour back, the minute would have passed long ago).
    again, real2 = restarted()
    again.sample("h1", cuff(T0 + 31.0, T0 + 20.0), [CARD], real2, now=T0 + 31.0)
    assert count(again) == 2
    again.sample("h1", cuff(T0 + 61.0, T0 + 20.0), [CARD], real2, now=T0 + 61.0)
    assert count(again) == 4


def test_art_falling_to_stars_hands_sbp_to_a_cuff_measured_50_minutes_ago():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real, at=T0 - 4000.0)
    art = _view(_cell("art_systolic", value=130, unit="mmHg"), _cell("art_mean", value=95, unit="mmHg"),
                _nbp(sys=110, mean=80, measured_age=2939.0))
    lane.sample("h1", {"10.0.0.5": art}, [CARD], real, now=T0)
    now = T0 + 61.0
    stars = _view(_cell("art_systolic", state="invalid", unit="mmHg", now=now),
                  _cell("art_mean", state="invalid", unit="mmHg", now=now),
                  _nbp(sys=110, mean=80, measured_age=3000.0, now=now))
    lane.sample("h1", {"10.0.0.5": stars}, [CARD], real, now=now)
    rows = [(s.code, s.via, s.value) for s in lane.samples.since("h1", _at(T0 - 7200.0), now=_at(T0 + 7200.0))]
    # Spec §5: the cuff is older than ART's last sample, and still feeds once ART shows ***.
    assert ("sbp", "art", 130.0) in rows and ("sbp", "nbp", 110.0) in rows and ("map", "nbp", 80.0) in rows


class _BrokenSamples(InMemorySamples):
    def append(self, sample):
        raise RuntimeError("monitor_samples: the database is down")

    def append_many(self, samples):
        raise RuntimeError("monitor_samples: the database is down")


class _CountingSamples(InMemorySamples):
    """Every write the lane makes: `("append", 1)` or `("append_many", rows)`."""

    def __init__(self):
        super().__init__()
        self.writes = []

    def append(self, sample):
        self.writes.append(("append", 1))
        super().append(sample)

    def append_many(self, samples):
        self.writes.append(("append_many", len(samples)))
        super().append_many(samples)


def test_a_pass_writes_its_samples_once_whatever_it_took():
    """T6 review: one transaction (and one pool pre-ping) per sample on the event loop, ≈52 a busy
    pass. The pass collects its rows and writes them once, at its end; a pass that took nothing
    writes nothing."""
    store = _CountingSamples()
    lane, real, _ = _lane(samples=store)
    lane.install("h1", real)
    cards = [CARD, BED2]
    _link(lane, real, cards)
    assert store.writes == []
    views = {**_vitals(), **_vitals(hr=60.0, spo2=97.0, source="10.0.0.6")}
    assert lane.sample("h1", views, cards, real, now=T0) == ["bed-1", "bed-2"]
    assert store.writes == [("append_many", 4)]               # HR and SpO2 of two patients, one write
    assert len(store.since("h1", DT0 - timedelta(hours=1), now=DT0)) == 4
    assert lane.sample("h1", views, cards, real, now=T0 + 30.0) == []       # nothing due: no write
    assert store.writes == [("append_many", 4)]


class _FlakySamples(InMemorySamples):
    """Refuses its first `failures` reads; `reads` holds the instant (`now`) of every read."""

    def __init__(self, failures=1):
        super().__init__()
        self.failures = failures
        self.reads = []

    def since(self, hospital, since, *, now):
        self.reads.append(now.timestamp())
        if self.failures:
            self.failures -= 1
            raise RuntimeError("monitor_samples: not reachable yet")
        return super().since(hospital, since, now=now)


def test_a_failing_sample_store_feeds_once_and_the_pass_goes_on():
    clock = _Clock(T0)
    lane, real, _ = _lane(samples=_BrokenSamples(), clock=clock)
    lane.install("h1", real)
    cards = [CARD, BED2]
    _link(lane, real, cards)

    def views(now):
        return {**_vitals(now), **_vitals(now, hr=60.0, spo2=97.0, source="10.0.0.6")}

    assert lane.sample("h1", views(T0), cards, real, now=T0) == ["bed-1", "bed-2"]
    shadow = lane.engines["h1"]
    assert [len(shadow.state(p).history(SignalCode.HEART_RATE)) for p in ("bed-1", "bed-2")] == [1, 1]
    assert set(lane.linked["h1"]) == {"bed-1", "bed-2"} and lane.state == "error"
    assert [r.event_type for r in lane.audit.records(tenant="h1", limit=50)] == ["shadow_alert"]   # bed-1's
    # The same readings a minute on: taken already, never fed again.
    assert lane.sample("h1", views(T0), cards, real, now=T0 + 61.0) == []
    assert [len(shadow.state(p).history(SignalCode.HEART_RATE)) for p in ("bed-1", "bed-2")] == [1, 1]
    lane.samples = InMemorySamples()                          # the table is back
    clock.t = T0 + 61.0
    lane.sample("h1", views(T0 + 61.0), cards, real, now=T0 + 61.0)
    assert len(lane.samples.since("h1", DT0, now=_at(T0 + 120.0))) == 4
    # The word stays "error" until the window has passed with no new failure, then reads "ok".
    assert lane.state == "error"
    clock.t = T0 + ERROR_WINDOW_S
    assert lane.state == "ok"


def test_one_patients_failure_does_not_stop_the_pass(monkeypatch):
    lane, real, _ = _lane()
    lane.install("h1", real)
    cards = [CARD, BED2]
    _link(lane, real, cards)
    publish = lane._publish

    def flaky(hospital, patient_id, now, real_engine):
        if patient_id == "bed-1":
            raise RuntimeError("x")
        return publish(hospital, patient_id, now, real_engine)

    monkeypatch.setattr(lane, "_publish", flaky)
    views = {**_vitals(), **_vitals(source="10.0.0.6")}
    assert lane.sample("h1", views, cards, real, now=T0) == ["bed-1", "bed-2"]
    assert lane.engines["h1"].state("bed-2").latest(SignalCode.HEART_RATE).value == 140
    assert [r.patient_id for r in lane.audit.records(tenant="h1", limit=50)] == ["bed-2"]
    assert lane.state == "error"


def test_a_failed_install_reads_as_an_error_and_only_a_pass_retries_it_after_its_wait():
    start = T0 - 100.0
    clock = _Clock(start)
    lane, real, _ = _lane(samples=_FlakySamples(), clock=clock)
    assert lane.guard("install", lambda: lane.install("h1", real)) is None
    assert "h1" not in lane.engines and lane.state == "error"
    assert lane.findings("h1", "bed-1", real, now=DT0) is None
    # The first retry waits INSTALL_RETRY_S of lane time: a pass before it builds nothing.
    assert lane.sample("h1", {}, [CARD], real, now=start + INSTALL_RETRY_S - 1.0) == []
    assert "h1" not in lane.engines and lane.samples.reads == [start]
    clock.t = start + INSTALL_RETRY_S
    assert lane.guard("sample", lambda: lane.sample("h1", {}, [CARD], real, now=clock.t)) == ["bed-1"]
    assert "h1" in lane.engines and "bed-1" in lane.linked["h1"]
    assert lane.state == "error"                              # the failure is not ERROR_WINDOW_S old yet
    clock.t = start + ERROR_WINDOW_S
    assert lane.state == "ok"
    # A door never retries it (final review): a retry replays 24 h of samples on the event loop,
    # inside `/ingest`, before the real frame and the nurse's notification go out. A mirror, a
    # profile and a discharge during a pending install change nothing and read nothing, even after
    # the wait; the next pass installs, and its copy of the real engine holds what they gave it.
    clock2 = _Clock(T0)
    other, real2, _ = _lane(samples=_FlakySamples(), clock=clock2)
    other.guard("install", lambda: other.install("h1", real2))
    clock2.t = T0 + INSTALL_RETRY_S                           # the wait is over
    obs = Observation("bed-1", SignalCode.SPO2, 90, "%", DT0, "bridge")
    profile = PatientProfile("bed-1", comorbidities=frozenset({"copd"}))
    real2.ingest(obs, now=DT0)                                # the door first, then the mirror (D1)
    other.guard("mirror", lambda: other.mirror_observation("h1", obs, now=DT0, real=real2))
    real2.set_profile(profile)
    other.guard("mirror", lambda: other.mirror_profile("h1", profile))
    other.guard("forget", lambda: other.forget("h1", "bed-9"))
    assert "h1" not in other.engines and other.samples.reads == [T0]    # no retry: nothing built, nothing read
    assert other.guard("sample", lambda: other.sample("h1", {}, [CARD], real2, now=clock2.t)) == ["bed-1"]
    assert other.samples.reads == [T0, T0 + INSTALL_RETRY_S]           # the pass retried it, once
    shadow = other.engines["h1"]
    assert len(shadow.state("bed-1").history(SignalCode.SPO2)) == 1    # in the copy, fed once
    assert shadow.profile("bed-1") == profile


def test_a_failing_install_is_retried_with_a_doubling_wait_up_to_ten_minutes():
    # The re-review: a failing install was retried on every readings POST (every ~5 s), each
    # retry replaying 24 h of samples on the event loop.
    clock = _Clock(T0)
    flaky = _FlakySamples(failures=7)
    lane, real, _ = _lane(samples=flaky, clock=clock)
    lane.guard("install", lambda: lane.install("h1", real))
    for second in range(1, 2200):                             # a readings POST every second
        clock.t = T0 + second
        lane.guard("sample", lambda: lane.sample("h1", {}, [], real, now=clock.t))
    waits = [later - earlier for earlier, later in zip(flaky.reads, flaky.reads[1:])]
    assert (INSTALL_RETRY_S, INSTALL_RETRY_MAX_S) == (30.0, 600.0)
    assert waits == [30.0, 60.0, 120.0, 240.0, 480.0, 600.0, 600.0]
    assert "h1" in lane.engines                               # the eighth read built it


def test_a_bad_sample_row_or_finding_row_is_skipped_and_logged_once_per_install(caplog):
    samples, audit = InMemorySamples(), InMemoryAuditLog()
    for pid, code, via, value, unit, ago in (("bed-1", "heart_rate", "hr", 140.0, "bpm", 60.0),
                                             ("bed-1", "bogus", "hr", 1.0, "bpm", 50.0),     # unreadable
                                             ("bed-2", "spo2", "spo2", 97.0, "%", 40.0)):
        source = "10.0.0.5" if pid == "bed-1" else "10.0.0.6"
        samples.append(Sample("h1", pid, "b", source, code, via, value, unit, _at(T0 - ago), _at(T0 - ago + 1.0)))
    audit.append(AuditEvent("h1", SHADOW_ALERT, "bed-7", "news2", {"severity": "high", "evidence": 5}))   # unreadable
    audit.append(AuditEvent("h1", SHADOW_ALERT, "bed-2", "news2",
                            {"severity": "moderate", "sources": ["infinity:10.0.0.6:spo2"]}))
    lane, real, _ = _lane(samples=samples, audit=audit)
    with caplog.at_level("WARNING", logger="homunculus.api.infinity_rules"):
        lane.install("h1", real, now=DT0)
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert shadow.state("bed-2").latest(SignalCode.SPO2).value == 97
    assert set(lane.linked["h1"]) == {"bed-1", "bed-2"} and lane.state == "ok"
    assert ("h1", "bed-2") in lane._open and ("h1", "bed-7") not in lane._open
    [record] = [r for r in caplog.records if r.name == "homunculus.api.infinity_rules"]
    assert record.levelname == "WARNING" and "1 örnek" in record.getMessage() and "1 bulgu" in record.getMessage()


def test_one_failed_call_reads_as_an_error_for_the_window_and_then_clears_by_itself(caplog):
    clock = _Clock(T0)
    lane, real, _ = _lane(clock=clock)
    lane.install("h1", real)

    def boom():
        raise RuntimeError("x")

    with caplog.at_level("WARNING", logger="homunculus.api.infinity_rules"):
        assert lane.guard("forget", boom) is None             # one failed discharge, never repeated
        assert lane.state == "error"
        clock.t = T0 + ERROR_WINDOW_S - 1.0
        assert lane.state == "error"
        clock.t = T0 + ERROR_WINDOW_S
        assert lane.state == "ok"                             # no second discharge needed to clear it
        assert [r.levelname for r in caplog.records] == ["ERROR"]
        assert lane.guard("findings", lambda: 1) == 1         # the next call says so, once
        assert lane.guard("findings", lambda: 1) == 1
        assert [r.levelname for r in caplog.records] == ["ERROR", "WARNING"]
        assert "forget" in caplog.records[1].getMessage()


def test_a_flapping_kind_logs_one_error_and_reads_error_until_a_quiet_window(caplog):
    clock = _Clock(T0)
    lane, real, _ = _lane(clock=clock)
    lane.install("h1", real)

    def boom():
        raise RuntimeError("x")

    with caplog.at_level("WARNING", logger="homunculus.api.infinity_rules"):
        for step in range(10):            # one patient's `shadow` key fails, the next one's builds: every board
            clock.t = T0 + 20.0 * step
            assert lane.guard("findings", boom) is None
            assert lane.guard("findings", lambda: {"news2": {}}) == {"news2": {}}
            assert lane.state == "error"
        assert [r.levelname for r in caplog.records] == ["ERROR"] and caplog.records[0].exc_info is not None
        clock.t = T0 + 20.0 * 9 + ERROR_WINDOW_S
        assert lane.state == "ok"
        lane.guard("sample", lambda: None)
        assert [r.levelname for r in caplog.records] == ["ERROR", "WARNING"]
        lane.guard("findings", boom)                          # failing again after the window: a new ERROR
        assert [r.levelname for r in caplog.records] == ["ERROR", "WARNING", "ERROR"] and lane.state == "error"


def test_after_a_restart_a_link_is_provisional_until_its_card_confirms_it():
    lane, real, audit = _restarted()
    link = lane.linked["h1"]["bed-1"]
    assert link.provisional and link.source == "10.0.0.5" and link.since == T0 - 2.0   # the newest sample's
    assert lane.findings("h1", "bed-1", real, now=_at(T0 + 30.0)) is None             # nothing guessed (D5)
    lane.sample("h1", _vitals(T0 + 31.0), [CARD], real, now=T0 + 31.0)
    link = lane.linked["h1"]["bed-1"]
    assert not link.provisional and link.since == T0 - 2.0      # the same device: the link goes on
    found = lane.findings("h1", "bed-1", real, now=_at(T0 + 31.0))
    assert [f["since"] for f in found["findings"] if f["kind"] == "news2"] == [DT0.isoformat()]
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1   # not opened twice


def test_a_provisional_link_ends_as_soon_as_its_device_reports_another_bed():
    lane, real, audit = _restarted()
    other = {**CARD, "patient_id": "bed-9"}
    assert lane.sample("h1", _vitals(T0 + 31.0), [other], real, now=T0 + 31.0) == ["bed-1", "bed-9"]
    assert "bed-1" not in lane.linked["h1"] and "bed-9" in lane.linked["h1"]
    assert lane.engines["h1"].state("bed-1").latest(SignalCode.HEART_RATE) is None
    assert _rows(audit)[-1] == ("shadow_alert_cleared", "news2", "unlinked")


def test_a_provisional_link_whose_device_stays_silent_waits_out_the_grace_carried_over():
    lane, real, audit = _restarted()
    start = T0 + 31.0
    assert lane.sample("h1", {}, [BED2], real, now=start) == ["bed-2"]          # bed-2's new link
    assert lane.linked["h1"]["bed-1"].provisional and "bed-2" in lane.linked["h1"]    # beside a new link
    assert lane.sample("h1", {}, [BED2], real, now=start + PROVISIONAL_GRACE_S - 1.0) == []
    assert "bed-1" in lane.linked["h1"] and lane.findings("h1", "bed-1", real, now=_at(start)) is None
    assert lane.sample("h1", {}, [BED2], real, now=start + PROVISIONAL_GRACE_S) == ["bed-1"]
    assert set(lane.linked["h1"]) == {"bed-2"}
    assert _rows(audit)[-1] == ("shadow_alert_cleared", "news2", "unlinked")


def test_restart_replays_the_last_24_hours_of_samples_and_seeds_the_open_findings():
    lane, real, audit = _restarted()
    assert lane.engines["h1"].state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    [hr, _] = pick(_vitals()["10.0.0.5"], DEFAULT_PARAMETERS, now=T0)
    assert not lane.sampler.due("bed-1", hr, now=T0 + 30.0, since=0.0)
    # The finding is open from before: replaying, and a sample after it, do not open it twice.
    lane.sample("h1", _vitals(T0 + 61.0), [CARD], real, now=T0 + 61.0)
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1
    assert len(lane.engines["h1"].state("bed-1").history(SignalCode.HEART_RATE)) == 2
    # Samples older than the replay window are not replayed.
    stale = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=InMemoryAuditLog(), enabled=True)
    stale.install("h1", Engine(), now=DT0 + timedelta(hours=REPLAY_HOURS, minutes=1))
    assert "bed-1" not in stale.engines["h1"].patient_ids() and stale.linked["h1"] == {}


def test_a_finding_open_for_more_than_a_day_is_seeded_and_not_opened_twice(monkeypatch):
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    yesterday = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    monkeypatch.setattr("homunculus.api.audit._now_iso", lambda: yesterday)   # the audit's own clock, a day back
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    monkeypatch.undo()
    # The restart comes after the samples left the replay window: only the audit remembers the finding.
    later = T0 + 25 * 3600.0
    again, real2 = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=audit, enabled=True), Engine()
    again.install("h1", real2, now=_at(later))
    link = again.linked["h1"]["bed-1"]
    assert link.provisional and link.source == "10.0.0.5" and link.since == later     # the row's device, from now
    again.sample("h1", {}, [CARD], real2, now=later + 5.0)                             # the card confirms it
    again.sample("h1", _vitals(later + 10.0), [CARD], real2, now=later + 10.0)
    assert len(again.engines["h1"].state("bed-1").history(SignalCode.HEART_RATE)) == 1
    assert len(audit.records(tenant="h1", event_type="shadow_alert", limit=50)) == 1


def test_a_discharged_patients_open_finding_is_closed_at_install_and_their_samples_are_not_replayed():
    lane, real, audit = _restarted(admitted=lambda pid: pid != "bed-1")
    assert "bed-1" not in lane.linked["h1"] and "bed-1" not in lane.engines["h1"].patient_ids()
    opened, cleared = audit.records(tenant="h1", limit=50)
    assert cleared.event_type == "shadow_alert_cleared" and cleared.payload["reason"] == "discharged"
    assert cleared.payload["opened_id"] == opened.id and cleared.payload["at"] == _at(T0 + 30.0).isoformat()
    lane.sample("h1", {}, [], real, now=T0 + 31.0)            # nothing is left to end
    assert len(audit.records(tenant="h1", limit=50)) == 2


def test_a_restart_does_not_seed_a_finding_that_ended_before_it():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    lane.sample("h1", {}, [], real, now=T0 + 61.0)            # unlinked: the finding ends
    again = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=InMemorySamples(), audit=audit, enabled=True)
    again.install("h1", Engine(), now=_at(T0 + 120.0))
    assert again.linked["h1"] == {} and again.close_open("h1", now=_at(T0 + 121.0)) == 0


def test_going_below_rules_closes_once_what_a_rules_run_left_open():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real, [CARD, BED2])
    lane.sample("h1", {**_vitals(), **_vitals(source="10.0.0.6")}, [CARD, BED2], real, now=T0)
    opened = audit.records(tenant="h1", event_type="shadow_alert", limit=50)
    assert len(opened) == 2
    below = ShadowLane(allowed=(), samples=InMemorySamples(), audit=audit, enabled=False)
    below.install("h1", Engine())                              # a no-op below `rules`
    assert below.close_open("h1", now=_at(T0 + 60.0)) == 2
    cleared = audit.records(tenant="h1", event_type="shadow_alert_cleared", limit=50)
    assert {(c.patient_id, c.payload["reason"], c.payload["opened_id"]) for c in cleared} == {
        (o.patient_id, "stage", o.id) for o in opened}
    assert below.close_open("h1", now=_at(T0 + 61.0)) == 0    # once
    assert below.engines == {} and below.state == "ok"


def test_close_open_on_a_running_lane_also_forgets_what_it_closed():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    assert lane.close_open("h1", now=_at(T0 + 5.0)) == 1
    assert [f["since"] for f in lane.findings("h1", "bed-1", real, now=_at(T0 + 5.0))["findings"]] == [None]
    lane.sample("h1", {}, [], real, now=T0 + 6.0)             # the unlink has nothing left to close
    assert _rows(audit) == [("shadow_alert", "news2", None), ("shadow_alert_cleared", "news2", "stage")]


def test_a_finding_that_changes_level_is_closed_and_reopened_and_its_since_restarts():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)                            # NEWS2 6: moderate
    now = T0 + 61.0
    worse = {"10.0.0.5": _view(_cell("hr", value=140, now=now), _cell("spo2", value=85, unit="%", now=now),
                               _cell("art_systolic", value=85, unit="mmHg", now=now))}
    lane.sample("h1", worse, [CARD], real, now=now)                                # + SBP 85: NEWS2 9, high
    rows = [r for r in audit.records(tenant="h1", limit=50) if r.subject == "news2"]
    assert [(r.event_type, r.payload.get("severity"), r.payload.get("reason")) for r in rows] == [
        ("shadow_alert", "moderate", None), ("shadow_alert_cleared", None, "level_changed"),
        ("shadow_alert", "high", None)]
    assert rows[1].payload["opened_id"] == rows[0].id
    [news2] = [f for f in lane.findings("h1", "bed-1", real, now=_at(now))["findings"] if f["kind"] == "news2"]
    assert news2["severity"] == "high" and news2["since"] == _at(now).isoformat()   # since this level


def test_recent_findings_pair_each_opening_with_its_clearing_newest_first():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real, [CARD, BED2])
    lane.sample("h1", {**_vitals(), **_vitals(source="10.0.0.6")}, [CARD, BED2], real, now=T0)
    lane.sample("h1", {}, [BED2], real, now=T0 + 61.0)        # bed-1's link ends
    rows = lane.recent_findings("h1", since=datetime.now(timezone.utc) - timedelta(days=7))
    assert [(r["patient_id"], r["kind"]) for r in rows] == [("bed-2", "news2"), ("bed-1", "news2")]
    first = audit.records(tenant="h1", event_type="shadow_alert", limit=5)[0]
    [cleared] = audit.records(tenant="h1", event_type="shadow_alert_cleared", limit=5)
    assert rows[0]["cleared_at"] is None
    # The opening row's payload, then the explicit keys; `at` once — the lane's clock at opening.
    assert rows[1] == {**first.payload, "patient_id": "bed-1", "kind": "news2", "opened_at": first.ts,
                       "cleared_at": cleared.ts}
    assert rows[1]["relation"] == "shadow_only" and rows[1]["at"] == DT0.isoformat()


def test_forget_closes_as_discharged_drops_the_link_and_the_clock_and_holds_the_number_out_for_the_grace():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    lane.forget("h1", "bed-1", now=_at(T0 + 1.0))
    assert "bed-1" not in lane.engines["h1"].patient_ids() and "bed-1" not in lane.linked["h1"]
    assert lane.sampler.due("bed-1", pick(_vitals()["10.0.0.5"], DEFAULT_PARAMETERS, now=T0)[0], now=T0 + 2.0, since=0.0)
    assert _rows(audit)[-1] == ("shadow_alert_cleared", "news2", "discharged")
    # The board's occupants are cached (10 s): a card may name the retired number for a moment.
    lane.sample("h1", {}, [CARD], real, now=T0 + 1.0 + RETIRED_GRACE_S - 1.0)
    assert "bed-1" not in lane.linked["h1"]
    lane.sample("h1", {}, [CARD], real, now=T0 + 1.0 + RETIRED_GRACE_S)          # the hold is over
    assert "bed-1" in lane.linked["h1"]
    assert len(audit.records(tenant="h1", limit=50)) == 2


def test_a_pass_without_cards_touches_nothing():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)

    def snapshot():
        links = {pid: (link.source, link.since, link.provisional) for pid, link in lane.linked["h1"].items()}
        return links, _rows(audit), len(lane.samples.since("h1", DT0 - timedelta(hours=1), now=_at(T0 + 120.0)))

    before = snapshot()
    # The device table is missing or invalid: no card at all is not "every link ended".
    assert lane.sample("h1", _vitals(T0 + 61.0), None, real, now=T0 + 61.0) == []
    assert snapshot() == before and lane.findings("h1", "bed-1", real, now=_at(T0 + 61.0)) is not None


def test_the_mirror_writes_finding_rows_for_a_linked_patient_only_with_their_relation():
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)                                         # bed-1 is linked, bed-2 is not
    for pid in ("bed-1", "bed-2"):
        for obs in (Observation(pid, SignalCode.HEART_RATE, 140, "bpm", DT0, "bridge"),
                    Observation(pid, SignalCode.SPO2, 85, "%", DT0, "bridge")):
            real.ingest(obs, now=DT0)                         # the door first, then the mirror (D1)
            lane.mirror_observation("h1", obs, now=DT0, real=real)
    rows = audit.records(tenant="h1", limit=50)
    assert [(r.event_type, r.patient_id, r.subject, r.payload["relation"]) for r in rows] == [
        ("shadow_alert", "bed-1", "news2", "same")]
    shadow = lane.engines["h1"]
    assert {a.kind for a in shadow.active_alerts("bed-2")} == {a.kind for a in real.active_alerts("bed-2")}


def test_the_mirror_reaches_the_shadow_engine_only_and_the_lane_is_a_no_op_below_rules():
    lane, real, _ = _lane()
    lane.install("h1", real)
    obs = Observation("bed-1", SignalCode.SPO2, 90, "%", DT0, "bridge")
    real.ingest(obs, now=DT0)
    lane.mirror_observation("h1", obs, now=DT0, real=real)
    assert lane.engines["h1"].state("bed-1").latest(SignalCode.SPO2).value == 90
    assert len(real.state("bed-1").history(SignalCode.SPO2)) == 1                 # not twice into the real one
    lane.mirror_profile("h1", PatientProfile("bed-1", baseline_sofa=2))
    assert lane.engines["h1"].profile("bed-1").baseline_sofa == 2 and real.profile("bed-1") is None
    off, real2, audit2 = _lane(stage_rules=False)
    off.install("h1", real2)
    off.mirror_observation("h1", obs, now=DT0, real=real2)
    off.mirror_profile("h1", PatientProfile("bed-1"))
    off.forget("h1", "bed-1", now=DT0)
    assert off.sample("h1", _vitals(), [CARD], real2, now=T0) == []
    assert off.findings("h1", "bed-1", real2, now=DT0) is None
    assert off.engines == {} and off.linked == {} and audit2.records(tenant="h1", limit=5) == []


class _FlakyAudit(InMemoryAuditLog):
    """Refuses the next `failures` rows of the kind `event_type`."""

    def __init__(self, event_type=SHADOW_CLEARED, failures=0):
        super().__init__()
        self.event_type, self.failures = event_type, failures

    def append(self, event):
        if self.failures and event.event_type == self.event_type:
            self.failures -= 1
            raise RuntimeError("audit: not reachable")
        return super().append(event)


def test_a_failed_adopt_is_retried_and_a_new_link_of_the_patient_waits_for_it(monkeypatch):
    lane, real, audit = _lane()
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)                  # HR 140 from the monitor, a finding open
    shadow = lane.engines["h1"]
    adopt, failures = shadow.adopt, [1, 1]

    def flaky(other, patient_id):
        if failures:
            failures.pop()
            raise RuntimeError("x")
        return adopt(other, patient_id)

    monkeypatch.setattr(shadow, "adopt", flaky)
    empty = {**CARD, "link": "none", "patient_id": None}
    assert lane.sample("h1", {}, [empty], real, now=T0 + 61.0) == []      # the link ended; its adopt failed
    assert "bed-1" not in lane.linked["h1"] and lane.findings("h1", "bed-1", real, now=_at(T0 + 61.0)) is None
    assert _rows(audit) == [("shadow_alert", "news2", None)] and lane.state == "error"
    # The monitor shows bed-1 again: the retry fails once more, and the new link waits for it.
    assert lane.sample("h1", _vitals(T0 + 122.0), [CARD], real, now=T0 + 122.0) == []
    assert "bed-1" not in lane.linked["h1"]
    # The next pass: back to the real picture and closed `unlinked` first, then linked again from now.
    assert lane.sample("h1", _vitals(T0 + 183.0), [CARD], real, now=T0 + 183.0) == ["bed-1"]
    assert lane.linked["h1"]["bed-1"].since == T0 + 183.0
    found = lane.findings("h1", "bed-1", real, now=_at(T0 + 183.0))
    assert found["vitals"] == {} and found["findings"] == []            # not the old link's HR 140
    assert _rows(audit) == [("shadow_alert", "news2", None), ("shadow_alert_cleared", "news2", "unlinked")]


def test_a_discharge_whose_closing_row_fails_is_closed_as_discharged_by_the_next_pass():
    audit = _FlakyAudit()
    lane, real, _ = _lane(audit=audit)
    lane.install("h1", real)
    _link(lane, real)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)
    audit.failures = 1
    assert lane.guard("forget", lambda: lane.forget("h1", "bed-1", now=_at(T0 + 1.0))) is None
    assert lane.state == "error" and "bed-1" not in lane.engines["h1"].patient_ids()
    assert _rows(audit) == [("shadow_alert", "news2", None)]
    assert lane.sample("h1", {}, [], real, now=T0 + 2.0) == ["bed-1"]
    assert _rows(audit) == [("shadow_alert", "news2", None), ("shadow_alert_cleared", "news2", "discharged")]
    lane.sample("h1", {}, [], real, now=T0 + 3.0)                         # once
    assert len(_rows(audit)) == 2
    # At start-up too: a discharged patient's finding whose closing row fails closes `discharged` next pass.
    first, real1, _ = _lane(audit=_FlakyAudit())
    first.install("h1", real1)
    _link(first, real1)
    first.sample("h1", _vitals(), [CARD], real1, now=T0)
    first.audit.failures = 1
    again = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=first.samples, audit=first.audit, enabled=True)
    again.install("h1", Engine(), now=_at(T0 + 30.0), admitted=lambda pid: pid != "bed-1")
    assert "h1" in again.engines and "bed-1" not in again.linked["h1"] and again.state == "error"
    assert _rows(first.audit) == [("shadow_alert", "news2", None)]
    assert again.sample("h1", {}, [], Engine(), now=T0 + 31.0) == ["bed-1"]
    assert _rows(first.audit) == [("shadow_alert", "news2", None), ("shadow_alert_cleared", "news2", "discharged")]


def test_confirming_a_provisional_link_returns_the_patient_though_no_sample_was_taken():
    lane, real, _ = _restarted()
    assert lane.findings("h1", "bed-1", real, now=_at(T0 + 31.0)) is None
    assert lane.sample("h1", {}, [CARD], real, now=T0 + 31.0) == ["bed-1"]           # None -> a picture
    assert lane.findings("h1", "bed-1", real, now=_at(T0 + 31.0)) is not None
    assert lane.sample("h1", {}, [CARD], real, now=T0 + 32.0) == []                  # nothing changed since


def test_a_patient_moved_to_another_monitor_takes_nothing_it_showed_before_the_move():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real, at=T0 - 100.0)
    lane.sample("h1", _vitals(), [CARD], real, now=T0)                               # HR 140 on 10.0.0.5
    now = T0 + 61.0
    moved = {**CARD, "source": "10.0.0.6"}
    other = {"10.0.0.6": _view(_cell("hr", value=70, now=now), _nbp(sys=95, mean=65, measured_age=600.0, now=now),
                               source="10.0.0.6")}
    assert lane.sample("h1", other, [moved], real, now=now) == ["bed-1"]             # the move, republished
    link = lane.linked["h1"]["bed-1"]
    assert link.source == "10.0.0.6" and link.since == now and not link.provisional
    state = lane.engines["h1"].state("bed-1")
    assert state.latest(SignalCode.SBP) is None                      # the new monitor's 10-minute-old cuff: refused
    assert state.latest(SignalCode.HEART_RATE).source_device == "infinity:10.0.0.5:hr"   # its own samples kept
    later = now + 61.0
    newer = {"10.0.0.6": _view(_cell("hr", value=72, now=later), _nbp(sys=95, mean=65, measured_age=30.0, now=later),
                               source="10.0.0.6")}
    assert lane.sample("h1", newer, [moved], real, now=later) == ["bed-1"]
    assert state.latest(SignalCode.SBP).source_device == "infinity:10.0.0.6:nbp"
    assert state.latest(SignalCode.HEART_RATE).value == 72


def test_a_mirror_for_a_provisional_link_feeds_the_shadow_engine_and_writes_no_row():
    lane, real, audit = _restarted()
    before = _rows(audit)
    at = _at(T0 + 20.0)
    obs = Observation("bed-1", SignalCode.SBP, 85, "mmHg", at, "bridge")   # with HR 140 and SpO2 85: NEWS2 high
    real.ingest(obs, now=at)
    lane.mirror_observation("h1", obs, now=at, real=real)
    shadow = lane.engines["h1"]
    assert shadow.state("bed-1").latest(SignalCode.SBP).value == 85
    assert "high" in {a.severity for a in shadow.active_alerts("bed-1")}   # a confirmed link would write rows
    assert _rows(audit) == before


def test_heart_rate_flipping_between_hr_and_pls_is_still_one_sample_a_minute():
    lane, real, _ = _lane()
    lane.install("h1", real)
    _link(lane, real)
    for step in range(30):                                    # a body every 7 s; HR is *** every other one
        now = T0 + 7.0 * step
        view = _view(_cell("hr", state="value" if step % 2 == 0 else "invalid", value=88, now=now),
                     _cell("pls", value=90, now=now))
        lane.sample("h1", {"10.0.0.5": view}, [CARD], real, now=now)
    rows = [s for s in lane.samples.since("h1", _at(T0 - 60.0), now=_at(T0 + 600.0)) if s.code == "heart_rate"]
    assert [(s.via, s.received_at.timestamp() - T0) for s in rows] == [
        ("hr", 0.0), ("pls", 63.0), ("hr", 126.0), ("pls", 189.0)]


def test_the_lane_clock_times_a_discharge_hold_a_restart_and_a_closing():
    clock = _Clock(T0 - 10.0)
    lane, real, audit = _lane(clock=clock)
    lane.install("h1", real)                                  # `now` from the lane clock
    _link(lane, real, at=clock.t)
    clock.t = T0
    lane.sample("h1", _vitals(), [CARD], real, now=clock.t)
    clock.t = T0 + 1.0
    lane.forget("h1", "bed-1")                                # no `now`: retired at the lane clock
    [cleared] = audit.records(tenant="h1", event_type=SHADOW_CLEARED, limit=5)
    assert cleared.payload["reason"] == "discharged" and cleared.payload["at"] == _at(T0 + 1.0).isoformat()
    lane.sample("h1", {}, [CARD], real, now=T0 + 1.0 + RETIRED_GRACE_S - 1.0)
    assert "bed-1" not in lane.linked["h1"]
    lane.sample("h1", {}, [CARD], real, now=T0 + 1.0 + RETIRED_GRACE_S)
    assert "bed-1" in lane.linked["h1"]
    # A restart with no `now` replays the 24 h before the LANE clock — here T0 + 30, not the wall clock.
    again = ShadowLane(allowed=DEFAULT_PARAMETERS, samples=lane.samples, audit=InMemoryAuditLog(), enabled=True,
                       clock=_Clock(T0 + 30.0))
    again.install("h1", Engine())
    assert again.engines["h1"].state("bed-1").latest(SignalCode.HEART_RATE).value == 140
    assert again.linked["h1"]["bed-1"].provisional and again.linked["h1"]["bed-1"].since == T0 - 2.0
    # And `close_open` with no `now` closes at the lane clock.
    third, real3, audit3 = _lane(clock=_Clock(T0 + 50.0))
    third.install("h1", real3)
    _link(third, real3)
    third.sample("h1", _vitals(), [CARD], real3, now=T0)
    assert third.close_open("h1") == 1
    assert audit3.records(tenant="h1", event_type=SHADOW_CLEARED, limit=5)[0].payload["at"] == _at(T0 + 50.0).isoformat()


def test_findings_show_a_confirmed_link_only():
    lane, real, _ = _restarted()                              # bed-1's link is provisional; bed-2 has none
    assert lane.findings("h1", "bed-1", real, now=_at(T0 + 30.0)) is None
    assert lane.findings("h1", "bed-2", real, now=_at(T0 + 30.0)) is None
    lane.sample("h1", {}, [CARD], real, now=T0 + 31.0)        # confirmed
    assert lane.findings("h1", "bed-1", real, now=_at(T0 + 31.0)) is not None
    assert lane.findings("h1", "bed-2", real, now=_at(T0 + 31.0)) is None


def test_at_the_read_cap_an_opening_cleared_before_the_newest_clears_still_reads_closed(monkeypatch):
    monkeypatch.setattr("homunculus.api.infinity_rules._AUDIT_READ_MAX", 2)
    audit = InMemoryAuditLog()

    def opening(pid):
        return audit.append(AuditEvent("h1", SHADOW_ALERT, pid, "news2", {"severity": "moderate"}))

    def clearing(rec):
        audit.append(AuditEvent("h1", SHADOW_CLEARED, rec.patient_id, "news2", {"reason": "ended", "opened_id": rec.id}))

    a, b, c = opening("bed-a"), opening("bed-b"), opening("bed-c")
    clearing(c)
    opening("bed-d")
    clearing(a)
    clearing(b)
    # The newest two openings are bed-c's and bed-d's; the newest two clearings, bed-a's and bed-b's.
    lane, real, _ = _lane(audit=audit)
    lane.install("h1", real, now=DT0)
    assert set(lane.linked["h1"]) == {"bed-d"}                # bed-c's clearing is read too
