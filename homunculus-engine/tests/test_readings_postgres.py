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
    that arrives after the transfer is stamped with the new stay's row, and `patient_key` spans both. The arriving
    row names its source (G2-B1b, spec T6) as admission/service.py `transfer_patient` writes it: the readings store
    still stamps by the open row — its start is the move (`open_stays`), so a reading from before the move is not
    this row's — while the task store walks back to the stay's first kabul (X18, `tasks_postgres.STAY_WALK_BACK`)."""
    from homunculus.api.tasks_postgres import PostgresTaskStore
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        patient = _patient(conn, tenant, "H-0000001")
        source = _admission(conn, tenant, patient, "TRANSFERRED", protocol=None, hours_ago=30)
        arriving = _admission(conn, tenant, patient, "ACTIVE", protocol=KEY, hours_ago=2)
        conn.execute(text("UPDATE admissions SET source_admission_id = CAST(:source AS uuid) "
                          "WHERE id = CAST(:arriving AS uuid)"), {"source": source, "arriving": arriving})
    store, tasks = PostgresReadingStore(TEST_DATABASE_URL), PostgresTaskStore(TEST_DATABASE_URL)
    try:
        assert store.admission_of("h1", KEY) == arriving != source
        assert store.admission_of("h1", "H-0000001") is None       # the open row has a protocol: the H-number is no key
        [(key, began)] = store.open_stays("h1").items()
        now = datetime.now(timezone.utc)
        assert key == KEY and timedelta(minutes=110) < now - began < timedelta(minutes=130)       # the move
        assert timedelta(hours=29) < now - tasks.admitted_at("h1", KEY) < timedelta(hours=31)     # the first kabul
    finally:
        store.close()
        tasks.close()


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


def test_reconcile_files_voids_and_releases_on_the_real_table(migrated):
    """G3-05 (D7): the audit → table pass against Postgres — the `ON CONFLICT DO NOTHING` insert, the batch
    `have`, the conditional updates — and a second pass that does nothing."""
    from homunculus.api.audit import AuditEvent, InMemoryAuditLog
    from homunculus.api.clinical import RETRACT
    from homunculus.api.readings import CLAIM_STALE, READING_UNMATCHED, STATE_UNMATCHED, reconcile
    now = datetime.now(timezone.utc)
    when = now - timedelta(minutes=30)
    audit = InMemoryAuditLog()
    device = audit.append(AuditEvent("h1", "ingest", KEY, "sbp", {"value": 88.0, "unit": "mmHg", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
    audit.append(AuditEvent("h1", "chart", KEY, "resp_rate", {"value": 16.0, "unit": "/min", "obs_ts": when.isoformat(), "charted_by": "hem.ayse"}))
    audit.append(AuditEvent("h1", READING_UNMATCHED, "202600000010", "spo2", {"value": 97.0, "unit": "%", "obs_ts": when.isoformat(), "device": "CONNEX-3A", "reason": "unknown"}))
    audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {"entry": device.id, "code": "sbp", "value": 88.0, "obs_ts": when.isoformat(),
                                                        "reason": "manşet yanlış koldaydı", "retracted_by": "hem.ayse",
                                                        "origin": "device", "device": "CONNEX-3A"}))
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        counts = reconcile(store, audit, tenant="h1", now=now)
        assert (counts["recorded"], counts["unmatched"], counts["voided"]) == (2, 1, 1)
        rows = {r.code: r for r in store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=now)}
        assert rows["sbp"].void_reason == "manşet yanlış koldaydı" and rows["resp_rate"].recorded_by == "hem.ayse"
        [waiting] = store.unmatched("h1", since=now - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=now - CLAIM_STALE - timedelta(minutes=1))
        again = reconcile(store, audit, tenant="h1", now=now)
        assert again == {**dict.fromkeys(again, 0), "released": 1}
        assert store.get("h1", [waiting.id])[0].state == STATE_UNMATCHED
        assert not any(reconcile(store, audit, tenant="h1", now=now).values())
    finally:
        store.close()


def test_reconcile_reaches_every_copy_and_finishes_the_claims_on_the_real_table(migrated):
    """G3-05 (D7, D12, D13) on the real table: the table's `ON CONFLICT` answers None for the twin of a reading it
    holds (`skipped`, not a failure); a withdrawal naming one twin marks the row filed under the other — found by the
    reading's key at its exact instant; a claim whose link wrote its `ingest` row is finalized from it and one whose
    rejection was audited is closed — neither is released, though both are older than CLAIM_STALE."""
    from homunculus.api.audit import AuditEvent, InMemoryAuditLog
    from homunculus.api.clinical import RETRACT
    from homunculus.api.readings import (
        CLAIM_STALE, READING_REJECTED, READING_UNMATCHED, STATE_ASSIGNED, STATE_REJECTED, device_reading, reconcile,
    )
    from homunculus.canonical import Observation, SignalCode
    now = datetime.now(timezone.utc)
    when = now - timedelta(minutes=30)
    audit = InMemoryAuditLog()
    store = PostgresReadingStore(TEST_DATABASE_URL)
    try:
        sbp = {"value": 88.0, "unit": "mmHg", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}
        a = audit.append(AuditEvent("h1", "ingest", KEY, "sbp", sbp))
        b = audit.append(AuditEvent("h1", "ingest", KEY, "sbp", sbp))                 # one reading written twice
        held = Observation(patient_id=KEY, code=SignalCode("sbp"), value=88.0, unit="mmHg", timestamp=when,
                           source_device="CONNEX-3A")
        store.add(device_reading("h1", held, received_at=now, audit_id=b.id))        # the table's one row: B's
        gone = audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {
            "entry": a.id, "code": "sbp", "value": 88.0, "obs_ts": when.isoformat(), "reason": "manşet yanlış koldaydı",
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        for code, value in (("spo2", 97.0), ("heart_rate", 88.0)):
            audit.append(AuditEvent("h1", READING_UNMATCHED, "202600000010", code, {
                "value": value, "unit": "%", "obs_ts": when.isoformat(), "device": "CONNEX-3A", "reason": "unknown"}))
        first = reconcile(store, audit, tenant="h1", now=now)
        assert (first["recorded"], first["unmatched"], first["voided"], first["skipped"]) == (0, 2, 1, 1)
        [row] = store.for_patient("h1", KEY, since=when, until=when)
        assert (row.entry_id, row.voided_by, row.void_reason) == (b.id, "hem.ayse", "manşet yanlış koldaydı")
        assert row.voided_at == datetime.fromisoformat(gone.ts)
        spo2, heart = sorted(store.unmatched("h1", since=now - timedelta(days=7)), key=lambda r: r.code, reverse=True)
        old = now - CLAIM_STALE - timedelta(hours=1)
        store.claim("h1", [spo2.id, heart.id], by="hem.ayse", at=old)
        link = audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {
            "value": 97.0, "unit": "%", "obs_ts": when.isoformat(), "device": "CONNEX-3A", "reading": spo2.id,
            "actor": "hem.ayse"}))
        audit.append(AuditEvent("h1", READING_REJECTED, "202600000010", "reading", {
            "readings": [heart.id], "received_key": "202600000010", "device": "CONNEX-3A", "obs_ts": when.isoformat(),
            "reason": "yanlış numara girilmiş", "actor": "hem.ayse"}))
        second = reconcile(store, audit, tenant="h1", now=now)
        assert (second["finalized"], second["rejected"], second["released"]) == (1, 1, 0)
        linked, closed = store.get("h1", [spo2.id])[0], store.get("h1", [heart.id])[0]
        assert (linked.state, linked.patient_key, linked.entry_id, linked.resolved_by) == (STATE_ASSIGNED, KEY, link.id, "hem.ayse")
        assert (closed.state, closed.patient_key, closed.resolve_reason, closed.resolved_by) == (
            STATE_REJECTED, None, "yanlış numara girilmiş", "hem.ayse")
        assert store.claims("h1") == []
        third = reconcile(store, audit, tenant="h1", now=now)
        assert third == {**dict.fromkeys(third, 0), "skipped": 1}                    # the twin: present, every pass
    finally:
        store.close()


def test_reconcile_reads_the_real_audit_from_its_id_floor(migrated, monkeypatch):
    """B10 review: the hourly read must not walk the audit from its first row. With the real `audit` table the floor is
    found by point reads of the primary key, the first page is asked for after it, and what is filed is what a read of
    the whole window would have filed."""
    import homunculus.api.audit_postgres as audit_pg
    from homunculus.api.audit import AuditEvent
    from homunculus.api.audit_postgres import PostgresAuditLog
    from homunculus.api.readings import RECONCILE_WINDOW, reconcile

    class Reads(PostgresAuditLog):
        afters: list = []

        def records(self, **kw):
            self.afters.append(kw.get("after_id"))
            return super().records(**kw)
    now = datetime.now(timezone.utc)
    stamps = iter([(now - timedelta(days=5) + timedelta(minutes=i)).isoformat() for i in range(30)]
                  + [(now - timedelta(hours=1) + timedelta(minutes=i)).isoformat() for i in range(2)])
    monkeypatch.setattr(audit_pg, "_now_iso", lambda: next(stamps))
    audit, store = Reads(TEST_DATABASE_URL), PostgresReadingStore(TEST_DATABASE_URL)
    try:
        for i in range(32):
            audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {
                "value": 90.0 + i, "unit": "%", "obs_ts": (now - timedelta(minutes=40 - i)).isoformat(),
                "device": "CONNEX-3A"}))
        counts = reconcile(store, audit, tenant="h1", now=now, since=now - RECONCILE_WINDOW)
        assert (counts["recorded"], counts["skipped"]) == (2, 0)
        assert audit.afters[0] == 30                      # the thirty rows of five days ago are not read
        assert len(store.for_patient("h1", KEY, since=now - timedelta(days=1), until=now)) == 2
    finally:
        audit.dispose()
        store.close()


def test_the_backfill_files_an_open_stays_readings_on_the_real_tables(migrated, capsys):
    """G3-05 (D19, E-11) on the real tables: `open_stays` answers the stay's start from `admissions`, the audit is
    read from the real `audit` table with no 48-hour bound, only the readings measured since the stay began are
    filed — stamped with the admission — and a second run files nothing."""
    import importlib.util
    import json
    from homunculus.api.audit import AuditEvent
    from homunculus.api.audit_postgres import PostgresAuditLog
    from tests.conftest import ENGINE_ROOT
    spec = importlib.util.spec_from_file_location("backfill_vital_readings", ENGINE_ROOT / "scripts" / "backfill_vital_readings.py")
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    with migrated.begin() as conn:
        tenant = _tenant(conn, "h1")
        admission = _admission(conn, tenant, _patient(conn, tenant, "H-0000001"), "ACTIVE", protocol=KEY, hours_ago=5)
    now = datetime.now(timezone.utc)
    audit, store = PostgresAuditLog(TEST_DATABASE_URL), PostgresReadingStore(TEST_DATABASE_URL)
    try:
        def ingest(key, at, value):
            audit.append(AuditEvent("h1", "ingest", key, "spo2", {"value": value, "unit": "%", "obs_ts": at.isoformat(),
                                                                  "device": "CONNEX-3A"}))
        ingest(KEY, now - timedelta(days=3), 95.0)                       # an earlier stay under the same key
        ingest(KEY, now - timedelta(hours=2), 97.0)                      # this stay
        ingest("202600000002", now - timedelta(hours=2), 96.0)           # not an open stay
        assert script.run(["--tenant", "h1", "--open-only", "--dry-run"], audit=audit, store=store) == 0
        dry = json.loads(capsys.readouterr().out.split(" ", 1)[1])
        assert (dry["stays"], dry["recorded"], dry["dry_run"]) == (1, 1, True)
        assert store.for_patient("h1", KEY, since=now - timedelta(days=4), until=now) == []
        assert script.run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        assert json.loads(capsys.readouterr().out.split(" ", 1)[1])["recorded"] == 1
        [row] = store.for_patient("h1", KEY, since=now - timedelta(days=4), until=now)
        assert (row.value, row.admission_id) == (97.0, admission)
        assert script.run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        assert json.loads(capsys.readouterr().out.split(" ", 1)[1])["recorded"] == 0
    finally:
        audit.dispose()
        store.close()
