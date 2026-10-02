"""The worst value in 24 hours (M3) — the operation every severity score is defined on.

The hospital's own printed form carries the rule in a footnote: "Skor, önceki 24 saat içindeki en
kötü değere göre verilir." Scoring from the LATEST value instead is easy and reports a patient as
better than they were at their worst, which is the direction that matters. These tests hold that
distinction, and the three ways the shortcut creeps back in: taking the newest value, taking a
blanket min/max without the score's table, and quietly filling an unmeasured cell with a zero.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.canonical import Observation, SignalCode
from homunculus.rules.sofa import coagulation_points_of, renal_points_of
from homunculus.scoring.worst import worst_in_window, worst_observation
from homunculus.state.timeline import PatientState

T0 = datetime(2026, 9, 13, 12, 0, tzinfo=timezone.utc)


def _state(series: list[tuple[SignalCode, float, float]], source: str = "lab") -> PatientState:
    """series: (code, value, hours_before_T0)."""
    state = PatientState("yatak-1")
    for code, value, hours in series:
        state.ingest(Observation("yatak-1", code, value, "u", T0 - timedelta(hours=hours), source))
    return state


class TestItTakesTheWorstNotTheLatest:
    def test_a_platelet_count_that_recovered_is_still_scored_at_its_nadir(self):
        """140 -> 45 -> 160 over the day. The patient HAD a platelet count of 45, and the score
        is defined on that; the 160 says only that they are better now."""
        state = _state([(SignalCode.PLATELETS, 140, 20),
                        (SignalCode.PLATELETS, 45, 10),
                        (SignalCode.PLATELETS, 160, 0.5)])
        worst = worst_in_window(state, SignalCode.PLATELETS, coagulation_points_of, T0,
                                higher_is_worse=False)
        assert worst.value == 45
        assert worst.points == 3
        assert worst.considered == 3

    def test_a_creatinine_that_is_still_climbing_takes_the_peak(self):
        state = _state([(SignalCode.CREATININE, 1.1, 20),
                        (SignalCode.CREATININE, 3.9, 8),
                        (SignalCode.CREATININE, 3.6, 1)])
        worst = worst_in_window(state, SignalCode.CREATININE, renal_points_of, T0,
                                higher_is_worse=True)
        assert worst.value == 3.9 and worst.points == 3

    def test_worst_means_most_points_not_highest_number(self):
        """Platelets and creatinine run in opposite directions. A blanket min or max is right for
        one of them and silently wrong for the other, which is why the table travels with it."""
        plt = worst_observation(
            [Observation("p", SignalCode.PLATELETS, v, "u", T0 - timedelta(hours=h), "lab")
             for v, h in [(300, 5), (30, 3)]], coagulation_points_of, higher_is_worse=False)
        cr = worst_observation(
            [Observation("p", SignalCode.CREATININE, v, "u", T0 - timedelta(hours=h), "lab")
             for v, h in [(0.8, 5), (4.0, 3)]], renal_points_of, higher_is_worse=True)
        assert plt.value == 30      # the LOWEST platelet count
        assert cr.value == 4.0      # the HIGHEST creatinine


class TestTheWindow:
    def test_a_value_older_than_the_window_is_not_counted_as_inside_it(self):
        state = _state([(SignalCode.PLATELETS, 15, 30),     # 30 h ago — outside
                        (SignalCode.PLATELETS, 120, 2)])    # inside
        worst = worst_in_window(state, SignalCode.PLATELETS, coagulation_points_of, T0,
                                higher_is_worse=False)
        assert worst.value == 120
        assert worst.outside_window is False

    def test_with_nothing_in_the_window_it_falls_back_and_says_so(self):
        """The form's second footnote: an unmeasured parameter is scored from the nearest
        measurement. Flagged rather than blended in — a creatinine from three days ago and one
        from this morning are not the same evidence."""
        state = _state([(SignalCode.CREATININE, 2.5, 40)])
        worst = worst_in_window(state, SignalCode.CREATININE, renal_points_of, T0,
                                higher_is_worse=True)
        assert worst.value == 2.5
        assert worst.outside_window is True
        assert worst.considered == 0

    def test_the_fallback_can_be_refused(self):
        state = _state([(SignalCode.CREATININE, 2.5, 40)])
        worst = worst_in_window(state, SignalCode.CREATININE, renal_points_of, T0,
                                fall_back_to_last_known=False)
        assert worst.measured is False

    def test_a_shorter_window_can_be_asked_for(self):
        state = _state([(SignalCode.PLATELETS, 20, 10), (SignalCode.PLATELETS, 200, 1)])
        worst = worst_in_window(state, SignalCode.PLATELETS, coagulation_points_of, T0,
                                window=timedelta(hours=4), higher_is_worse=False)
        assert worst.value == 200


class TestNothingIsInvented:
    def test_an_unmeasured_parameter_reports_zero_points_and_says_it_was_not_measured(self):
        """SOFA grades a missing organ as 0 points. That is correct for the score and dangerous
        for a reader, so the absence travels next to the number instead of replacing it."""
        worst = worst_in_window(PatientState("y"), SignalCode.BILIRUBIN,
                                lambda v: 0, T0)
        assert worst.points == 0
        assert worst.measured is False
        assert worst.value is None and worst.at is None

    def test_every_cell_carries_the_measurement_behind_it(self):
        """A physician confirming this form has to be able to find the value in the chart."""
        state = _state([(SignalCode.PLATELETS, 45, 6)], source="lab-analyzer-2")
        worst = worst_in_window(state, SignalCode.PLATELETS, coagulation_points_of, T0)
        assert worst.at == T0 - timedelta(hours=6)
        assert worst.source == "lab-analyzer-2"


class TestRankingIsSeparateFromScoring:
    def test_the_nadir_is_shown_even_when_the_table_only_asks_a_yes_or_no(self):
        """SOFA grades mean arterial pressure as a single threshold at 70, so scoring alone cannot
        choose between a MAP of 68 and one of 42 — and the form must show the 42."""
        state = _state([(SignalCode.MAP, 68, 5), (SignalCode.MAP, 42, 3),
                        (SignalCode.MAP, 66, 1)])
        worst = worst_in_window(state, SignalCode.MAP, lambda v: 1 if v < 70 else 0, T0,
                                higher_is_worse=False)
        assert worst.value == 42
        assert worst.points == 1

    def test_the_peak_is_reported_even_when_two_values_share_a_band(self):
        """Creatinine 3.9 and 3.6 both score 3 points. A form showing 3.6 when the patient reached
        3.9 is quietly under-reporting the day, and the physician checking it would not find the
        number in the chart where the form says it is."""
        state = _state([(SignalCode.CREATININE, 3.9, 8), (SignalCode.CREATININE, 3.6, 1)])
        worst = worst_in_window(state, SignalCode.CREATININE, renal_points_of, T0,
                                higher_is_worse=True)
        assert worst.value == 3.9

    def test_ties_go_to_the_most_recent_measurement(self):
        state = _state([(SignalCode.PLATELETS, 45, 8), (SignalCode.PLATELETS, 45, 2)])
        worst = worst_in_window(state, SignalCode.PLATELETS, coagulation_points_of, T0,
                                higher_is_worse=False)
        assert worst.at == T0 - timedelta(hours=2)
