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
after an acknowledgement starts a new clock and can page the doctor anew.

Since G2-B5 a chain also carries the call to the rapid-response team (`rrt_calls`), as it carries the
page: a flap inside the escalation delay does not un-call the team.

Since G2-B5b it keeps the snoozes (`snoozes`): a snoozed alarm waits for no answer and does not escalate
until its `until`, when the escalation cycle ends it (`expire_snoozes`) with a fresh escalation clock and a
cleared page. A snooze does NOT ride a chain: a return is a new alarm, and sounds."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import NamedTuple

from homunculus.api.snooze import snooze_cap
from homunculus.reco.engine import Alert


def _within_cap(snooze: dict, now: datetime) -> bool:
    """G2-B5b (review, fix 2): is what is left of `snooze` from `now` within its severity's cap?"""
    cap = snooze_cap(snooze["severity"])
    return cap is not None and snooze["until"] - now <= timedelta(minutes=cap)


class Chain(NamedTuple):
    """An escalation chain whose episode has left the board (X13), kept for the escalation delay in
    case the alert returns: its clock, when its episode ended, whether its doctor was paged, and (G2-B5)
    the call to the rapid-response team the episode ended with, if it had one — the team was called to
    this alarm, and a flap does not un-call it, as it does not un-page the doctor."""
    clock_from: datetime
    cleared_at: datetime
    paged: bool
    rrt_call: dict | None = None


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
    # G2-B5 (spec 2026-11-09-g2b-b5-rrt-design.md, D4): the alarms a person called the rapid-response team to —
    # {"by": username, "at": datetime, "reason": text} — kept with the episode like `acks`: an acknowledgement
    # answers the call (`acknowledge`, and `alert_lifecycle.acknowledge_latched`), a discharge forgets it
    # (`forget_patient`), and an episode that leaves the board takes it off the board with it (`prune`) —
    # but an episode that ends UNANSWERED leaves its X13 chain with the call in it (`remember_chain`), and a
    # return inside the escalation delay gets it back (`stamp_first_seen`), as it gets the page back. After a
    # gap longer than the delay, or an acknowledgement, the call is over.
    rrt_calls: dict[tuple[str, str], dict] = field(default_factory=dict)
    # G2-B5b (spec 2026-11-10-g2b-b5b-ertele-design.md, D3): the snoozed alarms, one per episode —
    # {"by": username, "at": datetime, "until": datetime, "minutes": int, "reason": code, "reason_text": text|None,
    # "severity": the alarm's when it was snoozed}. While one runs, the alarm is out of the escalation (`escalate`
    # is handed them) and the dashboard's waiting queue. An acknowledgement ends it (`acknowledge`), so do the
    # episode's end (`prune`; no X13 chain carries it), a discharge (`forget_patient`), the same alarm worse
    # (`alert_lifecycle.sync_alerts`, plan note 1) and its own time (`expire_snoozes`). A second snooze replaces it.
    snoozes: dict[tuple[str, str], dict] = field(default_factory=dict)

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
            if chain.rrt_call is not None:
                self.rrt_calls.setdefault(key, chain.rrt_call)   # G2-B5: the team stays called
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
            self.recent[key] = Chain(clock, cleared_at, key in self.paged, self.rrt_calls.get(key))

    def call_rrt(self, patient_id: str, kind: str, by: str, reason: str, now: datetime) -> bool:
        """Record a call to the rapid-response team (G2-B5, D3). False when the alert already has one: the first
        call stands, and the caller writes nothing more."""
        key = (patient_id, kind)
        if key in self.rrt_calls:
            return False
        self.rrt_calls[key] = {"by": by, "at": now, "reason": reason}
        return True

    def snooze(self, patient_id: str, kind: str, *, by: str, at: datetime, minutes: int, reason: str,
               reason_text: str | None, severity: str) -> dict:
        """Snooze one alarm until `at` + `minutes` (G2-B5b, D3). A snooze already running is replaced, with its own
        `until`. The alarm leaves the escalated set (no escalation while snoozed), but the doctor's page stays sent:
        `paged` is untouched. The rules are the caller's (`api/snooze.py`)."""
        key = (patient_id, kind)
        entry = {"by": by, "at": at, "until": at + timedelta(minutes=minutes), "minutes": minutes,
                 "reason": reason, "reason_text": reason_text, "severity": severity}
        self.snoozes[key] = entry
        self.escalated.discard(key)
        return entry

    def expire_snoozes(self, now: datetime) -> list[tuple[str, str]]:
        """End every snooze whose `until` is at or before `now`, and say whose (G2-B5b, spec §2). The alarm waits
        for an answer again. Its escalation clock starts at `until`, as the Postgres rule re-fired with a fresh
        `fired_at`, and its page is cleared: silence after a bounded decision is a new failure to answer, and it
        may page the doctor again.

        A clock stepped back (review, fix 2) ends a snooze too: one taken later than `now` reads, or one whose
        `until` lies further from `now` than its severity's cap, can no longer be held to the owner's cap. It ends
        the same way, with the clock from `now` — `until` is still to come."""
        due: dict[tuple[str, str], datetime] = {}
        for key, entry in self.snoozes.items():
            if entry["until"] <= now:
                due[key] = entry["until"]
            elif entry["at"] > now or not _within_cap(entry, now):
                due[key] = now
        for key in sorted(due):
            del self.snoozes[key]
            if key in self.clock_from:
                self.clock_from[key] = due[key]
            self.paged.discard(key)
        return sorted(due)

    def acknowledge(self, patient_id: str, kind: str, role: str, now: datetime) -> None:
        self.acks[(patient_id, kind)] = {"by": role, "at": now}
        self.rrt_calls.pop((patient_id, kind), None)   # G2-B5: an answer ends the call
        self.snoozes.pop((patient_id, kind), None)     # G2-B5b: and the snooze

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
        for mapping in (self.acks, self.first_seen, self.clock_from, self.rrt_calls, self.snoozes):   # + G2-B5b
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
                        self.recent, self.rrt_calls, self.snoozes):
            for key in [k for k in mapping if k[0] == patient_id]:
                del mapping[key]
        self.escalated = {k for k in self.escalated if k[0] != patient_id}
        self.paged = {k for k in self.paged if k[0] != patient_id}
