"""G3-01 (D10, D12, X5): the trail helpers the withdrawal and the restart stand on — one patient's rows of
the asked kinds a page at a time, the `chart` rows a `chart_retract` row withdrew, a patient rebuilt from the
trail without them (engine only), the restart's skip, and a reading removed from a state. Synthetic values."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import sync_alerts
from homunculus.api.audit import AuditEvent, InMemoryAuditLog, iter_records_of
from homunculus.api.clinical import CHARTABLE, RETRACT
from homunculus.api.rehydrate import REBUILD_EVENTS, rebuild_patient, rehydrate, retracted_entries
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.timeline import PatientState

T0 = datetime.now(timezone.utc) - timedelta(minutes=30)
H = "h1"
#: Far enough back that a reading three hours on is still in the past, as a restart replays it.
EARLY = datetime.now(timezone.utc) - timedelta(hours=4)
ESCALATE = timedelta(minutes=5)          # the API's default `escalate_after`
_SHOCK = [("suspected_infection", 1), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000), ("map", 60),
          ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def _charted(log, pid, code, value, at, by="hem.ayse"):
    return log.append(AuditEvent(H, "chart", pid, code, {
        "value": value, "unit": CHARTABLE[SignalCode(code)], "obs_ts": at.isoformat(), "charted_by": by}))


def _withdrawn(log, pid, row, reason="yazım hatası — 89 değil 98"):
    return log.append(AuditEvent(H, RETRACT, pid, row.subject, {
        "entry": row.id, "value": row.payload["value"], "obs_ts": row.payload["obs_ts"],
        "reason": reason, "retracted_by": "hem.ayse"}))


def _picture(engine: Engine, pid: str):
    """What a rebuilt patient must equal: every series, the alerts of the last evaluation, the antibiotic
    anchor and the profile."""
    if pid not in engine.patient_ids():
        return None
    state = engine.state(pid)
    series = {code.value: [(o.timestamp, o.value, o.source_device) for o in state.history(code)]
              for code in SignalCode if state.history(code)}
    return (series, sorted(a.kind for a in engine.active_alerts(pid)), engine.recognized_at(pid),
            engine.profile(pid))


def _door(engine, store, log, pid, code, value, at):
    """One entry charted in the order `clinical.chart_observations` keeps — the evaluation, the lifecycle
    hook, the `chart` row, then a first-seen stamp and its row for every firing kind — at `at` as the
    request's wall clock. The `chart` row is returned."""
    obs = Observation(pid, SignalCode(code), float(value), CHARTABLE[SignalCode(code)], at, "clinician")
    engine.ingest(obs, now=min(obs.timestamp, at))
    sync_alerts(engine, store, pid, at)
    row = log.append(AuditEvent(H, "chart", pid, code, {
        "value": obs.value, "unit": obs.unit, "obs_ts": at.isoformat(), "charted_by": "hem.ayse"}))
    for a in engine.active_alerts(pid):
        if store.stamp_first_seen(pid, a.kind, at, chain_gap=ESCALATE):
            log.append(AuditEvent(H, "first_seen", pid, a.kind, {"at": at.isoformat()}))
    return row


def _withdraw_live(engine, store, log, pid, row, at):
    """A «hatalı giriş» in the order X4 fixes: the patient rebuilt into a scratch engine without every
    withdrawn row, the `chart_retract` row, the scratch patient adopted, then the lifecycle hook once."""
    skip = retracted_entries(log.records(tenant=H, limit=1000)) | {row.id}
    scratch = Engine()
    rebuild_patient(scratch, pid, log.records(tenant=H, patient_id=pid, limit=1000), skip=frozenset(skip))
    _withdrawn(log, pid, row)
    engine.adopt(scratch, pid)
    sync_alerts(engine, store, pid, at)


def _restart(log):
    """A restart as the API runs it: the withdrawn entries read first, then every row replayed without them."""
    rows = log.records(tenant=H, limit=1000)
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, rows, skip=retracted_entries(rows))
    return engine, store


def _keys(mapping, pid):
    return sorted(kind for (p, kind) in mapping if p == pid)


class TestIterRecordsOf:
    def test_it_pages_one_patients_rows_of_the_asked_kinds_oldest_first(self):
        log = InMemoryAuditLog()
        mine = [_charted(log, "bed-3", "heart_rate", 80 + n, T0 + timedelta(minutes=n)) for n in range(5)]
        _charted(log, "bed-4", "heart_rate", 99, T0)
        log.append(AuditEvent(H, "alert", "bed-3", "news2", {}))
        got = list(iter_records_of(log, tenant=H, patient_id="bed-3", event_types={"chart"}, page=2))
        assert [r.id for r in got] == [r.id for r in mine]

    def test_without_a_patient_it_reads_the_kind_across_the_tenant(self):
        log = InMemoryAuditLog()
        a = _charted(log, "bed-3", "spo2", 95, T0)
        b = _charted(log, "bed-4", "spo2", 96, T0)
        assert [r.id for r in iter_records_of(log, tenant=H, event_types={"chart"}, page=1)] == [a.id, b.id]

    def test_a_page_below_one_is_refused(self):
        with pytest.raises(ValueError):
            list(iter_records_of(InMemoryAuditLog(), tenant=H, event_types={"chart"}, page=0))

    def test_a_page_size_multiple_with_other_kinds_and_a_bed_30_between_reads_each_match_once(self):
        log = InMemoryAuditLog()
        mine = []
        for n in range(4):
            mine.append(_charted(log, "bed-3", "spo2", 90 + n, T0 + timedelta(minutes=n)))
            log.append(AuditEvent(H, "first_seen", "bed-3", "news2", {"at": T0.isoformat()}))
            _charted(log, "bed-30", "spo2", 80 + n, T0 + timedelta(minutes=n))
        got = list(iter_records_of(log, tenant=H, patient_id="bed-3", event_types={"chart"}, page=2))
        assert [r.id for r in got] == [r.id for r in mine]

    def test_a_bare_string_of_kinds_is_refused(self):
        # "chart" read as a collection is the set of its letters, which matches no row: an empty answer
        # that looks like "no rows" would hide the caller's mistake.
        with pytest.raises(TypeError):
            list(iter_records_of(InMemoryAuditLog(), tenant=H, event_types="chart", page=10))


class TestRetractedEntries:
    def test_it_collects_the_withdrawn_chart_rows(self):
        log = InMemoryAuditLog()
        wrong = _charted(log, "bed-3", "spo2", 89, T0)
        _charted(log, "bed-3", "spo2", 98, T0 + timedelta(minutes=1))
        _withdrawn(log, "bed-3", wrong)
        assert retracted_entries(log.records(tenant=H, limit=100)) == {wrong.id}

    def test_a_payload_without_an_integer_entry_withdraws_nothing(self):
        log = InMemoryAuditLog()
        for payload in ({"entry": "7"}, {"entry": True}, {"entry": None}, {}):
            log.append(AuditEvent(H, RETRACT, "bed-3", "spo2", payload))
        assert retracted_entries(log.records(tenant=H, limit=100)) == frozenset()


class TestRebuildPatient:
    def test_it_is_the_state_of_never_having_charted_the_withdrawn_row(self):
        log, clean = InMemoryAuditLog(), InMemoryAuditLog()
        rows = [("spo2", 91, 0), ("resp_rate", 26, 1), ("sbp", 88, 2)]
        written = [_charted(log, "bed-3", code, value, T0 + timedelta(minutes=m)) for code, value, m in rows]
        for code, value, m in rows:
            if code != "resp_rate":
                _charted(clean, "bed-3", code, value, T0 + timedelta(minutes=m))
        rebuilt = Engine()
        rebuild_patient(rebuilt, "bed-3", log.records(tenant=H, limit=100), skip=frozenset({written[1].id}))
        never = Engine()
        rehydrate(never, AckStore(), clean.records(tenant=H, limit=100))
        assert _picture(rebuilt, "bed-3") == _picture(never, "bed-3")

    def test_it_drops_what_the_engine_held_for_the_patient_first(self):
        engine = Engine()
        engine.ingest(Observation("bed-3", SignalCode.HEART_RATE, 150, "/min", T0, "clinician"), now=T0)
        rebuild_patient(engine, "bed-3", [], skip=frozenset())
        assert "bed-3" not in engine.patient_ids()

    def test_another_patients_rows_are_not_read_into_it(self):
        log = InMemoryAuditLog()
        _charted(log, "bed-4", "heart_rate", 99, T0)
        _charted(log, "bed-3", "heart_rate", 80, T0)
        engine = Engine()
        rebuild_patient(engine, "bed-3", log.records(tenant=H, limit=100), skip=frozenset())
        assert engine.patient_ids() == ["bed-3"]

    def test_a_profile_row_is_replayed(self):
        log = InMemoryAuditLog()
        _charted(log, "bed-3", "heart_rate", 80, T0)
        log.append(AuditEvent(H, "profile", "bed-3", "", {"comorbidities": ["copd"], "charted_by": "dr.elif"}))
        engine = Engine()
        rebuild_patient(engine, "bed-3", log.records(tenant=H, limit=100), skip=frozenset())
        assert "copd" in engine.profile("bed-3").comorbidities

    def test_the_rebuild_reads_only_the_engines_kinds(self):
        assert REBUILD_EVENTS == {"ingest", "chart", "profile"}

    def test_it_is_the_patient_the_restart_replays(self):
        log = InMemoryAuditLog()
        for code, value in _SHOCK:
            _charted(log, "bed-3", code, value, T0)
            _charted(log, "bed-4", "heart_rate", 70, T0)
        log.append(AuditEvent(H, "ingest", "bed-3", "heart_rate", {
            "value": 118, "unit": "/min", "obs_ts": (T0 + timedelta(minutes=1)).isoformat(), "device": "mon-7"}))
        log.append(AuditEvent(H, "profile", "bed-3", "", {"comorbidities": ["copd"], "charted_by": "dr.elif"}))
        wrong = _charted(log, "bed-3", "lactate", 1.5, T0 + timedelta(minutes=2))
        _withdrawn(log, "bed-3", wrong)
        rows = log.records(tenant=H, limit=1000)
        skip = retracted_entries(rows)
        restarted = Engine()
        rehydrate(restarted, AckStore(), rows, skip=skip)
        rebuilt = Engine()
        rebuild_patient(rebuilt, "bed-3", rows, skip=skip)
        assert _picture(rebuilt, "bed-3") == _picture(restarted, "bed-3")
        assert "septic_shock" in _picture(rebuilt, "bed-3")[1]


class TestRehydrateSkips:
    def test_a_withdrawn_chart_row_is_not_replayed(self):
        log = InMemoryAuditLog()
        wrong = _charted(log, "bed-3", "resp_rate", 26, T0)
        _charted(log, "bed-3", "spo2", 95, T0 + timedelta(minutes=1))
        _withdrawn(log, "bed-3", wrong)
        engine = Engine()
        rehydrate(engine, AckStore(), log.records(tenant=H, limit=100), skip=frozenset({wrong.id}))
        assert engine.state("bed-3").latest(SignalCode.RESP_RATE) is None
        assert engine.state("bed-3").latest(SignalCode.SPO2).value == 95

    def test_a_withdrawn_value_that_ended_a_critical_leaves_no_latch_after_a_restart(self):
        # A wrong lactate 1.5 (for 4.5) ends an unacknowledged septic shock, which latches. Withdrawn, the
        # shock fires again and the latch goes. The restart skips the row, and with it the row's hook: the
        # shock is firing and nothing is latched, as live. Replayed with the row, the latch would return.
        engine, store, log = Engine(), AckStore(), InMemoryAuditLog()
        for code, value in _SHOCK:
            _door(engine, store, log, "bed-3", code, value, EARLY)
        wrong = _door(engine, store, log, "bed-3", "lactate", 1.5, EARLY + timedelta(minutes=1))
        assert _keys(store.resolved, "bed-3") == ["septic_shock"]
        _withdraw_live(engine, store, log, "bed-3", wrong, EARLY + timedelta(minutes=2))
        _, restarted = _restart(log)
        assert "septic_shock" in _keys(restarted.firing, "bed-3")
        assert _keys(restarted.resolved, "bed-3") == _keys(store.resolved, "bed-3") == []
        unskipped = AckStore()
        rehydrate(Engine(), unskipped, log.records(tenant=H, limit=1000))
        assert _keys(unskipped.resolved, "bed-3") == ["septic_shock"]


class TestRestartEqualsTheLiveRebuild:
    """D12: after a withdrawal, a restart holds what the live rebuild left — the stamps included."""

    def _wrong_map_withdrawn(self):
        # Suspected infection and platelets 140 score one SOFA point; a wrong MAP 60 (for 80) adds the second:
        # sepsis and its antibiotic clock fire, and both are stamped. Withdrawn, both end and the hook prunes
        # their stamps.
        engine, store, log = Engine(), AckStore(), InMemoryAuditLog()
        _door(engine, store, log, "bed-3", "suspected_infection", 1, EARLY)
        _door(engine, store, log, "bed-3", "platelets", 140, EARLY)
        wrong = _door(engine, store, log, "bed-3", "map", 60, EARLY + timedelta(minutes=1))
        assert _keys(store.first_seen, "bed-3") == ["antibiotic_due", "sepsis"]
        _withdraw_live(engine, store, log, "bed-3", wrong, EARLY + timedelta(minutes=2))
        return store, log

    def test_a_stamp_only_the_withdrawn_value_raised_does_not_survive_a_restart(self):
        live, log = self._wrong_map_withdrawn()
        assert _keys(live.first_seen, "bed-3") == _keys(live.clock_from, "bed-3") == []
        restarted_engine, restarted = _restart(log)
        assert restarted_engine.active_alerts("bed-3") == []
        assert _keys(restarted.first_seen, "bed-3") == []
        assert _keys(restarted.clock_from, "bed-3") == []

    def test_the_next_real_reading_after_the_restart_starts_its_own_clock(self):
        _, log = self._wrong_map_withdrawn()
        engine, store = _restart(log)
        later = EARLY + timedelta(hours=3)
        _door(engine, store, log, "bed-3", "map", 60, later)
        assert {k: store.first_seen[("bed-3", k)] for k in ("sepsis", "antibiotic_due")} == {
            "sepsis": later, "antibiotic_due": later}
        assert store.clock_from[("bed-3", "sepsis")] == later


class TestPatientStateRemove:
    def test_it_removes_one_equal_reading(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.HEART_RATE, 150, "/min", T0, "clinician")
        state.ingest(obs)
        state.ingest(Observation("bed-3", SignalCode.HEART_RATE, 80, "/min", T0 + timedelta(minutes=1), "clinician"))
        assert state.remove(obs) is True
        assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [80]

    def test_of_two_identical_readings_it_removes_exactly_one(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")
        state.ingest(obs)
        state.ingest(Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician"))
        assert state.remove(obs) is True
        assert state.history(SignalCode.SPO2) == [obs]

    def test_a_reading_it_does_not_hold_is_a_false(self):
        state = PatientState("bed-3")
        assert state.remove(Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")) is False

    def test_the_last_reading_of_a_code_leaves_no_series(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")
        state.ingest(obs)
        state.remove(obs)
        assert state.latest(SignalCode.SPO2) is None
