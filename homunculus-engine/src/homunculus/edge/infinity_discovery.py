"""Passive IPv4 transport discovery, NOT an Infinity protocol decoder.

dumpcap writes to a pipe (never a capture file); tshark reads the pipe and emits only
allowlisted network-header fields. No multicast joins, probes or application commands.
Offline pcap/pcapng inspection uses the same field list. Packet cadence is not measurement
cadence, and receipt of multicast is not evidence that its payload is decodable.
"""
from __future__ import annotations

import ipaddress
import math
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


FIELDS = (
    "frame.time_epoch", "frame.len", "ip.src", "ip.dst", "ip.proto",
    "udp.srcport", "udp.dstport", "tcp.srcport", "tcp.dstport",
    "ip.frag_offset", "ip.flags.mf", "frame.cap_len",
)
MAX_PACKETS = 100_000
MAX_FLOWS = 1024


class DiscoveryError(Exception):
    """A fixed diagnostic, never a packet body or subprocess output."""


def device_addresses(values: list[str]) -> tuple[str, ...]:
    """Explicit source allowlist; no subnet-wide capture default."""
    addresses = set()
    for value in values:
        ip = ipaddress.IPv4Address(value)
        if ip.is_multicast or ip.is_unspecified or ip.is_loopback or int(ip) == 0xFFFFFFFF:
            raise ValueError("device address must be an IPv4 unicast address")
        addresses.add(str(ip))
    if not 1 <= len(addresses) <= 13:
        raise ValueError("supply between 1 and 13 device addresses")
    return tuple(sorted(addresses))


def find_tool(name: str, explicit: str | None = None) -> str:
    candidate = explicit or shutil.which(name)
    if candidate is None:
        installed = Path("C:/Program Files/Wireshark") / f"{name}.exe"
        if installed.is_file():
            candidate = str(installed)
    if candidate is None:
        raise DiscoveryError(f"{name} is unavailable; install Wireshark capture tools on the capture host")
    return candidate


def tshark_command(executable: str, source: str, devices: tuple[str, ...], limit: int) -> list[str]:
    # Restrict dissection to headers; never request data, _ws.col.info or app fields.
    command = [
        executable, "-n", "-r", source, "-c", str(limit),
        "--only-protocols", "raw,eth,ethertype,vlan,ip,udp,tcp,igmp,sll",
        "-o", "ip.defragment:FALSE", "-o", "tcp.desegment_tcp_streams:FALSE",
        "-Y", " or ".join(f"ip.src == {ip}" for ip in devices),
        "-T", "fields", "-E", "occurrence=f",
    ]
    for field in FIELDS:
        command.extend(["-e", field])
    return command


def dumpcap_command(executable: str, interface: str, devices: tuple[str, ...],
                    duration: int, limit: int) -> list[str]:
    # Include tagged Ethernet on a mirror port. VLAN stripping can also expose plain IP.
    hosts = " or ".join(f"src host {ip}" for ip in devices)
    base = f"ip and ({hosts})"
    capture_filter = f"({base}) or (vlan and ({base}))"
    return [executable, "-q", "-i", interface, "-f", capture_filter,
            "-s", "128", "-a", f"duration:{duration}", "-c", str(limit), "-P", "-w", "-"]


def _stop(process: subprocess.Popen | None) -> None:
    if process is not None and process.poll() is None:
        process.kill()
        process.wait(timeout=5)


def collect_headers(*, devices: tuple[str, ...], interface: str | None = None,
                    capture_file: str | None = None, duration: int = 30,
                    limit: int = 20_000, tshark: str | None = None,
                    dumpcap: str | None = None) -> str:
    """Bounded capture; stderr is suppressed because it is not an allowlisted channel.

    Both subprocesses are reaped on error/timeout/interrupt. Live bytes travel through
    stdout pipes only, avoiding tshark's live-capture temporary files.
    """
    devices = device_addresses(list(devices))
    if (interface is None) == (capture_file is None):
        raise ValueError("select exactly one interface or capture file")
    if not 1 <= duration <= 300 or not 1 <= limit <= MAX_PACKETS:
        raise ValueError("duration must be 1..300 seconds and packet limit 1..100000")
    if interface is not None and (not interface or "://" in interface or interface == "-"):
        raise ValueError("select a local capture interface")
    if capture_file is not None:
        if not Path(capture_file).is_file():
            raise DiscoveryError("capture input is not a readable file")
        capture_file = str(Path(capture_file).resolve())
    producer = consumer = None
    try:
        reader = find_tool("tshark", tshark)
        if interface is not None:
            producer = subprocess.Popen(
                dumpcap_command(find_tool("dumpcap", dumpcap), interface, devices, duration, limit),
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
        consumer = subprocess.Popen(
            tshark_command(reader, capture_file or "-", devices, limit),
            stdin=producer.stdout if producer else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        if producer:
            producer.stdout.close()
        output, _ = consumer.communicate(timeout=duration + 15)
        if producer:
            producer.wait(timeout=5)
        if consumer.returncode != 0 or (producer and producer.returncode != 0):
            raise DiscoveryError("capture tool failed; check local interface, permissions and Wireshark version")
        return output.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        raise DiscoveryError("capture timed out; no successful network conclusion") from None
    except OSError:
        raise DiscoveryError("capture tool could not start or read input") from None
    finally:
        _stop(consumer)
        _stop(producer)
        for process in (consumer, producer):
            if process and process.stdout:
                process.stdout.close()


@dataclass
class Flow:
    packets: int = 0
    wire_bytes: int = 0
    first: float = math.inf
    last: float = -math.inf
    previous: float | None = None
    gaps: int = 0
    gap_sum: float = 0
    max_gap: float = 0
    backwards_timestamps: int = 0
    truncated_packets: int = 0

    def add(self, stamp: float, size: int, captured: int) -> None:
        self.packets += 1
        self.wire_bytes += size
        self.first = min(self.first, stamp)
        self.last = max(self.last, stamp)
        self.truncated_packets += int(captured < size)
        if self.previous is not None:
            gap = stamp - self.previous
            if gap < 0:
                self.backwards_timestamps += 1
            else:
                self.gaps += 1
                self.gap_sum += gap
                self.max_gap = max(self.max_gap, gap)
        self.previous = stamp


def summarize(headers: str, devices: tuple[str, ...], *, mode: str, limit: int) -> dict:
    """Untrusted input is validated; rejected lines are counted, never echoed."""
    if mode not in ("live", "offline") or not 1 <= limit <= MAX_PACKETS:
        raise ValueError("invalid report mode or packet limit")
    allowed = set(device_addresses(list(devices)))
    flows: dict[tuple, Flow] = {}
    malformed = excluded = fragmented = overflow = rows = 0
    for line in headers.splitlines():
        if rows >= limit:
            overflow += 1
            continue
        rows += 1
        try:
            fields = line.split("\t")
            if len(fields) != len(FIELDS):
                raise ValueError
            stamp, size, src, dst, proto, us, ud, ts, td, offset, mf, caplen = fields
            stamp = float(stamp)
            size, captured = int(size), int(caplen)
            src, dst = str(ipaddress.IPv4Address(src)), str(ipaddress.IPv4Address(dst))
            proto = int(proto)
            if not math.isfinite(stamp) or stamp < 0 or not 0 < captured <= size <= 262144:
                raise ValueError
            if not 0 <= proto <= 255:
                raise ValueError
            if src not in allowed:
                excluded += 1
                continue
            fragment = int(offset, 0) if offset else 0
            # Wireshark 4.6 prints Boolean fields as True/False; older versions use 1/0.
            if mf.lower() in ("true", "false"):
                more = int(mf.lower() == "true")
            else:
                more = int(mf, 0) if mf else 0
            if fragment < 0 or more not in (0, 1):
                raise ValueError
            if fragment or more:
                fragmented += 1
                continue  # no guessed ports or cadence from partial datagrams
            sport = dport = None
            if proto in (6, 17):
                sport, dport = (int(ts), int(td)) if proto == 6 else (int(us), int(ud))
                if not (0 <= sport <= 65535 and 0 <= dport <= 65535):
                    raise ValueError
            key = src, dst, proto, sport, dport
            if key not in flows and len(flows) >= MAX_FLOWS:
                overflow += 1
                continue
            flows.setdefault(key, Flow()).add(stamp, size, captured)
        except (ValueError, OverflowError):
            malformed += 1
    result = []
    multicast_seen = False
    for (src, dst, proto, sport, dport), flow in sorted(flows.items()):
        multicast = ipaddress.IPv4Address(dst).is_multicast
        multicast_seen |= multicast and proto == 17
        span = flow.last - flow.first
        result.append({
            "source_ip": src, "destination_ip": dst,
            "ip_protocol": proto, "transport": {6: "tcp", 17: "udp", 2: "igmp"}.get(proto, "other"),
            "source_port": sport, "destination_port": dport, "multicast": multicast,
            "packets": flow.packets, "wire_bytes": flow.wire_bytes,
            "observed_span_seconds": round(span, 6),
            "mean_packet_gap_seconds": round(flow.gap_sum / flow.gaps, 6) if flow.gaps else None,
            "max_packet_gap_seconds": round(flow.max_gap, 6) if flow.gaps else None,
            "backwards_capture_timestamps": flow.backwards_timestamps,
            "truncated_packets": flow.truncated_packets,
        })
    return {
        "schema_version": 1, "mode": mode,
        "status": "protocol_unverified" if multicast_seen else "network_unverified",
        "multicast_udp_observed": multicast_seen,
        "live_multicast_receipt_observed": mode == "live" and multicast_seen,
        "infinity_protocol_verified": False, "clinical_ingest_enabled": False,
        "measurement_cadence_verified": False,
        "input_packet_limit": limit, "selected_row_limit_reached": rows >= limit,
        "malformed_rows": malformed, "excluded_rows": excluded,
        "fragmented_packets_excluded": fragmented, "overflow_rows": overflow,
        "devices_without_observed_flows": sorted(allowed - {key[0] for key in flows}),
        "flows": result,
        "next_step": (
            "Validate Kappa VF9.1-C payload format with vendor specification and non-patient test data."
            if multicast_seen else
            "Check source activity, capture interface and switch/vSwitch mirror delivery; absence does not prove incompatibility."
        ),
        "limitations": [
            "Packet arrival intervals are not measurement update intervals.",
            "Multicast receipt does not establish Infinity compatibility or payload meaning.",
            "Offline captures do not establish current network reachability.",
            "Packet loss, duplicate measurements and patient identity are not evaluated.",
        ],
    }
