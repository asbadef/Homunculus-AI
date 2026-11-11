# src/homunculus/api/snooze.py
"""G2-B5b «Ertele» (spec 2026-11-10-g2b-b5b-ertele-design.md): the rules a snooze of a live alarm is held to.

Owner D1 (2026-11-10): the rules already in the code — the Postgres `escalation/service.py` `snooze_alert` (§6.2,
S-22), which stays dead and untouched — applied to the live system: critical never; high at most 30 minutes;
moderate at most 120; low and info none (they make no sound, so there is nothing to silence); a reason from a fixed
list, OTHER with at least 15 characters of free text.

Pure: no store, no clock, no HTTP. The route (`POST /alerts/snooze`) and the replay (`rehydrate`) ask the same
functions, so a restart judges a row as the live door judged it."""
from __future__ import annotations

#: The most minutes each severity may be snoozed for (owner D1). A severity not here is never snoozed.
SNOOZE_CAPS: dict[str, int] = {"high": 30, "moderate": 120}

#: The reasons a snooze may give: the Postgres `SnoozeReason` codes (§6.2).
OTHER = "OTHER"
SNOOZE_REASONS = frozenset({"CLINICAL_DECISION_MADE", "ARTEFACT_OR_SIGNAL_NOISE", "PROCEDURE_IN_PROGRESS",
                            "PATIENT_BASELINE", OTHER})
#: OTHER's free text, trimmed, is at least this long (§6.2) ...
OTHER_MIN_CHARS = 15
#: ... and no text is longer than this: an RRT call's ceiling (G2-B5), short enough for a card.
REASON_TEXT_MAX = 500

#: The engine's severities, mildest first (reco/engine.py). Plan note 1: the same alarm worse ends its snooze.
_RANK = ("info", "low", "moderate", "high", "critical")


def snooze_cap(severity: object) -> int | None:
    """The most minutes an alarm of `severity` may be snoozed for, or None: never (critical, low, info, unknown)."""
    return SNOOZE_CAPS.get(severity) if isinstance(severity, str) else None


def minutes_ok(severity: object, minutes: object) -> bool:
    """`minutes` is a whole number from 1 to the severity's cap: never a bool, a float or a text."""
    cap = snooze_cap(severity)
    return (cap is not None and isinstance(minutes, int) and not isinstance(minutes, bool)
            and 1 <= minutes <= cap)


def clean_reason(reason: object, text: object) -> tuple[str, str | None] | None:
    """`(reason, text)` as the door keeps them (the text trimmed; None when blank or absent), or None when the pair is
    refused: a reason not on the list, a text that is not a string or is longer than REASON_TEXT_MAX once trimmed,
    or OTHER without OTHER_MIN_CHARS of text."""
    if not isinstance(reason, str) or reason not in SNOOZE_REASONS:
        return None
    if text is None:
        cleaned = None
    elif isinstance(text, str):
        cleaned = text.strip() or None
    else:
        return None
    if cleaned is not None and len(cleaned) > REASON_TEXT_MAX:
        return None
    if reason == OTHER and (cleaned is None or len(cleaned) < OTHER_MIN_CHARS):
        return None
    return reason, cleaned


def worse(severity: object, than: object) -> bool:
    """Is `severity` worse than `than`? A severity this build does not know counts as worse: it may be the worst."""
    if severity not in _RANK:
        return True
    return than in _RANK and _RANK.index(severity) > _RANK.index(than)
