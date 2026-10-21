# homunculus-engine/scripts/replay.py
"""Replay a scenario into a running Homunculus API, one observation at a time, so the dashboard shows
a patient sliding into septic shock live. Synthetic data only.

    python scripts/replay.py [scenario.yaml] [delay_s] [--url URL] [--token-env NAME] [--now]

`--url` is the API's base: the dev server (http://localhost:8000, the default) or a local Docker
stack's web front, which proxies /ingest (e.g. http://127.0.0.1:18080). The token is read from the
environment variable `--token-env` names (HOMUNCULUS_TOKEN by default) and never from the command
line, where it would land in a shell's history and in every process listing; with none set, the dev
server's "dev-token". `--now` moves the scenario so its last event is now (`loader.rebased`): the
trend charts' window ends at the server's clock and the scenarios are written at fixed dates, so an
unmoved replay draws an empty chart.
"""
import argparse
import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario, rebased

SCEN = Path(homunculus.scenarios.__file__).parent


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Replay a synthetic scenario into a Homunculus API.")
    parser.add_argument("scenario", nargs="?", default="septic_shock.yaml")
    parser.add_argument("delay", nargs="?", type=float, default=1.0, help="seconds between observations")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--token-env", default="HOMUNCULUS_TOKEN",
                        help="the environment variable holding the device token")
    parser.add_argument("--now", action="store_true", help="move the scenario so it ends now")
    args = parser.parse_args(argv)

    token = os.environ.get(args.token_env) or "dev-token"
    events = load_scenario(SCEN / args.scenario)
    if args.now:
        events = rebased(events, datetime.now(timezone.utc))
    for _ts, fhir in events:
        req = urllib.request.Request(
            f"{args.url.rstrip('/')}/ingest",
            data=json.dumps(fhir).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        )
        urllib.request.urlopen(req).read()
        print("sent", fhir["code"]["coding"][0]["code"], fhir["valueQuantity"]["value"],
              fhir["effectiveDateTime"])
        time.sleep(args.delay)


if __name__ == "__main__":
    main()
