"""One scope resolution, one session, two statements (dalga-perf 3b).

Every request that needs a staff scope calls the production resolver
(`api/prodserver._scope_resolver`), and the live wave panel asks about once a second per open
screen. It used to cost EIGHT SQL statements in TWO database sessions — `read_scope_for_user`
(tenant by slug, the grants, `read_role`'s user + membership + admin-group look-ups, the own
patients) and then `break_glass_patient_ids` (tenant by slug again, the open sessions).
`read_access_for_user` reads the same five answers — role, unit grants, bed grants, own patients,
break-glass patients — in one session: one row for the tenant, the account and the role, and one
`UNION ALL` for the three lists. Nothing is read past the first row when the answer is already
"sees nothing" (unknown or inactive tenant, unknown or inactive account, no active membership).

These tests pin both halves of that change: the COUNT, measured on the test engine through the
production wiring, and the MEANING, against the two readers it replaces, over a world that covers
every way a scope can be refused or narrowed — and against the values the world was built to give,
so the two readers cannot agree on a wrong answer unnoticed. Synthetic tenants, staff and patients
only.
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.jwt import create_access_token
from homunculus.auth.models import TenantMembership
from homunculus.escalation.models import BreakGlassReason, BreakGlassSession
from homunculus.scope.models import StaffScope
from homunculus.scope.resolver import (
    UNKNOWN, break_glass_patient_ids, make_scope_resolver, read_scope_for_user,
)
from homunculus.scope.rules import ScopeReason
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.signed_in import add_user
from tests.test_unit_scope import _ward

pytestmark = [pytest.mark.asyncio, requires_db]

HERE, ELSEWHERE, CLOSED, NOWHERE = "sentetik", "diger", "kapali", "yok-boyle-hastane"
SLUGS = (HERE, ELSEWHERE, CLOSED, NOWHERE)


@contextmanager
def counted(engine):
    """Every statement the engine sends to Postgres while the block runs."""
    statements: list[str] = []

    def count(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        yield statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)


@dataclass
class World:
    tenant: Tenant
    other: Tenant
    users: dict[str, uuid.UUID] = field(default_factory=dict)


async def _patient(db, tenant, number, his=None) -> Patient:
    patient = Patient(tenant_id=tenant.id, display_name="Sentetik Hasta", date_of_birth="1970-01-01",
                      sex="female", patient_number=number, his_patient_reference=his)
    db.add(patient)
    await db.flush()
    return patient


async def _admission(db, tenant_id, patient, unit, bed, protocol=None) -> Admission:
    admission = Admission(tenant_id=tenant_id, patient_id=patient.id, admitting_unit_id=unit.id,
                          bed_id=bed.id, admission_datetime=datetime.now(timezone.utc),
                          admission_diagnosis_free_text="Sentetik tanı", protocol_no=protocol)
    db.add(admission)
    await db.flush()
    return admission


def _link(db, admission, user, *, role=CareTeamRole.ATTENDING, start=None, end=None, active=True):
    db.add(CareTeamMember(admission_id=admission.id, user_id=user.id, role=role,
                          window_start=start, window_end=end, is_active=active))


def _glass(db, tenant, user, patient, *, minutes=30, closed=False):
    now = datetime.now(timezone.utc)
    db.add(BreakGlassSession(tenant_id=tenant.id, user_id=user.id, patient_id=patient.id,
                             reason=BreakGlassReason.CARDIAC_ARREST,
                             expires_at=now + timedelta(minutes=minutes),
                             closed_at=now if closed else None))


async def build_world(db) -> World:
    """A hospital here, one elsewhere, one that was switched off; staff who are refused in every
    way `read_role` refuses, staff who are not; and a physician whose scope uses every rule.

    The physician (`doctor`) holds, in THIS tenant:
      grants   — unit REA-01 and bed REA-02-1 (active); unit NICU (revoked); unit B-UNIT in the
                 other tenant.
      own      — a patient with both a HIS reference and a protocol (both identifiers); a legacy
                 admission (H-number); an ON-CALL link whose window is open — and ones that closed,
                 has not opened yet, or is no longer active; an admission of one of our patients
                 recorded under the other tenant.
      glass    — an open session on a patient with a HIS reference and two admissions here (a
                 protocol and a legacy one) and one admission elsewhere; an open one on a patient
                 with a HIS reference and no admission; an open one on a patient with neither; an
                 expired one; a closed one; one in the other tenant; one naming our tenant but
                 another tenant's patient. A nurse holds one more, which is not his.
    """
    tenant, groups, unit, bed = await _ward(db)              # tests/test_unit_scope.py: "sentetik"
    other = Tenant(name="Diger Hastane", slug=ELSEWHERE, country_code="AZ")
    closed = Tenant(name="Kapali Hastane", slug=CLOSED, country_code="AZ", is_active=False)
    db.add_all([other, closed])
    await db.flush()
    other_groups = await ensure_default_groups(db, other.id)
    closed_groups = await ensure_default_groups(db, closed.id)
    world = World(tenant=tenant, other=other)
    now = datetime.now(timezone.utc)

    doctor = await add_user(db, username="hekim@example.com", tenant_id=tenant.id,
                            group=groups["attending"])
    db.add(TenantMembership(user_id=doctor.id, tenant_id=closed.id))   # a closed hospital's member
    await set_manual_groups(db, user=doctor, tenant_id=closed.id,
                            group_ids=[closed_groups["hospital_admin"].id], granted_by_id=None)
    admin = await add_user(db, username="mudur@example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
    operator = await add_user(db, username="destek@example.com", tenant_id=tenant.id,
                              group=groups["hospital_admin"], platform_support=True)
    roaming_operator = await add_user(db, username="gezgin@example.com", platform_support=True)
    nurse = await add_user(db, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    # An administrator of the OTHER hospital, a plain member here: the system group is per tenant.
    split = await add_user(db, username="iki@example.com", tenant_id=tenant.id, group=groups["nurse"])
    db.add(TenantMembership(user_id=split.id, tenant_id=other.id))
    await set_manual_groups(db, user=split, tenant_id=other.id,
                            group_ids=[other_groups["hospital_admin"].id], granted_by_id=None)
    lapsed = await add_user(db, username="ayrilan@example.com", tenant_id=tenant.id,
                            group=groups["hospital_admin"])
    (await db.execute(select(TenantMembership).where(TenantMembership.user_id == lapsed.id))
     ).scalar_one().is_active = False
    stranger = await add_user(db, username="yabanci@example.com", tenant_id=other.id,
                              group=other_groups["nurse"])
    inactive = await add_user(db, username="pasif@example.com", tenant_id=tenant.id,
                              group=groups["nurse"])
    inactive.is_active = False

    # Grants. A revoked row, a row in the other tenant, and the grants of refused accounts.
    db.add_all([
        StaffScope(tenant_id=tenant.id, user_id=doctor.id, unit_id="REA-01", bed_id=""),
        StaffScope(tenant_id=tenant.id, user_id=doctor.id, unit_id="", bed_id="REA-02-1"),
        StaffScope(tenant_id=tenant.id, user_id=doctor.id, unit_id="NICU", bed_id="",
                   is_active=False, revoked_at=now),
        StaffScope(tenant_id=other.id, user_id=doctor.id, unit_id="B-UNIT", bed_id=""),
        StaffScope(tenant_id=tenant.id, user_id=admin.id, unit_id="ADMIN-UNIT", bed_id=""),
        StaffScope(tenant_id=tenant.id, user_id=inactive.id, unit_id="REA-01", bed_id=""),
        StaffScope(tenant_id=tenant.id, user_id=lapsed.id, unit_id="REA-01", bed_id=""),
        StaffScope(tenant_id=other.id, user_id=split.id, unit_id="B-UNIT", bed_id=""),
    ])

    # Own patients.
    both = await _patient(db, tenant, "H9900201", his="S-201")
    _link(db, await _admission(db, tenant.id, both, unit, bed, "202600000201"), doctor)
    legacy = await _patient(db, tenant, "H9900202")
    _link(db, await _admission(db, tenant.id, legacy, unit, bed), doctor)
    oncall = await _patient(db, tenant, "H9900203")
    _link(db, await _admission(db, tenant.id, oncall, unit, bed, "202600000203"), doctor,
          role=CareTeamRole.ONCALL_PHYSICIAN, start=now - timedelta(hours=1),
          end=now + timedelta(hours=1))
    handed_over = await _patient(db, tenant, "H9900204", his="S-204")
    _link(db, await _admission(db, tenant.id, handed_over, unit, bed, "202600000204"), doctor,
          role=CareTeamRole.ONCALL_PHYSICIAN, start=now - timedelta(hours=3),
          end=now - timedelta(hours=1))
    tonight = await _patient(db, tenant, "H9900205", his="S-205")
    _link(db, await _admission(db, tenant.id, tonight, unit, bed, "202600000205"), doctor,
          role=CareTeamRole.ONCALL_PHYSICIAN, start=now + timedelta(hours=1),
          end=now + timedelta(hours=3))
    unlinked = await _patient(db, tenant, "H9900206", his="S-206")
    _link(db, await _admission(db, tenant.id, unlinked, unit, bed, "202600000206"), doctor,
          active=False)
    crossed = await _patient(db, tenant, "H9900207", his="S-207")
    _link(db, await _admission(db, other.id, crossed, unit, bed, "202600000207"), doctor)
    _link(db, await _admission(db, tenant.id, await _patient(db, tenant, "H9900208", his="S-208"),
                               unit, bed, "202600000208"), admin)

    # Break-glass.
    glass = await _patient(db, tenant, "H9900301", his="S-301")
    await _admission(db, tenant.id, glass, unit, bed, "202600000301")
    await _admission(db, tenant.id, glass, unit, bed)                       # legacy: its H-number
    await _admission(db, other.id, glass, unit, bed, "202600000399")        # not this tenant's
    _glass(db, tenant, doctor, glass)
    _glass(db, tenant, doctor, await _patient(db, tenant, "H9900302", his="S-302"))
    _glass(db, tenant, doctor, await _patient(db, tenant, "H9900303"))     # neither: nothing
    _glass(db, tenant, doctor, await _patient(db, tenant, "H9900304", his="S-304"), minutes=-5)
    _glass(db, tenant, doctor, await _patient(db, tenant, "H9900305", his="S-305"), closed=True)
    theirs = await _patient(db, other, "H9900306", his="B-306")
    _glass(db, other, doctor, theirs)
    _glass(db, tenant, doctor, await _patient(db, other, "H9900307", his="B-307"))
    _glass(db, tenant, nurse, await _patient(db, tenant, "H9900308", his="S-308"))
    _glass(db, other, split, theirs)

    await db.commit()
    world.users = {
        "doctor": doctor.id, "admin": admin.id, "operator": operator.id,
        "roaming_operator": roaming_operator.id, "nurse": nurse.id, "split": split.id,
        "lapsed": lapsed.id, "stranger": stranger.id, "inactive": inactive.id,
        "unknown": uuid.uuid4(),
    }
    return world


#: What the world was built to give, IN THIS TENANT (`HERE`). Every other (user, tenant) pair not
#: listed in ROLES reads as None.
DOCTOR_HERE = ("MEMBER", {"REA-01"}, {"REA-02-1"},
               {"S-201", "202600000201", "H9900202", "202600000203"},
               {"S-301", "202600000301", "H9900301", "S-302"})
ROLES = {
    ("doctor", HERE): "MEMBER", ("admin", HERE): "HOSPITAL_ADMIN",
    ("operator", HERE): "PLATFORM_SUPPORT", ("nurse", HERE): "MEMBER",
    ("split", HERE): "MEMBER", ("split", ELSEWHERE): "HOSPITAL_ADMIN",
    ("stranger", ELSEWHERE): "MEMBER",
}


@pytest_asyncio.fixture
async def world(db_session, monkeypatch):
    """The world, with the readers' `homunculus.db.AsyncSessionLocal` on the test database — the
    production readers open their own sessions, as they do in production."""
    import homunculus.db

    monkeypatch.setattr(homunculus.db, "AsyncSessionLocal",
                        async_sessionmaker(db_session.bind, expire_on_commit=False))
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    return await build_world(db_session)


def _token(user_id, slug) -> str:
    return create_access_token(str(user_id), {"tenant": slug})


# ---------------------------------------------------------------- the count

async def test_a_member_with_grants_own_patients_and_break_glass_costs_two_statements(
        db_session, world):
    from homunculus.api.prodserver import _scope_resolver

    resolve = _scope_resolver()
    token = _token(world.users["doctor"], HERE)
    with counted(db_session.bind) as statements:
        scope = await resolve(token)
    # The scope it reads is the whole one — grants, own patients and break-glass all reached it.
    assert scope.reason == ScopeReason.ASSIGNED
    assert scope.unit_ids == frozenset({"rea-01"}) and scope.bed_ids == frozenset({"rea-02-1"})
    assert scope.own_patient_ids == frozenset(DOCTOR_HERE[3] | DOCTOR_HERE[4])
    assert len(statements) <= 2, statements


@pytest.mark.parametrize("who,slug", [("doctor", NOWHERE), ("doctor", CLOSED),
                                      ("stranger", HERE), ("lapsed", HERE),
                                      ("inactive", HERE), ("unknown", HERE)])
async def test_an_answer_of_nothing_costs_one_statement(db_session, world, who, slug):
    """Unknown or inactive tenant, no membership here, a lapsed membership, a deactivated or
    unknown account: the first row already says "sees nothing", and nothing more is read."""
    from homunculus.api.prodserver import _scope_resolver

    with counted(db_session.bind) as statements:
        scope = await _scope_resolver()(_token(world.users[who], slug))
    assert scope == UNKNOWN
    assert len(statements) == 1, statements


# ---------------------------------------------------------------- the meaning

async def _old(user_id, slug):
    role, units, beds, own = await read_scope_for_user(str(user_id), slug)
    glass = await break_glass_patient_ids(str(user_id), slug)
    return role, set(units), set(beds), set(own), set(glass)


async def _new(user_id, slug):
    from homunculus.scope.resolver import read_access_for_user

    role, units, beds, own, glass = await read_access_for_user(str(user_id), slug)
    return role, set(units), set(beds), set(own), set(glass)


async def test_the_one_session_reader_answers_what_the_two_readers_answered(world):
    """For every account against every tenant: the same role, and — wherever there is a role to
    read a scope for — the same grants, own patients and break-glass patients, as sets (the order
    of a list says nothing to `build_scope`, which takes frozensets)."""
    for who, user_id in world.users.items():
        for slug in SLUGS:
            old, new = await _old(user_id, slug), await _new(user_id, slug)
            assert new[0] == old[0] == ROLES.get((who, slug)), (who, slug, old, new)
            if old[0] is None:
                # Nothing past the first row is read for an answer of nothing, so there is nothing
                # to compare: the resolver turns role None into UNKNOWN either way.
                assert new == (None, set(), set(), set(), set()), (who, slug, new)
            else:
                assert new == old, (who, slug, old, new)
    assert await _new(world.users["doctor"], HERE) == DOCTOR_HERE
    assert await _new(world.users["admin"], HERE) == ("HOSPITAL_ADMIN", {"ADMIN-UNIT"}, set(),
                                                      {"S-208", "202600000208"}, set())
    assert await _new(world.users["nurse"], HERE) == ("MEMBER", set(), set(), set(), {"S-308"})
    assert await _new(world.users["split"], ELSEWHERE) == ("HOSPITAL_ADMIN", {"B-UNIT"}, set(),
                                                           set(), {"B-306"})


@pytest.mark.parametrize("enforce", [False, True], ids=["enforcement-off", "enforcement-on"])
async def test_the_board_decides_the_same_under_either_wiring(world, enforce):
    """The scope itself — what the boundary enforces — built through the old wiring and the new,
    for every account against every tenant, with enforcement of the unassigned off and on."""
    from homunculus.scope.resolver import read_access_for_user

    def decode(credential):
        user_id, slug = credential.split("|")
        return user_id, slug

    old = make_scope_resolver(read_scope_for_user, decode=decode,
                              break_glass=break_glass_patient_ids,
                              enforce_unassigned=lambda: enforce)
    new = make_scope_resolver(read_access=read_access_for_user, decode=decode,
                              enforce_unassigned=lambda: enforce)
    for who, user_id in world.users.items():
        for slug in SLUGS:
            credential = f"{user_id}|{slug}"
            assert await new(credential) == await old(credential), (who, slug)


async def test_the_his_reference_comes_back_decrypted_from_both_patient_branches(db_session, world):
    """`Patient.his_patient_reference` is encrypted at rest (`crypto.EncryptedString`). The lists
    come back as one UNION, whose column types are the first branch's: both patient branches must
    still decrypt, and the stored value must really be ciphertext for that to mean anything."""
    from sqlalchemy import text

    stored = (await db_session.execute(text(
        "SELECT his_patient_reference FROM patients WHERE patient_number = 'H9900201'"))).scalar_one()
    assert stored.startswith("enc::v1::") and "S-201" not in stored
    _role, _units, _beds, own, glass = await _new(world.users["doctor"], HERE)
    assert "S-201" in own and "S-301" in glass
    assert not any(ref.startswith("enc::") for ref in own | glass)
