# homunculus-engine/scripts/replay.py
"""Replay a scenario into a running Homunculus API, one observation at a time, so the dashboard shows
a patient sliding into septic shock live. Synthetic data only.

    python scripts/replay.py [scenario.yaml] [delay_s] [--url URL] [--token-env NAME] [--now]

`--url` is the API's base: the dev server (http://localhost:8000, the default) or a local Docker
stack's web front, which proxies /ingest (e.g. http://127.0.0.1:18080). The token is read from the
environment variable `--token-env` names (HOMUNCULUS_TOKEN by default) and never from the command
line, where it would land in a shell's history and in every process listing; with none set, the dev
server's "dev-token" (one note on stderr says so, naming the variable and never a value). `--now`
moves the scenario so its last event is now (`loader.rebased`): the trend charts' window ends at the
server's clock and the scenarios are written at fixed dates, so an unmoved replay draws an empty chart.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario, rebased

SCEN = Path(homunculus.scenarios.__file__).parent
TIMEOUT_S = 15  # the dashboard's own read timeout: a dead stack must not hang the replay


def refusal_detail(err: urllib.error.HTTPError, token: str) -> str:
    """What the server said in its body (FastAPI's `detail`), never a header; "" when it said nothing
    usable. A server that echoes the token back has it replaced by "<token>" before anything is printed."""
    try:
        detail = json.loads(err.read().decode("utf-8", "replace")).get("detail")
    except (ValueError, AttributeError, OSError):
        return ""
    if detail is None:
        return ""
    text = detail if isinstance(detail, str) else json.dumps(detail)
    if token:
        text = text.replace(token, "<token>")
    return text[:300]


def main(argv=None) -> None:
    # allow_abbrev=False: `--token SECRET` must be refused, not read as an abbreviation of `--token-env`
    # (the secret would become a variable name, the dev token would be used, and the server would answer 401).
    parser = argparse.ArgumentParser(description="Replay a synthetic scenario into a Homunculus API.",
                                     allow_abbrev=False)
    parser.add_argument("scenario", nargs="?", default="septic_shock.yaml")
    parser.add_argument("delay", nargs="?", type=float, default=1.0, help="seconds between observations")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--token-env", default="HOMUNCULUS_TOKEN",
                        help="the environment variable holding the device token")
    parser.add_argument("--now", action="store_true", help="move the scenario so it ends now")
    args = parser.parse_args(argv)

    token = os.environ.get(args.token_env)
    if not token:
        print(f"note: {args.token_env} is not set; using the dev token", file=sys.stderr)
        token = "dev-token"
    endpoint = f"{args.url.rstrip('/')}/ingest"
    events = load_scenario(SCEN / args.scenario)
    if args.now:
        events = rebased(events, datetime.now(timezone.utc))
    for _ts, fhir in events:
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(fhir).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_S).read()
        except urllib.error.HTTPError as err:  # before URLError, which it subclasses
            print(f"error: {endpoint} answered {err.code}: {refusal_detail(err, token) or 'no detail'}",
                  file=sys.stderr)
            raise SystemExit(1) from None
        except (urllib.error.URLError, TimeoutError) as err:  # refused, unresolvable, or a read that timed out
            reason = err.reason if isinstance(err, urllib.error.URLError) else err
            print(f"error: {endpoint} unreachable: {reason}", file=sys.stderr)
            raise SystemExit(1) from None
        print("sent", fhir["code"]["coding"][0]["code"], fhir["valueQuantity"]["value"],
              fhir["effectiveDateTime"])
        time.sleep(args.delay)


if __name__ == "__main__":
    main()
