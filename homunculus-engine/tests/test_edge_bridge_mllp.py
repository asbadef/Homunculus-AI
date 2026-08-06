"""
The edge bridge end to end: a monitor opens a socket, sends HL7 over MLLP, and the
observations arrive at the uplink as FHIR — with the link surviving a bad message.
"""
from __future__ import annotations

import asyncio

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.mllp import FS, VT, CR
from homunculus.gateway.fhir import GatewayError

ORU = (
    "MSH|^~\\&|MONITOR|ICU|HOMUNCULUS|HOSP|20260803120000||ORU^R01|MSG1|P|2.5\r"
    "PID|||bed-3\r"
    "OBX|1|NM|heart_rate||118|bpm|||||F|||20260803120000\r"
    "OBX|2|NM|map||58|mmHg|||||F|||20260803120000\r"
)


def frame(message: str) -> bytes:
    return VT + message.encode("utf-8") + FS + CR


def test_parses_a_message_and_forwards_every_observation():
    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append)

    observations = bridge.handle_message(ORU)

    assert [o.code for o in observations] == [SignalCode.HEART_RATE, SignalCode.MAP]
    assert len(sent) == 2
    assert sent[0]["resourceType"] == "Observation"
    assert sent[0]["subject"]["reference"] == "Patient/bed-3"
    assert bridge.stats.messages == 1 and bridge.stats.observations == 2


def test_counts_a_broken_message_without_forwarding_anything():
    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append)

    with pytest.raises(GatewayError):
        bridge.handle_message("this is not an HL7 message")

    assert sent == []
    assert bridge.stats.rejected == 1 and bridge.stats.observations == 0


@pytest.mark.asyncio
async def test_a_monitor_can_connect_over_tcp_and_have_data_reach_the_uplink():
    sent: list[dict] = []
    bridge = EdgeBridge(send=sent.append)
    server = await bridge.serve(host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]

    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(frame(ORU))
        await writer.drain()
        ack = await asyncio.wait_for(reader.read(1024), timeout=5)

        # A broken message must be rejected but must not close the interface.
        writer.write(frame("NOT HL7"))
        await writer.drain()
        bad_ack = await asyncio.wait_for(reader.read(1024), timeout=5)

        writer.write(frame(ORU))                       # link still usable afterwards
        await writer.drain()
        third = await asyncio.wait_for(reader.read(1024), timeout=5)

        writer.close()
        await writer.wait_closed()
    finally:
        server.close()
        await server.wait_closed()

    assert "MSA|AA|MSG1" in ack.decode("utf-8")
    assert "MSA|AE|" in bad_ack.decode("utf-8")         # rejected, and the sender was told
    assert "MSA|AA|MSG1" in third.decode("utf-8")
    assert len(sent) == 4                              # 2 observations x 2 good messages
    assert bridge.stats.rejected == 1
