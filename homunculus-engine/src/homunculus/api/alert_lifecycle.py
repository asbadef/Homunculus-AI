# src/homunculus/api/alert_lifecycle.py
"""What happens to an alert when its rule stops firing (G2-A1, O17).

The engine answers one question — what fires now (pipeline.py rebuilds its bucket from every
evaluation). Everything the ward attached to an alert lives in the tenant's AckStore, keyed by
(patient, kind): its acknowledgement, the instant it was first seen, whether it escalated; the
notifier keeps whether a nurse was told. `sync_alerts` runs after every evaluation — `/ingest`,
`/clinical` and the replay in `rehydrate` — so the three behave alike (D4):

* A kind that stopped firing ends its episode. Its ack, first-seen stamp and escalation flag are
  pruned (the door prunes the notifier's dedup with `live_keys`), so if it fires again it is a NEW
  episode: a new first-seen, a new escalation clock, a new nurse notification (D5).
* Except a critical one nobody acknowledged: it latches (D2). It stays on the board as resolved,
  unacknowledged — its first-seen kept, its escalation flag dropped, for only a firing alert
  escalates (D8) — until a clinician acknowledges it, which removes it (`acknowledge_latched`). A
  transient critical event must not vanish before anyone saw it. HIGH, MODERATE and LOW never
  latch, and an acknowledged critical leaves with its rule.
* A latched kind that fires again is active again: the latch is replaced and its episode goes on —
  no `alert_cleared` row, and the first-seen stamp it kept is still its own.

The hook writes no audit row: it returns what it cleared, the door audits it (`alert_cleared`,
D6), and the replay, which must write nothing, ignores it (D7).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from homunculus.api.ackstore import AckStore
from homunculus.pipeline import Engine

#: The one severity that latches (D2, the user's decision of 2026-10-25).
LATCHING_SEVERITY = "critical"

#: Why an `alert_cleared` row was written (D6).
RESOLVED = "resolved"                         # the rule stopped firing (also as a critical latches)
ACKED_AFTER_RESOLVE = "acked_after_resolve"   # a latched alert was acknowledged, and so removed

Key = tuple[str, str]


@dataclass(frozen=True)
class Cleared:
    """An episode's end, as the `alert_cleared` audit row records it."""
    patient_id: str
    kind: str
    severity: str
    first_seen: datetime | None
    reason: str

    def payload(self, at: datetime) -> dict:
        return {"first_seen": self.first_seen.isoformat() if self.first_seen is not None else None,
                "at": at.isoformat(), "reason": self.reason, "severity": self.severity}


def firing_keys(engine: Engine) -> set[Key]:
    """Every (patient, kind) the last evaluation of each patient produced."""
    return {(pid, a.kind) for pid in engine.patient_ids() for a in engine.active_alerts(pid)}


def live_keys(engine: Engine, store: AckStore) -> set[Key]:
    """The alerts on the board: the firing ones and the latched ones (D4)."""
    return firing_keys(engine) | set(store.resolved)


def sync_alerts(engine: Engine, store: AckStore, patient_id: str, now: datetime) -> list[Cleared]:
    """Bring the store in line with the engine's last evaluation of `patient_id`, and say what
    ended. `now` is the wall clock (the API's; a replay passes the row's own time): a latched
    alert's `resolved_at`."""
    firing_now = {a.kind: a for a in engine.active_alerts(patient_id)}
    cleared: list[Cleared] = []
    dropped = [(key, alert) for key, alert in store.firing.items()
               if key[0] == patient_id and key[1] not in firing_now]
    for key, alert in dropped:
        del store.firing[key]
        cleared.append(Cleared(patient_id, key[1], alert.severity, store.first_seen.get(key), RESOLVED))
        if alert.severity == LATCHING_SEVERITY and key not in store.acks:
            store.resolved[key] = {"alert": asdict(alert), "resolved_at": now}
    for kind, alert in firing_now.items():
        store.firing[(patient_id, kind)] = alert
    # If an evaluation is ever not followed by its hook, another patient's sync must not prune the
    # skipped patient's ack and first-seen before their drop is processed; with every hook run this
    # changes nothing.
    store.prune(live_keys(engine, store) | set(store.firing), firing_keys(engine))
    return cleared


def acknowledge_latched(store: AckStore, patient_id: str, kind: str) -> Cleared | None:
    """A clinician acknowledged a latched alert: it is removed, and its episode ends (D8). None
    when (patient, kind) is not latched — a firing alert is acknowledged the ordinary way."""
    key = (patient_id, kind)
    entry = store.resolved.pop(key, None)
    if entry is None:
        return None
    seen = store.first_seen.pop(key, None)
    store.escalated.discard(key)
    return Cleared(patient_id, kind, entry["alert"]["severity"], seen, ACKED_AFTER_RESOLVE)
