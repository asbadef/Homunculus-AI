"""Waveform blocks in the Infinity multicast payload: decoded, and the last seconds kept per monitor.

Research decoding for DISPLAY ONLY (docs/INFINITY-DALGA-FORMU.md; the dalga spec, §3.1). Nothing
here interprets a sample: no rate, beat, alarm or other number is derived from a wave. The hub
keeps WINDOW_S of blocks per monitor in memory and nothing else; the journal keeps its encrypted
raw payloads exactly as before, and nothing here reads it. Standard library only: the release
packs `edge/` alone (deploy/infinity/build_transport_release.py).

A payload is a 64-byte header (byte 29: the message type), then blocks, back to back:

    u16 rate_hz | u16 len | u16 ms | u32 device_s | u16 wave_id | u8 n | u8 0 | n x i16, big-endian

with len == 14 + 2n and n == rate / 5: one block is 200 ms of one wave. The once-a-second message
carries the numeric-record section after the same blocks, so decoding stops at the first thing
that is not a block and keeps what came before it. A block whose samples are ALL 0x0001 means "no
signal" (lead off, channel closed): it is kept with `samples=None` and must never be drawn as a
flat line, which reads as asystole. A lone 1 inside a live block is data.

Monitors are named by their source address, as the strip names them (`edge/infinity_shadow.py`
sends no inventory name), so the API can find a monitor on a strip card and ask for it here.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from datetime import datetime, timezone

SCHEMA = "homunculus.infinity-waves.v1"
HEADER = 64
_BLOCK = struct.Struct(">HHHIHBB")            # rate, len, ms, device_s, wave_id, n, zero: 14 bytes
RATES = frozenset({50, 100, 200, 250, 500})   # the spec's set, wider than the 50/100/200 the ward has shown
NO_SIGNAL = 0x0001


def _ecg(evidence):
    return {"kind": "ecg", "label": None, "rate": 200, "unit": None, "scale": None, "evidence": evidence}


def _pressure(label, rate):
    return {"kind": "pressure", "label": label, "rate": rate, "unit": "mmHg", "scale": 1 / 40,
            "evidence": "screen_scale"}


#: wave id -> what the API and the screen say about it (docs/INFINITY-DALGA-FORMU.md, "Dalga
#: kimlikleri", and the lead's ward note of 2026-10-27, BED08). ECG: the live channel is NOT fixed
#: by id (0x0103 on BED07, 0x0102 on BED08), so no ECG id carries a lead name; the screen picks the
#: live ones. Pressure: two ids, both mmHg = sample / 40 against the screen; 0x0301 is the screen's
#: "ART", 0x0e01 the screen's "P1" — a pressure is called "ART" only when its id is 0x0301. A rate
#: here is what was seen; the block's own rate is what is drawn.
WAVES = {
    0x0102: _ecg("structural"),
    0x0103: _ecg("structural"),
    0x0104: _ecg("unverified"),
    0x0122: _ecg("unverified"),
    0x0124: _ecg("unverified"),
    0x0301: _pressure("ART", 100),
    0x0E01: _pressure("P1", 100),
    0x1916: {"kind": "pleth", "label": "Pleth", "rate": 100, "unit": None, "scale": None, "evidence": "structural"},
    0x0201: {"kind": "resp", "label": "RESP", "rate": 50, "unit": None, "scale": None, "evidence": "structural"},
}


@dataclass(frozen=True)
class WaveBlock:
    rate: int
    ms: int
    device_s: int
    wave_id: int
    samples: tuple[int, ...] | None        # None: every sample was 0x0001, "no signal"

    @property
    def t_ms(self) -> int:
        """Device time in whole milliseconds: exact, so two copies of a block compare equal."""
        return self.device_s * 1000 + self.ms


def parse_waves(payload) -> list[WaveBlock]:
    """The wave blocks of one payload, in order. Pure; never raises; [] for anything else."""
    # Header byte 29 (the message type) and block byte 13 (always 0) are deliberately not checked: the
    # type that carries the record section varies by device; the spec's four rules are the contract.
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        return []
    data = bytes(payload)
    blocks = []
    offset = HEADER
    try:
        while offset + _BLOCK.size <= len(data):
            rate, size, ms, device_s, wave_id, n, _zero = _BLOCK.unpack_from(data, offset)
            if (rate not in RATES or n != rate // 5 or size != _BLOCK.size + 2 * n or ms > 999
                    or offset + size > len(data)):
                break                         # the record section, a truncated block, or not a block
            samples = struct.unpack_from(f">{n}h", data, offset + _BLOCK.size)
            blocks.append(WaveBlock(rate, ms, device_s, wave_id,
                                    None if all(s == NO_SIGNAL for s in samples) else samples))
            offset += size
    except struct.error:                      # the bounds check above already covers it: belt and braces
        return blocks
    return blocks


def iso_z(epoch: float) -> str:
    """An epoch as UTC ISO 8601 with milliseconds and a Z."""
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
