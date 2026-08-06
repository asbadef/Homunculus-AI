"""
MLLP transport — the socket a bedside monitor / central station actually connects to.

MLLP frames an HL7 message as <VT>message<FS><CR>. Two things matter in a real unit:
  * framing must survive TCP reality (a frame split across packets, several frames in one packet);
  * EVERY message must be acknowledged. A monitor that gets no ACK retries or raises its own
    interface alarm, so a parse failure must still produce an ACK (AE), never silence.

PHI: message content is never logged.
"""
from __future__ import annotations

import asyncio

import pytest

from homunculus.edge.mllp import (
    CR, FS, VT, MllpFramer, ack_for, serve_mllp,
)

ORU = (
    "MSH|^~\\&|MONITOR|ICU|HOMUNCULUS|HOSP|20260803120000||ORU^R01|MSG00042|P|2.5\r"
    "PID|||bed-3\r"
    "OBX|1|NM|heart_rate||118|bpm|||||F|||20260803120000\r"
)


def frame(message: str) -> bytes:
    return VT + message.encode("utf-8") + FS + CR


# ---------------------------------------------------------------- framing


def test_extracts_a_single_complete_frame():
    framer = MllpFramer()
    assert framer.feed(frame("HELLO")) == ["HELLO"]


def test_reassembles_a_frame_split_across_packets():
    framer = MllpFramer()
    payload = frame("SPLIT-ME")
    assert framer.feed(payload[:4]) == []        # nothing complete yet
    assert framer.feed(payload[4:]) == ["SPLIT-ME"]


def test_extracts_several_frames_from_one_packet():
    framer = MllpFramer()
    assert framer.feed(frame("A") + frame("B")) == ["A", "B"]


def test_ignores_bytes_before_the_start_block():
    """A reconnecting monitor can leave junk in the stream; resync on the next VT."""
    framer = MllpFramer()
    assert framer.feed(b"garbage" + frame("CLEAN")) == ["CLEAN"]


def test_holds_an_unterminated_frame_without_emitting_it():
    framer = MllpFramer()
    assert framer.feed(VT + b"INCOMPLETE") == []
    assert framer.feed(FS + CR) == ["INCOMPLETE"]


# ---------------------------------------------------------------- acknowledgement


def test_ack_echoes_the_message_control_id():
    ack = ack_for(ORU)
    assert "MSA|AA|MSG00042" in ack


def test_ack_swaps_sender_and_receiver():
    ack = ack_for(ORU)
    msh = ack.split("\r")[0].split("|")
    assert msh[2] == "HOMUNCULUS" and msh[3] == "HOSP"   # we are now the sender
    assert msh[4] == "MONITOR" and msh[5] == "ICU"       # the monitor is the receiver


def test_error_ack_still_carries_the_control_id():
    """A message we could not process must still be acknowledged, as AE — never silence."""
    ack = ack_for(ORU, code="AE")
    assert "MSA|AE|MSG00042" in ack


def test_ack_for_an_unparseable_message_is_still_produced():
    ack = ack_for("this is not HL7 at all", code="AE")
    assert ack.startswith("MSH|") and "MSA|AE" in ack


# ---------------------------------------------------------------- the server


@pytest.mark.asyncio
async def test_server_receives_a_message_and_acknowledges_it():
    received: list[str] = []
    server = await serve_mllp("127.0.0.1", 0, handler=received.append)
    port = server.sockets[0].getsockname()[1]
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(frame(ORU))
        await writer.drain()
        reply = await asyncio.wait_for(reader.read(1024), timeout=5)
        writer.close()
        await writer.wait_closed()
    finally:
        server.close()
        await server.wait_closed()

    assert received == [ORU]
    assert reply.startswith(VT) and reply.endswith(FS + CR)      # ACK is MLLP-framed too
    assert "MSA|AA|MSG00042" in reply[1:-2].decode("utf-8")


@pytest.mark.asyncio
async def test_a_failing_handler_still_gets_an_error_ack_and_keeps_the_connection():
    """One bad message must not take the interface down for every message after it."""
    seen: list[str] = []

    def handler(message: str) -> None:
        seen.append(message)
        if len(seen) == 1:
            raise ValueError("simulated processing failure")

    server = await serve_mllp("127.0.0.1", 0, handler=handler)
    port = server.sockets[0].getsockname()[1]
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(frame(ORU))
        await writer.drain()
        first = await asyncio.wait_for(reader.read(1024), timeout=5)

        writer.write(frame(ORU))                                  # same link, next message
        await writer.drain()
        second = await asyncio.wait_for(reader.read(1024), timeout=5)
        writer.close()
        await writer.wait_closed()
    finally:
        server.close()
        await server.wait_closed()

    assert "MSA|AE|" in first.decode("utf-8")                     # failure acknowledged, not dropped
    assert "MSA|AA|" in second.decode("utf-8")                    # link survived
    assert len(seen) == 2
