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


HL7_COPY = (
    "MSH|^~\\&|NCE|HOSP|HIS|HOSP|20260901155301||ORU^R01|X1|P|2.5\r"
    "PID|||yatak-3\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|262688^MDC_DIM_PERCENT^MDC|||||F\r"
    "OBX|2|NM|150021^MDC_PRESS_BLD_NONINV_SYS^MDC||128|266016^MDC_DIM_MMHG^MDC|||||F\r"
)

HL7_MAPPING = SiteMapping(hl7_signals={
    "150456": SignalCode.SPO2,
    "150021": SignalCode.SBP,
})


def test_an_hl7_host_copy_goes_through_the_existing_gateway():
    """NCEToHost copies are NCE's own HL7 rendering of a reading — already MDC-normalised, so
    they are parsed with the gateway the HL7 bridge has used all along."""
    sent: list[dict] = []
    bridge = NceFileBridge(send=sent.append, mapping=HL7_MAPPING)

    observations = bridge.handle_session(HL7_COPY.encode("utf-8"), fallback_timestamp=WHEN)

    assert {o.code for o in observations} == {SignalCode.SPO2, SignalCode.SBP}
    assert {o.value for o in observations} == {97.0, 128.0}
    assert all(o.patient_id == "yatak-3" for o in observations)
    assert len(sent) == 2
    assert bridge.stats.observations == 2


def test_hl7_observations_are_restamped_with_the_filename_epoch():
    """The vendor's HL7 stamps are naive local time from a server with a known clock skew; the
    filename epoch is the trustworthy UTC time, so it wins."""
    bridge = NceFileBridge(send=lambda _p: None, mapping=HL7_MAPPING)

    observations = bridge.handle_session(HL7_COPY, fallback_timestamp=WHEN)

    assert all(o.timestamp == WHEN for o in observations)
    assert all(o.source_device == "nce" for o in observations)


def test_a_bom_prefixed_hl7_copy_is_still_recognised():
    payload = b"\xef\xbb\xbf" + HL7_COPY.encode("utf-8")
    bridge = NceFileBridge(send=lambda _p: None, mapping=HL7_MAPPING)

    observations = bridge.handle_session(payload, fallback_timestamp=WHEN)

    assert len(observations) == 2


def test_hl7_codes_the_table_misses_are_counted_for_discovery():
    only_spo2 = SiteMapping(hl7_signals={"150456": SignalCode.SPO2})
    bridge = NceFileBridge(send=lambda _p: None, mapping=only_spo2)

    observations = bridge.handle_session(HL7_COPY, fallback_timestamp=WHEN)

    assert len(observations) == 1
    assert bridge.stats.unmapped["150021"] == 1
    assert "150021" in bridge.discovery_report()


def test_an_hl7_copy_without_a_patient_id_is_refused():
    anonymous = HL7_COPY.replace("PID|||yatak-3\r", "PID|||\r")
    bridge = NceFileBridge(send=lambda _p: None, mapping=HL7_MAPPING)

    with pytest.raises(GatewayError):
        bridge.handle_session(anonymous, fallback_timestamp=WHEN)

    assert bridge.stats.rejected == 1
    assert bridge.stats.unmapped == {}      # both codes are mapped; refusal must not pollute


def test_an_hl7_copy_with_no_filename_epoch_is_refused():
    """No epoch means no trustworthy time: the vendor stamp cannot be used, so refuse loudly."""
    bridge = NceFileBridge(send=lambda _p: None, mapping=HL7_MAPPING)

    with pytest.raises(GatewayError):
        bridge.handle_session(HL7_COPY, fallback_timestamp=None)

    assert bridge.stats.rejected == 1


def test_an_hl7_copy_with_cx_style_patient_id_is_accepted():
    """The real NCE fills PID-3 but hides the identifier behind leading empty CX components;
    that must parse, not masquerade as a missing identifier."""
    cx_style = HL7_COPY.replace("PID|||yatak-3\r", "PID|||^^yatak-3\r")
    bridge = NceFileBridge(send=lambda _p: None, mapping=HL7_MAPPING)

    observations = bridge.handle_session(cx_style, fallback_timestamp=WHEN)

    assert len(observations) == 2
    assert all(o.patient_id == "yatak-3" for o in observations)


def test_rejection_logs_name_the_reason(caplog):
    """A uniform 'rejected' line forced a blind diagnosis session once; never again. The
    GatewayError text is safe by construction — static strings or message metadata only."""
    import logging as _logging
    bridge = NceFileBridge(send=lambda _p: None, mapping=HL7_MAPPING)
    query = HL7_COPY.replace("ORU^R01", "QBP^Q22")

    with caplog.at_level(_logging.WARNING):
        with pytest.raises(GatewayError):
            bridge.handle_session(query, fallback_timestamp=WHEN)

    assert any("expected ORU" in r.getMessage() for r in caplog.records)
