"""
Durable Postgres audit.

The pilot carries real data, and an audit that vanishes on the next deploy is worse than none —
it still looks like a record. These run against a real Postgres (TEST_DATABASE_URL); the
append-only triggers are part of what is being tested, so they cannot be faked in memory.
"""
from __future__ import annotations

import ast
import re
import importlib.util
import pathlib

import pytest
from sqlalchemy import text

from homunculus.api.audit import AuditEvent
from homunculus.api.audit_postgres import PostgresAuditLog, to_sync_url
from tests.conftest import TEST_DATABASE_URL, requires_db

# NOTE: no module-level `pytestmark = requires_db` here (on purpose). That would apply the
# skipif to every test collected from this file, including the migration-chain test below —
# which is exactly the kind of check that must run even without a database. Instead each
# DB-backed test below is decorated individually with @requires_db.

_DDL = """
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY, ts TEXT NOT NULL, tenant TEXT NOT NULL,
    event_type TEXT NOT NULL, patient_id TEXT NOT NULL, subject TEXT NOT NULL,
    payload JSONB NOT NULL
);
CREATE OR REPLACE FUNCTION audit_is_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_update ON audit;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();
DROP TRIGGER IF EXISTS audit_no_delete ON audit;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();
"""


@pytest.fixture
def audit_log():
    log = PostgresAuditLog(TEST_DATABASE_URL)
    with log._engine.begin() as conn:                      # noqa: SLF001 — test setup
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
        for statement in _DDL.split(";\n"):
            if statement.strip():
                conn.execute(text(statement))
    yield log
    with log._engine.begin() as conn:                      # noqa: SLF001
        conn.execute(text("DROP TABLE IF EXISTS audit CASCADE"))
    log.dispose()


def _event(**over) -> AuditEvent:
    base = dict(tenant="HOSP1", event_type="alert", patient_id="bed-3", subject="news2",
                payload={"severity": "moderate"})
    return AuditEvent(**{**base, **over})


@requires_db
def test_url_is_rewritten_for_the_sync_driver():
    """One DATABASE_URL configures the app; the audit derives its sync form so they cannot drift."""
    assert to_sync_url("postgresql+asyncpg://u:p@h:5432/db") == "postgresql+psycopg2://u:p@h:5432/db"


@requires_db
def test_appends_and_reads_back(audit_log):
    record = audit_log.append(_event())

    assert record.id > 0 and record.tenant == "HOSP1"
    (stored,) = audit_log.records(tenant="HOSP1")
    assert stored.subject == "news2"
    assert stored.payload == {"severity": "moderate"}       # JSONB round-trips


@requires_db
def test_filters_and_orders_and_limits(audit_log):
    audit_log.append(_event(event_type="ingest", subject="heart_rate"))
    audit_log.append(_event(tenant="HOSP2"))
    audit_log.append(_event(patient_id="bed-9"))

    assert len(audit_log.records(tenant="HOSP1")) == 2
    assert len(audit_log.records(event_type="ingest")) == 1
    assert len(audit_log.records(patient_id="bed-9")) == 1
    ids = [r.id for r in audit_log.records(limit=10)]
    assert ids == sorted(ids)
    assert len(audit_log.records(limit=1)) == 1


@requires_db
def test_the_trail_cannot_be_rewritten(audit_log):
    """An audit that can be edited after the fact is not an audit."""
    audit_log.append(_event())

    with pytest.raises(Exception, match="append-only"):
        with audit_log._engine.begin() as conn:            # noqa: SLF001
            conn.execute(text("UPDATE audit SET tenant='TAMPERED'"))

    with pytest.raises(Exception, match="append-only"):
        with audit_log._engine.begin() as conn:            # noqa: SLF001
            conn.execute(text("DELETE FROM audit"))

    assert audit_log.records()[0].tenant == "HOSP1"         # untouched


@requires_db
def test_survives_a_new_connection(audit_log):
    """The point of moving off local disk: the record outlives the process that wrote it."""
    audit_log.append(_event())

    reopened = PostgresAuditLog(TEST_DATABASE_URL)
    try:
        assert len(reopened.records(tenant="HOSP1")) == 1
    finally:
        reopened.dispose()


# --- migration-chain regression test -----------------------------------------------------
#
# The defect this whole file exists to catch: PostgresAuditLog INSERTs into and SELECTs from
# an `audit` table that, until now, no Alembic migration created — it only existed on the
# cloud database because someone created it there by hand. Every DB-backed test above proves
# the table works correctly once it exists, via `_DDL` applied straight to the test database
# by the `audit_log` fixture. That is exactly what masked the bug: those tests never ask
# whether `alembic upgrade head` is what put the table there. They also all carry
# @requires_db and are SKIPPED entirely when TEST_DATABASE_URL is unset — which is the
# default on a plain dev machine or a minimal CI runner with no Postgres.
#
# So this test is deliberately static: it reads the migration file's source instead of
# running it against a database. That makes it able to run everywhere, unconditionally,
# including on a machine with no Postgres at all — which is precisely the coverage gap that
# let this defect ship. It checks the migration chain (0004 exists, follows 0003) and that
# the migration's DDL actually creates the `audit` table and both append-only triggers.

_MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _load_migration(revision_id: str):
    """Import a migration module directly from its file in alembic/versions/.

    Migration files aren't meant to be imported as a normal package (their module names
    start with a digit), so this loads by path rather than assuming an import path.
    """
    matches = sorted(_MIGRATIONS_DIR.glob(f"{revision_id}_*.py"))
    assert matches, (
        f"no migration file for revision {revision_id!r} found in {_MIGRATIONS_DIR} — "
        f"the audit table would not exist on a fresh database."
    )
    path = matches[0]
    spec = importlib.util.spec_from_file_location(f"migration_{revision_id}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, path


def test_migration_0004_exists_and_chains_from_0003():
    module, path = _load_migration("0004")

    assert module.revision == "0004"
    assert module.down_revision == "0003", (
        "0004 must chain from the current head (0003), or `alembic upgrade head` will not "
        "reach it — or worse, will produce a second head."
    )


def test_migration_0004_creates_the_audit_table_with_the_right_columns():
    """Column names must match audit_postgres.py's INSERT/SELECT exactly, or the queries
    that code issues at runtime fail with UndefinedColumn even though the table exists."""
    _module, path = _load_migration("0004")
    source = path.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS audit" in source
    for column in ("id BIGSERIAL PRIMARY KEY", "ts TEXT NOT NULL", "tenant TEXT NOT NULL",
                   "event_type TEXT NOT NULL", "patient_id TEXT NOT NULL",
                   "subject TEXT NOT NULL", "payload JSONB NOT NULL"):
        assert column in source, f"audit table is missing column definition: {column!r}"


def test_migration_0004_creates_both_append_only_triggers():
    """Immutability has to hold at the database, not only in application code (see
    audit_postgres.py's module docstring) — a missing trigger here would let a bad credential
    or a future bug quietly edit or erase the legal record."""
    _module, path = _load_migration("0004")
    source = path.read_text(encoding="utf-8")

    assert "audit is append-only" in source
    assert "CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit" in source
    assert "CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit" in source


def test_migration_0004_is_idempotent_for_the_hand_created_cloud_table():
    """The `audit` table already exists on the cloud database, created by hand before this
    migration existed. `alembic upgrade head` must not fail when it reaches 0004 there."""
    _module, path = _load_migration("0004")
    source = path.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS audit" in source
    assert "CREATE OR REPLACE FUNCTION audit_is_append_only" in source
    assert "DROP TRIGGER IF EXISTS audit_no_update" in source
    assert "DROP TRIGGER IF EXISTS audit_no_delete" in source


def test_no_migration_passes_multiple_statements_to_one_execute():
    """Every op.execute() must carry exactly one SQL statement.

    Migrations run through the async engine (alembic/env.py), and asyncpg prepares every statement
    it is handed, so a string containing several fails with "cannot insert multiple commands into a
    prepared statement". Nothing in the suite caught this when 0004 was written: the DB-backed
    fixture in this file talks to psycopg2, which accepts multi-statement strings, so the migration
    passed every test and then failed on the first real deployment.

    Applies to every migration, not just 0004 — the mistake is easy to repeat.
    """
    def statements(sql: str) -> int:
        # Semicolons inside $$ … $$ separate statements *within* a function body and are not
        # statement separators, so strip those spans before counting.
        stripped = re.sub(r"\$\$.*?\$\$", "", sql, flags=re.S).strip().rstrip(";")
        return stripped.count(";") + 1

    offenders: list[str] = []
    for path in sorted(_MIGRATIONS_DIR.glob("0*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))

        # Module-level `_NAME = "SQL"` constants, so an op.execute(_NAME) can be resolved.
        constants: dict[str, str] = {
            target.id: node.value.value
            for node in tree.body
            if isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
            for target in node.targets
            if isinstance(target, ast.Name)
        }

        # Only what is actually handed to op.execute() — scanning every string constant would
        # flag module docstrings that happen to describe what the migration creates.
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "execute"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "op"
                    and node.args):
                continue
            arg = node.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                sql, label = arg.value, arg.value
            elif isinstance(arg, ast.Name) and arg.id in constants:
                sql, label = constants[arg.id], arg.id
            else:
                continue                      # computed at runtime; not statically checkable
            if statements(sql) > 1:
                offenders.append(f"{path.name}: {label.strip()[:70]!r}")

    assert not offenders, (
        "these strings hold more than one SQL statement and will fail under asyncpg — "
        "split them into one op.execute() per statement:\n  " + "\n  ".join(offenders)
    )


def test_migration_0004_is_the_single_head():
    """Guards against a future migration accidentally branching off 0003 instead of 0004,
    which would give the chain two heads and make `alembic upgrade head` ambiguous."""
    revisions: dict[str, str | None] = {}
    for path in _MIGRATIONS_DIR.glob("0*.py"):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        revisions[module.revision] = module.down_revision

    children = set(revisions.values())
    heads = [rev for rev in revisions if rev not in children]

    assert heads == ["0004"], f"expected a single head '0004', found {heads}"
