"""Parameter records carried in the Infinity multicast payload.

The payload holds an array of fixed-size records, each naming its own parameter and unit,
so a device is read without a per-device offset table. That matters beyond tidiness: the
offsets move whenever a bed's modules change — the same ward showed a bed with an arterial
line and a bed without it disagreeing on every offset — so a fixed-offset profile reads the
wrong field the moment a catheter goes in, and says nothing about it.

Record layout, zero-based within the record:

    0-1    value, big-endian uint16
    2-3    alarm high limit, signed int16
    4-5    alarm low limit, signed int16
    10-13  device timestamp (relation to wall-clock NOT established)
    16-19  second timestamp
    20-21  parameter id
    22     validity: 0 = the value means something, 1 = it does not
    24     unit code

Identifications were established on 22.09.2026 by comparing the central station's own
display against captures taken in the same minutes; the display labels the numbers, so a
match is an observation rather than an inference. `RESP_AIRWAY` is the exception and is
marked unverified: no observed bed displayed it.

This is research decoding. Nothing here is a clinical observation, a patient mapping, or a
validated measurement, and no value from it may reach the clinical pipeline.
"""
from __future__ import annotations

RECORD_SIZE = 36
MAX_RECORDS = 64            # a payload claiming more is not a parameter array
MAX_PAYLOAD = 65507

MMHG, CELSIUS, BPM, PER_MIN, PERCENT = 0x09, 0x11, 0x1A, 0x1B, 0x1C
UNITS = {MMHG: "mmHg", CELSIUS: "C", BPM: "bpm", PER_MIN: "/min", PERCENT: "%"}

# id -> (name, unit code, scale, verified against the central station's display)
PARAMETERS = {
    0x1905: ("hr", BPM, 1, True),
    0x0101: ("pls", BPM, 1, True),
    0x190E: ("spo2", PERCENT, 1, True),
    0x1F0F: ("etco2", MMHG, 1, True),
    0x1A0B: ("temperature", CELSIUS, 10, True),
    0x0307: ("art_diastolic", MMHG, 1, True),
    0x0308: ("art_systolic", MMHG, 1, True),
    0x0309: ("art_mean", MMHG, 1, True),
    0x1E07: ("nbp_diastolic", MMHG, 1, True),
    0x1E08: ("nbp_systolic", MMHG, 1, True),
    0x1E09: ("nbp_mean", MMHG, 1, True),
    0x0206: ("respiration", PER_MIN, 1, True),
    0x1F06: ("respiration_airway", PER_MIN, 1, False),
}
NAMES = tuple(name for name, _, _, _ in PARAMETERS.values())


def read_record(payload: bytes, offset: int):
    """Decode one record, or None when this position is not one.

    Three independent conditions must agree: the id must be known, the unit code must be
    the one that id always carries, and the alarm limits must not be inverted. Any single
    one of them fires by chance often enough to put nonsense in the output — a temperature
    reported in beats per minute, a pulse in degrees — which is how a reader stops being
    evidence and becomes decoration.
    """
    if offset < 0 or offset + RECORD_SIZE > len(payload):
        return None
    record = payload[offset:offset + RECORD_SIZE]
    identifier = int.from_bytes(record[20:22], "big")
    parameter = PARAMETERS.get(identifier)
    if parameter is None or record[24] != parameter[1]:
        return None
    high = int.from_bytes(record[2:4], "big", signed=True)
    low = int.from_bytes(record[4:6], "big", signed=True)
    if low > high:
        return None
    name, unit, scale, verified = parameter
    return {
        "name": name,
        "offset": offset,
        # The device's placeholder is kept out of `value`: an invalid record carries a
        # number, and reporting it is exactly the mislabelling this module replaces.
        "value": (int.from_bytes(record[:2], "big") / scale) if record[22] == 0 else None,
        "valid": record[22] == 0,
        "unit": UNITS[unit],
        "alarm_low": low / scale,
        "alarm_high": high / scale,
        "evidence": "display_verified" if verified else "unverified_layout",
    }


def find_array(payload: bytes):
    """Return the offsets of the record array, or an empty list.

    The array is located by alignment rather than by an unbroken run, because it also holds
    marker records this reader does not recognise; requiring every slot to decode cuts the
    array short and silently drops the parameters behind the first marker.
    """
    if not 0 < len(payload) <= MAX_PAYLOAD:
        return []
    families: dict[int, list[int]] = {}
    for offset in range(len(payload) - RECORD_SIZE + 1):
        if read_record(payload, offset) is not None:
            families.setdefault(offset % RECORD_SIZE, []).append(offset)
    if not families:
        return []
    best = max(families.values(), key=len)
    first, last = min(best), max(best)
    count = (last - first) // RECORD_SIZE + 1
    if count > MAX_RECORDS:
        return []
    return list(range(first, last + 1, RECORD_SIZE))


def parse_payload(payload: bytes):
    """Every parameter this payload carries, keyed by name.

    A parameter present but flagged invalid is returned with `value` None rather than
    omitted: the monitor shows those as `***`, and "the device says it has no reading" is a
    different statement from "this device does not measure that", which the screen makes and
    so must this reader.
    """
    found = {}
    for offset in find_array(payload):
        record = read_record(payload, offset)
        # A later record for the same parameter wins only if it carries a usable value, so
        # one invalid copy cannot erase a valid reading from the same payload.
        if record is None or (record["name"] in found and not record["valid"]):
            continue
        found[record["name"]] = record
    return found
