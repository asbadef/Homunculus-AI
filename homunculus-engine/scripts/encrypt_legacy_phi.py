"""
O6 — encrypt legacy plaintext values in every `EncryptedString` column.

Default is a DRY RUN (counts only, never prints values). Pass --apply to write.
Idempotent: already-encrypted values are skipped. Back up the database first
(docs/YEDEKLEME-VE-GERI-YUKLEME.md). Needs PHI_ENCRYPTION_KEY (production) and DATABASE_URL.

    python scripts/encrypt_legacy_phi.py            # dry run
    python scripts/encrypt_legacy_phi.py --apply    # encrypt
"""
from __future__ import annotations

import argparse
import os
import sys

import sqlalchemy as sa

import homunculus.admission.models  # noqa: F401  (register tables)
import homunculus.auth.models  # noqa: F401
from homunculus.crypto import ENC_PREFIX, EncryptedString, encrypt_phi
from homunculus.db import Base


def encrypted_columns() -> list[tuple[str, str]]:
    return [(t.name, c.name) for t in Base.metadata.sorted_tables for c in t.columns
            if isinstance(c.type, EncryptedString)]


def migrate(engine: sa.Engine, *, apply: bool) -> dict[str, int]:
    """Return {"table.column": number_of_plaintext_values}; encrypt them when apply=True."""
    found: dict[str, int] = {}
    with engine.begin() as conn:
        for table, col in encrypted_columns():
            pk = sa.inspect(conn).get_pk_constraint(table)["constrained_columns"][0]
            rows = conn.execute(sa.text(
                f'SELECT "{pk}", "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL')).fetchall()
            plain = [(i, v) for i, v in rows if not v.startswith(ENC_PREFIX)]
            found[f"{table}.{col}"] = len(plain)
            if apply:
                for i, v in plain:
                    conn.execute(sa.text(f'UPDATE "{table}" SET "{col}" = :v WHERE "{pk}" = :i'),
                                 {"v": encrypt_phi(v), "i": i})
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    args = ap.parse_args()
    url = os.environ["DATABASE_URL"].replace("+asyncpg", "").replace("+aiosqlite", "")
    found = migrate(sa.create_engine(url), apply=args.apply)
    for name, n in found.items():
        print(f"{name}: {n} düz metin değer" + (" -> şifrelendi" if args.apply and n else ""))
    if not args.apply and any(found.values()):
        print("Kuru çalıştırma: değişiklik yapılmadı. Yazmak için --apply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
