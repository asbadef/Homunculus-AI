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
import urllib.error
import urllib.request
from pathlib import Path

from homunculus.canonical import SignalCode
from homunculus.edge.bridge import EdgeBridge
from homunculus.edge.buffer import SqliteBuffer

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


def post_json(url: str, token: str, payload: dict, timeout: float = 10.0) -> None:
    """Deliver one observation to the cloud. Raises on any non-2xx so the row stays queued."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"uplink returned {response.status}")


async def flush_loop(buffer: SqliteBuffer, ingest_url: str, token: str, interval: float) -> None:
    """Drain the buffer to the cloud, oldest first, acking only what was delivered.

    A failure stops this pass and leaves the rest queued, preserving order: sending later
    observations past a stuck earlier one would let the engine read the past as the present.
    """
    while True:
        await asyncio.sleep(interval)
        batch = buffer.pending(limit=100)
        if not batch:
            continue

        delivered: list[int] = []
        for row_id, payload in batch:
            try:
                await asyncio.to_thread(post_json, ingest_url, token, payload)
                delivered.append(row_id)
            except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
                _log.warning("uplink unavailable (%s); %s observation(s) stay queued",
                             exc.__class__.__name__, buffer.depth() - len(delivered))
                break
        buffer.ack(delivered)
        if delivered:
            _log.info("forwarded %s observation(s); %s still queued", len(delivered), buffer.depth())


async def report_loop(bridge: EdgeBridge, buffer: SqliteBuffer, interval: float) -> None:
    """Periodic operator report: throughput, buffer depth, and unmapped identifiers."""
    while True:
        await asyncio.sleep(interval)
        stats = bridge.stats
        _log.info("mesaj=%s gözlem=%s reddedilen=%s kuyruk=%s",
                  stats.messages, stats.observations, stats.rejected, buffer.depth())
        report = bridge.discovery_report()
        if report:
            _log.warning("%s", report)


async def main_async(args: argparse.Namespace) -> None:
    buffer = SqliteBuffer(args.db, max_rows=args.max_buffer)
    capture_only = not args.cloud_url

    def send(payload: dict) -> None:
        if not capture_only:
            buffer.append(payload)

    bridge = EdgeBridge(send=send, mapping=load_mapping(args.mapping))
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


def main(argv: list[str] | None = None) -> int:
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
    args = parser.parse_args(argv)

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
