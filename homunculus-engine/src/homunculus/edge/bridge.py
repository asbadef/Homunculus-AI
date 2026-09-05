# src/homunculus/edge/bridge.py
"""The site edge bridge: MLLP in -> HL7 parsed -> FHIR forwarded to the cloud.

Runs on-prem next to the monitoring network. It is deliberately thin — it does no clinical
reasoning, only transport and normalisation — so the clinical rules stay in one place.

Resilience: forwarding goes through edge.forwarder, so if the uplink drops, observations queue in
order and flush on reconnect. Nothing is dropped silently and nothing is reordered.

PHI: a message that cannot be parsed is counted, never logged. Logging a rejected HL7 message
would write patient data into the log file, which is exactly where it must not be.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from homunculus.canonical import Observation, SignalCode
from homunculus.edge.adt import identity_to_fhir, parse_hl7_adt
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.mllp import serve_mllp
from homunculus.edge.pdq import patient_query_response
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.fhir import GatewayError
from homunculus.gateway.hl7 import default_mapping, parse_hl7_oru

_log = logging.getLogger(__name__)


@dataclass
class BridgeStats:
    """Operational counters. Deliberately holds no message content.

    `unmapped` counts OBX identifiers the site mapping does not cover. Those observations are
    dropped, and without this counter that failure is invisible: messages keep arriving, ACKs keep
    going back, and nothing reaches the engine.
    """
    messages: int = 0
    observations: int = 0
    rejected: int = 0
    queries: int = 0            # QBP^Q22 patient lookups answered (id echoed, nothing invented)
    adt: int = 0                # ADT messages accepted (identity records, not readings)
    unmapped: dict[str, int] = field(default_factory=dict)


def _obx_codes(message: str) -> list[str]:
    """OBX-3 identifiers in a message, first component only (``CODE^text`` -> ``CODE``)."""
    codes: list[str] = []
    for segment in message.replace("\n", "\r").split("\r"):
        if segment.startswith("OBX"):
            fields = segment.split("|")
            if len(fields) > 3:
                codes.append(fields[3].split("^")[0].strip())
    return codes


@dataclass
class EdgeBridge:
    """Wires an MLLP listener to a forwarder.

    `send` receives one FHIR Observation dict and is expected to deliver it (typically the
    store-and-forward flush). `mapping` is the per-site OBX code -> SignalCode table.
    """

    send: Callable[[dict], None]
    mapping: dict[str, SignalCode] | None = None
    identity: IdentityMirror | None = None
    identity_source: str = "comed"
    stats: BridgeStats = field(default_factory=BridgeStats)

    def handle_message(self, message: str) -> list[Observation]:
        """Parse one HL7 message and forward what it carries.

        Three kinds arrive on this port: ADT (who a protocol number is), ORU (readings), and
        QBP queries — the last are answered by `answer_query` before they ever reach here.
        """
        self.stats.messages += 1
        try:
            identity = parse_hl7_adt(message)
        except GatewayError as exc:
            self.stats.rejected += 1
            _log.warning("rejected an unusable ADT message: %s (content not logged)", exc)
            raise
        if identity is not None:
            self._record_identity(identity)
            return []

        try:
            observations = parse_hl7_oru(message, self.mapping)
        except GatewayError as exc:
            # Count it and name the reason; never log the content (PHI). GatewayError texts are
            # static strings or message metadata by construction, never a value — and a
            # rejection that does not say why costs a blind diagnosis round (ward, 2026-09-04:
            # every ORU from NCE was "unparseable" because PID-3 carried no id).
            self.stats.rejected += 1
            _log.warning("rejected an unusable HL7 message: %s (content not logged)", exc)
            raise

        self._record_unmapped(message)

        for obs in observations:
            self.send(observation_to_fhir(obs))
        self.stats.observations += len(observations)
        return observations

    def _record_identity(self, identity) -> None:
        """Mirror it for the device, then forward it upstream for the board."""
        if self.identity is not None:
            try:
                self.identity.upsert(identity)
            except Exception:       # a mirror fault must not stop the upstream record
                _log.exception("could not write the identity mirror (content not logged)")
        for resource in identity_to_fhir(identity, source=self.identity_source):
            self.send(resource)
        self.stats.adt += 1

    def _record_unmapped(self, message: str) -> None:
        """Count OBX identifiers this site's mapping does not cover."""
        known = self.mapping if self.mapping is not None else default_mapping()
        for code in _obx_codes(message):
            if code and code not in known:
                self.stats.unmapped[code] = self.stats.unmapped.get(code, 0) + 1

    def discovery_report(self) -> str:
        """Human-readable list of identifiers the device sent that nothing maps.

        Reports the identifier and how often it arrived — never the measurement or the patient,
        which are PHI. Empty string when every code is mapped.
        """
        if not self.stats.unmapped:
            return ""
        ranked = sorted(self.stats.unmapped.items(), key=lambda kv: kv[1], reverse=True)
        return "Eşlenmemiş kodlar: " + ", ".join(f"{code} ({count})" for code, count in ranked)

    def answer_query(self, message: str) -> str | None:
        """Reply to a patient lookup (QBP^Q22) ourselves; everything else goes to handle_message.

        A Welch Allyn NCE asks its patient-query host to validate the id typed on the device
        before it will put that id into the reading's PID-3. Echoing the id back is what makes a
        manually entered identifier survive into the observation; when Comed has told us who that
        id is, the answer carries the name too and the device shows the patient.
        """
        reply = patient_query_response(
            message, lookup=self.identity.get if self.identity is not None else None)
        if reply is not None:
            self.stats.queries += 1
        return reply

    async def serve(self, host: str = "0.0.0.0", port: int = 2575) -> asyncio.AbstractServer:
        """Start listening. 2575 is the IANA-registered port for HL7 over MLLP."""
        _log.info("edge bridge listening for MLLP on %s:%s", host, port)
        return await serve_mllp(host, port, handler=self.handle_message, responder=self.answer_query)
