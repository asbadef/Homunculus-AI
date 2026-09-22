"""Bounded passive Linux capture beside the running worker; no second UDP listener."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import time
import uuid


ETH_P_ALL = 0x0003


def open_capture_socket(interface, *, socket_factory=None):
    """Bind explicitly to ETH_P_ALL; binding protocol zero disables capture on Linux 6.8.

    Python converts the AF_PACKET address tuple's protocol from host byte order.
    Start with protocol zero so the socket cannot observe other NICs before bind.
    """
    factory = socket.socket if socket_factory is None else socket_factory
    sock = factory(socket.AF_PACKET, socket.SOCK_RAW, 0)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024*1024)
        sock.bind((interface, ETH_P_ALL))
        bound = sock.getsockname()
        if bound[0] != interface or bound[1] != ETH_P_ALL:
            raise RuntimeError("Capture socket is not bound to the selected interface and ETH_P_ALL.")
        sock.settimeout(.2)
        return sock
    except Exception:
        sock.close()
        raise


def select_ipv4(frame, source, group, source_port=2564, port=2050):
    """Filter Ethernet (including up to two VLAN tags); return complete RAW IPv4 only."""
    if len(frame) < 14:
        return None
    protocol, offset = int.from_bytes(frame[12:14], "big"), 14
    for _ in range(2):
        if protocol not in (0x8100, 0x88a8):
            break
        if len(frame) < offset + 4:
            return None
        protocol = int.from_bytes(frame[offset+2:offset+4], "big")
        offset += 4
    if protocol != 0x0800 or len(frame) < offset + 20:
        return None
    raw = frame[offset:]
    ihl, total = (raw[0] & 15)*4, int.from_bytes(raw[2:4], "big")
    if (raw[0] >> 4 != 4 or ihl < 20 or total < ihl+8 or total > len(raw)
            or raw[9] != 17 or int.from_bytes(raw[6:8], "big") & 0x3fff
            or raw[12:16] != socket.inet_aton(source) or raw[16:20] != socket.inet_aton(group)):
        return None
    sport, dport, size, _ = struct.unpack("!HHHH", raw[ihl:ihl+8])
    if (sport, dport) != (source_port, port) or size != total-ihl or size <= 8:
        return None
    return raw[:total]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", default="ens3")
    parser.add_argument("--local-ip", default="10.10.203.101")
    parser.add_argument("--source", default="10.10.203.28")
    parser.add_argument("--group", default="224.0.2.28")
    parser.add_argument("--duration", type=int, default=60)
    args = parser.parse_args()
    if sys.platform != "linux" or os.geteuid() != 0 or not 1 <= args.duration <= 60:
        parser.error("Use sudo on the Linux worker; duration must be 1..60 seconds.")
    import pwd
    owner = pwd.getpwnam(os.environ.get("SUDO_USER", "root"))
    if owner.pw_uid == 0:
        parser.error("Run through sudo from the sysadmin account so captures have a private owner.")
    source, group = ipaddress.IPv4Address(args.source), ipaddress.IPv4Address(args.group)
    if source.is_multicast or not group.is_multicast:
        parser.error("Select one source and one multicast group.")
    address_info = json.loads(subprocess.check_output(
        ["ip", "-j", "-4", "address", "show", "dev", args.interface], text=True))
    if not any(x.get("local") == args.local_ip for adapter in address_info for x in adapter.get("addr_info", [])):
        parser.error("Selected local IP is not on this interface.")
    # Unique folder, no caller-supplied output path, no existing files overwritten.
    folder = Path(owner.pw_dir) / ("infinity-validation-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8])
    folder.mkdir(mode=0o700)
    pcap = folder / "infinity-ipv4.pcap"
    report_path = folder / "summary.json"
    os.umask(0o077)
    selected, total_bytes, lengths, drops = 0, 24, Counter(), None
    received_frames = outgoing_frames = filtered_frames = 0
    status = "completed"
    sock = None
    try:
        sock = open_capture_socket(args.interface)
        started_wall, started = time.time(), time.monotonic()
        print("READY: recording for %s seconds; source %s; note screen values now." % (args.duration, args.source), flush=True)
        print("Start UTC: " + datetime.fromtimestamp(started_wall, timezone.utc).isoformat(), flush=True)
        next_progress = 10
        with pcap.open("xb") as target:
            target.write(struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 101))
            while time.monotonic() - started < args.duration:
                elapsed = time.monotonic() - started
                if elapsed >= next_progress:
                    print("%ss: frames=%s, selected=%s, filtered=%s, outgoing=%s" %
                          (int(elapsed), received_frames, selected, filtered_frames, outgoing_frames), flush=True)
                    next_progress += 10
                try:
                    frame, address = sock.recvfrom(65599)
                except socket.timeout:
                    continue
                received_frames += 1
                if address[2] == 4:  # PACKET_OUTGOING, never record host-generated traffic
                    outgoing_frames += 1
                    continue
                raw = select_ipv4(frame, args.source, args.group)
                if raw is None:
                    filtered_frames += 1
                    continue
                if selected >= 5000 or total_bytes + len(raw) + 16 > 8*1024*1024:
                    status = "capacity_limit"
                    break
                stamp = time.time_ns()
                sec, micro = stamp // 1_000_000_000, (stamp % 1_000_000_000)//1000
                target.write(struct.pack("<IIII", sec, micro, len(raw), len(raw)) + raw)
                selected += 1
                total_bytes += len(raw) + 16
                lengths[len(raw) - (raw[0] & 15)*4 - 8] += 1
            target.flush()
            os.fsync(target.fileno())
        try:
            # AF_PACKET socket drops include nonselected traffic; not device sequence loss.
            drops = struct.unpack("II", sock.getsockopt(263, 6, 8))[1]
        except OSError:
            pass
        if selected == 0 and status == "completed":
            status = "no_matching_packets"
        summary = {"status": status, "capture_tool_version": 2,
            "source_ip": args.source, "group": args.group, "port": 2050,
            "source_port": 2564, "interface": args.interface, "started_at": started_wall,
            "ended_at": time.time(), "duration_seconds": round(time.monotonic()-started, 3),
            "selected_packets": selected, "udp_payload_lengths": dict(lengths), "socket_drops_all_traffic": drops,
            "received_frames": received_frames, "outgoing_frames": outgoing_frames,
            "filtered_frames": filtered_frames, "bound_protocol": ETH_P_ALL,
            "device_sequence_loss": None, "timestamp_kind": "worker_userspace_receive_time",
            "payload_saved": selected > 0, "clinical_forwarding": False}
        report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print("Saved private capture: " + str(folder), flush=True)
        print("Frames: %s; selected packets: %s; filtered: %s; outgoing: %s; clinical forwarding: false" %
              (received_frames, selected, filtered_frames, outgoing_frames), flush=True)
    finally:
        if sock is not None:
            sock.close()
        for path in (pcap, report_path, folder):
            if path.exists():
                os.chown(path, owner.pw_uid, owner.pw_gid)
    return 0 if selected > 0 and status == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
