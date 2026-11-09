# homunculus-engine/tests/test_tasks_postgres.py
"""G3-02: migration 0017 and the Postgres task store — round trip, encryption at rest, the settings
row, the permission statement, the downgrade. Runs only with TEST_DATABASE_URL (the disposable container)."""
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.tasks import DEFAULT_SETTINGS, TaskRow, TaskSettings, new_task
from homunculus.api.tasks_postgres import PostgresTaskStore
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]
T0 = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


@pytest.fixture()
def migrated(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    with sync.begin() as conn:
        # The tenants table (migration 0001): id, name, slug, country_code NOT NULL; no updated_at column.
        conn.execute(text("INSERT INTO tenants (id, slug, name, country_code, timezone, created_at) "
                          "VALUES (gen_random_uuid(), 'h1', 'H1', 'AZ', 'Asia/Baku', now())"))
    yield sync
    sync.dispose()


def test_round_trip_and_encryption_at_rest(migrated):
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        row = store.create(new_task(tenant="h1", patient_id="S-001", title="Pansuman · sağ kol", due_at=T0,
                                    target_role="nurse", created_by="hem.ayse", now=T0))
        assert store.get("h1", row.id) == row
        assert store.list("h1", since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1), patient_ids={"S-001"}) == [row]
        with migrated.connect() as conn:
            stored = conn.execute(text("SELECT title FROM tasks WHERE id = CAST(:id AS uuid)"), {"id": row.id}).scalar_one()
        assert stored.startswith("enc::v1::") and "Pansuman" not in stored
        closed = store.update(TaskRow(**{**row.__dict__, "state": "skipped", "closed_by": "hem.ayse", "closed_at": T0,
                                         "skip_reason": "ameliyatta"}))
        assert store.get("h1", row.id) == closed
        assert store.settings("h1") is None
        saved = store.save_settings("h1", TaskSettings(8, 20, 45, {**DEFAULT_SETTINGS.intervals, "b7": 30}), by="admin", now=T0)
        assert store.settings("h1") == saved and saved.intervals["b7"] == 30 and saved.intervals["b1_4"] is None
        assert store.timezone("h1") == "Asia/Baku" and store.timezone("h9") == "UTC"
        assert store.admitted_at("h1", "S-001") is None
    finally:
        store.close()


def test_the_permission_statement_is_idempotent(migrated):
    with migrated.begin() as conn:
        conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, created_at, updated_at) "
                          "SELECT gen_random_uuid(), id, 'nurse', 'Hemşire', '', false, false, now(), now() FROM tenants WHERE slug = 'h1'"))
        for _ in range(2):
            conn.execute(text("INSERT INTO group_permissions (group_id, permission) SELECT id, 'tasks.view' FROM groups "
                              "WHERE slug IN ('nurse','charge_nurse','physician','unit_physician','attending','rapid_response') "
                              "ON CONFLICT DO NOTHING"))
        n = conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission = 'tasks.view'")).scalar_one()
    assert n == 1


def test_downgrade_drops_only_the_new_objects(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0016")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    with sync.connect() as conn:
        names = {r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
    sync.dispose()
    assert "tasks" not in names and "task_settings" not in names and "protocol_settings" in names
