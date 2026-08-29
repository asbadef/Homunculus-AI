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
from dataclasses import dataclass, field
from datetime import datetime

from homunculus.canonical import Observation
from homunculus.edge.ncefiles import SiteMapping, parse_session, session_fields
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.fhir import GatewayError

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
        """Parse one session file and forward every observation it carries."""
        self.stats.files += 1
        self._record_unmapped(text)

        try:
            parsed = parse_session(
                text, self.mapping,
                fallback_timestamp=fallback_timestamp, source_device=source_device,
            )
        except GatewayError:
            self.stats.rejected += 1
            _log.warning("rejected an unusable NCE session (content not logged)")
            raise

        for name in parsed.non_numeric:
            _bump(self.stats.non_numeric, name)
        for name in parsed.repeated:
            _bump(self.stats.repeated, name)

        for observation in parsed.observations:
            self.send(observation_to_fhir(observation))
        self.stats.observations += len(parsed.observations)
        return parsed.observations

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


def _rank(counter: dict[str, int], top: int = 50) -> str:
    # This line is logged every ~30s; an undocumented vendor format could encode sequence
    # numbers or other high-cardinality junk into field names, so the line must stay bounded
    # and readable rather than growing without limit.
    ranked = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)
    shown = ", ".join(f"{name} ({count})" for name, count in ranked[:top])
    if len(ranked) > top:
        shown += ", …"
    return shown
