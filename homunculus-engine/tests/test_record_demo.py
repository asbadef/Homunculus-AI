# tests/test_record_demo.py
import json
from pathlib import Path

import homunculus.scenarios
from scripts_record_demo import record

SCEN = Path(homunculus.scenarios.__file__).parent


def test_records_septic_shock_timeline_ending_in_the_alert(tmp_path):
    out = tmp_path / "septic_shock.json"
    record(SCEN / "septic_shock.yaml", out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["scenario"] == "septic_shock"
    ts = [f["t"] for f in data["frames"]]
    assert ts == sorted(ts)                      # monotonic time
    last_boards = data["frames"][-1]["boards"]
    bed3 = next(b for b in last_boards if b["patient_id"] == "bed-3")
    assert any(a["kind"] == "septic_shock" for a in bed3["alerts"])


def test_stable_scenario_records_no_alerts(tmp_path):
    out = tmp_path / "stable.json"
    record(SCEN / "stable_control.yaml", out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert all(not b["alerts"] for f in data["frames"] for b in f["boards"])
