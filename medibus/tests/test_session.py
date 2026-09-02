"""The protocol life-cycle, driven with a fake clock. Rules referenced are from the Dräger
MEDIBUS protocol definition Rev 6.00 ("Initializing Communication", "Time-Out", "MEDIBUS
Life-Cycle", FAQ)."""
from medibus.framing import CAN, DC1, DC3, checksum, encode_command, encode_response
from medibus.messages import DeviceId, Reading
from medibus.session import (
    ALARMS_CP1, DATA_CP1, DATA_CP2, DEVICE_ID, ICC, NOP, SETTINGS, STOP, Alarms, Connected,
    CorruptFrame, Disconnected, Measured, Session, SessionConfig, Settings, State,
)

ICC_CMD = encode_command(ICC)
ICC_RSP = encode_response(ICC)
NOP_CMD = encode_command(NOP)
DATA_CMD = encode_command(DATA_CP1)
DEVID_CMD = encode_command(DEVICE_ID)
EVITA_ID = encode_response(DEVICE_ID, b"8240'Evita 4'04.00:04.00")


def connect(session: Session, now: float = 0.0) -> float:
    """Bring a fresh session to ACTIVE the way a real device would, returning the clock."""
    session.tick(now)
    assert session.outgoing() == ICC_CMD
    session.receive(ICC_RSP, now + 0.1)
    session.tick(now + 0.1)
    assert session.outgoing() == DEVID_CMD
    session.receive(EVITA_ID, now + 0.2)
    session.tick(now + 0.2)
    session.events()
    return now + 0.2


def test_starts_by_sending_icc_and_repeats_every_3s_while_silent():
    s = Session(SessionConfig())
    s.tick(0.0)
    assert s.outgoing() == ICC_CMD
    assert s.state is State.INITIALISING
    s.tick(2.9)
    assert s.outgoing() == b""
    s.tick(3.0)
    assert s.outgoing() == ICC_CMD
    s.tick(6.0)
    assert s.outgoing() == ICC_CMD


def test_icc_echo_then_device_id_then_connected_event():
    s = Session(SessionConfig())
    s.tick(0.0)
    s.outgoing()
    s.receive(ICC_RSP, 0.1)
    s.tick(0.1)
    assert s.state is State.ACTIVE
    assert s.outgoing() == DEVID_CMD
    s.receive(EVITA_ID, 0.2)
    s.tick(0.2)
    assert s.events() == [Connected(DeviceId("8240", "Evita 4", "04.00", "04.00"))]
    assert s.device == DeviceId("8240", "Evita 4", "04.00", "04.00")


def test_device_initiated_icc_is_answered_and_activates_the_session():
    s = Session(SessionConfig())
    s.receive(ICC_CMD, 0.0)
    s.tick(0.0)
    out = s.outgoing()
    assert out.startswith(ICC_RSP)
    assert s.state is State.ACTIVE


def test_embedded_device_id_request_in_icc_response_is_answered_with_0161():
    s = Session(SessionConfig(device_name="Homunculus", device_revision="01.00",
                              medibus_revision="06.00"))
    s.tick(0.0)
    s.outgoing()
    stream = b"\x01\x51" + DEVID_CMD + checksum(b"\x01\x51") + b"\x0d"
    s.receive(stream, 0.1)
    s.tick(0.1)
    out = s.outgoing()
    expected = encode_response(DEVICE_ID, b"0161'Homunculus'01.00:06.00")
    assert out.startswith(expected)
    # ...and our own device-ID request is HELD for ~200 ms after that response (spec FAQ).
    assert DEVID_CMD not in out
    s.tick(0.25)
    s.tick(0.31)
    assert s.outgoing() == DEVID_CMD


def test_polls_measured_data_every_2s_once_active():
    s = Session(SessionConfig(poll_interval=2.0))
    t = connect(s)
    assert s.outgoing() == DATA_CMD
    payload = b"EB 98 E1 70 "
    s.receive(encode_response(DATA_CP1, payload), t + 0.1)
    s.tick(t + 0.1)
    assert s.events() == [Measured(1, [Reading("EB", " 98 "), Reading("E1", " 70 ")], t + 0.1)]
    s.tick(t + 1.0)
    assert s.outgoing() == b""
    s.tick(t + 2.0)
    assert s.outgoing() == DATA_CMD


def test_optional_polls_follow_the_measured_data_one_at_a_time():
    s = Session(SessionConfig(poll_codepage2=True, poll_settings=True, poll_alarms=True))
    t = connect(s)
    assert s.outgoing() == DATA_CMD
    s.tick(t + 0.5)
    assert s.outgoing() == b""                      # one command in flight at a time
    s.receive(encode_response(DATA_CP1), t + 0.5)
    s.tick(t + 0.5)
    assert s.outgoing() == encode_command(DATA_CP2)
    s.receive(encode_response(DATA_CP2, b"EB 97 "), t + 0.6)
    s.tick(t + 0.6)
    assert s.outgoing() == encode_command(SETTINGS)
    s.receive(encode_response(SETTINGS, b"01  40 "), t + 0.7)
    s.tick(t + 0.7)
    assert s.outgoing() == encode_command(ALARMS_CP1)
    s.receive(encode_response(ALARMS_CP1, b"\x4e10PAW HIGH    "), t + 0.8)
    s.tick(t + 0.8)
    kinds = [type(e) for e in s.events()]
    assert kinds == [Measured, Measured, Settings, Alarms]


def test_nop_keeps_the_link_alive_when_idle():
    s = Session(SessionConfig(poll_interval=10.0))
    t = connect(s)
    s.outgoing()                                     # first poll
    s.receive(encode_response(DATA_CP1), t + 0.1)
    s.tick(t + 0.1)
    s.tick(t + 1.5)
    assert s.outgoing() == b""
    s.tick(t + 2.2)
    assert s.outgoing() == NOP_CMD
    s.receive(encode_response(NOP), t + 2.3)
    s.tick(t + 4.4)
    assert s.outgoing() == NOP_CMD


def test_device_nop_is_answered():
    s = Session(SessionConfig())
    t = connect(s)
    s.outgoing()
    s.receive(NOP_CMD, t + 0.5)
    s.tick(t + 0.5)
    assert s.outgoing() == encode_response(NOP)


def test_silence_for_3s_drops_the_link_and_reinitialises():
    s = Session(SessionConfig())
    t = connect(s)
    s.outgoing()
    s.tick(t + 3.0)
    assert s.events() == [Disconnected("silence")]
    assert s.state is State.INITIALISING
    assert s.outgoing() == ICC_CMD


def test_no_response_for_10s_retries_three_times_then_reinitialises():
    s = Session(SessionConfig(poll_interval=100.0))
    t = connect(s)
    assert s.outgoing() == DATA_CMD
    for n in range(1, 4):
        # keep the device audibly present (NOPs) so only the 10 s rule fires
        s.receive(NOP_CMD, t + 10.0 * n - 1)
        s.outgoing()
        s.tick(t + 10.0 * n)
        assert s.outgoing() == DATA_CMD, f"retry {n}"
    s.receive(NOP_CMD, t + 39.0)
    s.outgoing()
    s.tick(t + 40.0)
    assert s.events()[-1] == Disconnected("no response")
    assert s.outgoing() == ICC_CMD


def test_stop_from_device_is_answered_and_returns_to_idle():
    s = Session(SessionConfig())
    t = connect(s)
    s.outgoing()
    s.receive(encode_command(STOP), t + 0.5)
    s.tick(t + 0.5)
    assert s.outgoing() == encode_response(STOP)
    assert s.state is State.IDLE
    assert s.events() == [Disconnected("stop")]
    s.tick(t + 1.0)
    assert s.outgoing() == b""                       # do not hammer a device that said stop
    s.tick(t + 3.6)
    assert s.outgoing() == ICC_CMD


def test_corrupt_command_gets_nak_and_corrupt_response_is_retried():
    s = Session(SessionConfig(poll_interval=100.0))
    t = connect(s)
    assert s.outgoing() == DATA_CMD
    s.receive(b"\x1b\x30\x34\x43\x0d", t + 0.1)     # NOP with a wrong checksum
    s.tick(t + 0.1)
    assert s.outgoing() == b"\x01\x15\x31\x36\x0d"
    s.receive(b"\x01\x24\x32\x36\x0d", t + 0.2)     # data response with a wrong checksum
    s.tick(t + 0.2)
    assert s.outgoing() == DATA_CMD
    assert s.events() == [CorruptFrame("command"), CorruptFrame("response")]


def test_unknown_command_gets_an_empty_echo_response():
    s = Session(SessionConfig())
    t = connect(s)
    s.outgoing()
    s.receive(encode_command(0x49), t + 0.1)         # "time changed"
    s.tick(t + 0.1)
    assert s.outgoing() == encode_response(0x49)


def test_dc1_suspends_output_until_dc3_or_3s():
    s = Session(SessionConfig(poll_interval=100.0))
    t = connect(s)
    s.outgoing()
    s.receive(encode_response(DATA_CP1), t + 0.1)
    s.receive(DC1, t + 0.2)
    s.tick(t + 2.5)                                  # a NOP would be due
    assert s.outgoing() == b""
    s.receive(DC3, t + 2.6)
    s.tick(t + 2.6)
    assert s.outgoing() == NOP_CMD
    s.receive(encode_response(NOP), t + 2.7)
    s.receive(DC1, t + 2.8)
    s.tick(t + 5.0)
    assert s.outgoing() == b""
    s.receive(NOP_CMD, t + 5.85)                     # device still there, still suspended
    s.tick(t + 5.9)                                  # 3 s after DC1: suspension expires
    assert s.outgoing() != b""


def test_can_aborts_the_command_in_flight():
    s = Session(SessionConfig(poll_interval=100.0))
    t = connect(s)
    assert s.outgoing() == DATA_CMD
    s.receive(CAN, t + 0.1)
    s.tick(t + 2.2)
    assert s.outgoing() == NOP_CMD                   # nothing in flight any more


def test_measured_response_when_nothing_in_flight_is_still_used():
    s = Session(SessionConfig(poll_interval=100.0))
    t = connect(s)
    s.outgoing()
    s.receive(encode_response(DATA_CP1), t + 0.1)
    s.receive(encode_response(DATA_CP1, b"EB 98 "), t + 0.2)
    s.tick(t + 0.2)
    assert [type(e) for e in s.events()] == [Measured, Measured]


def test_stop_request_from_our_side():
    s = Session(SessionConfig())
    t = connect(s)
    s.outgoing()
    s.stop(t + 0.1)
    assert s.outgoing() == encode_command(STOP)
    s.receive(encode_response(STOP), t + 0.2)
    s.tick(t + 0.2)
    assert s.state is State.IDLE and s.events() == [Disconnected("stopped")]
    s.tick(t + 30.0)
    assert s.outgoing() == b""                       # a deliberate stop is final
