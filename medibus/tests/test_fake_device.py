from medibus.fake_device import FakeDevice
from medibus.framing import StreamParser, encode_command, encode_response
from medibus.messages import parse_measured
from medibus.session import DATA_CP1, DEVICE_ID, ICC, NOP, STOP


def test_fake_device_starts_with_icc_and_repeats_it():
    d = FakeDevice()
    d.tick(0.0)
    assert d.outgoing() == encode_command(ICC)
    d.tick(1.0)
    assert d.outgoing() == b""
    d.tick(3.0)
    assert d.outgoing() == encode_command(ICC)


def test_fake_device_embeds_device_id_request_in_its_icc_response():
    d = FakeDevice()
    d.receive(encode_command(ICC), 0.0)
    frames = StreamParser().feed(d.outgoing())
    assert [(f.kind, f.code, f.checksum_ok) for f in frames] == [
        ("command", DEVICE_ID, True), ("response", ICC, True)]
    assert d.active


def test_fake_device_answers_data_requests_with_its_table():
    d = FakeDevice(readings={"EB": " 98 ", "E1": " 70 "})
    d.receive(encode_command(ICC), 0.0)
    d.outgoing()
    d.receive(encode_command(DATA_CP1), 0.1)
    [frame] = StreamParser().feed(d.outgoing())
    assert frame.code == DATA_CP1 and frame.checksum_ok
    assert [(r.code, r.raw) for r in parse_measured(frame.payload)] == [("EB", " 98 "), ("E1", " 70 ")]


def test_fake_device_identifies_itself_and_records_the_pc_identity():
    d = FakeDevice()
    d.receive(encode_command(ICC), 0.0)
    d.outgoing()
    d.receive(encode_response(DEVICE_ID, b"0161'Homunculus'01.00:06.00"), 0.1)
    assert d.pc_identity == "0161'Homunculus'01.00:06.00"
    d.receive(encode_command(DEVICE_ID), 0.2)
    assert d.outgoing() == encode_response(DEVICE_ID, b"8240'Evita 4'04.00:04.00")


def test_fake_device_sends_nop_when_the_pc_is_quiet_and_reinitialises_on_silence():
    d = FakeDevice()
    d.receive(encode_command(ICC), 0.0)
    d.outgoing()
    d.receive(encode_response(DEVICE_ID), 0.1)
    d.tick(2.2)
    assert d.outgoing() == encode_command(NOP)
    d.tick(3.2)
    assert d.outgoing() == encode_command(ICC)
    assert not d.active


def test_fake_device_can_corrupt_and_add_realtime_noise():
    d = FakeDevice(readings={"EB": " 98 "}, corrupt_every=2, realtime_noise=True)
    d.receive(encode_command(ICC), 0.0)
    d.outgoing()
    d.receive(encode_command(DATA_CP1), 0.1)
    raw = d.outgoing()
    assert any(b >= 0x80 for b in raw)
    [frame] = StreamParser().feed(raw)
    assert frame.checksum_ok
    d.receive(encode_command(DATA_CP1), 0.2)
    [frame] = StreamParser().feed(d.outgoing())
    assert not frame.checksum_ok


def test_fake_device_stops_on_stop():
    d = FakeDevice()
    d.receive(encode_command(ICC), 0.0)
    d.outgoing()
    d.receive(encode_command(STOP), 0.1)
    assert d.outgoing() == encode_response(STOP)
    d.tick(10.0)
    assert d.outgoing() == b""
