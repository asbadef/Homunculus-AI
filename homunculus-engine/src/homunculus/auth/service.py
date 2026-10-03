"""
Authentication business logic: passwords, the sign-in lookup, the session context a token is
minted from, token issuance, TOTP, password change.

bcrypt from async code goes through `run_bcrypt(fn, *args)` — e.g.
`await run_bcrypt(hash_password, plain)` or `await run_bcrypt(verify_local_password, source,
hashed, plain)` — never called inline (it would stall the single worker's event loop) and never
through the shared thread pool directly (a burst of sign-ins would starve every other sync
route). Pass plain values, not ORM objects: the function runs on a worker thread.
"""
from __future__ import annotations
import functools
import hashlib
import hmac
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, TypeVar

import anyio
import anyio.to_thread
import bcrypt
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import bump_user, groups_of, summarize, tenant_of_user
from homunculus.auth.jwt import JWT_SECRET, create_access_token, create_refresh_token
from homunculus.auth.models import AUTH_LDAP, AUTH_LOCAL, User
from homunculus.auth.totp import generate_provisioning_uri, generate_totp_secret

# bcrypt is used directly: passlib has been unmaintained since 2020 and is incompatible with
# bcrypt >= 4.1 (it raised "password cannot be longer than 72 bytes" for every password, which
# made user creation and login impossible).
_BCRYPT_MAX_BYTES = 72


def _secret(plain: str) -> bytes:
    """Encode for bcrypt, which hashes at most 72 bytes. Longer secrets are truncated — bcrypt's
    own long-standing behaviour, made explicit here instead of left to the driver to reject."""
    return plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_secret(plain), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_secret(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False   # malformed stored hash must fail the login, not crash it


# Compared against when there is no such account, no local password, or an AD account: the
# response then costs the same bcrypt work as a wrong password, so timing does not reveal
# whether a login exists.
_DUMMY_HASH = hash_password("homunculus-no-such-account")

# At most four bcrypt computations at once, on their own tokens: the shared thread pool (40
# threads) also serves every sync route and dependency, and a burst of sign-ins must queue
# behind this limit rather than occupy the whole pool.
BCRYPT_LIMITER = anyio.CapacityLimiter(4)

_T = TypeVar("_T")


async def run_bcrypt(fn: Callable[..., _T], *args: Any) -> _T:
    """Run a bcrypt-bound function (`hash_password`, `verify_password`, `verify_local_password`)
    on a worker thread under BCRYPT_LIMITER. Arguments must be plain values."""
    return await anyio.to_thread.run_sync(functools.partial(fn, *args), limiter=BCRYPT_LIMITER)


def normalize_login(value: str | None) -> str:
    """Trimmed and lower-cased, with the Turkish i's folded to a plain `i`:
    - the capital `İ` (a keyboard auto-capitalises `i` to it) first, since `"İ".lower()` is `i` +
      a combining dot, two code points that would never match the stored login;
    - the dotless `ı`, which a Turkish keyboard types where `i` was meant (`ıbrahim`).
    Usernames created through /admin are ASCII only, so the fold cannot make two of them one."""
    return (value or "").strip().replace("İ", "i").lower().replace("ı", "i")


async def find_user_by_login(db: AsyncSession, login: str) -> User | None:
    """By username OR e-mail, case-insensitively (both are stored lower-case). When the key is
    one account's username and another's e-mail, the username wins — always the same account,
    whatever order the rows happen to come back in."""
    key = normalize_login(login)
    if not key:
        return None
    result = await db.execute(
        select(User)
        .where(or_(User.username == key, User.email == key))
        .order_by((User.username == key).desc())
        .limit(1)
    )
    return result.scalars().first()


def directory_login_alternative(key: str) -> str | None:
    """The bare account name inside a directory-style login: `DOMAIN\\name` → `name`, a UPN
    `name@suffix` → `name`; None when `key` has neither form (plan decision D2)."""
    if "\\" in key:
        name = key.rsplit("\\", 1)[1]
    elif "@" in key:
        name = key.split("@", 1)[0]
    else:
        return None
    return name or None


async def find_user_for_sign_in(db: AsyncSession, login: str) -> tuple[User | None, str]:
    """The account a typed login names, and the normalised login. First as `find_user_by_login`
    (username or e-mail, every account); then, for a DIRECTORY account only, the bare name of a
    `DOMAIN\\name` or UPN-shaped login as its username — a local account is never reached that
    way. Which forms the directory account accepts is decided after the bind
    (`auth.ldap.login_matches`)."""
    key = normalize_login(login)
    user = await find_user_by_login(db, key)
    if user is not None or not key:
        return user, key
    name = directory_login_alternative(key)
    if name is None:
        return None, key
    result = await db.execute(
        select(User).where(User.username == name, User.auth_source == AUTH_LDAP).limit(1))
    return result.scalars().first(), key


def verify_local_password(auth_source: str | None, hashed: str | None, password: str) -> bool:
    """True only for a LOCAL account whose bcrypt hash matches. No account (`auth_source` None),
    an AD account, or no stored hash: a dummy comparison, then False.

    Takes the account's `auth_source` and `hashed_password` as plain values, read by the caller
    on the event loop: this runs on a worker thread (via `run_bcrypt`, ~0.2 s of CPU) and must
    not touch an ORM object there."""
    if auth_source != AUTH_LOCAL or not hashed:
        verify_password(password, _DUMMY_HASH)
        return False
    return verify_password(password, hashed)


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


@dataclass(frozen=True)
class AuthContext:
    """What a token is minted from: the resolved tenant and the user's groups in it."""
    tenant_id: uuid.UUID | None
    tenant: str | None
    groups: tuple[str, ...]
    group_names: tuple[str, ...]
    perms: frozenset[str]
    mfa_required: bool


EMPTY_CONTEXT = AuthContext(None, None, (), (), frozenset(), False)


async def build_context(db: AsyncSession, user: User) -> AuthContext:
    """What the user's tokens are minted from. MFA is required by the user's groups, and ALWAYS
    for a platform operator (`is_platform_support`), a vendor account in no tenant included: it
    is asked for TOTP at sign-in."""
    operator = bool(user.is_platform_support)
    ref = await tenant_of_user(db, user.id)
    if ref is None:
        return EMPTY_CONTEXT if not operator else replace(EMPTY_CONTEXT, mfa_required=True)
    summary = summarize(await groups_of(db, user.id, ref.id))
    return AuthContext(tenant_id=ref.id, tenant=ref.slug, groups=summary.slugs,
                       group_names=summary.names, perms=summary.perms,
                       mfa_required=summary.mfa_required or operator)


def credential_fingerprint(user: User) -> str:
    """A short keyed digest of the credentials a session was opened with (password hash + TOTP
    secret). The refresh token carries it; `/auth/refresh` refuses a token whose fingerprint no
    longer matches, so a password change or reset and an MFA reset end every session — not just
    the one-hour access token. HMAC-keyed with the signing secret: the token is readable by the
    client and the TOTP secret is part of the input."""
    material = f"{user.hashed_password or ''}|{user.totp_secret or ''}".encode()
    return hmac.new(JWT_SECRET.encode(), material, hashlib.sha256).hexdigest()[:16]


def issue_tokens(user: User, ctx: AuthContext, *, mfa_verified: bool) -> dict:
    """Access + refresh tokens. `requires_mfa` means "a TOTP step is still pending"."""
    access = create_access_token(
        subject=str(user.id),
        extra={
            "tenant": ctx.tenant,
            "groups": list(ctx.groups),
            "perms": sorted(ctx.perms),
            "mfa_required": ctx.mfa_required,
            "mfa_verified": mfa_verified,
            "tv": int(user.token_version),
        },
    )
    refresh = create_refresh_token(subject=str(user.id),
                                   extra={"mfa_verified": mfa_verified,
                                          "cv": credential_fingerprint(user)})
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "requires_mfa": bool(ctx.mfa_required and not mfa_verified),
        "mfa_enrolled": bool(user.totp_enabled),
    }


def mark_login(user: User) -> None:
    user.last_login_at = datetime.now(timezone.utc)


async def setup_totp(db: AsyncSession, user: User) -> tuple[str, str]:
    """Generate and store a new TOTP secret. Returns (secret, provisioning_uri).

    First enrolment: `totp_enabled` stays False until the first verified code. REPLACING an
    authenticator (only reachable from an MFA-verified session, see get_user_for_enrolment):
    `totp_enabled` stays True, so the account never drops back to "not enrolled" — which would
    reopen password-only enrolment. Abandoning the replacement locks the old device out; the
    fix is an administrator's MFA reset (fails closed)."""
    secret = generate_totp_secret()
    user.totp_secret = secret
    await db.commit()
    uri = generate_provisioning_uri(secret, user.email or user.username)
    return secret, uri


async def enable_totp(db: AsyncSession, user: User) -> None:
    """Mark the authenticator as verified. The caller has already checked the code — once, with
    the attempt limit and the replay check (see /auth/totp/verify)."""
    user.totp_enabled = True
    await db.commit()


class PasswordError(ValueError):
    """A password change that cannot be made. The message is shown to the user; `reason` is a
    short code for the audit trail."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


async def change_password(db: AsyncSession, user: User, current: str, new: str) -> None:
    """The new password's length is checked BEFORE the current password: the other order would
    let a stolen session test guesses at the current password by sending a too-short new one —
    "too short" would mean "right guess", and nothing would change or look unusual."""
    if user.auth_source != AUTH_LOCAL:
        raise PasswordError("Parola Active Directory tarafından yönetiliyor", "directory_account")
    if len(new) < 8:
        raise PasswordError("Yeni parola en az 8 karakter olmalı", "too_short")
    if not await run_bcrypt(verify_local_password, user.auth_source, user.hashed_password,
                            current):
        raise PasswordError("Mevcut parola yanlış", "wrong_current")
    user.hashed_password = await run_bcrypt(hash_password, new)
    await bump_user(db, user)
    await db.commit()
