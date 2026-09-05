"""The stop-gap until Comed is wired: one patient entered by hand, same path as the HIS feed."""
import pytest

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "set_identity", Path(__file__).resolve().parents[1] / "scripts" / "set_identity.py")
set_identity = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(set_identity)


def test_it_builds_the_same_two_resources_the_bridge_would():
    args = set_identity.build_parser().parse_args(
        ["--patient-id", "20239121", "--family", "YILMAZ", "--given", "AYSE",
         "--birth-date", "1980-01-15", "--sex", "female", "--bed", "YB^304^2",
         "--cloud-url", "http://api:8000", "--token", "t"])
    patient, encounter = set_identity.resources(args)
    assert patient["resourceType"] == "Patient"
    assert patient["identifier"][0]["value"] == "20239121"
    assert patient["name"][0] == {"family": "YILMAZ", "given": ["AYSE"]}
    assert patient["meta"]["source"] == "manuel"
    assert encounter["location"][0]["location"]["display"] == "YB^304^2"
    assert encounter["status"] == "in-progress"


def test_a_discharge_flips_both_resources():
    args = set_identity.build_parser().parse_args(
        ["--patient-id", "20239121", "--discharge",
         "--cloud-url", "http://api:8000", "--token", "t"])
    patient, encounter = set_identity.resources(args)
    assert patient["active"] is False and encounter["status"] == "finished"


def test_the_patient_id_is_required():
    with pytest.raises(SystemExit):
        set_identity.build_parser().parse_args(["--cloud-url", "http://api:8000", "--token", "t"])


def test_a_stale_answer_is_a_failure_not_a_sent(monkeypatch, capsys):
    """The API holds a newer record: this entry changed nothing, and the nurse must know."""
    monkeypatch.setattr(set_identity, "post_json", lambda *a, **k: {"identity": "stale"})
    code = set_identity.main(["--patient-id", "20239121", "--family", "YILMAZ",
                              "--cloud-url", "http://api:8000", "--token", "t"])
    assert code == 1
    assert "stale" in capsys.readouterr().out


def test_an_ok_answer_reports_both_resources(monkeypatch, capsys):
    monkeypatch.setattr(set_identity, "post_json", lambda *a, **k: {"identity": "ok"})
    assert set_identity.main(["--patient-id", "20239121", "--cloud-url", "http://api:8000",
                              "--token", "t"]) == 0
    out = capsys.readouterr().out
    assert "Patient: ok" in out and "Encounter: ok" in out
