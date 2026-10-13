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

from homunculus.auth.dependencies import caller_tenant_id, get_current_user, require_permission
from homunculus.auth.models import TenantMembership, User
from homunculus.db import get_db
from homunculus.scope import service
from homunculus.scope.resolver import UNKNOWN, break_glass_in_tenant, enforce_unassigned_default
from homunculus.scope.rules import SCOPE_UNRESTRICTED_ROLES, build_scope
from homunculus.scope.schemas import ScopeAssignment, ScopeGrantOut, ScopeView

router = APIRouter(prefix="/scope", tags=["scope"])

# Assigning staff to units and beds is user management (roadmap D5).
_admin = Depends(require_permission("users.manage"))


def _audit(request: Request):
    """The app's audit log, when this router is mounted on an app that has one.

    Optional rather than required: the scope routes must not stop working because a deployment
    assembled the app without an audit sink. A missing log is reported by the audit screen's own
    checks, not by a 500 here.
    """
    return getattr(request.app.state, "audit", None)


async def _slug_of_member(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """The caller's tenant slug, provided `user_id` is an active member of that tenant.

    404, not 403, for anyone else: a 403 would confirm the account exists in another hospital.
    """
    from homunculus.tenant.models import Tenant

    row = (await db.execute(
        select(Tenant.slug)
        .select_from(TenantMembership)
        .join(Tenant, TenantMembership.tenant_id == Tenant.id)
        .where(TenantMembership.user_id == user_id, TenantMembership.tenant_id == tenant_id,
               TenantMembership.is_active == True)  # noqa: E712
    )).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "kullanıcı bulunamadı")
    return row[0]


async def _view(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> ScopeView:
    """What this user's scope resolves to — decided the way the BOARD decides it.

    Both of the arguments below used to be missing, and that made this route answer a different
    question from the one every caller thinks it answers. The board's own resolver
    (`scope/resolver.make_scope_resolver`) passes `break_glass_patient_ids` and
    `enforce_unassigned`; this route passed neither, so:

      * with `SCOPE_ENFORCE_UNASSIGNED` on, a user with no assignment resolved here as
        `unrestricted: true, reason: "unassigned"` — "you see everything" — while the board showed
        that user nothing. A screen reading this route would have told an administrator the
        opposite of what the clinician was looking at, on exactly the configuration a hospital
        turns on when it starts restricting access;
      * a clinician holding an open break-glass session had its patients omitted here, so the one
        thing that is reason-bound and audited was invisible to the route that exists to explain
        why a board is the size it is.

    And a role of None — no active account or no active membership here; a DEACTIVATED account,
    whose membership `/scope/{id}` still finds — is UNKNOWN, as the resolver decides it: sees
    nothing. Handed to `build_scope` it read as "no assignment" and, with enforcement off, as
    unrestricted: the administrator was told a deactivated nurse saw every patient.

    Nothing else about the route changes: the same four reads, the same `ScopeView`. Both
    arguments are read from the same places the board reads them, so there is one answer to
    "what may this user see" and not two.
    """
    grants = await service.read_grants(db, user_id, tenant_id)
    role = await service.read_role(db, user_id, tenant_id)
    own = await service.read_own_patient_ids(db, user_id, tenant_id)
    emergency = await break_glass_in_tenant(db, user_id, tenant_id)
    scope = UNKNOWN if role is None else build_scope(
        role,
        unit_ids=[g.unit_id for g in grants if g.unit_id],
        bed_ids=[g.bed_id for g in grants if g.bed_id],
        own_patient_ids=own,
        break_glass_patient_ids=emergency,
        enforce_unassigned=enforce_unassigned_default(),
    )
    return ScopeView(
        user_id=user_id, role=role,
        unrestricted=scope.unrestricted, reason=scope.reason,
        unit_ids=sorted(scope.unit_ids), bed_ids=sorted(scope.bed_ids),
        grants=[ScopeGrantOut.model_validate(g) for g in grants],
        own_patients=len(scope.own_patient_ids),
    )


@router.get("/me", response_model=ScopeView, summary="What the caller may see, and why")
async def my_scope(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
    tenant_id: uuid.UUID = Depends(caller_tenant_id),
) -> ScopeView:
    return await _view(db, user.id, tenant_id)


@router.get("/unassigned", summary="How many active users hold no scope at all")
async def unassigned(
    db: AsyncSession = Depends(get_db), admin: User = _admin,
    tenant_id: uuid.UUID = Depends(caller_tenant_id),
) -> dict:
    """The administrator's to-do counter.

    Without it, "everyone sees everything because nobody has been assigned yet" and "everyone
    sees everything because that is this hospital's policy" are the same screen.
    """
    from homunculus.tenant.models import Tenant

    slug = (await db.execute(select(Tenant.slug).where(Tenant.id == tenant_id))).scalar_one()
    return {"tenant": slug,
            "unassigned_users": await service.count_unassigned(db, tenant_id)}


@router.get("/{user_id}", response_model=ScopeView, summary="One user's scope")
async def get_scope(
    user_id: uuid.UUID, db: AsyncSession = Depends(get_db), _admin_user: User = _admin,
    tenant_id: uuid.UUID = Depends(caller_tenant_id),
) -> ScopeView:
    await _slug_of_member(db, tenant_id, user_id)
    return await _view(db, user_id, tenant_id)


@router.put("/{user_id}", response_model=ScopeView, summary="Replace one user's scope")
async def put_scope(
    user_id: uuid.UUID, body: ScopeAssignment, request: Request,
    db: AsyncSession = Depends(get_db), admin: User = _admin,
    tenant_id: uuid.UUID = Depends(caller_tenant_id),
) -> ScopeView:
    """Set this user's scope to exactly what the body says.

    Replacement, not a diff: an administrator filling in a form is deciding what this person's
    access *is*. Two administrators saving diffs concurrently would merge into the union of both
    — the more permissive outcome, chosen by neither of them.
    """
    # Only an unrestricted administrator assigns scope (as on main). `users.manage` alone would
    # let its holder grant themselves every unit or blind someone with more rights.
    if await service.read_role(db, admin.id, tenant_id) not in SCOPE_UNRESTRICTED_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            detail="kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız")
    slug = await _slug_of_member(db, tenant_id, user_id)

    before = sorted(g.target for g in await service.read_grants(db, user_id, tenant_id))
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
    return await _view(db, user_id, tenant_id)
