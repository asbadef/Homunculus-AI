# homunculus-engine/tests/test_unit_scope.py
"""Unit scope for the admission, discharge and bed routes (Group 2 · B1a, spec §4.5), and the
care team's own patients found by their Homunculus patient number (§4.3).

The decision (`reaches`) needs no database; reading a caller's scope and own patients does
(`db_session`). Synthetic tenants, users and patients only."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.admission.errors import Refusal
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.admission.unitscope import caller_scope, reach_clause, reaches, require_reach
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import TenantMembership
from homunculus.scope import Scope, build_scope
from homunculus.scope.models import StaffScope
from homunculus.scope.service import read_own_patient_ids
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.signed_in import add_user

UNIT_A, UNIT_B = uuid.uuid4(), uuid.uuid4()
BED_A1, BED_B1 = uuid.uuid4(), uuid.uuid4()
#: Numbers of fixture patients, written straight into the table: `H99…`, far from the live range
#: (`H` + year + a sequence that counts up from 1), so a fixture never takes a number the
#: generator will give.
FIXTURE_NUMBERS = ["H9900001", "H9900002"]


def _sql(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


def test_the_sql_reach_names_the_granted_units_and_beds_and_nothing_else():
    """`reach_clause` is `reaches` in the list's query (Task 8 review): no filter for an
    unrestricted scope; the unit or the bed granted otherwise. A grant typed in another case
    still reaches its row; an old free-text key names no row, as in `reaches`; no grant at all
    matches nothing."""
    assert reach_clause(build_scope("HOSPITAL_ADMIN"), unit_id=Unit.id, bed_id=Bed.id) is None
    scope = build_scope("MEMBER", unit_ids=[str(UNIT_A).upper(), "Reanimasiya"],
                        bed_ids=[str(BED_B1)], enforce_unassigned=True)
    text = _sql(reach_clause(scope, unit_id=Unit.id, bed_id=Bed.id))
    assert UNIT_A.hex in text.replace("-", "") and BED_B1.hex in text.replace("-", "")
    assert "Reanimasiya" not in text and UNIT_B.hex not in text.replace("-", "")
    nothing = build_scope("MEMBER", unit_ids=["Reanimasiya"], enforce_unassigned=True)
    assert _sql(reach_clause(nothing, unit_id=Unit.id, bed_id=Bed.id)) == \
        "units.id IN (NULL) AND (1 != 1) OR beds.id IN (NULL) AND (1 != 1)"     # never true


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


def test_a_missing_id_is_never_the_grant_named_none():
    """`str(None)` is "None", and a grant is free text, as the site's bed map names it: "none" is
    a name someone may type. A bed with no unit (or an id not resolved) matches no such grant."""
    scope = build_scope("MEMBER", unit_ids=["none"], bed_ids=["None"])
    assert not reaches(scope, unit_id=None, bed_id=None)
    assert not reaches(scope, unit_id=UNIT_A, bed_id=None)
    assert not reaches(scope, unit_id=None, bed_id=BED_A1)
    with pytest.raises(Refusal) as caught:
        require_reach(scope, unit_id=None, bed_id=None)
    assert (caught.value.status, caught.value.code) == (403, "out_of_scope")


def test_a_missing_id_does_not_cancel_the_other_one():
    """The unit of a bed that is itself granted, and the bed of a unit that is granted, each reach."""
    assert reaches(build_scope("MEMBER", bed_ids=[str(BED_A1)]), unit_id=None, bed_id=BED_A1)
    assert reaches(build_scope("MEMBER", unit_ids=[str(UNIT_A)]), unit_id=UNIT_A, bed_id=None)


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
async def test_a_nurse_granted_one_bed_reaches_that_bed_and_not_its_neighbour(db_session,
                                                                                monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    tenant, groups, unit, bed = await _ward(db_session)
    neighbour = Bed(room_id=bed.room_id, label="2")
    db_session.add(neighbour)
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    db_session.add(StaffScope(tenant_id=tenant.id, user_id=nurse.id, bed_id=str(bed.id)))
    await db_session.commit()

    scope = await caller_scope(db_session, nurse.id, tenant.id)
    assert not scope.unrestricted
    assert reaches(scope, unit_id=unit.id, bed_id=bed.id)
    assert not reaches(scope, unit_id=unit.id, bed_id=neighbour.id)


@requires_db
async def test_platform_support_reaches_every_bed_even_once_enforcement_is_on(db_session,
                                                                               monkeypatch):
    """Unassigned MEMBERs are unrestricted too until enforcement is on; with it on, only a role
    that is unrestricted by itself still passes."""
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    tenant, _groups, unit, bed = await _ward(db_session)
    support = await add_user(db_session, username="destek@example.com", tenant_id=tenant.id,
                             platform_support=True)

    scope = await caller_scope(db_session, support.id, tenant.id)
    assert (scope.unrestricted, scope.reason) == (True, "role")
    assert reaches(scope, unit_id=unit.id, bed_id=bed.id)


@requires_db
async def test_a_grant_that_names_none_of_our_beds_leaves_a_nurse_with_no_bed(db_session,
                                                                              monkeypatch):
    """A grant is text as the site's bed map names a place ("Reanimasiya", "A-12"). It narrows the
    nurse to what it matches — here nothing — rather than leaving her unassigned and unrestricted."""
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    tenant, groups, unit, bed = await _ward(db_session)
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    db_session.add_all([StaffScope(tenant_id=tenant.id, user_id=nurse.id, unit_id="Reanimasiya"),
                        StaffScope(tenant_id=tenant.id, user_id=nurse.id, bed_id="A-12")])
    await db_session.commit()

    scope = await caller_scope(db_session, nurse.id, tenant.id)
    assert (scope.unrestricted, scope.reason) == (False, "assigned")
    assert (scope.unit_ids, scope.bed_ids) == ({"reanimasiya"}, {"a-12"})
    assert not reaches(scope, unit_id=unit.id, bed_id=bed.id)


@requires_db
async def test_a_grant_in_another_hospital_reaches_nothing_here(db_session, monkeypatch):
    """Grants are read per tenant: a user who works in two hospitals and is granted this unit's id
    in the other one is, here, still an unassigned member (who reaches nothing once enforced)."""
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    tenant, groups, unit, bed = await _ward(db_session)
    elsewhere = Tenant(name="Sentetik Başqa Hastane", slug="sentetik-basqa", country_code="AZ")
    db_session.add(elsewhere)
    await db_session.flush()
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    db_session.add_all([TenantMembership(user_id=nurse.id, tenant_id=elsewhere.id),
                        StaffScope(tenant_id=elsewhere.id, user_id=nurse.id,
                                   unit_id=str(unit.id))])
    await db_session.commit()

    there = await caller_scope(db_session, nurse.id, elsewhere.id)
    assert there.unit_ids == {str(unit.id)}
    here = await caller_scope(db_session, nurse.id, tenant.id)
    assert (here.unrestricted, here.unit_ids, here.reason) == (False, frozenset(), "unassigned")
    assert not reaches(here, unit_id=unit.id, bed_id=bed.id)


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
                    sex="female", patient_number=FIXTURE_NUMBERS[0])
    both = Patient(tenant_id=tenant.id, display_name="Sentetik İki", date_of_birth="1971-01-01",
                   sex="male", patient_number=FIXTURE_NUMBERS[1], his_patient_reference="S-100")
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
    assert sorted(own) == [*FIXTURE_NUMBERS, "S-100"]


@requires_db
async def test_an_oncall_physician_owns_the_patient_number_only_inside_the_window(db_session):
    """§3.3: a time-boxed link is coverage while it runs. The number is found by the same window
    as the HIS reference — the board must not keep showing a patient to yesterday's on-call."""
    tenant, groups, unit, bed = await _ward(db_session)
    doctor = await add_user(db_session, username="nobetci@example.com", tenant_id=tenant.id,
                            group=groups["attending"])
    patient = Patient(tenant_id=tenant.id, display_name="Sentetik Üç", date_of_birth="1972-02-02",
                      sex="female", patient_number=FIXTURE_NUMBERS[0])
    db_session.add(patient)
    await db_session.flush()
    admission = Admission(tenant_id=tenant.id, patient_id=patient.id, admitting_unit_id=unit.id,
                          bed_id=bed.id, admission_datetime=tenant.created_at,
                          admission_diagnosis_free_text="Sentetik tanı")
    db_session.add(admission)
    await db_session.flush()
    start = datetime(2026, 10, 26, 8, 0, tzinfo=timezone.utc)
    end = start + timedelta(hours=12)
    db_session.add(CareTeamMember(admission_id=admission.id, user_id=doctor.id,
                                  role=CareTeamRole.ONCALL_PHYSICIAN,
                                  window_start=start, window_end=end))
    await db_session.commit()

    async def own(at):
        return await read_own_patient_ids(db_session, doctor.id, tenant.id, now=at)

    assert await own(start - timedelta(seconds=1)) == []
    assert await own(start) == [FIXTURE_NUMBERS[0]]
    assert await own(end) == [FIXTURE_NUMBERS[0]]
    assert await own(end + timedelta(seconds=1)) == []
