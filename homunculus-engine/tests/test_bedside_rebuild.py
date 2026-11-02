"""G3-01 (D10, D12, X5): the trail helpers the withdrawal and the restart stand on — one patient's rows of
the asked kinds a page at a time, the `chart` rows a `chart_retract` row withdrew, a patient rebuilt from the
trail without them (engine only), the restart's skip, and a reading removed from a state. Synthetic values."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, InMemoryAuditLog, iter_records_of
from homunculus.api.clinical import CHARTABLE, RETRACT
from homunculus.api.rehydrate import REBUILD_EVENTS, rebuild_patient, rehydrate, retracted_entries
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.state.timeline import PatientState

T0 = datetime.now(timezone.utc) - timedelta(minutes=30)
H = "h1"


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


class TestPatientStateRemove:
    def test_it_removes_one_equal_reading(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.HEART_RATE, 150, "/min", T0, "clinician")
        state.ingest(obs)
        state.ingest(Observation("bed-3", SignalCode.HEART_RATE, 80, "/min", T0 + timedelta(minutes=1), "clinician"))
        assert state.remove(obs) is True
        assert [o.value for o in state.history(SignalCode.HEART_RATE)] == [80]

    def test_a_reading_it_does_not_hold_is_a_false(self):
        state = PatientState("bed-3")
        assert state.remove(Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")) is False

    def test_the_last_reading_of_a_code_leaves_no_series(self):
        state = PatientState("bed-3")
        obs = Observation("bed-3", SignalCode.SPO2, 95, "%", T0, "clinician")
        state.ingest(obs)
        state.remove(obs)
        assert state.latest(SignalCode.SPO2) is None
