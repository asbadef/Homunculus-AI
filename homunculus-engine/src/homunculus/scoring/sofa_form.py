# src/homunculus/scoring/sofa_form.py
"""SOFA as a severity FORM — the first tab of the scoring module.

SOFA goes first for one reason: it is the only score in the hospital's form whose table this
project already holds with a source (`sepsis-3-jama-2016`). APACHE II, PRISM and SNAP wait for
their tables, and waiting is the correct behaviour — a band copied from a calculator's JavaScript
produces a plausible wrong number, and a plausible wrong number survives an audit.

What this produces is not a score. It is a **filled form**: six organ rows, each carrying the worst
value of the last 24 hours, the measurement that produced it, when it was taken, and what it
scored. The physician's job becomes confirming and signing rather than reading back through a paper
chart — which is the work being replaced, and the only part of it that was ever hard.

Three refusals are built in:

* **It does not alert.** SOFA here is prognostic; the alerting use lives in `rules/septic_shock.py`
  and stays there.
* **It does not invent.** An organ with no measurement in the window is reported as unmeasured,
  not as zero, even though the score itself grades it zero.
* **It does not sign itself.** The form comes back unsigned. A severity score entering a hospital's
  quality reporting with no clinician behind it is the failure this module must not enable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules import sofa as sofa_rules
from homunculus.scoring.worst import DEFAULT_WINDOW, WorstValue, worst_in_window
from homunculus.state.timeline import PatientState

# Organ rows scored from a single value. Respiration and cardiovascular are not here: the first
# needs to know whether the patient was supported, the second grades four drugs at once.
# (organ, signal, band table, does a HIGHER value mean a sicker patient?)
_SINGLE_VALUE_ROWS: list[tuple[str, SignalCode, object, bool]] = [
    ("coagulation", SignalCode.PLATELETS, sofa_rules.coagulation_points_of, False),
    ("liver", SignalCode.BILIRUBIN, sofa_rules.liver_points_of, True),
    ("cns", SignalCode.GCS, sofa_rules.cns_points_of, False),
    ("renal", SignalCode.CREATININE, sofa_rules.renal_points_of, True),
]


def _no_standalone_points(_value: float) -> int:
    """A parameter that contributes to a row without being banded on its own.

    Mean arterial pressure and the four vasoactive rates have no SOFA points of their own — the
    cardiovascular row grades them together. Reporting a fabricated per-parameter score for them
    would put a number on the form that the source does not define.
    """
    return 0

_PRESSORS: dict[str, SignalCode] = {
    "norepinephrine": SignalCode.NOREPINEPHRINE_RATE,
    "epinephrine": SignalCode.EPINEPHRINE_RATE,
    "dopamine": SignalCode.DOPAMINE_RATE,
    "dobutamine": SignalCode.DOBUTAMINE_RATE,
}

ORGAN_FAILURE_POINTS = 3   # sepsis-3: ">= 3 for a system is organ failure for that system"


@dataclass
class OrganRow:
    organ: str
    points: int
    inputs: list[WorstValue] = field(default_factory=list)

    @property
    def measured(self) -> bool:
        return any(i.measured for i in self.inputs)

    @property
    def failure(self) -> bool:
        """The printed form's own footnote: a system scoring >= 3 is called organ failure."""
        return self.points >= ORGAN_FAILURE_POINTS

    def as_dict(self) -> dict:
        return {"organ": self.organ, "points": self.points, "measured": self.measured,
                "failure": self.failure, "inputs": [i.as_dict() for i in self.inputs]}


@dataclass
class SofaForm:
    patient_id: str
    total: int
    rows: list[OrganRow]
    window_hours: float
    window_from: str
    window_to: str
    unmeasured_organs: list[str]
    # A form whose window is longer than the patient has been here is a form scored on a shorter
    # period than it claims. Reported, never quietly presented as a full 24 hours.
    covers_full_window: bool
    signed: bool = False

    def as_dict(self) -> dict:
        return {
            "patient_id": self.patient_id,
            "score": "SOFA",
            "source": "sepsis-3-jama-2016",
            "total": self.total,
            "rows": [r.as_dict() for r in self.rows],
            "window_hours": self.window_hours,
            "window_from": self.window_from,
            "window_to": self.window_to,
            "unmeasured_organs": self.unmeasured_organs,
            "covers_full_window": self.covers_full_window,
            "organ_failures": [r.organ for r in self.rows if r.failure],
            "corrected_cells": [c.code.value for r in self.rows for c in r.inputs if c.overridden],
            "signed": self.signed,
        }


def _apply_override(cell: WorstValue, points_of, corrected: float | None) -> WorstValue:
    """Replace a cell's value with the clinician's, and re-score it from the table.

    The points are recomputed, never taken. A clinician says "the platelet count was 38"; they do
    not say "this row scores 2". Accepting a typed point value would put an unbanded number into
    a hospital's quality report with nothing downstream able to tell it from a computed one.
    """
    if corrected is None:
        return cell
    return WorstValue(
        code=cell.code, value=corrected, at=None, points=points_of(corrected),
        source="hekim", considered=cell.considered, outside_window=False,
        overridden=True, original=cell.value,
    )


def _respiration_row(state: PatientState, now: datetime, window: timedelta,
                     overrides: dict | None = None) -> OrganRow:
    """Respiration needs two facts, and only one of them is a measurement.

    The PaO2/FiO2 bands at 3 and 4 points apply only on respiratory support, so the worst PF ratio
    has to be scored against whether the patient was supported. Support is taken as of the worst
    reading rather than as of now: scoring an eight-hour-old ratio against a ventilator connected
    since would credit the score for a treatment that was not running at the time.
    """
    since = now - window
    supported_at = {o.timestamp for o in state.window(SignalCode.ON_RESP_SUPPORT, since, now)
                    if o.value >= 1.0}
    latest_support = state.latest(SignalCode.ON_RESP_SUPPORT)
    fallback_support = bool(latest_support is not None and latest_support.value >= 1.0)

    def points_of(pf: float) -> int:
        # Supported if any support observation exists in the window, else the last known state.
        on_support = bool(supported_at) or fallback_support
        return sofa_rules.respiration_points_of(pf, on_support)

    worst = worst_in_window(state, SignalCode.PAO2_FIO2, points_of, now, window,
                            higher_is_worse=False)
    worst = _apply_override(worst, points_of, (overrides or {}).get(SignalCode.PAO2_FIO2))
    return OrganRow(organ="respiration", points=worst.points, inputs=[worst])


def _cardiovascular_row(state: PatientState, now: datetime, window: timedelta,
                        overrides: dict | None = None) -> OrganRow:
    """The row that is not a measurement at all.

    SOFA's cardiovascular limb grades the vasoactive SUPPORT a patient needed, so the worst of the
    window is the heaviest support running at any point in it — each drug taken at its own worst,
    then scored together. Taking the four drugs' peaks independently is deliberate: a patient
    weaned off noradrenaline onto dobutamine was, at their worst, on noradrenaline.
    """
    peaks: dict[str, WorstValue] = {}
    for name, code in _PRESSORS.items():
        # Worst = the highest dose that ran at any point in the window.
        peaks[name] = _apply_override(
            worst_in_window(state, code, _no_standalone_points, now, window,
                            higher_is_worse=True),
            _no_standalone_points, (overrides or {}).get(code))
    # Worst = the LOWEST pressure. Ranked by value rather than by the row's yes/no threshold, or
    # the form would show whichever sub-70 reading happened to be last instead of the real nadir.
    map_worst = _apply_override(
        worst_in_window(state, SignalCode.MAP, _no_standalone_points, now, window,
                        higher_is_worse=False),
        _no_standalone_points, (overrides or {}).get(SignalCode.MAP))

    points = sofa_rules.cardiovascular_points_of(
        map_value=map_worst.value,
        norepinephrine=peaks["norepinephrine"].value or 0.0,
        epinephrine=peaks["epinephrine"].value or 0.0,
        dopamine=peaks["dopamine"].value or 0.0,
        dobutamine=peaks["dobutamine"].value or 0.0,
    )
    inputs = [map_worst] + [peaks[name] for name in _PRESSORS if peaks[name].measured]
    return OrganRow(organ="cardiovascular", points=points, inputs=inputs)


def build(state: PatientState, now: datetime, window: timedelta = DEFAULT_WINDOW,
          admitted_at: datetime | None = None,
          overrides: dict[SignalCode, float] | None = None) -> SofaForm:
    """The filled SOFA form for one patient over the preceding window.

    `overrides` are the clinician's corrections, keyed by signal. They replace the value the record
    held and the row is re-scored from the band table — so there is exactly one scorer, and a
    corrected form and a measured one can still be told apart on the printout.
    """
    rows = [_respiration_row(state, now, window, overrides),
            _cardiovascular_row(state, now, window, overrides)]
    for organ, code, points_of, higher_is_worse in _SINGLE_VALUE_ROWS:
        worst = worst_in_window(state, code, points_of, now, window,
                                higher_is_worse=higher_is_worse)
        worst = _apply_override(worst, points_of, (overrides or {}).get(code))
        rows.append(OrganRow(organ=organ, points=worst.points, inputs=[worst]))

    since = now - window
    covers = admitted_at is None or admitted_at <= since
    return SofaForm(
        patient_id=state.patient_id,
        total=sum(r.points for r in rows),
        rows=rows,
        window_hours=window.total_seconds() / 3600,
        window_from=since.isoformat(),
        window_to=now.isoformat(),
        unmeasured_organs=[r.organ for r in rows if not r.measured],
        covers_full_window=covers,
    )
