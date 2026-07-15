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

    def sum_since(self, code: SignalCode, since: datetime) -> float:
        return sum(o.value for o in self._history.get(code, []) if o.timestamp >= since)
