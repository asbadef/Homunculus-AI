"""NCE session files -> canonical Observations.

Every fixture here is hand-written and synthetic. No real session file, and therefore no patient
data, may enter this repository (CLAUDE.md hard rule 6).
"""
from __future__ import annotations

import json

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.ncefiles import SiteMapping, load_site_mapping


def test_a_mapping_file_becomes_signal_codes(tmp_path):
    path = tmp_path / "nce-mapping.json"
    path.write_text(json.dumps({
        "patient_fields": ["PatientId"],
        "timestamp_fields": ["MeasurementTimeUtc"],
        "signals": {
            "Nibp_Systolic": {"signal": "sbp", "unit": "mmHg"},
            "SpO2": {"signal": "spo2", "unit": "%"},
        },
    }), encoding="utf-8")

    mapping = load_site_mapping(path)

    assert mapping.signals["Nibp_Systolic"].signal is SignalCode.SBP
    assert mapping.signals["Nibp_Systolic"].unit == "mmHg"
    assert mapping.patient_fields == ("PatientId",)
    assert mapping.timestamp_fields == ("MeasurementTimeUtc",)


def test_an_unknown_slug_stops_startup(tmp_path):
    """Ignoring it would drop a signal for the whole pilot with nothing reporting a problem."""
    path = tmp_path / "nce-mapping.json"
    path.write_text(json.dumps({"signals": {"Foo": {"signal": "blood_unicorns"}}}), encoding="utf-8")

    with pytest.raises(SystemExit) as caught:
        load_site_mapping(path)

    assert "blood_unicorns" in str(caught.value)


def test_an_empty_mapping_is_valid_and_maps_nothing(tmp_path):
    """The file ships empty: the field table is written from discovery output, not guessed."""
    path = tmp_path / "nce-mapping.json"
    path.write_text("{}", encoding="utf-8")

    mapping = load_site_mapping(path)

    assert mapping == SiteMapping()
