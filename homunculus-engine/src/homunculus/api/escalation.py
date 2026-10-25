# src/homunculus/api/escalation.py
"""Pure escalation logic: which high-urgency, unacknowledged, past-threshold alerts are escalated.
Clock-injected so it is unit-tested without waiting on a real timer.

`first_seen` is when each alert's escalation clock started. Since G2-A1 X13 the API passes the
escalation chain's start (`AckStore.clock_from`), not the episode's first sight."""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.reco.engine import Alert


def escalate(
    alerts: list[tuple[str, Alert]],
    acks: dict[tuple[str, str], dict],
    first_seen: dict[tuple[str, str], datetime],
    now: datetime,
    threshold: timedelta,
) -> set[tuple[str, str]]:
    escalated: set[tuple[str, str]] = set()
    for patient_id, alert in alerts:
        if alert.urgency != "immediate":
            continue
        key = (patient_id, alert.kind)
        if key in acks:
            continue
        seen = first_seen.get(key)
        if seen is not None and now - seen >= threshold:
            escalated.add(key)
    return escalated
