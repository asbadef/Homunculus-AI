"""The runner: argument checks, discovery mode, and a real (wall-clock) --fake run."""
import asyncio
import json
import sqlite3
from pathlib import Path

import pytest

from medibus import run
from medibus.bridge import MedibusBridge
from medibus.fake_device import FakeDevice
from medibus.mapping import SiteMapping
from medibus.session import Session, SessionConfig
from medibus.transport import FakeTransport

MAPPING = SiteMapping.from_dict({
    "codepage1": {"EB": {"signal": "spo2", "unit": "%"}, "E1": {"signal": "heart_rate", "unit": "/min"}},
})


def parse(*argv: str):
    return run.build_parser().parse_args(list(argv))


def test_port_or_fake_exactly_one():
    with pytest.raises(SystemExit):
        run.check_args(parse("--patient-id", "P"))
    with pytest.raises(SystemExit):
        run.check_args(parse("--port", "COM3", "--fake"))
    run.check_args(parse("--fake"))


def test_patient_id_required_when_forwarding():
    with pytest.raises(SystemExit, match="patient-id"):
        run.check_args(parse("--fake", "--cloud-url", "http://api"))
    run.check_args(parse("--fake", "--cloud-url", "http://api", "--patient-id", "P"))
    run.check_args(parse("--fake"))     # discovery needs no patient


def test_defaults_are_the_evita_factory_settings():
    args = parse("--port", "COM3")
    assert (args.baud, args.parity, args.poll_interval) == (19200, "E", 2.0)


async def test_link_loop_pumps_observations_from_the_fake_device():
    sent: list[dict] = []
    bridge = MedibusBridge(send=sent.append, mapping=MAPPING, patient_id="P-1")
    session = Session(SessionConfig(poll_interval=0.3))
    task = asyncio.create_task(run.link_loop(FakeTransport, session, bridge, tick=0.01))
    await asyncio.sleep(1.5)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert bridge.stats.connects == 1
    assert bridge.stats.polls >= 2
    assert {o["code"]["coding"][0]["code"] for o in sent} == {"spo2", "heart_rate"}


async def test_link_loop_sends_stop_when_cancelled():
    device = FakeDevice()
    bridge = MedibusBridge(send=lambda _: None, mapping=MAPPING, patient_id="P-1")
    session = Session(SessionConfig())
    task = asyncio.create_task(
        run.link_loop(lambda: FakeTransport(device), session, bridge, tick=0.01))
    await asyncio.sleep(0.6)
    assert device.active
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert not device.active


async def test_link_loop_retries_a_port_that_will_not_open():
    attempts = 0

    def flaky():
        nonlocal attempts
        attempts += 1
        raise OSError("no such port")

    bridge = MedibusBridge(send=lambda _: None, mapping=MAPPING, patient_id="P-1")
    task = asyncio.create_task(
        run.link_loop(flaky, Session(SessionConfig()), bridge, tick=0.01, reopen_delay=0.05))
    await asyncio.sleep(0.3)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert attempts >= 3


async def test_fake_run_in_discovery_mode_buffers_nothing(tmp_path: Path):
    db = tmp_path / "buf.db"
    args = parse("--fake", "--db", str(db), "--report-interval", "0.2")
    task = asyncio.create_task(run.main_async(args))
    await asyncio.sleep(1.0)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    rows = sqlite3.connect(db).execute("select count(*) from outbox").fetchone()[0]
    assert rows == 0


async def test_fake_run_with_uplink_buffers_observations(tmp_path: Path, monkeypatch):
    db = tmp_path / "buf.db"
    mapping = tmp_path / "m.json"
    mapping.write_text(json.dumps({"codepage1": {"EB": {"signal": "spo2", "unit": "%"}}}))
    # the flush loop would try to POST: make it a no-op so the buffer keeps everything
    async def no_flush(*_a, **_k):
        await asyncio.sleep(3600)
    monkeypatch.setattr(run, "flush_loop", no_flush)
    args = parse("--fake", "--db", str(db), "--mapping", str(mapping), "--patient-id", "P-7",
                 "--bed", "Y3", "--cloud-url", "http://127.0.0.1:9", "--poll-interval", "0.3")
    task = asyncio.create_task(run.main_async(args))
    await asyncio.sleep(1.5)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    conn = sqlite3.connect(db)
    payloads = [json.loads(r[0]) for r in conn.execute("select payload from outbox")]
    assert len(payloads) >= 2
    assert all(p["code"]["coding"][0]["code"] == "spo2" for p in payloads)
    assert all(p["subject"] == {"reference": "Patient/P-7"} for p in payloads)
    assert all(p["device"]["display"] == "medibus/Y3" for p in payloads)
