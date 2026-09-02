# src/homunculus/edge/ncebridge.py
"""The NCE file route: one session in, FHIR observations out, everything else counted.

The counterpart of edge/bridge.py for the file source. It is deliberately thin — no clinical
reasoning, only normalisation and bookkeeping — and its bookkeeping exists for one reason: a site
whose field table is wrong looks exactly like a quiet ward. Files keep arriving, the mount keeps
working, and nothing reaches the engine. The counters are what make that visible.

PHI: a session that cannot be parsed is counted, never logged. Field names are device metadata and
are reported; values never are.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime

from homunculus.canonical import Observation
from homunculus.edge.bridge import _obx_codes
from homunculus.edge.ncefiles import SiteMapping, parse_session, session_fields
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.fhir import GatewayError
from homunculus.gateway.hl7 import parse_hl7_oru

_log = logging.getLogger(__name__)


@dataclass
class NceStats:
    """Operational counters. Deliberately holds no session content."""
    files: int = 0
    observations: int = 0
    rejected: int = 0
    unmapped: dict[str, int] = field(default_factory=dict)
    non_numeric: dict[str, int] = field(default_factory=dict)
    repeated: dict[str, int] = field(default_factory=dict)


def _bump(counter: dict[str, int], name: str) -> None:
    counter[name] = counter.get(name, 0) + 1


@dataclass
class NceFileBridge:
    """Wires the session parser to a sender.

    `send` receives one FHIR Observation dict and is expected to deliver it (in production, an
    append to the store-and-forward buffer). `mapping` is the per-site field table.
    """

    send: Callable[[dict], None]
    mapping: SiteMapping
    stats: NceStats = field(default_factory=NceStats)

    def handle_session(
        self,
        text: str | bytes,
        *,
        fallback_timestamp: datetime | None = None,
        source_device: str = "nce",
    ) -> tuple[Observation, ...]:
        """Parse one session file and forward every observation it carries.

        The folder holds two kinds of file: the device's WACP-XML session, and NCE's own HL7
        rendering of the same reading (the NCEToHost copies). The HL7 face is preferred when a
        file carries it — NCE has already normalised the vendor's object soup to MDC codes there.
        """
        self.stats.files += 1

        hl7 = _as_hl7(text)
        if hl7 is not None:
            return self._handle_hl7(
                hl7, fallback_timestamp=fallback_timestamp, source_device=source_device)

        self._record_unmapped(text)

        try:
            parsed = parse_session(
                text, self.mapping,
                fallback_timestamp=fallback_timestamp, source_device=source_device,
            )
        except GatewayError as exc:
            self.stats.rejected += 1
            # GatewayError texts are safe by construction: static strings or message metadata
            # (an MSH-9 type), never a value — so naming the reason costs no PHI and saves the
            # next person a blind diagnosis session.
            _log.warning("rejected an unusable NCE session: %s (content not logged)", exc)
            raise

        for name in parsed.non_numeric:
            _bump(self.stats.non_numeric, name)
        for name in parsed.repeated:
            _bump(self.stats.repeated, name)

        for observation in parsed.observations:
            self.send(observation_to_fhir(observation))
        self.stats.observations += len(parsed.observations)
        return parsed.observations

    def _handle_hl7(
        self,
        message: str,
        *,
        fallback_timestamp: datetime | None,
        source_device: str,
    ) -> tuple[Observation, ...]:
        """One NCEToHost copy through the existing HL7 gateway.

        Timestamps: the vendor's HL7 stamps are naive local time from a server whose displayed
        clock is known to run an hour off its own files' UTC epochs, so every observation is
        restamped with the filename's UTC epoch — the reading and the file are seconds apart.
        No epoch means no trustworthy time, and the copy is refused rather than guessed at.
        """
        known = set(self.mapping.hl7_signals)
        for code in _obx_codes(message):
            if code and code not in known:
                _bump(self.stats.unmapped, code)

        if fallback_timestamp is None:
            self.stats.rejected += 1
            _log.warning("rejected an HL7 host copy whose filename carries no epoch")
            raise GatewayError("HL7 host copy carries no trustworthy time (no filename epoch)")

        try:
            observations = parse_hl7_oru(message, self.mapping.hl7_signals)
        except GatewayError as exc:
            self.stats.rejected += 1
            # GatewayError texts are safe by construction: static strings or message metadata
            # (an MSH-9 type), never a value — so naming the reason costs no PHI and saves the
            # next person a blind diagnosis session.
            _log.warning("rejected an unusable NCE session: %s (content not logged)", exc)
            raise

        restamped = tuple(
            replace(obs, timestamp=fallback_timestamp, source_device=source_device)
            for obs in observations
        )
        for observation in restamped:
            self.send(observation_to_fhir(observation))
        self.stats.observations += len(restamped)
        return restamped

    def _record_unmapped(self, text: str | bytes) -> None:
        """Count field names the site table does not cover.

        Runs BEFORE parsing, so a session that is refused for a missing patient identifier still
        reports which fields it actually carried — which is the only way that misconfiguration is
        diagnosable from a log.
        """
        known = (
            set(self.mapping.signals)
            | set(self.mapping.patient_fields)
            | set(self.mapping.timestamp_fields)
        )
        try:
            names = session_fields(text, self.mapping)
        except GatewayError:
            return          # malformed XML; the parse below counts it as rejected
        for name in names:
            if name and name not in known:
                _bump(self.stats.unmapped, name)

    def discovery_report(self) -> str:
        """Human-readable list of what this site sent that we could not use. Empty when all is well.

        Reports names and counts — never a measurement and never a patient identifier. The count
        means occurrences for unmapped fields, but files for non_numeric/repeated: ParsedSession
        dedupes each of those per session, so a field junk in every reading of one file still
        shows 1, not the number of readings.

        If `pair_attributes` is configured, an attribute VALUE can be promoted to a field name and
        surface in this report — so configure pairing only after a human has inspected real
        session files. A pure discovery run (an empty mapping) promotes nothing.
        """
        sections: list[str] = []
        if self.stats.unmapped:
            sections.append("Eşlenmemiş alanlar: " + _rank(self.stats.unmapped))
        if self.stats.non_numeric:
            sections.append("Sayı olmayan değerler: " + _rank(self.stats.non_numeric))
        if self.stats.repeated:
            sections.append("Aynı dosyada tekrarlanan alanlar: " + _rank(self.stats.repeated))
        return " | ".join(sections)


def _as_hl7(text: str | bytes) -> str | None:
    """The payload as an HL7 string if it is one, else None.

    NCE writes its host-bound HL7 copies into the same folder as the device XML, so both arrive
    here. Decoding tries UTF-8 first and falls back to ISO 8859-9 — the encoding NCE ships for
    Turkish sites (see its Encodings directory); a replacement character in a name field is
    survivable, a dropped reading is not.
    """
    if isinstance(text, bytes):
        raw = text.lstrip(b"\xef\xbb\xbf").lstrip()
        if not raw.startswith(b"MSH|"):
            return None
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return raw.decode("iso8859-9", errors="replace")
    stripped = text.lstrip("\ufeff").lstrip()
    return stripped if stripped.startswith("MSH|") else None


def _rank(counter: dict[str, int], top: int = 50) -> str:
    # This line is logged every ~30s; an undocumented vendor format could encode sequence
    # numbers or other high-cardinality junk into field names, so the line must stay bounded
    # and readable rather than growing without limit.
    ranked = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)
    shown = ", ".join(f"{name} ({count})" for name, count in ranked[:top])
    if len(ranked) > top:
        shown += ", …"
    return shown
