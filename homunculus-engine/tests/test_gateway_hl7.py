# tests/test_gateway_hl7.py
from datetime import datetime

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
    assert o.timestamp == datetime(2026, 7, 16, 14, 30, 0)


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
    assert obs[0].timestamp == datetime(2026, 7, 16, 14, 30, 0)


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
