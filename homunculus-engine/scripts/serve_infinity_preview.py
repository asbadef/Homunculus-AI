"""Loopback-only, unverified Kappa preview; replay or explicitly selected passive live source."""
import argparse
import functools
import json
from pathlib import Path

import uvicorn

from homunculus.edge.infinity_discovery import device_addresses
from homunculus.edge.infinity_preview import PreviewState, create_preview_app, live_source, preview_profile, replay_source
from homunculus.edge.infinity_research import ResearchError, analyze_capture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--replay", type=Path)
    source.add_argument("--interface", help="explicit local capture interface; enables experimental live mode")
    parser.add_argument("--device", required=True)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--duration", type=int, default=300, help="live limit in seconds, 1..300")
    args = parser.parse_args()
    try:
        device = device_addresses([args.device])[0]
        if args.profile.stat().st_size > 65536 or not 1 <= args.duration <= 300:
            raise ResearchError("Invalid profile size or capture duration.")
        profile = preview_profile(json.loads(args.profile.read_text(encoding="utf-8-sig")))
        if args.replay:
            report = analyze_capture(args.replay, (device,), profile, include_series=True)
            if not report["candidate_series"]:
                raise ResearchError("No matching candidates in recording.")
            producer = functools.partial(replay_source, series=report["candidate_series"])
        else:
            if not args.interface or "://" in args.interface or args.interface == "-":
                raise ResearchError("Select a local capture interface.")
            # Capture hashes scope OFFLINE replay only. Live mode is a separate explicit
            # experiment, constrained by source/length/guards and always unverified.
            producer = functools.partial(live_source, profile=profile, interface=args.interface, duration=args.duration)
    except (ResearchError, ValueError, OSError, TypeError):
        print("Preview could not start; check local source and research profile.")
        return 2
    state = PreviewState("replay" if args.replay else "live", device)
    print(f"Homunculus test preview: {state.mode}; clinical ingest disabled; loopback port 8765.", flush=True)
    uvicorn.run(create_preview_app(state, producer), host="127.0.0.1", port=8765, access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
