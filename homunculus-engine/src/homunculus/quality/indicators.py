# homunculus-engine/src/homunculus/quality/indicators.py
"""G4-03 «Kalite göstergeleri» (spec 2026-11-11 D4): the answer of `GET /quality`, pure — no database, no clock.

What the route read goes in: the window's audit rows (the alarm episode kinds, `alert_snooze`, `rrt_call`), the board
key → unit map (`router.units_of_keys`), the units the caller reaches with their names, and the window's handovers.
What comes out is counts and times only, with unit ids and names: never a patient key, a person or a free text (a
snooze's `reason_text` and an RRT call's `reason` are not read at all).

PLACING. An episode, a snooze and an RRT call are tied to a unit through their row's patient key. A key the map does
not hold — a patient admitted elsewhere (HIS-fed), a monitor-only id, a legacy key admitted to two units — is
UNPLACED. An unrestricted caller gets every unit and the unplaced block; a scoped caller gets her units only, no
unplaced block, and `coverage` and `hospital` count only what she got.

Alarms are grouped and each group goes through `alarm_quality.summarise` unchanged: a unit's median and p90 are over
its own episodes, `hospital`'s over every episode the caller may see — never a mean of the units' medians.
"""
from __future__ import annotations

import statistics
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime

from homunculus.api.alarm_quality import EPISODE_KINDS, Episode, build_episodes, summarise
from homunculus.api.audit import AuditRecord
from homunculus.api.snooze import SNOOZE_CAPS, SNOOZE_REASONS

#: The two acts `/quality` reads beside the episodes (spec D4 §1): a snooze («Ertele») and a call to the RRT.
SNOOZE = "alert_snooze"
RRT_CALL = "rrt_call"
QUALITY_KINDS = EPISODE_KINDS | {SNOOZE, RRT_CALL}

#: The handover states (`admission.models.HandoverStatus`, a str enum: each member equals its text).
OPEN, OUTGOING_SIGNED, COMPLETED, EXPIRED = "OPEN", "OUTGOING_SIGNED", "COMPLETED", "EXPIRED"


@dataclass(frozen=True)
class HandoverFacts:
    """One handover of the window as `/quality` counts it: its unit, its state and its times — no person, no note."""
    unit_id: uuid.UUID
    status: str
    bridge_expires_at: datetime
    outgoing_signed_at: datetime | None
    incoming_signed_at: datetime | None


@dataclass(frozen=True)
class Reach:
    """The units the caller reaches (id → name) and whether she is scoped (her unit grants, not unrestricted)."""
    units: Mapping[uuid.UUID, str]
    scoped: bool


@dataclass
class _Group:
    episodes: list[Episode] = field(default_factory=list)
    snoozes: list[AuditRecord] = field(default_factory=list)
    calls: list[AuditRecord] = field(default_factory=list)
    handovers: list[HandoverFacts] = field(default_factory=list)

    def counts_anything(self) -> bool:
        return bool(self.episodes or self.snoozes or self.calls or self.handovers)


def _median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


def _p90(values: list[float]) -> float | None:
    """Nearest rank, as `summarise` takes it: never a number between two real ones."""
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, min(len(ordered) - 1, int(round(0.9 * len(ordered))) - 1))], 1)


def alarms_of(episodes: list[Episode], now: datetime) -> dict:
    """One group's alarm figures by `summarise`'s rules. Its patient-level fields (`noisiest_beds`,
    `per_patient_hour`) and its days are not carried."""
    report = summarise(episodes, now)
    return {
        "episodes": report.episodes, "answered": report.answered, "answered_rate": report.answered_rate,
        "median_response_sec": report.median_response_sec, "p90_response_sec": report.p90_response_sec,
        "escalated": report.escalated, "unanswered": report.unanswered,
        "unanswered_resolved": report.unanswered_resolved, "pending": report.pending,
        "per_kind": [{"kind": k.kind, "episodes": k.episodes, "answered": k.answered, "escalated": k.escalated,
                      "unanswered": k.unanswered, "median_response_sec": k.median_response_sec}
                     for k in report.per_kind],
    }


def snoozes_of(rows: list[AuditRecord]) -> dict:
    """One group's snoozes: how many; by reason code and by severity, every code and both severities listed (a 0
    included); the median of the minutes given. A figure of the wrong kind is not counted under any reason, severity
    or median; `reason_text` is never read."""
    by_reason = {reason: 0 for reason in sorted(SNOOZE_REASONS)}
    by_severity = {severity: 0 for severity in sorted(SNOOZE_CAPS)}
    minutes: list[int] = []
    for rec in rows:
        reason, severity, given = rec.payload.get("reason"), rec.payload.get("severity"), rec.payload.get("minutes")
        if isinstance(reason, str) and reason in by_reason:
            by_reason[reason] += 1
        if isinstance(severity, str) and severity in by_severity:
            by_severity[severity] += 1
        if isinstance(given, int) and not isinstance(given, bool):
            minutes.append(given)
    return {"count": len(rows), "by_reason": by_reason, "by_severity": by_severity,
            "median_minutes": _median(minutes)}


def handovers_of(rows: list[HandoverFacts], now: datetime) -> dict:
    """One group's handovers opened in the window: countersigned (COMPLETED); waiting (OUTGOING_SIGNED); expired
    (EXPIRED, or OPEN past its 30-minute bridge — read as `GET /handovers` reads it); an OPEN one inside its bridge is
    opened and nothing else yet. The median and p90 of the outgoing signature → countersignature time, over the
    countersigned ones. No «within 30 minutes» share: a countersignature has no deadline (spec D4)."""
    countersigned = waiting = expired = 0
    times: list[float] = []
    for h in rows:
        if h.status == COMPLETED:
            countersigned += 1
            if h.outgoing_signed_at is not None and h.incoming_signed_at is not None:
                times.append(max(0.0, (h.incoming_signed_at - h.outgoing_signed_at).total_seconds()))
        elif h.status == OUTGOING_SIGNED:
            waiting += 1
        elif h.status == EXPIRED or (h.status == OPEN and now >= h.bridge_expires_at):
            expired += 1
    return {"opened": len(rows), "countersigned": countersigned, "waiting": waiting, "expired": expired,
            "median_countersign_sec": _median(times), "p90_countersign_sec": _p90(times)}


def _figures(group: _Group, now: datetime, *, with_handovers: bool = True) -> dict:
    out = {"alarms": alarms_of(group.episodes, now), "snoozes": snoozes_of(group.snoozes),
           "rrt": {"count": len(group.calls)}}
    if with_handovers:
        out["handovers"] = handovers_of(group.handovers, now)
    return out


def build_report(*, records: list[AuditRecord], key_units: Mapping[str, uuid.UUID], reach: Reach,
                 handovers: Iterable[HandoverFacts], now: datetime, days: int, window_from: str,
                 truncated: bool) -> dict:
    """The answer (spec D4). `records`: the window's rows of QUALITY_KINDS, oldest first; `key_units`: board key →
    unit; `reach`: the units the caller may see; `handovers`: the window's, already cut to her tenant and units
    (a handover of a unit outside `reach` is dropped all the same)."""
    units = {unit_id: _Group() for unit_id in reach.units}
    unplaced = _Group()

    def group_of(key: str) -> _Group | None:
        unit_id = key_units.get(key)
        if unit_id is not None and unit_id in units:
            return units[unit_id]
        # No admission here, two units, or a unit she does not reach: the unplaced block of an unrestricted caller;
        # a scoped caller is told nothing of it.
        return None if reach.scoped else unplaced

    for episode in build_episodes([rec for rec in records if rec.event_type in EPISODE_KINDS]):
        group = group_of(episode.patient_id)
        if group is not None:
            group.episodes.append(episode)
    for rec in records:
        if rec.event_type in (SNOOZE, RRT_CALL):
            group = group_of(rec.patient_id)
            if group is not None:
                (group.snoozes if rec.event_type == SNOOZE else group.calls).append(rec)
    for h in handovers:
        if h.unit_id in units:
            units[h.unit_id].handovers.append(h)

    rows = sorted(((unit_id, group) for unit_id, group in units.items() if group.counts_anything()),
                  key=lambda row: (reach.units[row[0]].casefold(), str(row[0])))
    seen = [group for _, group in rows] + ([] if reach.scoped else [unplaced])
    every = _Group(episodes=[e for g in seen for e in g.episodes], snoozes=[s for g in seen for s in g.snoozes],
                   calls=[c for g in seen for c in g.calls], handovers=[h for g in seen for h in g.handovers])
    placed = sum(len(group.episodes) for _, group in rows)
    lost = 0 if reach.scoped else len(unplaced.episodes)
    return {
        "days": days, "generated_at": now.isoformat(), "window_from": window_from, "truncated": truncated,
        "scoped": reach.scoped,
        "coverage": {"episodes": placed + lost, "placed": placed, "unplaced": lost},
        "units": [{"unit_id": str(unit_id), "unit_name": reach.units[unit_id], **_figures(group, now)}
                  for unit_id, group in rows],
        "unplaced": None if reach.scoped else _figures(unplaced, now, with_handovers=False),
        "hospital": _figures(every, now),
    }
