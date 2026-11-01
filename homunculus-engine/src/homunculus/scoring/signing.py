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

And since G2-A4 (D12, X20) **a signature seals only what was seen.** `form_digest` fingerprints a form
as the preview showed it; the signature carries that fingerprint back, and the API signs only when the
form it would seal has the same one — so a chart that lands between the preview and the press is a
refusal to re-preview, never a signature of a number nobody looked at.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
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


def parse_overrides(payload: object, form: SofaForm, *,
                    bounds: Mapping[SignalCode, tuple[float, float]] | None = None) -> list[Override]:
    """Read the corrections out of a signing request, refusing the ones that are not corrections.

    Each entry is `{code, value, reason}`. The original value is looked up from the form rather
    than taken from the caller — a client that could state both would be free to state a false
    "original" and make an override look like agreement. And so only a MEASURED cell is corrected (G2-A4
    review 3, M-2; D5): a cell with no value has no original to keep, and is completed by charting.

    `bounds` (G2-A4, O6) are the slip bounds a value of each code is held to, `{code: (low, high)}`.
    A corrected value is typed by the same hand as a charted one and slips the same way, and the
    engine is the only scorer, so the bound cannot live only in a browser. The caller passes them —
    the API passes the charting door's `PLAUSIBLE` — because this module does not import the API.
    Without them only a finite number is required, as before.
    """
    if payload in (None, "", [], {}):
        return []
    if not isinstance(payload, (list, tuple)):
        raise ScoreSigningError("overrides bir liste olmalı")

    by_code: dict[str, float | None] = {}
    measured: set[str] = set()
    for row in form.rows:
        for cell in row.inputs:
            by_code[cell.code.value] = cell.value
            if cell.measured:
                measured.add(cell.code.value)

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
        if raw_code not in measured:
            # G2-A4 review 3 (M-2, D5): a correction changes what the record holds. A cell the record holds
            # nothing for is completed by charting the measurement, with its time, through the door — a
            # value typed over it here would be a reading with no time, scored off support (D13).
            raise ScoreSigningError(f"{raw_code}: ölçülmemiş bir değer düzeltilemez — ölçümü formdan girin")
        if raw_code in seen:
            raise ScoreSigningError(f"{raw_code!r} için birden fazla düzeltme gönderildi")
        seen.add(raw_code)

        try:
            value = float(entry.get("value"))
        except (TypeError, ValueError):
            raise ScoreSigningError(f"{raw_code}: değer sayı olmalı") from None
        if value != value or value in (float("inf"), float("-inf")):
            raise ScoreSigningError(f"{raw_code}: geçersiz sayı")
        # G2-A4 (O6): the door's slip bound, in the door's words (api/clinical.py `_value`) — a platelet
        # count corrected to 18000 is the same slipped digit whether it was charted or typed over the record.
        span = (bounds or {}).get(code)
        if span is not None and not span[0] <= value <= span[1]:
            low, high = span
            raise ScoreSigningError(
                f"{raw_code}: {value:g} beklenen aralığın ({low:g}–{high:g}) dışında — "
                f"birim veya ondalık hatası olabilir")

        reason = str(entry.get("reason") or "").strip()
        if len(reason) < MIN_REASON_CHARS:
            raise ScoreSigningError(
                f"{raw_code}: düzeltme gerekçesi en az {MIN_REASON_CHARS} karakter olmalı — "
                f"bu sayı hastane raporlamasına giriyor ve neden değiştirildiği kayda geçmeli")

        overrides.append(Override(code=code, value=value, reason=reason,
                                  original=by_code[raw_code]))
    return overrides


def form_digest(rebuilt: SofaForm, overrides: list[Override]) -> str:
    """The fingerprint of a form as the clinician saw it (G2-A4, D12, X20): SHA-256, lowercase hex.

    It covers what she checks before she signs — whose form it is (`patient_id`); the window's length
    (`window_hours`) and whether the stay covers it (`covers_full_window`); the total; every row's points;
    every cell's value, the time of the measurement behind it, its points and whether it is the nearest
    reading before the window (`outside_window`); the respiration row's support basis (D13); and each
    correction's value, the original the record held and its reason, trimmed as the engine keeps it — so
    any change to any of them between the preview and the signature is another fingerprint (review 3, M-1:
    two empty forms of two patients no longer share one). None of these moves with the clock. The cells are
    read from `as_dict()`, the very form the screen is sent.

    Still not in it, on purpose:

    * the window's bounds (`window_from`, `window_to`): they move every second, so no signature would ever
      match its preview;
    * a cell's `source`: where the reading came from, not a number she checks against the table — the
      reading itself is fixed by its value and its time, which are in;
    * a cell's `considered` (how many readings the window held), which the screen does not print and which
      every better reading charted since would move. The answer's `unmeasured_organs`, `organ_failures`
      and `corrected_cells` follow from what is in.
    """
    respiration = next((r for r in rebuilt.rows if r.organ == "respiration"), None)
    payload = {
        "patient_id": rebuilt.patient_id,
        "window_hours": rebuilt.window_hours,
        "covers_full_window": rebuilt.covers_full_window,
        "total": rebuilt.total,
        "points": {row.organ: row.points for row in rebuilt.rows},
        "cells": {cell["code"]: [cell["value"], cell["at"], cell["points"], cell["outside_window"]]
                  for row in rebuilt.rows for cell in (c.as_dict() for c in row.inputs)},
        "support": respiration.as_dict().get("support") if respiration is not None else None,
        "corrections": {o.code.value: [o.value, o.original, o.reason.strip()] for o in overrides},
    }
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
