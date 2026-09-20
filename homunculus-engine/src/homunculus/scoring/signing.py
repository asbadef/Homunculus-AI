# src/homunculus/scoring/signing.py
"""Overriding a filled severity form, and signing it.

The form arrives pre-filled from the record. That is the product's value and also its risk: a
number that appeared on its own is a number nobody checked. This module is the part where a
clinician takes responsibility for it.

Three rules, and each one closes a way the module could do harm:

**1 · An override replaces the VALUE, never the points.**
The clinician says "the platelet count was 38, not 45" — they do not say "this row scores 2". The
points are always recomputed from the score's own table. Letting a person type a point value would
put an unbanded number into a hospital's quality reporting, where nothing downstream could tell it
from a computed one.

**2 · The system's own value is kept alongside.**
The record shows both what the record contained and what the clinician said it should be. An
override that erased the original would destroy the only evidence that a correction happened —
and a pattern of corrections on one parameter is exactly the signal that a feed is wrong.

**3 · An override without a reason is refused.**
Not a checkbox, not a dropdown: free text, and long enough to be a sentence. This is the same rule
the alarm-suppression path already carries, for the same reason — a severity score is a number a
hospital reports upward, and "why is this different from what the machine measured" is the
question an inspection asks first.

And one refusal that is not about overrides: **the form does not sign itself.** A severity score
entering quality reporting with nobody behind it is the failure this module must not enable, so
signing requires an identified clinician and is recorded as its own event.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from homunculus.canonical import SignalCode
from homunculus.scoring.sofa_form import SofaForm

# Long enough to be a sentence rather than a keystroke. Matches the break-glass and snooze paths
# (escalation/schemas.py), so a clinician meets one standard across the product rather than three.
MIN_REASON_CHARS = 20


class ScoreSigningError(ValueError):
    """A form that cannot be accepted. Carries a reason for the clinician, not a stack trace."""


@dataclass(frozen=True)
class Override:
    """One cell a clinician corrected, and why."""
    code: SignalCode
    value: float
    reason: str
    original: float | None = None      # what the record held, kept on purpose

    def as_dict(self) -> dict:
        return {"code": self.code.value, "value": self.value, "reason": self.reason,
                "original": self.original}


@dataclass(frozen=True)
class SignedScore:
    """A severity form as it was signed: the numbers, the corrections, and who stands behind it."""
    patient_id: str
    score: str
    total: int
    signed_by: str
    signed_at: datetime
    form: dict
    overrides: list[Override] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "patient_id": self.patient_id,
            "score": self.score,
            "total": self.total,
            "signed_by": self.signed_by,
            "signed_at": self.signed_at.isoformat(),
            "signed": True,
            "overrides": [o.as_dict() for o in self.overrides],
            "form": self.form,
        }


def parse_overrides(payload: object, form: SofaForm) -> list[Override]:
    """Read the corrections out of a signing request, refusing the ones that are not corrections.

    Each entry is `{code, value, reason}`. The original value is looked up from the form rather
    than taken from the caller — a client that could state both would be free to state a false
    "original" and make an override look like agreement.
    """
    if payload in (None, "", [], {}):
        return []
    if not isinstance(payload, (list, tuple)):
        raise ScoreSigningError("overrides bir liste olmalı")

    by_code: dict[str, float | None] = {}
    for row in form.rows:
        for cell in row.inputs:
            by_code[cell.code.value] = cell.value

    seen: set[str] = set()
    overrides: list[Override] = []
    for entry in payload:
        if not isinstance(entry, dict):
            raise ScoreSigningError("her düzeltme bir nesne olmalı")

        raw_code = str(entry.get("code") or "").strip()
        try:
            code = SignalCode(raw_code)
        except ValueError:
            raise ScoreSigningError(f"bilinmeyen alan: {raw_code!r}") from None
        if raw_code not in by_code:
            # The form decides what is overridable. Accepting a parameter this score does not use
            # would record a correction that changes nothing and reads as though it did.
            raise ScoreSigningError(f"{raw_code!r} bu formda yok — düzeltilemez")
        if raw_code in seen:
            raise ScoreSigningError(f"{raw_code!r} için birden fazla düzeltme gönderildi")
        seen.add(raw_code)

        try:
            value = float(entry.get("value"))
        except (TypeError, ValueError):
            raise ScoreSigningError(f"{raw_code}: değer sayı olmalı") from None
        if value != value or value in (float("inf"), float("-inf")):
            raise ScoreSigningError(f"{raw_code}: geçersiz sayı")

        reason = str(entry.get("reason") or "").strip()
        if len(reason) < MIN_REASON_CHARS:
            raise ScoreSigningError(
                f"{raw_code}: düzeltme gerekçesi en az {MIN_REASON_CHARS} karakter olmalı — "
                f"bu sayı hastane raporlamasına giriyor ve neden değiştirildiği kayda geçmeli")

        overrides.append(Override(code=code, value=value, reason=reason,
                                  original=by_code[raw_code]))
    return overrides


def sign(form: SofaForm, rebuilt: SofaForm, *, signed_by: str,
         overrides: list[Override], now: datetime | None = None) -> SignedScore:
    """Seal a form under a clinician's name.

    `rebuilt` is the form recomputed with the overrides applied — passed in rather than computed
    here so the band tables stay in one place, and so this module never becomes a second scorer.
    """
    who = (signed_by or "").strip()
    if not who:
        # Unsigned is a valid state for a form; anonymously signed is not.
        raise ScoreSigningError("imzalayan belirlenemedi — kimliksiz skor imzalanamaz")

    payload = rebuilt.as_dict()
    payload["signed"] = True
    payload["auto_total"] = form.total     # what the record alone produced, before corrections
    return SignedScore(
        patient_id=rebuilt.patient_id,
        score=payload.get("score", "SOFA"),
        total=rebuilt.total,
        signed_by=who,
        signed_at=now or datetime.now(timezone.utc),
        form=payload,
        overrides=overrides,
    )
