# homunculus-engine/scripts/record_demo.py
"""Run the real engine over one or more scenarios (a ward) and record the exact board frames +
notifications it emits, as a static JSON the demos replay. Synthetic data only — never any PHI."""
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


def record_ward(scenario_paths: list[str | Path], out_path: str | Path,
                step_seconds: float = 1.0, name: str = "icu-ward") -> None:
    """Merge several scenarios into one ward and record what a SINGLE engine emits.

    The engine is already multi-patient (board_snapshot iterates patient_ids), so a ward needs no
    engine or loader change — only the event streams merged in absolute time before ingest.
    Events sharing a timestamp keep scenario-file order (stable sort)."""
    out_path = Path(out_path)
    engine, store, notifier = Engine(), AckStore(), Notifier()
    events: list[tuple[datetime, dict]] = []
    for path in scenario_paths:
        events.extend(load_scenario(Path(path)))
    events.sort(key=lambda pair: pair[0])

    frames, history = [], []
    for i, (_ts, fhir) in enumerate(events):
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
        "scenario": name, "step_seconds": step_seconds,
        "frames": frames, "notification_history": history}, indent=2), encoding="utf-8")


def record(scenario_path: str | Path, out_path: str | Path, step_seconds: float = 1.0) -> None:
    """One scenario is a ward of one."""
    record_ward([scenario_path], out_path, step_seconds, name=Path(scenario_path).stem)


REPO = Path(__file__).resolve().parents[2]
WARD_SCENARIOS = ["septic_shock.yaml", "under_resuscitated.yaml", "stable_control.yaml"]


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "ward":
        out = Path(args[1]) if len(args) > 1 else REPO / "homunculus-mobile" / "assets" / "demo" / "icu-ward.json"
        record_ward([SCEN / s for s in WARD_SCENARIOS], out)
        print(f"recorded ward -> {out}")
        return
    name = args[0] if args else "septic_shock.yaml"
    out = Path(args[1]) if len(args) > 1 else REPO / "dashboard" / "public" / "demo" / f"{Path(name).stem}.json"
    record(SCEN / name, out)
    print(f"recorded {name} -> {out}")


if __name__ == "__main__":
    main()
