"""Synthetic Infinity waveform payloads for tests (Lane C, dalga).

No capture bytes and no patient values: every sample is a made-up integer pattern, every device
time a round number. The layout is docs/INFINITY-DALGA-FORMU.md's: a 64-byte header (byte 29 the
message type), then blocks `u16 rate | u16 len | u16 ms | u32 device_s | u16 wave_id | u8 n | u8 0 |
n x i16`, big-endian, len = 14 + 2n, n = rate / 5.
"""
import struct

HEADER = 64
ECG, ECG_OTHER, PRESSURE_ART, PRESSURE_P1, PLETH, RESP = 0x0103, 0x0102, 0x0301, 0x0E01, 0x1916, 0x0201


def samples_for(rate, start=0):
    """A made-up pattern of rate/5 samples, well inside every row's range."""
    return [((start + i) * 37) % 401 - 200 for i in range(rate // 5)]


def block(wave_id, rate, samples=None, *, ms=40, device_s=1000, size=None, n=None):
    """One block. `size` and `n` override the declared length and count (to build broken ones)."""
    values = samples_for(rate) if samples is None else list(samples)
    count = len(values) if n is None else n
    length = 14 + 2 * len(values) if size is None else size
    return (struct.pack(">HHHIHBB", rate, length, ms, device_s, wave_id, count, 0)
            + struct.pack(f">{len(values)}h", *values))


def no_signal(wave_id, rate, **kwargs):
    """The monitor's "no signal" block: every sample 0x0001."""
    return block(wave_id, rate, [1] * (rate // 5), **kwargs)


def packet(*blocks, kind=0x03, tail=b""):
    """A payload: the header, the blocks, then `tail` (a record section, garbage)."""
    header = bytearray(HEADER)
    header[29] = kind
    return bytes(header) + b"".join(blocks) + tail


def tick(device_s, ms, *, ecg=True, pressure=True, pleth=True, resp=True):
    """One 200 ms packet of a bed sending ECG (0x0103), ART at a flat 100 mmHg, pleth and resp."""
    parts = []
    if ecg:
        parts.append(block(ECG, 200, ms=ms, device_s=device_s))
    if pressure:
        parts.append(block(PRESSURE_ART, 100, [4000] * 20, ms=ms, device_s=device_s))
    if pleth:
        parts.append(block(PLETH, 100, ms=ms, device_s=device_s))
    if resp:
        parts.append(block(RESP, 50, ms=ms, device_s=device_s))
    return packet(*parts)


def at(k, start=1000):
    """(device_s, ms) of the k-th 200 ms packet after `start` s: ms runs 40, 240, 440, 640, 840."""
    device_s, ms = divmod(start * 1000 + k * 200 + 40, 1000)
    return device_s, ms
