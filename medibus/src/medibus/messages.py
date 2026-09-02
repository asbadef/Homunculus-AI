"""Decoders for MEDIBUS response payloads (the bytes between the command echo and the checksum).

Formats from the protocol definition Rev 6.00:

    measured data / alarm limits   CODE(2 ASCII-hex) DATA(4 chars)   repeated
    device settings                CODE(2 ASCII-hex) DATA(5 chars)   repeated
    alarms                         PRIORITY(1 char, value+30H) CODE(2) PHRASE(12)   repeated
    device identification          NNNN'Name'DD.DD:MM.MM

Surplus positions and leading zeros in DATA are spaces; a negative value carries a '-' before the
digits. A parameter the device cannot measure is simply absent — it never sends a placeholder —
so a value that does not parse as a number is an anomaly worth counting, never worth guessing at.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Reading:
    code: str       # two uppercase ASCII-hex characters, as printed in the Dräger tables
    raw: str        # the value field verbatim (spaces included)


@dataclass(frozen=True)
class Alarm:
    priority: int   # 1..31, 31 highest
    code: str
    phrase: str


@dataclass(frozen=True)
class DeviceId:
    id: str
    name: str
    device_revision: str
    medibus_revision: str


def _records(payload: bytes, width: int, value_width: int) -> list[Reading]:
    text = payload.decode("ascii", errors="replace")
    out = []
    for start in range(0, len(text) - width + 1, width):
        code = text[start:start + 2].upper()
        out.append(Reading(code, text[start + 2:start + 2 + value_width]))
    return out


def parse_measured(payload: bytes) -> list[Reading]:
    """Measured data or alarm-limit response: 2-char code + 4-char value."""
    return _records(payload, 6, 4)


def parse_settings(payload: bytes) -> list[Reading]:
    """Device-settings response: 2-char code + 5-char value."""
    return _records(payload, 7, 5)


def parse_alarms(payload: bytes) -> list[Alarm]:
    text = payload.decode("ascii", errors="replace")
    out = []
    for start in range(0, len(text) - 15 + 1, 15):
        priority = ord(text[start]) - 0x30
        out.append(Alarm(priority, text[start + 1:start + 3].upper(), text[start + 3:start + 15].strip()))
    return out


_NUMBER = re.compile(r"^-?\d+(\.\d+)?$|^-?\.\d+$")


def numeric(reading: Reading) -> float | None:
    """The value as a float, or None when the field is not a plain decimal number."""
    text = reading.raw.strip()
    if not _NUMBER.match(text):
        return None
    return float(text)


_DEVICE_ID = re.compile(r"^\s*(\S{4})\s*'([^']*)'\s*(\S+?)[:\s]+(\S+)\s*$")


def parse_device_id(payload: bytes) -> DeviceId | None:
    """`NNNN'Name'DD.DD:MM.MM`; tolerant of the spacing variants seen in vendor documents."""
    match = _DEVICE_ID.match(payload.decode("ascii", errors="replace"))
    if not match:
        return None
    ident, name, device_rev, medibus_rev = match.groups()
    return DeviceId(ident, name.strip(), device_rev, medibus_rev)
