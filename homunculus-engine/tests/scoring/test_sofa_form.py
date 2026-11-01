"""The SOFA severity form — the module's first tab.

This is a different instrument from the SOFA the alerting rules use, and the difference is the
whole design. The rules ask "is this patient deteriorating right now?" and read the latest values.
The form asks "how sick was this patient over the last 24 hours?" and reads the worst ones. A
product that confuses them either alarms on a prognostic score or reports a severity score that
flatters the day.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.scoring import sofa_form
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 9, 13, 12, 0, tzinfo=timezone.utc)


def _state(series, source="lab"):
    state = PatientState("yatak-1")
    for code, value, hours in series:
        state.ingest(Observation("yatak-1", code, value, "u", T0 - timedelta(hours=hours), source))
    return state


def _row(form, organ):
    return next(r for r in form.rows if r.organ == organ)


class TestTheFormIsScoredOnTheWorstOfTheDay:
    def test_a_recovered_organ_is_still_scored_at_its_worst(self):
        state = _state([(SignalCode.PLATELETS, 140, 20),
                        (SignalCode.PLATELETS, 45, 10),
                        (SignalCode.PLATELETS, 160, 0.5)])
        row = _row(sofa_form.build(state, T0), "coagulation")
        assert row.points == 3
        assert row.inputs[0].value == 45

    def test_a_pressor_that_has_since_been_stopped_still_counts(self):
        """SOFA's cardiovascular row grades the support the patient NEEDED. Someone weaned off
        noradrenaline this morning was, at their worst, on noradrenaline."""
        state = _state([(SignalCode.NOREPINEPHRINE_RATE, 0.05, 6),
                        (SignalCode.NOREPINEPHRINE_RATE, 0.22, 3),
                        (SignalCode.NOREPINEPHRINE_RATE, 0.0, 0.3)])
        assert _row(sofa_form.build(state, T0), "cardiovascular").points == 4

    def test_the_lowest_pressure_is_shown_not_the_last_low_one(self):
        state = _state([(SignalCode.MAP, 68, 5), (SignalCode.MAP, 42, 3),
                        (SignalCode.MAP, 66, 1)])
        row = _row(sofa_form.build(state, T0), "cardiovascular")
        assert row.inputs[0].value == 42
        assert row.points == 1     # MAP < 70 with no pressor running

    def test_each_cell_names_the_measurement_behind_it(self):
        state = _state([(SignalCode.CREATININE, 3.9, 8)], source="lab-2")
        cell = _row(sofa_form.build(state, T0), "renal").inputs[0]
        assert cell.at == T0 - timedelta(hours=8)
        assert cell.source == "lab-2"


class TestItRefusesToInvent:
    def test_an_unmeasured_organ_is_named_rather_than_scored_as_healthy(self):
        """SOFA grades a missing organ 0. That is correct for the score and misleading for a
        reader, so the form lists which organs nobody measured."""
        form = sofa_form.build(_state([(SignalCode.PLATELETS, 90, 4)]), T0)
        assert form.total == 2
        assert "liver" in form.unmeasured_organs
        assert "cns" in form.unmeasured_organs
        assert "coagulation" not in form.unmeasured_organs

    def test_an_empty_record_produces_a_zero_that_admits_it_measured_nothing(self):
        form = sofa_form.build(PatientState("bos"), T0)
        assert form.total == 0
        assert len(form.unmeasured_organs) == 6

    def test_a_form_shorter_than_its_window_says_so(self):
        """A patient admitted four hours ago has no 24 hours to look back on. Presenting the
        result as a day's worth of data would be a quiet overstatement."""
        state = _state([(SignalCode.PLATELETS, 90, 2)])
        form = sofa_form.build(state, T0, admitted_at=T0 - timedelta(hours=4))
        assert form.covers_full_window is False

    def test_the_form_comes_back_unsigned(self):
        """A severity score entering a hospital's quality reporting with no clinician behind it
        is the failure this module must not enable."""
        assert sofa_form.build(PatientState("y"), T0).signed is False


class TestItReportsAndDoesNotAlert:
    def test_organ_failure_is_named_using_the_printed_forms_own_footnote(self):
        """"SOFA skoru >=3 olması o sistem için organ yetmezliği olarak tanımlanır." """
        state = _state([(SignalCode.PLATELETS, 30, 5), (SignalCode.CREATININE, 2.2, 5)])
        form = sofa_form.build(state, T0)
        assert form.as_dict()["organ_failures"] == ["coagulation"]   # renal scores 2, not failure

    def test_the_payload_carries_its_source(self):
        """The only score whose table this project holds with a citation. The others wait."""
        assert sofa_form.build(PatientState("y"), T0).as_dict()["source"] == "sepsis-3-jama-2016"


def _ratio_and_support(ratios, supports, overrides=None):
    """A form from PaO2/FiO2 readings `(value, hours_ago)` and support flags `(1|0, hours_ago)`."""
    state = PatientState("yatak-1")
    for value, hours in ratios:
        state.ingest(Observation("yatak-1", SignalCode.PAO2_FIO2, float(value), "ratio",
                                 T0 - timedelta(hours=hours), "lab"))
    for flag, hours in supports:
        state.ingest(Observation("yatak-1", SignalCode.ON_RESP_SUPPORT, float(flag), "bool",
                                 T0 - timedelta(hours=hours), "clinician"))
    return _row(sofa_form.build(state, T0, overrides=overrides), "respiration")


def _at(hours):
    return (T0 - timedelta(hours=hours)).isoformat()


class TestEachRatioIsScoredOnItsOwnSupport:
    """G2-A4 (D13, X21): the 3- and 4-point PaO2/FiO2 bands apply only on respiratory support. Each reading
    is scored on the support in force WHEN it was measured — the latest support observation at or before
    it, over the patient's whole record — and the row is the window's worst SCORE (ties: the lowest value,
    then the latest reading), and says which support it was scored on. Scoring an eight-hour-old ratio
    against a ventilator connected since would credit the score for a treatment that was not running at
    the time."""

    def test_support_charted_before_the_reading_opens_the_three_point_band(self):
        row = _ratio_and_support([(150, 6)], [(1, 10)])
        assert row.points == 3
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(10)}

    def test_support_charted_after_the_reading_does_not_reach_back(self):
        row = _ratio_and_support([(150, 6)], [(1, 2)])
        assert row.points == 2
        assert row.as_dict()["support"] == {"on_support": False, "at": None}

    def test_a_no_charted_before_the_reading_ends_an_earlier_yes(self):
        """The old rule counted any yes in the window and a later «hayır» could not cancel it."""
        row = _ratio_and_support([(150, 6)], [(1, 10), (0, 8)])
        assert row.points == 2
        assert row.as_dict()["support"] == {"on_support": False, "at": _at(8)}

    def test_support_from_before_the_window_still_counts(self):
        """Looked up over the whole record: a ventilator connected 30 h ago is still running."""
        row = _ratio_and_support([(150, 6)], [(1, 30)])
        assert row.points == 3
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(30)}

    def test_support_charted_at_the_readings_own_time_counts(self):
        row = _ratio_and_support([(150, 6)], [(1, 6)])
        assert row.points == 3 and row.as_dict()["support"]["at"] == _at(6)

    def test_a_higher_ratio_on_support_outscores_a_lower_one_off_it(self):
        """The row is the worst SCORE: 180 measured on support scores 3, 150 measured before support 2 —
        the form shows the 180, on support."""
        row = _ratio_and_support([(150, 6), (180, 2)], [(1, 3)])
        assert row.inputs[0].value == 180 and row.inputs[0].at == T0 - timedelta(hours=2)
        assert row.points == 3
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(3)}

    def test_four_points_on_support_beat_three_on_support(self):
        row = _ratio_and_support([(120, 6), (90, 2)], [(1, 10)])
        assert (row.inputs[0].value, row.points) == (90, 4)
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(10)}

    def test_with_every_reading_off_support_the_lowest_value_wins(self):
        """250 and 150 both score 2 off support: the tie goes to the lower value, as it always did."""
        row = _ratio_and_support([(250, 6), (150, 4), (350, 2)], [])
        assert (row.inputs[0].value, row.points) == (150, 2)
        assert row.as_dict()["support"] == {"on_support": False, "at": None}

    def test_a_no_timed_before_a_reading_turns_that_reading_off_support(self):
        """150 at 6 h falls under the «evet» at 10 h (3); 160 at 2 h under the «hayır» at 4 h (2)."""
        row = _ratio_and_support([(150, 6), (160, 2)], [(1, 10), (0, 4)])
        assert (row.inputs[0].value, row.points) == (150, 3)
        only_the_later = _ratio_and_support([(150, 2)], [(1, 10), (0, 4)])
        assert only_the_later.points == 2
        assert only_the_later.as_dict()["support"] == {"on_support": False, "at": _at(4)}

    def test_a_tie_on_points_goes_to_the_lower_value(self):
        row = _ratio_and_support([(120, 6), (150, 2)], [(1, 10)])      # both 3 on support
        assert (row.inputs[0].value, row.points) == (120, 3)

    def test_a_tie_on_points_and_value_goes_to_the_latest_reading(self):
        row = _ratio_and_support([(150, 6), (150, 3)], [])
        assert row.inputs[0].at == T0 - timedelta(hours=3) and row.points == 2

    def test_equal_values_on_different_support_are_ranked_by_their_points(self):
        """The same 150 twice: on support at 6 h (3), off it at 2 h (2). The score decides, not the time."""
        row = _ratio_and_support([(150, 6), (150, 2)], [(1, 10), (0, 4)])
        assert row.inputs[0].at == T0 - timedelta(hours=6) and row.points == 3
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(10)}

    def test_a_reading_from_before_the_window_is_scored_on_its_own_times_support(self):
        row = _ratio_and_support([(150, 30)], [(1, 40), (0, 20)])
        assert row.inputs[0].outside_window is True
        assert row.points == 3
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(40)}

    def test_a_corrected_ratio_is_scored_on_the_original_readings_support(self):
        on = _ratio_and_support([(150, 6)], [(1, 10)], overrides={SignalCode.PAO2_FIO2: 90})
        assert on.points == 4 and on.as_dict()["support"] == {"on_support": True, "at": _at(10)}
        off = _ratio_and_support([(150, 6)], [(1, 2)], overrides={SignalCode.PAO2_FIO2: 90})
        assert off.points == 2 and off.as_dict()["support"] == {"on_support": False, "at": None}

    def test_a_correction_takes_the_support_of_the_reading_it_corrects(self):
        """The row's reading is the 180 on support (3); corrected to 90 it scores 4 on that support — not
        on the 150's, which was off support."""
        row = _ratio_and_support([(150, 6), (180, 2)], [(1, 3)], overrides={SignalCode.PAO2_FIO2: 90})
        assert row.inputs[0].original == 180 and row.points == 4
        assert row.as_dict()["support"] == {"on_support": True, "at": _at(3)}

    def test_with_no_ratio_at_all_there_is_no_support_basis(self):
        assert _ratio_and_support([], []).as_dict()["support"] is None
        assert _ratio_and_support([], [(1, 2)]).as_dict()["support"] is None

    def test_a_ratio_typed_over_an_unmeasured_cell_has_no_reading_to_take_support_from(self):
        """No reading, so no time to look the support up at: scored off support, and the row says so."""
        row = _ratio_and_support([], [(1, 2)], overrides={SignalCode.PAO2_FIO2: 90})
        assert row.points == 2
        assert row.as_dict()["support"] == {"on_support": False, "at": None}

    def test_only_the_respiration_row_carries_a_support_basis(self):
        form = sofa_form.build(_state([(SignalCode.PLATELETS, 90, 4)]), T0).as_dict()
        assert [r["organ"] for r in form["rows"] if "support" in r] == ["respiration"]


class TestItIsNotTheAlertingSofa:
    def test_the_form_can_exceed_the_live_score_because_it_looks_back(self):
        """The live rule reads the latest values and sees a recovering patient; the form reads the
        worst and sees the day. Both are right, and they are not the same number."""
        from homunculus.rules.sofa import total_sofa
        state = _state([(SignalCode.PLATELETS, 18, 10),    # 4 points at its worst
                        (SignalCode.PLATELETS, 220, 0.5)])  # 0 points now
        assert total_sofa(state) == 0
        assert sofa_form.build(state, T0).total == 4
