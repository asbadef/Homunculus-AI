import json
from datetime import datetime, timezone

import pytest
from homunculus.canonical import SignalCode

from medibus.bridge import MedibusBridge
from medibus.mapping import Entry, SiteMapping
from medibus.messages import Alarm, DeviceId, Reading
from medibus.session import Alarms, CommandSeen, Connected, CorruptFrame, Disconnected, Measured, \
    Settings

MAPPING = {
    "device": "Evita 4",
    "codepage1": {
        "EB": {"signal": "spo2", "unit": "%"},
        "E1": {"signal": "heart_rate", "unit": "/min"},
        "F0": {"signal": "fio2", "unit": "fraction", "scale": 0.01, "verified": False},
    },
    "codepage2": {"EB": {"signal": "spo2", "unit": "%"}},
    "settings": {"01": {"signal": "fio2", "unit": "fraction", "scale": 0.01}},
    "derived": {"on_resp_support": True},
}

T0 = datetime(2026, 9, 2, 10, 0, tzinfo=timezone.utc)


def make_bridge(mapping=MAPPING, **kw):
    sent = []
    bridge = MedibusBridge(send=sent.append, mapping=SiteMapping.from_dict(mapping),
                           patient_id="P-1", clock=lambda: T0, **kw)
    return bridge, sent


def test_mapping_loads_from_file_and_validates_signals(tmp_path):
    path = tmp_path / "m.json"
    path.write_text(json.dumps(MAPPING), encoding="utf-8")
    mapping = SiteMapping.load(path)
    assert mapping.device == "Evita 4"
    assert mapping.codepage1["F0"] == Entry(SignalCode.FIO2, "fraction", 0.01)
    assert mapping.codepage2["EB"].signal is SignalCode.SPO2
    assert mapping.on_resp_support is True


def test_mapping_rejects_unknown_signal_and_bad_code():
    with pytest.raises(ValueError, match="no_such_signal"):
        SiteMapping.from_dict({"codepage1": {"EB": {"signal": "no_such_signal", "unit": "%"}}})
    with pytest.raises(ValueError, match="'XYZ'"):
        SiteMapping.from_dict({"codepage1": {"XYZ": {"signal": "spo2", "unit": "%"}}})


def test_mapping_codes_are_normalised_to_uppercase():
    mapping = SiteMapping.from_dict({"codepage1": {"eb": {"signal": "spo2", "unit": "%"}}})
    assert "EB" in mapping.codepage1


def test_empty_mapping_is_valid_discovery_configuration():
    mapping = SiteMapping.from_dict({})
    assert mapping.codepage1 == {} and mapping.on_resp_support is False


def test_measured_event_becomes_observations_with_patient_and_utc_time():
    bridge, sent = make_bridge()
    bridge.handle(Connected(DeviceId("8240", "Evita 4", "04.00", "04.00")))
    obs = bridge.handle(Measured(1, [Reading("EB", " 98 "), Reading("E1", " 70 "),
                                     Reading("F0", " 40 ")], 12.5))
    by_code = {o.code: o for o in obs}
    assert by_code[SignalCode.SPO2].value == 98.0 and by_code[SignalCode.SPO2].unit == "%"
    assert by_code[SignalCode.HEART_RATE].value == 70.0
    assert by_code[SignalCode.FIO2].value == pytest.approx(0.40)
    assert by_code[SignalCode.ON_RESP_SUPPORT].value == 1.0
    assert all(o.patient_id == "P-1" and o.timestamp == T0 for o in obs)
    assert all(o.source_device == "medibus" for o in obs)
    assert len(sent) == 4
    assert sent[0]["resourceType"] == "Observation"
    assert sent[0]["subject"] == {"reference": "Patient/P-1"}


def test_codepage2_and_settings_use_their_own_tables():
    bridge, sent = make_bridge()
    obs2 = bridge.handle(Measured(2, [Reading("EB", " 97 ")], 1.0))
    assert [o.code for o in obs2] == [SignalCode.SPO2]           # no on_resp_support from cp2
    obs_s = bridge.handle(Settings([Reading("01", "  40 ")], 1.0))
    assert [(o.code, o.value) for o in obs_s] == [(SignalCode.FIO2, pytest.approx(0.40))]


def test_unmapped_and_non_numeric_readings_are_counted_not_emitted():
    bridge, sent = make_bridge()
    obs = bridge.handle(Measured(1, [Reading("78", "  -2"), Reading("EB", "----"),
                                     Reading("82", "0.45")], 1.0))
    assert [o.code for o in obs] == [SignalCode.ON_RESP_SUPPORT]
    assert bridge.stats.unmapped == {"cp1:78": 1, "cp1:82": 1}
    assert bridge.stats.non_numeric == {"cp1:EB": 1}
    assert bridge.stats.formats["cp1:78"] == "-d"
    assert bridge.stats.formats["cp1:82"] == "d.dd"


def test_empty_poll_emits_nothing_not_even_resp_support():
    bridge, sent = make_bridge()
    assert bridge.handle(Measured(1, [], 1.0)) == ()
    assert sent == []


def test_resp_support_is_off_when_not_configured():
    mapping = dict(MAPPING, derived={"on_resp_support": False})
    bridge, sent = make_bridge(mapping)
    obs = bridge.handle(Measured(1, [Reading("EB", " 98 ")], 1.0))
    assert [o.code for o in obs] == [SignalCode.SPO2]


def test_discovery_report_lists_codes_and_formats_without_values():
    bridge, _ = make_bridge()
    bridge.handle(Measured(1, [Reading("78", "  -2"), Reading("EB", "----"), Reading("D6", " 18 ")], 1.0))
    bridge.handle(Measured(1, [Reading("78", "  -3")], 3.0))
    report = bridge.discovery_report()
    assert "cp1:78" in report and "x2" in report and "-d" in report
    assert "cp1:D6" in report
    assert "cp1:EB" in report and "non-numeric" in report
    for value in ("-2", "-3", "18"):
        assert value not in report


def test_alarms_connections_and_oddities_are_counted():
    bridge, _ = make_bridge()
    bridge.handle(Connected(DeviceId("8240", "Evita 4", "04.00", "04.00")))
    bridge.handle(Alarms(1, [Alarm(30, "10", "PAW HIGH")], 1.0))
    bridge.handle(Disconnected("silence"))
    bridge.handle(CommandSeen(0x49))
    bridge.handle(CorruptFrame("response"))
    s = bridge.stats
    assert s.connects == 1 and s.disconnects == 1
    assert s.alarms == {"10 PAW HIGH": 1}
    assert s.unknown_commands == {"49": 1} and s.corrupt == 1
    assert bridge.device_label == "Evita 4 (8240) 04.00/MEDIBUS 04.00"


def test_source_device_can_carry_the_bed_label():
    bridge, sent = make_bridge(source_device="medibus/BED07")
    bridge.handle(Measured(1, [Reading("EB", " 98 ")], 1.0))
    assert sent[0]["device"] == {"display": "medibus/BED07"}


def test_patient_id_is_required():
    with pytest.raises(ValueError):
        MedibusBridge(send=lambda p: None, mapping=SiteMapping.from_dict({}), patient_id="")
