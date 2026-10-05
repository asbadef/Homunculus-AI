"""
Auth API routes.
POST /auth/login        — username or e-mail + password; returns tokens (requires_mfa when a
                          TOTP step is still pending, mfa_enrolled when the user has one). An
                          Active Directory account is checked by the directory (spec §7): a
                          wrong password is 401, a directory that does not answer is 503, and
                          after 3 failed binds in a chain (one that ends only when 15 minutes
                          pass with none) the account is refused with 429 without asking the
                          directory (the domain's own lockout counts them).
                          Every 401 takes at least LOGIN_FAILURE_FLOOR_S (0.5 s)
POST /auth/totp/setup   — generate TOTP secret + QR provisioning URI (allowed before MFA)
POST /auth/totp/verify  — verify 6-digit code; re-issues tokens with mfa_verified=True
POST /auth/refresh      — exchange refresh token for new tokens built from the CURRENT groups; an
                          AD account is read back from the directory first (disabled, expired,
                          gone or password changed there: 401; otherwise its AD groups apply, so
                          the new token carries them; directory down: the session goes on; an
                          answer about the account that cannot be read: 503, nothing renewed)
GET  /auth/me           — profile, tenant, groups, permissions (allowed before MFA)
POST /auth/password     — change own password (local accounts)

Every sign-in, MFA and password event goes to the audit trail (never a password or a code).
"""
from __future__ import annotations
import asyncio
import hmac
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import (
    Principal, get_current_user_pre_mfa, get_principal_pre_mfa, get_principal_pre_password,
    get_user_for_enrolment,
)
from homunculus.auth.groups import TenantRef, tenant_of_user
from homunculus.auth.jwt import decode_token
from homunculus.auth.ldap import (
    DEADLINE_CAP_S, DIRECTORY_DOWN, LdapIdentity, LdapUnavailable, account_expired, get_ldap,
    login_matches, password_changed_since,
)
from homunculus.auth.ldap_sync import (
    LDAP_SYNC_ACTOR, SyncOutcome, apply_directory_profile, sync_ldap_groups,
)
from homunculus.auth.limits import directory_binds, totp_failures
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
from homunculus.auth.service import (
    PasswordError, StaleSession, build_context, change_password, credential_fingerprint,
    enable_totp, find_user_for_sign_in, get_user_by_id, issue_tokens, mark_login,
    password_change_due, run_bcrypt, setup_totp, verify_local_password,
)
from homunculus.auth.session_policy import SCREEN_LOCK_IDLE_MINUTES, SCREEN_LOCK_SIGNOUT_HOURS
from homunculus.auth.totp import accepted_step
from homunculus.db import get_db
from homunculus.tenant.models import Tenant

router = APIRouter(prefix="/auth", tags=["auth"])

# The last TOTP time step accepted per user: a code at or before it is refused, so a code that
# was seen once (over a shoulder, in a proxy log) cannot be used again. In memory, like the
# attempt limit in `auth/limits.py` — the engine is a single process.
_last_step: dict[uuid.UUID, int] = {}

_TOTP_LOCKED = "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin."
_TOTP_REPLAYED = "Bu kod zaten kullanıldı; yeni kodu bekleyin."
# The AD bind throttle's refusal; "15" is DIRECTORY_BIND_WINDOW_S (auth/limits.py).
_DIRECTORY_THROTTLED = "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin"
# Directory failures after which a refresh goes on unsynced (the spec §4 outage rule): the
# domain controller could not be reached, or would not let the service account in — nothing
# about the account itself. Any other reason (`protocol` also covers a reply about THIS account
# that could not be read: an unexpected library error, a group list over the limit) is a 503
# with no new tokens, so rights AD may have removed are not carried forward; the client keeps
# its refresh token and tries again.
_REFRESH_OUTAGES = frozenset({"unreachable", "timeout", "tls", "service_bind_rejected"})
_NO_USER = uuid.UUID(int=0)
# Every refused sign-in (401) answers no sooner than this after the request reached the route.
# It hides the domain controller's round trips, which an AD sign-in makes and an unknown or
# local login does not (spec §4: timing must not say which logins are AD accounts). A sleep:
# no CPU spent, the event loop free meanwhile. It must stay far below the dashboard's 15 s
# request timeout. A success, a 429 and a 503 are not held: their status says it already.
LOGIN_FAILURE_FLOOR_S = 0.5
_now = time.monotonic             # the floor's clock and sleep, replaced by the tests
_sleep = asyncio.sleep


def _bad_credentials() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")


def _directory_down() -> HTTPException:
    """Spec §4: a directory that does not answer is a fault to report (503), never the
    clinician's own mistake (401)."""
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=DIRECTORY_DOWN)


def _audit_login_fail(request: Request, ref: TenantRef | None, key: str, reason: str) -> None:
    """The `login.fail` row, filed under the account's hospital (`ref`), or "-" for none. A
    plain call (the audit append is synchronous): nothing in it can be cancelled."""
    append_audit(request, tenant=ref.slug if ref is not None else None, event_type="auth",
                 subject="login.fail", payload={"login": key, "reason": reason})


async def _login_failed(request: Request, db: AsyncSession, user_id: uuid.UUID | None, key: str,
                        reason: str) -> None:
    """Audit a failed sign-in. A known account's failure is filed under its hospital, so the
    hospital's own (tenant-scoped) audit shows attempts on its accounts; an unknown login has
    no hospital and is filed under "-".

    The tenant lookup runs for an unknown login too (with the nil UUID, which matches nothing):
    a failure then costs the same queries whether or not the account exists. Takes the account's
    id, not the row: after a directory call the row may be expired (see _directory_sign_in)."""
    ref = await tenant_of_user(db, user_id if user_id is not None else _NO_USER)
    _audit_login_fail(request, ref, key, reason)


async def _directory_sign_in_refused(request: Request, db: AsyncSession, user_id: uuid.UUID,
                                     key: str, reason: str, password: str) -> HTTPException:
    """An AD sign-in refused with 401: audited, after the SAME dummy bcrypt comparison an unknown
    login pays (spec §4: response time must not reveal whether the account exists). Without it
    an AD refusal answered in a few milliseconds against ~0.2 s for an unknown login or a local
    wrong password — telling AD accounts, and deactivated ones, apart: a target list for
    lockout attacks. The 429 and 503 refusals do not pay it: their status says it already."""
    await run_bcrypt(verify_local_password, None, None, password)
    await _login_failed(request, db, user_id, key, reason)
    return _bad_credentials()


@router.post("/login", response_model=TokenResponse, summary="Sign in with username or e-mail")
async def login(body: LoginRequest, request: Request,
                db: AsyncSession = Depends(get_db)) -> TokenResponse:
    started = _now()
    try:
        return await _sign_in(body, request, db)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            rest = LOGIN_FAILURE_FLOOR_S - (_now() - started)
            if rest > 0:
                # No 401 path writes anything (lookups, the audit row is in memory): the
                # connection goes back to the pool before the wait, or a burst of wrong
                # passwords at shift change would pin the pool for the floor each.
                await db.rollback()
                await _sleep(rest)
        raise


async def _sign_in(body: LoginRequest, request: Request, db: AsyncSession) -> TokenResponse:
    user, key = await find_user_for_sign_in(db, body.identifier)

    if user is not None and user.auth_source == AUTH_LDAP:
        return await _directory_sign_in(request, db, user, key, body.password)

    # bcrypt is ~0.2 s of CPU: off the event loop, or every sign-in stalls ingest and SSE. The
    # account's fields are read here, on the loop; the worker thread gets plain values.
    source = user.auth_source if user is not None else None
    hashed = user.hashed_password if user is not None else None
    user_id = user.id if user is not None else None
    if not await run_bcrypt(verify_local_password, source, hashed, body.password):
        await _login_failed(request, db, user_id, key, "bad_credentials")
        raise _bad_credentials()
    if not user.is_active:
        await _login_failed(request, db, user_id, key, "inactive")
        raise _bad_credentials()

    ctx = await build_context(db, user)
    mark_login(user)
    await db.commit()
    tokens = issue_tokens(user, ctx, mfa_verified=False)
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source,
                          "mfa_pending": tokens["requires_mfa"]})
    return TokenResponse(**tokens)


def _audit_sync(request: Request, tenant: str, user_id: uuid.UUID,
                outcome: SyncOutcome) -> None:
    """The directory group sync's audit rows (spec §7 step 5), written after the commit, at
    sign-in and at refresh alike: `admin/user.groups` when the set changed, and
    `admin/ldap.sync.guarded` when the administrator guard kept a group. Actor `ldap-sync`."""
    if outcome.changed:
        append_audit(request, tenant=tenant, event_type="admin", subject="user.groups",
                     payload={"actor": LDAP_SYNC_ACTOR, "target": str(user_id),
                              "before": list(outcome.before), "after": list(outcome.after)})
    if outcome.guarded:
        append_audit(request, tenant=tenant, event_type="admin", subject="ldap.sync.guarded",
                     payload={"actor": LDAP_SYNC_ACTOR, "target": str(user_id),
                              "kept": list(outcome.guarded)})


async def _directory_sign_in(request: Request, db: AsyncSession, user: User, key: str,
                             password: str) -> TokenResponse:
    """Spec §7, "Sign-in for an AD user". The password goes to ONE bind, as the account's DN
    found by objectGUID, and nowhere else: not stored, logged or audited. A wrong password, an
    account disabled, past its end date (accountExpires) or gone in AD, or a login form
    LDAP_LOGIN_ATTRS does not allow: 401. A directory that does not answer, or none configured:
    503 — never conflated with 401.

    A deactivated account is refused before the directory is asked (no bind, so no AD lockout
    count for an account Homunculus has switched off), and so is an account whose chain of
    failed binds is full — 3, or 6 after an administrator's unlock — until 15 minutes pass
    with no failed bind (429, `directory_binds`, counted as AD counts; a right password — an
    identity the directory returns `bound` — ends it for the failures recorded before it
    began) — Homunculus must never be the way a clinician gets locked out of the hospital
    domain. The database connection is released while the directory answers, so a slow domain
    controller cannot pin the pool at shift change; the account is re-read afterwards (plan
    decisions D7, D8).

    Every failed bind the throttle counts is audited (`login.fail`) the moment it is counted,
    with nothing awaited in between — a wrong password, an outage once the password was sent,
    and a sign-in cancelled (`cancelled`) or failing on a fault (`directory_error`) once it may
    have been: the row exists even for a request cut off right then, and the runbook reads
    these rows before a restart. The hospital they are filed under is read before the
    directory is asked."""
    user_id, external_id = user.id, user.external_id
    if not user.is_active:
        raise await _directory_sign_in_refused(request, db, user_id, key, "inactive", password)
    ldap = get_ldap(request)
    if ldap is None:
        await _login_failed(request, db, user_id, key, "directory_unavailable")
        raise _directory_down()
    if not password or not external_id:
        raise await _directory_sign_in_refused(request, db, user_id, key, "bad_credentials",
                                               password)
    # The hospital a failure is filed under, read while the connection is held: once the
    # directory is asked, a failure is audited without awaiting anything (see above).
    audit_ref = await tenant_of_user(db, user_id)
    await db.rollback()                      # nothing written yet; frees the connection
    # Every failed bind also counts toward the hospital domain's lockout: past the limit the
    # directory is not asked at all (auth/limits.py, directory_binds). Nothing may sit between
    # `begin` and the try below: the place it reserves must be released on every path.
    slot = str(user_id)
    ticket = directory_binds.begin(slot)
    if ticket is None:
        await _login_failed(request, db, user_id, key, "throttled")
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail=_DIRECTORY_THROTTLED)
    # An outage counts only when the password had reached the directory (`bind_attempted`):
    # a clinician retrying through a domain controller blip — the service bind cut off, the call
    # queued — must not be refused for 15 minutes. A bind cut off while under way is dated as
    # late as the domain controller may still count it (`bind_pending_s`). A cancellation counts
    # unless the directory marked it as made before that bind (Ldap3Directory does); anything
    # else fails closed, dated as late as the longest deadline.
    try:
        identity = await ldap.directory.authenticate(external_id, password)
    except LdapUnavailable as exc:
        directory_binds.end(slot, ticket, failed=exc.bind_attempted,
                            pending_s=exc.bind_pending_s)
        _audit_login_fail(request, audit_ref, key, "directory_unavailable")
        raise _directory_down() from None
    except BaseException as exc:             # cancelled, or a fault: the bind may have been made
        counted = getattr(exc, "bind_attempted", True)
        directory_binds.end(slot, ticket, failed=counted,
                            pending_s=getattr(exc, "bind_pending_s", DEADLINE_CAP_S))
        if counted:
            # No await here: a cancelled request can be cancelled again at its next one (anyio's
            # cancel scopes do), and this failure must reach the audit trail all the same.
            _audit_login_fail(request, audit_ref, key,
                              "cancelled" if isinstance(exc, asyncio.CancelledError)
                              else "directory_error")
        raise
    if identity is None:
        # A wrong password (or no such account, which made no bind — counted all the same):
        # audited at once, then the dummy bcrypt every AD 401 pays (_directory_sign_in_refused).
        directory_binds.end(slot, ticket, failed=True)
        _audit_login_fail(request, audit_ref, key, "bad_credentials")
        await run_bcrypt(verify_local_password, None, None, password)
        raise _bad_credentials()
    directory_binds.end(slot, ticket, failed=False)
    if identity.bound:
        # The bind as the account succeeded, and AD reset its count then — the directory says
        # so (`LdapIdentity.bound`); this route does not guess it from the clock. Right after
        # `end`, nothing awaited in between: the failures recorded while this attempt ran, which
        # AD may count after that reset, stay in the chain (auth/limits.py, `succeeded`).
        directory_binds.succeeded(slot, ticket)
    if identity.disabled:                    # returned without a bind: nothing for AD to count
        refusal = "directory_disabled"
    elif not identity.bound:
        # Returned without a bind and not disabled: past its end date, as the directory judged
        # it (accountExpires). Refused whatever this server's clock says now.
        refusal = "directory_expired"
    else:
        refusal = None if login_matches(key, identity, ldap.login_attrs) else "bad_credentials"
    if refusal is not None:
        raise await _directory_sign_in_refused(request, db, user_id, key, refusal, password)
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:               # deactivated while AD answered
        raise await _directory_sign_in_refused(request, db, user_id, key, "inactive", password)
    # Lock order: every writer takes the tenant's admin lock BEFORE it updates an account's row
    # (the /admin API does). The group sync may take that lock, so it runs before anything here
    # writes the row (profile, last_login_at): a sign-in holding the row while it waited for
    # the lock would deadlock against an /admin write holding the lock and waiting for the row.
    ref = await tenant_of_user(db, user_id)
    outcome = (await sync_ldap_groups(db, user=user, tenant_id=ref.id,
                                      group_dns=identity.group_dns)
               if ref is not None else None)
    profile = await apply_directory_profile(db, user, identity)
    mark_login(user)
    await db.commit()
    if outcome is not None:
        _audit_sync(request, ref.slug, user_id, outcome)
    ctx = await build_context(db, user)
    tokens = issue_tokens(user, ctx, mfa_verified=False)
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source,
                          "mfa_pending": tokens["requires_mfa"], "profile": sorted(profile)})
    return TokenResponse(**tokens)


@router.post("/totp/setup", response_model=TOTPSetupResponse, summary="Setup TOTP authenticator")
async def totp_setup(
    request: Request,
    current_user: User = Depends(get_user_for_enrolment),
    principal: Principal = Depends(get_principal_pre_mfa),   # same cached instance; for the tenant
    db: AsyncSession = Depends(get_db),
) -> TOTPSetupResponse:
    replace = bool(current_user.totp_enabled)
    _secret, uri = await setup_totp(db, current_user)
    # A new secret starts a new code sequence; steps accepted under the old one say nothing
    # about it (and would hold a replacement's first code back until the next step).
    _last_step.pop(current_user.id, None)
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="mfa.enrol",
                 payload={"user": current_user.username, "replace": replace})
    return TOTPSetupResponse(provisioning_uri=uri)


@router.post("/totp/verify", response_model=TokenResponse,
             summary="Verify TOTP and get MFA-verified tokens")
async def totp_verify(
    body: TOTPVerifyRequest,
    request: Request,
    principal: Principal = Depends(get_principal_pre_mfa),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = principal.user
    if not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP not set up")

    def audit(subject: str, **payload) -> None:
        append_audit(request, tenant=principal.tenant, event_type="auth", subject=subject,
                     payload={"user": user.username, **payload})

    key = str(user.id)
    if totp_failures.locked(key):
        # No audit row per refusal: the lock was recorded once, as `mfa.locked`, when it engaged.
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_TOTP_LOCKED)

    # The code is checked exactly once, here, for a first enrolment and a routine sign-in alike.
    # No await between the check and recording the step: two concurrent requests carrying the
    # same code cannot both pass.
    step = accepted_step(user.totp_secret, body.code)
    if step is None:
        audit("mfa.fail", reason="bad_code")
        if totp_failures.failed(key):
            audit("mfa.locked", lock_seconds=totp_failures.lock_seconds)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")
    if step <= _last_step.get(user.id, -1):
        # A genuine code, already used — the clinician re-typed it, or someone replayed it. Not a
        # guess (it had to be right), so it does not count toward the lock; it is refused and
        # recorded all the same.
        audit("mfa.fail", reason="replayed_code")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_TOTP_REPLAYED)
    _last_step[user.id] = step
    totp_failures.succeeded(key)

    first = not user.totp_enabled
    if first:
        await enable_totp(db, user)
    audit("mfa.ok", first_enrolment=first)
    ctx = await build_context(db, user)
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=True))


@router.post("/refresh", response_model=TokenResponse,
             summary="Exchange refresh token for tokens built from the current groups")
async def refresh_token(body: RefreshRequest, request: Request,
                        db: AsyncSession = Depends(get_db)) -> TokenResponse:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
    )
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exc
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise credentials_exc

    # The database's own checks first: a token it already refuses costs no directory round trip.
    user = await get_user_by_id(db, user_id)
    if not _session_still_valid(user, payload):
        raise credentials_exc
    identity: LdapIdentity | None = None
    if user.auth_source == AUTH_LDAP:
        # An AD account's credential fingerprint covers only its TOTP secret: a password changed
        # or an account disabled in AD is seen only by asking AD (spec §7).
        refuse, identity = await _directory_at_refresh(request, db, user, payload.get("iat"))
        if refuse:
            raise credentials_exc
        user = await get_user_by_id(db, user_id)          # re-read: the check let the row go
        if not _session_still_valid(user, payload):       # deactivated or reset meanwhile
            raise credentials_exc

    if identity is not None:
        # The directory answered: its group memberships apply now, so this refresh already
        # carries the current rights — a removal is not left for the next sign-in (plan D9).
        ref = await tenant_of_user(db, user.id)
        if ref is not None:
            outcome = await sync_ldap_groups(db, user=user, tenant_id=ref.id,
                                             group_dns=identity.group_dns)
            await db.commit()
            _audit_sync(request, ref.slug, user.id, outcome)

    ctx = await build_context(db, user)
    # Verified only if the refresh token says so AND an authenticator still exists (an MFA reset
    # must send the user back through enrolment, not keep a stale "verified").
    verified = payload.get("mfa_verified") is True and user.totp_enabled
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=verified))


def _session_still_valid(user: User | None, payload: dict) -> bool:
    """The refresh token's checks against the database: the account exists and is active, the
    token was issued after the account's last deactivation, and the credentials the session
    was opened with still hold."""
    if user is None or not user.is_active:
        return False
    revoked = user.sessions_revoked_at
    iat = payload.get("iat")
    if revoked is not None and (type(iat) is not int or iat <= revoked.timestamp()):
        # Issued before the account's last deactivation: reactivating it must not revive the
        # sessions it had ("phone stolen, deactivate, reactivate tomorrow").
        return False
    cv = payload.get("cv")
    # Compared as bytes: `compare_digest` raises TypeError on a non-ASCII str, which a claim
    # can hold — that must be a 401, not a 500. A mismatch: the password or the authenticator
    # changed since this session opened — sign in again.
    return isinstance(cv, str) and hmac.compare_digest(
        cv.encode(), credential_fingerprint(user).encode())


async def _directory_at_refresh(request: Request, db: AsyncSession, user: User,
                                iat: object) -> tuple[bool, LdapIdentity | None]:
    """Spec §7, "Refresh for an AD account" (plan decisions D7, D9). Returns (refuse, identity).

    refuse is True when the session must end: the account is gone (deleted, moved out of
    LDAP_BASE_DN, excluded by LDAP_USER_FILTER), disabled, past its end date (accountExpires),
    or its password was set after the refresh token was issued (pwdLastSet later than `iat`, or
    0 — "must change at next logon").
    identity is the account as the directory reports it now, for the group sync; None when the
    directory is down (`_REFRESH_OUTAGES`) or not configured — the session goes on, unsynced
    (the spec §4 outage rule), and the audit trail says so. Any other directory failure raises
    503 (`refresh.directory_error`): no tokens, the refresh token kept for a retry. Releases the
    database connection while the directory answers; the caller re-reads the account."""
    user_id, username, external_id = user.id, user.username, user.external_id
    ref = await tenant_of_user(db, user_id)
    tenant = ref.slug if ref is not None else None

    def audit(subject: str, reason: str) -> None:
        append_audit(request, tenant=tenant, event_type="auth", subject=subject,
                     payload={"user": username, "reason": reason})

    ldap = get_ldap(request)
    if ldap is None:
        audit("refresh.directory_unavailable", "not_configured")
        return False, None
    if not external_id or type(iat) is not int:
        audit("refresh.fail", "directory_not_found" if not external_id else "bad_token")
        return True, None
    await db.rollback()                      # read-only so far; frees the connection
    try:
        identity = await ldap.directory.find_by_external_id(external_id)
    except LdapUnavailable as exc:
        if exc.reason in _REFRESH_OUTAGES:
            audit("refresh.directory_unavailable", exc.reason)
            return False, None
        audit("refresh.directory_error", exc.reason)
        raise _directory_down() from None
    if identity is None:
        reason = "directory_not_found"
    elif identity.disabled:
        reason = "directory_disabled"
    elif account_expired(identity.account_expires, time.time()):
        reason = "directory_expired"
    elif password_changed_since(identity.pwd_last_set, iat):
        reason = "directory_password_changed"
    else:
        return False, identity
    audit("refresh.fail", reason)
    return True, None


@router.get("/me", response_model=UserMeResponse, summary="Current user profile")
async def me(current_user: User = Depends(get_current_user_pre_mfa),
             db: AsyncSession = Depends(get_db)) -> UserMeResponse:
    ctx = await build_context(db, current_user)
    tenant_name = (await db.scalar(select(Tenant.name).where(Tenant.id == ctx.tenant_id))
                   if ctx.tenant_id is not None else None)
    return UserMeResponse(
        id=current_user.id, username=current_user.username, email=current_user.email,
        full_name=current_user.full_name, auth_source=current_user.auth_source,
        totp_enabled=current_user.totp_enabled, is_active=current_user.is_active,
        created_at=current_user.created_at, tenant=ctx.tenant, tenant_name=tenant_name,
        groups=[GroupBrief(slug=s, name=n) for s, n in zip(ctx.groups, ctx.group_names)],
        perms=sorted(ctx.perms), must_change_password=password_change_due(current_user),
        lock_idle_minutes=SCREEN_LOCK_IDLE_MINUTES, lock_signout_hours=SCREEN_LOCK_SIGNOUT_HOURS,
    )


@router.post("/password", response_model=TokenResponse,
             summary="Change own password (local accounts); returns fresh tokens")
async def password(body: PasswordChangeRequest, request: Request,
                   principal: Principal = Depends(get_principal_pre_password),
                   db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """The change retires every existing session (token version and credential fingerprint
    both move), so the caller receives a fresh pair and keeps working. It is also how a
    temporary password is replaced: the one route such a session reaches (after MFA)."""
    current_user = principal.user
    try:
        await change_password(db, current_user, body.current_password, body.new_password)
    except PasswordError as exc:
        append_audit(request, tenant=principal.tenant, event_type="auth",
                     subject="password.change.fail",
                     payload={"user": current_user.username, "reason": exc.reason})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except StaleSession:
        # A reset (or another bump) landed after this token was checked: answered as the stale
        # token itself would be, so the reset stands (auth.service.change_password).
        append_audit(request, tenant=principal.tenant, event_type="auth",
                     subject="password.change.fail",
                     payload={"user": current_user.username, "reason": "stale_session"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token_version",
                            headers={"WWW-Authenticate": "Bearer"}) from None
    append_audit(request, tenant=principal.tenant, event_type="auth", subject="password.change",
                 payload={"user": current_user.username})
    ctx = await build_context(db, current_user)
    verified = principal.mfa_verified and current_user.totp_enabled
    return TokenResponse(**issue_tokens(current_user, ctx, mfa_verified=verified))
