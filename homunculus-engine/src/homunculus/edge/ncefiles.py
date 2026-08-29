# src/homunculus/edge/ncefiles.py
"""Welch Allyn NCE session files -> canonical Observations.

NCE writes one file per device session under SavedCopies. The format is the vendor's own and
undocumented, so this parser assumes as little about its shape as it can get away with: it walks
every element and attribute in the document and collects (name, value) pairs. Which name carries
which signal is a site question, answered by nce-mapping.json — the same arrangement the HL7 side
uses for OBX identifiers, and for the same reason: guessing a vendor's field names in advance is how
a pilot silently receives nothing.

PHI: values are patient data. Nothing here logs, and no error message carries a value.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from homunculus.canonical import SignalCode


@dataclass(frozen=True)
class MappedField:
    """One device field the site has told us how to read."""
    signal: SignalCode
    unit: str = ""


@dataclass(frozen=True)
class SiteMapping:
    """The per-site field table. Empty is valid: it means discovery has not happened yet."""
    signals: dict[str, MappedField] = field(default_factory=dict)
    patient_fields: tuple[str, ...] = ()
    timestamp_fields: tuple[str, ...] = ()
    pair_attributes: tuple[tuple[str, str], ...] = ()


def load_site_mapping(path: str | Path) -> SiteMapping:
    """Read nce-mapping.json.

    An unknown slug stops startup rather than dropping that signal for the whole pilot: a bridge
    that runs while quietly discarding blood pressure is worse than one that refuses to start and
    says why.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))

    signals: dict[str, MappedField] = {}
    for name, spec in (raw.get("signals") or {}).items():
        slug = spec.get("signal") if isinstance(spec, dict) else spec
        unit = spec.get("unit", "") if isinstance(spec, dict) else ""
        try:
            signals[name] = MappedField(SignalCode(slug), unit)
        except ValueError:
            raise SystemExit(
                f"{path}: unknown signal slug {slug!r} for device field {name!r}"
            ) from None

    return SiteMapping(
        signals=signals,
        patient_fields=tuple(raw.get("patient_fields") or ()),
        timestamp_fields=tuple(raw.get("timestamp_fields") or ()),
        pair_attributes=tuple(
            (pair["name"], pair["value"]) for pair in (raw.get("pair_attributes") or ())
        ),
    )
