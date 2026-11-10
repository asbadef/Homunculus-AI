# homunculus-engine/tests/test_migration_0018_care_team_transfer.py
"""Migration 0018 (G2-B1c spec §5.1 with G2-B1b spec §5.9, D9) on the real chain (`clean_db`,
never `create_all`):
- the data is put right before the indexes: the open rows of closed admissions close; of two
  active attendings the newest stays (on a tie the greater id) and `attending_physician_id`
  follows her, the other is ended with `closed_at` set; a signed admission (ACTIVE,
  PENDING_DISCHARGE or PENDING_TRANSFER) whose attending has no row gets one (O45), and her other
  active row becomes it when she holds one; a DRAFT gets none, and nor does a signed admission
  that names no attending;
- then one active row per member and admission, and one active ATTENDING per admission, hold,
  and a member ended twice keeps two closed rows (F2);
- every `charge_nurse` group loses `care_team.claim`, and no other group does (D7); the default
  description loses «bakım ekibi», and a hospital's own is kept (X3);
- B1b's two columns exist, and the CHECK refuses a seventh reason;
- the downgrade restores the old key, drops the columns, and refuses loudly over a member with two
  closed rows on one admission, rolling back whole (columns, CHECK, group text and claim all as
  0018 left them); 0017 → 0018 → 0017 → 0018 runs.
Synthetic rows only. The revision before is G3-02's 0017 (tasks): it grants `tasks.*` only to the
groups that exist when it runs, and every group here is made after it."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.protocol.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]
ACTIVE, ATTENDING = "uq_care_team_active_member", "uq_care_team_one_attending"
CHECK = "ck_admissions_transfer_reason"
BEFORE = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi, bakım ekibi."
AFTER = "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi."
REASONS = ("CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST", "OTHER")
STATES = {"DRAFT", "ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER", "DISCHARGED", "TRANSFERRED"}
ROLES = {"ATTENDING", "ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN"}
T0 = datetime(2026, 11, 8, 20, 0, tzinfo=timezone.utc)


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _group(conn, tenant: uuid.UUID, slug: str, *permissions: str, description: str = BEFORE) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
        "created_at, updated_at) VALUES (:id, :t, :s, :s, :d, false, false, now(), now())"),
        {"id": gid, "t": tenant, "s": slug, "d": description})
    for key in permissions:
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) VALUES (:g, :p)"),
                     {"g": gid, "p": key})
    return gid


def _user(conn, name: str) -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO users (id, username, email, full_name, hashed_password, auth_source, "
        "totp_enabled, is_active, is_platform_support) VALUES (:id, :u, :u, 'Sentetik', 'x', "
        "'local', false, true, false)"), {"id": uid, "u": f"{name}@example.com"})
    return uid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Ana bina')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'Reanimasiya', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Otaq 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1')"),
                 {"id": bed, "r": room})
    return bed


def _admission(conn, tenant: uuid.UUID, number: str, state: str,
               attending: uuid.UUID | None = None) -> uuid.UUID:
    """A patient and one admission in `state` on a bed of its own, naming `attending`."""
    assert state in STATES                                  # written into the statement
    patient, admission, bed = uuid.uuid4(), uuid.uuid4(), _bed(conn, tenant)
    conn.execute(text("INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, "
                      "patient_number, created_at) VALUES (:id, :t, 'x', 'x', 'x', :n, now())"),
                 {"id": patient, "t": tenant, "n": number})
    conn.execute(text(
        "INSERT INTO admissions (id, patient_id, tenant_id, state, admission_datetime, "
        "admitting_unit_id, bed_id, admission_diagnosis_free_text, attending_physician_id) "
        f"SELECT :id, :p, :t, '{state}', now(), r.unit_id, b.id, 'Sentetik tanı', :a "
        "FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = :b"),
        {"id": admission, "p": patient, "t": tenant, "b": bed, "a": attending})
    return admission


def _row(conn, admission: uuid.UUID, user: uuid.UUID, role: str, *, active: bool = True,
         hours_ago: int = 0, window: tuple[datetime, datetime] | None = None,
         row_id: uuid.UUID | None = None) -> uuid.UUID:
    """One care-team row; a closed one is closed now. Rows made in one transaction with the same
    `hours_ago` share their `created_at` (`now()` is the transaction's); `row_id` fixes the id."""
    assert role in ROLES                                    # written into the statement
    rid = row_id or uuid.uuid4()
    start, end = window or (None, None)
    conn.execute(text(
        "INSERT INTO care_team_members (id, admission_id, user_id, role, is_active, created_at, "
        f"closed_at, window_start, window_end) VALUES (:id, :a, :u, '{role}', :active, "
        "now() - make_interval(hours => :h), CASE WHEN :active THEN NULL ELSE now() END, :ws, :we)"),
        {"id": rid, "a": admission, "u": user, "active": active, "h": hours_ago, "ws": start,
         "we": end})
    return rid


def low(n: int) -> uuid.UUID:
    """A fixed row id at the bottom of the id order (`n` tells two apart)."""
    return uuid.UUID(int=n)


def high(n: int) -> uuid.UUID:
    """A fixed row id at the top of the id order."""
    return uuid.UUID(int=2 ** 128 - n)


def _rows(conn, admission: uuid.UUID) -> list[tuple]:
    """(user, role, active, closed?, granted by, window start, window end), oldest first."""
    return [tuple(r) for r in conn.execute(text(
        "SELECT user_id, role::text, is_active, closed_at IS NOT NULL, granted_by_id, window_start, "
        "window_end FROM care_team_members WHERE admission_id = :a ORDER BY created_at, id"),
        {"a": admission}).all()]


def _attending(conn, admission: uuid.UUID):
    return conn.execute(text("SELECT attending_physician_id FROM admissions WHERE id = :a"),
                        {"a": admission}).scalar_one()


def test_0018_puts_the_care_team_right_before_its_indexes(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1, d2, d3 = (_user(conn, name) for name in ("d1", "d2", "d3"))
        two = _admission(conn, tenant, "H9900101", "ACTIVE", attending=d1)
        _row(conn, two, d1, "ATTENDING", hours_ago=2)
        _row(conn, two, d2, "ATTENDING", hours_ago=1)
        none = _admission(conn, tenant, "H9900102", "ACTIVE", attending=d3)
        oncall = _admission(conn, tenant, "H9900103", "PENDING_DISCHARGE", attending=d1)
        _row(conn, oncall, d1, "ONCALL_PHYSICIAN", window=(T0, T0 + timedelta(hours=12)))
        gone = _admission(conn, tenant, "H9900104", "DISCHARGED", attending=d2)
        _row(conn, gone, d2, "ASSOCIATE_PHYSICIAN")
        moved = _admission(conn, tenant, "H9900105", "TRANSFERRED", attending=d1)
        _row(conn, moved, d1, "ATTENDING")
        draft = _admission(conn, tenant, "H9900106", "DRAFT", attending=d1)
    command.upgrade(cfg, "0018")
    with engine.connect() as conn:
        # Step 3: of two attendings the newest stays, and the admission names her. The older row
        # is ended for good: inactive AND closed (`closed_at` set), not just flagged.
        assert [(user, role, active, closed) for user, role, active, closed, *_ in
                _rows(conn, two)] == [(d1, "ATTENDING", False, True), (d2, "ATTENDING", True, False)]
        assert _attending(conn, two) == d2
        # Step 4 (O45): a signed admission whose attending had no row gets one, granted by nobody.
        assert _rows(conn, none) == [(d3, "ATTENDING", True, False, None, None, None)]
        # ... and her own on-call row becomes it: one row, no window.
        assert _rows(conn, oncall) == [(d1, "ATTENDING", True, False, None, None, None)]
        # Step 2: a closed admission keeps no open row.
        assert [(user, active, closed) for user, _, active, closed, *_ in
                _rows(conn, gone) + _rows(conn, moved)] == [(d2, False, True), (d1, False, True)]
        # A DRAFT has no attending row yet (D3).
        assert _rows(conn, draft) == []


def test_the_backfill_covers_a_pending_transfer_and_leaves_an_unnamed_attending_alone(clean_db):
    """O45 (step 4) reaches every open, signed state: a PENDING_TRANSFER admission gets her row like
    an ACTIVE or a PENDING_DISCHARGE one does. A signed admission that names no attending gets
    none: there is nobody to write it for, and `attending_physician_id` stays NULL."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1 = _user(conn, "d1")
        leaving = _admission(conn, tenant, "H9900111", "PENDING_TRANSFER", attending=d1)
        unnamed = _admission(conn, tenant, "H9900112", "ACTIVE")
    command.upgrade(cfg, "0018")
    with engine.connect() as conn:
        assert _rows(conn, leaving) == [(d1, "ATTENDING", True, False, None, None, None)]
        assert _attending(conn, leaving) == d1
        assert _rows(conn, unnamed) == []
        assert _attending(conn, unnamed) is None


def test_two_attendings_made_in_the_same_instant_leave_the_one_with_the_greater_id(clean_db):
    """Step 3 ranks by `created_at DESC NULLS LAST, id DESC`: on a tie the greater id stays. The
    ids are fixed, and the two admissions put the greater one on different users and write it
    first and last, so the winner can only be the id. `attending_physician_id` starts on the loser
    and follows the kept row."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1, d2 = _user(conn, "d1"), _user(conn, "d2")
        high_first = _admission(conn, tenant, "H9900121", "ACTIVE", attending=d2)
        _row(conn, high_first, d1, "ATTENDING", row_id=high(1))
        _row(conn, high_first, d2, "ATTENDING", row_id=low(1))
        high_last = _admission(conn, tenant, "H9900122", "ACTIVE", attending=d1)
        _row(conn, high_last, d1, "ATTENDING", row_id=low(2))
        _row(conn, high_last, d2, "ATTENDING", row_id=high(2))
        for admission in (high_first, high_last):           # the tie is real, not assumed
            assert conn.execute(text("SELECT count(DISTINCT created_at) FROM care_team_members "
                                     "WHERE admission_id = :a"), {"a": admission}).scalar_one() == 1
    command.upgrade(cfg, "0018")
    with engine.connect() as conn:
        # `_rows` lists the smaller id first on a tie: the loser, ended and closed, then the keeper.
        assert [(user, active, closed) for user, _, active, closed, *_ in _rows(conn, high_first)] == [
            (d2, False, True), (d1, True, False)]
        assert _attending(conn, high_first) == d1
        assert [(user, active, closed) for user, _, active, closed, *_ in _rows(conn, high_last)] == [
            (d1, False, True), (d2, True, False)]
        assert _attending(conn, high_last) == d2


def test_then_one_active_row_per_member_and_one_attending_per_admission_hold(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        d1, d2 = _user(conn, "d1"), _user(conn, "d2")
        admission = _admission(conn, tenant, "H9900201", "ACTIVE", attending=d1)
    command.upgrade(cfg, "0018")                     # step 4 writes d1's ATTENDING row
    with engine.begin() as conn:
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)        # F2: ended twice
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN")
    with pytest.raises(IntegrityError, match=ACTIVE), engine.begin() as conn:
        _row(conn, admission, d2, "ONCALL_PHYSICIAN", window=(T0, T0 + timedelta(hours=1)))
    with pytest.raises(IntegrityError, match=ATTENDING), engine.begin() as conn:
        _row(conn, admission, _user(conn, "d3"), "ATTENDING")
    with engine.connect() as conn:
        defs = dict(conn.execute(text("SELECT indexname, indexdef FROM pg_indexes "
                                      "WHERE tablename = 'care_team_members'")).all())
    assert "UNIQUE" in defs[ACTIVE] and "(admission_id, user_id)" in defs[ACTIVE]
    assert "WHERE is_active" in defs[ACTIVE]
    assert "UNIQUE" in defs[ATTENDING] and "(admission_id)" in defs[ATTENDING]
    assert "'ATTENDING'::careteamrole" in defs[ATTENDING]


def test_the_charge_nurses_lose_the_claim_and_nobody_else_does(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        charge_a = _group(conn, a, "charge_nurse", "care_team.claim", "board.view")
        charge_b = _group(conn, b, "charge_nurse", "care_team.claim", "board.view",
                          description="Sentetik özel açıklama")
        attending = _group(conn, a, "attending", "care_team.claim", "care_team.assign",
                           description="Sentetik hekim grubu")
        own = _group(conn, a, "gece_ekibi", "care_team.claim", description="Sentetik ek görev")
    command.upgrade(cfg, "0018")
    with engine.connect() as conn:
        claim = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                      "WHERE permission = 'care_team.claim'")).scalars())
        kept = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                     "WHERE permission = 'board.view'")).scalars())
        described = dict(conn.execute(text("SELECT id, description FROM groups "
                                           "WHERE slug = 'charge_nurse'")).all())
    assert claim == {attending, own}
    assert kept == {charge_a, charge_b}
    assert described == {charge_a: AFTER, charge_b: "Sentetik özel açıklama"}       # X3


@pytest.mark.parametrize("reason", [*REASONS, None])
def test_a_transfer_reason_is_one_of_the_six_or_none(clean_db, reason):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        admission = _admission(conn, _tenant(conn, "hastane-a"), "H9900301", "ACTIVE")
        conn.execute(text("UPDATE admissions SET transfer_reason = :r, transfer_note = 'x' "
                          "WHERE id = :id"), {"r": reason, "id": admission})


def test_any_other_transfer_reason_is_refused(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        admission = _admission(conn, _tenant(conn, "hastane-a"), "H9900302", "ACTIVE")
    with pytest.raises(IntegrityError, match=CHECK), engine.begin() as conn:
        conn.execute(text("UPDATE admissions SET transfer_reason = 'TELEPORT' WHERE id = :id"),
                     {"id": admission})


def test_the_downgrade_restores_the_old_key_and_drops_the_columns(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        charge = _group(conn, tenant, "charge_nurse", "care_team.claim")
        d1 = _user(conn, "d1")
        admission = _admission(conn, tenant, "H9900401", "ACTIVE", attending=d1)
    command.upgrade(cfg, "0018")
    command.downgrade(cfg, "0017")
    with engine.connect() as conn:
        claim = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                      "WHERE permission = 'care_team.claim'")).scalars())
        described = conn.execute(text("SELECT description FROM groups WHERE id = :g"),
                                 {"g": charge}).scalar_one()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        kind = conn.execute(text("SELECT contype FROM pg_constraint WHERE conname = :n"),
                            {"n": ACTIVE}).scalar_one_or_none()
        partial = set(conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE tablename = 'care_team_members' "
            "AND indexdef LIKE '%WHERE%'")).scalars())
        backfilled = _rows(conn, admission)
    assert claim == {charge} and described == BEFORE and version == "0017"
    assert kind == "u" and partial == set()
    assert {"transfer_reason", "transfer_note"}.isdisjoint(
        {c["name"] for c in inspect(engine).get_columns("admissions")})
    # Rows written by steps 2–4 stay.
    assert backfilled == [(d1, "ATTENDING", True, False, None, None, None)]
    command.upgrade(cfg, "0018")


def test_the_downgrade_refuses_loudly_over_a_member_ended_twice(clean_db):
    """The old key cannot hold two closed rows of one member: the downgrade fails in its own
    transaction and leaves 0018 in place. The deploy notes' rollback block counts them first."""
    engine, cfg = clean_db
    command.upgrade(cfg, "0017")
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        charge = _group(conn, tenant, "charge_nurse", "care_team.claim")
        d1, d2 = _user(conn, "d1"), _user(conn, "d2")
        admission = _admission(conn, tenant, "H9900501", "ACTIVE", attending=d1)
    command.upgrade(cfg, "0018")
    with engine.begin() as conn:
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)
        _row(conn, admission, d2, "ASSOCIATE_PHYSICIAN", active=False)
    with pytest.raises(IntegrityError, match=ACTIVE):
        command.downgrade(cfg, "0017")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0018"
        # The whole downgrade rolled back, not just its last step: B1b's columns are still there,
        # and the charge nurse's group still lacks the claim and still carries the new text.
        claim = set(conn.execute(text("SELECT group_id FROM group_permissions "
                                      "WHERE permission = 'care_team.claim'")).scalars())
        described = conn.execute(text("SELECT description FROM groups WHERE id = :g"),
                                 {"g": charge}).scalar_one()
        constraint = conn.execute(text("SELECT count(*) FROM pg_constraint WHERE conname = :n"),
                                  {"n": CHECK}).scalar_one()
    assert {"transfer_reason", "transfer_note"} <= {
        c["name"] for c in inspect(engine).get_columns("admissions")}
    assert claim == set() and described == AFTER and constraint == 1


def test_the_model_and_the_migration_agree_on_the_transfer_columns(clean_db):
    """The care team's two indexes are held to one text in both places by Task 1's model test and
    the index test above; the columns' types are compared here."""
    engine, cfg = clean_db
    command.upgrade(cfg, "head")

    def only_0018(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name == "admissions"
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == "admissions" and name in {"transfer_reason", "transfer_note"}
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False, "include_object": only_0018})
        assert compare_metadata(ctx, Base.metadata) == []
        # compare_metadata reads no CHECK: it is read here, by name.
        assert conn.execute(text("SELECT count(*) FROM pg_constraint WHERE contype = 'c' "
                                 "AND conname = :n"), {"n": CHECK}).scalar_one() == 1
