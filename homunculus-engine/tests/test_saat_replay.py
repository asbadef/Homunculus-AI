# homunculus-engine/tests/test_saat_replay.py
"""G3-06 «Saat geri gitmez» on replay (spec D3, D4, D6): the instants the restart and the withdrawal's rebuild
hand the engine. An ordinary row asks for min(its stamp, its write time); a LINKED row (its `ingest` payload names
the `reading` it was linked from) is judged at its write time and anchored at min(its stamp, its write time); a
`chart_retract` row re-judges its patient at its write time; and no instant is later than the
restart's clock plus REPLAY_SKEW — a row written while the server's clock ran ahead, or one whose write time cannot
be read, never puts a patient's floor in the future. The lifecycle hook still runs at the row's own write time.
Rows are built by hand so each write time is exact. Synthetic values only."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import homunculus.api.rehydrate as rehydrate_module
from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, AuditRecord, iter_records
from homunculus.api.clinical import BEDSIDE_SKEW, RETRACT
from homunculus.api.rehydrate import REPLAY_SKEW, rebuild_patient, rehydrate, retracted_entries
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from tests.conftest import requires_db
from tests.test_bedside_trail_stores import pg_log  # noqa: F401 — the Postgres audit, migrations 0004 and 0008

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)      # the restart's clock
PID = "bed-3"


def _row(id_, kind, code, value, stamp, ts, patient=PID, **extra) -> AuditRecord:
    """An `ingest` or `chart` row as the doors write it, with its write time `ts` (a datetime, or text as read)."""
    payload = {"value": value, "unit": "u", "obs_ts": stamp.isoformat(), **extra}
    if kind == "ingest":
        payload.setdefault("device", "POC-7")
    else:
        payload["charted_by"] = "hem.ayse"
    return AuditRecord(id=id_, ts=ts.isoformat() if isinstance(ts, datetime) else ts, tenant="h1",
                       event_type=kind, patient_id=patient, subject=code, payload=payload)


def _linked_sepsis(written):
    """Suspected infection charted 7 h before the restart; then a set measured 6 h before it — MAP 60 and platelets
    120, two SOFA points — linked from the unmatched list and written at `written`."""
    stamp = NOW - timedelta(hours=6)
    charted = NOW - timedelta(hours=7)
    return [_row(1, "chart", "suspected_infection", 1.0, charted, charted),
            _row(2, "ingest", "map", 60.0, stamp, written, reading=11),
            _row(3, "ingest", "platelets", 120.0, stamp, written, reading=12)], stamp


def _summary(engine, kind):
    return next(a.summary for a in engine.active_alerts(PID) if a.kind == kind)


def _hooks(monkeypatch):
    """The instants the replay hands the lifecycle hook, per patient, in order — the real hook still runs."""
    seen = []
    real = rehydrate_module.sync_alerts

    def spy(engine, store, patient_id, now):
        seen.append((patient_id, now))
        return real(engine, store, patient_id, now)
    monkeypatch.setattr(rehydrate_module, "sync_alerts", spy)
    return seen


def test_the_replays_skew_is_the_bedside_doors():
    assert REPLAY_SKEW == BEDSIDE_SKEW == timedelta(minutes=2)


class TestALinkedRow:
    def test_it_is_judged_at_its_write_time_and_anchored_at_its_stamp(self):
        written = NOW - timedelta(minutes=10)
        rows, stamp = _linked_sepsis(written)
        engine = Engine()
        rehydrate(engine, AckStore(), rows, now=NOW)
        assert engine.recognized_at(PID) == stamp
        assert engine._judged_at[PID] == written
        assert _summary(engine, "antibiotic_overdue") == "Antibiotic OVERDUE by 290 min"

    def test_one_written_past_the_restart_is_judged_no_later_than_the_ceiling(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        written = NOW + timedelta(hours=1)
        rows, stamp = _linked_sepsis(written)
        engine = Engine()
        rehydrate(engine, AckStore(), rows, now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert engine.recognized_at(PID) == stamp
        assert hooks[-1] == (PID, written), "the hook still runs at the row's own write time"

    def test_the_rebuild_replays_it_the_same_way(self):
        written = NOW - timedelta(minutes=10)
        rows, stamp = _linked_sepsis(written)
        engine = Engine()
        rebuild_patient(engine, PID, rows, skip=frozenset(), now=NOW)
        assert (engine.recognized_at(PID), engine._judged_at[PID]) == (stamp, written)


class TestAnOrdinaryRow:
    def test_it_asks_for_the_earlier_of_its_stamp_and_its_write_time(self):
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, NOW - timedelta(minutes=30),
                                            NOW - timedelta(minutes=20))], now=NOW)
        assert engine._judged_at[PID] == NOW - timedelta(minutes=30)


class TestTheFloorNeverGoesPastTheCeiling:
    """D6: the two ways a replayed instant can lie past the restart."""

    def test_a_row_whose_write_time_cannot_be_read_falls_back_to_a_future_stamp_and_is_capped(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, ahead, "not a time")], now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert hooks == [(PID, ahead)], "the hook's instant is the row's (its stamp, as `_written_at` reads it)"

    def test_a_row_written_while_the_servers_clock_ran_ahead_is_capped(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, ahead, ahead)], now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert hooks == [(PID, ahead)]

    def test_a_later_reading_is_judged_at_its_own_time_not_hours_ahead(self):
        # The harm the cap prevents: one row two hours ahead, then a reading measured now. Uncapped, the second was
        # judged two hours ahead — every vital stale, the antibiotic clock two hours on.
        ahead = NOW + timedelta(hours=2)
        engine = Engine()
        rehydrate(engine, AckStore(), [_row(1, "ingest", "heart_rate", 80.0, ahead, ahead),
                                       _row(2, "ingest", "resp_rate", 26.0, NOW, NOW)], now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert [a.kind for a in engine.active_alerts(PID)] == ["news2"], "RR 26 is fresh two minutes on"

    def test_the_rebuild_is_capped_at_its_callers_clock(self):
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rebuild_patient(engine, PID, [_row(1, "ingest", "heart_rate", 80.0, ahead, ahead)], skip=frozenset(),
                        now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW


def _withdrawal(id_, entry, ts, patient=PID) -> AuditRecord:
    """A `chart_retract` row as «hatalı giriş» writes it (G3-01 D10), withdrawing row `entry`, written at `ts`."""
    return AuditRecord(id=id_, ts=ts.isoformat() if isinstance(ts, datetime) else ts, tenant="h1",
                       event_type=RETRACT, patient_id=patient, subject="temperature",
                       payload={"entry": entry, "code": "temperature", "value": 37.0, "obs_ts": NOW.isoformat(),
                                "reason": "yanlış hastaya girilmiş", "retracted_by": "hem.ayse"})


def _overdue_trail(withdrawn_at):
    """Infection, platelets 120 and a MAP of 60 charted at -90 min — sepsis, the hour from -90 — then a temperature
    at -5 min that finds it overdue, withdrawn at `withdrawn_at`."""
    then, late = NOW - timedelta(minutes=90), NOW - timedelta(minutes=5)
    return [_row(1, "chart", "suspected_infection", 1.0, then, then),
            _row(2, "chart", "platelets", 120.0, then, then),
            _row(3, "chart", "map", 60.0, then, then),
            _row(4, "chart", "temperature", 37.0, late, late),
            _withdrawal(5, 4, withdrawn_at)]


class TestAWithdrawalRow:
    """D3: a `chart_retract` row re-judges its patient at the row's write time — capped at the ceiling — and runs
    the hook there; the withdrawn row itself is skipped as before."""

    def test_the_restart_rejudges_there_and_runs_the_hook_there(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        rows = _overdue_trail(NOW - timedelta(minutes=1))
        engine, store = Engine(), AckStore()
        rehydrate(engine, store, rows, skip=frozenset({4}), now=NOW)
        assert engine.state(PID).latest(SignalCode.TEMPERATURE) is None
        assert engine._judged_at[PID] == NOW - timedelta(minutes=1)
        assert _summary(engine, "antibiotic_overdue") == "Antibiotic OVERDUE by 29 min"
        assert (PID, "antibiotic_overdue") in store.firing and (PID, "antibiotic_due") not in store.firing
        assert hooks[-1] == (PID, NOW - timedelta(minutes=1))

    def test_a_row_whose_time_cannot_be_read_is_passed_over(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        rows = _overdue_trail("not a time")
        engine, store = Engine(), AckStore()
        rehydrate(engine, store, rows, skip=frozenset({4}), now=NOW)
        assert engine.state(PID).latest(SignalCode.TEMPERATURE) is None, "the withdrawal still applies"
        assert engine._judged_at[PID] == NOW - timedelta(minutes=90)
        assert _summary(engine, "antibiotic_due") == "Antibiotic window: 60 min remaining"
        assert len(hooks) == 3, "no hook for the unreadable row"

    def test_a_row_written_past_the_restart_rejudges_at_the_ceiling(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        ahead = NOW + timedelta(hours=1)
        engine = Engine()
        rehydrate(engine, AckStore(), _overdue_trail(ahead), skip=frozenset({4}), now=NOW)
        assert engine._judged_at[PID] == NOW + REPLAY_SKEW
        assert hooks[-1] == (PID, ahead), "the hook's instant is the row's own"

    def test_a_withdrawal_for_a_patient_the_engine_does_not_hold_creates_nothing(self, monkeypatch):
        hooks = _hooks(monkeypatch)
        engine = Engine()
        rehydrate(engine, AckStore(), [_withdrawal(1, 99, NOW, patient="bed-9")], now=NOW)
        assert engine.patient_ids() == [] and hooks == []

    def test_the_rebuild_rejudges_at_an_earlier_withdrawal_as_the_restart_does(self):
        rows = _overdue_trail(NOW - timedelta(minutes=1))
        rebuilt, restarted = Engine(), Engine()
        rebuild_patient(rebuilt, PID, rows, skip=frozenset({4}), now=NOW)
        rehydrate(restarted, AckStore(), rows, skip=frozenset({4}), now=NOW)
        assert rebuilt._judged_at[PID] == restarted._judged_at[PID] == NOW - timedelta(minutes=1)
        assert [a.summary for a in rebuilt.active_alerts(PID)] == [a.summary for a in restarted.active_alerts(PID)]
        assert "antibiotic_overdue" in {a.kind for a in rebuilt.active_alerts(PID)}


@requires_db
def test_a_postgres_trail_is_rejudged_at_its_withdrawal_row(pg_log):  # noqa: F811 — the fixture
    """The Postgres audit keeps `ts` as TEXT (migration 0004): the replay reads the withdrawal row's write time from
    it and re-judges there, as on the in-memory log."""
    now = datetime.now(timezone.utc)
    then, late = now - timedelta(minutes=90), now - timedelta(minutes=5)
    for code, value, at in [("suspected_infection", 1.0, then), ("platelets", 120.0, then), ("map", 60.0, then),
                            ("temperature", 37.0, late)]:
        last = pg_log.append(AuditEvent("h1", "chart", PID, code, {
            "value": value, "unit": "u", "obs_ts": at.isoformat(), "charted_by": "hem.ayse"}))
    withdrawal = pg_log.append(AuditEvent("h1", RETRACT, PID, "temperature", {
        "entry": last.id, "code": "temperature", "value": 37.0, "obs_ts": late.isoformat(),
        "reason": "yanlış hastaya girilmiş", "retracted_by": "hem.ayse"}))
    rows = list(iter_records(pg_log, tenant="h1", page=100))
    engine, store = Engine(), AckStore()
    rehydrate(engine, store, rows, skip=retracted_entries(rows), now=datetime.now(timezone.utc))
    assert engine._judged_at[PID] == datetime.fromisoformat(withdrawal.ts)
    assert (PID, "antibiotic_overdue") in store.firing
