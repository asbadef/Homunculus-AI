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


# ----------------------------------------------- the responder's thread (G2-B1d, F-32)
QUERY = "MSH|^~\\&|NCE|HOSP|EMR|HIS|20261101080000||QBP^Q22|Q1|P|2.6\rQPD|x|Q1|y\r"


async def _exchange(server, *messages: str) -> list[str]:
    """Send each message on one connection, one at a time; the framed answers, decoded."""
    port = server.sockets[0].getsockname()[1]
    answers: list[str] = []
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    try:
        for message in messages:
            writer.write(frame(message))
            await writer.drain()
            answers.append((await asyncio.wait_for(reader.read(4096), timeout=5))[1:-2].decode())
    finally:
        writer.close()
        server.close()
        await asyncio.wait_for(server.wait_closed(), timeout=5)
    return answers


@pytest.mark.asyncio
async def test_only_what_responds_to_accepts_leaves_the_loop_and_the_rest_stays_on_it():
    """The responder may wait on the network, so it gets a worker thread — but only for the
    messages the predicate names; every other message goes to the handler on the loop, as it did
    before the responder moved off it, and the responder never sees it."""
    import threading

    loop_thread = threading.get_ident()
    asked: list[tuple[str, int]] = []
    handled: list[tuple[str, int]] = []

    def responder(message: str):
        asked.append((message, threading.get_ident()))
        return "RSP|answer\r"

    def handler(message: str) -> None:
        handled.append((message, threading.get_ident()))

    server = await serve_mllp("127.0.0.1", 0, handler=handler, responder=responder,
                              responds_to=lambda message: message.startswith("MSH|^~\\&|NCE") and
                              "QBP^Q22" in message)
    answers = await _exchange(server, QUERY, ORU)
    assert answers[0] == "RSP|answer\r"
    assert "MSA|AA|MSG00042" in answers[1]
    assert [m for m, _ in asked] == [QUERY]
    assert asked[0][1] != loop_thread                      # the query waited on a worker
    assert handled == [(ORU, loop_thread)]                 # the reading ran on the loop


@pytest.mark.asyncio
async def test_without_responds_to_the_responder_sees_every_message_off_the_loop():
    import threading

    asked: list[int] = []

    def responder(message: str):
        asked.append(threading.get_ident())
        return None

    server = await serve_mllp("127.0.0.1", 0, handler=lambda _m: None, responder=responder)
    answers = await _exchange(server, QUERY, ORU)
    assert len(asked) == 2 and threading.get_ident() not in asked
    assert all("MSA|AA|" in a for a in answers)            # None from the responder: a plain ACK


@pytest.mark.asyncio
async def test_a_predicate_that_fails_does_not_silence_the_message():
    seen: list[str] = []

    def broken(_message: str) -> bool:
        raise ValueError("simulated predicate failure")

    server = await serve_mllp("127.0.0.1", 0, handler=seen.append, responder=lambda _m: "RSP\r",
                              responds_to=broken)
    answers = await _exchange(server, ORU)
    assert "MSA|AA|MSG00042" in answers[0] and seen == [ORU]    # handled and acknowledged
