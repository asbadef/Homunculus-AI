"""Replay a hash-scoped research capture on loopback; never enables clinical ingest."""
import argparse
import os
import secrets
from pathlib import Path

import uvicorn

from homunculus.edge.infinity_decoder import ResearchDecoder, load_recording, read_profile
from homunculus.edge.infinity_replay import MeasurementState, create_replay_app
from homunculus.edge.infinity_stream import Inventory
from homunculus.edge.infinity_journal import external_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replay", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--inventory", required=True, type=Path)
    parser.add_argument("--viewer-token-file", required=True, type=Path)
    args = parser.parse_args()
    try:
        args.replay = external_path(args.replay)
        args.profile = external_path(args.profile)
        args.viewer_token_file = external_path(args.viewer_token_file)
        decoder = ResearchDecoder(read_profile(args.profile), Inventory.read(args.inventory))
        rows, counts = load_recording(args.replay, decoder)
        if not args.viewer_token_file.exists():
            # Store only in an OS-private directory outside the repository.
            descriptor = os.open(args.viewer_token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="ascii") as target:
                target.write(secrets.token_urlsafe(36))
        if args.viewer_token_file.stat().st_size > 4096:
            raise ValueError("Invalid token file.")
        token = args.viewer_token_file.read_text(encoding="ascii").strip()
        state = MeasurementState(decoder.profile["source_ip"], decoder.profile["id"])
        app = create_replay_app(state, rows, token)
    except (ValueError, OSError, TypeError):
        print("Replay startup rejected. Check capture hash, profile, inventory and private token file.")
        return 2
    print(f"Validated {len(rows)} packets: {counts}. Research replay only; loopback 8767.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8767, access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
