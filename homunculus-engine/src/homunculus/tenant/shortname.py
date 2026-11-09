# homunculus-engine/src/homunculus/tenant/shortname.py
"""The one form a bed screen names its patient by (G2-B3a, spec D3, R7): "Əli M.".

PHI RULE: it reads a name and returns less of it; nothing is kept or logged."""
from __future__ import annotations


def short_name(display_name: str | None) -> str | None:
    """The ward writes the surname first ("Məmmədov Əli Rauf oğlu", the user, 2026-11-09): the
    SECOND word in full and the FIRST word's initial — "Əli M.". A one-word name is shown as it
    is, and no word at all is None. Case is kept: "İ", "ı" and "Ə" are never folded."""
    words = (display_name or "").split()
    if not words:
        return None
    if len(words) == 1:
        return words[0]
    return f"{words[1]} {words[0][0]}."
