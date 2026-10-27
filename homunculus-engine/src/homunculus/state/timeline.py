# src/homunculus/state/timeline.py
"""Per-patient current values, history, and staleness — and `thin()`, a pure helper that caps an
observation series for drawing."""
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

    def copy(self) -> "PatientState":
        """An independent state with the same readings (Aşama B, D9: the shadow engine starts as a
        copy of the real one, and `Engine.adopt` returns one patient to it). Each series is a new
        list, so ingesting into, or dropping from, either state leaves the other alone; the
        observations themselves are shared, which is safe because an `Observation` is frozen and
        this class only ever appends to a series or replaces it, never edits a reading. That is
        the whole point against `copy.deepcopy`, which rebuilt every reading: 13 beds of 20 000
        readings took 2.2 s, and this takes milliseconds."""
        twin = PatientState(self.patient_id)
        for code, series in self._history.items():
            twin._history[code] = list(series)
        return twin

    def drop_source(self, prefix: str, before: datetime | None = None) -> None:
        """Forget the observations whose `source_device` starts with `prefix` — all of them, or
        only those stamped before `before` (Aşama B, D5 and D9: a monitor's samples leave a
        patient's shadow state when the bed's patient changes, and age out after a day). A code
        left with no observation is removed, so `latest()` answers None as for a code never seen."""
        for code in list(self._history):
            kept = [o for o in self._history[code]
                    if not (o.source_device.startswith(prefix) and (before is None or o.timestamp < before))]
            if kept:
                self._history[code] = kept
            else:
                del self._history[code]

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

    Preconditions: `series` in time order, as `window()` returns it; values are finite (the
    gateways' contract).

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
