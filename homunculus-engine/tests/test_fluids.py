"""G3-03 (spec D5–D9): api/fluids.py — the fluid day, the window totals, the hourly ledger, the urine rate and
the read of the trail. Synthetic patients and values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.fluids import (
    INTAKE, OUTPUT, SOFA_RENAL_REFERENCE, FluidEntry, fluid_day, hourly, hours_with, patient_fluids, totals,
    urine_rate,
)

BAKU = timezone(timedelta(hours=4))     # Asia/Baku keeps +04 all year; tzdata is not on every test host
H = timedelta(hours=1)
DAY = datetime(2026, 11, 9, 8, 0, tzinfo=BAKU)          # a fluid day's start, 08:00 Baku


def _at(hours: float) -> datetime:
    """`hours` after DAY's start."""
    return DAY + timedelta(hours=hours)


def _e(entry, code, value, at, retracted=None):
    return FluidEntry(entry, code, float(value), at, "hem.ayse", retracted)


WITHDRAWN = {"reason": "yanlış hastaya girildi", "by": "hem.ayse", "at": None}


class TestTheFluidDay:
    def test_in_the_afternoon_the_day_began_at_eight_this_morning(self):
        w = fluid_day(datetime(2026, 11, 9, 14, 0, tzinfo=BAKU), BAKU, 8, 20)
        assert w["day"] == (DAY, DAY + 24 * H)
        assert w["last_day"] == (DAY - 24 * H, DAY)
        assert w["shift_a"] == (DAY, _at(12))
        assert w["shift_b"] == (_at(12), _at(24))

    def test_after_midnight_the_day_began_yesterday_at_eight(self):
        w = fluid_day(datetime(2026, 11, 10, 3, 30, tzinfo=BAKU), BAKU, 8, 20)
        assert w["day"] == (DAY, DAY + 24 * H)
        assert w["shift_b"] == (_at(12), _at(24))

    def test_eight_oclock_exactly_begins_a_new_day(self):
        w = fluid_day(datetime(2026, 11, 10, 8, 0, tzinfo=BAKU), BAKU, 8, 20)
        assert w["day"][0] == DAY + 24 * H
        assert fluid_day(datetime(2026, 11, 10, 7, 59, tzinfo=BAKU), BAKU, 8, 20)["day"][0] == DAY

    def test_now_in_utc_is_read_in_the_tenants_zone(self):
        """10:00 UTC is 14:00 in Baku: the day began at 04:00 UTC."""
        w = fluid_day(datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc), BAKU, 8, 20)
        assert w["day"][0] == datetime(2026, 11, 9, 4, 0, tzinfo=timezone.utc)

    def test_other_shift_starts(self):
        w = fluid_day(datetime(2026, 11, 9, 6, 0, tzinfo=timezone.utc), timezone.utc, 7, 19)
        assert w["day"][0] == datetime(2026, 11, 8, 7, 0, tzinfo=timezone.utc)
        assert w["shift_a"][1] == w["shift_b"][0] == datetime(2026, 11, 8, 19, 0, tzinfo=timezone.utc)


class TestTotals:
    ENTRIES = [
        _e(1, "iv_fluid_ml", 500, _at(1)),
        _e(2, "crystalloid_bolus_ml", 250, _at(2)),
        _e(3, "urine_output_ml", 300, _at(3)),
        _e(4, "drain_output_ml", 50, _at(4)),
        _e(5, "urine_output_ml", 100, _at(4.5), WITHDRAWN),
    ]

    def test_intake_and_output_are_summed_apart_and_balanced(self):
        t = totals(self.ENTRIES, DAY, _at(24))
        assert (t["in"], t["out"], t["balance"]) == (750.0, 350.0, 400.0)

    def test_a_withdrawn_entry_is_in_no_sum(self):
        assert totals(self.ENTRIES, DAY, _at(24))["by_code"]["urine_output_ml"] == 300.0

    def test_by_code_holds_only_charted_codes(self):
        assert totals(self.ENTRIES, DAY, _at(24))["by_code"] == {
            "iv_fluid_ml": 500.0, "crystalloid_bolus_ml": 250.0, "urine_output_ml": 300.0, "drain_output_ml": 50.0}

    def test_the_window_holds_its_start_and_not_its_end(self):
        assert totals(self.ENTRIES, _at(1), _at(3))["by_code"] == {"iv_fluid_ml": 500.0, "crystalloid_bolus_ml": 250.0}

    def test_an_empty_window_is_all_zeros(self):
        assert totals(self.ENTRIES, _at(12), _at(24)) == {"in": 0.0, "out": 0.0, "balance": 0.0, "by_code": {}}


class TestHourly:
    def test_twenty_four_rows_and_the_running_balance(self):
        rows = hourly([_e(1, "iv_fluid_ml", 250, _at(1) + timedelta(minutes=59)),
                       _e(2, "urine_output_ml", 120, _at(1) + timedelta(minutes=10)),
                       _e(3, "enteral_ml", 100, _at(3)),
                       _e(4, "drain_output_ml", 40, _at(3.5), WITHDRAWN)], DAY)
        assert len(rows) == 24
        assert rows[0] == {"start": DAY.astimezone(timezone.utc).isoformat(), "in": {}, "out": {}, "balance_cum": 0.0}
        assert rows[1]["in"] == {"iv_fluid_ml": 250.0}             # 09:59 lands in the 09:00 row
        assert rows[1]["out"] == {"urine_output_ml": 120.0}
        assert rows[1]["balance_cum"] == 130.0
        assert rows[2]["balance_cum"] == 130.0
        assert rows[3] == {"start": _at(3).astimezone(timezone.utc).isoformat(), "in": {"enteral_ml": 100.0},
                           "out": {}, "balance_cum": 230.0}
        assert rows[23]["balance_cum"] == 230.0


class TestUrine:
    NOW = _at(6)

    def test_the_rate_is_the_last_six_hours_per_kilogram_per_hour(self):
        entries = [_e(1, "urine_output_ml", 300, self.NOW - H),
                   _e(2, "urine_output_ml", 60, self.NOW - 6 * H),          # the window is (now − 6 h, now]
                   _e(3, "urine_output_ml", 120, self.NOW - 7 * H),
                   _e(4, "urine_output_ml", 500, self.NOW - 2 * H, WITHDRAWN),
                   _e(5, "drain_output_ml", 900, self.NOW - H)]
        assert urine_rate(entries, 70, self.NOW) == round(300 / 6 / 70, 2) == 0.71

    def test_no_rate_without_a_weight(self):
        entries = [_e(1, "urine_output_ml", 300, self.NOW - H)]
        assert urine_rate(entries, None, self.NOW) is None
        assert urine_rate(entries, 0, self.NOW) is None

    def test_no_rate_without_urine_in_the_window(self):
        assert urine_rate([_e(1, "urine_output_ml", 300, self.NOW - 7 * H)], 70, self.NOW) is None
        assert urine_rate([], 70, self.NOW) is None

    def test_hours_with_counts_the_distinct_hours_that_carry_an_entry(self):
        entries = [_e(1, "urine_output_ml", 50, _at(0) + timedelta(minutes=10)),
                   _e(2, "urine_output_ml", 50, _at(0) + timedelta(minutes=50)),   # the same hour
                   _e(3, "urine_output_ml", 50, _at(2)),
                   _e(4, "urine_output_ml", 50, _at(5), WITHDRAWN),
                   _e(5, "drain_output_ml", 50, _at(7)),
                   _e(6, "urine_output_ml", 50, _at(24)),                           # the next day
                   _e(7, "urine_output_ml", 50, _at(-1))]                           # the day before
        assert hours_with(entries, "urine_output_ml", DAY) == 2


class TestPatientFluids:
    NOW = _at(6)                      # 14:00 Baku on 9 November; the trail's write times are later, inside the read

    def _audit(self):
        audit = InMemoryAuditLog()
        ids = {}

        def chart(key, code, value, at, pid="S-001", tenant="h1"):
            rec = audit.append(AuditEvent(tenant, "chart", pid, code, {
                "value": value, "unit": "mL", "obs_ts": at.astimezone(timezone.utc).isoformat(),
                "charted_by": "hem.ayse"}))
            ids[key] = rec.id

        # The last complete day (8 November 08:00 → 9 November 08:00 Baku).
        chart("u1", "urine_output_ml", 500, _at(-23))
        chart("u2", "urine_output_ml", 400, _at(-1))
        chart("iv0", "iv_fluid_ml", 1000, _at(-12))
        # Today.
        chart("iv1", "iv_fluid_ml", 500, _at(1))
        chart("bolus", "crystalloid_bolus_ml", 250, _at(2))
        chart("u3", "urine_output_ml", 300, _at(5))
        chart("u4", "urine_output_ml", 100, _at(4))
        audit.append(AuditEvent("h1", RETRACT, "S-001", "urine_output_ml", {
            "entry": ids["u4"], "code": "urine_output_ml", "value": 100, "obs_ts": _at(4).isoformat(),
            "reason": "yanlış hastaya girildi", "retracted_by": "hem.zeynep"}))
        # Rows the ledger never reads.
        chart("hr", "heart_rate", 80, _at(1))                         # not a fluid
        chart("other", "urine_output_ml", 999, _at(1), pid="S-002")   # another patient
        chart("tenant", "urine_output_ml", 999, _at(1), tenant="h2")  # another hospital
        chart("old", "urine_output_ml", 999, _at(-25))                # before the last complete day
        chart("ahead", "urine_output_ml", 999, self.NOW + H)          # ahead of now
        audit.append(AuditEvent("h1", "chart", "S-001", "iv_fluid_ml", {   # a value the trail cannot read
            "value": float("nan"), "unit": "mL", "obs_ts": _at(1).isoformat(), "charted_by": "x"}))
        audit.append(AuditEvent("h1", "chart", "S-001", "iv_fluid_ml", {   # a time with no zone
            "value": 5, "unit": "mL", "obs_ts": "2026-11-09T09:00:00", "charted_by": "x"}))
        return audit, ids

    def _read(self, weight=70.0):
        audit, ids = self._audit()
        return patient_fluids(audit, hospital="h1", patient_id="S-001", now=self.NOW, zone=BAKU, start_a=8,
                              start_b=20, weight_kg=weight), ids

    def test_the_answer_carries_the_specs_keys(self):
        out, _ = self._read()
        assert set(out) == {"patient_id", "now", "day", "last_day", "shifts", "codes", "hours", "totals",
                            "urine_last_day_ml", "hours_with_urine_last_day", "weight_kg", "urine_ml_kg_h_last_6h",
                            "sofa_renal_reference", "entries"}
        assert out["patient_id"] == "S-001"
        assert out["now"] == "2026-11-09T10:00:00+00:00"
        assert out["day"] == {"start": "2026-11-09T04:00:00+00:00", "end": "2026-11-10T04:00:00+00:00"}
        assert out["last_day"] == {"start": "2026-11-08T04:00:00+00:00", "end": "2026-11-09T04:00:00+00:00"}
        assert out["shifts"] == [{"start": "2026-11-09T04:00:00+00:00", "end": "2026-11-09T16:00:00+00:00"},
                                 {"start": "2026-11-09T16:00:00+00:00", "end": "2026-11-10T04:00:00+00:00"}]
        assert out["codes"] == {"intake": list(INTAKE), "output": list(OUTPUT)}
        assert out["sofa_renal_reference"] == SOFA_RENAL_REFERENCE
        assert out["sofa_renal_reference"]["source"] == "sepsis-3-jama-2016"
        assert len(out["hours"]) == 24

    def test_the_totals_of_each_window(self):
        out, _ = self._read()
        assert out["totals"]["today"] == {"in": 750.0, "out": 300.0, "balance": 450.0,
                                          "by_code": {"iv_fluid_ml": 500.0, "crystalloid_bolus_ml": 250.0,
                                                      "urine_output_ml": 300.0}}
        assert out["totals"]["shift_a"] == out["totals"]["today"]
        assert out["totals"]["shift_b"] == {"in": 0.0, "out": 0.0, "balance": 0.0, "by_code": {}}
        assert out["totals"]["last_day"] == {"in": 1000.0, "out": 900.0, "balance": 100.0,
                                             "by_code": {"urine_output_ml": 900.0, "iv_fluid_ml": 1000.0}}
        assert out["hours"][5]["balance_cum"] == 450.0

    def test_the_last_days_urine_and_the_hours_it_covers(self):
        out, _ = self._read()
        assert out["urine_last_day_ml"] == 900.0
        assert out["hours_with_urine_last_day"] == 2

    def test_the_urine_rate_and_the_weight(self):
        out, _ = self._read()
        assert (out["weight_kg"], out["urine_ml_kg_h_last_6h"]) == (70.0, round(300 / 6 / 70, 2))
        out, _ = self._read(weight=None)
        assert (out["weight_kg"], out["urine_ml_kg_h_last_6h"]) == (None, None)

    def test_the_entries_newest_first_with_the_withdrawn_one_marked(self):
        out, ids = self._read()
        assert [e["entry"] for e in out["entries"]] == [ids[k] for k in ("u3", "u4", "bolus", "iv1", "u2", "iv0", "u1")]
        u4 = next(e for e in out["entries"] if e["entry"] == ids["u4"])
        assert u4["code"] == "urine_output_ml" and u4["value"] == 100.0 and u4["by"] == "hem.ayse"
        assert u4["at"] == _at(4).astimezone(timezone.utc).isoformat()
        assert u4["retracted"]["reason"] == "yanlış hastaya girildi"
        assert u4["retracted"]["by"] == "hem.zeynep"
        assert u4["retracted"]["at"] is not None
        assert all(e["retracted"] is None for e in out["entries"] if e["entry"] != ids["u4"])
