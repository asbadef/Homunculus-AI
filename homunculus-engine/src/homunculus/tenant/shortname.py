# homunculus-engine/src/homunculus/tenant/shortname.py
"""The one form a bed screen names its patient by (G2-B3a, spec D3, R7): "Əli M.".

PHI RULE: it reads a name and returns less of it; nothing is kept or logged."""
from __future__ import annotations

import unicodedata


def _initial(word: str) -> str:
    """The first letter or digit of `word`, with the combining marks that follow it directly: a
    letter that has no precomposed form keeps its mark, and a leading "-" or quote is skipped."""
    for i, ch in enumerate(word):
        if ch.isalnum():
            end = i + 1
            while end < len(word) and unicodedata.category(word[end]).startswith("M"):
                end += 1
            return word[i:end]
    return ""


def short_name(display_name: str | None) -> str | None:
    """The ward writes the surname first ("Məmmədov Əli Rauf oğlu", the user, 2026-11-09): the
    SECOND word in full and the FIRST word's initial — "Əli M.". A one-word name is shown as it
    is, and no word at all is None. Case is kept: "İ", "ı" and "Ə" are never folded.

    The name is composed first (NFC), so a decomposed "İ" (I + U+0307) or "Ş" (S + U+0327) from
    another system reads as one letter. A "word" with no letter or digit in it (a lone "-") is
    not a word."""
    text = unicodedata.normalize("NFC", display_name or "")
    words = [w for w in text.split() if any(ch.isalnum() for ch in w)]
    if not words:
        return None
    if len(words) == 1:
        return words[0]
    return f"{words[1]} {_initial(words[0])}."
