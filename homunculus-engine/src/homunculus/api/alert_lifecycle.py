# src/homunculus/api/alert_lifecycle.py
"""What happens to an alert when its rule stops firing (G2-A1, O17).

The engine answers one question — what fires now (pipeline.py rebuilds its bucket from every
evaluation). Everything the ward attached to an alert lives in the tenant's AckStore, keyed by
(patient, kind): its acknowledgement, the instant it was first seen, whether it escalated; the
notifier keeps whether a nurse was told. `sync_alerts` runs after every evaluation — `/ingest`,
`/clinical` and the replay in `rehydrate` — so the three behave alike (D4). The doors run it right
after `engine.ingest`, before their first audit write: an audit that fails mid-request must not
leave an evaluation without its hook, or an unacknowledged critical would be off the board until
some later reading:

* A kind that stopped firing ends its episode. Its ack, first-seen stamp, escalation clock and flag
  and record of the doctor's page are pruned (the door prunes the notifier's dedup with
  `live_keys`), so if it fires again it is a NEW episode: a new first-seen, a new nurse
  notification (D5). If it ended unanswered, its escalation chain is remembered first (X13): a
  return within the escalation delay of the end continues the chain — its clock, and no second page
  to the doctor — and a later one starts a new chain, with a new clock and a new page. An answer
  ends the chain (X13 review): after an acknowledgement any return starts a new one.
* Except a critical one nobody acknowledged: it latches (D2). It stays on the board as resolved,
  unacknowledged — its first-seen kept (and carried in the latch), its escalation flag dropped, for
  only a firing alert escalates (D8) — until a clinician acknowledges it, which removes it
  (`acknowledge_latched`). A
  transient critical event must not vanish before anyone saw it. HIGH, MODERATE and LOW never
  latch, and an acknowledged critical leaves with its rule. The acknowledgement that removes a
  latch is its episode's end and, an answer, its chain's: nothing is left behind.
* A latched kind that fires again is active again: the latch is replaced and its episode goes on —
  no `alert_cleared` row, and the first-seen stamp it kept is still its own. Nor is the doctor
  paged for it again if the episode had been (`AckStore.paged`).

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
        seen = store.first_seen.get(key)
        cleared.append(Cleared(patient_id, key[1], alert.severity, seen, RESOLVED))
        if alert.severity == LATCHING_SEVERITY and key not in store.acks:
            # The latch carries its episode's first-seen, so the record of its end can say when the
            # episode began even if the stamp itself is gone by then (None: never stamped).
            store.resolved[key] = {"alert": asdict(alert), "resolved_at": now, "first_seen": seen}
    for kind, alert in firing_now.items():
        store.firing[(patient_id, kind)] = alert
    # Pruned from the store's own view — what the hooks last saw firing, and what is latched — not
    # from a walk over every patient's evaluation: that walk made each row cost the ward's size.
    # With every hook run the store's view is the engine's. If an evaluation is ever not followed by
    # its hook, the skipped patient's keys are still in `store.firing`, so another patient's sync
    # cannot prune their ack and first-seen before their drop is processed.
    firing = set(store.firing)
    store.prune(firing | set(store.resolved), firing, now=now)
    return cleared


def acknowledge_latched(store: AckStore, patient_id: str, kind: str) -> Cleared | None:
    """A clinician acknowledged a latched alert: it is removed, and its episode ends (D8). None
    when (patient, kind) is not latched — a firing alert is acknowledged the ordinary way.

    An acknowledgement is an answer, and an answer ends the escalation chain as well as the
    episode (X13 review): no chain is remembered, so a return — however soon — starts a new
    clock and can page the doctor anew."""
    key = (patient_id, kind)
    entry = store.resolved.pop(key, None)
    if entry is None:
        return None
    seen = store.first_seen.pop(key, None)
    store.clock_from.pop(key, None)
    if seen is None:
        seen = entry.get("first_seen")
    store.escalated.discard(key)
    store.paged.discard(key)       # the episode and its chain are over: the next one pages anew
    return Cleared(patient_id, kind, entry["alert"]["severity"], seen, ACKED_AFTER_RESOLVE)
