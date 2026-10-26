# src/homunculus/api/ackstore.py
"""Per-tenant acknowledgement + escalation state, kept OUTSIDE the frozen Alert (which the engine
regenerates on every ingest). Keyed by (patient_id, kind).

Since G2-A1 (O17) it also keeps what the engine does not: the alerts the lifecycle hook last saw
firing, and the critical ones whose rule stopped before anyone acknowledged them (the latch).
`api/alert_lifecycle.py` maintains both.

Since X13 it keeps the escalation chain: consecutive episodes of one (patient, kind) whose gap — from
the clear to the next first sight — is at most the escalation delay share one escalation clock
(`clock_from`) and one page to the doctor (`paged`). A return is still a new episode (D5): its own
first-seen (the board's ▲), no inherited acknowledgement, a nurse told again. Without the chain an
alert flapping faster than the delay — NEWS2 7 / 4 every two minutes — never reached the doctor.
An answer ends the chain (X13 review): only an episode that ended unanswered leaves one, so a return
after an acknowledgement starts a new clock and can page the doctor anew."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import NamedTuple

from homunculus.reco.engine import Alert


class Chain(NamedTuple):
    """An escalation chain whose episode has left the board (X13), kept for the escalation delay in
    case the alert returns: its clock, when its episode ended, and whether its doctor was paged."""
    clock_from: datetime
    cleared_at: datetime
    paged: bool


@dataclass
class AckStore:
    acks: dict[tuple[str, str], dict] = field(default_factory=dict)
    first_seen: dict[tuple[str, str], datetime] = field(default_factory=dict)
    escalated: set[tuple[str, str]] = field(default_factory=set)
    # G2-A1, D3: a critical alert whose rule stopped firing while nobody had acknowledged it, kept
    # until someone does — {"alert": as last fired (asdict), "resolved_at": when, "first_seen": stamp|None}.
    resolved: dict[tuple[str, str], dict] = field(default_factory=dict)
    # G2-A1, X2: what the lifecycle hook last saw firing. The engine's bucket is already replaced
    # when the hook runs, so this is how it knows which kinds an evaluation dropped, and what a
    # latched one said.
    firing: dict[tuple[str, str], Alert] = field(default_factory=dict)
    # G2-A1, final review: the escalations the doctor was already PAGED for. `escalated` follows
    # the clock — a latch drops it and a return raises it again — so on its own a critical that
    # flaps (lactate 3.4 / 1.5 every two minutes) would page the doctor on each swing. It goes with
    # the episode like `first_seen` — a return inside the same episode is not paged again — and
    # since X13 a return that continues its chain gets it back from `recent`: one page per chain.
    paged: set[tuple[str, str]] = field(default_factory=set)
    # X13: when each live key's escalation clock started — its chain's first sight, at or before its
    # episode's `first_seen`. What `escalate()` measures; the board shows `first_seen`.
    clock_from: dict[tuple[str, str], datetime] = field(default_factory=dict)
    # X13: the chains of episodes that left the board unanswered, kept for the escalation delay.
    # Written by the prune; read, and spent, by the next stamp of the key.
    recent: dict[tuple[str, str], Chain] = field(default_factory=dict)

    def stamp_first_seen(self, patient_id: str, kind: str, now: datetime,
                         chain_gap: timedelta | None = None) -> bool:
        """Record when an alert was first seen. Returns True only if this is a NEW stamp
        (so the caller can audit it exactly once for restart persistence).

        A new stamp also sets the escalation clock (X13). If the key's last episode left the board
        unanswered at most `chain_gap` (the escalation delay) ago, this one continues its chain: the
        chain's clock, and its page if the doctor was paged. Otherwise — or with no `chain_gap` —
        the clock starts now. Chains older than the gap are forgotten here."""
        key = (patient_id, kind)
        if key in self.first_seen:
            return False
        self.first_seen[key] = now
        chain = self.recent.pop(key, None)
        if chain is not None and chain_gap is not None and now - chain.cleared_at <= chain_gap:
            self.clock_from[key] = chain.clock_from
            if chain.paged:
                self.paged.add(key)
        else:
            self.clock_from[key] = now
        if chain_gap is not None:
            for old in [k for k, c in self.recent.items() if now - c.cleared_at > chain_gap]:
                del self.recent[old]
        return True

    def remember_chain(self, key: tuple[str, str], cleared_at: datetime) -> None:
        """Keep the chain of an episode that is leaving the board unanswered at `cleared_at` (X13),
        before its state is dropped. A key never stamped has no clock, and nothing is kept."""
        clock = self.clock_from.get(key, self.first_seen.get(key))
        if clock is not None:
            self.recent[key] = Chain(clock, cleared_at, key in self.paged)

    def acknowledge(self, patient_id: str, kind: str, role: str, now: datetime) -> None:
        self.acks[(patient_id, kind)] = {"by": role, "at": now}

    def prune(self, live_keys: set[tuple[str, str]],
              firing_keys: set[tuple[str, str]] | None = None,
              now: datetime | None = None) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh.

        `live_keys` are the kinds still on the board: firing, or latched. With `firing_keys`, the
        ones firing now (G2-A1): only a firing alert can be escalated (D8), and a latched alert
        that fires again is no longer latched — its episode goes on (X2). The page record goes
        with the episode's first-seen: it is kept for every live key, firing or latched, and so is
        the escalation clock. With `now`, when the prune runs, each episode that leaves the board
        unanswered is remembered as its chain first (X13). An acknowledged one is not: an answer
        ends the chain (X13 review), and its answered minutes are no return's unanswered ones."""
        if now is not None:
            for key in [k for k in self.first_seen if k not in live_keys and k not in self.acks]:
                self.remember_chain(key, now)
        for mapping in (self.acks, self.first_seen, self.clock_from):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        self.paged &= live_keys
        if firing_keys is None:
            self.escalated &= live_keys
            return
        self.escalated &= firing_keys
        for key in [k for k in self.resolved if k in firing_keys]:
            del self.resolved[key]

    def forget_patient(self, patient_id: str) -> None:
        """Drop every entry of one patient — ack, first-seen, clock, escalation, page, latch, the
        hook's last view and any remembered chain (G2-A11, D9). A discharge ends the patient's
        every episode at once (`alert_lifecycle.retire_state`); nothing of them may answer a later
        number, and nothing is left for the escalation cycle to page."""
        for mapping in (self.acks, self.first_seen, self.clock_from, self.resolved, self.firing,
                        self.recent):
            for key in [k for k in mapping if k[0] == patient_id]:
                del mapping[key]
        self.escalated = {k for k in self.escalated if k[0] != patient_id}
        self.paged = {k for k in self.paged if k[0] != patient_id}
