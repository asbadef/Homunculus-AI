from medibus.messages import (
    Alarm, DeviceId, Reading, numeric, parse_alarms, parse_device_id, parse_measured,
    parse_settings,
)


def test_measured_data_from_the_spec_example():
    # SOH 24H 'E' 'B' ' ' '9' '8' ' ' 'E' '1' ' ' '7' '0' ' ' -> O2 SAT 98, PULSE 70
    readings = parse_measured(b"EB 98 E1 70 ")
    assert readings == [Reading("EB", " 98 "), Reading("E1", " 70 ")]
    assert [numeric(r) for r in readings] == [98.0, 70.0]


def test_measured_data_keeps_decimals_negatives_and_leading_spaces():
    readings = parse_measured(b"78  -2" + b"820.45" + b"F0 40 ")
    assert numeric(readings[0]) == -2.0
    assert readings[1].code == "82" and numeric(readings[1]) == 0.45
    assert numeric(readings[2]) == 40.0


def test_non_numeric_values_are_kept_raw_and_yield_none():
    [r] = parse_measured(b"D6----")
    assert r.raw == "----" and numeric(r) is None
    [blank] = parse_measured(b"EB    ")
    assert numeric(blank) is None


def test_measured_codes_are_uppercased_hex_strings():
    assert parse_measured(b"eb 98 ")[0].code == "EB"


def test_trailing_partial_record_is_dropped():
    assert parse_measured(b"EB 98 E1") == [Reading("EB", " 98 ")]


def test_empty_payload_means_no_readings():
    assert parse_measured(b"") == []


def test_settings_use_five_character_values():
    readings = parse_settings(b"01  40 0B  5.0")
    assert readings == [Reading("01", "  40 "), Reading("0B", "  5.0")]
    assert [numeric(r) for r in readings] == [40.0, 5.0]


def test_alarms_decode_priority_code_and_phrase():
    # priority byte = value + 30H: 'N' (4EH) -> 30, '5' -> 5; then 2-char code, 12-char phrase
    payload = b"\x4e10PAW HIGH    " + b"510CO2 ALRM OFF"
    alarms = parse_alarms(payload)
    assert alarms == [Alarm(30, "10", "PAW HIGH"), Alarm(5, "10", "CO2 ALRM OFF")]


def test_device_id_pc_example_from_the_spec():
    assert parse_device_id(b"0161'My PC'01.00:03.00") == DeviceId("0161", "My PC", "01.00", "03.00")


def test_device_id_tolerates_spaces_in_the_name_and_around_fields():
    assert parse_device_id(b"8240'Evita 4 '04.00:04.00") == DeviceId("8240", "Evita 4", "04.00", "04.00")
    assert parse_device_id(b"8250 'Savina' 01.00 04.00") == DeviceId("8250", "Savina", "01.00", "04.00")


def test_device_id_of_an_empty_response_is_none():
    assert parse_device_id(b"") is None
    assert parse_device_id(b"garbage") is None
