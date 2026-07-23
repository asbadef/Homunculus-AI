# src/homunculus/api/ackstore.py
"""Per-tenant acknowledgement + escalation state, kept OUTSIDE the frozen Alert (which the engine
regenerates on every ingest). Keyed by (patient_id, kind)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AckStore:
    acks: dict[tuple[str, str], dict] = field(default_factory=dict)
    first_seen: dict[tuple[str, str], datetime] = field(default_factory=dict)
    escalated: set[tuple[str, str]] = field(default_factory=set)

    def stamp_first_seen(self, patient_id: str, kind: str, now: datetime) -> None:
        self.first_seen.setdefault((patient_id, kind), now)

    def acknowledge(self, patient_id: str, kind: str, role: str, now: datetime) -> None:
        self.acks[(patient_id, kind)] = {"by": role, "at": now}

    def prune(self, live_keys: set[tuple[str, str]]) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh."""
        for mapping in (self.acks, self.first_seen):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        self.escalated &= live_keys
