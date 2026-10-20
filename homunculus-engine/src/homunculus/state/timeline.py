# src/homunculus/state/timeline.py
"""Per-patient current values, history, and staleness."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from homunculus.canonical import Observation, SignalCode


class PatientState:
    def __init__(self, patient_id: str):
        self.patient_id = patient_id
        self._history: dict[SignalCode, list[Observation]] = defaultdict(list)

    def ingest(self, obs: Observation) -> None:
        series = self._history[obs.code]
        series.append(obs)
        # Keep sorted by timestamp so out-of-order arrivals are handled.
        series.sort(key=lambda o: o.timestamp)

    def latest(self, code: SignalCode) -> Observation | None:
        series = self._history.get(code)
        return series[-1] if series else None

    def history(self, code: SignalCode) -> list[Observation]:
        return list(self._history.get(code, []))

    def age(self, code: SignalCode, now: datetime) -> timedelta | None:
        obs = self.latest(code)
        return None if obs is None else now - obs.timestamp

    def window(self, code: SignalCode, since: datetime,
               until: datetime | None = None) -> list[Observation]:
        """Every observation of `code` in [since, until], oldest first.

        The severity scores are defined on the WORST value in the preceding 24 hours, not the
        latest one — the hospital's own form says so in its footnote. `latest()` cannot answer
        that question, and a score built from `latest()` silently reports a patient as better
        than they were at their worst, which is the direction that matters.
        """
        series = self._history.get(code, [])
        return [o for o in series
                if o.timestamp >= since and (until is None or o.timestamp <= until)]

    def sum_since(self, code: SignalCode, since: datetime) -> float:
        return sum(o.value for o in self._history.get(code, []) if o.timestamp >= since)


def thin(series: list[Observation], max_points: int) -> list[Observation]:
    """At most `max_points` readings of `series` (oldest first), keeping its shape: the series' time
    span is cut into `max_points // 4` equal slices, and each keeps its first, last, lowest and
    highest reading, in their order.

    For a chart, never for a rule: a thinned series has lost readings by construction, and no score
    may be computed from one. At or below the cap it is the series itself (a copy), so the spot-check
    data the wards send today is never touched. The extremes are what is kept because the reading a
    clinician must not lose is the worst one — an average would draw a desaturation to 85 % as a
    dip that never left the 90s.
    """
    if max_points < 4:
        raise ValueError("max_points must be at least 4: each slice keeps up to four readings")
    if len(series) <= max_points:
        return list(series)
    buckets = max_points // 4
    t0 = series[0].timestamp
    span = (series[-1].timestamp - t0).total_seconds()
    slices: dict[int, list[int]] = {}
    for index, obs in enumerate(series):
        at = 0 if span <= 0 else min(buckets - 1,
                                     int((obs.timestamp - t0).total_seconds() / span * buckets))
        slices.setdefault(at, []).append(index)
    keep: set[int] = set()
    for members in slices.values():
        lowest = min(members, key=lambda i: series[i].value)
        highest = max(members, key=lambda i: series[i].value)
        keep.update((members[0], members[-1], lowest, highest))
    return [series[i] for i in sorted(keep)]
