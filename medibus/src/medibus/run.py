"""Run the MEDIBUS serial bridge: ventilator RS-232 in -> durable buffer -> cloud.

Runs on a laptop (or the hospital server) with a USB-serial adapter cabled to the COM port of a
Dräger ventilator or anaesthesia machine. The bridge only READS measured data: it never changes a
setting and never silences an alarm — MEDIBUS has commands for both and this code does not
implement them.

Typical first run — discovery, forwards nothing, reports which codes the device sends:

    python -m medibus.run --port COM3 --patient-id P-1 --db medibus.db

Then, with a site mapping and an uplink:

    python -m medibus.run --port COM3 --patient-id P-1 --db medibus.db \
        --mapping medibus-mapping.json --cloud-url http://api:8000 --token <tenant-token>

No hardware at hand:

    python -m medibus.run --fake --patient-id DEMO --db demo.db

PHI: MEDIBUS carries no patient identity; the operator supplies one per run. Logs hold codes,
counts and value formats — never values. The buffer file holds real observations in transit: keep
it on encrypted storage, never commit it, delete it after the pilot.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from collections.abc import Callable
from pathlib import Path

_ENGINE_SRC = Path(__file__).resolve().parents[3] / "homunculus-engine" / "src"
try:
    import homunculus  # noqa: F401
except ImportError:                                   # a checkout, not an install
    sys.path.insert(0, str(_ENGINE_SRC))

from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.uplink import flush_loop

from medibus.bridge import MedibusBridge
from medibus.mapping import SiteMapping
from medibus.session import Connected, Disconnected, Session, SessionConfig
from medibus.transport import FakeTransport, SerialTransport, Transport

_log = logging.getLogger("medibus")

TICK = 0.05                  # link poll period, s — MEDIBUS' finest timing is the 200 ms hold
REOPEN_DELAY = 5.0           # s between attempts to reopen a failed serial port


async def link_loop(open_transport: Callable[[], Transport], session: Session,
                    bridge: MedibusBridge, tick: float = TICK,
                    reopen_delay: float = REOPEN_DELAY) -> None:
    """Pump bytes between the port and the session until cancelled.

    A port that fails to open or dies mid-run (adapter unplugged) is retried every `reopen_delay`
    seconds; the session re-initialises on its own once bytes flow again. A session-level fault
    (device silent, no answer) is the session's business and never touches the port.
    """
    while True:
        try:
            transport = open_transport()
        except Exception as exc:                       # pyserial raises its own hierarchy
            _log.warning("port açılamadı (%s: %s) — %.0f s sonra tekrar",
                         exc.__class__.__name__, exc, reopen_delay)
            await asyncio.sleep(reopen_delay)
            continue
        _log.info("port açık: %s %s", transport.port, transport.settings)
        try:
            while True:
                _step(transport, session, bridge, time.monotonic())
                await asyncio.sleep(tick)
        except asyncio.CancelledError:
            _farewell(transport, session)
            transport.close()
            raise
        except Exception as exc:
            _log.warning("port hatası (%s: %s) — %.0f s sonra yeniden açılacak",
                         exc.__class__.__name__, exc, reopen_delay)
            transport.close()
            await asyncio.sleep(reopen_delay)


def _step(transport: Transport, session: Session, bridge: MedibusBridge, now: float) -> None:
    data = transport.read()
    if data:
        session.receive(data, now)
    session.tick(now)
    out = session.outgoing()
    if out:
        transport.write(out)
    for event in session.events():
        bridge.handle(event)
        if isinstance(event, Connected):
            _log.info("bağlandı: %s", bridge.device_label)
        elif isinstance(event, Disconnected):
            _log.warning("bağlantı koptu: %s", event.reason)


def _farewell(transport: Transport, session: Session) -> None:
    """Send STOP so the device does not spend 3 s wondering where we went."""
    try:
        session.stop(time.monotonic())
        out = session.outgoing()
        if out:
            transport.write(out)
    except Exception:
        pass


async def report_loop(bridge: MedibusBridge, buffer: SqliteBuffer, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        s = bridge.stats
        _log.info("cihaz=%s sorgu=%s gözlem=%s bağlantı=%s kopma=%s bozuk=%s kuyruk=%s",
                  bridge.device_label, s.polls, s.observations, s.connects, s.disconnects,
                  s.corrupt, buffer.depth())
        report = bridge.discovery_report()
        if report:
            _log.warning("%s", report)
        if s.alarms:
            _log.info("alarm kodları (sayı): %s",
                      ", ".join(f"{k} x{n}" for k, n in sorted(s.alarms.items())))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Homunculus MEDIBUS serial bridge")
    parser.add_argument("--port", default="", help="serial port, e.g. COM3 or /dev/ttyUSB0")
    parser.add_argument("--fake", action="store_true", help="talk to an in-process Evita 4 instead")
    parser.add_argument("--baud", type=int, default=19200)
    parser.add_argument("--parity", default="E", choices=["N", "E", "O"],
                        help="Evita/Savina factory default is E (even)")
    parser.add_argument("--patient-id", default="",
                        help="pseudonymous id for this run (required unless discovery)")
    parser.add_argument("--bed", default="", help="bed label, becomes source_device medibus/<bed>")
    parser.add_argument("--mapping", default=None, help="medibus-mapping.json")
    parser.add_argument("--cloud-url", default="", help="e.g. http://api:8000 (empty = discovery)")
    parser.add_argument("--token", default="", help="tenant bearer token")
    parser.add_argument("--db", default="medibus-buffer.db", help="durable buffer file")
    parser.add_argument("--poll-interval", type=float, default=2.0, help="data request period, s")
    parser.add_argument("--codepage2", action="store_true", help="also poll 2BH (not on Evita 4)")
    parser.add_argument("--settings", action="store_true", help="also poll settings 29H")
    parser.add_argument("--alarms", action="store_true", help="also poll alarms 27H (counted only)")
    parser.add_argument("--flush-interval", type=float, default=2.0)
    parser.add_argument("--report-interval", type=float, default=30.0)
    parser.add_argument("--max-buffer", type=int, default=200_000)
    return parser


def check_args(args: argparse.Namespace) -> None:
    if bool(args.port) == bool(args.fake):
        raise SystemExit("--port <COMx> veya --fake: tam olarak biri gerekli")
    if args.cloud_url and not args.patient_id:
        raise SystemExit("--patient-id gerekli: MEDIBUS hasta kimliği taşımaz, operatör verir")


async def main_async(args: argparse.Namespace) -> None:
    check_args(args)
    buffer = SqliteBuffer(args.db, max_rows=args.max_buffer)
    mapping = SiteMapping.load(args.mapping) if args.mapping else SiteMapping()
    capture_only = not args.cloud_url

    def send(payload: dict) -> None:
        if not capture_only:
            buffer.append(payload)

    source = f"medibus/{args.bed}" if args.bed else "medibus"
    bridge = MedibusBridge(send=send, mapping=mapping, patient_id=args.patient_id or "discovery",
                           source_device=source)
    session = Session(SessionConfig(
        poll_interval=args.poll_interval, poll_codepage2=args.codepage2,
        poll_settings=args.settings, poll_alarms=args.alarms))

    if args.fake:
        open_transport: Callable[[], Transport] = FakeTransport
    else:
        def open_transport() -> Transport:
            return SerialTransport(args.port, baud=args.baud, parity=args.parity)

    if capture_only:
        _log.warning("KEŞİF MODU: veri iletilmiyor, yalnızca cihazın gönderdiği kodlar "
                     "raporlanıyor (iletmek için --cloud-url ve --patient-id verin)")
    else:
        _log.info("uplink: %s  hasta=%s  kaynak=%s", args.cloud_url, args.patient_id, source)
    if not mapping.codepage1:
        _log.warning("mapping boş: hiçbir kod gözleme dönüşmez (--mapping verin)")

    tasks = [
        asyncio.create_task(link_loop(open_transport, session, bridge)),
        asyncio.create_task(report_loop(bridge, buffer, args.report_interval)),
    ]
    if not capture_only:
        ingest_url = args.cloud_url.rstrip("/") + "/ingest"
        tasks.append(asyncio.create_task(
            flush_loop(buffer, ingest_url, args.token, args.flush_interval)))

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        _log.info("kapanıyor — kuyrukta %s gözlem kaldı (kaybolmaz)", buffer.depth())
        buffer.close()


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
