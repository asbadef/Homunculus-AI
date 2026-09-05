"""Run the on-prem edge bridge: MLLP in -> durable buffer -> cloud.

Runs INSIDE the hospital, on the same network as the central station. It listens for HL7 and makes
only OUTBOUND calls to the cloud, which is what segmented device networks and firewalls permit.

Typical first run against a live station — capture only, forwards nothing:

    python scripts/run_bridge.py --db bridge.db

That proves the link and prints which OBX identifiers the station sends, so the site mapping can be
written. Then, with a mapping and an uplink:

    python scripts/run_bridge.py --db bridge.db \
        --mapping mindray.json --cloud-url https://<host>/api --token <tenant-token>

PHI: nothing here logs message bodies, measurements or patient identifiers — only counts,
connection events and OBX identifiers (device metadata). The buffer file holds real observations in
transit: keep it on encrypted storage, never commit it, delete it after the pilot.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from homunculus.canonical import SignalCode
from homunculus.crypto import validate_key
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.identity import IdentityMirror
from homunculus.edge.uplink import flush_loop

_log = logging.getLogger("bridge")


def load_mapping(path: str | None) -> dict[str, SignalCode] | None:
    """Read a site mapping file: {"<OBX code>": "<SignalCode slug>"}.

    Unknown slugs are a configuration error and stop startup — quietly ignoring one would drop a
    signal for the whole pilot without anyone noticing.
    """
    if not path:
        return None
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    mapping: dict[str, SignalCode] = {}
    for code, slug in raw.items():
        try:
            mapping[code] = SignalCode(slug)
        except ValueError:
            raise SystemExit(f"mapping {path}: unknown signal slug {slug!r} for OBX code {code!r}")
    return mapping


def identity_path(args: argparse.Namespace) -> str | None:
    """Where the identity mirror lives: beside the buffer unless told otherwise, or nowhere.

    A site with no HIS feed has nothing to mirror, and `--no-identity` says so out loud rather
    than leaving an empty database to puzzle over.
    """
    if getattr(args, "no_identity", False):
        return None
    return args.identity_db or f"{args.db}.identity"


def open_identity_mirror(path: str | None) -> IdentityMirror | None:
    """The mirror if it can be opened; None — loudly — if it cannot.

    A corrupt or unwritable identity file — or a malformed PHI_ENCRYPTION_KEY, checked here
    rather than at the first admission — must cost the device its name on the next query,
    never the ward its readings: the bridge that refuses to start over the optional half of
    its job is the bridge nobody restarts at 3 a.m.
    """
    if not path:
        return None
    try:
        validate_key()
        return IdentityMirror(path)
    except Exception as exc:                 # sqlite3.Error, OSError, ValueError — the reason, never content
        _log.error("kimlik aynası açılamadı, köprü aynasız devam ediyor: %s (%s)",
                   path, exc.__class__.__name__)
        return None


async def report_loop(bridge: EdgeBridge, buffer: SqliteBuffer, interval: float) -> None:
    """Periodic operator report: throughput, buffer depth, and unmapped identifiers."""
    while True:
        await asyncio.sleep(interval)
        stats = bridge.stats
        kimlik = bridge.identity.count() if bridge.identity is not None else 0
        _log.info("mesaj=%s gözlem=%s reddedilen=%s sorgu=%s adt=%s yoksayılan=%s bayat=%s "
                  "kimlik=%s kuyruk=%s",
                  stats.messages, stats.observations, stats.rejected, stats.queries,
                  stats.adt, stats.adt_ignored, stats.adt_stale, kimlik, buffer.depth())
        if bridge.identity is not None:
            bridge.identity.prune(now=datetime.now(tz=timezone.utc))
        report = bridge.discovery_report()
        if report:
            _log.warning("%s", report)


async def main_async(args: argparse.Namespace) -> None:
    buffer = SqliteBuffer(args.db, max_rows=args.max_buffer)
    capture_only = not args.cloud_url

    def send(payload: dict) -> None:
        if not capture_only:
            buffer.append(payload)

    identity = open_identity_mirror(identity_path(args))
    bridge = EdgeBridge(send=send, mapping=load_mapping(args.mapping), identity=identity)
    server = await bridge.serve(host=args.listen_host, port=args.listen_port)

    if capture_only:
        _log.warning("KEŞİF MODU: veri iletilmiyor, yalnızca dinleniyor ve kodlar raporlanıyor "
                     "(iletmek için --cloud-url verin)")
    else:
        _log.info("uplink: %s", args.cloud_url)

    tasks = [asyncio.create_task(report_loop(bridge, buffer, args.report_interval))]
    if not capture_only:
        ingest_url = args.cloud_url.rstrip("/") + "/ingest"
        tasks.append(asyncio.create_task(
            flush_loop(buffer, ingest_url, args.token, args.flush_interval)))

    try:
        async with server:
            await server.serve_forever()
    except asyncio.CancelledError:
        pass
    finally:
        for task in tasks:
            task.cancel()
        _log.info("kapanıyor — kuyrukta %s gözlem kaldı (kaybolmaz)", buffer.depth())
        buffer.close()
        if identity is not None:
            identity.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Homunculus on-prem edge bridge")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=2575,
                        help="IANA-registered port for HL7 over MLLP")
    parser.add_argument("--db", default="bridge-buffer.db", help="durable buffer file")
    parser.add_argument("--mapping", default=None, help="JSON: OBX code -> SignalCode slug")
    parser.add_argument("--cloud-url", default="", help="e.g. https://host/api (empty = capture only)")
    parser.add_argument("--token", default="", help="tenant bearer token")
    parser.add_argument("--flush-interval", type=float, default=2.0)
    parser.add_argument("--report-interval", type=float, default=30.0)
    parser.add_argument("--max-buffer", type=int, default=200_000,
                        help="queued observations to keep before dropping the oldest")
    parser.add_argument("--identity-db", default="", help="identity mirror (default: <db>.identity)")
    parser.add_argument("--no-identity", action="store_true",
                        help="no HIS feed at this site: do not keep an identity mirror")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    # Windows consoles default to a legacy code page that cannot encode Turkish characters, which
    # would mangle or crash every log line. Force UTF-8 so this runs on the pilot laptop.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    _log.info("MLLP dinleniyor: %s:%s", args.listen_host, args.listen_port)

    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
