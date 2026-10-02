# src/homunculus/state/profile.py
"""Clinician-entered patient context: comorbidities and baseline vital ranges.

This is static per-patient context provided by a clinician / admission record — NOT
learned from telemetry (that is a later ML sub-project). It is the input the
patient-relative alerting layer needs to tell chronic-normal from acute change.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from homunculus.canonical import SignalCode


@dataclass(frozen=True)
class BaselineRange:
    """The patient's own charted normal range for one signal. Inclusive on both ends."""
    low: float
    high: float

    def contains(self, value: float) -> bool:
        return self.low <= value <= self.high


@dataclass(frozen=True)
class PatientProfile:
    patient_id: str
    comorbidities: frozenset[str] = frozenset()
    baselines: dict[SignalCode, BaselineRange] = field(default_factory=dict)
    # The patient's own pre-infection SOFA total (0-24), charted by a clinician.
    #
    # Sepsis-3 defines sepsis as a *rise* of >= 2 SOFA points, and says the baseline "can be
    # assumed to be zero in patients not known to have preexisting organ dysfunction". `None`
    # means nobody has charted one, so that assumption applies. It is deliberately not derived
    # from the comorbidity list: mapping "chronic kidney disease" to a renal sub-score would be
    # us inventing a number the source does not give, on the patient it matters most for.
    baseline_sofa: int | None = None
