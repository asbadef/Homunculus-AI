"""Bounded Linux multicast probe: counts only; no payload storage or forwarding."""
import collections
import json
import socket
import struct
import sys
import time


def main():
    if sys.platform != "linux":
        raise SystemExit("Run this probe on the Ubuntu worker.")
    local, source, group = "10.10.203.101", "10.10.203.28", "224.0.2.28"
    interface_index = socket.if_nametoindex("ens3")
    membership = socket.inet_aton(group) + socket.inet_aton(local)
    lengths, ports = collections.Counter(), collections.Counter()
    selected = excluded = examined = 0
    joined = False
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024 * 1024)
        sock.setsockopt(socket.IPPROTO_IP, 8, 1)  # Linux IP_PKTINFO
        sock.setsockopt(socket.IPPROTO_IP, 49, 0)  # Linux IP_MULTICAST_ALL
        sock.bind(("0.0.0.0", 2050))  # exclusive; do not share another collector's port
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership)
        joined = True
        start = time.monotonic()
        deadline, next_log = start + 30, start + 5
        print(f"30-second probe: {source} -> {group}:2050 on ens3 ({local})", flush=True)
        while examined < 200000:
            now = time.monotonic()
            if now >= deadline:
                break
            if now >= next_log:
                print(f"{now-start:.0f}s: selected={selected}, excluded={excluded}", flush=True)
                next_log = now + 5
            sock.settimeout(min(0.5, deadline - now))
            try:
                payload, control, flags, peer = sock.recvmsg(65535, socket.CMSG_SPACE(12))
            except socket.timeout:
                continue
            examined += 1
            correct_destination = False
            for level, kind, value in control:
                if level == socket.IPPROTO_IP and kind == 8 and len(value) == 12:
                    index, _, destination = struct.unpack("=I4s4s", value)
                    correct_destination = (index == interface_index and
                                           socket.inet_ntoa(destination) == group)
            if (flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC)
                    or peer[0] != source or not correct_destination):
                excluded += 1
                continue
            selected += 1
            lengths[len(payload)] += 1
            ports[peer[1]] += 1
        print(json.dumps({"status": "limit_reached" if examined >= 200000 else "completed",
                          "duration_seconds": round(time.monotonic() - start, 3),
                          "selected_packets": selected, "excluded_packets": excluded,
                          "udp_payload_lengths": dict(lengths), "source_ports": dict(ports),
                          "capture_drops": None, "payload_saved": False,
                          "clinical_forwarding": False}), flush=True)
    finally:
        try:
            if joined:
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_DROP_MEMBERSHIP, membership)
        finally:
            sock.close()
        print("Probe stopped; socket closed and membership released.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
    except OSError as exc:
        print(f"Probe failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
