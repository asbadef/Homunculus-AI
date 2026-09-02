"""Session <-> FakeDevice pumped through byte buffers on a simulated clock: the whole stack from
wire bytes to FHIR observations, with no hardware and no real time."""
from datetime import datetime, timezone

from homunculus.canonical import SignalCode

from medibus.bridge import MedibusBridge
from medibus.fake_device import FakeDevice
from medibus.mapping import SiteMapping
from medibus.session import Session, SessionConfig, State

MAPPING = SiteMapping.from_dict({
    "codepage1": {
        "EB": {"signal": "spo2", "unit": "%"},
        "E1": {"signal": "heart_rate", "unit": "/min"},
        "D6": {"signal": "resp_rate", "unit": "/min"},
        "F0": {"signal": "fio2", "unit": "fraction", "scale": 0.01},
    },
    "derived": {"on_resp_support": True},
})


def pump(session: Session, device: FakeDevice, bridge: MedibusBridge, seconds: float,
         start: float = 0.0, step: float = 0.05, latency_steps: int = 1) -> float:
    """Advance both ends, each byte taking `latency_steps` ticks to cross the wire."""
    to_device: list[bytes] = []
    to_pc: list[bytes] = []
    now = start
    steps = int(seconds / step)
    for _ in range(steps):
        session.tick(now)
        device.tick(now)
        to_device.append(session.outgoing())
        to_pc.append(device.outgoing())
        if len(to_device) > latency_steps:
            device.receive(to_device.pop(0), now)
            session.receive(to_pc.pop(0), now)
        for event in session.events():
            bridge.handle(event)
        now = round(now + step, 6)
    return now


def make(device: FakeDevice | None = None, **cfg):
    sent: list[dict] = []
    session = Session(SessionConfig(**cfg))
    device = device or FakeDevice()
    bridge = MedibusBridge(send=sent.append, mapping=MAPPING, patient_id="P-9",
                           clock=lambda: datetime(2026, 9, 2, tzinfo=timezone.utc))
    return session, device, bridge, sent


def test_full_life_cycle_produces_observations():
    session, device, bridge, sent = make()
    pump(session, device, bridge, seconds=10.0)
    assert session.state is State.ACTIVE
    assert session.device is not None and session.device.name == "Evita 4"
    assert device.pc_identity == "0161'Homunculus'01.00:06.00"
    assert bridge.stats.connects == 1 and bridge.stats.disconnects == 0
    # ~2 s polling for ~10 s -> 4-5 polls, each with 4 mapped codes + on_resp_support
    assert 3 <= bridge.stats.polls <= 6
    codes = {o["code"]["coding"][0]["code"] for o in sent}
    assert codes == {"spo2", "heart_rate", "resp_rate", "fio2", "on_resp_support"}
    fio2 = [o for o in sent if o["code"]["coding"][0]["code"] == "fio2"][0]
    assert fio2["valueQuantity"] == {"value": 0.4, "unit": "fraction"}
    assert fio2["subject"] == {"reference": "Patient/P-9"}


def test_discovery_report_names_the_unmapped_codes():
    session, device, bridge, sent = make()
    pump(session, device, bridge, seconds=5.0)
    report = bridge.discovery_report()
    for code in ("cp1:78", "cp1:7D", "cp1:B9", "cp1:88", "cp1:E6"):
        assert code in report
    assert "cp1:EB" not in report
    for value in device.readings.values():
        assert value.strip() not in report.split("format=")[0]


def test_survives_realtime_noise_and_corrupt_frames():
    session, device, bridge, sent = make(FakeDevice(realtime_noise=True, corrupt_every=3))
    pump(session, device, bridge, seconds=20.0)
    assert session.state is State.ACTIVE
    assert bridge.stats.corrupt >= 1
    assert bridge.stats.polls >= 5
    assert bridge.stats.disconnects == 0


def test_link_recovers_after_the_device_goes_silent():
    session, device, bridge, sent = make()
    now = pump(session, device, bridge, seconds=6.0)
    polls_before = bridge.stats.polls
    # the device disappears: nothing crosses the wire for 5 s
    for _ in range(100):
        session.tick(now)
        session.outgoing()
        for event in session.events():
            bridge.handle(event)
        now = round(now + 0.05, 6)
    assert bridge.stats.disconnects == 1 and session.state is not State.ACTIVE
    # ...and comes back
    device = FakeDevice()
    pump(session, device, bridge, seconds=8.0, start=now)
    assert session.state is State.ACTIVE
    assert bridge.stats.connects == 2
    assert bridge.stats.polls > polls_before


def test_device_that_never_embeds_a_device_id_request_still_connects():
    session, device, bridge, sent = make(FakeDevice(embed_device_id_request=False))
    pump(session, device, bridge, seconds=6.0)
    assert session.state is State.ACTIVE and bridge.stats.polls >= 2


def test_stop_ends_the_session_cleanly():
    session, device, bridge, sent = make()
    now = pump(session, device, bridge, seconds=4.0)
    session.stop(now)
    pump(session, device, bridge, seconds=4.0, start=now)
    assert session.state is State.IDLE and not device.active
    assert bridge.stats.disconnects == 1
