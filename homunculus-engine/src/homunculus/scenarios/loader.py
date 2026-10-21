# src/homunculus/scenarios/loader.py
"""Load a scenario YAML and yield (timestamp, FHIR Observation dict) in time order."""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
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


def rebased(events: list[tuple[datetime, dict]], end: datetime) -> list[tuple[datetime, dict]]:
    """The same events moved in time so the latest one falls at `end`, every gap between two kept.

    For a replay into a local stack (scripts/replay.py `--now`): the scenarios are written at fixed
    dates, and the trend charts' window ends at the server's now, so an unmoved replay draws an
    empty chart. A deep copy: the loaded events are not changed, nested dicts included. The order
    given is the order returned; the latest event is the one anchored, wherever it sits. A naive
    timestamp is read as UTC, as the gateways do (gateway/fhir.py `to_utc`).
    """
    if end.tzinfo is None or end.utcoffset() is None:
        raise ValueError("end must carry a time zone")
    if not events:
        return []
    stamped = [(ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts, resource)
               for ts, resource in events]
    shift = end - max(ts for ts, _ in stamped)
    moved: list[tuple[datetime, dict]] = []
    for ts, resource in stamped:
        at = ts + shift
        clone = copy.deepcopy(resource)
        clone["effectiveDateTime"] = at.isoformat()
        moved.append((at, clone))
    return moved
