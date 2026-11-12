# homunculus-engine/src/homunculus/tres/az.py
"""The platform's rules for a person (TRƏS-01, spec D20, D16) — pure functions, no I/O.

What the `az-patient` profile requires — the FİN, the family and the given name, the father's
name and the sex — is either here in the platform's form, or the reason it is not, as a catalogue
code the tab shows so the ward can complete the record. Nothing here guesses: a value that does
not fit is a skip, never a correction.

* FİN: trimmed, refused when any character is outside ASCII, then upper-cased and exactly seven
  Latin capitals or digits. Never transliterated (an `Ə` typed in it is `fin_format`, not an `E`;
  nor does `ß` become `SS`, which `str.upper()` would do).
* Name: the admission form writes «Soyad Ad» (family first), so the first word is the family name
  and the rest the given names; a single word cannot be split (`name_single`).
* Sex: `male` → `K`, `female` → `Q` (the platform's own codes); `other` and `unknown` have none.
* Phone: `+994` and the nine (ASCII) digits of the national number, from `+994…`, `994…`, the domestic
  form with its leading `0`, or the nine digits alone — spaces, dashes, dots and brackets dropped.
  The national number never begins with `0` (the domestic prefix): nine digits that do are a
  domestic number missing a digit, never `+9940…`. Anything else is not sent (a phone is not
  required: no skip)."""
from __future__ import annotations

import re
from datetime import date

FIN_MISSING = "fin_missing"
FIN_FORMAT = "fin_format"
NAME_SINGLE = "name_single"
FATHER_NAME_MISSING = "father_name_missing"
SEX_UNMAPPED = "sex_unmapped"
BIRTH_DATE_INVALID = "birth_date_invalid"

_FIN = re.compile(r"[A-Z0-9]{7}")
SEX_CODES = {"male": "K", "female": "Q"}
_PHONE_PUNCTUATION = re.compile(r"[\s\-.()]")
# ASCII digits only: `\d` alone takes Arabic-Indic, Persian and full-width digits too, and they would
# go into the value sent (D20: nothing is transliterated, so nothing is passed off as ASCII either).
# The nine digits of the national number never begin with 0, the domestic trunk prefix (batch-3
# review, B): «050 123 456» is a domestic number missing a digit, and as nine digits it would have
# gone as «+994050123456» — in every form, so the rule is on the nine digits themselves.
_NATIONAL = r"([1-9][0-9]{8})"
_PHONE_FORMS = (re.compile(r"\+994" + _NATIONAL), re.compile(r"994" + _NATIONAL), re.compile(r"0" + _NATIONAL),
                re.compile(_NATIONAL))


def normal_fin(value: str | None) -> tuple[str | None, str | None]:
    """(the FİN in the platform's form, None) or (None, the skip reason)."""
    fin = (value or "").strip()
    if not fin:
        return None, FIN_MISSING
    # Judged as typed, BEFORE any case-folding: `str.upper()` maps ß to SS, ﬀ to FF, ſ to S and ı to I,
    # which is transliteration (D20) — a FİN with a character outside ASCII is a `fin_format`, never
    # a corrected one.
    if not fin.isascii():
        return None, FIN_FORMAT
    fin = fin.upper()
    if not _FIN.fullmatch(fin):
        return None, FIN_FORMAT
    return fin, None


def split_name(display_name: str | None) -> tuple[tuple[str, list[str]] | None, str | None]:
    """((family, [given…]), None) from «Soyad Ad …», or (None, the skip reason)."""
    words = (display_name or "").split()
    if len(words) < 2:
        return None, NAME_SINGLE
    return (words[0], words[1:]), None


def sex_code(sex: str | None) -> tuple[str | None, str | None]:
    code = SEX_CODES.get((sex or "").strip().lower())
    return (code, None) if code else (None, SEX_UNMAPPED)


def phone(value: str | None) -> str | None:
    """`+994` and nine digits, or None (not sent)."""
    bare = _PHONE_PUNCTUATION.sub("", value or "")
    for form in _PHONE_FORMS:
        match = form.fullmatch(bare)
        if match:
            return "+994" + match.group(1)
    return None


def birth_date(value: str | None) -> tuple[str | None, str | None]:
    """The stored ISO date as the platform's `date`, or (None, `birth_date_invalid`)."""
    try:
        return date.fromisoformat((value or "").strip()).isoformat(), None
    except ValueError:
        return None, BIRTH_DATE_INVALID
