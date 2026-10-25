# src/homunculus/api/ackstore.py
"""Per-tenant acknowledgement + escalation state, kept OUTSIDE the frozen Alert (which the engine
regenerates on every ingest). Keyed by (patient_id, kind).

Since G2-A1 (O17) it also keeps what the engine does not: the alerts the lifecycle hook last saw
firing, and the critical ones whose rule stopped before anyone acknowledged them (the latch).
`api/alert_lifecycle.py` maintains both."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from homunculus.reco.engine import Alert


@dataclass
class AckStore:
    acks: dict[tuple[str, str], dict] = field(default_factory=dict)
    first_seen: dict[tuple[str, str], datetime] = field(default_factory=dict)
    escalated: set[tuple[str, str]] = field(default_factory=set)
    # G2-A1, D3: a critical alert whose rule stopped firing while nobody had acknowledged it, kept
    # until someone does — {"alert": the alert as it last fired (asdict), "resolved_at": when}.
    resolved: dict[tuple[str, str], dict] = field(default_factory=dict)
    # G2-A1, X2: what the lifecycle hook last saw firing. The engine's bucket is already replaced
    # when the hook runs, so this is how it knows which kinds an evaluation dropped, and what a
    # latched one said.
    firing: dict[tuple[str, str], Alert] = field(default_factory=dict)

    def stamp_first_seen(self, patient_id: str, kind: str, now: datetime) -> bool:
        """Record when an alert was first seen. Returns True only if this is a NEW stamp
        (so the caller can audit it exactly once for restart persistence)."""
        key = (patient_id, kind)
        if key in self.first_seen:
            return False
        self.first_seen[key] = now
        return True

    def acknowledge(self, patient_id: str, kind: str, role: str, now: datetime) -> None:
        self.acks[(patient_id, kind)] = {"by": role, "at": now}

    def prune(self, live_keys: set[tuple[str, str]],
              firing_keys: set[tuple[str, str]] | None = None) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh.

        `live_keys` are the kinds still on the board: firing, or latched. With `firing_keys`, the
        ones firing now (G2-A1): only a firing alert can be escalated (D8), and a latched alert
        that fires again is no longer latched — its episode goes on (X2)."""
        for mapping in (self.acks, self.first_seen):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        if firing_keys is None:
            self.escalated &= live_keys
            return
        self.escalated &= firing_keys
        for key in [k for k in self.resolved if k in firing_keys]:
            del self.resolved[key]
