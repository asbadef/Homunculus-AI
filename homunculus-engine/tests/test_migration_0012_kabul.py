# homunculus-engine/tests/test_migration_0012_kabul.py
"""Migration 0012 (Hasta Kabul, Group 2 · B1a) on a database built by the real chain (`clean_db`,
never `create_all`): every patient that existed before it gets a number in its tenant's year and
the counters continue after them; `beds.release` reaches the nurse and charge-nurse groups of every
tenant and no other group; existing beds stay open; the board identity gains its own bed and unit;
the model and the migration agree on every column 0012 owns; and 0011 → 0012 → 0011 → 0012 runs.
Every encrypted column of `patients` — 0012's nine and 0002's four, which 0012 widens — holds the
ciphertext of the longest value the form takes in four-byte characters, over the real database;
the downgrade narrows 0002's four back and never cuts a ciphertext to do it.
Sync tests on purpose (alembic runs its own event loop, see `clean_db`). Synthetic rows only."""
from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from annotated_types import MaxLen
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.admission.models import Patient
from homunculus.admission.schemas import PatientIdentity
from homunculus.db import Base
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

PATIENT_COLUMNS = {"patient_number", "father_name", "nationality", "national_id", "passport_no",
                   "phone", "relative_name", "relative_relation", "relative_phone",
                   "companion_name", "consent", "sms_permitted"}
ENCRYPTED_0012 = {"father_name", "nationality", "national_id", "passport_no", "phone",
                  "relative_name", "relative_relation", "relative_phone", "companion_name"}
#: 0002's encrypted columns, which 0012 widens (and its downgrade narrows back to 512).
ENCRYPTED_0002 = {"display_name", "date_of_birth", "sex", "his_patient_reference"}
#: The width of every encrypted column (admission/models.py PHI_COLUMN_LENGTH): the longest name
#: the form takes (200 characters) in four-byte characters is 1173 characters of ciphertext.
PHI_WIDTH = 1536
FOUR_BYTES = "\U0001D400"                     # MATHEMATICAL BOLD CAPITAL A: four bytes in UTF-8
AZERBAIJANI = "əşçğıöüƏŞÇĞİÖÜ"               # two bytes each
#: 0012's four enums: the type's name in PostgreSQL → the table and column of the model that uses it.
ENUMS_0012 = {"consent": ("patients", "consent"),
              "admissiontype": ("admissions", "admission_type"),
              "bloodgroup": ("admissions", "blood_group"),
              "dischargedisposition": ("admissions", "discharge_disposition")}
ADMISSION_COLUMNS = {"admission_type", "blood_group", "allergies_text", "no_known_allergy",
                     "comorbidity_codes", "comorbidities_text", "discharge_disposition",
                     "discharge_institution", "discharge_reported_by", "discharge_at",
                     "discharge_note"}


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def _widths(engine, names: set[str]) -> dict[str, int | None]:
    lengths = {c["name"]: getattr(c["type"], "length", None)
               for c in inspect(engine).get_columns("patients")}
    return {name: lengths[name] for name in names}


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) "
                      "VALUES (:id, :n, :s, 'AZ')"), {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _patient(conn, tenant: uuid.UUID, created: str) -> uuid.UUID:
    pid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, created_at) "
        "VALUES (:id, :t, 'x', 'x', 'x', :c)"), {"id": pid, "t": tenant, "c": created})
    return pid


def _group(conn, tenant: uuid.UUID, slug: str) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, "
        "updated_at) VALUES (:id, :t, :s, :s, false, false, now(), now())"),
        {"id": gid, "t": tenant, "s": slug})
    return gid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Kampüs')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'YBÜ', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Oda 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1A')"),
                 {"id": bed, "r": room})
    return bed


def _before_0012(cfg, engine) -> dict:
    """A database at 0011 holding what a pilot may hold: patients of two tenants over two years,
    the default nurse groups and another, and a bed."""
    command.upgrade(cfg, "0011")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        rows = {
            "a25_first": _patient(conn, a, "2025-03-01T10:00:00+00:00"),
            "a25_second": _patient(conn, a, "2025-11-30T23:30:00+00:00"),
            # 02:00 on New Year's Day in Baku is still 2025 in UTC: the year is UTC's (§4.2).
            "a25_eve": _patient(conn, a, "2026-01-01T02:00:00+04:00"),
            "a26": _patient(conn, a, "2026-01-02T08:00:00+00:00"),
            "b26": _patient(conn, b, "2026-05-05T05:00:00+00:00"),
        }
        groups = {(t, slug): _group(conn, t, slug)
                  for t in (a, b) for slug in ("nurse", "charge_nurse", "attending")}
        bed = _bed(conn, a)
    return {"a": a, "b": b, "patients": rows, "groups": groups, "bed": bed}


@contextmanager
def _database_timezone(engine, zone: str):
    """The test database's own time zone, for every session opened while this runs (`ALTER
    DATABASE … SET timezone`), RESET afterwards whatever happens. Alembic opens its own connections,
    so this is the way to run a migration under another session time zone; the database is the
    shared test one (conftest.py serialises the runs), which had no setting of its own before."""
    with engine.connect() as conn:
        name = engine.dialect.identifier_preparer.quote(
            conn.execute(text("SELECT current_database()")).scalar_one())
    try:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER DATABASE {name} SET timezone TO '{zone}'"))
        # A connection opened now, not one from the pool: the setting must really apply.
        fresh = create_engine(engine.url, poolclass=NullPool)
        try:
            with fresh.connect() as conn:
                assert conn.execute(text("SHOW timezone")).scalar_one() == zone
        finally:
            fresh.dispose()
        yield
    finally:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER DATABASE {name} RESET timezone"))


def test_every_existing_patient_gets_a_number_in_its_tenants_utc_year(clean_db):
    """Run under Baku's session time zone (UTC+4), where 02:00 on 1 January is 2026 on the wall
    and 2025 in UTC: a migration that took the year from the session's wall clock, not from UTC,
    would give `a25_eve` H2600001 (a 2026 number) instead of H2500003, and `a26` the next."""
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    with _database_timezone(engine, "Asia/Baku"):
        command.upgrade(cfg, "0012")

    with engine.begin() as conn:
        numbers = dict(conn.execute(text("SELECT id, patient_number FROM patients")).all())
        counters = {(row[0], row[1]): row[2] for row in conn.execute(
            text("SELECT tenant_id, year, last FROM patient_number_counters")).all()}
    p = world["patients"]
    assert numbers == {p["a25_first"]: "H2500001", p["a25_second"]: "H2500002",
                       p["a25_eve"]: "H2500003", p["a26"]: "H2600001", p["b26"]: "H2600001"}
    assert counters == {(world["a"], 2025): 3, (world["a"], 2026): 1, (world["b"], 2026): 1}


def test_the_number_is_required_and_unique_within_a_tenant_only(clean_db):
    engine, cfg = clean_db
    _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    column = {c["name"]: c for c in inspect(engine).get_columns("patients")}["patient_number"]
    assert column["nullable"] is False
    uniques = {u["name"]: u["column_names"] for u in inspect(engine).get_unique_constraints("patients")}
    assert uniques["uq_patients_tenant_number"] == ["tenant_id", "patient_number"]


def test_beds_release_reaches_the_ward_nurses_of_every_tenant_and_nobody_else(clean_db):
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    with engine.begin() as conn:
        holders = set(conn.execute(text(
            "SELECT group_id FROM group_permissions WHERE permission = 'beds.release'")).scalars())
    g = world["groups"]
    assert holders == {g[(t, s)] for t in (world["a"], world["b"]) for s in ("nurse", "charge_nurse")}


def test_existing_beds_stay_open_and_the_identity_gains_its_own_bed(clean_db):
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    with engine.begin() as conn:
        assert conn.execute(text("SELECT is_active FROM beds WHERE id = :id"),
                            {"id": world["bed"]}).scalar_one() is True
    assert {"bed_id", "unit_id"} <= _columns(engine, "patient_identity")
    assert PATIENT_COLUMNS <= _columns(engine, "patients")
    assert ADMISSION_COLUMNS <= _columns(engine, "admissions")


def test_every_encrypted_column_is_wide_enough_for_the_longest_name(clean_db):
    engine, cfg = clean_db
    _before_0012(cfg, engine)
    assert _widths(engine, ENCRYPTED_0002) == dict.fromkeys(ENCRYPTED_0002, 512)
    command.upgrade(cfg, "0012")
    assert _widths(engine, ENCRYPTED_0002 | ENCRYPTED_0012) \
        == dict.fromkeys(ENCRYPTED_0002 | ENCRYPTED_0012, PHI_WIDTH)


def _longest_values(letters: str) -> dict[str, str]:
    """Every encrypted text field of the form at its schema's maximum, of these letters."""
    values = {}
    for name in ENCRYPTED_0012 | {"display_name", "his_patient_reference"}:
        bound = next(m.max_length for m in PatientIdentity.model_fields[name].metadata
                     if isinstance(m, MaxLen))
        values[name] = (letters * bound)[:bound]
    return values


async def _store_and_read(tenant: uuid.UUID, values: dict[str, str]) -> dict[str, str]:
    """Through the ORM and asyncpg, as the admission writes a patient; read back in a new session."""
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as session:
            patient = Patient(tenant_id=tenant, patient_number="H9900001",   # a fixture's, not live
                              date_of_birth="1970-01-01", sex="female", **values)
            session.add(patient)
            await session.commit()
            pid = patient.id
        async with maker() as session:
            stored = await session.get(Patient, pid)
            return {name: getattr(stored, name) for name in values}
    finally:
        await engine.dispose()


@pytest.mark.parametrize("letters", [FOUR_BYTES, AZERBAIJANI], ids=["four-byte", "azerbaijani"])
def test_the_longest_values_the_form_takes_store_and_read_back(clean_db, letters):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
    values = _longest_values(letters)
    assert len(values["display_name"]) == 200
    assert asyncio.run(_store_and_read(tenant, values)) == values


def test_the_downgrade_never_cuts_a_ciphertext_to_narrow_a_column(clean_db):
    """A value written since 0012 that no longer fits 512 stops the downgrade, and the migration's
    one transaction leaves everything as it was: a cut ciphertext would be a name nobody can read."""
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")
    wide = "enc::v1::" + "x" * 600
    with engine.begin() as conn:
        conn.execute(text("UPDATE patients SET display_name = :v WHERE id = :id"),
                     {"v": wide, "id": world["patients"]["a26"]})

    with pytest.raises(DBAPIError, match="too long"):
        command.downgrade(cfg, "0011")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0012"
        assert conn.execute(text("SELECT display_name FROM patients WHERE id = :id"),
                            {"id": world["patients"]["a26"]}).scalar_one() == wide
    assert PATIENT_COLUMNS <= _columns(engine, "patients")
    assert _widths(engine, ENCRYPTED_0002) == dict.fromkeys(ENCRYPTED_0002, PHI_WIDTH)


def test_the_downgrade_takes_it_all_away_and_the_upgrade_gives_it_back(clean_db):
    """0011 → 0012 → 0011 → 0012 on the real chain: the round trip a rollback and a re-deploy run."""
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")
    command.downgrade(cfg, "0011")

    assert not (PATIENT_COLUMNS & _columns(engine, "patients"))
    assert _widths(engine, ENCRYPTED_0002) == dict.fromkeys(ENCRYPTED_0002, 512)
    assert not (ADMISSION_COLUMNS & _columns(engine, "admissions"))
    assert "is_active" not in _columns(engine, "beds")
    assert not ({"bed_id", "unit_id"} & _columns(engine, "patient_identity"))
    assert "patient_number_counters" not in inspect(engine).get_table_names()
    with engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM group_permissions "
                                 "WHERE permission = 'beds.release'")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM patients")).scalar_one() == 5
        types = set(conn.execute(text("SELECT typname FROM pg_type WHERE typname IN "
                                      "('consent', 'admissiontype', 'bloodgroup', "
                                      "'dischargedisposition')")).scalars())
    assert types == set()

    command.upgrade(cfg, "0012")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT patient_number FROM patients WHERE id = :id"),
                            {"id": world["patients"]["a26"]}).scalar_one() == "H2600001"
    assert _widths(engine, ENCRYPTED_0002) == dict.fromkeys(ENCRYPTED_0002, PHI_WIDTH)


def test_the_model_and_the_migration_agree_on_what_0012_owns(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    owned = {"patients": PATIENT_COLUMNS | ENCRYPTED_0002, "admissions": ADMISSION_COLUMNS,
             "beds": {"is_active"}}

    def only_0012(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in {*owned, "patient_number_counters"}
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == "patient_number_counters" or name in owned.get(table, set())
        if type_ == "unique_constraint":
            return name == "uq_patients_tenant_number"
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": only_0012})
        assert compare_metadata(ctx, Base.metadata) == []

        # `compare_metadata` compares an enum column's type by its name, never by its labels: a
        # label the migration lacks is a 500 on the first admission that uses it, and one the model
        # lacks is a value the application cannot read.
        in_database = {name: list(conn.execute(text(
            "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
            "WHERE t.typname = :n ORDER BY e.enumsortorder"), {"n": name}).scalars())
            for name in ENUMS_0012}
    in_model = {}
    for name, (table, column) in ENUMS_0012.items():
        kind = Base.metadata.tables[table].c[column].type
        assert kind.name == name, f"{table}.{column} is the type {kind.name!r}, not {name!r}"
        in_model[name] = list(kind.enums)
    assert all(in_database.values()), in_database
    assert in_database == in_model
