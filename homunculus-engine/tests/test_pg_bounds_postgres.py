"""The bounds as the server holds them (spec 2026-11-01-pg-sinirlari-design.md).

tests/test_pg_bounds.py shows what each engine asks libpq for, without a database; these show that
Postgres took it — `SHOW statement_timeout` on a connection from each store's own engine — and that
a transaction's own bound (SET LOCAL) holds inside it and is gone when the same pooled connection
is checked out again. They run against a real Postgres (TEST_DATABASE_URL) and touch no table.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from homunculus.api.audit_postgres import (
    AUDIT_READ_STATEMENT_TIMEOUT_MS, PostgresAuditLog, set_local_statement_timeout,
)
from homunculus.api.monitor_samples import (
    PRUNE_STATEMENT_TIMEOUT_MS, REPLAY_STATEMENT_TIMEOUT_MS, PostgresSamples,
)
from homunculus.api.patient_identity_postgres import PostgresIdentityStore
from tests.conftest import TEST_DATABASE_URL, requires_db


def _show(conn) -> str:
    return conn.execute(text("SHOW statement_timeout")).scalar_one()


def _backend(conn) -> int:
    return conn.execute(text("SELECT pg_backend_pid()")).scalar_one()


def _release(store) -> None:
    (store.close if isinstance(store, PostgresIdentityStore) else store.dispose)()


@requires_db
@pytest.mark.parametrize("make, shown", [
    pytest.param(PostgresAuditLog, "10s", id="audit"),
    pytest.param(PostgresIdentityStore, "2s", id="identity"),
    pytest.param(PostgresSamples, "2s", id="samples"),
])
def test_each_engines_statement_bound_is_the_servers(make, shown):
    store = make(TEST_DATABASE_URL)
    try:
        with store._engine.connect() as conn:                     # noqa: SLF001 — the engine's own
            assert _show(conn) == shown
    finally:
        _release(store)


@requires_db
@pytest.mark.parametrize("make, bound, inside, after", [
    pytest.param(PostgresSamples, REPLAY_STATEMENT_TIMEOUT_MS, "30s", "2s", id="samples-replay"),
    pytest.param(PostgresSamples, PRUNE_STATEMENT_TIMEOUT_MS, "1min", "2s", id="samples-prune"),
    pytest.param(PostgresAuditLog, AUDIT_READ_STATEMENT_TIMEOUT_MS, "30s", "10s", id="audit-read"),
])
def test_a_transactions_own_bound_holds_in_it_and_is_gone_from_the_next_checkout(
        make, bound, inside, after):
    store = make(TEST_DATABASE_URL)
    try:
        with store._engine.begin() as conn:                       # noqa: SLF001
            set_local_statement_timeout(conn, bound)
            assert _show(conn) == inside
            backend = _backend(conn)
        with store._engine.connect() as conn:                     # noqa: SLF001
            assert _backend(conn) == backend, "the same pooled connection, checked out again"
            assert _show(conn) == after
    finally:
        _release(store)
