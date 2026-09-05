# tests/test_gateway_hl7.py
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.canonical import SignalCode
from homunculus.gateway.fhir import GatewayError
from homunculus.gateway.hl7 import parse_hl7_oru


def _msg(*segments):
    """Join HL7 segments with the carriage-return segment terminator."""
    return "\r".join(segments)


# A well-formed ORU^R01 carrying two numeric observations for one patient.
_MSH = r"MSH|^~\&|MON|ICU|HOM|HOSP|20260716143000||ORU^R01|MSG001|P|2.5"
_PID = "PID|1||bed-3^^^HOSP^MR||DOE^JOHN||19800101|M"
_OBR = "OBR|1|||VITALS"


def test_parses_a_single_obx_into_one_observation():
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|heart_rate||118|bpm|||||F|||20260716143000")
    obs = parse_hl7_oru(msg)
    assert len(obs) == 1
    o = obs[0]
    assert o.patient_id == "bed-3"
    assert o.code == SignalCode.HEART_RATE
    assert o.value == 118.0
    assert o.unit == "bpm"
    assert o.timestamp == datetime(2026, 7, 16, 14, 30, 0, tzinfo=timezone.utc)


def test_one_message_yields_multiple_observations():
    msg = _msg(
        _MSH, _PID, _OBR,
        "OBX|1|NM|heart_rate||118|bpm|||||F|||20260716143000",
        "OBX|2|NM|lactate||3.1|mmol/L|||||F|||20260716143000",
        "OBX|3|NM|map||58|mmHg|||||F|||20260716143000",
    )
    obs = parse_hl7_oru(msg)
    assert [o.code for o in obs] == [SignalCode.HEART_RATE, SignalCode.LACTATE, SignalCode.MAP]
    assert [o.value for o in obs] == [118.0, 3.1, 58.0]


def test_unmapped_obx_code_is_skipped_not_fatal():
    # A monitor sends dozens of parameters; we only track some. Unknown codes are dropped,
    # the rest of the message still parses.
    msg = _msg(
        _MSH, _PID, _OBR,
        "OBX|1|NM|heart_rate||118|bpm|||||F|||20260716143000",
        "OBX|2|NM|SOME_VENDOR_PARAM||42|x|||||F|||20260716143000",
    )
    obs = parse_hl7_oru(msg)
    assert [o.code for o in obs] == [SignalCode.HEART_RATE]


def test_per_hospital_mapping_translates_vendor_codes():
    # The per-site variation point: a vendor code like "HR" maps to our signal.
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|HR||118|bpm|||||F|||20260716143000")
    obs = parse_hl7_oru(msg, mapping={"HR": SignalCode.HEART_RATE})
    assert len(obs) == 1
    assert obs[0].code == SignalCode.HEART_RATE


def test_non_numeric_value_is_dropped_not_fabricated():
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|lactate||ERROR|mmol/L|||||F|||20260716143000")
    assert parse_hl7_oru(msg) == []


def test_obx_timestamp_falls_back_to_message_time_when_absent():
    # OBX-14 empty -> use MSH-7 message datetime.
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|heart_rate||118|bpm|||||F")
    obs = parse_hl7_oru(msg)
    assert obs[0].timestamp == datetime(2026, 7, 16, 14, 30, 0, tzinfo=timezone.utc)


def test_timestamps_are_timezone_aware_utc():
    # Both gateways must emit tz-aware UTC so HL7 and FHIR feeds can coexist in one engine.
    msg = _msg(_MSH, _PID, _OBR, "OBX|1|NM|heart_rate||118|bpm|||||F|||20260716143000")
    o = parse_hl7_oru(msg)[0]
    assert o.timestamp.tzinfo is not None
    assert o.timestamp.utcoffset() == timedelta(0)


def test_missing_patient_id_raises_gateway_error():
    msg = _msg(_MSH, _OBR, "OBX|1|NM|heart_rate||118|bpm|||||F|||20260716143000")
    with pytest.raises(GatewayError):
        parse_hl7_oru(msg)


def test_non_oru_message_raises_gateway_error():
    adt = r"MSH|^~\&|MON|ICU|HOM|HOSP|20260716143000||ADT^A01|MSG001|P|2.5"
    msg = _msg(adt, _PID, "OBX|1|NM|heart_rate||118|bpm|||||F|||20260716143000")
    with pytest.raises(GatewayError):
        parse_hl7_oru(msg)


def test_message_without_msh_raises_gateway_error():
    with pytest.raises(GatewayError):
        parse_hl7_oru("PID|1||bed-3^^^HOSP^MR")


def test_pid3_identifier_survives_leading_empty_components():
    """Welch Allyn NCE ships PID-3 as CX with leading empty components (e.g. ^^1234567).
    The identifier is still the sender's own — only its punctuation is forgiven."""
    message = (
        "MSH|^~\\&|NCE|HOSP|HIS|HOSP|20260901155301||ORU^R01^ORU_R01|X1|P|2.5\r"
        "PID|||^^yatak-77\r"
        "OBX|1|NM|heart_rate||88|bpm|||||F|||20260901155301\r"
    )

    observations = parse_hl7_oru(message)

    assert observations
    assert all(o.patient_id == "yatak-77" for o in observations)


def test_pid3_with_empty_identifier_is_rejected_even_when_cx4_cx5_are_filled():
    """Seen on the ward 2026-09-03: a Connex Spot reading saved with NO patient id arrives as
    PID-3 = ^^^X^PI — the identifier components are empty and only the assigning authority (CX.4,
    "X") and the identifier-type code (CX.5, "PI") are present. Those are HL7 code-table values,
    never identifiers. Accepting "X" merged every anonymous reading into one pseudo-patient."""
    message = (
        "MSH|^~\\&|NCE|HOSP|HIS|HOSP|20260903160934+0400||ORU^R01^ORU_R01|X1|P|2.5\r"
        "PID|||^^^X^PI||^^\r"
        "OBX|1|NM|heart_rate||88|bpm|||||F|||20260903160934+0400\r"
    )
    with pytest.raises(GatewayError, match="PID-3"):
        parse_hl7_oru(message)


def test_pid3_identifier_in_a_leading_component_still_wins_over_cx4_cx5():
    """The NCE quirk with an id entered: ^^1234567^X^PI — the id sits in a leading component,
    followed by the same authority/type codes. The id is taken; X and PI are not."""
    message = (
        "MSH|^~\\&|NCE|HOSP|HIS|HOSP|20260903160934+0400||ORU^R01^ORU_R01|X1|P|2.5\r"
        "PID|||^^yatak-77^X^PI\r"
        "OBX|1|NM|heart_rate||88|bpm|||||F|||20260903160934+0400\r"
    )
    assert parse_hl7_oru(message)[0].patient_id == "yatak-77"


def test_a_senders_utc_offset_is_honoured_not_stripped():
    """NCE stamps OBX-14 and MSH-7 with +0400 (Baku). Stripping the offset read 16:09 Baku as
    16:09 UTC -- four hours in the future -- and the identity slice orders records and expires
    cards on the same parser. No offset still means UTC, the convention every gateway shares."""
    from homunculus.gateway.hl7 import _parse_hl7_ts

    message = (
        "MSH|^~\\&|NCE|HOSP|HIS|HOSP|20260903160934+0400||ORU^R01^ORU_R01|X1|P|2.5\r"
        "PID|||yatak-77\r"
        "OBX|1|NM|heart_rate||88|bpm|||||F|||20260903160934+0400\r"
    )
    assert parse_hl7_oru(message)[0].timestamp == datetime(2026, 9, 3, 12, 9, 34, tzinfo=timezone.utc)
    assert _parse_hl7_ts("20260903160934-0500") == datetime(2026, 9, 3, 21, 9, 34, tzinfo=timezone.utc)
    assert _parse_hl7_ts("20260903160934") == datetime(2026, 9, 3, 16, 9, 34, tzinfo=timezone.utc)
    assert _parse_hl7_ts("20260903160934.1234+0400") == datetime(2026, 9, 3, 12, 9, 34, tzinfo=timezone.utc)
    assert _parse_hl7_ts("202609031609+0400") == datetime(2026, 9, 3, 12, 9, tzinfo=timezone.utc)
    assert _parse_hl7_ts("") is None and _parse_hl7_ts("not-a-time") is None
