"""The scope API: where an administrator says who may see what, and anyone may ask what they see.

Two audiences, two routes. `/scope/me` answers the question a screen has to be able to ask —
*why is my board this size* — without granting the caller sight of anyone else's access.
`/scope/{user_id}` is the administrator's, and every write lands in the audit log, because
changing who can see a patient is precisely the kind of decision somebody is later asked about.

PHI RULE: this module handles access configuration only. No patient data crosses it, with one
deliberate exception — the count of a user's own care-team patients, which is a number, not an
identity.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.dependencies import get_current_user, require_roles
from homunculus.auth.models import TenantMembership, User, UserRole
from homunculus.db import get_db
from homunculus.scope import service
from homunculus.scope.rules import build_scope
from homunculus.scope.schemas import ScopeAssignment, ScopeGrantOut, ScopeView

router = APIRouter(prefix="/scope", tags=["scope"])

_admin = Depends(require_roles(UserRole.HOSPITAL_ADMIN))


def _audit(request: Request):
    """The app's audit log, when this router is mounted on an app that has one.

    Optional rather than required: the scope routes must not stop working because a deployment
    assembled the app without an audit sink. A missing log is reported by the audit screen's own
    checks, not by a 500 here.
    """
    return getattr(request.app.state, "audit", None)


async def _tenant_of(db: AsyncSession, user_id: uuid.UUID) -> tuple[uuid.UUID, str]:
    """This user's tenant, as both identifiers the system uses for it.

    Two are needed and they are not interchangeable. Rows are keyed by `tenants.id`; the audit
    log is keyed by the **slug**, because that is the hospital key every other event in it
    carries (`hospital_for_slugs` returns exactly this) and the audit screen filters on it.
    Writing a UUID into that column would start a second hash chain for the same hospital and
    file every scope change where nobody looking for it would ever find one.

    A user in several tenants resolves to the lowest slug — the same deterministic choice
    `hospital_for_slugs` makes, so a scope change is filed against the hospital whose board that
    user actually sees.
    """
    from homunculus.tenant.models import Tenant

    result = await db.execute(
        select(TenantMembership.tenant_id, Tenant.slug)
        .select_from(TenantMembership)
        .join(Tenant, TenantMembership.tenant_id == Tenant.id)
        .where(
            TenantMembership.user_id == user_id,
            TenantMembership.is_active == True,  # noqa: E712
        )
    )
    rows = result.all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="kullanıcının etkin bir kurum üyeliği yok")
    tenant_id, slug = min(rows, key=lambda r: r[1])
    return tenant_id, slug


async def _view(db: AsyncSession, user_id: uuid.UUID) -> ScopeView:
    grants = await service.read_grants(db, user_id)
    role = await service.read_role(db, user_id)
    own = await service.read_own_patient_ids(db, user_id)
    scope = build_scope(
        role,
        unit_ids=[g.unit_id for g in grants if g.unit_id],
        bed_ids=[g.bed_id for g in grants if g.bed_id],
        own_patient_ids=own,
    )
    return ScopeView(
        user_id=user_id, role=role,
        unrestricted=scope.unrestricted, reason=scope.reason,
        unit_ids=sorted(scope.unit_ids), bed_ids=sorted(scope.bed_ids),
        grants=[ScopeGrantOut.model_validate(g) for g in grants],
    )


@router.get("/me", response_model=ScopeView, summary="What the caller may see, and why")
async def my_scope(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
) -> ScopeView:
    return await _view(db, user.id)


@router.get("/unassigned", summary="How many active users hold no scope at all")
async def unassigned(
    db: AsyncSession = Depends(get_db), admin: User = _admin,
) -> dict:
    """The administrator's to-do counter.

    Without it, "everyone sees everything because nobody has been assigned yet" and "everyone
    sees everything because that is this hospital's policy" are the same screen.
    """
    tenant_id, slug = await _tenant_of(db, admin.id)
    return {"tenant": slug,
            "unassigned_users": await service.count_unassigned(db, tenant_id)}


@router.get("/{user_id}", response_model=ScopeView, summary="One user's scope")
async def get_scope(
    user_id: uuid.UUID, db: AsyncSession = Depends(get_db), _admin_user: User = _admin,
) -> ScopeView:
    return await _view(db, user_id)


@router.put("/{user_id}", response_model=ScopeView, summary="Replace one user's scope")
async def put_scope(
    user_id: uuid.UUID, body: ScopeAssignment, request: Request,
    db: AsyncSession = Depends(get_db), admin: User = _admin,
) -> ScopeView:
    """Set this user's scope to exactly what the body says.

    Replacement, not a diff: an administrator filling in a form is deciding what this person's
    access *is*. Two administrators saving diffs concurrently would merge into the union of both
    — the more permissive outcome, chosen by neither of them.
    """
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="kullanıcı bulunamadı")
    tenant_id, slug = await _tenant_of(db, user_id)

    before = sorted(g.target for g in await service.read_grants(db, user_id))
    rows = await service.replace_grants(
        db, tenant_id=tenant_id, user_id=user_id,
        grants=[(g.unit_id.strip(), g.bed_id.strip()) for g in body.grants],
        granted_by_id=admin.id,
    )

    audit = _audit(request)
    if audit is not None:
        from homunculus.api.audit import AuditEvent

        # `patient_id` stays empty on purpose: a scope change concerns no patient, and putting a
        # user id in that column would make it answer the wrong question for every reader of the
        # audit screen. The subject of this event is the user whose access changed.
        audit.append(AuditEvent(
            slug, "scope", "", str(user_id),
            {"by": str(admin.id), "before": before,
             "after": sorted(g.target for g in rows)},
        ))
    return await _view(db, user_id)
