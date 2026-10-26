# homunculus-engine/tests/test_unit_scope.py
"""Unit scope for the admission, discharge and bed routes (Group 2 · B1a, spec §4.5), and the
care team's own patients found by their Homunculus patient number (§4.3).

The decision (`reaches`) needs no database; reading a caller's scope and own patients does
(`db_session`). Synthetic tenants, users and patients only."""
from __future__ import annotations

import uuid

import pytest

from homunculus.admission.errors import Refusal
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.admission.unitscope import caller_scope, reaches, require_reach
from homunculus.auth.groups import ensure_default_groups
from homunculus.scope import Scope, build_scope
from homunculus.scope.models import StaffScope
from homunculus.scope.service import read_own_patient_ids
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.signed_in import add_user

UNIT_A, UNIT_B = uuid.uuid4(), uuid.uuid4()
BED_A1, BED_B1 = uuid.uuid4(), uuid.uuid4()


def test_an_unrestricted_scope_reaches_every_bed():
    for scope in (build_scope("HOSPITAL_ADMIN"), build_scope("MEMBER")):     # admin; unassigned
        assert reaches(scope, unit_id=UNIT_B, bed_id=BED_B1)


def test_a_unit_grant_reaches_that_units_beds_and_no_other():
    scope = build_scope("MEMBER", unit_ids=[str(UNIT_A)])
    assert reaches(scope, unit_id=UNIT_A, bed_id=BED_A1)
    assert not reaches(scope, unit_id=UNIT_B, bed_id=BED_B1)


def test_a_bed_grant_reaches_that_bed_alone():
    scope = build_scope("MEMBER", bed_ids=[str(BED_B1)])
    assert reaches(scope, unit_id=UNIT_B, bed_id=BED_B1)
    assert not reaches(scope, unit_id=UNIT_B, bed_id=uuid.uuid4())


def test_grants_are_compared_whatever_their_case():
    scope = build_scope("MEMBER", unit_ids=[str(UNIT_A).upper()])
    assert reaches(scope, unit_id=UNIT_A, bed_id=BED_A1)


def test_an_unassigned_caller_reaches_nothing_once_enforcement_is_on():
    assert not reaches(build_scope("MEMBER", enforce_unassigned=True), unit_id=UNIT_A,
                       bed_id=BED_A1)
    assert not reaches(Scope(False, "unknown"), unit_id=UNIT_A, bed_id=BED_A1)


def test_out_of_scope_is_a_403_with_its_code():
    with pytest.raises(Refusal) as caught:
        require_reach(build_scope("MEMBER", unit_ids=[str(UNIT_A)]), unit_id=UNIT_B,
                      bed_id=BED_B1)
    assert (caught.value.status, caught.value.code) == (403, "out_of_scope")


# ---------------------------------------------------------------- read from the database
async def _ward(db):
    tenant = Tenant(name="Sentetik Hastane", slug="sentetik", country_code="AZ")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    site = Site(tenant_id=tenant.id, name="Kampüs")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Otaq 1")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="1")
    db.add(bed)
    await db.flush()
    return tenant, groups, unit, bed


@requires_db
async def test_a_nurse_granted_a_unit_by_its_uuid_reaches_its_beds(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    tenant, groups, unit, bed = await _ward(db_session)
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    db_session.add(StaffScope(tenant_id=tenant.id, user_id=nurse.id, unit_id=str(unit.id)))
    await db_session.commit()

    scope = await caller_scope(db_session, nurse.id, tenant.id)
    assert reaches(scope, unit_id=unit.id, bed_id=bed.id)
    assert not reaches(scope, unit_id=uuid.uuid4(), bed_id=uuid.uuid4())


@requires_db
async def test_an_administrator_and_an_unassigned_nurse_reach_every_bed(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    tenant, groups, unit, bed = await _ward(db_session)
    admin = await add_user(db_session, username="admin@example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    for user in (admin, nurse):
        assert (await caller_scope(db_session, user.id, tenant.id)).unrestricted
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    assert not reaches(await caller_scope(db_session, nurse.id, tenant.id),
                       unit_id=unit.id, bed_id=bed.id)


@requires_db
async def test_someone_with_no_membership_here_reaches_nothing(db_session):
    tenant, _groups, unit, bed = await _ward(db_session)
    stranger = await add_user(db_session, username="yad@example.com")
    scope = await caller_scope(db_session, stranger.id, tenant.id)
    assert scope.reason == "unknown"
    assert not reaches(scope, unit_id=unit.id, bed_id=bed.id)


@requires_db
async def test_the_care_teams_own_patients_are_found_by_their_patient_number(db_session):
    tenant, groups, unit, bed = await _ward(db_session)
    doctor = await add_user(db_session, username="hekim@example.com", tenant_id=tenant.id,
                            group=groups["attending"])
    kabul = Patient(tenant_id=tenant.id, display_name="Sentetik Bir", date_of_birth="1970-01-01",
                    sex="female", patient_number="H2600007")
    both = Patient(tenant_id=tenant.id, display_name="Sentetik İki", date_of_birth="1971-01-01",
                   sex="male", patient_number="H2600008", his_patient_reference="S-100")
    db_session.add_all([kabul, both])
    await db_session.flush()
    for patient in (kabul, both):
        admission = Admission(tenant_id=tenant.id, patient_id=patient.id,
                              admitting_unit_id=unit.id, bed_id=bed.id,
                              admission_datetime=tenant.created_at,
                              admission_diagnosis_free_text="Sentetik tanı")
        db_session.add(admission)
        await db_session.flush()
        db_session.add(CareTeamMember(admission_id=admission.id, user_id=doctor.id,
                                      role=CareTeamRole.ATTENDING))
    await db_session.commit()

    own = await read_own_patient_ids(db_session, doctor.id, tenant.id)
    assert sorted(own) == ["H2600007", "H2600008", "S-100"]
