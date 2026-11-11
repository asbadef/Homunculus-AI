# homunculus-engine/tests/test_tasks_postgres.py
"""G3-02: migration 0017 and the Postgres task store — round trip, encryption at rest, the settings
row, the permission statement, the downgrade. Runs only with TEST_DATABASE_URL (the disposable container)."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.tasks import DEFAULT_SETTINGS, TaskNotOpen, TaskRow, TaskSettings, new_task
from homunculus.api.tasks_postgres import PostgresTaskStore
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]
T0 = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)
#: The permission rows migration 0017 writes, as (group slug, permission).
_TASK_GRANTS = ("SELECT g.slug, gp.permission FROM group_permissions gp JOIN groups g ON g.id = gp.group_id "
                "WHERE gp.permission IN ('tasks.view', 'tasks.manage')")
#: G2-B1b (X18): the protocol a moved patient's open row holds (O8), and her H-number — a legacy
#: stay's board key. Synthetic.
_PROTOCOL = "202600000001"
_NUMBER = "H2600001"


def _tenant_with_groups(sync) -> None:
    """Tenant h1 with a `nurse` group (granted by 0017) and an `auditor` group (not granted)."""
    with sync.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, slug, name, country_code, timezone, created_at) "
                          "VALUES (gen_random_uuid(), 'h1', 'H1', 'AZ', 'Asia/Baku', now())"))
        for slug in ("nurse", "auditor"):
            conn.execute(text("INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
                              "created_at, updated_at) SELECT gen_random_uuid(), id, :slug, :slug, '', false, false, "
                              "now(), now() FROM tenants WHERE slug = 'h1'"), {"slug": slug})


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


def test_a_non_uuid_id_is_no_task(migrated):
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        row = store.create(new_task(tenant="h1", patient_id="S-001", title="Pansuman", due_at=T0,
                                    target_role="nurse", created_by="hem.ayse", now=T0))
        assert store.get("h1", "nope") is None
        assert store.get("h1", row.id.upper()) == row                    # the same uuid, another spelling
        with pytest.raises(KeyError):
            store.update(TaskRow(**{**row.__dict__, "id": "nope", "state": "done"}))
    finally:
        store.close()


def test_only_an_open_row_changes(migrated):
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        row = store.create(new_task(tenant="h1", patient_id="S-001", title="Pansuman", due_at=T0,
                                    target_role="nurse", created_by="hem.ayse", now=T0))
        done = store.update(TaskRow(**{**row.__dict__, "state": "done", "closed_by": "hem.ayse", "closed_at": T0}))
        with pytest.raises(TaskNotOpen):
            store.update(TaskRow(**{**row.__dict__, "state": "skipped", "closed_by": "hem.zeynep", "closed_at": T0,
                                    "skip_reason": "ameliyatta"}))
        assert store.get("h1", row.id) == done
        with pytest.raises(KeyError):
            store.update(new_task(tenant="h1", patient_id="S-001", title="x", due_at=T0, target_role="nurse",
                                  created_by="hem.ayse", now=T0))
        assert store.get("h2", row.id) is None                           # another tenant never reads it
    finally:
        store.close()


def test_the_migration_grants_both_keys_to_the_groups_that_already_exist(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0016")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenant_with_groups(sync)
        command.upgrade(cfg, "head")
        with sync.connect() as conn:
            grants = {tuple(r) for r in conn.execute(text(_TASK_GRANTS))}
    finally:
        sync.dispose()
    assert grants == {("nurse", "tasks.view"), ("nurse", "tasks.manage")}


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
    command.upgrade(cfg, "0016")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    try:
        _tenant_with_groups(sync)
        command.upgrade(cfg, "head")
        with sync.connect() as conn:
            assert len(conn.execute(text(_TASK_GRANTS)).all()) == 2
        command.downgrade(cfg, "0016")
        with sync.connect() as conn:
            names = {r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))}
            grants = conn.execute(text(_TASK_GRANTS)).all()
            groups = {r[0] for r in conn.execute(text("SELECT slug FROM groups"))}
    finally:
        sync.dispose()
    assert "tasks" not in names and "task_settings" not in names and "protocol_settings" in names
    assert grants == [] and groups == {"nurse", "auditor"}            # the rows go, the groups stay


def _tenant(sync, slug: str) -> None:
    """A second hospital beside the fixture's h1 (G2-B1b, X18)."""
    with sync.begin() as conn:
        conn.execute(text("INSERT INTO tenants (id, slug, name, country_code, timezone, created_at) "
                          "VALUES (gen_random_uuid(), :slug, upper(:slug), 'AZ', 'Asia/Baku', now())"),
                     {"slug": slug})


def _stay(sync, moves: int, *, protocol: str | None = _PROTOCOL, tenant: str = "h1",
          start: datetime = T0) -> list[str]:
    """One patient of `tenant`, admitted at `start` and moved `moves` times, an hour apart (G2-B1b):
    each move closes its row TRANSFERRED and opens the next on a bed of its own, its
    `source_admission_id` naming the row before (spec T6); the protocol is on the open row only
    (O8). Answers the admissions' ids, the first kabul first. Ids go in as text and are cast; a
    state is written into the statement (psycopg2 sends a parameter untyped, and the column is an
    enum)."""
    ids: list[str] = []
    with sync.begin() as conn:
        site, unit, room, patient = (str(uuid.uuid4()) for _ in range(4))
        conn.execute(text("INSERT INTO sites (id, tenant_id, name) SELECT CAST(:id AS uuid), id, "
                          "'Ana bina' FROM tenants WHERE slug = :t"), {"id": site, "t": tenant})
        conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (CAST(:id AS uuid), "
                          "CAST(:s AS uuid), 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
        conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (CAST(:id AS uuid), "
                          "CAST(:u AS uuid), 'Otaq 1')"), {"id": room, "u": unit})
        conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                          "patient_number, created_at) SELECT CAST(:id AS uuid), id, 'x', 'x', 'x', :n, "
                          "now() FROM tenants WHERE slug = :t"), {"id": patient, "n": _NUMBER, "t": tenant})
        source = None
        for n in range(moves + 1):
            bed, admission, last = str(uuid.uuid4()), str(uuid.uuid4()), n == moves
            state = "ACTIVE" if last else "TRANSFERRED"
            conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (CAST(:id AS uuid), "
                              "CAST(:r AS uuid), :l)"), {"id": bed, "r": room, "l": str(n + 1)})
            conn.execute(text(
                "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
                "admitting_unit_id, bed_id, admission_diagnosis_free_text, source_admission_id, "
                f"protocol_no) SELECT CAST(:id AS uuid), CAST(:p AS uuid), id, '{state}', :at, "
                "CAST(:u AS uuid), CAST(:b AS uuid), 'Sentetik tanı', CAST(:src AS uuid), :protocol "
                "FROM tenants WHERE slug = :t"),
                {"id": admission, "p": patient, "at": start + timedelta(hours=n), "u": unit, "b": bed,
                 "src": source, "protocol": protocol if last else None, "t": tenant})
            source = admission
            ids.append(admission)
    return ids


@pytest.mark.parametrize("protocol", [_PROTOCOL, None])
def test_a_moved_patients_vital_task_counts_from_her_first_kabul(migrated, protocol):
    """G2-B1b (the owner's answer of 2026-11-10, X18): a move closes its row and opens another at
    the move's time (spec T6). With no hand entry, a vital task is anchored on the stay's kabul
    (G3-02 D2), reached through `source_admission_id`: a task late before the move stays late after
    it. The key is the protocol, or a legacy stay's H-number. A second hospital that holds the same
    key (protocols and H-numbers are per tenant) reads its own patient's kabul, never h1's."""
    _stay(migrated, moves=2, protocol=protocol)
    _tenant(migrated, "h2")
    _stay(migrated, moves=0, protocol=protocol, tenant="h2", start=T0 + timedelta(days=1))
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        assert store.admitted_at("h1", protocol or _NUMBER) == T0
        assert store.admitted_at("h2", protocol or _NUMBER) == T0 + timedelta(days=1)
        assert store.admitted_at("h2", "202600000099") is None          # a key h2 does not hold
    finally:
        store.close()


def test_the_walk_back_never_leaves_the_tenant(migrated):
    """The CTE's `s.tenant_id = stay.tenant_id`: h2's open row is crafted (no route writes one) to
    name h1's first row as its source. h2 reads its own row's time; the walk never crosses into
    another hospital's admissions."""
    first_of_h1 = _stay(migrated, moves=2)[0]
    _tenant(migrated, "h2")
    (own,) = _stay(migrated, moves=0, tenant="h2", start=T0 + timedelta(days=1))
    with migrated.begin() as conn:
        conn.execute(text("UPDATE admissions SET source_admission_id = CAST(:h1 AS uuid) "
                          "WHERE id = CAST(:own AS uuid)"), {"h1": first_of_h1, "own": own})
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        assert store.admitted_at("h2", _PROTOCOL) == T0 + timedelta(days=1)
        assert store.admitted_at("h1", _PROTOCOL) == T0
    finally:
        store.close()


def test_a_chain_written_wrong_by_hand_ends_at_the_bound(migrated):
    """A row that names itself as its source (no route writes one): the walk stops at
    `_MOST_MOVES` and answers that row's own time; it never loops."""
    _stay(migrated, moves=0)
    with migrated.begin() as conn:
        conn.execute(text("UPDATE admissions SET source_admission_id = id"))
    store = PostgresTaskStore(TEST_DATABASE_URL)
    try:
        assert store.admitted_at("h1", _PROTOCOL) == T0
    finally:
        store.close()
