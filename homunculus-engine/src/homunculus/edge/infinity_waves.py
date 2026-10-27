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

import base64
import bisect
import struct
import threading
import time
from array import array
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


# --- the ring ------------------------------------------------------------------------------------

WINDOW_S = 20.0            # what the hub holds per monitor, by device time and by receipt time
ANSWER_S = 10.0            # the most one answer carries per monitor
MAX_TRANSPORT_DELAY = 3.0  # = infinity_live.MAX_TRANSPORT_DELAY: an outbox replay is never live
MAX_QUERY_DEVICES = 16     # one hub request names at most this many monitors (phase 2's wall)


def _order(entry):
    return entry[0], entry[1]


class WaveBuffer:
    """The last WINDOW_S of wave blocks per monitor, in memory, and one cursor for the whole hub.

    An entry is (t_ms, wave_id, seq, received_at, recv, rate, samples), ordered by device time and
    one per (t_ms, wave_id). `seq` is the hub-wide cursor value the block was added under, so one
    `since` serves any set of monitors (phase 2's wall). A packet received more than
    MAX_TRANSPORT_DELAY before the hub's now, from the future, or not live, adds nothing: the rule
    `LiveResearchView` applies, so a worker outbox replay after an outage never appears as live.
    A fresh block more than WINDOW_S older than the monitor's newest means the monitor's clock went
    back (a restart, a clock set): what was held is dropped rather than left to hide the new data."""

    def __init__(self, inventory, *, clock=time.time):
        self.clock = clock
        self.lock = threading.Lock()
        self.devices = {device.source: [] for device in inventory.devices}
        self.keys = {device.source: set() for device in inventory.devices}
        self.cursor = 0
        self.refused = 0

    def knows(self, source) -> bool:
        return source in self.devices

    def consume(self, events) -> None:
        now = self.clock()
        with self.lock:
            for event in events:
                self._consume_one(event, now)

    def _consume_one(self, event, now) -> None:
        source = event.get("source_ip")
        payload = event.get("payload_base64")
        if source not in self.devices or payload is None:
            return
        epoch = event.get("received_at")
        if (event.get("mode") != "live" or type(epoch) not in (int, float)
                or not now - MAX_TRANSPORT_DELAY < epoch <= now):
            self.refused += 1
            return
        try:
            raw = base64.b64decode(payload, validate=True)
        except (ValueError, TypeError):
            self.refused += 1
            return
        recv = iso_z(epoch)
        for block in parse_waves(raw):
            self._add(source, block, float(epoch), recv)
        self._prune(source, now)

    def _add(self, source, block, epoch, recv) -> None:
        held, keys = self.devices[source], self.keys[source]
        key = (block.t_ms, block.wave_id)
        if key in keys:
            return
        if held and block.t_ms < held[-1][0] - WINDOW_S * 1000:
            held.clear()
            keys.clear()
        self.cursor += 1
        samples = None if block.samples is None else array("h", block.samples)
        bisect.insort(held, (block.t_ms, block.wave_id, self.cursor, epoch, recv, block.rate, samples), key=_order)
        keys.add(key)

    def _prune(self, source, now) -> None:
        held, keys = self.devices[source], self.keys[source]
        if not held:
            return
        floor, stale = held[-1][0] - WINDOW_S * 1000, now - WINDOW_S
        cut = 0
        while cut < len(held) and (held[cut][0] < floor or held[cut][3] < stale):
            keys.discard(held[cut][:2])
            cut += 1
        if cut:
            del held[:cut]

    def since(self, sources, cursor):
        """(the hub's cursor now, {source: [block, ...]}): per monitor, the blocks added after
        `cursor` and at most ANSWER_S behind its newest block. A cursor ahead of this hub's (one
        from before a restart) counts as 0. Every source must be one `knows` accepts."""
        now = self.clock()
        with self.lock:
            current = self.cursor
            if cursor > current:
                cursor = 0
            found = {}
            for source in sources:
                self._prune(source, now)
                held = self.devices[source]
                floor = held[-1][0] - ANSWER_S * 1000 if held else 0
                found[source] = [
                    {"seq": seq, "t": t_ms / 1000, "recv": recv, "id": wave, "rate": rate,
                     "samples": None if samples is None else samples.tolist()}
                    for t_ms, wave, seq, _epoch, recv, rate, samples in held
                    if seq > cursor and t_ms >= floor]
        return current, found
