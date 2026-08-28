# tests/test_record_ward.py
import json
from pathlib import Path

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario
from scripts_record_demo import record_ward

SCEN = Path(homunculus.scenarios.__file__).parent
WARD = [SCEN / "septic_shock.yaml", SCEN / "under_resuscitated.yaml", SCEN / "stable_control.yaml"]


def test_ward_ends_with_all_three_beds_on_the_board(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["scenario"] == "icu-ward"
    assert {b["patient_id"] for b in data["frames"][-1]["boards"]} == {"bed-3", "bed-5", "bed-7"}


def test_ward_has_one_time_ordered_frame_per_merged_event(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert len(data["frames"]) == sum(len(load_scenario(s)) for s in WARD)
    ts = [f["t"] for f in data["frames"]]
    assert ts == sorted(ts)


def test_ward_preserves_each_bed_s_own_finding(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    boards = {b["patient_id"]: b for b in data["frames"][-1]["boards"]}
    assert any(a["kind"] == "septic_shock" for a in boards["bed-3"]["alerts"])
    assert any(a["kind"] == "under_resuscitated_sepsis" for a in boards["bed-7"]["alerts"])
    assert boards["bed-5"]["alerts"] == []


def test_ward_keeps_the_notifications_the_single_scenarios_produced(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    kinds = {n["kind"] for n in data["notification_history"]}
    assert {"septic_shock", "under_resuscitated_sepsis"} <= kinds
