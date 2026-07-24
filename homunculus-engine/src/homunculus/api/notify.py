# src/homunculus/api/notify.py
"""In-app notification delivery: decide which alerts to push, dedup, and fan out by role.

PHI-minimal: the body is "{patient_id}: {summary}" — a bed label plus the finding already on the
board. Nothing beyond what the board shows, and nothing leaves the system (in-app SSE only)."""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from homunculus.reco.engine import Alert


@dataclass(frozen=True)
class Notification:
    tenant: str
    patient_id: str
    kind: str
    severity: str
    urgency: str
    audience: str      # "nurse" | "doctor"
    trigger: str       # "new" | "escalation"
    title: str
    body: str
    ts: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Notifier:
    """Turns alert / escalation events into role-targeted Notifications, deduplicated."""

    def __init__(self) -> None:
        self._notified_new: dict[str, set[tuple[str, str]]] = {}   # tenant -> {(pid, kind)}

    def for_new(self, tenant: str, alerts: list[Alert]) -> list[Notification]:
        seen = self._notified_new.setdefault(tenant, set())
        out: list[Notification] = []
        for a in alerts:
            key = (a.patient_id, a.kind)
            if a.urgency != "immediate" or key in seen:
                continue
            seen.add(key)
            out.append(Notification(
                tenant=tenant, patient_id=a.patient_id, kind=a.kind, severity=a.severity,
                urgency=a.urgency, audience="nurse", trigger="new", title="Yeni uyarı",
                body=f"{a.patient_id}: {a.summary}", ts=_now_iso()))
        return out

    def prune(self, tenant: str, live_keys: set[tuple[str, str]]) -> None:
        seen = self._notified_new.get(tenant)
        if seen is not None:
            self._notified_new[tenant] = seen & live_keys

    def for_escalation(self, tenant: str, newly: set[tuple[str, str]],
                       alert_by_key: dict[tuple[str, str], Alert]) -> list[Notification]:
        out: list[Notification] = []
        for key in newly:
            a = alert_by_key.get(key)
            if a is None:
                continue
            out.append(Notification(
                tenant=tenant, patient_id=a.patient_id, kind=a.kind, severity=a.severity,
                urgency=a.urgency, audience="doctor", trigger="escalation", title="Eskalasyon",
                body=f"{a.patient_id}: {a.summary}", ts=_now_iso()))
        return out


class NotificationHub:
    """Per-tenant, role-filtered fan-out of Notifications to SSE subscribers."""

    def __init__(self) -> None:
        self._subs: dict[str, list[tuple[str, asyncio.Queue]]] = {}

    def subscribe(self, tenant: str, role: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(tenant, []).append((role, q))
        return q

    def unsubscribe(self, tenant: str, role: str, queue: asyncio.Queue) -> None:
        subs = self._subs.get(tenant)
        if subs and (role, queue) in subs:
            subs.remove((role, queue))

    async def publish(self, tenant: str, notification: Notification) -> None:
        for role, q in list(self._subs.get(tenant, [])):
            if role == notification.audience:
                await q.put(asdict(notification))
