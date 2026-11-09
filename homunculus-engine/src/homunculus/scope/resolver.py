"""Turning a credential into a scope.

Built the same way `make_jwt_caller_resolver` (prodserver) is, and for the same reason: the
decision — what to do with a token that does not decode, with a user the database does not know,
with a database that is not answering — is testable here with neither Postgres nor a signing key.
Only the reader functions passed in touch either.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Awaitable, Callable

from homunculus.scope.rules import Scope, ScopeReason, build_scope

logger = logging.getLogger(__name__)

# A user whose scope cannot be established sees nothing. This is the one place in the package
# that fails closed, and it is the right place: everywhere else the question is "what has an
# administrator decided", here it is "we could not find out". Those are different, and only the
# second one is a reason to refuse — a look-up failure must not read as an empty assignment and
# quietly hand over the hospital.
UNKNOWN = Scope(False, "unknown")


def enforce_unassigned_default() -> bool:
    """Whether a user with no assignment sees nothing.

    Off unless a deployment says otherwise, because the pilot's database has no assignments in
    it and turning this on with an empty table blacks out every clinical screen at once. The
    flag is what makes narrowing access a decision somebody makes on a date, rather than a
    consequence of a deploy.
    """
    return os.getenv("SCOPE_ENFORCE_UNASSIGNED", "").strip().lower() in ("1", "true", "yes")


def make_scope_resolver(
    read_scope: Callable[[str, str], Awaitable[tuple[str | None, list[str], list[str], list[str]]]]
    | None = None,
    *,
    decode: Callable[[str], tuple[str, str] | None],
    break_glass: Callable[[str, str], Awaitable[list[str]]] | None = None,
    read_access: Callable[[str, str], Awaitable[
        tuple[str | None, list[str], list[str], list[str], list[str]]]] | None = None,
    enforce_unassigned: Callable[[], bool] = enforce_unassigned_default,
) -> Callable[[str], Awaitable[Scope]]:
    """Build the `resolve_scope` hook `create_app` calls for each credential.

    `decode(credential)` returns `(user_id, tenant_slug)` from the access token's `sub` and
    `tenant` claims, or None. `read_scope(user_id, tenant_slug)` returns
    `(role, unit_ids, bed_ids, own_patient_ids)` IN THAT TENANT; role None means no active
    membership there and resolves to UNKNOWN.
    `break_glass(user_id, tenant_slug)` returns the patients that user currently holds an open emergency session for —
    a list, not a flag, because a session is opened about one patient with a reason written
    about that patient. Without it wired, break-glass widens nothing here: a deployment that has
    not connected it gets no silent grant.

    `read_access(user_id, tenant_slug)` is the other way to read the same thing: ONE reader that
    returns `(role, unit_ids, bed_ids, own_patient_ids, break_glass_patient_ids)`, so a database
    reader can answer all of it in one session (`read_access_for_user`). It replaces `read_scope`
    and `break_glass` together — exactly one of `read_scope` / `read_access` is given, and
    `break_glass` only beside `read_scope`, or this raises TypeError: two readers answering one
    question could disagree, and nothing here would say which one the board believed. Its failures
    and its role None are handled exactly as `read_scope`'s.
    Production (`prodserver._scope_resolver`) passes `read_access=read_access_for_user` and
    `decode=decode_access_credential`.
    """
    if (read_scope is None) == (read_access is None):
        raise TypeError("make_scope_resolver needs exactly one of read_scope or read_access")
    if read_access is not None and break_glass is not None:
        raise TypeError("read_access already answers break-glass; break_glass goes with read_scope")

    async def resolve(credential: str) -> Scope:
        decoded = decode(credential)
        if decoded is None:
            # Not an error path worth a stack trace: an expired access token reaches this line
            # on every ward, all day. It is also not a reason to open the board.
            return UNKNOWN
        user_id, tenant_slug = decoded
        try:
            if read_access is not None:
                role, unit_ids, bed_ids, own, emergency = await read_access(user_id, tenant_slug)
                emergency = list(emergency)
            else:
                role, unit_ids, bed_ids, own = await read_scope(user_id, tenant_slug)
                emergency = list(await break_glass(user_id, tenant_slug)) if break_glass else []
        except Exception:
            # A database that is not answering must not be read as "this user has no
            # restrictions". The board goes dark and the log says why — the opposite failure
            # hands a whole hospital's patients to whoever is logged in when Postgres blinks.
            logger.exception("scope lookup failed for user %s; refusing rather than widening",
                             user_id)
            return UNKNOWN
        if role is None:
            # No active membership in this tenant (or unknown tenant): not "unassigned".
            return UNKNOWN
        return build_scope(
            role, unit_ids=unit_ids, bed_ids=bed_ids, own_patient_ids=own,
            break_glass_patient_ids=emergency, enforce_unassigned=enforce_unassigned(),
        )

    return resolve


def decode_access_credential(credential: str) -> tuple[str, str] | None:
    """`(user_id, tenant_slug)` from an access token, or None. No database.

    None on any decode error, a non-access token, or a missing `sub` / `tenant` claim.
    """
    from homunculus.auth.jwt import decode_token

    try:
        claims = decode_token(credential)
    except Exception:
        return None
    sub, tenant = claims.get("sub"), claims.get("tenant")
    if claims.get("type") != "access" or not isinstance(sub, str) or not sub:
        return None
    if not isinstance(tenant, str) or not tenant:
        return None
    return sub, tenant


async def read_scope_for_user(
    user_id: str, tenant_slug: str
) -> tuple[str | None, list[str], list[str], list[str]]:
    """The real reader: one database session, four answers, all for one tenant.

    Kept in one session so the four answers describe the same instant. An unknown or inactive
    tenant slug yields role None (resolver: UNKNOWN). Production no longer calls it: the board's
    resolver reads through `read_access_for_user`, which answers this and break-glass together in
    one session and two statements.
    """
    import uuid

    from sqlalchemy import select

    from homunculus.db import AsyncSessionLocal
    from homunculus.scope import service
    from homunculus.tenant.models import Tenant

    uid = uuid.UUID(user_id)
    async with AsyncSessionLocal() as session:
        tenant_id = (await session.execute(
            select(Tenant.id).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True))
        )).scalar_one_or_none()
        if tenant_id is None:
            return None, [], [], []
        grants = await service.read_grants(session, uid, tenant_id)
        role = await service.read_role(session, uid, tenant_id)
        own = await service.read_own_patient_ids(session, uid, tenant_id)
    return (role,
            [g.unit_id for g in grants if g.unit_id],
            [g.bed_id for g in grants if g.bed_id],
            own)


async def break_glass_in_tenant(session, user_id, tenant_id) -> list[str]:
    """Open break-glass patients of this user, restricted to one tenant (session and patient), in
    the identifiers the board uses: the HIS reference, and the board key of each of the patient's
    admissions here (G2-B1d D9: the protocol, a legacy admission's H-number) — without the key a
    session about a patient admitted in Homunculus granted nothing."""
    from datetime import datetime, timezone

    from homunculus.admission.boardkey import board_key
    from homunculus.admission.models import Admission, Patient

    now = datetime.now(timezone.utc)
    result = await session.execute(break_glass_rows(
        Patient.his_patient_reference, Patient.patient_number, Admission.protocol_no, Admission.id,
        user_id=user_id, tenant_id=tenant_id, now=now))
    out: list[str] = []
    for his, number, protocol_no, admission_id in result.all():
        key = board_key(protocol_no, number) if admission_id is not None else None
        out.extend(ref for ref in (his, key) if ref and ref not in out)
    return out


def break_glass_rows(*columns, user_id, tenant_id, now):
    """SELECT `columns` over this user's open, unexpired break-glass sessions in one tenant (the
    session's tenant and its patient's), one row per admission of that patient HERE — or one row
    with the admission's columns NULL when it has none here.

    The FROM and WHERE of `break_glass_in_tenant` and of `read_access_for_user`'s break-glass
    branch: what an emergency session opens is written once, so the two readers cannot drift."""
    from sqlalchemy import select

    from homunculus.admission.models import Admission, Patient
    from homunculus.escalation.models import BreakGlassSession

    return (
        select(*columns)
        .select_from(BreakGlassSession)
        .join(Patient, BreakGlassSession.patient_id == Patient.id)
        .outerjoin(Admission, (Admission.patient_id == Patient.id)
                   & (Admission.tenant_id == tenant_id))
        .where(
            BreakGlassSession.user_id == user_id,
            BreakGlassSession.tenant_id == tenant_id,
            Patient.tenant_id == tenant_id,
            BreakGlassSession.expires_at > now,
            BreakGlassSession.closed_at.is_(None),
        )
    )


async def break_glass_patient_ids(user_id: str, tenant_slug: str) -> list[str]:
    """The patients this user currently holds an open break-glass session for, in one tenant.

    Break-glass is already reason-bound and audited (§3.5). What it grants is access to the
    patient the reason was written about — so this returns those patients, in the identifier the
    board uses, and not a boolean that would open the ward.

    An expired or closed session grants nothing: the 30-minute box is the whole point of it.
    An unknown or inactive tenant slug yields [].
    """
    import uuid

    from sqlalchemy import select

    from homunculus.db import AsyncSessionLocal
    from homunculus.tenant.models import Tenant

    async with AsyncSessionLocal() as session:
        tenant_id = (await session.execute(
            select(Tenant.id).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True))
        )).scalar_one_or_none()
        if tenant_id is None:
            return []
        return await break_glass_in_tenant(session, uuid.UUID(user_id), tenant_id)


# The three lists of `read_access_for_user` arrive as one UNION ALL; each row says which it is.
_GRANT, _OWN, _GLASS = "grant", "own", "glass"


async def read_access_for_user(
    user_id: str, tenant_slug: str
) -> tuple[str | None, list[str], list[str], list[str], list[str]]:
    """`read_scope_for_user` and `break_glass_patient_ids` in one session and two statements:
    `(role, unit_ids, bed_ids, own_patient_ids, break_glass_patient_ids)`, all for one tenant.

    The production scope reader (`prodserver._scope_resolver`, through `read_access=`). Every
    request that needs a staff scope calls it — the live wave panel about once a second per open
    screen — and the two readers it replaces cost eight statements in two sessions for the same
    answer.

    1. One row (`_access_head`): the tenant, active, by slug; the account, which may not exist;
       whether it holds an active membership here and a membership of this tenant's system group.
       The role is `service.read_role`'s decision made from that row (`_role_from_head`). No row
       (unknown or inactive tenant) or role None (unknown or inactive account, no active
       membership) ends it here: `(None, [], [], [], [])`, which the resolver turns into UNKNOWN —
       there is no scope to read for somebody who sees nothing, so none is read.
    2. One UNION ALL (`_access_lists`) of the active grants, the care-team links with their
       windows, and the open break-glass sessions — each branch built by the same row builder as
       the reader it replaces (`service.grant_rows`, `service.own_patient_rows`,
       `break_glass_rows`), and each row turned into identifiers by the same rules:
       `service._window_open` for an ON-CALL window, `board_key` beside the HIS reference.

    The lists are those readers' lists as SETS — `build_scope` takes frozensets — and the grants
    are not ordered by `created_at`. Any failure raises; the resolver refuses on it.
    """
    import uuid
    from datetime import datetime, timezone

    from homunculus.admission.boardkey import board_key
    from homunculus.db import AsyncSessionLocal
    from homunculus.scope.service import _window_open

    uid = uuid.UUID(user_id)
    async with AsyncSessionLocal() as session:
        head = (await session.execute(_access_head(uid, tenant_slug))).first()
        role = _role_from_head(head)
        if role is None:
            return None, [], [], [], []
        now = datetime.now(timezone.utc)
        rows = (await session.execute(_access_lists(uid, head.tenant_id, now))).all()

    unit_ids: list[str] = []
    bed_ids: list[str] = []
    own: list[str] = []
    glass: list[str] = []
    for kind, unit_id, bed_id, his, number, protocol_no, admission_id, start, end in rows:
        if kind == _GRANT:
            if unit_id:
                unit_ids.append(unit_id)
            if bed_id:
                bed_ids.append(bed_id)
        elif kind == _OWN:
            if _window_open(start, end, now):
                key = board_key(protocol_no, number)
                own.extend(ref for ref in (his, key) if ref and ref not in own)
        elif kind == _GLASS:
            key = board_key(protocol_no, number) if admission_id is not None else None
            glass.extend(ref for ref in (his, key) if ref and ref not in glass)
        else:                                   # cannot happen; if it does, refuse, never guess
            raise RuntimeError(f"unexpected scope row kind {kind!r}")
    return role, unit_ids, bed_ids, own, glass


def _access_head(user_id, tenant_slug):
    """Statement 1 of `read_access_for_user`: at most one row — the active tenant by slug, outer-
    joined to the account (`user_active` NULL when it does not exist) — carrying the two facts
    `service.read_role` asks the database for: an ACTIVE membership in this tenant, and a
    membership (any source) of a group of THIS tenant with `is_system`."""
    from sqlalchemy import select

    from homunculus.auth.models import Group, TenantMembership, User, UserGroup
    from homunculus.tenant.models import Tenant

    member = select(TenantMembership.id).where(
        TenantMembership.user_id == user_id, TenantMembership.tenant_id == Tenant.id,
        TenantMembership.is_active.is_(True)).exists()
    admin = select(UserGroup.user_id).join(Group, Group.id == UserGroup.group_id).where(
        UserGroup.user_id == user_id, Group.tenant_id == Tenant.id,
        Group.is_system.is_(True)).exists()
    return (
        select(Tenant.id.label("tenant_id"), User.is_active.label("user_active"),
               User.is_platform_support.label("platform_support"),
               member.label("member"), admin.label("admin"))
        .select_from(Tenant)
        .outerjoin(User, User.id == user_id)
        .where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True))
    )


def _role_from_head(row) -> str | None:
    """`service.read_role`'s decision, in its order, from `_access_head`'s row: no row (no such
    active tenant), no account or an inactive one, or no active membership here — None; then the
    platform-operator flag — PLATFORM_SUPPORT; then this tenant's system group — HOSPITAL_ADMIN;
    otherwise MEMBER."""
    if row is None or not row.user_active or not row.member:
        return None
    if row.platform_support:
        return "PLATFORM_SUPPORT"
    return "HOSPITAL_ADMIN" if row.admin else "MEMBER"


def _typed_null(column):
    """NULL as `column`'s type, for the branches of a UNION that have no such column.

    `CAST(NULL AS <its SQL type>)` in SQL, because Postgres resolves a UNION's column types pair by
    pair, and two untyped NULLs meet as `text` — which a later uuid or timestamp branch cannot
    join. In Python the expression carries the column's own type, so the union's result column —
    typed by its FIRST branch — processes values as that column would whichever branch comes
    first: for `Patient.his_patient_reference` that is `EncryptedString`, which decrypts. `null()`
    is the SQL keyword, not a bound value, so it never passes through the encryptor."""
    from sqlalchemy import cast, null

    return cast(null(), column.type)


def _access_lists(user_id, tenant_id, now):
    """Statement 2 of `read_access_for_user`: the grants, the own-patient links and the open
    break-glass sessions, as one UNION ALL of nine positional columns — kind, unit_id, bed_id,
    his, number, protocol_no, admission_id, window_start, window_end — each branch NULL (typed)
    where it has nothing to say. The own-patient branch comes first, so even the union's own
    column types are the real columns', the encrypted HIS reference included."""
    from sqlalchemy import literal_column, union_all

    from homunculus.admission.models import Admission, CareTeamMember, Patient
    from homunculus.scope import service
    from homunculus.scope.models import StaffScope

    def kind(name: str):
        return literal_column(f"'{name}'").label("kind")         # a constant of this module

    unit, bed = StaffScope.unit_id, StaffScope.bed_id
    his, number = Patient.his_patient_reference, Patient.patient_number
    protocol_no, admission_id = Admission.protocol_no, Admission.id
    start, end = CareTeamMember.window_start, CareTeamMember.window_end
    n = _typed_null

    own = service.own_patient_rows(
        kind(_OWN), n(unit).label("unit_id"), n(bed).label("bed_id"), his.label("his"),
        number.label("number"), protocol_no.label("protocol_no"),
        admission_id.label("admission_id"), start.label("window_start"),
        end.label("window_end"),
        user_id=user_id, tenant_id=tenant_id)
    glass = break_glass_rows(
        kind(_GLASS), n(unit), n(bed), his, number, protocol_no, admission_id, n(start), n(end),
        user_id=user_id, tenant_id=tenant_id, now=now)
    grants = service.grant_rows(
        kind(_GRANT), unit, bed, n(his), n(number), n(protocol_no), n(admission_id), n(start),
        n(end),
        user_id=user_id, tenant_id=tenant_id)
    return union_all(own, glass, grants)


__all__ = ["UNKNOWN", "ScopeReason", "break_glass_patient_ids", "decode_access_credential",
           "enforce_unassigned_default",
           "make_scope_resolver", "read_access_for_user", "read_scope_for_user"]
