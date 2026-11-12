"""File the readings of the stays open NOW into `vital_readings`, from the audit trail (G3-05, spec D19).

Migration 0021 is schema-only: on the deploy day the table is empty, and the patient screen's «Ölçüm kaydı» box
would show nothing measured before the deploy. This optional step runs `reconcile` (api/readings.py) with no
48-hour bound, for the card keys admitted now, each from the time its stay began (its first kabul, walked back
along a transfer's moves; a reading from before the move is filed with no admission row) — so the patients in bed
keep their record. Idempotent: a second run files nothing. Run on the VM in a one-off container of the NEW api image,
after `alembic upgrade head`:

    docker compose run --rm --no-deps -T api python scripts/backfill_vital_readings.py --tenant <slug> --open-only --dry-run </dev/null
    docker compose run --rm --no-deps -T api python scripts/backfill_vital_readings.py --tenant <slug> --open-only </dev/null

It prints ONE line on stdout and nothing else there:

    VITAL_READINGS_BACKFILL {"tenant", "open_only", "dry_run", "stays", "recorded", "unmatched", "voided",
                             "finalized", "rejected", "released", "skipped"}

`stays` is how many admissions are open; `recorded` the rows filed (in a dry run: that would be filed);
`skipped` the audit rows that could not be read or that the table holds already. `unmatched`, `finalized`,
`rejected` and `released` are always 0 here: the list and its claims are the hourly reconcile's, not a stay's.
A dry run predicts no `voided`. Counts only: no patient number, no value, ever.
Every refusal and failure goes to stderr as `VITAL_READINGS_BACKFILL_RED <code> <reason>`.

Exit codes
  0  done (or, with --dry-run, counted); nothing is written twice.
  1  an unexpected failure (the database down, a timeout). Rows may have been written: run it again. stderr
     carries the exception's CLASS, never its message and never a traceback (a driver error prints parameters).
  2  refused, nothing read or written: no --tenant, no --open-only, no DATABASE_URL.

Without --open-only it refuses: the rows of closed stays have no screen yet (spec §9), and an admission from
before migration 0015 is keyed by the patient's H-number, which an earlier stay of the same patient shares —
only the start of an open stay tells them apart.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from homunculus.api.readings import reconcile

LINE = "VITAL_READINGS_BACKFILL"


def _refused(code: int, reason: str) -> int:
    print(f"{LINE}_RED {code} {reason}", file=sys.stderr)
    return code


def run(argv=None, *, audit=None, store=None) -> int:
    """`audit` and `store` are handed in by the tests; left out, they are the deployment's (DATABASE_URL)."""
    parser = argparse.ArgumentParser(prog="scripts/backfill_vital_readings.py",
                                     description="File the open stays' readings into vital_readings, once.")
    parser.add_argument("--tenant", default="", help="the tenant's slug")
    parser.add_argument("--open-only", action="store_true", help="the stays open now, each from its start (required)")
    parser.add_argument("--dry-run", action="store_true", help="count what would be filed, write nothing")
    args = parser.parse_args(argv)
    if not args.tenant.strip():
        return _refused(2, "--tenant gerekli")
    if not args.open_only:
        return _refused(2, "--open-only gerekli: kapanmış yatışların kaydı bu dilimde doldurulmaz")
    owned = []
    try:
        if audit is None or store is None:
            url = os.getenv("DATABASE_URL", "").strip()
            if not url.startswith("postgresql"):
                return _refused(2, "DATABASE_URL bir Postgres adresi değil")
            from homunculus.api.audit_postgres import PostgresAuditLog
            from homunculus.api.readings_postgres import PostgresReadingStore
            ssl = os.getenv("DATABASE_SSL", "").lower() in ("require", "true", "1")
            audit = PostgresAuditLog(url, ssl_required=ssl)
            store = PostgresReadingStore(url, ssl_required=ssl)
            owned = [(audit, "dispose"), (store, "close")]
        stays = store.open_stays(args.tenant)
        counts = reconcile(store, audit, tenant=args.tenant, now=datetime.now(timezone.utc), since=None,
                           stays=stays, dry_run=args.dry_run)
    except Exception as error:                      # the class only: a driver's message carries parameters
        return _refused(1, f"{type(error).__name__} — satırlar yazılmış olabilir; yeniden çalıştırın")
    finally:
        for resource, release in owned:
            getattr(resource, release)()
    print(LINE + " " + json.dumps({"tenant": args.tenant, "open_only": True, "dry_run": args.dry_run,
                                   "stays": len(stays), **counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(run())
