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
from homunculus.edge.serialize import observation_to_fhir
from homunculus.gateway.fhir import GatewayError
from homunculus.gateway.hl7 import parse_hl7_oru

_log = logging.getLogger(__name__)


@dataclass
class BridgeStats:
    """Operational counters. Deliberately holds no message content."""
    messages: int = 0
    observations: int = 0
    rejected: int = 0


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

        for obs in observations:
            self.send(observation_to_fhir(obs))
        self.stats.observations += len(observations)
        return observations

    async def serve(self, host: str = "0.0.0.0", port: int = 2575) -> asyncio.AbstractServer:
        """Start listening. 2575 is the IANA-registered port for HL7 over MLLP."""
        _log.info("edge bridge listening for MLLP on %s:%s", host, port)
        return await serve_mllp(host, port, handler=self.handle_message)
