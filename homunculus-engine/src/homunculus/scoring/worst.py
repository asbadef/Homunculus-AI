# src/homunculus/scoring/worst.py
"""The worst value in a window — the operation every severity score is defined on. (M3)

The hospital's own form says it in a footnote at the bottom of the printout:

    "Skor, önceki 24 saat içindeki **en kötü değere** göre verilir."
    "Ölçülmeyen değer varsa en yakın ölçüm değerine göre puanlanır."

That single sentence is the whole reason this module exists, and the reason the product is worth
something. Computing a score from the *latest* value is easy and wrong: it reports a patient as
better than they were at their worst, which is the direction that matters. Computing it from the
worst value is what a physician does today by reading back through a paper chart — and that, not
the arithmetic, is the work we are actually replacing.

**"Worst" is defined by the score's own table, not by min or max.** For platelets the worst value
is the lowest; for creatinine the highest; for temperature it is whichever end is further from
normal. Trying to define it without the table produces a rule that is right for some parameters and
silently wrong for others. So every function here takes the band function with it.

**Nothing is invented.** A parameter with no measurement in the window comes back as "no value",
carrying that fact rather than a zero. SOFA scores a missing organ as 0 points, which is correct
for the score and dangerous for a reader — so the absence travels alongside the points, and the
screen says which cells were actually measured.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from homunculus.canonical import Observation, SignalCode
from homunculus.state.timeline import PatientState

# The window the severity scores are defined over. Operational default, overridable per call:
# a patient admitted four hours ago has no 24 hours to look back on, and the form must be able
# to say so rather than quietly score a shorter period as if it were a full day.
DEFAULT_WINDOW = timedelta(hours=24)


@dataclass(frozen=True)
class WorstValue:
    """One cell of a severity form: what it scored, which measurement produced it, and when.

    `at` is the point of the whole thing. A physician confirming this form has to be able to find
    the measurement in the chart; a number with no timestamp is a number they have to take on
    trust, and clinicians are right not to.
    """
    code: SignalCode
    value: float | None
    at: datetime | None
    points: int
    source: str = ""              # the device or account the measurement came from
    considered: int = 0           # how many measurements were in the window
    outside_window: bool = False  # True when the value came from before the window (fallback)
    # True when a clinician replaced what the record held. The points are still computed from the
    # score's own table — a person corrects the VALUE, never the score — but the form has to show
    # which cells a human changed, or a corrected form is indistinguishable from a measured one.
    overridden: bool = False
    original: float | None = None

    @property
    def measured(self) -> bool:
        return self.value is not None

    def as_dict(self) -> dict:
        return {
            "code": self.code.value,
            "value": self.value,
            "at": self.at.isoformat() if self.at is not None else None,
            "points": self.points,
            "source": self.source,
            "considered": self.considered,
            "measured": self.measured,
            "outside_window": self.outside_window,
            "overridden": self.overridden,
            "original": self.original,
        }


def worst_observation(observations: list[Observation], points_of: Callable[[float], int],
                      higher_is_worse: bool | None = None) -> Observation | None:
    """The observation ranked worst: most points first, then the more extreme value.

    `higher_is_worse` is the direction of the parameter, and leaving it out is usually a bug.
    Points alone cannot order two values inside one band — creatinine 3.9 and 3.6 both score 3 —
    and a form that shows 3.6 when the patient reached 3.9 is quietly under-reporting the day. The
    same thing bites harder where a parameter has no bands of its own: SOFA grades mean arterial
    pressure as one threshold at 70, so points cannot tell a MAP of 68 from one of 42.

    Ties between genuinely equal values go to the most recent. When two measurements are the same
    number, the later one is the one a physician will recognise from the chart they were just
    reading, and it is the one that still describes the patient.
    """
    if not observations:
        return None

    def rank(obs: Observation):
        extremity = 0.0
        if higher_is_worse is True:
            extremity = obs.value
        elif higher_is_worse is False:
            extremity = -obs.value
        return (points_of(obs.value), extremity, obs.timestamp)

    return max(observations, key=rank)


def worst_in_window(state: PatientState, code: SignalCode,
                    points_of: Callable[[float], int], now: datetime,
                    window: timedelta = DEFAULT_WINDOW,
                    fall_back_to_last_known: bool = True,
                    higher_is_worse: bool | None = None) -> WorstValue:
    """The worst measurement of `code` in the window, scored by its own band table.

    `higher_is_worse` states the parameter's direction — up for creatinine and bilirubin, down for
    platelets, GCS, PaO2/FiO2 and mean arterial pressure. It decides which of two values inside the
    same band is reported, which is what a physician checks the form against. See
    `worst_observation`.

    `fall_back_to_last_known` implements the form's second footnote — "a parameter with no
    measurement is scored from the nearest measurement". It is reported as `outside_window=True`
    rather than silently blended in, because a creatinine from three days ago and one from this
    morning are not the same evidence and the person signing the form is entitled to know which
    they are signing.
    """
    since = now - window
    inside = state.window(code, since, now)
    if inside:
        best = worst_observation(inside, points_of, higher_is_worse)
        return WorstValue(code=code, value=best.value, at=best.timestamp,
                          points=points_of(best.value), source=best.source_device,
                          considered=len(inside))

    if fall_back_to_last_known:
        previous = [o for o in state.history(code) if o.timestamp < since]
        if previous:
            last = previous[-1]
            return WorstValue(code=code, value=last.value, at=last.timestamp,
                              points=points_of(last.value), source=last.source_device,
                              considered=0, outside_window=True)

    # Nothing at all. Points are 0 because that is what the score says; `measured` is False
    # because that is what actually happened, and the two must not be confused.
    return WorstValue(code=code, value=None, at=None, points=0, considered=0)
