"""Capture-scoped research decoder. No clinical observations or patient mapping."""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import re
from pathlib import Path

from .infinity_collector import raw_pcap_events
from .infinity_stream import validate_event

NAMES = ("hr_candidate", "spo2_candidate", "pls_candidate", "resp_candidate")
PROFILE_SCHEMA = "homunculus.infinity.decoder-profile.v2"
PARTIAL_PROFILE_SCHEMA = "homunculus.infinity.decoder-profile.v3"


def validate_profile(value):
    """Only explicitly guarded uint16 BE candidates; no inferred scales or units."""
    try:
        value = json.loads(json.dumps(value, allow_nan=False))  # independent bounded JSON contract
        partial = value.get("schema") == PARTIAL_PROFILE_SCHEMA
        keys = {"schema", "id", "source_ip", "group", "source_port", "port",
                "capture_sha256", "layouts", "ignored_lengths"}
        if partial:
            keys.add("unmapped_fields")
        if set(value) != keys:
            raise ValueError
        if (value["schema"] not in (PROFILE_SCHEMA, PARTIAL_PROFILE_SCHEMA)
                or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", value["id"])
                or not re.fullmatch(r"[a-f0-9]{64}", value["capture_sha256"])
                or ipaddress.IPv4Address(value["source_ip"]).is_multicast
                or not ipaddress.IPv4Address(value["group"]).is_multicast
                or type(value["source_port"]) is not int or not 1 <= value["source_port"] <= 65535
                or type(value["port"]) is not int or value["port"] != 2050
                or not isinstance(value["layouts"], list) or not 1 <= len(value["layouts"]) <= 4
                or not isinstance(value["ignored_lengths"], list) or len(value["ignored_lengths"]) > 16):
            raise ValueError
        lengths, names = set(), set()
        for layout in value["layouts"]:
            if set(layout) != {"length", "fields"} or type(layout["length"]) is not int:
                raise ValueError
            length = layout["length"]
            if not 4 <= length <= 65507 or length in lengths or not 1 <= len(layout["fields"]) <= 4:
                raise ValueError
            lengths.add(length)
            for field in layout["fields"]:
                if set(field) != {"name", "offset", "guard_offset", "guard_hex"}:
                    raise ValueError
                name, offset, start = field["name"], field["offset"], field["guard_offset"]
                guard_hex = field["guard_hex"]
                if (name not in NAMES or name in names or type(offset) is not int or type(start) is not int
                        or not isinstance(guard_hex, str) or not re.fullmatch(r"(?:[a-f0-9]{2}){4,32}", guard_hex)
                        or not 0 <= start < offset <= length - 2
                        or start + len(bytes.fromhex(guard_hex)) != offset):
                    raise ValueError
                names.add(name)
        if partial:
            unmapped = value["unmapped_fields"]
            if (not isinstance(unmapped, list) or not all(isinstance(name, str) for name in unmapped)
                    or len(unmapped) != len(set(unmapped)) or names & set(unmapped)
                    or names | set(unmapped) != set(NAMES)):
                raise ValueError
        elif names != set(NAMES):
            raise ValueError
        for length in value["ignored_lengths"]:
            if type(length) is not int or not 1 <= length <= 65507 or length in lengths:
                raise ValueError
            lengths.add(length)
        return value
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ValueError("Invalid multi-layout research profile.") from None


def read_profile(path: Path):
    if path.stat().st_size > 65536:
        raise ValueError("Research profile too large.")
    return validate_profile(json.loads(path.read_text(encoding="utf-8-sig")))


class ResearchDecoder:
    def __init__(self, profile, inventory, *, allow_unverified_live=False):
        self.profile = validate_profile(profile)
        self.inventory = inventory
        self.allow_unverified_live = allow_unverified_live is True
        if not inventory.lookup(profile["source_ip"], profile["group"], profile["port"]):
            raise ValueError("Profile is not in explicit inventory.")

    def decode(self, event):
        """Return research candidates only; live hypotheses require explicit opt-in."""
        try:
            validate_event(event, self.inventory)
            if (event["mode"] != "replay" and not self.allow_unverified_live) or any(event[k] != self.profile[k]
                    for k in ("source_ip", "group", "source_port", "port")):
                return "rejected", {}
            if event["payload_base64"] is None:
                return "rejected", {}
            raw = base64.b64decode(event["payload_base64"], validate=True)
            if len(raw) in self.profile["ignored_lengths"]:
                return "ignored", {}
            layout = next((x for x in self.profile["layouts"] if x["length"] == len(raw)), None)
            if layout is None:
                return "rejected", {}
            result = {}
            for field in layout["fields"]:
                offset = field["offset"]
                if raw[field["guard_offset"]:offset] != bytes.fromhex(field["guard_hex"]):
                    return "rejected", {}
                result[field["name"]] = int.from_bytes(raw[offset:offset + 2], "big")
            return "decoded", result
        except (ValueError, TypeError, KeyError):
            return "rejected", {}


def load_recording(path: Path, decoder):
    """Hash-scoped, bounded, fully checked before any value becomes visible."""
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Research replay exceeds 32 MiB.")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != decoder.profile["capture_sha256"]:
        raise ValueError("Recording is outside this profile's evidence scope.")
    rows, counts = [], {"decoded": 0, "ignored": 0, "rejected": 0}
    previous = None
    for event in raw_pcap_events(path, decoder.inventory, retain_payload=True):
        disposition, values = decoder.decode(event)
        counts[disposition] += 1
        if disposition == "rejected":
            raise ValueError("Recording contains unsupported source, layout or guard.")
        epoch = event["received_at"]
        if previous is not None and epoch < previous:
            raise ValueError("Recording timestamps are out of order.")
        previous = epoch
        # Retain no raw payload in the replay application.
        rows.append({"id": event["id"], "epoch": epoch, "values": values})
        if len(rows) > 20000 or epoch - rows[0]["epoch"] > 300:
            raise ValueError("Research replay exceeds packet/time limit.")
    if not counts["decoded"] or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise ValueError("Recording empty or changed during validation.")
    return rows, counts
