# homunculus-engine/scripts/record_demo.py
"""Run the real engine over a scenario and record the exact board frames + notifications it emits,
as a static JSON the browser demo replays. Synthetic data only — never any PHI."""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import homunculus.scenarios
from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot
from homunculus.api.notify import Notifier
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


def record(scenario_path: str | Path, out_path: str | Path, step_seconds: float = 1.0) -> None:
    scenario_path, out_path = Path(scenario_path), Path(out_path)
    engine, store, notifier = Engine(), AckStore(), Notifier()
    frames, history = [], []
    for i, (_ts, fhir) in enumerate(load_scenario(scenario_path)):
        obs = parse_fhir_observation(fhir)
        engine.ingest(obs, now=obs.timestamp)
        wall = datetime.now(timezone.utc)
        for a in engine.active_alerts(obs.patient_id):
            store.stamp_first_seen(obs.patient_id, a.kind, wall)
        notes = [asdict(n) for n in notifier.for_new("DEMO", engine.active_alerts(obs.patient_id))]
        history.extend(notes)
        frames.append({"t": round(i * step_seconds, 3),
                       "boards": board_snapshot(engine, store),
                       "notifications": notes})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "scenario": scenario_path.stem, "step_seconds": step_seconds,
        "frames": frames, "notification_history": history}, indent=2), encoding="utf-8")


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "septic_shock.yaml"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
        __file__).resolve().parents[2] / "dashboard" / "public" / "demo" / f"{Path(name).stem}.json"
    record(SCEN / name, out)
    print(f"recorded {name} -> {out}")


if __name__ == "__main__":
    main()
