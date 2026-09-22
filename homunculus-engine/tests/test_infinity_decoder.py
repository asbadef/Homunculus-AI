"""Synthetic protocol shapes only; no recorded patient values or bytes."""
import hashlib
import importlib.util
from pathlib import Path
import socket
import struct
import time

import pytest
from fastapi.testclient import TestClient

from homunculus.edge.infinity_decoder import NAMES, ResearchDecoder, load_recording, validate_profile
from homunculus.edge.infinity_replay import MeasurementState, create_replay_app
from homunculus.edge.infinity_stream import Inventory, packet_event


def inventory():
    return Inventory.parse({"collector_id": "synthetic", "interface": "192.0.2.200/24", "devices": [
        {"id": "synthetic-1", "source": "192.0.2.1", "group": "239.20.1.1", "port": 2050}]})


def profile():
    return {"schema": "homunculus.infinity.decoder-profile.v2", "id": "synthetic",
        "source_ip": "192.0.2.1", "group": "239.20.1.1", "source_port": 2564, "port": 2050,
        "capture_sha256": "a" * 64, "ignored_lengths": [4], "layouts": [
            {"length": 18, "fields": [{"name": name, "offset": 4 + i*6,
                "guard_offset": i*6, "guard_hex": "41424344"} for i, name in enumerate(NAMES[:3])]},
            {"length": 6, "fields": [{"name": NAMES[3], "offset": 4, "guard_offset": 0,
                                      "guard_hex": "45464748"}]}]}


def event(payload, **kwargs):
    inv = inventory()
    return packet_event(inv, inv.devices[0], payload, 2564, retain_payload=True,
                        mode=kwargs.pop("mode", "replay"), received_at=1000, **kwargs)


def test_layouts_and_fail_closed():
    decoder = ResearchDecoder(profile(), inventory())
    assert decoder.decode(event(b"ABCD\x00\x11" * 3)) == ("decoded", dict.fromkeys(NAMES[:3], 17))
    assert decoder.decode(event(b"EFGH\x00\x22")) == ("decoded", {NAMES[3]: 34})
    assert decoder.decode(event(b"NONE")) == ("ignored", {})
    for raw in [b"EFGH\x00", b"XFGH\x00\x22", b"UNKNOWN", b"ABCD\x00\x11"*2+b"XBCD\x00\x11"]:
        assert decoder.decode(event(raw)) == ("rejected", {})
    assert decoder.decode(event(b"EFGH\x00\x22", mode="live"))[0] == "rejected"
    wrong = event(b"EFGH\x00\x22")
    wrong["source_port"] = 2565
    assert decoder.decode(wrong)[0] == "rejected"
    wrong["source_ip"] = "192.0.2.99"
    assert decoder.decode(wrong)[0] == "rejected"
    wrong = event(b"EFGH\x00\x22")
    wrong["sha256"] = "0" * 64
    assert decoder.decode(wrong)[0] == "rejected"


@pytest.mark.parametrize("change", [
    lambda p: p["layouts"][0]["fields"][0].update(offset=19),
    lambda p: p["layouts"][0]["fields"][0].update(guard_hex="01"),
    lambda p: p["layouts"][0]["fields"][0].update(name=NAMES[1]),
    lambda p: p.update(ignored_lengths=[18]),
    lambda p: p.update(capture_sha256=""),
    lambda p: p.update(live_allowed=True),
])
def test_invalid_profile(change):
    value = profile()
    change(value)
    with pytest.raises(ValueError):
        validate_profile(value)


def partial_profile():
    value = profile()
    value['schema'] = 'homunculus.infinity.decoder-profile.v3'
    value['layouts'][0]['fields'] = [value['layouts'][0]['fields'][1]]
    value['layouts'] = value['layouts'][:1]
    value['unmapped_fields'] = [NAMES[0], NAMES[2], NAMES[3]]
    return value


def test_partial_mapping_never_manufactures_other_measurements():
    decoder = ResearchDecoder(partial_profile(), inventory())
    assert decoder.decode(event(b'ABCD\x00\x11' * 3)) == ('decoded', {NAMES[1]: 17})
    assert decoder.decode(event(b'ABCD\x00\x11XBCD\x00\x11ABCD\x00\x11')) == ('rejected', {})
    value = partial_profile()
    value['schema'] = 'homunculus.infinity.decoder-profile.v2'
    del value['unmapped_fields']
    with pytest.raises(ValueError):
        validate_profile(value)  # The v2 full mapping contract is unchanged.


@pytest.mark.parametrize('unmapped', [[], [NAMES[0]], list(NAMES),
    [NAMES[0], NAMES[2], NAMES[3], NAMES[3]], [NAMES[0], NAMES[2], 'unknown'], [None]])
def test_partial_profile_requires_complete_disjoint_field_accounting(unmapped):
    value = partial_profile()
    value['unmapped_fields'] = unmapped
    with pytest.raises(ValueError):
        validate_profile(value)


def test_per_field_age_duplicate_order_and_reset():
    clock = [0]
    state = MeasurementState("192.0.2.1", "synthetic", clock=lambda: clock[0])
    gen = state.generation
    state.publish({"id": "a", "epoch": 1000, "values": {NAMES[3]: 34}}, gen)
    clock[0] = 2
    state.publish({"id": "b", "epoch": 1002, "values": dict.fromkeys(NAMES[:3], 17)}, gen)
    assert state.snapshot()["status"] == "streaming"
    clock[0] = 3.1
    assert not state.publish({"id": "a", "epoch": 1003, "values": {NAMES[3]: 34}}, gen)
    assert not state.publish({"id": "c", "epoch": 1001, "values": {NAMES[3]: 34}}, gen)
    snap = state.snapshot()
    assert snap["status"] == "partial"
    assert snap["fields"][NAMES[3]]["value"] is None
    assert snap["fields"][NAMES[0]]["value"] == 17
    # Same number in a genuinely later packet is still a new update.
    state.publish({"id": "d", "epoch": 1003, "values": {NAMES[3]: 34}}, gen)
    assert state.snapshot()["fields"][NAMES[3]]["capture_epoch"] == 1003
    state.reset()
    assert not state.publish({"id": "late", "epoch": 1004, "values": {NAMES[3]: 34}}, gen)
    assert all(f["value"] is None for f in state.snapshot()["fields"].values())


def test_non_numeric_packet_does_not_refresh_fields_and_end_hides_values():
    clock = [0]
    state = MeasurementState("192.0.2.1", "synthetic", clock=lambda: clock[0])
    gen = state.generation
    state.publish({"id": "a", "epoch": 1000, "values": dict.fromkeys(NAMES, 17)}, gen)
    clock[0] = 4
    state.publish({"id": "b", "epoch": 1004, "values": {}}, gen)
    assert state.snapshot()["status"] == "stale"
    assert state.snapshot()["packet_age_ms"] == 0
    state.clear("ended", gen)
    assert state.snapshot()["status"] == "ended"
    assert all(x["value"] is None for x in state.snapshot()["fields"].values())


def write_pcap(path):
    payload = b"ABCD\x00\x11" * 3
    raw = bytearray(20)
    raw[0], raw[9] = 0x45, 17
    raw[2:4] = struct.pack("!H", 28 + len(payload))
    raw[12:16] = socket.inet_aton("192.0.2.1")
    raw[16:20] = socket.inet_aton("239.20.1.1")
    raw += struct.pack("!HHHH", 2564, 2050, len(payload)+8, 0) + payload
    body = struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 101)
    body += struct.pack("<IIII", 1000, 250000, len(raw), len(raw)) + raw
    path.write_bytes(body)
    return hashlib.sha256(body).hexdigest()


def test_hash_gate_and_original_timestamp(tmp_path):
    path = tmp_path / "synthetic.pcap"
    p = profile()
    p["capture_sha256"] = write_pcap(path)
    rows, counts = load_recording(path, ResearchDecoder(p, inventory()))
    assert rows[0]["epoch"] == 1000.25
    assert set(rows[0]) == {"id", "epoch", "values"}
    assert counts == {"decoded": 1, "ignored": 0, "rejected": 0}
    path.write_bytes(path.read_bytes() + b"changed")
    with pytest.raises(ValueError, match="scope"):
        load_recording(path, ResearchDecoder(p, inventory()))


def test_auth_single_play_end_and_restart():
    state = MeasurementState("192.0.2.1", "synthetic")
    rows = [{"id": "a", "epoch": 1000, "values": dict.fromkeys(NAMES, 17)},
            {"id": "b", "epoch": 1000.05, "values": {}}]
    token = "synthetic-viewer-" + "a"*32
    with TestClient(create_replay_app(state, rows, token)) as client:
        assert client.get("/infinity-research/state").status_code == 401
        assert client.post("/infinity-research/restart").status_code == 401
        auth = {"Authorization": "Bearer " + token}
        response = client.get("/infinity-research/state", headers=auth)
        assert response.headers["cache-control"] == "no-store"
        deadline = time.monotonic() + 1
        while state.snapshot()["status"] != "ended" and time.monotonic() < deadline:
            time.sleep(.01)
        snap = client.get("/infinity-research/state", headers=auth).json()
        assert snap["status"] == "ended"
        assert all(x["value"] is None for x in snap["fields"].values())
        assert snap["clinical_ingest_enabled"] is False
        assert client.get("/ingest", headers=auth).status_code == 404
        generation = snap["replay_cycle"]
        assert client.post("/infinity-research/restart", headers=auth).status_code == 200
        assert state.generation == generation + 1


def test_passive_validation_filter_only_selected_complete_incoming_shape(tmp_path):
    location = Path(__file__).parents[1] / "scripts" / "capture_infinity_validation.py"
    spec = importlib.util.spec_from_file_location("capture_validation", location)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = tmp_path / "synthetic.pcap"
    write_pcap(path)
    raw = path.read_bytes()[40:]
    eth = b"\x00"*12 + b"\x08\x00" + raw
    pick = lambda frame: module.select_ipv4(frame, "192.0.2.1", "239.20.1.1")
    assert pick(eth) == raw
    assert pick(eth + b"padding") == raw
    assert pick(b"\x00"*12 + b"\x81\x00\x00\x01\x08\x00" + raw) == raw
    assert pick(b"\x00"*12 + b"\x88\xa8\x00\x01\x81\x00\x00\x02\x08\x00" + raw) == raw
    assert pick(eth[:-1]) is None
    assert pick(b"\x00"*12 + b"\x86\xdd" + raw) is None
    assert module.select_ipv4(eth, "192.0.2.2", "239.20.1.1") is None
    assert module.select_ipv4(eth, "192.0.2.1", "239.20.1.2") is None
    assert module.select_ipv4(eth, "192.0.2.1", "239.20.1.1", source_port=2565) is None
    fragmented = bytearray(eth)
    fragmented[20:22] = b"\x20\x00"
    assert pick(fragmented) is None


@pytest.mark.parametrize("bad_binding", [False, True])
def test_capture_socket_has_explicit_eth_protocol_before_ready(monkeypatch, bad_binding):
    location = Path(__file__).parents[1] / "scripts" / "capture_infinity_validation.py"
    spec = importlib.util.spec_from_file_location("capture_binding", location)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.socket, "AF_PACKET", 17, raising=False)

    class Socket:
        closed = False
        bound = None
        def setsockopt(self, *args): pass
        def bind(self, address):
            self.bound = address
            # Regression: zero is not a wildcard; older kernel retains zero here.
            assert address == ("ens3", 3)
        def getsockname(self): return ("ens3", 0 if bad_binding else self.bound[1], 0, 1, b"")
        def settimeout(self, seconds): assert seconds == .2
        def close(self): self.closed = True

    capture = Socket()
    def factory(family, kind, proto):
        assert family == 17 and kind == module.socket.SOCK_RAW and proto == 0
        return capture
    if bad_binding:
        with pytest.raises(RuntimeError, match="ETH_P_ALL"):
            module.open_capture_socket("ens3", socket_factory=factory)
        assert capture.closed
    else:
        assert module.open_capture_socket("ens3", socket_factory=factory) is capture
        assert not capture.closed
