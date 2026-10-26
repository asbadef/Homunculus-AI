# homunculus-engine/tests/test_migration_0012_kabul.py
"""Migration 0012 (Hasta Kabul, Group 2 · B1a) on a database built by the real chain (`clean_db`,
never `create_all`): every patient that existed before it gets a number in its tenant's year and
the counters continue after them; `beds.release` reaches the nurse and charge-nurse groups of every
tenant and no other group; existing beds stay open; the board identity gains its own bed and unit;
the model and the migration agree on every column 0012 owns; and 0011 → 0012 → 0011 → 0012 runs.
Sync tests on purpose (alembic runs its own event loop, see `clean_db`). Synthetic rows only."""
from __future__ import annotations

import uuid

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]

PATIENT_COLUMNS = {"patient_number", "father_name", "nationality", "national_id", "passport_no",
                   "phone", "relative_name", "relative_relation", "relative_phone",
                   "companion_name", "consent", "sms_permitted"}
ADMISSION_COLUMNS = {"admission_type", "blood_group", "allergies_text", "no_known_allergy",
                     "comorbidity_codes", "comorbidities_text", "discharge_disposition",
                     "discharge_institution", "discharge_reported_by", "discharge_at",
                     "discharge_note"}


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


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


def test_every_existing_patient_gets_a_number_in_its_tenants_utc_year(clean_db):
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
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


def test_the_downgrade_takes_it_all_away_and_the_upgrade_gives_it_back(clean_db):
    """0011 → 0012 → 0011 → 0012 on the real chain: the round trip a rollback and a re-deploy run."""
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")
    command.downgrade(cfg, "0011")

    assert not (PATIENT_COLUMNS & _columns(engine, "patients"))
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


def test_the_model_and_the_migration_agree_on_what_0012_owns(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    owned = {"patients": PATIENT_COLUMNS, "admissions": ADMISSION_COLUMNS, "beds": {"is_active"}}

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
