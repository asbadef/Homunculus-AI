"""NCE session files -> canonical Observations.

Every fixture here is hand-written and synthetic. No real session file, and therefore no patient
data, may enter this repository (CLAUDE.md hard rule 6).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from homunculus.canonical import SignalCode
from homunculus.edge.ncefiles import (
    MappedField,
    SiteMapping,
    load_site_mapping,
    parse_session,
    parse_timestamp,
    session_fields,
    session_pairs,
)
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


ATTRIBUTE_STYLE = """<?xml version="1.0"?>
<DeviceSession>
  <Reading name="SpO2" value="97"/>
  <Reading name="Nibp_Systolic" value="128"/>
</DeviceSession>
"""


def test_paired_attributes_become_a_named_value_when_configured():
    mapping = SiteMapping(pair_attributes=(("name", "value"),))

    pairs = session_pairs(ATTRIBUTE_STYLE, mapping)

    assert ("SpO2", "97") in pairs
    assert ("Nibp_Systolic", "128") in pairs


def test_without_the_configuration_the_pairing_is_not_invented():
    """Pairing every name/value attribute by default would misread documents that use them for
    something else, so it stays off until a site says otherwise."""
    pairs = session_pairs(ATTRIBUTE_STYLE)

    assert ("SpO2", "97") not in pairs
    assert ("name", "SpO2") in pairs


def test_an_iso_utc_stamp_is_accepted():
    assert parse_timestamp("2026-08-28T12:54:47Z") == datetime(
        2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc
    )


def test_an_offset_stamp_is_converted_to_utc():
    assert parse_timestamp("2026-08-28T15:54:47+03:00") == datetime(
        2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc
    )


def test_a_stamp_with_no_timezone_is_refused():
    """The NCE server's local clock runs an hour ahead of Turkey time. Assuming local would shift
    every observation by an unknown amount, quietly, in a system that reasons about time."""
    assert parse_timestamp("2026-08-28T16:54:47") is None
    assert parse_timestamp("20260828165447") is None


def test_nonsense_is_refused_rather_than_guessed():
    assert parse_timestamp("bugün") is None


FULL_MAPPING = SiteMapping(
    signals={
        "Nibp_Systolic": MappedField(SignalCode.SBP, "mmHg"),
        "SpO2": MappedField(SignalCode.SPO2, "%"),
        "Pulse": MappedField(SignalCode.HEART_RATE, "bpm"),
    },
    patient_fields=("PatientId",),
    timestamp_fields=("MeasurementTimeUtc",),
)

EPOCH_FALLBACK = datetime(2026, 8, 28, 12, 54, 47, tzinfo=timezone.utc)


def test_mapped_fields_become_observations():
    parsed = parse_session(ELEMENT_STYLE, FULL_MAPPING)

    by_code = {o.code: o for o in parsed.observations}
    assert by_code[SignalCode.SBP].value == 128.0
    assert by_code[SignalCode.SBP].unit == "mmHg"
    assert by_code[SignalCode.SPO2].value == 97.0
    assert by_code[SignalCode.HEART_RATE].value == 88.0
    assert len(parsed.observations) == 3
    assert all(o.patient_id == "yatak-3" for o in parsed.observations)
    assert all(o.timestamp == EPOCH_FALLBACK for o in parsed.observations)


def test_a_session_with_no_patient_identifier_is_refused():
    """A vital recorded against the wrong patient is worse than one that never arrives, and a
    placeholder patient is a wrong patient with a friendly name."""
    anonymous = ELEMENT_STYLE.replace("<PatientId>yatak-3</PatientId>", "")

    with pytest.raises(GatewayError) as caught:
        parse_session(anonymous, FULL_MAPPING)

    assert "patient" in str(caught.value).lower()


def test_the_filename_epoch_is_used_when_the_session_carries_no_utc_time():
    undated = ELEMENT_STYLE.replace(
        "<MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>", ""
    )

    parsed = parse_session(undated, FULL_MAPPING, fallback_timestamp=EPOCH_FALLBACK)

    assert all(o.timestamp == EPOCH_FALLBACK for o in parsed.observations)


def test_a_session_with_no_usable_time_at_all_is_refused():
    undated = ELEMENT_STYLE.replace(
        "<MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>", ""
    )

    with pytest.raises(GatewayError):
        parse_session(undated, FULL_MAPPING, fallback_timestamp=None)


def test_a_mapped_field_that_is_not_a_number_is_reported_not_dropped():
    broken = ELEMENT_STYLE.replace("<SpO2>97</SpO2>", "<SpO2>--</SpO2>")

    parsed = parse_session(broken, FULL_MAPPING)

    assert "SpO2" in parsed.non_numeric
    assert SignalCode.SPO2 not in {o.code for o in parsed.observations}


def test_a_mapped_field_appearing_twice_is_reported():
    """The flat walk keeps the first value. If a session carries several readings per field that is
    data loss, so it has to be visible rather than quiet."""
    twice = ELEMENT_STYLE.replace("<SpO2>97</SpO2>", "<SpO2>97</SpO2><SpO2>95</SpO2>")

    parsed = parse_session(twice, FULL_MAPPING)

    assert "SpO2" in parsed.repeated
    assert len([o for o in parsed.observations if o.code is SignalCode.SPO2]) == 1


def test_conflicting_patient_identifiers_are_refused():
    """The second value could be a previous patient still sitting in device memory. Quietly
    keeping the first would attribute vitals to whichever patient happened to be written first,
    which is exactly the wrong-patient risk this parser exists to avoid."""
    conflicting = ELEMENT_STYLE.replace(
        "<PatientId>yatak-3</PatientId>",
        "<PatientId>yatak-3</PatientId><PatientId>yatak-9</PatientId>",
    )

    with pytest.raises(GatewayError) as caught:
        parse_session(conflicting, FULL_MAPPING)

    message = str(caught.value)
    assert "conflict" in message.lower()
    assert "yatak-3" not in message
    assert "yatak-9" not in message


def test_an_identical_repeated_patient_identifier_is_accepted():
    """A header echo — the same value twice — is not a conflict."""
    repeated = ELEMENT_STYLE.replace(
        "<PatientId>yatak-3</PatientId>",
        "<PatientId>yatak-3</PatientId><PatientId>yatak-3</PatientId>",
    )

    parsed = parse_session(repeated, FULL_MAPPING)

    assert parsed.observations
    assert all(o.patient_id == "yatak-3" for o in parsed.observations)


def test_conflicting_timestamps_are_refused():
    conflicting = ELEMENT_STYLE.replace(
        "<MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>",
        "<MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>"
        "<MeasurementTimeUtc>2026-08-28T13:00:00Z</MeasurementTimeUtc>",
    )

    with pytest.raises(GatewayError):
        parse_session(conflicting, FULL_MAPPING)


def test_nan_and_inf_are_refused_as_values():
    nan_session = ELEMENT_STYLE.replace("<SpO2>97</SpO2>", "<SpO2>nan</SpO2>")
    parsed = parse_session(nan_session, FULL_MAPPING)
    assert "SpO2" in parsed.non_numeric
    assert SignalCode.SPO2 not in {o.code for o in parsed.observations}

    inf_session = ELEMENT_STYLE.replace("<SpO2>97</SpO2>", "<SpO2>inf</SpO2>")
    parsed = parse_session(inf_session, FULL_MAPPING)
    assert "SpO2" in parsed.non_numeric
    assert SignalCode.SPO2 not in {o.code for o in parsed.observations}


def test_a_document_with_a_dtd_entity_is_refused():
    hostile = (
        '<?xml version="1.0"?>'
        '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///x">]>'
        "<DeviceSession><PatientId>p</PatientId><V>&x;</V></DeviceSession>"
    )

    with pytest.raises(GatewayError):
        parse_session(hostile, FULL_MAPPING)


PAIR_ATTRIBUTE_SESSION = """<?xml version="1.0"?>
<DeviceSession>
  <PatientId>yatak-3</PatientId>
  <MeasurementTimeUtc>2026-08-28T12:54:47Z</MeasurementTimeUtc>
  <Reading name="SpO2" value="97"/>
</DeviceSession>
"""


def test_paired_attribute_sessions_parse_end_to_end():
    mapping = SiteMapping(
        signals={"SpO2": MappedField(SignalCode.SPO2, "%")},
        patient_fields=("PatientId",),
        timestamp_fields=("MeasurementTimeUtc",),
        pair_attributes=(("name", "value"),),
    )

    parsed = parse_session(PAIR_ATTRIBUTE_SESSION, mapping)

    assert len(parsed.observations) == 1
    assert parsed.observations[0].code is SignalCode.SPO2
    assert parsed.observations[0].value == 97.0
