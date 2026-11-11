# homunculus-engine/tests/test_readings_postgres.py
"""G3-05: the Postgres ReadingStore on migration 0021's table — the contract every store passes
(tests/readings_contract.py), and the admission a card key is stamped with (spec D8): an open admission, a
DRAFT, a legacy H-number key, a transferred stay. Runs only with TEST_DATABASE_URL (the throwaway container).
Synthetic rows only."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from sqlalchemy import create_engine, text

from homunculus.api.audit_postgres import to_sync_url
from homunculus.api.readings_postgres import PostgresReadingStore
from tests.conftest import TEST_DATABASE_URL, requires_db
from tests.readings_contract import KEY, T0, ReadingStoreContract, device, unmatched

pytestmark = [requires_db]
STATES = {"DRAFT", "ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER", "DISCHARGED", "TRANSFERRED"}


@pytest.fixture()
def migrated(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    sync = create_engine(to_sync_url(TEST_DATABASE_URL))
    yield sync
    sync.dispose()


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _bed(conn, tenant: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"), {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"),
                 {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"), {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"), {"id": bed, "r": room})
    return unit, bed


def _patient(conn, tenant: uuid.UUID, number: str) -> uuid.UUID:
    pid = uuid.uuid4()
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, patient_number, "
                      "created_at) VALUES (:id, :t, 'x', 'x', 'x', :n, now())"), {"id": pid, "t": tenant, "n": number})
    return pid


def _admission(conn, tenant: uuid.UUID, patient: uuid.UUID, state: str, *, protocol: str | None,
               hours_ago: int = 1) -> str:
    """One admission of `patient` in `state`, on a bed of its own, `hours_ago` old."""
    assert state in STATES                                  # written into the statement
    unit, bed = _bed(conn, tenant)
    admission = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, admitting_unit_id, bed_id, "
        f"admission_diagnosis_free_text, protocol_no) VALUES (:id, :p, :t, '{state}', "
        "now() - make_interval(hours => :h), :u, :b, 'Sentetik tanı', :protocol)"),
        {"id": admission, "p": patient, "t": tenant, "h": hours_ago, "u": unit, "b": bed, "protocol": protocol})
    return str(admission)


class TestPostgresReadingStore(ReadingStoreContract):
    @pytest.fixture()
    def store(self, migrated):
        store = PostgresReadingStore(TEST_DATABASE_URL)
        yield store
        store.close()


def test_the_postgres_store_is_durable(migrated):
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.durable is True
    finally:
        store.close()


def test_the_rows_are_in_the_table_with_the_stay(migrated):
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), "ACTIVE", protocol=KEY)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        from dataclasses import replace
        saved = store.add(replace(device(audit_id=11), admission_id=admission))
        assert saved.admission_id == admission and store.get("h1", [saved.id]) == [saved]
        with migrated.connect() as conn:
            row = conn.execute(text("SELECT tenant, received_key, patient_key, CAST(admission_id AS text), code, "
                                    "value, origin, state, audit_id, entry_id FROM vital_readings")).one()
        assert tuple(row) == ("h1", KEY, KEY, admission, "spo2", 97.0, "device", "recorded", 11, 11)
    finally:
        store.close()


@pytest.mark.parametrize("state", ["ACTIVE", "DRAFT", "PENDING_DISCHARGE", "PENDING_TRANSFER"])
def test_an_open_admission_is_found_by_its_protocol(migrated, state):
    """D8: a DRAFT has a card from POST /admissions, so it is a valid target."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), state, protocol=KEY)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) == admission
        assert store.admission_of("h1", "H-0000001") is None       # the protocol is the key now, not the H-number
        assert store.admission_of("h2", KEY) is None
        [(key, began)] = store.open_stays("h1").items()
        assert key == KEY and began.utcoffset() == timedelta(0)
        assert timedelta(minutes=50) < datetime.now(timezone.utc) - began < timedelta(minutes=70)   # `hours_ago=1`
    finally:
        store.close()


def test_a_legacy_admission_is_found_by_its_h_number(migrated):
    """An admission from before 0015 has no protocol: its card key is the patient's H-number (boardkey.py)."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000007"), "ACTIVE", protocol=None)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", "H-0000007") == admission
        assert set(store.open_stays("h1")) == {"H-0000007"}
    finally:
        store.close()


def test_two_open_legacy_stays_of_one_key_answer_with_the_newest(migrated):
    """Two open admissions from before 0015 share the patient's H-number: `admission_of` takes the newest, and so
    must `open_stays` (its dict keeps the last row, so the SQL lists the stays oldest first). Only one admission
    of a patient may be ACTIVE (uq_one_active_admission_per_patient): the older stay is awaiting discharge, a
    DRAFT is the new one. The newer is inserted FIRST, so a query with no ORDER BY would keep the older."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        patient = _patient(conn, tenant, "H-0000007")
        newer = _admission(conn, tenant, patient, "DRAFT", protocol=None, hours_ago=2)
        older = _admission(conn, tenant, patient, "PENDING_DISCHARGE", protocol=None, hours_ago=30)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", "H-0000007") == newer != older
        [(key, began)] = store.open_stays("h1").items()
        assert key == "H-0000007"
        assert timedelta(minutes=110) < datetime.now(timezone.utc) - began < timedelta(minutes=130)   # `hours_ago=2`
    finally:
        store.close()


def test_a_closed_admission_is_no_target(migrated):
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), "DISCHARGED", protocol=KEY)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) is None and store.open_stays("h1") == {}
    finally:
        store.close()


def test_after_a_transfer_the_key_names_the_arriving_admission(migrated):
    """O8: the arriving row takes the protocol over and the source row, TRANSFERRED, gives it up — so a reading
    that arrives after the transfer is stamped with the new stay's row, and `patient_key` spans both."""
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        patient = _patient(conn, tenant, "H-0000001")
        source = _admission(conn, tenant, patient, "TRANSFERRED", protocol=None, hours_ago=30)
        arriving = _admission(conn, tenant, patient, "ACTIVE", protocol=KEY, hours_ago=2)
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) == arriving != source
        assert store.admission_of("h1", "H-0000001") is None       # the open row has a protocol: the H-number is no key
    finally:
        store.close()


def test_a_claim_that_fails_changes_no_row(migrated):
    """All or nothing in one transaction: the update of the rows that were waiting is rolled back."""
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        from homunculus.api.readings import STATE_UNMATCHED, ReadingNotUnmatched
        a = store.add(unmatched("spo2", 97.0, audit_id=1))
        b = store.add(unmatched("heart_rate", 88.0, audit_id=2))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [a.id, b.id], by="hem.zeynep", at=T0 + timedelta(minutes=1))
        assert store.get("h1", [b.id])[0].state == STATE_UNMATCHED
        assert store.get("h1", [a.id])[0].resolved_by == "hem.ayse"
    finally:
        store.close()


def test_times_come_back_in_utc(migrated):
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        baku = timezone(timedelta(hours=4))
        saved = store.add(device(at=datetime(2026, 11, 11, 13, 0, tzinfo=baku), audit_id=1))
        assert saved.observed_at == T0 and saved.observed_at.utcoffset() == timedelta(0)
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True
    finally:
        store.close()
