# homunculus-engine/tests/test_pharmacy.py
"""G3-04 «Eczane» (spec §3.1–§3.3, D6–D13): api/pharmacy.py — the antibiotic state in `_meds`' fields, the
vasopressor list, the fluid day's totals, the row, the order, the counters and the whole answer. Pure: cards and
`meds` blocks written by hand in the shape `api/board.py` publishes. Synthetic patients only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api import fluids as fluids_module
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.fluids import FluidEntry
from homunculus.api.pharmacy import (
    ANTIBIOTIC_WINDOW_SOURCE, antibiotic_of, counts_of, fluid_of, pressors_of, row_of, sort_key, ward_pharmacy,
)
from homunculus.rules.antibiotic_clock import WINDOW

BAKU = timezone(timedelta(hours=4))     # Asia/Baku keeps +04 all year; tzdata is not on every test host
NOW = datetime(2026, 11, 4, 9, 30, tzinfo=timezone.utc)          # 13:30 in Baku
DAY = (datetime(2026, 11, 4, 4, 0, tzinfo=timezone.utc), datetime(2026, 11, 5, 4, 0, tzinfo=timezone.utc))
RECOGNIZED = "2026-11-04T08:05:00+00:00"
DEADLINE = "2026-11-04T09:05:00+00:00"
GIVEN = "2026-11-04T08:40:00+00:00"
WITHDRAWN = {"reason": "yanlış hastaya girildi", "by": "hem.ayse", "at": None}


def _clock(remaining=None, met=None):
    return {"recognized_at": RECOGNIZED, "deadline": DEADLINE, "remaining_sec": remaining, "elapsed_sec": 0,
            "met": met}


def _meds(*, clock=None, at=None, given=None, pressors=None, pressors_at=None, creatinine=None,
          creatinine_at=None):
    """A `meds` block as `_meds` builds it: the four pressors always present, None when never charted."""
    rates = {"norepinephrine": None, "epinephrine": None, "dopamine": None, "dobutamine": None, **(pressors or {})}
    return {"pressors": rates, "on_pressor": any((rate or 0) > 0 for rate in rates.values()),
            "pressors_at": {drug: (pressors_at or {}).get(drug) for drug in rates}, "charted": [],
            "antibiotic_given": given, "antibiotic_at": at, "antibiotic_clock": clock,
            "creatinine": creatinine, "creatinine_at": creatinine_at, "weight_kg": None}


def _card(pid, *, meds=None, bed="", unit=None, name="", bed_id=None, identity=True):
    card = {"patient_id": pid, "risk": "none", "alerts": [],
            "identity": ({"patient_id": pid, "display_name": name, "bed_label": bed, "bed_id": bed_id,
                          "unit_id": unit, "bed_matched": bed_id is not None, "bed_key": None}
                         if identity else None)}
    if meds is not None:
        card["meds"] = meds
    return card


def _row(pid, **card):
    return row_of(_card(pid, **card), None)


def _e(entry, code, value, at, retracted=None):
    return FluidEntry(entry, code, float(value), at, "hem.ayse", retracted)


class TestTheAntibioticState:
    def test_a_clock_with_no_administration_and_time_left_is_running(self):
        assert antibiotic_of(_meds(clock=_clock(remaining=1500))) == {
            "state": "running", "given": None, "given_at": None, "recognized_at": RECOGNIZED,
            "deadline": DEADLINE, "remaining_sec": 1500}

    def test_a_clock_with_no_administration_past_its_deadline_is_missed(self):
        assert antibiotic_of(_meds(clock=_clock(remaining=-1500))) == {
            "state": "missed", "given": None, "given_at": None, "recognized_at": RECOGNIZED,
            "deadline": DEADLINE, "remaining_sec": -1500}

    @pytest.mark.parametrize(("remaining", "state"), [(1, "running"), (0, "missed"), (-1, "missed")])
    def test_the_boundary_is_the_rules_own(self, remaining, state):
        """`antibiotic_clock.evaluate`: `remaining.total_seconds() > 0` is `antibiotic_due`, otherwise
        `antibiotic_overdue` — the page and the alarm change word at the same second."""
        answer = antibiotic_of(_meds(clock=_clock(remaining=remaining)))
        assert (answer["state"], answer["remaining_sec"]) == (state, remaining)

    def test_an_administration_inside_the_window_is_met(self):
        assert antibiotic_of(_meds(clock=_clock(met=True), at=GIVEN, given=True)) == {
            "state": "met", "given": True, "given_at": GIVEN, "recognized_at": RECOGNIZED, "deadline": DEADLINE,
            "remaining_sec": None}

    def test_an_administration_after_the_window_is_late(self):
        late = "2026-11-04T09:40:00+00:00"
        answer = antibiotic_of(_meds(clock=_clock(met=False), at=late, given=True))
        assert (answer["state"], answer["given_at"], answer["remaining_sec"]) == ("late", late, None)

    def test_an_administration_with_no_recognition_is_given(self):
        assert antibiotic_of(_meds(at=GIVEN, given=True)) == {
            "state": "given", "given": True, "given_at": GIVEN, "recognized_at": None, "deadline": None,
            "remaining_sec": None}

    def test_nothing_charted_is_none(self):
        assert antibiotic_of(_meds()) == {"state": "none", "given": None, "given_at": None, "recognized_at": None,
                                         "deadline": None, "remaining_sec": None}

    def test_a_false_record_with_a_clock_is_worded_by_the_clock(self):
        """D8, O2: `false` is «something was charted, but no administration that counts» — a 0, or a dose stamped
        before recognition. With a clock it is `running` / `missed` like `null`; the answer keeps the `false`."""
        running = antibiotic_of(_meds(clock=_clock(remaining=600), given=False))
        missed = antibiotic_of(_meds(clock=_clock(remaining=-600), given=False))
        assert (running["state"], running["given"]) == ("running", False)
        assert (missed["state"], missed["given"]) == ("missed", False)

    def test_a_false_record_without_a_clock_is_none_and_stays_false(self):
        answer = antibiotic_of(_meds(given=False))
        assert (answer["state"], answer["given"]) == ("none", False)

    def test_a_card_without_meds_is_none(self):
        assert antibiotic_of(None) == {"state": "none", "given": None, "given_at": None, "recognized_at": None,
                                       "deadline": None, "remaining_sec": None}

    def test_no_state_says_not_given(self):
        states = {antibiotic_of(m)["state"] for m in (
            None, _meds(), _meds(given=False), _meds(at=GIVEN, given=True), _meds(clock=_clock(remaining=5)),
            _meds(clock=_clock(remaining=-5), given=False), _meds(clock=_clock(met=True), at=GIVEN, given=True),
            _meds(clock=_clock(met=False), at=GIVEN, given=True))}
        assert states == {"running", "missed", "met", "late", "given", "none"}


class TestThePressors:
    def test_every_charted_drug_in_the_cards_order_with_its_rate_and_time(self):
        meds = _meds(pressors={"dopamine": 0.0, "norepinephrine": 0.12},
                     pressors_at={"norepinephrine": "2026-11-04T09:10:00+00:00",
                                  "dopamine": "2026-11-04T07:00:00+00:00"})
        assert pressors_of(meds) == [
            {"drug": "norepinephrine", "rate": 0.12, "at": "2026-11-04T09:10:00+00:00"},
            {"drug": "dopamine", "rate": 0.0, "at": "2026-11-04T07:00:00+00:00"}]     # a 0 is listed: stopped

    def test_a_never_charted_drug_is_absent(self):
        assert pressors_of(_meds()) == []
        assert pressors_of(None) == []

    def test_a_rate_from_a_card_without_times_keeps_a_null_time(self):
        meds = {"pressors": {"epinephrine": 0.05}}                 # a card older than G2-A3: no `pressors_at`
        assert pressors_of(meds) == [{"drug": "epinephrine", "rate": 0.05, "at": None}]


class TestTheFluidDay:
    def test_no_entry_in_the_day_is_none_never_a_zero(self):
        assert fluid_of([], DAY) is None
        assert fluid_of([_e(1, "iv_fluid_ml", 500, DAY[0] - timedelta(minutes=1))], DAY) is None    # yesterday's
        assert fluid_of([_e(1, "iv_fluid_ml", 500, DAY[1])], DAY) is None                           # tomorrow's

    def test_only_withdrawn_entries_is_none_too(self):
        assert fluid_of([_e(1, "urine_output_ml", 100, DAY[0] + timedelta(hours=1), WITHDRAWN)], DAY) is None

    def test_the_days_sums_the_count_and_the_newest_entrys_time(self):
        hour = timedelta(hours=1)
        entries = [_e(1, "iv_fluid_ml", 1000, DAY[0]), _e(2, "enteral_ml", 250, DAY[0] + 2 * hour),
                   _e(3, "urine_output_ml", 900, DAY[0] + 5 * hour),
                   _e(4, "urine_output_ml", 300, DAY[0] + 5.5 * hour, WITHDRAWN),      # in no sum, not counted
                   _e(5, "iv_fluid_ml", 700, DAY[0] - hour)]                           # the day before
        assert fluid_of(entries, DAY) == {"in_ml": 1250.0, "out_ml": 900.0, "balance_ml": 350.0, "entries": 3,
                                          "last_at": "2026-11-04T09:00:00+00:00"}

    def test_a_negative_balance_is_a_number_as_any_other(self):
        fluid = fluid_of([_e(1, "urine_output_ml", 400, DAY[0] + timedelta(hours=1))], DAY)
        assert (fluid["in_ml"], fluid["out_ml"], fluid["balance_ml"]) == (0.0, 400.0, -400.0)


class TestTheRow:
    def test_a_measured_card(self):
        meds = _meds(pressors={"norepinephrine": 0.12}, pressors_at={"norepinephrine": "2026-11-04T09:10:00+00:00"},
                     clock=_clock(met=True), at=GIVEN, given=True, creatinine=2.1,
                     creatinine_at="2026-11-04T05:40:00+00:00")
        fluid = {"in_ml": 1250.0, "out_ml": 900.0, "balance_ml": 350.0, "entries": 7,
                 "last_at": "2026-11-04T09:00:00+00:00"}
        row = row_of(_card("S-001", meds=meds, bed="YBU 1-1", unit="u1", bed_id="b1", name="Örnek Hasta Bir"), fluid)
        assert row == {
            "patient_id": "S-001", "bed_label": "YBU 1-1", "bed_id": "b1", "unit_id": "u1",
            "display_name": "Örnek Hasta Bir", "measured": True, "on_pressor": True,
            "pressors": [{"drug": "norepinephrine", "rate": 0.12, "at": "2026-11-04T09:10:00+00:00"}],
            "antibiotic": {"state": "met", "given": True, "given_at": GIVEN, "recognized_at": RECOGNIZED,
                           "deadline": DEADLINE, "remaining_sec": None},
            "creatinine": {"value": 2.1, "at": "2026-11-04T05:40:00+00:00"},
            "fluid": fluid}

    def test_an_identity_only_card_is_unmeasured_and_all_no_record(self):
        row = row_of(_card("S-002", bed="YBU 1-2", unit="u1", bed_id="b2"), None)
        assert row == {
            "patient_id": "S-002", "bed_label": "YBU 1-2", "bed_id": "b2", "unit_id": "u1", "display_name": "",
            "measured": False, "on_pressor": False, "pressors": [],
            "antibiotic": {"state": "none", "given": None, "given_at": None, "recognized_at": None, "deadline": None,
                           "remaining_sec": None},
            "creatinine": None, "fluid": None}

    def test_a_measured_card_nobody_named_has_no_bed_no_unit_and_no_name(self):
        row = row_of(_card("S-009", meds=_meds(), identity=False), None)
        assert (row["bed_label"], row["bed_id"], row["unit_id"], row["display_name"]) == ("", None, None, "")
        assert row["measured"] is True and row["creatinine"] is None

    def test_a_bed_the_table_places_on_no_unit_has_a_null_unit(self):
        assert _row("S-004", bed="YBU 9", unit="")["unit_id"] is None
        assert _row("S-004", bed="YBU 9", unit=None)["unit_id"] is None

    def test_a_creatinine_of_zero_is_still_a_value(self):
        row = _row("S-005", meds=_meds(creatinine=0.0, creatinine_at="2026-11-04T05:40:00+00:00"))
        assert row["creatinine"] == {"value": 0.0, "at": "2026-11-04T05:40:00+00:00"}


class TestTheOrder:
    def test_open_clocks_lead_the_longest_passed_first_then_the_least_time_left(self):
        rows = [_row("S-1", bed="YBU 1-1", unit="u1", meds=_meds(clock=_clock(remaining=2400))),
                _row("S-2", bed="YBU 1-2", unit="u1", meds=_meds(clock=_clock(remaining=-300))),
                _row("S-3", bed="YBU 1-3", unit="u1", meds=_meds(clock=_clock(remaining=600))),
                _row("S-4", bed="YBU 1-4", unit="u1", meds=_meds(clock=_clock(remaining=-1500)))]
        assert [r["patient_id"] for r in sorted(rows, key=sort_key)] == ["S-4", "S-2", "S-3", "S-1"]

    def test_then_the_rows_on_a_vasopressor_then_the_rest(self):
        rows = [_row("S-1", bed="YBU 1-1", unit="u1", meds=_meds()),
                _row("S-2", bed="YBU 1-2", unit="u1", meds=_meds(pressors={"norepinephrine": 0.1})),
                _row("S-3", bed="YBU 1-3", unit="u1", meds=_meds(clock=_clock(remaining=60))),
                _row("S-4", bed="YBU 1-4", unit="u1"),                                           # identity only
                _row("S-5", bed="YBU 1-5", unit="u1", meds=_meds(clock=_clock(met=True), at=GIVEN, given=True,
                                                                 pressors={"dopamine": 5.0}))]
        assert [r["patient_id"] for r in sorted(rows, key=sort_key)] == ["S-3", "S-2", "S-5", "S-1", "S-4"]

    def test_an_answered_clock_and_a_stopped_infusion_do_not_lead(self):
        rows = [_row("S-1", bed="A 1", unit="u1", meds=_meds()),
                _row("S-2", bed="A 2", unit="u1", meds=_meds(clock=_clock(met=False), at=GIVEN, given=True)),
                _row("S-3", bed="A 3", unit="u1", meds=_meds(pressors={"dopamine": 0.0}))]
        assert [r["patient_id"] for r in sorted(rows, key=sort_key)] == ["S-1", "S-2", "S-3"]

    def test_inside_a_group_the_boards_bed_order(self):
        """`screens/beds/order.js` `byBed`: unit id, a row on no unit last, the label with digit runs as numbers
        and letters case-folded, then the patient key."""
        rows = [_row("S-1", bed="YBU 1-10", unit="u1"), _row("S-2", bed="YBU 1-2", unit="u1"),
                _row("S-3", bed="ybu 1-3", unit="u1"), _row("S-4", bed="KVC 1", unit="u2"),
                _row("S-5", bed="AAA 1", unit=None), _row("S-6", bed="YBU 1-2", unit="u1"),
                _row("S-7", unit="u1")]                       # no label: ordered by its patient key
        assert [r["patient_id"] for r in sorted(rows, key=sort_key)] == [
            "S-7", "S-2", "S-6", "S-3", "S-1", "S-4", "S-5"]

    def test_a_label_of_digits_and_one_of_letters_compare_without_an_error(self):
        rows = [_row("S-1", bed="B", unit="u1"), _row("S-2", bed="12", unit="u1"), _row("S-3", bed="²", unit="u1")]
        assert [r["patient_id"] for r in sorted(rows, key=sort_key)] == ["S-2", "S-1", "S-3"]


class TestTheCounters:
    def test_the_four_counters_and_the_part_of_the_fourth(self):
        rows = [_row("S-1", meds=_meds(clock=_clock(remaining=600))),
                _row("S-2", meds=_meds(clock=_clock(remaining=-600), given=False)),
                _row("S-3", meds=_meds(clock=_clock(remaining=-60), pressors={"norepinephrine": 0.2})),
                _row("S-4", meds=_meds(clock=_clock(met=True), at=GIVEN, given=True)),
                _row("S-5", meds=_meds(clock=_clock(met=False), at=GIVEN, given=True, pressors={"dopamine": 5})),
                _row("S-6", meds=_meds(at=GIVEN, given=True)),
                _row("S-7", meds=_meds(pressors={"dobutamine": 0.0})),
                _row("S-8")]
        assert counts_of(rows) == {"patients": 8, "clock_running": 1, "clock_missed": 2, "on_pressor": 2,
                                   "recognized": 5, "recognized_no_record": 3}

    def test_an_empty_ward_is_all_zeros(self):
        assert counts_of([]) == {"patients": 0, "clock_running": 0, "clock_missed": 0, "on_pressor": 0,
                                 "recognized": 0, "recognized_no_record": 0}


def _chart(audit, pid, code, value, at, tenant="h1"):
    return audit.append(AuditEvent(tenant, "chart", pid, code, {
        "value": value, "unit": "mL", "obs_ts": at.astimezone(timezone.utc).isoformat(), "charted_by": "hem.ayse"})).id


class TestTheWardAnswer:
    def _answer(self, cards, audit=None, **over):
        args = {"hospital": "h1", "now": NOW, "zone": BAKU, "start_a": 8, "start_b": 20, **over}
        return ward_pharmacy(cards, audit or InMemoryAuditLog(), **args)

    def test_the_answers_keys_the_window_and_the_fluid_day_in_the_tenants_zone(self):
        answer = self._answer([])
        assert list(answer) == ["now", "antibiotic_window_min", "antibiotic_window_source", "fluid_day",
                                "fluid_truncated", "counts", "rows"]
        assert answer["now"] == "2026-11-04T09:30:00+00:00"
        assert answer["antibiotic_window_min"] == 60 == WINDOW.total_seconds() // 60
        assert answer["antibiotic_window_source"] == ANTIBIOTIC_WINDOW_SOURCE == "surviving-sepsis-campaign-2026"
        assert answer["fluid_day"] == {"start": "2026-11-04T04:00:00+00:00", "end": "2026-11-05T04:00:00+00:00"}
        assert answer["fluid_truncated"] is False and answer["rows"] == [] and answer["counts"]["patients"] == 0

    def test_the_fluid_day_follows_the_shift_start_and_the_zone(self):
        assert self._answer([], start_a=7, start_b=19)["fluid_day"]["start"] == "2026-11-04T03:00:00+00:00"
        assert self._answer([], zone=timezone.utc)["fluid_day"]["start"] == "2026-11-04T08:00:00+00:00"
        early = self._answer([], now=datetime(2026, 11, 4, 3, 59, tzinfo=timezone.utc))     # 07:59 in Baku
        assert early["fluid_day"]["start"] == "2026-11-03T04:00:00+00:00"

    def test_each_row_carries_its_own_days_balance_and_an_uncharted_patient_none(self):
        audit = InMemoryAuditLog()
        _chart(audit, "S-001", "iv_fluid_ml", 1250, DAY[0] + timedelta(hours=1))
        _chart(audit, "S-001", "urine_output_ml", 900, DAY[0] + timedelta(hours=5))
        wrong = _chart(audit, "S-001", "urine_output_ml", 300, DAY[0] + timedelta(hours=5))
        audit.append(AuditEvent("h1", RETRACT, "S-001", "urine_output_ml", {
            "entry": wrong, "reason": "yanlış hastaya girildi", "retracted_by": "hem.zeynep"}))
        _chart(audit, "S-001", "iv_fluid_ml", 400, DAY[0] - timedelta(hours=1))        # before the day start
        _chart(audit, "S-001", "iv_fluid_ml", 400, NOW + timedelta(hours=1))           # ahead of now
        _chart(audit, "S-003", "urine_output_ml", 150, DAY[0] + timedelta(hours=2))
        _chart(audit, "S-777", "iv_fluid_ml", 999, DAY[0] + timedelta(hours=2))        # not on the caller's board
        _chart(audit, "S-002", "iv_fluid_ml", 999, DAY[0] + timedelta(hours=2), tenant="h2")   # another hospital
        cards = [_card("S-001", bed="YBU 1-1", unit="u1", meds=_meds()), _card("S-002", bed="YBU 1-2", unit="u1"),
                 _card("S-003", bed="YBU 1-3", unit="u1", meds=_meds())]
        answer = self._answer(cards, audit)
        fluids = {row["patient_id"]: row["fluid"] for row in answer["rows"]}
        assert fluids == {
            "S-001": {"in_ml": 1250.0, "out_ml": 900.0, "balance_ml": 350.0, "entries": 2,
                      "last_at": "2026-11-04T09:00:00+00:00"},
            "S-002": None,
            "S-003": {"in_ml": 0.0, "out_ml": 150.0, "balance_ml": -150.0, "entries": 1,
                      "last_at": "2026-11-04T06:00:00+00:00"}}
        assert answer["fluid_truncated"] is False

    def test_the_rows_are_sorted_and_counted_here(self):
        cards = [_card("S-001", bed="YBU 1-1", unit="u1", name="Örnek Hasta Bir",
                       meds=_meds(clock=_clock(met=True), at=GIVEN, given=True, pressors={"norepinephrine": 0.12})),
                 _card("S-002", bed="YBU 1-2", unit="u1"),
                 _card("S-003", bed="YBU 1-3", unit="u1", name="Örnek Hasta Üç",
                       meds=_meds(clock=_clock(remaining=-1500)))]
        answer = self._answer(cards)
        assert [row["patient_id"] for row in answer["rows"]] == ["S-003", "S-001", "S-002"]
        assert answer["counts"] == {"patients": 3, "clock_running": 0, "clock_missed": 1, "on_pressor": 1,
                                    "recognized": 2, "recognized_no_record": 1}

    def test_one_read_of_the_trail_for_the_whole_ward(self, monkeypatch):
        audit, reads = InMemoryAuditLog(), []
        real = audit.records

        def records(**kw):
            reads.append(kw)
            return real(**kw)

        monkeypatch.setattr(audit, "records", records)
        self._answer([_card(f"S-{n:03d}", meds=_meds()) for n in range(1, 31)], audit)
        assert len(reads) == 1 and "patient_id" not in reads[0]
        assert reads[0]["tenant"] == "h1" and reads[0]["event_types"] == {"chart", RETRACT}

    def test_a_cut_read_says_so(self, monkeypatch):
        audit = InMemoryAuditLog()
        for hour in (1, 2, 3):
            _chart(audit, "S-001", "iv_fluid_ml", 100, DAY[0] + timedelta(hours=hour))
        monkeypatch.setattr(fluids_module, "WARD_READ_LIMIT", 2)
        answer = self._answer([_card("S-001", meds=_meds())], audit)
        assert answer["fluid_truncated"] is True
        assert answer["rows"][0]["fluid"]["in_ml"] == 200.0          # the day's OLDEST row is the one lost
