"""Inspect allowlisted device traffic without emitting or saving packet payloads."""
from __future__ import annotations

import argparse
import json
import sys

from homunculus.edge.infinity_discovery import (
    DiscoveryError, collect_headers, device_addresses, summarize,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--interface", help="local mirror/capture interface (dumpcap -D)")
    source.add_argument("--read", help="existing hospital-local pcap/pcapng; do not place clinical captures in repo")
    parser.add_argument("--device", action="append", required=True, help="source IPv4; repeat for up to 13 devices")
    parser.add_argument("--duration", type=int, default=30, help="live seconds / offline processing budget, 1..300")
    parser.add_argument("--max-packets", type=int, default=20000, help="1..100000; offline limit counts all input packets")
    parser.add_argument("--tshark", help="path to tshark executable")
    parser.add_argument("--dumpcap", help="path to dumpcap executable")
    args = parser.parse_args(argv)
    try:
        devices = device_addresses(args.device)
        headers = collect_headers(
            devices=devices, interface=args.interface, capture_file=args.read,
            duration=args.duration, limit=args.max_packets,
            tshark=args.tshark, dumpcap=args.dumpcap,
        )
        report = summarize(headers, devices, mode="offline" if args.read else "live", limit=args.max_packets)
    except DiscoveryError as exc:
        print(json.dumps({"status": "capture_error", "clinical_ingest_enabled": False,
                          "reason": str(exc)}))
        return 2
    except ValueError:
        # Do not echo an arbitrary input path, address string or tool diagnostic.
        print(json.dumps({"status": "capture_error", "clinical_ingest_enabled": False,
                          "next_step": "Check tool installation, capture permissions, local interface/input and argument ranges."}))
        return 2
    except KeyboardInterrupt:
        print(json.dumps({"status": "interrupted", "clinical_ingest_enabled": False}))
        return 130
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
