"""NCE session files -> canonical Observations.

Every fixture here is hand-written and synthetic. No real session file, and therefore no patient
data, may enter this repository (CLAUDE.md hard rule 6).
"""
from __future__ import annotations

import json

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.ncefiles import SiteMapping, load_site_mapping, session_fields, session_pairs
from homunculus.gateway.fhir import GatewayError


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


ELEMENT_STYLE = """<?xml version="1.0"?>
<DeviceSession xmlns="urn:welchallyn:nce">
  <PatientId>yatak-3</PatientId>
  <MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>
  <Vitals Pulse="88">
    <Nibp_Systolic>128</Nibp_Systolic>
    <SpO2>97</SpO2>
  </Vitals>
</DeviceSession>
"""


def test_element_text_and_attributes_both_become_pairs():
    pairs = session_pairs(ELEMENT_STYLE)

    assert ("PatientId", "yatak-3") in pairs
    assert ("Nibp_Systolic", "128") in pairs
    assert ("Pulse", "88") in pairs          # attributes count too


def test_namespaces_are_stripped_from_names():
    """Every element in the fixture sits in urn:welchallyn:nce. A site table keyed on a namespace
    URI would break the day the vendor renumbers it, for no clinical reason."""
    names = session_fields(ELEMENT_STYLE)

    assert "PatientId" in names                          # not "{urn:welchallyn:nce}PatientId"
    assert not any("}" in name or ":" in name for name in names)


def test_field_names_are_reported_for_discovery():
    names = session_fields(ELEMENT_STYLE)

    assert "SpO2" in names
    assert "MeasurementTimeUtc" in names


def test_malformed_xml_raises_without_quoting_the_document():
    with pytest.raises(GatewayError) as caught:
        session_pairs("<DeviceSession><PatientId>yatak-3")

    assert "yatak-3" not in str(caught.value)     # the message must not carry patient data
