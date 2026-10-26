# src/homunculus/state/repository.py
"""Patient state storage. In-memory is the default and the hot cache;
a Postgres adapter implements the same protocol in Plan B."""
from __future__ import annotations

from typing import Protocol

from homunculus.state.timeline import PatientState


class PatientRepository(Protocol):
    def get_or_create(self, patient_id: str) -> PatientState: ...
    def patient_ids(self) -> list[str]: ...
    def remove(self, patient_id: str) -> None: ...


class InMemoryPatientRepository:
    def __init__(self) -> None:
        self._states: dict[str, PatientState] = {}

    def get_or_create(self, patient_id: str) -> PatientState:
        if patient_id not in self._states:
            self._states[patient_id] = PatientState(patient_id)
        return self._states[patient_id]

    def patient_ids(self) -> list[str]:
        return list(self._states)

    def remove(self, patient_id: str) -> None:
        """Forget a patient's readings (G2-A11, D9). Nothing to forget is not an error."""
        self._states.pop(patient_id, None)
