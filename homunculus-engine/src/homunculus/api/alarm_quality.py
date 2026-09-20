# src/homunculus/api/alarm_quality.py
"""Does anyone act on our alarms? (E4)

The product exists to prevent alarm fatigue, and nothing in it measured whether it was causing
some. This module answers the only question that matters for that: **of the alarms this system
raised, what fraction did a human answer, and how fast?** A system whose alarms are routinely
ignored is not a quiet system; it is a system that has trained a ward to ignore it, and the number
that shows this must exist before anyone claims the product reduces anything.

The source is the audit log, on purpose. It is durable (it survives the restart that empties
`AckStore`), tenant-scoped, append-only, and now sealed — so a quality figure quoted to a hospital
rests on the same record an inspection would read, not on a counter that a deploy resets.

**The unit is the episode, not the alert row.** While an alert stays active the engine re-emits it
on every ingest, so counting `alert` rows would measure how often the monitor sampled, not how
often the ward was disturbed. `first_seen` is stamped exactly once per episode and re-stamped when
the alert clears and returns, so consecutive `first_seen` events for one (patient, kind) delimit
episodes. Their count is the number of times a person was actually asked to look.

**An open episode is not an ignored one.** An alarm raised forty seconds ago that nobody has
acknowledged yet is a nurse walking to the bed, not a failure. Those are reported separately as
pending and kept out of every rate — including them would let the numbers look worse the more
recently they were measured, which is the sort of metric that gets quietly stopped being read.
"""
from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

from homunculus.api.audit import AuditRecord

# How long an unanswered episode is given before it counts as unanswered. Twice the default
# escalation threshold: by then the alert has escalated through its tiers and silence is a finding
# rather than a delay. Operational, not clinical — it is a reporting boundary, not a rule.
DEFAULT_SETTLE = timedelta(minutes=10)


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(str(ts))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _event_time(rec: AuditRecord) -> datetime | None:
    """When the event happened.

    `payload["at"]` is the wall clock the escalation engine actually measures against and is
    preferred; `rec.ts` is when the row was written. They are normally the same instant, but the
    payload is the one the rest of the system reasons about, so response times computed here match
    the ones escalation acted on.
    """
    return _parse(rec.payload.get("at")) or _parse(rec.ts)


@dataclass
class Episode:
    """One time a human was asked to look at a bed."""
    patient_id: str
    kind: str
    started: datetime
    answered_at: datetime | None = None
    answered_by: str = ""
    escalated: bool = False
    repeats: int = 0          # `alert` rows emitted while this episode was open

    @property
    def response_seconds(self) -> float | None:
        if self.answered_at is None:
            return None
        return max(0.0, (self.answered_at - self.started).total_seconds())


@dataclass
class KindStats:
    kind: str
    episodes: int = 0
    answered: int = 0
    escalated: int = 0
    unanswered: int = 0
    pending: int = 0
    repeats: int = 0
    median_response_sec: float | None = None

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class AlarmQuality:
    episodes: int = 0
    answered: int = 0
    unanswered: int = 0
    escalated: int = 0
    pending: int = 0
    # None, never 0, when nothing has settled yet: a rate computed from no episodes is not 0%,
    # it is unknown, and a dashboard that renders it as 0% is reporting a catastrophe that did
    # not happen.
    answered_rate: float | None = None
    median_response_sec: float | None = None
    p90_response_sec: float | None = None
    per_kind: list[KindStats] = field(default_factory=list)
    per_day: list[dict] = field(default_factory=list)
    noisiest_beds: list[dict] = field(default_factory=list)
    repeats: int = 0
    window_from: str | None = None
    window_to: str | None = None

    def as_dict(self) -> dict:
        return {**asdict(self), "per_kind": [k.as_dict() for k in self.per_kind]}


def build_episodes(records: list[AuditRecord]) -> list[Episode]:
    """Reconstruct alarm episodes from an ascending-by-id audit run for one tenant.

    An `ack` or `escalation` is attributed to the episode open for that (patient, kind) at the
    time. Events arriving with no open episode are dropped rather than opening one: an ack for an
    alert whose `first_seen` is outside the window belongs to the previous window, and inventing an
    episode for it here would double-count it there.
    """
    open_episode: dict[tuple[str, str], Episode] = {}
    episodes: list[Episode] = []

    for rec in records:
        key = (rec.patient_id, rec.subject)
        when = _event_time(rec)
        if rec.event_type == "first_seen":
            if when is None:
                continue
            episode = Episode(patient_id=rec.patient_id, kind=rec.subject, started=when)
            open_episode[key] = episode
            episodes.append(episode)
        elif rec.event_type == "alert":
            episode = open_episode.get(key)
            if episode is not None:
                episode.repeats += 1
        elif rec.event_type == "ack":
            episode = open_episode.get(key)
            # First answer wins. A second ack on the same episode is another clinician arriving,
            # not a slower response, and letting it overwrite would inflate the response time.
            if episode is not None and episode.answered_at is None:
                episode.answered_at = when or episode.started
                episode.answered_by = str(rec.payload.get("role") or "")
        elif rec.event_type == "escalation":
            episode = open_episode.get(key)
            if episode is not None:
                episode.escalated = True
    return episodes


def summarise(episodes: list[Episode], now: datetime,
              settle: timedelta = DEFAULT_SETTLE) -> AlarmQuality:
    """Turn episodes into the figures a medical director would be shown."""
    report = AlarmQuality()
    if not episodes:
        return report

    per_kind: dict[str, KindStats] = {}
    per_day: dict[str, int] = {}
    per_bed: dict[str, int] = {}
    responses: list[float] = []

    for ep in episodes:
        stats = per_kind.setdefault(ep.kind, KindStats(kind=ep.kind))
        stats.episodes += 1
        stats.repeats += ep.repeats
        report.episodes += 1
        report.repeats += ep.repeats
        per_day[ep.started.date().isoformat()] = per_day.get(ep.started.date().isoformat(), 0) + 1
        per_bed[ep.patient_id] = per_bed.get(ep.patient_id, 0) + 1
        if ep.escalated:
            stats.escalated += 1
            report.escalated += 1

        if ep.answered_at is not None:
            stats.answered += 1
            report.answered += 1
            responses.append(ep.response_seconds or 0.0)
        elif now - ep.started < settle:
            # Still in flight. Counting this as ignored would make the report look worse the
            # sooner after a shift it is run.
            stats.pending += 1
            report.pending += 1
        else:
            stats.unanswered += 1
            report.unanswered += 1

    for stats in per_kind.values():
        kind_responses = [ep.response_seconds for ep in episodes
                          if ep.kind == stats.kind and ep.response_seconds is not None]
        stats.median_response_sec = (round(statistics.median(kind_responses), 1)
                                     if kind_responses else None)

    settled = report.answered + report.unanswered
    report.answered_rate = round(report.answered / settled, 4) if settled else None
    if responses:
        report.median_response_sec = round(statistics.median(responses), 1)
        # p90 by nearest-rank: with the handful of episodes a pilot ward produces in a day,
        # an interpolated quantile invents a number between two real ones.
        ordered = sorted(responses)
        index = max(0, min(len(ordered) - 1, int(round(0.9 * len(ordered))) - 1))
        report.p90_response_sec = round(ordered[index], 1)

    report.per_kind = sorted(per_kind.values(), key=lambda k: k.episodes, reverse=True)
    report.per_day = [{"date": d, "episodes": n} for d, n in sorted(per_day.items())]
    report.noisiest_beds = [{"patient_id": p, "episodes": n}
                            for p, n in sorted(per_bed.items(), key=lambda kv: kv[1],
                                               reverse=True)[:10]]
    report.window_from = min(ep.started for ep in episodes).isoformat()
    report.window_to = max(ep.started for ep in episodes).isoformat()
    return report


def alarm_quality(records: list[AuditRecord], now: datetime,
                  settle: timedelta = DEFAULT_SETTLE) -> AlarmQuality:
    """The whole pipeline: audit rows in, alarm-fatigue figures out."""
    return summarise(build_episodes(records), now, settle)
