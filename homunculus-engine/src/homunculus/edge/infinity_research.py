"""Offline byte-layout research, never a clinical decoder or live receiver.

Profiles are hypotheses scoped to explicit capture hashes. Raw candidate integers have
no established validity, unit, device time or patient identity. No Observation is made.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import math
import re
import subprocess
import threading
from collections import Counter
from pathlib import Path

from .infinity_discovery import DiscoveryError, device_addresses, find_tool

MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_ROWS = 20_000
MAX_LINE = 140_000
FIELDS = (
    "frame.number", "frame.time_epoch", "frame.cap_len", "frame.len", "ip.src",
    "ip.dst", "ip.proto", "ip.frag_offset", "ip.flags.mf", "udp.srcport",
    "udp.dstport", "udp.length", "udp.payload",
)


class ResearchError(Exception):
    """Fixed diagnostic; never include raw input, packet bytes or tool stderr."""


def validate_profile(profile: dict) -> dict:
    def check(condition):
        if not condition:
            raise ValueError

    try:
        check(type(profile["version"]) is int and profile["version"] == 1)
        size = profile["payload_length"]
        check(type(size) is int and 1 <= size <= 65507)
        hashes = profile["allowed_capture_sha256"]
        check(isinstance(hashes, list) and 1 <= len(hashes) <= 32)
        check(all(isinstance(h, str) and re.fullmatch(r"[0-9a-f]{64}", h) for h in hashes))
        fields = profile["fields"]
        check(isinstance(fields, list) and 1 <= len(fields) <= 16)
        names = set()
        for field in fields:
            name, offset, width = field["name"], field["offset"], field["width"]
            check(isinstance(name, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,47}", name))
            check(name not in names)
            names.add(name)
            check(type(offset) is int and type(width) is int)
            check(width in (1, 2, 4) and 0 <= offset <= size - width)
            check(field["byteorder"] in ("big", "little"))
        guards = profile["guards"]
        check(isinstance(guards, list) and 1 <= len(guards) <= 16)
        for guard in guards:
            offset, value = guard["offset"], guard["hex"]
            check(type(offset) is int and isinstance(value, str))
            check(re.fullmatch(r"(?:[0-9a-fA-F]{2}){1,16}", value))
            check(0 <= offset <= size - len(value) // 2)
    except (KeyError, TypeError, ValueError):
        raise ResearchError("Invalid bounded research profile.") from None
    # Return only the schema's allowlisted fields, not arbitrary input metadata.
    return {"version": 1, "payload_length": size, "allowed_capture_sha256": list(hashes),
            "fields": [{k: f[k] for k in ("name", "offset", "width", "byteorder")} for f in fields],
            "guards": [{"offset": g["offset"], "hex": g["hex"].lower()} for g in guards]}


def file_hash(path: Path) -> str:
    if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
        raise ResearchError("Input missing or larger than 256 MiB.")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_rows(path: Path, devices: tuple[str, ...], *, tshark: str | None = None,
              timeout: float = 60):
    """Stream bounded lines; a watchdog kills the child if reading stalls on Windows."""
    if not 0 < timeout <= 300:
        raise ResearchError("Invalid offline timeout.")
    devices = device_addresses(list(devices))
    try:
        executable = find_tool("tshark", tshark)
    except DiscoveryError:
        raise ResearchError("Wireshark tshark is unavailable.") from None
    command = [executable, "-n", "-r", str(path.resolve()), "--only-protocols",
               "raw,eth,ethertype,vlan,ip,udp,tcp,igmp,sll", "-o", "ip.defragment:FALSE",
               "-o", "tcp.desegment_tcp_streams:FALSE", "-Y",
               " or ".join(f"ip.src == {ip}" for ip in devices),
               "-T", "fields", "-E", "occurrence=f"]
    for field in FIELDS:
        command.extend(["-e", field])
    process = None
    timer = None
    timed_out = threading.Event()

    def expire():
        timed_out.set()
        if process is not None:
            try:
                process.kill()
            except OSError:
                pass

    try:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        timer = threading.Timer(timeout, expire)
        timer.daemon = True
        timer.start()
        count = 0
        while line := process.stdout.readline(MAX_LINE + 1):
            count += 1
            if len(line) > MAX_LINE or count > MAX_ROWS:
                raise ResearchError("Offline input exceeds bounded row limits.")
            yield line.decode("ascii", errors="strict").rstrip("\r\n")
        process.wait(timeout=5)
        if timed_out.is_set():
            raise ResearchError("Offline reader timed out.")
        if process.returncode:
            raise ResearchError("Offline reader failed; no complete report produced.")
    except (OSError, UnicodeError, subprocess.TimeoutExpired):
        raise ResearchError("Offline reader failed; no complete report produced.") from None
    finally:
        if timer:
            timer.cancel()
            timer.join()
        if process:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            process.stdout.close()


def _ranges(indices: list[int]) -> list[list[int]]:
    result = []
    for index in indices:
        if result and result[-1][1] + 1 == index:
            result[-1][1] = index
        else:
            result.append([index, index])
    return result


def analyze_rows(rows, devices: tuple[str, ...], profile: dict, *, include_series=False):
    profile = validate_profile(profile)
    allowed = set(device_addresses(list(devices)))
    counters = Counter()
    shapes = {}
    streams = {}
    series = []
    shape_budget = 0
    for line in rows:
        counters["input_rows"] += 1
        if counters["input_rows"] > MAX_ROWS:
            raise ResearchError("Offline input exceeds bounded row limits.")
        try:
            parts = line.split("\t")
            if len(parts) != len(FIELDS) or len(line) > MAX_LINE:
                raise ValueError
            number, stamp, cap, wire, src, dst, proto, frag, more, sport, dport, length, payload = parts
            number, stamp, cap, wire = int(number), float(stamp), int(cap), int(wire)
            src, dst = str(ipaddress.IPv4Address(src)), str(ipaddress.IPv4Address(dst))
            if number < 1 or not math.isfinite(stamp) or stamp < 0 or not 0 < cap <= wire <= 262144:
                raise ValueError
            if src not in allowed:
                counters["excluded_source"] += 1
                continue
            if more.lower() not in ("true", "false", "1", "0") or int(frag) < 0:
                raise ValueError
            if int(frag) or more.lower() in ("true", "1"):
                counters["fragmented"] += 1
                continue
            if cap < wire:
                counters["truncated"] += 1
                continue
            if proto != "17":
                counters["not_selected_udp"] += 1
                continue
            sport, dport, length = int(sport), int(dport), int(length)
            if not 0 <= sport <= 65535 or not 0 <= dport <= 65535 or not 8 <= length <= 65535:
                raise ValueError
            if dport != 2050:
                counters["not_selected_udp"] += 1
                continue
            data = bytes.fromhex(payload.replace(":", ""))
            if len(data) != length - 8:
                raise ValueError
        except (ValueError, TypeError, OverflowError):
            counters["malformed"] += 1
            continue
        key = (src, dst, sport, dport)
        if key not in streams:
            if len(streams) >= 64:
                raise ResearchError("Too many streams for bounded analysis.")
            streams[key] = {"packets": 0, "first": stamp, "last": stamp, "previous": None,
                            "backwards_capture_timestamps": 0, "duplicate_payloads": 0,
                            "seen": set(), "candidates": {}}
        stream = streams[key]
        stream["packets"] += 1
        stream["first"] = min(stamp, stream["first"])
        stream["last"] = max(stamp, stream["last"])
        if stream["previous"] is not None and stamp < stream["previous"]:
            stream["backwards_capture_timestamps"] += 1
        stream["previous"] = stamp
        digest = hashlib.sha256(data).digest()
        stream["duplicate_payloads"] += digest in stream["seen"]
        stream["seen"].add(digest)
        skey = (*key, len(data))
        if skey not in shapes:
            shape_budget += len(data)
            if len(shapes) >= 128 or shape_budget > 2 * 1024 * 1024:
                raise ResearchError("Too many payload shapes for bounded analysis.")
            shapes[skey] = {"first": data, "varying": bytearray(len(data)), "packets": 0}
        shape = shapes[skey]
        shape["packets"] += 1
        for i, byte in enumerate(data):
            shape["varying"][i] |= byte != shape["first"][i]
        if len(data) != profile["payload_length"]:
            counters["profile_length_mismatch"] += 1
            continue
        if any(data[g["offset"]:g["offset"] + len(g["hex"]) // 2] != bytes.fromhex(g["hex"])
               for g in profile["guards"]):
            counters["profile_guard_mismatch"] += 1
            continue
        counters["candidate_packets"] += 1
        values = {}
        for field in profile["fields"]:
            offset, width = field["offset"], field["width"]
            value = int.from_bytes(data[offset:offset + width], field["byteorder"])
            values[field["name"]] = value
            stream["candidates"].setdefault(field["name"], Counter())[value] += 1
        if include_series:
            series.append({"frame_number": number, "capture_epoch": stamp, "source_ip": src,
                           "destination_ip": dst, "source_port": sport, "destination_port": dport,
                           "raw_candidates": values, "clinical_validity": "unknown"})
    result_streams = []
    for key, stream in sorted(streams.items()):
        summary = dict(zip(("source_ip", "destination_ip", "source_port", "destination_port"), key))
        summary.update({k: stream[k] for k in ("packets", "backwards_capture_timestamps", "duplicate_payloads")})
        summary["capture_span_seconds"] = stream["last"] - stream["first"]
        summary["candidate_statistics"] = {name: {"count": sum(values.values()), "distinct": len(values),
                                                   "min": min(values), "max": max(values)}
                                           for name, values in sorted(stream["candidates"].items())}
        result_streams.append(summary)
    shape_summaries = []
    for key, shape in sorted(shapes.items()):
        shape_summaries.append({"stream": list(key[:4]), "payload_bytes": key[4],
                                "packets": shape["packets"],
                                "varying_byte_ranges": _ranges([i for i, v in enumerate(shape["varying"]) if v])})
    report = {"status": "offline_research_unverified", "clinical_ingest_enabled": False,
              "clinical_mapping_verified": False, "profile": profile, "counters": dict(counters),
              "streams": result_streams, "payload_shapes": shape_summaries,
              "limitations": ["Candidate integers are not validated measurements; small status codes are retained.",
                              "Capture timestamps are not device measurement times.",
                              "Duplicate payloads are not necessarily duplicate measurements.",
                              "Patient identity, units, scale, invalidity and stale data are not decoded.",
                              "No waveform decoding or clinical model integration is performed."]}
    if include_series:
        report["candidate_series"] = series
    return report


def analyze_capture(path: Path, devices: tuple[str, ...], profile: dict, *,
                    include_series=False, tshark=None, timeout=60):
    profile = validate_profile(profile)
    digest = file_hash(path)
    if digest not in profile["allowed_capture_sha256"]:
        raise ResearchError("Capture hash is not allowed by this research profile.")
    rows = read_rows(path, devices, tshark=tshark, timeout=timeout)
    try:
        report = analyze_rows(rows, devices, profile, include_series=include_series)
    finally:
        rows.close()
    if file_hash(path) != digest:
        raise ResearchError("Capture changed during analysis; report discarded.")
    report["capture_sha256"] = digest
    return report


def write_report(path: Path, report: dict):
    """No overwrite and no repository output, including through symlinks/junctions."""
    path = path.resolve()
    if path.suffix.lower() != ".json" or any((p / ".git").exists() for p in path.parents):
        raise ResearchError("Reports must be JSON files outside any repository.")
    if not path.parent.is_dir():
        raise ResearchError("Output directory must already exist.")
    with path.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write("\n")
