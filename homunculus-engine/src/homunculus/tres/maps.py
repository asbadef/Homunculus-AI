# homunculus-engine/src/homunculus/tres/maps.py
"""Yönetim › TRƏS — the two maps the platform needs and Homunculus does not hold (TRƏS-01, spec §6,
D16, D17, D24). `tres.manage`, the caller's tenant only.

GET /admin/tres/departments — every unit of the tenant (closed ones too: a past stay may be in one)
with its `hospital-departments` code and display, or none. An unmapped unit's stays are skipped
(`unit_unmapped`), never sent under a default department.

PUT /admin/tres/departments — THE WHOLE MAP: `{"departments": [{"unit_id", "code", "display"}]}`;
a unit the body leaves out is unmapped. A unit that is not the tenant's, or named twice, is 422
`tres_unit_unknown`; an empty code or one over 32 characters `tres_department_code`; an empty
display or one over 200 `tres_department_display` — nothing written. A change is audited
`tres.map` AFTER the commit: `{"actor", "units": [<the unit ids whose mapping changed>]}`; a save
that changes nothing writes no row.

GET /admin/tres/practitioners — the tenant's physicians (admission/service.py `physician_ids`) and
anyone the tab already holds an identity for, each with `fin_set` (never the FİN: it is
write-only, as the account's password), the family and the given name.

PUT /admin/tres/practitioners/{user_id} — `{"fin", "family_name", "given_name"}`. `fin` omitted or
null keeps the stored one, an empty string clears it; otherwise it is trimmed and upper-cased and
must be seven Latin capitals or digits (`tres_fin_format`, D20's rule). Both names are required,
at most 100 characters (`tres_name`). A user who is not an active member of the tenant is 404
`tres_user_unknown`. A change is audited `tres.identity`: `{"actor", "user_id", "changed": [<field
names>]}` — never a value; a save that changes nothing writes no row.

`users` is never touched (D16): staff identity proper is H4's."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, StrictStr
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import trail
from homunculus.admission.service import physician_ids
from homunculus.auth.dependencies import caller_tenant_id, require_permission
from homunculus.auth.models import TenantMembership, User
from homunculus.db import get_db
from homunculus.tenant.models import Site, Unit
from homunculus.tres import az
from homunculus.tres.errors import (
    TRES_DEPARTMENT_CODE, TRES_DEPARTMENT_DISPLAY, TRES_FIN_FORMAT, TRES_NAME, TRES_UNIT_UNKNOWN, TRES_USER_UNKNOWN,
    refusal,
)
from homunculus.tres.models import TresDepartmentMap, TresPractitionerIdentity

router = APIRouter(prefix="/admin/tres", tags=["tres"])

CODE_MAX, DISPLAY_MAX, NAME_MAX = 32, 200, 100


class DepartmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit_id: uuid.UUID
    code: StrictStr
    display: StrictStr


class DepartmentsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    departments: list[DepartmentIn]


class DepartmentOut(BaseModel):
    unit_id: uuid.UUID
    unit_name: str
    unit_active: bool
    code: str | None
    display: str | None
    updated_at: datetime | None


class IdentityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fin: StrictStr | None = None          # omitted or null keeps; "" clears
    family_name: StrictStr
    given_name: StrictStr


class PractitionerOut(BaseModel):
    user_id: uuid.UUID
    full_name: str
    fin_set: bool                         # never the FİN itself
    family_name: str | None
    given_name: str | None
    updated_at: datetime | None


async def _departments(db: AsyncSession, tenant_id: uuid.UUID) -> list[DepartmentOut]:
    rows = (await db.execute(
        select(Unit, TresDepartmentMap).join(Site, Site.id == Unit.site_id)
        .outerjoin(TresDepartmentMap, TresDepartmentMap.unit_id == Unit.id)
        .where(Site.tenant_id == tenant_id).order_by(Unit.name, Unit.id)
        .execution_options(populate_existing=True))).all()
    return [DepartmentOut(unit_id=unit.id, unit_name=unit.name, unit_active=unit.is_active,
                          code=mapped.code if mapped else None, display=mapped.display if mapped else None,
                          updated_at=mapped.updated_at if mapped else None) for unit, mapped in rows]


@router.get("/departments", response_model=list[DepartmentOut])
async def read_departments(
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> list[DepartmentOut]:
    return await _departments(db, caller_tenant)


@router.put("/departments", response_model=list[DepartmentOut])
async def write_departments(
    payload: DepartmentsIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> list[DepartmentOut]:
    actor, user_id = user.username, user.id
    units = set((await db.execute(select(Unit.id).join(Site, Site.id == Unit.site_id)
                                  .where(Site.tenant_id == caller_tenant))).scalars())
    wanted: dict[uuid.UUID, tuple[str, str]] = {}
    for item in payload.departments:
        if item.unit_id not in units or item.unit_id in wanted:
            raise refusal(422, TRES_UNIT_UNKNOWN).http()
        code, display = item.code.strip(), item.display.strip()
        if not code or len(code) > CODE_MAX:
            raise refusal(422, TRES_DEPARTMENT_CODE).http()
        if not display or len(display) > DISPLAY_MAX:
            raise refusal(422, TRES_DEPARTMENT_DISPLAY).http()
        wanted[item.unit_id] = (code, display)
    held = {row.unit_id: (row.code, row.display) for row in (await db.execute(
        select(TresDepartmentMap).where(TresDepartmentMap.tenant_id == caller_tenant))).scalars()}
    gone = sorted(set(held) - set(wanted), key=str)
    changed = sorted(gone + [unit for unit, value in wanted.items() if held.get(unit) != value], key=str)
    now = datetime.now(timezone.utc)
    if gone:
        await db.execute(delete(TresDepartmentMap).where(TresDepartmentMap.tenant_id == caller_tenant,
                                                         TresDepartmentMap.unit_id.in_(gone)))
    for unit_id, (code, display) in wanted.items():
        if held.get(unit_id) == (code, display):
            continue
        values = {"code": code, "display": display, "updated_at": now, "updated_by": user_id}
        await db.execute(insert(TresDepartmentMap).values(unit_id=unit_id, tenant_id=caller_tenant, **values)
                         .on_conflict_do_update(index_elements=["unit_id"], set_=values))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    if changed:
        trail.record(request, hospital, "tres.map", payload={"actor": actor, "units": [str(u) for u in changed]})
    return await _departments(db, caller_tenant)


async def _practitioners(db: AsyncSession, tenant_id: uuid.UUID,
                         only: uuid.UUID | None = None) -> list[PractitionerOut]:
    identities = {row.user_id: row for row in (await db.execute(
        select(TresPractitionerIdentity).where(TresPractitionerIdentity.tenant_id == tenant_id)
        .execution_options(populate_existing=True))).scalars()}
    wanted = set((await db.execute(physician_ids(tenant_id))).scalars()) | set(identities)
    if only is not None:
        wanted &= {only}
    users = (await db.execute(select(User.id, User.full_name).where(User.id.in_(wanted))
                              .order_by(User.full_name, User.id))).all() if wanted else []
    out = []
    for user_id, full_name in users:
        row = identities.get(user_id)
        out.append(PractitionerOut(user_id=user_id, full_name=full_name, fin_set=bool(row and row.fin),
                                   family_name=row.family_name if row else None,
                                   given_name=row.given_name if row else None,
                                   updated_at=row.updated_at if row else None))
    return out


@router.get("/practitioners", response_model=list[PractitionerOut])
async def read_practitioners(
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    _user: User = Depends(require_permission("tres.manage")),
) -> list[PractitionerOut]:
    return await _practitioners(db, caller_tenant)


@router.put("/practitioners/{user_id}", response_model=PractitionerOut)
async def write_practitioner(
    user_id: uuid.UUID,
    payload: IdentityIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = Depends(caller_tenant_id),
    user: User = Depends(require_permission("tres.manage")),
) -> PractitionerOut:
    actor, editor = user.username, user.id
    member = (await db.execute(
        select(TenantMembership.user_id).join(User, User.id == TenantMembership.user_id)
        .where(TenantMembership.tenant_id == caller_tenant, TenantMembership.user_id == user_id,
               TenantMembership.is_active.is_(True), User.is_active.is_(True)))).first()
    if member is None:
        raise refusal(404, TRES_USER_UNKNOWN).http()
    family, given = payload.family_name.strip(), payload.given_name.strip()
    if not family or not given or len(family) > NAME_MAX or len(given) > NAME_MAX:
        raise refusal(422, TRES_NAME).http()
    row = (await db.execute(select(TresPractitionerIdentity).where(
        TresPractitionerIdentity.tenant_id == caller_tenant, TresPractitionerIdentity.user_id == user_id)
        .execution_options(populate_existing=True))).scalar_one_or_none()
    fin = row.fin if row is not None else None
    if payload.fin is not None:
        fin = None
        if payload.fin.strip():
            fin, _reason = az.normal_fin(payload.fin)
            if fin is None:
                raise refusal(422, TRES_FIN_FORMAT).http()
    before = (row.fin, row.family_name, row.given_name) if row is not None else (None, None, None)
    changed = [name for name, old, new in zip(("fin", "family_name", "given_name"), before, (fin, family, given))
               if old != new]
    if changed:
        # An upsert: two saves of one new identity at once must not meet at the primary key as a 500.
        values = {"fin": fin, "family_name": family, "given_name": given,
                  "updated_at": datetime.now(timezone.utc), "updated_by": editor}
        await db.execute(insert(TresPractitionerIdentity).values(tenant_id=caller_tenant, user_id=user_id, **values)
                         .on_conflict_do_update(index_elements=["tenant_id", "user_id"], set_=values))
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    if changed:
        trail.record(request, hospital, "tres.identity",
                     payload={"actor": actor, "user_id": str(user_id), "changed": changed})
    return (await _practitioners(db, caller_tenant, only=user_id))[0]
