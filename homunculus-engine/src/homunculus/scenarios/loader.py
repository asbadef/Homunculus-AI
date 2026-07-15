# src/homunculus/scenarios/loader.py
"""Load a scenario YAML and yield (timestamp, FHIR Observation dict) in time order."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import yaml

CODE_SYSTEM = "http://homunculus.local/obs"


def load_scenario(path: str | Path) -> list[tuple[datetime, dict]]:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    patient_id = data["patient_id"]
    start = datetime.fromisoformat(data["start"])
    out: list[tuple[datetime, dict]] = []
    for ev in data["events"]:
        ts = start + timedelta(minutes=float(ev["at_min"]))
        resource = {
            "resourceType": "Observation",
            "status": "final",
            "code": {"coding": [{"system": CODE_SYSTEM, "code": ev["code"]}]},
            "subject": {"reference": f"Patient/{patient_id}"},
            "effectiveDateTime": ts.isoformat(),
            "valueQuantity": {"value": float(ev["value"]), "unit": ev.get("unit", "")},
            "device": {"display": ev.get("device", "sim")},
        }
        out.append((ts, resource))
    out.sort(key=lambda pair: pair[0])
    return out
