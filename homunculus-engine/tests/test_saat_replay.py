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
from homunculus.api.audit import AuditRecord
from homunculus.api.clinical import BEDSIDE_SKEW
from homunculus.api.rehydrate import REPLAY_SKEW, rebuild_patient, rehydrate
from homunculus.pipeline import Engine

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
