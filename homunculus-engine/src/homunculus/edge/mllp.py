# src/homunculus/edge/mllp.py
"""MLLP transport — the TCP socket a monitor or central station connects to.

MLLP (Minimal Lower Layer Protocol) frames each HL7 message as ``<VT>message<FS><CR>``. This
module is the I/O edge: framing, acknowledgement, and an asyncio server. Parsing lives in
gateway/hl7.py; what to do with a message is the caller's handler.

Two rules come from how real interfaces behave:

* **Always acknowledge.** A monitor that receives no ACK will retry the message or raise its own
  interface alarm. So a message we could not process is answered with an application-error ACK
  (``AE``) — never with silence.
* **One bad message must not take the link down.** A failing handler is contained: the sender is
  told, and the connection stays open for everything after it.

PHI: message content is never logged. Only counts and connection-level facts are.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timezone

VT = b"\x0b"    # start block
FS = b"\x1c"    # end block
CR = b"\x0d"    # carriage return

_log = logging.getLogger(__name__)


class MllpFramer:
    """Turns a TCP byte stream into complete HL7 messages.

    Stateful across calls: a frame split over several packets is reassembled, several frames in
    one packet are all returned, and bytes before a start block are discarded (a reconnecting
    monitor can leave junk mid-stream, so we resync on the next VT).
    """

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> list[str]:
        self._buffer.extend(chunk)
        messages: list[str] = []

        while True:
            start = self._buffer.find(VT)
            if start == -1:
                self._buffer.clear()          # nothing framed yet; drop noise
                break
            if start > 0:
                del self._buffer[:start]      # resync: discard bytes before the start block

            end = self._buffer.find(FS + CR)
            if end == -1:
                break                         # frame not complete yet — keep it buffered

            messages.append(self._buffer[1:end].decode("utf-8", errors="replace"))
            del self._buffer[: end + 2]

        return messages


def _msh_fields(message: str) -> list[str]:
    first = message.split("\r", 1)[0]
    return first.split("|") if first.startswith("MSH") else []


def ack_for(message: str, code: str = "AA") -> str:
    """Build an HL7 ACK for `message`.

    `code` is the acknowledgement code: AA (accepted) or AE (application error). Sender and
    receiver are swapped, and the original message control id is echoed so the monitor can match
    the acknowledgement to what it sent. An unparseable message still yields a well-formed ACK —
    the sender must always hear something back.
    """
    fields = _msh_fields(message)

    def at(i: int) -> str:
        return fields[i] if i < len(fields) else ""

    sending_app, sending_fac = at(2), at(3)
    receiving_app, receiving_fac = at(4) or "HOMUNCULUS", at(5) or ""
    control_id = at(9)
    version = at(11) or "2.5"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    msh = "|".join([
        "MSH", "^~\\&",
        receiving_app, receiving_fac,      # we answer as the original receiver
        sending_app, sending_fac,          # back to whoever sent it
        stamp, "", "ACK", control_id, "P", version,
    ])
    return f"{msh}\r MSA|{code}|{control_id}".replace("\r ", "\r")


def _framed(message: str) -> bytes:
    return VT + message.encode("utf-8") + FS + CR


async def serve_mllp(
    host: str,
    port: int,
    handler: Callable[[str], None],
    responder: Callable[[str], str | None] | None = None,
) -> asyncio.AbstractServer:
    """Start an MLLP server. `handler` is called with each complete HL7 message.

    Returns the asyncio server so the caller controls its lifetime (and can read the bound port
    when `port` is 0). A handler that raises is reported to the sender as AE and does not close
    the connection.

    `responder`, when given, sees every message first. If it returns a message, that reply is
    sent instead of an ACK and the handler is not called — this is how a query (a QBP^Q22 patient
    lookup) gets an RSP rather than being mistaken for a result and rejected.
    """

    async def on_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        _log.info("MLLP client connected: %s", peer)
        framer = MllpFramer()
        try:
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break                                   # sender closed the link
                for message in framer.feed(chunk):
                    reply = None
                    if responder is not None:
                        try:
                            reply = responder(message)
                        except Exception:                   # a broken reply must not go silent
                            _log.exception("MLLP responder failed for a message from %s", peer)
                    if reply is None:
                        code = "AA"
                        try:
                            handler(message)
                        except Exception:                   # never let one message kill the link
                            code = "AE"
                            _log.exception("MLLP handler failed for a message from %s", peer)
                        reply = ack_for(message, code=code)
                    writer.write(_framed(reply))
                    await writer.drain()
        except (ConnectionResetError, asyncio.IncompleteReadError):
            _log.info("MLLP client dropped: %s", peer)
        finally:
            writer.close()
            _log.info("MLLP client disconnected: %s", peer)

    return await asyncio.start_server(on_client, host, port)
