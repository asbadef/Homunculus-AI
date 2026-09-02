"""MEDIBUS byte framing: checksums, encoders and a stream parser.

Source: Dräger "RS 232 MEDIBUS Protocol Definition" Rev 6.00 (90 28 258), sections "Structure of
Commands", "Structure of Responses", "Responding to corrupt Commands", "ASCII HEX Format" and the
FAQ on embedded commands and realtime bytes.

    command   ESC(1BH) CODE [ARGUMENT <= 251 bytes] CHECKSUM(2 ASCII-hex) CR(0DH)
    response  SOH(01H) ECHO [RESPONSE]              CHECKSUM(2 ASCII-hex) CR(0DH)

The checksum is the least-significant byte of the sum of every preceding byte INCLUDING the
leading ESC/SOH, in uppercase ASCII hex. A command may be embedded at any position inside a
response (its checksum is computed separately), and realtime records (bytes >= 80H) may appear
anywhere and never count towards a checksum.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ESC = b"\x1b"
SOH = b"\x01"
CR = b"\x0d"
DC1 = b"\x11"       # suspend transmission
DC3 = b"\x13"       # resume transmission
CAN = b"\x18"       # abort transmission in progress
NAK = 0x15          # echo field of the response to a corrupt command

MAX_ARGUMENT = 251
MAX_RESPONSE = 3845     # bytes, whole frame

_CONTROL_BYTES = frozenset((DC1[0], DC3[0], CAN[0]))


def checksum(data: bytes) -> bytes:
    """Least-significant byte of the byte sum, as two uppercase ASCII-hex characters."""
    return f"{sum(data) & 0xFF:02X}".encode("ascii")


def encode_command(code: int, argument: bytes = b"") -> bytes:
    if len(argument) > MAX_ARGUMENT:
        raise ValueError(f"MEDIBUS command argument exceeds {MAX_ARGUMENT} bytes")
    body = ESC + bytes([code]) + argument
    return body + checksum(body) + CR


def encode_response(echo: int, payload: bytes = b"") -> bytes:
    body = SOH + bytes([echo]) + payload
    frame = body + checksum(body) + CR
    if len(frame) > MAX_RESPONSE:
        raise ValueError(f"MEDIBUS response exceeds {MAX_RESPONSE} bytes")
    return frame


@dataclass(frozen=True)
class Frame:
    kind: Literal["command", "response"]
    code: int
    payload: bytes
    checksum_ok: bool


@dataclass(frozen=True)
class Control:
    """A flow-control byte (DC1/DC3/CAN) seen on the wire. They are valid at any position."""
    byte: int


class StreamParser:
    """Turns an arbitrary byte stream into frames, one byte at a time.

    Keeps at most one open command and one open response; bytes go to the innermost open frame,
    which is how a command embedded in a response comes out as its own frame with its own
    checksum. A second start byte of the same kind abandons the unterminated frame rather than
    gluing two frames into one — a single lost CR must not poison the stream.
    """

    def __init__(self) -> None:
        self._command: bytearray | None = None
        self._response: bytearray | None = None

    def feed(self, data: bytes) -> list[Frame | Control]:
        out: list[Frame | Control] = []
        for byte in data:
            if byte >= 0x80:
                continue                      # realtime record byte: outside the slow protocol
            if byte == ESC[0]:
                self._command = bytearray([byte])
            elif byte == SOH[0]:
                self._response = bytearray([byte])
            elif byte in _CONTROL_BYTES:
                out.append(Control(byte))
            elif byte == CR[0]:
                if self._command is not None:
                    out.append(self._finish("command", self._command))
                    self._command = None
                elif self._response is not None:
                    out.append(self._finish("response", self._response))
                    self._response = None
            else:
                target = self._command if self._command is not None else self._response
                if target is None:
                    continue                  # noise before the first frame
                target.append(byte)
                if len(target) > MAX_RESPONSE:
                    if target is self._command:
                        self._command = None
                    else:
                        self._response = None
        return out

    @staticmethod
    def _finish(kind: Literal["command", "response"], buf: bytearray) -> Frame:
        if len(buf) < 4:
            return Frame(kind, buf[1] if len(buf) > 1 else 0, b"", False)
        body, received = bytes(buf[:-2]), bytes(buf[-2:])
        return Frame(kind, body[1], body[2:], checksum(body) == received)
