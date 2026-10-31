"""Import the approved v2 device→bed table into `device_beds`, once (spec §5.4).

Run on the VM in a one-off container of the NEW api image, after `alembic upgrade head`:

    docker compose run --rm --no-deps -T api python scripts/import_device_beds.py --tenant <slug> </dev/null

It checks the file's sha256 against the approved v2, parses it with the strip's own reader, checks
every bed and unit against this tenant's structure, writes the rows and grants `devices.map_beds` to
the tenant's `charge_nurse` group in one transaction, audits `device_bed.import`, and prints ONE line
on stdout and nothing else there:

    ESLEME_ICE_AKTARIM {"tenant", "file_sha256", "rows", "with_bed", "without_bed", "granted",
                        "version", "sha256", "already", "dry_run"}

`version` and `sha256` are what `GET /infinity-shadow/board`'s `table` will say. Every note, refusal
and failure goes to stderr as `ESLEME_ICE_AKTARIM_RED <code> <reason>` (or the sibling
`ESLEME_ICE_AKTARIM_DENETIM_YAZILAMADI`, `…_GERI_OKUMA_YAPILAMADI` the import itself prints).

Exit codes
  0  imported, or already imported (`"already": true`: nothing written, not even the grant);
     `--dry-run` also ends 0 and writes nothing.
  1  an unexpected failure (a lock timeout, the database down, …). Rows may have been written: run the
     same command again — `"already": true` means they were. stderr carries the exception's CLASS and
     the driver's SQLSTATE when it gave one (`DBAPIError 55P03` is a lock timeout), never a message and
     never a traceback (a driver error prints the statement's parameters).
  2  a check refused, nothing written: no tenant, an unreadable or oversized file, a sha256 that is not
     the approved v2's, a bed or unit that is not this tenant's, no DATABASE_URL. (An unknown option
     is argparse's own exit 2.)
  3  the tenant's table holds other rows than the file's — the editor has been used, or the table was
     seeded another way — nothing written.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from homunculus.api.device_beds_postgres import _failure       # the accessor's own label: class + SQLSTATE
from homunculus.api.infinity_device_beds import MAX_BYTES, read_capped
from homunculus.devicebeds.seed import DEFAULT_FILE, LINE, ImportRefused, import_v2

# A failure that is not a refusal may have come after the commit: say what to do about it.
MAYBE_WRITTEN = "satırlar yazılmış olabilir; yeniden çalıştırın — already:true ise yazılmıştır"


def _refused(code: int, reason: str) -> int:
    print(f"{LINE}_RED {code} {reason}", file=sys.stderr)
    return code


async def run(argv=None, *, maker=None, audit=None) -> int:
    parser = argparse.ArgumentParser(prog="scripts/import_device_beds.py",
                                     description="Import the approved v2 device-to-bed table, once.")
    parser.add_argument("--file", default=DEFAULT_FILE, help="the v2 file (default: %(default)s)")
    parser.add_argument("--tenant", default=os.getenv("INFINITY_SHADOW_HOSPITAL", ""),
                        help="the tenant's slug (default: $INFINITY_SHADOW_HOSPITAL)")
    parser.add_argument("--dry-run", action="store_true", help="check everything, write nothing")
    args = parser.parse_args(argv)
    tenant = args.tenant.strip()
    if not tenant:
        return _refused(2, "kiracı verilmedi (--tenant ya da INFINITY_SHADOW_HOSPITAL)")
    try:
        data = read_capped(Path(args.file))
    except OSError as exc:
        return _refused(2, f"dosya okunamadı ({type(exc).__name__})")
    if len(data) > MAX_BYTES:
        return _refused(2, f"dosya {MAX_BYTES // 1024} KiB'tan büyük")
    engine = None
    try:
        if maker is None:                                 # the deployed path: the app's own database
            url = os.getenv("DATABASE_URL", "").strip()
            if not url:
                return _refused(2, "DATABASE_URL verilmedi")
            from sqlalchemy.ext.asyncio import async_sessionmaker

            from homunculus.api.audit_postgres import PostgresAuditLog
            from homunculus.db import engine as app_engine
            engine = app_engine
            maker = async_sessionmaker(engine, expire_on_commit=False)
            if audit is None:
                audit = PostgresAuditLog(url, ssl_required=os.getenv(
                    "DATABASE_SSL", "").lower() in ("require", "true", "1"))
        async with maker() as db:
            result = await import_v2(db, tenant_slug=tenant, data=data, audit=audit, dry_run=args.dry_run)
    except ImportRefused as refused:
        return _refused(refused.code, refused.reason)
    except Exception as exc:  # noqa: BLE001 — A-13: never the message, which carries SQL parameters
        # the class, then the driver's SQLSTATE when it gave one (`DBAPIError 55P03`): a lock timeout is
        # told from a failed login or a lost connection without reading the driver's text
        return _refused(1, f"{_failure(exc)} — {MAYBE_WRITTEN}")
    finally:
        if engine is not None:
            try:
                await engine.dispose()
            except Exception:  # noqa: BLE001 — the result is decided: no traceback after it
                pass
    print(result.line())
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
