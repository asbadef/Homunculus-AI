"""Bounded Infinity transport contracts. No native measurement decoder is implied."""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import math
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

SCHEMA = "homunculus.infinity.transport.v1"
MAX_BATCH = 32
MAX_REQUEST = 3_000_000
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}\Z")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


@dataclass(frozen=True)
class Device:
    id: str
    source: str
    group: str
    port: int = 2050


@dataclass(frozen=True)
class Inventory:
    collector_id: str
    interface: str
    devices: tuple[Device, ...]

    @classmethod
    def parse(cls, value):
        try:
            if set(value) != {"collector_id", "interface", "devices"}:
                raise ValueError
            cid = value["collector_id"]
            if not isinstance(cid, str) or not IDENTIFIER.fullmatch(cid):
                raise ValueError
            interface = ipaddress.IPv4Interface(value["interface"])
            if interface.network.prefixlen > 30:
                raise ValueError
            def unicast(ip):
                return (not (ip.is_multicast or ip.is_loopback or ip.is_unspecified or ip.is_reserved)
                        and ip not in (interface.network.network_address, interface.network.broadcast_address))
            if not unicast(interface.ip) or not 1 <= len(value["devices"]) <= 100:
                raise ValueError
            devices = []
            for row in value["devices"]:
                if set(row) != {"id", "source", "group", "port"}:
                    raise ValueError
                source, group = ipaddress.IPv4Address(row["source"]), ipaddress.IPv4Address(row["group"])
                if (not isinstance(row["id"], str) or not IDENTIFIER.fullmatch(row["id"])
                        or not unicast(source) or source not in interface.network or source == interface.ip
                        or not group.is_multicast or group in ipaddress.IPv4Network("224.0.0.0/24")
                        or type(row["port"]) is not int or row["port"] != 2050):
                    raise ValueError
                devices.append(Device(row["id"], str(source), str(group), row["port"]))
            if len({d.id for d in devices}) != len(devices) or len({d.source for d in devices}) != len(devices):
                raise ValueError
            return cls(cid, str(interface), tuple(devices))
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ValueError("Invalid explicit device inventory (1..100 devices, PDS port 2050).") from None

    @classmethod
    def read(cls, path: Path):
        if path.stat().st_size > 65536:
            raise ValueError("Inventory too large.")
        return cls.parse(json.loads(path.read_text(encoding="utf-8-sig")))

    def lookup(self, source, group, port):
        return next((d for d in self.devices if (d.source, d.group, d.port) == (source, group, port)), None)


def packet_event(inventory, device, payload, source_port, *, received_at=None, retain_payload=False, mode="live"):
    event = {"schema": SCHEMA, "id": str(uuid.uuid4()), "collector_id": inventory.collector_id,
             "device_id": device.id, "source_ip": device.source, "group": device.group,
             "source_port": source_port, "port": device.port, "received_at": time.time() if received_at is None else received_at,
             "mode": mode, "payload_bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
             "payload_base64": base64.b64encode(payload).decode() if retain_payload else None}
    validate_event(event, inventory)
    return event


def validate_event(event, inventory):
    """Reject arbitrary metadata/clinical fields; failures never echo packet content."""
    try:
        if set(event) != {"schema", "id", "collector_id", "device_id", "source_ip", "group", "source_port",
                          "port", "received_at", "mode", "payload_bytes", "sha256", "payload_base64"}:
            raise ValueError
        device = inventory.lookup(event["source_ip"], event["group"], event["port"])
        if (event["schema"] != SCHEMA or event["collector_id"] != inventory.collector_id
                or not device or device.id != event["device_id"] or event["mode"] not in ("live", "replay")
                or str(uuid.UUID(event["id"])) != event["id"]
                or type(event["received_at"]) not in (float, int) or not math.isfinite(event["received_at"])
                or event["received_at"] <= 0 or type(event["source_port"]) is not int
                or not 1 <= event["source_port"] <= 65535 or type(event["port"]) is not int
                or type(event["payload_bytes"]) is not int or not 1 <= event["payload_bytes"] <= 65507
                or not isinstance(event["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", event["sha256"])):
            raise ValueError
        raw = event["payload_base64"]
        if raw is not None:
            if not isinstance(raw, str) or len(raw) > 87344:
                raise ValueError
            decoded = base64.b64decode(raw, validate=True)
            if len(decoded) != event["payload_bytes"] or hashlib.sha256(decoded).hexdigest() != event["sha256"]:
                raise ValueError
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ValueError("Invalid transport event.") from None
    return event
