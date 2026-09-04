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
    stats: BridgeStats = field(default_factory=BridgeStats)

    def handle_message(self, message: str) -> list[Observation]:
        """Parse one HL7 message and forward every observation it carries."""
        self.stats.messages += 1
        try:
            observations = parse_hl7_oru(message, self.mapping)
        except GatewayError:
            # Structurally broken message. Count it; never log its content (PHI).
            self.stats.rejected += 1
            _log.warning("rejected an unparseable HL7 message (content not logged)")
            raise

        self._record_unmapped(message)

        for obs in observations:
            self.send(observation_to_fhir(obs))
        self.stats.observations += len(observations)
        return observations

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
        manually entered identifier survive into the observation.
        """
        reply = patient_query_response(message)
        if reply is not None:
            self.stats.queries += 1
        return reply

    async def serve(self, host: str = "0.0.0.0", port: int = 2575) -> asyncio.AbstractServer:
        """Start listening. 2575 is the IANA-registered port for HL7 over MLLP."""
        _log.info("edge bridge listening for MLLP on %s:%s", host, port)
        return await serve_mllp(host, port, handler=self.handle_message, responder=self.answer_query)
