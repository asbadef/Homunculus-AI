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
from datetime import datetime, timezone
from pathlib import Path

from homunculus.canonical import Observation, SignalCode
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


def parse_timestamp(raw: str) -> datetime | None:
    """A vendor timestamp as an aware UTC datetime, or None if it cannot be trusted.

    A value carrying no timezone is REFUSED, not assumed local. The NCE server displays session
    files an hour ahead of the UTC epoch in their own names, so "assume local" would shift every
    observation by an unknown amount — silently, and in a system whose alerts are timers.
    """
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


@dataclass(frozen=True)
class ParsedSession:
    """What one session yielded, and what it carried that we could not use.

    The two failure lists are not diagnostics for later — they are the reason the operator report
    can say a signal is going missing while files keep arriving.
    """
    observations: tuple[Observation, ...] = ()
    non_numeric: tuple[str, ...] = ()
    repeated: tuple[str, ...] = ()


def _first_value(pairs: list[tuple[str, str]], names: tuple[str, ...]) -> str:
    """The first non-empty value among `names`, preferring the order the site listed them in."""
    for wanted in names:
        for name, value in pairs:
            if name == wanted and value:
                return value
    return ""


def parse_session(
    text: str,
    mapping: SiteMapping,
    *,
    fallback_timestamp: datetime | None = None,
    source_device: str = "nce",
) -> ParsedSession:
    """One session file -> the observations it carries.

    Raises GatewayError when the session has no patient identifier or no trustworthy time: both make
    every reading in it unusable, and inventing either would put real numbers on an imaginary
    patient or an imaginary minute.
    """
    pairs = session_pairs(text, mapping)

    patient_id = _first_value(pairs, mapping.patient_fields)
    if not patient_id:
        raise GatewayError("session carries no patient identifier in any configured field")

    timestamp = parse_timestamp(_first_value(pairs, mapping.timestamp_fields))
    if timestamp is None:
        timestamp = fallback_timestamp
    if timestamp is None:
        raise GatewayError("session carries no usable UTC time and its filename has no epoch")

    observations: list[Observation] = []
    non_numeric: list[str] = []
    repeated: list[str] = []
    taken: set[str] = set()

    for name, raw_value in pairs:
        mapped = mapping.signals.get(name)
        if mapped is None:
            continue
        if name in taken:
            if name not in repeated:
                repeated.append(name)
            continue
        try:
            value = float(raw_value)
        except ValueError:
            if name not in non_numeric:
                non_numeric.append(name)
            continue
        taken.add(name)
        observations.append(Observation(
            patient_id=patient_id,
            code=mapped.signal,
            value=value,
            unit=mapped.unit,
            timestamp=timestamp,
            source_device=source_device,
        ))

    return ParsedSession(tuple(observations), tuple(non_numeric), tuple(repeated))
