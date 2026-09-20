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


class TestItIsNotTheAlertingSofa:
    def test_the_form_can_exceed_the_live_score_because_it_looks_back(self):
        """The live rule reads the latest values and sees a recovering patient; the form reads the
        worst and sees the day. Both are right, and they are not the same number."""
        from homunculus.rules.sofa import total_sofa
        state = _state([(SignalCode.PLATELETS, 18, 10),    # 4 points at its worst
                        (SignalCode.PLATELETS, 220, 0.5)])  # 0 points now
        assert total_sofa(state) == 0
        assert sofa_form.build(state, T0).total == 4
