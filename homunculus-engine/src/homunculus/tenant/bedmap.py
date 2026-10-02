"""Resolve the bed a HIS says a patient is in to the bed this system knows.

The hospital's ADT names a location in its own words — PV1-3 arrives as three components, e.g.
`YB^304^2`. Our own hierarchy names the same bed differently (Tenant → Site → Unit → Room →
Bed). Nothing joins the two automatically, so the join has to be a table someone writes, per
site, the same way the device field tables are written: from a discovery run against real
traffic, never guessed.

Two rules govern what happens when the table does not cover a location, and both come from
what the field has already taught this project:

1. **An unmatched location is never dropped.** A patient the HIS admitted and we silently
   discarded is the worst failure this component can have: the ward believes the bed is
   monitored and nothing is watching it. Unmatched resolutions are returned, counted, and
   meant to be shown.

2. **Counters make the blindness visible.** Guessing a vendor's field names is the classic way
   a pilot looks healthy on every screen while receiving nothing (`edge/bridge.py` counts
   unmapped OBX codes for exactly this reason). A wrong table and a dead feed look identical
   from the outside; the counter is what tells them apart.
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BedRef:
    """A bed in our hierarchy, as the mapping table names it."""
    bed_id: str
    unit_id: str = ""
    label: str = ""


@dataclass(frozen=True)
class Resolution:
    """What a lookup produced. `ref` is None when the table does not cover this location.

    `key` is the normalised form that was looked up — it is what an operator adds to the table,
    so it belongs in the discovery report verbatim.
    """
    key: str
    ref: BedRef | None

    @property
    def matched(self) -> bool:
        return self.ref is not None


def normalise_key(unit: str, room: str, bed: str) -> str:
    """The lookup key for one HIS location.

    Case and surrounding spaces vary between messages from the same interface, so they are not
    allowed to decide whether a bed is found. Empty components are kept as empty slots rather
    than dropped: `YB^^2` and `YB^2^` are different locations and must not collapse onto each
    other.
    """
    return "^".join((part or "").strip().upper() for part in (unit, room, bed))


class BedMap:
    """A site's HIS-location → our-bed table, plus a count of what it failed to cover."""

    def __init__(self, table: dict[str, BedRef] | None = None):
        self._table: dict[str, BedRef] = dict(table or {})
        self._unmatched: Counter[str] = Counter()

    @classmethod
    def from_file(cls, path: str | Path) -> BedMap:
        """Load `{"beds": {"YB^304^2": {"bed_id": ..., "unit_id": ..., "label": ...}}}`.

        A missing file yields an empty map rather than an error: a site that has not written its
        table yet must still run, with every location unmatched and counted, so the discovery
        report is what tells the operator the table is missing.
        """
        p = Path(path)
        # `is_file`, not `exists`: a bind mount whose source file does not exist yet leaves a
        # DIRECTORY at the target, and reading it would take the service down at boot over a
        # table that was merely never written.
        if not p.is_file():
            return cls()
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            # An unreadable table is a real fault, but refusing to start is the worse failure:
            # the ward loses its monitor over a config file. Run with an empty table instead —
            # every location is then unmatched AND COUNTED, so the discovery report says so
            # loudly rather than the fault passing as a quiet ward.
            logging.getLogger(__name__).error(
                "yatak eşleme tablosu okunamadı (%s): %s — boş tabloyla devam ediliyor, "
                "her konum eşleşmemiş sayılacak", p, exc)
            return cls()
        if not isinstance(raw, dict):
            logging.getLogger(__name__).error(
                "yatak eşleme tablosu bir nesne değil (%s) — boş tabloyla devam ediliyor", p)
            return cls()
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> BedMap:
        table: dict[str, BedRef] = {}
        for key, value in (raw.get("beds") or {}).items():
            parts = key.split("^")
            # Re-normalise the key as written in the file, so a table entered as "yb^304^2"
            # still matches traffic that arrives as "YB^304^2".
            normalised = normalise_key(*(parts + ["", "", ""])[:3])
            if isinstance(value, str):
                table[normalised] = BedRef(bed_id=value)
            else:
                table[normalised] = BedRef(
                    bed_id=str(value.get("bed_id", "")),
                    unit_id=str(value.get("unit_id", "")),
                    label=str(value.get("label", "")),
                )
        return cls(table)

    def resolve(self, unit: str, room: str, bed: str) -> Resolution:
        """Look up one location. Counts the miss when there is one; never raises."""
        key = normalise_key(unit, room, bed)
        ref = self._table.get(key)
        if ref is None:
            self._unmatched[key] += 1
        return Resolution(key=key, ref=ref)

    def unmatched(self) -> dict[str, int]:
        """Locations this table did not cover, and how often each was seen."""
        return dict(self._unmatched)

    def discovery_report(self) -> str:
        """One line naming what the table is missing, ordered by how often it was seen.

        Carries no patient data — only location keys and counts — so it is safe to log.
        """
        if not self._unmatched:
            return "Eşlenmemiş yatak yok."
        listed = ", ".join(f"{key} ({count})"
                           for key, count in self._unmatched.most_common())
        return f"Eşlenmemiş yataklar: {listed}"

    def __len__(self) -> int:
        return len(self._table)
