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
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from homunculus.canonical import SignalCode
from homunculus.gateway.fhir import GatewayError


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


def _local_name(tag: str) -> str:
    """`{urn:welchallyn:nce}SpO2` -> `SpO2`.

    Vendors add, drop and renumber namespaces between versions. A site table keyed on a namespace
    URI would break on an upgrade for no clinical reason, so the URI is discarded.
    """
    return tag.rpartition("}")[2]


def _flat_pairs(root: ET.Element) -> list[tuple[str, str]]:
    """Every (name, value) in the document: element text and attributes alike."""
    pairs: list[tuple[str, str]] = []
    for element in root.iter():
        text = (element.text or "").strip()
        if text:
            pairs.append((_local_name(element.tag), text))
        for attribute, value in element.attrib.items():
            value = (value or "").strip()
            if value:
                pairs.append((_local_name(attribute), value))
    return pairs


def _paired_attributes(
    root: ET.Element, pairs_config: tuple[tuple[str, str], ...]
) -> list[tuple[str, str]]:
    """Read the `<Reading name="SpO2" value="97"/>` idiom into ("SpO2", "97")."""
    found: list[tuple[str, str]] = []
    for element in root.iter():
        attributes = {_local_name(k): (v or "").strip() for k, v in element.attrib.items()}
        for name_attribute, value_attribute in pairs_config:
            name = attributes.get(name_attribute, "")
            value = attributes.get(value_attribute, "")
            if name and value:
                found.append((name, value))
    return found


def session_pairs(text: str, mapping: SiteMapping | None = None) -> list[tuple[str, str]]:
    """Every name/value pair a session carries, in document order.

    Raises GatewayError if the document is not well-formed. The message names the failure class only
    — an XML parser's own error text can quote the offending bytes, which here are patient data.
    """
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise GatewayError(
            f"session is not well-formed XML ({exc.__class__.__name__})"
        ) from None
    pairs = _flat_pairs(root)
    if mapping is not None and mapping.pair_attributes:
        pairs.extend(_paired_attributes(root, mapping.pair_attributes))
    return pairs


def session_fields(text: str, mapping: SiteMapping | None = None) -> list[str]:
    """The field names a session carries, duplicates included. This is what discovery reports."""
    return [name for name, _ in session_pairs(text, mapping)]
