"""Discovery mode for the file route — the thing that stops the ward visit failing silently.

NCE emits the vendor's field names, not our slugs. Without a site table every observation is
dropped while files keep arriving and the mount keeps looking healthy. The bridge counts what it
could not map and names it, turning an invisible failure into a five-minute fix.

PHI: field names are device metadata and are reported. Values are patient data and must never reach
a log or a report.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.ncebridge import NceFileBridge
from homunculus.edge.ncefiles import MappedField, SiteMapping
from homunculus.gateway.fhir import GatewayError

SESSION = """<?xml version="1.0"?>
<DeviceSession>
  <PatientId>yatak-3</PatientId>
  <MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>
  <Nibp_Systolic>128</Nibp_Systolic>
  <SpO2>97</SpO2>
</DeviceSession>
"""

MAPPING = SiteMapping(
    signals={"SpO2": MappedField(SignalCode.SPO2, "%")},
    patient_fields=("PatientId",),
    timestamp_fields=("MeasurementTimeUtc",),
)

WHEN = datetime(2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc)


def test_mapped_observations_are_sent_as_fhir():
    sent: list[dict] = []
    bridge = NceFileBridge(send=sent.append, mapping=MAPPING)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert len(sent) == 1
    assert sent[0]["resourceType"] == "Observation"
    assert sent[0]["valueQuantity"]["value"] == 97.0
    assert bridge.stats.files == 1
    assert bridge.stats.observations == 1


def test_unmapped_fields_are_counted():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.stats.unmapped["Nibp_Systolic"] == 1


def test_counts_accumulate_across_sessions():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)
    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.stats.unmapped["Nibp_Systolic"] == 2
    assert bridge.stats.files == 2


def test_a_refused_session_still_reports_its_field_names():
    """Without this, a missing patient_fields setting is undiagnosable: every session is refused and
    nothing says which field the identifier was actually in."""
    bridge = NceFileBridge(send=lambda _p: None, mapping=SiteMapping())

    with pytest.raises(GatewayError):
        bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.stats.rejected == 1
    assert "PatientId" in bridge.stats.unmapped


def test_the_report_names_fields_but_never_values():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)
    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    report = bridge.discovery_report()

    assert "Nibp_Systolic" in report
    assert "128" not in report          # the measurement is PHI
    assert "yatak-3" not in report      # so is the identifier


def test_the_report_is_empty_when_everything_maps():
    mapping = SiteMapping(
        signals={
            "SpO2": MappedField(SignalCode.SPO2, "%"),
            "Nibp_Systolic": MappedField(SignalCode.SBP, "mmHg"),
        },
        patient_fields=("PatientId",),
        timestamp_fields=("MeasurementTimeUtc",),
    )
    bridge = NceFileBridge(send=lambda _p: None, mapping=mapping)

    bridge.handle_session(SESSION, fallback_timestamp=WHEN)

    assert bridge.discovery_report() == ""


def test_non_numeric_and_repeated_reach_the_report():
    session = SESSION.replace(
        "<SpO2>97</SpO2>",
        "<SpO2>--</SpO2><Nibp_Systolic>130</Nibp_Systolic>",
    )
    mapping = SiteMapping(
        signals={
            "SpO2": MappedField(SignalCode.SPO2, "%"),
            "Nibp_Systolic": MappedField(SignalCode.SBP, "mmHg"),
        },
        patient_fields=("PatientId",),
        timestamp_fields=("MeasurementTimeUtc",),
    )
    bridge = NceFileBridge(send=lambda _p: None, mapping=mapping)

    bridge.handle_session(session, fallback_timestamp=WHEN)

    assert bridge.stats.non_numeric["SpO2"] == 1
    assert bridge.stats.repeated["Nibp_Systolic"] == 1
    report = bridge.discovery_report()
    assert "Sayı olmayan değerler" in report and "SpO2" in report
    assert "Aynı dosyada tekrarlanan alanlar" in report


def test_malformed_xml_is_rejected_and_counted_without_polluting_discovery():
    bridge = NceFileBridge(send=lambda _p: None, mapping=MAPPING)

    with pytest.raises(GatewayError):
        bridge.handle_session("<DeviceSession><PatientId>x", fallback_timestamp=WHEN)

    assert bridge.stats.files == 1
    assert bridge.stats.rejected == 1
    assert bridge.stats.unmapped == {}
