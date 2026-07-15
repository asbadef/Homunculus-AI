# src/homunculus/rules/antibiotic_clock.py
"""1-hour antibiotic window after sepsis/shock recognition.
Source: surviving-sepsis-campaign-2026 (within 1 h; strong, very low certainty)."""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.canonical import SignalCode
from homunculus.rules.finding import Citation, Finding, Severity, Urgency
from homunculus.state.timeline import PatientState

WINDOW = timedelta(hours=1)


def _antibiotic_given_since(state: PatientState, since: datetime) -> bool:
    for obs in state.history(SignalCode.ANTIBIOTIC_ADMINISTERED):
        if obs.timestamp >= since and obs.value >= 1.0:
            return True
    return False


def evaluate(state: PatientState, recognized_at: datetime | None, now: datetime) -> list[Finding]:
    if recognized_at is None:
        return []
    if _antibiotic_given_since(state, recognized_at):
        return []

    deadline = recognized_at + WINDOW
    remaining = deadline - now
    cite = Citation("surviving-sepsis-campaign-2026",
                    "antimicrobials within 1 h (strong, very low certainty)")

    if remaining.total_seconds() > 0:
        mins = int(remaining.total_seconds() // 60)
        return [Finding(
            kind="antibiotic_due",
            severity=Severity.HIGH,
            urgency=Urgency.SOON,
            summary=f"Antibiotic window: {mins} min remaining",
            reasoning=(
                f"Sepsis recognized at {recognized_at:%H:%M}. Guideline target is within 1 h; "
                f"{mins} min remain. No antibiotic administration seen yet."
            ),
            citations=[cite],
        )]

    overdue = int((-remaining).total_seconds() // 60)
    return [Finding(
        kind="antibiotic_overdue",
        severity=Severity.CRITICAL,
        urgency=Urgency.IMMEDIATE,
        summary=f"Antibiotic OVERDUE by {overdue} min",
        reasoning=(
            f"Sepsis recognized at {recognized_at:%H:%M}; the 1-hour window closed at "
            f"{deadline:%H:%M}. No antibiotic administration seen."
        ),
        citations=[cite],
    )]
