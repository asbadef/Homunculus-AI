"""Synthetic record tests. No capture, no monitor traffic, no patient values."""
import pytest

from homunculus.edge.infinity_records import (
    BPM, CELSIUS, MMHG, PARAMETERS, PERCENT, RECORD_SIZE, find_array, parse_payload,
    read_record,
)

HR, PLS, SPO2, TEMPERATURE, ART_SYS = 0x0101, 0x1905, 0x190E, 0x1A0B, 0x0308


def record(identifier, value, *, unit=None, low=0, high=1000, valid=True):
    """Build one synthetic record; `value` and the limits are raw, pre-scale."""
    data = bytearray(RECORD_SIZE)
    data[0:2] = value.to_bytes(2, "big")
    data[2:4] = high.to_bytes(2, "big", signed=True)
    data[4:6] = low.to_bytes(2, "big", signed=True)
    data[20:22] = identifier.to_bytes(2, "big")
    data[22] = 0 if valid else 1
    data[24] = PARAMETERS[identifier][1] if unit is None else unit
    return bytes(data)


def test_a_well_formed_record_carries_value_unit_and_limits():
    found = read_record(record(HR, 72, low=45, high=130), 0)
    assert found["name"] == "hr" and found["value"] == 72 and found["unit"] == "bpm"
    assert (found["alarm_low"], found["alarm_high"]) == (45, 130)
    assert found["valid"] and found["evidence"] == "display_verified"


def test_hr_is_the_screens_ecg_rate_and_pls_the_spo2_pulse():
    # Confirmed 2026-10-27 on a bedside capture with video where the two rates differed: 0x0101 is the
    # rate the screen shows as HR (ECG), 0x1905 the one it shows as PLS (SpO2 pulse). Swapped until R6.
    assert (PARAMETERS[0x0101][0], PARAMETERS[0x1905][0]) == ("hr", "pls")
    ecg, pulse = read_record(record(HR, 88), 0), read_record(record(PLS, 67), 0)
    assert (ecg["name"], ecg["value"], pulse["name"], pulse["value"]) == ("hr", 88, "pls", 67)
    assert ecg["unit"] == pulse["unit"] == "bpm"


def test_an_unknown_parameter_is_not_a_record():
    assert read_record(record(HR, 72).replace(HR.to_bytes(2, "big"), b"\xab\xcd"), 0) is None


def test_a_known_parameter_wearing_the_wrong_unit_is_rejected():
    # Without this the alignment search reports a temperature in beats per minute, which is
    # how a reader stops being evidence: the number looks like data and is not.
    assert read_record(record(TEMPERATURE, 369, unit=BPM), 0) is None
    assert read_record(record(HR, 72, unit=CELSIUS), 0) is None
    assert read_record(record(ART_SYS, 120, unit=PERCENT), 0) is None


def test_inverted_alarm_limits_mean_this_is_not_a_record():
    assert read_record(record(HR, 72, low=200, high=40), 0) is None


def test_an_invalid_record_reports_no_value_but_still_reports_itself():
    # The monitor shows *** for these. "The device has no reading" and "this device does
    # not measure that" are different statements and the screen makes both.
    found = read_record(record(SPO2, 4, valid=False), 0)
    assert found["name"] == "spo2" and found["valid"] is False and found["value"] is None
    assert found["alarm_high"] == 1000


def test_temperature_scales_by_ten_including_its_limits():
    found = read_record(record(TEMPERATURE, 369, low=340, high=390), 0)
    assert found["value"] == pytest.approx(36.9)
    assert (found["alarm_low"], found["alarm_high"]) == (pytest.approx(34.0), pytest.approx(39.0))


def test_the_airway_respiration_id_is_flagged_unverified():
    # No observed bed displayed it, so it must not claim the same standing as the rest.
    assert read_record(record(0x1F06, 18), 0)["evidence"] == "unverified_layout"


def test_the_array_spans_marker_records_it_cannot_decode():
    payload = b"\x00" * 11 + record(HR, 70) + bytes(RECORD_SIZE) + record(SPO2, 97)
    assert find_array(payload) == [11, 11 + RECORD_SIZE, 11 + 2 * RECORD_SIZE]
    found = parse_payload(payload)
    assert set(found) == {"hr", "spo2"} and found["spo2"]["value"] == 97


def test_a_valid_reading_is_not_erased_by_a_later_invalid_copy():
    payload = record(HR, 70) + record(HR, 4, valid=False)
    assert parse_payload(payload)["hr"]["value"] == 70


def test_an_invalid_copy_is_replaced_by_a_valid_one_later_in_the_payload():
    payload = record(HR, 4, valid=False) + record(HR, 70)
    assert parse_payload(payload)["hr"]["value"] == 70


def test_a_truncated_tail_is_never_read_past_the_end():
    payload = record(HR, 70) + record(SPO2, 97)[:20]
    assert find_array(payload) == [0]
    assert set(parse_payload(payload)) == {"hr"}
    assert read_record(payload, len(payload) - 4) is None


def test_a_payload_without_records_yields_nothing():
    assert find_array(bytes(500)) == [] and parse_payload(bytes(500)) == {}
    assert find_array(b"") == [] and parse_payload(b"") == {}


def test_an_implausibly_long_array_is_refused():
    payload = record(HR, 70) + bytes(RECORD_SIZE * 80) + record(SPO2, 97)
    assert find_array(payload) == []


def test_every_parameter_declares_a_unit_the_reader_knows():
    from homunculus.edge.infinity_records import UNITS
    assert all(unit in UNITS for _, unit, _, _ in PARAMETERS.values())
    names = [name for name, _, _, _ in PARAMETERS.values()]
    assert len(names) == len(set(names))
