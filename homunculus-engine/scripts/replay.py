# homunculus-engine/scripts/replay.py
"""Replay a scenario into a running dev server, one observation a second, so the dashboard
shows a patient sliding into septic shock live. Synthetic data only.

Run (with the dev server up on :8000):
    homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/replay.py [scenario.yaml]
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
name = sys.argv[1] if len(sys.argv) > 1 else "septic_shock.yaml"
delay = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0

for _ts, fhir in load_scenario(SCEN / name):
    req = urllib.request.Request(
        "http://localhost:8000/ingest",
        data=json.dumps(fhir).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer dev-token"},
    )
    urllib.request.urlopen(req).read()
    print("sent", fhir["code"]["coding"][0]["code"], fhir["valueQuantity"]["value"])
    time.sleep(delay)
