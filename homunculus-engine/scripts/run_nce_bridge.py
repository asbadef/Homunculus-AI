"""Run the NCE file bridge: session files in -> durable buffer -> cloud.

Runs on the hospital server, reading a READ-ONLY mount of the NCE machine's SavedCopies folder.
Nothing is installed on the NCE server and nothing there is reconfigured.

Typical first run — discovery, forwards nothing:

    python scripts/run_nce_bridge.py --dir /mnt/nce --db /data/nce.db

That reports the field names the sessions actually carry, which is how nce-mapping.json gets
written. Then, with a mapping and an uplink:

    python scripts/run_nce_bridge.py --dir /mnt/nce --db /data/nce.db \
        --mapping /app/nce-mapping.json --cloud-url http://api:8000 --token <tenant-token>

PHI: nothing here logs session contents, measurements or patient identifiers — only counts, file
names (device metadata) and field names. The buffer file holds real observations in transit: keep it
on encrypted storage, never commit it, delete it after the pilot.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from homunculus.edge.buffer import SqliteBuffer
from homunculus.edge.filewatch import ProcessedLedger, pending_files
from homunculus.edge.ncebridge import NceFileBridge
from homunculus.edge.ncefiles import SiteMapping, load_site_mapping
from homunculus.edge.uplink import flush_loop
from homunculus.gateway.fhir import GatewayError

_log = logging.getLogger("nce-bridge")


async def scan_loop(
    bridge: NceFileBridge,
    ledger: ProcessedLedger,
    directory: str,
    interval: float,
    since_epoch: int | None,
) -> None:
    """Forward every new session, oldest first, recording each one as it goes.

    A file is recorded even when it is refused. Retrying a session that has no patient identifier
    would refuse it again every pass, forever, burying the log it needs to appear in.

    The scan and every file read run via asyncio.to_thread: both do blocking network I/O against a
    CIFS mount, and a hung mount stalling the event loop would also freeze flush_loop — a share
    problem must not stop delivery of observations already buffered.
    """
    while True:
        sessions = await asyncio.to_thread(
            pending_files, directory, ledger, since_epoch=since_epoch)
        for session in sessions:
            try:
                # Read as bytes, not str: NCE runs on Windows and a UTF-16 session file is
                # realistic. expat reads the encoding from the BOM/XML declaration itself, while
                # decoding here first as UTF-8 would turn it into replacement-character soup and
                # get the session rejected as malformed.
                text = await asyncio.to_thread(session.path.read_bytes)
            except OSError as exc:
                _log.warning("could not read %s (%s)", session.name, exc.__class__.__name__)
                continue

            fallback = (
                datetime.fromtimestamp(session.epoch, tz=timezone.utc)
                if session.epoch is not None else None
            )
            try:
                # source_device stays a constant, not the filename: every session has a distinct
                # name, and storing it per observation would give the field unbounded cardinality
                # while telling a clinician nothing. Which file a reading came from is a bridge-log
                # question, not a patient-record one.
                bridge.handle_session(text, fallback_timestamp=fallback, source_device="nce")
            except GatewayError:
                pass        # already counted and logged by the bridge; do not retry it forever
            except Exception:
                # An unexpected failure crashes the process LOUDLY (compose restarts it) — but the
                # restart loop must be diagnosable, so name the file first. Name only: PHI-safe.
                _log.error("session %s failed unexpectedly", session.name)
                raise
            ledger.record(session.name, session.size, session.mtime)

        await asyncio.sleep(interval)


async def report_loop(bridge: NceFileBridge, buffer: SqliteBuffer, ledger: ProcessedLedger,
                      interval: float) -> None:
    """Periodic operator report: throughput, buffer depth, and what could not be used."""
    while True:
        await asyncio.sleep(interval)
        stats = bridge.stats
        _log.info("dosya=%s gözlem=%s reddedilen=%s kuyruk=%s işlenmiş=%s",
                  stats.files, stats.observations, stats.rejected, buffer.depth(), ledger.count())
        report = bridge.discovery_report()
        if report:
            _log.warning("%s", report)


def parse_since(since: str) -> int | None:
    """An explicit --since as an epoch, or None when none was given.

    A date with no timezone is taken as UTC (the help text says so). A date that CARRIES an
    offset is honoured, not clobbered: silently reinterpreting explicit operator input would
    shift a clinical backfill window by hours.
    """
    if not since:
        return None
    try:
        parsed = datetime.fromisoformat(since)
    except ValueError:
        raise SystemExit(
            f"--since {since!r}: ISO tarih bekleniyor, örn. 2026-08-01 veya "
            f"2026-08-01T00:00:00+03:00") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


async def main_async(args: argparse.Namespace) -> None:
    if Path(args.db).resolve().parent == Path(args.dir).resolve():
        raise SystemExit(
            f"--db {args.db} sits inside --dir {args.dir}: the buffer holds patient data and "
            f"must not be scanned as a session; put it elsewhere (production uses /data vs /nce)")

    buffer = SqliteBuffer(args.db, max_rows=args.max_buffer)
    ledger = ProcessedLedger(args.ledger or f"{args.db}.ledger")
    mapping = load_site_mapping(args.mapping) if args.mapping else SiteMapping()
    capture_only = not args.cloud_url

    def send(payload: dict) -> None:
        if not capture_only:
            buffer.append(payload)

    bridge = NceFileBridge(send=send, mapping=mapping)

    since_epoch = parse_since(args.since)
    if since_epoch is None and not args.all:
        # Default: from the FIRST-ever start, remembered in the ledger — not from this boot.
        # The ledger dedupes everything already forwarded, so a restart resumes rather than skips.
        # (Replaying truly historical sessions stays a deliberate --since/--all decision.)
        since_epoch = ledger.first_start_epoch(int(datetime.now(tz=timezone.utc).timestamp()))

    if capture_only:
        _log.warning("KEŞİF MODU: veri iletilmiyor, yalnızca alan adları raporlanıyor "
                     "(iletmek için --cloud-url verin)")
    else:
        _log.info("uplink: %s", args.cloud_url)
    _log.info("izlenen dizin: %s (since_epoch=%s)", args.dir, since_epoch)

    tasks = [
        asyncio.create_task(scan_loop(bridge, ledger, args.dir, args.poll_interval, since_epoch)),
        asyncio.create_task(report_loop(bridge, buffer, ledger, args.report_interval)),
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
        _log.info("kapanıyor — kuyrukta %s gözlem kaldı (kaybolmaz)", buffer.depth())
        buffer.close()
        ledger.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Homunculus NCE file bridge")
    parser.add_argument("--dir", required=True, help="read-only mount of NCE's SavedCopies")
    parser.add_argument("--db", default="nce-buffer.db", help="durable buffer file")
    parser.add_argument("--ledger", default="", help="processed-file ledger (default: <db>.ledger)")
    parser.add_argument("--mapping", default=None, help="nce-mapping.json")
    parser.add_argument("--cloud-url", default="", help="e.g. http://api:8000 (empty = discovery)")
    parser.add_argument("--token", default="", help="tenant bearer token")
    parser.add_argument("--since", default="", help="backfill from this UTC date, e.g. 2026-08-01")
    parser.add_argument("--all", action="store_true",
                        help="process every session on the share, however old")
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--flush-interval", type=float, default=2.0)
    parser.add_argument("--report-interval", type=float, default=30.0)
    parser.add_argument("--max-buffer", type=int, default=200_000)
    args = parser.parse_args(argv)

    # Windows consoles default to a code page that cannot encode Turkish characters, which would
    # mangle or crash every log line. Force UTF-8 so this runs on the pilot laptop too.
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
