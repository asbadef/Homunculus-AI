# homunculus-engine/tests/test_care_team_service.py
"""The care team's service (G2-B1c, spec T1, T4, D2, D4, F2), below the routes:
- `is_physician`: an active account, an active membership of THIS tenant, a group among
  `PHYSICIAN_GROUPS` — never a nurse, a charge nurse, an administrator or an auditor (T1);
- `set_attending`: the previous attending's row ends, her own other row ends (a promoted associate
  holds one row), the admission names her, her row is written (T4);
- `end_care_team_member`: a row closes and stays; a member ended twice keeps both rows (F2).
Postgres. Synthetic ward: tests/kabul_world.py.

`add_physician`, `physician_elsewhere` and `active_admission` are the slice's helpers; the other
care-team test files import them."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import select, update

from homunculus.admission import service
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.kabul_world import build_ward
from tests.signed_in import add_user, bearer

pytestmark = [requires_db]

T0 = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


async def add_physician(db, w, name: str, *, group: str = "physician",
                        unit: str | None = "rea") -> uuid.UUID:
    """A physician added to the synthetic ward inside a test: a member of its tenant in the default
    group `group` (`attending`, `unit_physician` or `physician`; any other slug makes a
    non-physician), granted `unit` (None: no grant at all), signed in as `w.auth[name]`. Her
    `full_name` is `name` (`add_user`). Committed. Returns her id, read before anything can
    expire the row."""
    groups = await ensure_default_groups(db, w.tenant.id)
    user = await add_user(db, username=f"{name}@kabul.example.com", tenant_id=w.tenant.id,
                          group=groups[group])
    user_id = user.id
    if unit is not None:
        db.add(StaffScope(tenant_id=w.tenant.id, user_id=user_id, unit_id=str(w.units[unit].id)))
        await db.commit()
    w.users[name] = user
    w.auth[name] = await bearer(db, user)
    return user_id


async def physician_elsewhere(db, *, member_of: uuid.UUID | None = None) -> uuid.UUID:
    """A physician of ANOTHER tenant, who is no physician here. With `member_of` (a tenant id) she
    is also an active member of that tenant, in no group of it: the one case where only the group's
    own tenant keeps her from being a physician there (T1). Without it she is rejected by the
    membership alone."""
    other = Tenant(name="Sentetik Başka Hastane", slug="baska-hastane", country_code="AZ")
    db.add(other)
    await db.flush()
    groups = await ensure_default_groups(db, other.id)
    user = await add_user(db, username="baska@kabul.example.com", tenant_id=other.id,
                          group=groups["physician"])
    user_id = user.id
    if member_of is not None:
        db.add(TenantMembership(user_id=user_id, tenant_id=member_of))
        await db.commit()
    return user_id


async def active_admission(db, w, bed: str = "1", number: str = "H9900101") -> Admission:
    """An ACTIVE admission made by the service, not the route: the ward's `doctor` named on it and
    signing it, and no care-team row (the service's sign-off writes none; the route's does)."""
    doctor = w.users["doctor"].id
    patient = Patient(tenant_id=w.tenant.id, display_name=f"Sentetik Hasta {bed}",
                      date_of_birth="1970-05-05", sex="female", patient_number=number)
    db.add(patient)
    await db.flush()
    admission = await service.create_draft_admission(
        db, tenant_id=w.tenant.id, patient=patient,
        note_fields={"admitting_unit_id": w.units["rea"].id, "bed_id": w.beds[bed].id,
                     "attending_physician_id": doctor,
                     "admission_diagnosis_free_text": "Sentetik tanı"})
    await service.sign_off_admission(db, admission, signing_user_id=doctor)
    await db.commit()
    return admission


async def team_of(db, admission_id) -> list[tuple]:
    """(user, role, active, closed?) of each row, oldest first, read afresh."""
    rows = (await db.execute(
        select(CareTeamMember).where(CareTeamMember.admission_id == admission_id)
        .order_by(CareTeamMember.created_at, CareTeamMember.id)
        .execution_options(populate_existing=True))).scalars().all()
    return [(m.user_id, m.role, m.is_active, m.closed_at is not None) for m in rows]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    return await build_ward(db_session)


async def test_a_physician_is_an_active_member_in_a_physician_group_of_this_tenant(ward, db_session):
    w = ward
    tenant = w.tenant.id
    doctor = w.users["doctor"].id
    others = {name: w.users[name].id for name in ("nurse", "nurse_b", "charge", "admin", "auditor")}
    unit = await add_physician(db_session, w, "unite", group="unit_physician")
    plain = await add_physician(db_session, w, "hekim")
    gone = await add_physician(db_session, w, "ayrilan")
    left = await add_physician(db_session, w, "uyeligi-biten")
    elsewhere = await physician_elsewhere(db_session)
    await db_session.execute(update(User).where(User.id == gone).values(is_active=False))
    await db_session.execute(update(TenantMembership).where(TenantMembership.user_id == left)
                             .values(is_active=False))
    await db_session.commit()
    for user_id in (doctor, unit, plain):
        assert await service.is_physician(db_session, tenant, user_id)
    for user_id in (*others.values(), gone, left, elsewhere, uuid.uuid4()):
        assert not await service.is_physician(db_session, tenant, user_id)


async def test_a_physician_group_of_another_tenant_makes_no_physician_here(ward, db_session):
    """T1: the group must belong to THIS tenant, not only carry a physician's slug. She holds an
    active membership here and a `physician` group of another tenant: the membership filter lets
    her through, so only `Group.tenant_id` keeps her out of `is_physician` and `physician_ids`."""
    w = ward
    tenant = w.tenant.id
    dual = await physician_elsewhere(db_session, member_of=tenant)
    other = (await db_session.execute(
        select(Tenant.id).where(Tenant.slug == "baska-hastane"))).scalar_one()
    assert await service.is_physician(db_session, other, dual)          # control: one THERE
    assert dual in (await db_session.execute(service.physician_ids(other))).scalars().all()
    assert not await service.is_physician(db_session, tenant, dual)
    assert dual not in (await db_session.execute(service.physician_ids(tenant))).scalars().all()


async def test_a_new_attending_ends_the_previous_ones_row_and_the_admission_names_her(ward, db_session):
    """D4, T4: one responsible physician at a time; the history stays."""
    w = ward
    doctor = w.users["doctor"].id
    second = await add_physician(db_session, w, "doctor2", group="attending")
    admission = await active_admission(db_session, w)
    # Explicit times, one second apart: `team_of` orders by `created_at` then a random id, so two
    # calls landing on one clock tick would make the order below a coin toss.
    first, ended = await service.set_attending(db_session, admission, user_id=doctor,
                                               granted_by_id=doctor, now=T0)
    first_id = first.id
    assert ended == []
    row, ended = await service.set_attending(db_session, admission, user_id=second,
                                             granted_by_id=doctor, now=T0 + timedelta(seconds=1))
    await db_session.commit()
    assert ended == [first_id]
    assert (row.role, row.granted_by_id, admission.attending_physician_id) == (
        CareTeamRole.ATTENDING, doctor, second)
    assert await team_of(db_session, admission.id) == [
        (doctor, CareTeamRole.ATTENDING, False, True), (second, CareTeamRole.ATTENDING, True, False)]


async def test_a_promoted_associate_holds_one_row_and_the_others_are_left_alone(ward, db_session):
    """T4: her associate row ends with the previous attending's; she holds the ATTENDING row only.
    Every other member keeps her row: another associate and an on-call physician in force."""
    w = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    bystander = await add_physician(db_session, w, "ortak")
    covering = await add_physician(db_session, w, "nobetci")
    admission = await active_admission(db_session, w)
    attending, _ = await service.set_attending(db_session, admission, user_id=doctor,
                                               granted_by_id=doctor)
    associate = await service.add_care_team_member(
        db_session, admission, user_id=helper, role=CareTeamRole.ASSOCIATE_PHYSICIAN,
        granted_by_id=doctor)
    other_associate = await service.add_care_team_member(
        db_session, admission, user_id=bystander, role=CareTeamRole.ASSOCIATE_PHYSICIAN,
        granted_by_id=doctor)
    now = datetime.now(timezone.utc)
    on_call = await service.add_care_team_member(
        db_session, admission, user_id=covering, role=CareTeamRole.ONCALL_PHYSICIAN,
        granted_by_id=doctor, window_start=now - timedelta(hours=1),
        window_end=now + timedelta(hours=1))
    expected = {attending.id, associate.id}
    left_alone = {other_associate.id, on_call.id}
    _, ended = await service.set_attending(db_session, admission, user_id=helper,
                                           granted_by_id=doctor)
    await db_session.commit()
    assert set(ended) == expected
    assert not left_alone & set(ended)
    active = {(user, role) for user, role, is_active, _ in await team_of(db_session, admission.id)
              if is_active}
    assert active == {(helper, CareTeamRole.ATTENDING),
                      (bystander, CareTeamRole.ASSOCIATE_PHYSICIAN),
                      (covering, CareTeamRole.ONCALL_PHYSICIAN)}


async def test_a_member_ended_twice_keeps_both_closed_rows(ward, db_session):
    """F2: the old constraint broke here; the partial index does not."""
    w = ward
    doctor = w.users["doctor"].id
    helper = await add_physician(db_session, w, "yardimci")
    admission = await active_admission(db_session, w)
    now = datetime.now(timezone.utc)
    for _ in range(2):
        row = await service.add_care_team_member(
            db_session, admission, user_id=helper, role=CareTeamRole.ASSOCIATE_PHYSICIAN,
            granted_by_id=doctor)
        await service.end_care_team_member(db_session, row, now=now)
        assert (row.is_active, row.closed_at) == (False, now)
    await db_session.commit()
    assert await team_of(db_session, admission.id) == [
        (helper, CareTeamRole.ASSOCIATE_PHYSICIAN, False, True)] * 2
