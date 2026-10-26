"""
Tenant isolation on the admission, escalation and structure routes (plan Task 7b, spec §5).

A permission is held in ONE tenant, the token's `tenant` claim. These tests put two hospitals, A and
B, side by side: each has site → unit → room → two beds, a patient with an ACTIVE admission, an
alert, a handover and a break-glass session. They sign in as A's administrator, who holds every
permission, and check that every route acts on A's objects only:

* an object of B named by id, in the path or in the body, is a 404 identical to a missing one, and
  nothing at all is written;
* a user of B named in a body is a 422;
* lists hold A's rows only;
* a break-glass session is extended or closed by its owner alone, and a closed or expired one
  can be neither extended nor closed again;
* the token's tenant claim is checked against an active membership in an active tenant: a
  renamed (or renamed and reused) slug is a 401, a deactivated tenant or membership a 403;
* creating a tenant is an MFA-verified platform operator's action, not a hospital
  administrator's;
* every route of the app resolves the caller's tenant unless it is listed as unscoped by design.

Each refusal has a control: the same call with A's own ids gets past the scoping, and its answer is
the route's own 2xx or the domain's 409.

Synthetic data only.
"""
from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, fields
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import service as adm_service
from homunculus.admission.models import (
    Admission, CareTeamMember, Handover, NurseBedAssignment, Patient,
)
from homunculus.admission.numbers import next_patient_number
from homunculus.auth.dependencies import caller_tenant_id
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.jwt import create_access_token, decode_token
from homunculus.auth.models import Group, TenantMembership, User, UserGroup
from homunculus.escalation import service as esc_service
from homunculus.escalation.models import (
    Alert, AlertSnooze, AlertTier, BreakGlassReason, BreakGlassSession, EscalationEvent,
)
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.route_walk import api_routes
from tests.signed_in import add_user, api_client, bearer, make_app

NO_TENANT = "Hesabınıza kurum tanımlanmamış"
MEMBERSHIP_INACTIVE = "Bu kurumdaki üyeliğiniz etkin değil"
NOT_A_MEMBER = "Kullanıcı bu kurumun üyesi değil"
NOT_YOURS = "Bu acil erişim oturumu size ait değil"
PLATFORM_ONLY = "Platform operatörü yetkisi gerekli"


# ---------------------------------------------------------------- the two hospitals
@dataclass(frozen=True)
class Side:
    """One hospital's objects, by id."""
    tenant: uuid.UUID
    site: uuid.UUID
    unit: uuid.UUID
    room: uuid.UUID
    bed: uuid.UUID        # occupied by the admission
    free_bed: uuid.UUID   # AVAILABLE
    patient: uuid.UUID
    admission: uuid.UUID  # ACTIVE
    alert: uuid.UUID      # HIGH, fired
    handover: uuid.UUID   # OPEN; outgoing = the administrator, incoming = the nurse
    session: uuid.UUID    # break-glass, opened by the administrator
    member: uuid.UUID     # a nurse of this tenant

    @classmethod
    def missing(cls) -> Side:
        """Ids that name nothing at all."""
        return cls(*(uuid.uuid4() for _ in fields(cls)))


MISSING = Side.missing()


@dataclass
class World:
    db: AsyncSession
    client: AsyncClient
    auth: dict[str, str]   # A's administrator (every permission, MFA verified)
    caller: User
    a: Side
    b: Side


async def _hospital(db: AsyncSession, slug: str) -> tuple[Side, User]:
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="TR", timezone="UTC")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    admin = await add_user(db, username=f"admin@{slug}.example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
    nurse = await add_user(db, username=f"nurse@{slug}.example.com", tenant_id=tenant.id,
                           group=groups["nurse"])

    site = Site(tenant_id=tenant.id, name="Ana Kampüs")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Erişkin YBÜ", unit_type=UnitType.ADULT_ICU,
                max_beds_per_nurse=2)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Oda 1")
    db.add(room)
    await db.flush()
    bed, free_bed = Bed(room_id=room.id, label="1A"), Bed(room_id=room.id, label="1B")
    db.add_all([bed, free_bed])
    patient = Patient(tenant_id=tenant.id, display_name=f"Sentetik Hasta {slug}",
                      date_of_birth="1980-01-01", sex="female",
                      patient_number=await next_patient_number(db, tenant.id))
    db.add(patient)
    await db.flush()

    admission = await adm_service.create_draft_admission(
        db, tenant_id=tenant.id, patient=patient,
        note_fields={"admitting_unit_id": unit.id, "bed_id": bed.id,
                     "attending_physician_id": admin.id,
                     "admission_diagnosis_free_text": "Sentetik tanı"},
    )
    await adm_service.sign_off_admission(db, admission, signing_user_id=admin.id)
    alert = await esc_service.create_alert(
        db, tenant_id=tenant.id, admission_id=admission.id, patient_id=patient.id,
        unit_id=unit.id, kind="news2", tier=AlertTier.HIGH, summary="1A: sentetik bulgu",
    )
    handover = await adm_service.open_handover(
        db, unit_id=unit.id, outgoing_user_id=admin.id, incoming_user_id=nurse.id,
        admission_ids=[admission.id],
    )
    session = await esc_service.activate_break_glass(
        db, tenant_id=tenant.id, user_id=admin.id, patient_id=patient.id,
        reason=BreakGlassReason.RAPID_DETERIORATION,
    )
    await db.commit()
    return Side(tenant=tenant.id, site=site.id, unit=unit.id, room=room.id, bed=bed.id,
                free_bed=free_bed.id, patient=patient.id, admission=admission.id,
                alert=alert.id, handover=handover.id, session=session.id,
                member=nurse.id), admin


@pytest_asyncio.fixture
async def world(db_session):
    a, caller = await _hospital(db_session, "hastane-a")
    b, _ = await _hospital(db_session, "hastane-b")
    auth = await bearer(db_session, caller)
    async with api_client(db_session) as client:
        yield World(db=db_session, client=client, auth=auth, caller=caller, a=a, b=b)


# ---------------------------------------------------------------- helpers
_TABLES = (Tenant, Site, Unit, Room, Bed, Patient, Admission, CareTeamMember, NurseBedAssignment,
           Handover, Alert, AlertSnooze, EscalationEvent, BreakGlassSession, TenantMembership,
           Group, UserGroup)


async def _snapshot(db: AsyncSession) -> dict[str, list[str]]:
    """Every row of every table these routes could write, as committed right now. A refused
    request must leave it exactly as it was."""
    out: dict[str, list[str]] = {}
    for model in _TABLES:
        rows = (await db.execute(select(model.__table__))).all()
        out[model.__tablename__] = sorted(repr(tuple(row)) for row in rows)
    return out


def _jsonable(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


async def _call(world: World, method: str, path: str, body: dict | None = None,
                headers: dict[str, str] | None = None) -> Response:
    return await world.client.request(
        method, path, json=None if body is None else _jsonable(body),
        headers=world.auth if headers is None else headers,
    )


def _admission_body(unit: uuid.UUID, bed: uuid.UUID, attending: uuid.UUID | None = None) -> dict:
    note: dict[str, Any] = {"admitting_unit_id": unit, "bed_id": bed,
                            "admission_diagnosis_free_text": "Sentetik tanı"}
    if attending is not None:
        note["attending_physician_id"] = attending
    # G2-B1a: the admission form's required fields (admission/form.py).
    note.update(admission_type="ICU", no_known_allergy=True)
    return {"patient": {"display_name": "Sentetik Yeni Hasta", "date_of_birth": "1990-02-02",
                        "sex": "male", "consent": "KVKK_SIGNED"},
            "note": note}


def _shift_body(unit: uuid.UUID, bed: uuid.UUID, nurse: uuid.UUID) -> dict:
    start = datetime.now(timezone.utc).replace(microsecond=0)
    return {"unit_id": unit,
            "assignments": [{"bed_id": bed, "nurse_id": nurse, "shift_start": start.isoformat(),
                             "shift_end": (start + timedelta(hours=8)).isoformat()}]}


def _handover_body(unit: uuid.UUID, incoming: uuid.UUID, admissions: list[uuid.UUID]) -> dict:
    return {"unit_id": unit, "incoming_user_id": incoming, "admission_ids": admissions}


# ---------------------------------------------------------------- objects named by PATH id
@dataclass(frozen=True)
class ById:
    method: str
    path: Callable[[Side], str]                     # names an object of the given side
    body: Callable[[Side], dict] | None = None      # built from the CALLER's side
    control: int = 200                              # the answer for the caller's own object


BY_ID: dict[str, ById] = {
    "admission detail": ById("GET", lambda s: f"/admissions/{s.admission}"),
    "admission patient": ById("GET", lambda s: f"/admissions/{s.admission}/patient"),
    "care-team list": ById("GET", lambda s: f"/admissions/{s.admission}/care-team"),
    "sign-off": ById("POST", lambda s: f"/admissions/{s.admission}/sign-off", control=409),
    "care-team claim": ById("POST", lambda s: f"/admissions/{s.admission}/care-team/claim"),
    "care-team add": ById(
        "POST", lambda s: f"/admissions/{s.admission}/care-team",
        lambda a: {"user_id": a.member, "role": "ASSOCIATE_PHYSICIAN"}, 201),
    "transfer initiate": ById(
        "POST", lambda s: f"/admissions/{s.admission}/transfer/initiate",
        lambda a: {"target_bed_id": a.free_bed, "target_unit_id": a.unit}),
    "transfer confirm": ById(
        "POST", lambda s: f"/admissions/{s.admission}/transfer/confirm",
        lambda a: {"target_bed_id": a.free_bed, "target_unit_id": a.unit}, 409),
    "discharge initiate": ById(
        "POST", lambda s: f"/admissions/{s.admission}/discharge/initiate",
        lambda a: {"disposition": "HOME", "note": "Sentetik taburcu notu"}),
    "discharge confirm": ById(
        "POST", lambda s: f"/admissions/{s.admission}/discharge/confirm", control=409),
    "alert acknowledge": ById("POST", lambda s: f"/alerts/{s.alert}/acknowledge", lambda a: {}),
    "alert snooze": ById(
        "POST", lambda s: f"/alerts/{s.alert}/snooze",
        lambda a: {"reason": "PATIENT_BASELINE", "duration_minutes": 15}),
    "alert escalate": ById(
        "POST", lambda s: f"/alerts/{s.alert}/escalate",
        lambda a: {"reason": "Sentetik manuel eskalasyon"}),
    "break-glass extend": ById("POST", lambda s: f"/break-glass/{s.session}/extend"),
    "break-glass close": ById("POST", lambda s: f"/break-glass/{s.session}/close"),
    "handover sign-outgoing": ById(
        "POST", lambda s: f"/handovers/{s.handover}/sign-outgoing", lambda a: {}),
    "handover countersign": ById(
        "POST", lambda s: f"/handovers/{s.handover}/countersign", control=409),
    "site list": ById("GET", lambda s: f"/tenant/tenants/{s.tenant}/sites"),
    "site create": ById(
        "POST", lambda s: f"/tenant/tenants/{s.tenant}/sites",
        lambda a: {"name": "Yeni Kampüs"}, 201),
    "unit list": ById("GET", lambda s: f"/tenant/sites/{s.site}/units"),
    "unit create": ById(
        "POST", lambda s: f"/tenant/sites/{s.site}/units",
        lambda a: {"name": "Yeni Ünite", "unit_type": "NICU"}, 201),
    "room list": ById("GET", lambda s: f"/tenant/units/{s.unit}/rooms"),
    "room create": ById(
        "POST", lambda s: f"/tenant/units/{s.unit}/rooms", lambda a: {"name": "Oda 9"}, 201),
    "bed list": ById("GET", lambda s: f"/tenant/rooms/{s.room}/beds"),
    "bed create": ById(
        "POST", lambda s: f"/tenant/rooms/{s.room}/beds", lambda a: {"label": "9Z"}, 201),
    "bed transition": ById(
        "POST", lambda s: f"/tenant/beds/{s.free_bed}/transition",
        lambda a: {"new_state": "OCCUPIED"}),
    # G2-B1a (Hasta Kabul): rename / close / reopen, and the release of a cleaned bed (the free
    # bed is AVAILABLE, so the caller's own is refused by the domain: 409 invalid_transition).
    "unit patch": ById("PATCH", lambda s: f"/tenant/units/{s.unit}", lambda a: {"name": "Yeni"}),
    "room patch": ById("PATCH", lambda s: f"/tenant/rooms/{s.room}", lambda a: {"name": "Oda 9"}),
    "bed patch": ById("PATCH", lambda s: f"/tenant/beds/{s.free_bed}", lambda a: {"label": "9Z"}),
    "bed release": ById("POST", lambda s: f"/tenant/beds/{s.free_bed}/release", control=409),
}


@requires_db
@pytest.mark.parametrize("name", sorted(BY_ID))
async def test_another_tenants_object_by_id_is_a_404_exactly_like_a_missing_one(world, name):
    case = BY_ID[name]
    body = case.body(world.a) if case.body else None
    before = await _snapshot(world.db)

    foreign = await _call(world, case.method, case.path(world.b), body)
    missing = await _call(world, case.method, case.path(MISSING), body)

    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json()
    assert await _snapshot(world.db) == before


@requires_db
@pytest.mark.parametrize("name", sorted(BY_ID))
async def test_the_callers_own_object_by_id_gets_past_the_scoping(world, name):
    case = BY_ID[name]
    r = await _call(world, case.method, case.path(world.a),
                    case.body(world.a) if case.body else None)
    assert r.status_code == case.control, r.text


# ---------------------------------------------------------------- objects named in a BODY
@dataclass(frozen=True)
class InBody:
    method: str
    path: Callable[[Side], str]                     # built from the caller's side
    body: Callable[[Side, Any], dict]               # (caller's side, the thing under test)
    control: int


IN_BODY: dict[str, InBody] = {
    "admit into another tenant's unit": InBody(
        "POST", lambda a: "/admissions", lambda a, x: _admission_body(x.unit, a.free_bed), 201),
    "admit into another tenant's bed": InBody(
        "POST", lambda a: "/admissions", lambda a, x: _admission_body(a.unit, x.free_bed), 201),
    "transfer to another tenant's bed": InBody(
        "POST", lambda a: f"/admissions/{a.admission}/transfer/initiate",
        lambda a, x: {"target_bed_id": x.free_bed, "target_unit_id": a.unit}, 200),
    "transfer to another tenant's unit": InBody(
        "POST", lambda a: f"/admissions/{a.admission}/transfer/initiate",
        lambda a, x: {"target_bed_id": a.free_bed, "target_unit_id": x.unit}, 200),
    "transfer confirmed into another tenant's bed": InBody(
        "POST", lambda a: f"/admissions/{a.admission}/transfer/confirm",
        lambda a, x: {"target_bed_id": x.free_bed, "target_unit_id": a.unit}, 409),
    "alert for another tenant's patient": InBody(
        "POST", lambda a: "/alerts",
        lambda a, x: {"patient_id": x.patient, "kind": "manual", "tier": "HIGH"}, 201),
    "alert on another tenant's admission": InBody(
        "POST", lambda a: "/alerts",
        lambda a, x: {"admission_id": x.admission, "kind": "manual", "tier": "HIGH"}, 201),
    "alert on another tenant's unit": InBody(
        "POST", lambda a: "/alerts",
        lambda a, x: {"patient_id": a.patient, "unit_id": x.unit, "kind": "manual",
                      "tier": "HIGH"}, 201),
    "break-glass on another tenant's patient": InBody(
        "POST", lambda a: "/break-glass",
        lambda a, x: {"patient_id": x.patient, "reason": "CARDIAC_ARREST"}, 201),
    "handover on another tenant's unit": InBody(
        "POST", lambda a: "/handovers",
        lambda a, x: _handover_body(x.unit, a.member, [a.admission]), 201),
    "handover naming another tenant's admission": InBody(
        "POST", lambda a: "/handovers",
        lambda a, x: _handover_body(a.unit, a.member, [a.admission, x.admission]), 201),
    "shift on another tenant's unit": InBody(
        "POST", lambda a: "/shift-schedule",
        lambda a, x: _shift_body(x.unit, a.free_bed, a.member), 201),
    "shift on another tenant's bed": InBody(
        "POST", lambda a: "/shift-schedule",
        lambda a, x: _shift_body(a.unit, x.free_bed, a.member), 201),
}


@requires_db
@pytest.mark.parametrize("name", sorted(IN_BODY))
async def test_another_tenants_id_in_a_body_is_a_404_exactly_like_a_missing_one(world, name):
    case = IN_BODY[name]
    before = await _snapshot(world.db)

    foreign = await _call(world, case.method, case.path(world.a), case.body(world.a, world.b))
    missing = await _call(world, case.method, case.path(world.a), case.body(world.a, MISSING))

    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json()
    assert await _snapshot(world.db) == before


@requires_db
@pytest.mark.parametrize("name", sorted(IN_BODY))
async def test_the_callers_own_ids_in_a_body_get_past_the_scoping(world, name):
    case = IN_BODY[name]
    r = await _call(world, case.method, case.path(world.a), case.body(world.a, world.a))
    assert r.status_code == case.control, r.text


# ---------------------------------------------------------------- users named in a BODY
USERS: dict[str, InBody] = {
    "admitting attending": InBody(
        "POST", lambda a: "/admissions",
        lambda a, u: _admission_body(a.unit, a.free_bed, attending=u), 201),
    "care-team member": InBody(
        "POST", lambda a: f"/admissions/{a.admission}/care-team",
        lambda a, u: {"user_id": u, "role": "ASSOCIATE_PHYSICIAN"}, 201),
    "handover incoming user": InBody(
        "POST", lambda a: "/handovers", lambda a, u: _handover_body(a.unit, u, [a.admission]),
        201),
    "shift nurse": InBody(
        "POST", lambda a: "/shift-schedule", lambda a, u: _shift_body(a.unit, a.free_bed, u), 201),
}


@requires_db
@pytest.mark.parametrize("name", sorted(USERS))
async def test_a_user_of_another_tenant_in_a_body_is_a_422(world, name):
    case = USERS[name]
    before = await _snapshot(world.db)

    for user_id in (world.b.member, uuid.uuid4()):
        r = await _call(world, case.method, case.path(world.a), case.body(world.a, user_id))
        assert r.status_code == 422, r.text
        assert r.json()["detail"] == NOT_A_MEMBER

    assert await _snapshot(world.db) == before


@requires_db
@pytest.mark.parametrize("name", sorted(USERS))
async def test_a_member_of_the_callers_tenant_in_a_body_is_accepted(world, name):
    case = USERS[name]
    r = await _call(world, case.method, case.path(world.a), case.body(world.a, world.a.member))
    assert r.status_code == case.control, r.text


@requires_db
async def test_an_inactive_membership_is_no_membership(world):
    await world.db.execute(update(TenantMembership)
                           .where(TenantMembership.user_id == world.a.member)
                           .values(is_active=False))
    await world.db.commit()
    case = USERS["care-team member"]
    r = await _call(world, case.method, case.path(world.a), case.body(world.a, world.a.member))
    assert r.status_code == 422 and r.json()["detail"] == NOT_A_MEMBER


@requires_db
@pytest.mark.parametrize("name", ["care-team member", "handover incoming user"])
async def test_a_deactivated_account_is_no_member_though_its_membership_is_active(world, name):
    """/admin deactivates an account through `User.is_active` and leaves the membership row."""
    await world.db.execute(update(User).where(User.id == world.a.member).values(is_active=False))
    await world.db.commit()
    before = await _snapshot(world.db)

    case = USERS[name]
    r = await _call(world, case.method, case.path(world.a), case.body(world.a, world.a.member))

    assert r.status_code == 422 and r.json()["detail"] == NOT_A_MEMBER
    assert await _snapshot(world.db) == before


# ---------------------------------------------------------------- the risky success paths
@requires_db
async def test_a_pending_transfer_is_confirmed_into_the_callers_own_bed(world):
    admission = await world.db.get(Admission, world.a.admission)
    await adm_service.initiate_transfer(world.db, admission, target_bed_id=world.a.free_bed,
                                        target_unit_id=world.a.unit)
    await world.db.commit()

    r = await _call(world, "POST", f"/admissions/{world.a.admission}/transfer/confirm",
                    {"target_bed_id": world.a.free_bed, "target_unit_id": world.a.unit})

    assert r.status_code == 201, r.text
    new = r.json()
    assert new["state"] == "ACTIVE" and new["bed_id"] == str(world.a.free_bed)
    assert new["tenant_id"] == str(world.a.tenant)
    assert new["source_admission_id"] == str(world.a.admission)


@requires_db
async def test_a_draft_admission_is_signed_off_by_the_callers_own_attending(world):
    patient = Patient(tenant_id=world.a.tenant, display_name="Sentetik Taslak Hasta",
                      date_of_birth="1970-03-03", sex="male",
                      patient_number=await next_patient_number(world.db, world.a.tenant))
    world.db.add(patient)
    await world.db.flush()
    draft = await adm_service.create_draft_admission(
        world.db, tenant_id=world.a.tenant, patient=patient,
        note_fields={"admitting_unit_id": world.a.unit, "bed_id": world.a.free_bed,
                     "attending_physician_id": world.caller.id,
                     "admission_diagnosis_free_text": "Sentetik tanı"},
    )
    await world.db.commit()

    r = await _call(world, "POST", f"/admissions/{draft.id}/sign-off")

    assert r.status_code == 200, r.text
    assert r.json()["state"] == "ACTIVE" and r.json()["signed_by"] == str(world.caller.id)


# ---------------------------------------------------------------- lists
@requires_db
async def test_the_admission_list_holds_only_the_callers_tenant(world):
    r = await _call(world, "GET", "/admissions")
    assert r.status_code == 200
    ids = {row["id"] for row in r.json()}
    assert str(world.a.admission) in ids
    assert str(world.b.admission) not in ids

    r = await world.client.get("/admissions", params={"unit_id": str(world.b.unit)},
                               headers=world.auth)
    assert r.status_code == 200 and r.json() == []


@requires_db
async def test_the_structure_holds_only_the_callers_tenant(world):
    """G2-B1a: GET /tenant/structure, which every screen reads its unit and bed names from."""
    r = await _call(world, "GET", "/tenant/structure")
    assert r.status_code == 200, r.text
    units = {u["id"] for s in r.json()["sites"] for u in s["units"]}
    beds = {b["id"] for s in r.json()["sites"] for u in s["units"] for room in u["rooms"]
            for b in room["beds"]}
    assert r.json()["tenant_id"] == str(world.a.tenant)
    assert units == {str(world.a.unit)}
    assert beds == {str(world.a.bed), str(world.a.free_bed)}


@requires_db
async def test_the_tenant_list_holds_only_the_callers_tenant(world):
    r = await _call(world, "GET", "/tenant/tenants")
    assert r.status_code == 200
    assert [t["id"] for t in r.json()] == [str(world.a.tenant)]


@requires_db
async def test_a_platform_operator_lists_every_tenant(world):
    await world.db.execute(update(User).where(User.id == world.caller.id)
                           .values(is_platform_support=True))
    await world.db.commit()
    r = await _call(world, "GET", "/tenant/tenants")
    assert r.status_code == 200
    assert {t["id"] for t in r.json()} == {str(world.a.tenant), str(world.b.tenant)}


# ---------------------------------------------------------------- break-glass
@requires_db
async def test_a_break_glass_session_is_extended_and_closed_by_its_owner_alone(world):
    theirs = await esc_service.activate_break_glass(
        world.db, tenant_id=world.a.tenant, user_id=world.a.member,
        patient_id=world.a.patient, reason=BreakGlassReason.CARDIAC_ARREST,
    )
    await world.db.commit()
    before = await _snapshot(world.db)

    for action in ("extend", "close"):
        r = await _call(world, "POST", f"/break-glass/{theirs.id}/{action}")
        assert r.status_code == 403, r.text
        assert r.json()["detail"] == NOT_YOURS

    assert await _snapshot(world.db) == before


@requires_db
async def test_a_closed_break_glass_session_cannot_be_extended(world):
    closed = await _call(world, "POST", f"/break-glass/{world.a.session}/close")
    assert closed.status_code == 200
    before = await _snapshot(world.db)

    r = await _call(world, "POST", f"/break-glass/{world.a.session}/extend")

    assert r.status_code == 409, r.text
    assert await _snapshot(world.db) == before


async def _expired_session(world: World) -> uuid.UUID:
    """The caller's own session, opened an hour ago: expired half an hour ago, never closed."""
    expired = await esc_service.activate_break_glass(
        world.db, tenant_id=world.a.tenant, user_id=world.caller.id,
        patient_id=world.a.patient, reason=BreakGlassReason.CARDIAC_ARREST,
        now=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    await world.db.commit()
    return expired.id


async def _closed_at(world: World, session_id: uuid.UUID) -> datetime | None:
    return (await world.db.execute(select(BreakGlassSession.closed_at)
                                   .where(BreakGlassSession.id == session_id))).scalar_one()


@requires_db
async def test_an_expired_break_glass_session_cannot_be_extended(world):
    expired = await _expired_session(world)
    before = await _snapshot(world.db)

    r = await _call(world, "POST", f"/break-glass/{expired}/extend")

    assert r.status_code == 409, r.text
    assert await _snapshot(world.db) == before


@requires_db
async def test_a_break_glass_session_is_closed_once(world):
    first = await _call(world, "POST", f"/break-glass/{world.a.session}/close")
    assert first.status_code == 200, first.text
    closed_at = await _closed_at(world, world.a.session)
    before = await _snapshot(world.db)

    again = await _call(world, "POST", f"/break-glass/{world.a.session}/close")

    assert again.status_code == 409, again.text
    assert await _closed_at(world, world.a.session) == closed_at
    assert closed_at == datetime.fromisoformat(first.json()["closed_at"])
    assert await _snapshot(world.db) == before


@requires_db
async def test_an_expired_break_glass_session_is_not_closed_after_the_fact(world):
    """Access ended at `expires_at`; a late close must not rewrite when that was."""
    expired = await _expired_session(world)
    before = await _snapshot(world.db)

    r = await _call(world, "POST", f"/break-glass/{expired}/close")

    assert r.status_code == 409, r.text
    assert await _closed_at(world, expired) is None
    assert await _snapshot(world.db) == before


# ---------------------------------------------------------------- the caller's tenant itself
def _with_tenant(auth: dict[str, str], tenant: str | None) -> dict[str, str]:
    """The same signed-in token, re-minted with a different `tenant` claim."""
    claims = decode_token(auth["Authorization"].split()[1])
    extra = {k: v for k, v in claims.items() if k not in ("sub", "iat", "exp", "jti", "type")}
    extra["tenant"] = tenant
    return {"Authorization": f"Bearer {create_access_token(claims['sub'], extra)}"}


@requires_db
async def test_a_token_that_names_no_tenant_is_refused(world):
    r = await _call(world, "GET", "/admissions", headers=_with_tenant(world.auth, None))
    assert r.status_code == 403 and r.json()["detail"] == NO_TENANT


@requires_db
@pytest.mark.parametrize("blank", ["", "   "], ids=repr)
async def test_a_blank_tenant_claim_names_no_tenant_even_if_such_a_slug_exists(world, blank):
    """As on the board: a blank slug is no tenant (403), even where a tenant carries that slug
    (slugs are not validated) and the caller holds an active membership in it."""
    blank_tenant = Tenant(name="Sentetik Boş Slug", slug=blank, country_code="TR")
    world.db.add(blank_tenant)
    await world.db.flush()
    world.db.add(TenantMembership(user_id=world.caller.id, tenant_id=blank_tenant.id))
    await world.db.commit()

    r = await _call(world, "GET", "/admissions", headers=_with_tenant(world.auth, blank))
    assert r.status_code == 403 and r.json()["detail"] == NO_TENANT


async def _rename_a(world: World) -> None:
    await world.db.execute(update(Tenant).where(Tenant.id == world.a.tenant)
                           .values(slug="hastane-a-yeni"))
    await world.db.commit()


def _is_a_401_asking_for_a_refresh(r: Response) -> bool:
    return (r.status_code == 401 and r.json()["detail"] == "tenant"
            and r.headers.get("www-authenticate") == "Bearer")


@requires_db
async def test_a_renamed_slug_is_a_401_so_the_client_refreshes(world):
    await _rename_a(world)
    r = await _call(world, "GET", "/admissions")
    assert _is_a_401_asking_for_a_refresh(r), r.text


@requires_db
async def test_a_renamed_slug_reused_by_another_tenant_never_reaches_that_tenant(world):
    await _rename_a(world)
    reuser = Tenant(name="Sentetik Başka Hastane", slug="hastane-a", country_code="TR")
    world.db.add(reuser)
    await world.db.commit()
    before = await _snapshot(world.db)

    for method, path, body in (
            ("GET", "/admissions", None),
            ("GET", "/tenant/tenants", None),
            ("GET", f"/tenant/tenants/{reuser.id}/sites", None),
            ("POST", f"/tenant/tenants/{reuser.id}/sites", {"name": "Sızma Kampüsü"})):
        r = await _call(world, method, path, body)
        assert _is_a_401_asking_for_a_refresh(r), (path, r.text)

    assert await _snapshot(world.db) == before


@requires_db
async def test_a_deactivated_tenant_is_a_403(world):
    await world.db.execute(update(Tenant).where(Tenant.id == world.a.tenant)
                           .values(is_active=False))
    await world.db.commit()
    r = await _call(world, "GET", "/admissions")
    assert r.status_code == 403 and r.json()["detail"] == MEMBERSHIP_INACTIVE


@requires_db
async def test_a_deactivated_membership_is_a_403_within_the_tokens_hour(world):
    await world.db.execute(update(TenantMembership)
                           .where(TenantMembership.user_id == world.caller.id)
                           .values(is_active=False))
    await world.db.commit()
    r = await _call(world, "GET", "/admissions")
    assert r.status_code == 403 and r.json()["detail"] == MEMBERSHIP_INACTIVE


# ---------------------------------------------------------------- tenant creation
@requires_db
async def test_tenant_creation_is_a_platform_operator_action(world):
    body = {"name": "Sentetik Yeni Hastane", "slug": "hastane-c", "country_code": "TR"}

    r = await _call(world, "POST", "/tenant/tenants", body)
    assert r.status_code == 403 and r.json()["detail"] == PLATFORM_ONLY

    # A vendor-side account: no tenant, no group, no permission, only the platform flag.
    operator = await add_user(world.db, username="operator@vendor.example.com",
                              platform_support=True)
    r = await _call(world, "POST", "/tenant/tenants", body,
                    headers=await bearer(world.db, operator))
    assert r.status_code == 201, r.text
    created = uuid.UUID(r.json()["id"])
    assert (await world.db.execute(
        select(func.count(Group.id)).where(Group.tenant_id == created))).scalar_one() == 11


@requires_db
async def test_a_platform_operator_must_be_mfa_verified(world):
    """A nurse's token carries no MFA step; setting the platform flag in SQL afterwards must not
    turn it into an operator's token."""
    nurse = await world.db.get(User, world.a.member)
    auth = await bearer(world.db, nurse)
    await world.db.execute(update(User).where(User.id == nurse.id)
                           .values(is_platform_support=True))
    await world.db.commit()
    before = await _snapshot(world.db)

    r = await _call(world, "POST", "/tenant/tenants",
                    {"name": "Sentetik Yeni Hastane", "slug": "hastane-c", "country_code": "TR"},
                    headers=auth)

    assert r.status_code == 403 and r.json()["detail"] == "mfa_required"
    assert await _snapshot(world.db) == before


# ---------------------------------------------------------------- every route is scoped
# The routes that act outside any one tenant's objects, by design. Everything else in the app,
# `/admin` included, must resolve the caller's tenant. `/auth/*` (sign-in, the caller's own
# account) is exempt by prefix.
NOT_THE_BOARD = {
    ("POST", "/tenant/tenants"),        # a platform operator creates a tenant
    # The device-research window reads the ONE hub this deployment is configured with
    # (INFINITY_HUB_*): no tenant's objects, no patient ids. Unscoped as it was on main; a
    # deployment serving several hospitals from one API would have to bind the hub to a tenant.
    ("GET", "/infinity-research/state"),
}
UNSCOPED_BY_DESIGN = NOT_THE_BOARD | {
    ("GET", "/health"),
    # api/app.py: the board and device routes. Tasks 8/9 scope them through the Caller.
    ("POST", "/ingest"),
    ("POST", "/ack"),
    ("POST", "/view"),
    ("GET", "/patients"),
    ("GET", "/alerts/{patient_id}"),
    ("POST", "/stream-ticket"),
    ("GET", "/stream"),
    ("GET", "/notifications"),
    ("GET", "/audit"),
    # ...and the ones that arrived from main, through the same Caller.
    ("POST", "/clinical/{patient_id}"),
    ("PUT", "/clinical/{patient_id}/profile"),
    ("GET", "/scores/sofa/{patient_id}"),
    ("POST", "/scores/sofa/{patient_id}"),
    ("GET", "/alarm-quality"),
    ("GET", "/audit/verify"),
    # Group 2's trend charts (api/trends.py): the board's Caller, board.view and _require_patient.
    ("GET", "/patients/{patient_id}/trends"),
    # Aşama A's monitor strip (api/app.py). The GET goes through the Caller and answers only a
    # caller of the ONE hospital the lane is configured for (INFINITY_SHADOW_HOSPITAL); the POST
    # takes the forwarder's own token and writes only that hospital's in-memory strip.
    ("POST", "/infinity-shadow/readings"),
    ("GET", "/infinity-shadow/board"),
}


def _depends_on(dependant, target) -> bool:
    stack = [dependant]
    while stack:
        node = stack.pop()
        if node.call is target:
            return True
        stack.extend(node.dependencies)
    return False


def test_every_route_resolves_the_callers_tenant_unless_unscoped_by_design():
    routes = api_routes(make_app())
    unscoped = {
        (method, route.path)
        for route in routes
        if not route.path.startswith("/auth/")
        and not _depends_on(route.dependant, caller_tenant_id)
        for method in route.methods
    }
    # Equality both ways: a new route that forgets the tenant fails here, and so does a stale
    # entry (a route that was scoped since, or removed).
    assert unscoped == UNSCOPED_BY_DESIGN
    board = {(m, r.path) for r in routes for m in r.methods
             if r.endpoint.__module__ == "homunculus.api.app"}
    assert UNSCOPED_BY_DESIGN - NOT_THE_BOARD == board
