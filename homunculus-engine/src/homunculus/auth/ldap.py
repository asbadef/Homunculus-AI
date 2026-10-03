"""The directory (LDAP / Active Directory) as Homunculus sees it — spec §7.

  LdapDirectory    the protocol: authenticate, find_by_external_id, search_users, search_groups,
                   test_connection. `auth/ldap3_directory.py` implements it against a real
                   server, `tests/fake_directory.py` from memory.
  LdapIdentity     one AD account as the directory reports it; LdapGroup one AD group.
  LdapUnavailable  the directory did not answer. Sign-in turns it into 503, never 401.
  LdapConfig       the LDAP_* environment, read and checked by `load_ldap_config`.
  LdapRuntime      what the app holds as `app.state.ldap` (None = LDAP off): the directory, its
                   host, the login forms it accepts, the outcome of the last connection test.

The pure rules of a directory sign-in live here too: objectGUID's string form, the
ACCOUNTDISABLE bit, pwdLastSet against a token's issue time, and which typed login forms an
account answers to. Nothing here talks to the network or imports `ldap3`.

The AD password a clinician types goes to one bind and is dropped: never stored, logged,
audited or cached (spec §7, Security). The service account's password comes from the
environment only and is kept out of every repr.
"""
from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol
from urllib.parse import urlsplit

from fastapi import Request

from homunculus.auth.service import normalize_login

logger = logging.getLogger(__name__)

DIRECTORY_DOWN = "Dizin sunucusuna ulaşılamıyor"
NOT_CONFIGURED = "Dizin yapılandırılmamış"

ACCOUNTDISABLE = 0x2                    # userAccountControl bit
DEFAULT_USER_FILTER = ("(&(objectCategory=person)(objectClass=user)"
                       "(!(userAccountControl:1.2.840.113556.1.4.803:=2)))")
# The attributes a typed login may be matched against, lower-cased (LDAP_LOGIN_ATTRS).
LOGIN_ATTRS: tuple[str, ...] = ("samaccountname", "userprincipalname", "mail")
DEFAULT_TIMEOUT_S = 5.0
TIMEOUT_MIN_S, TIMEOUT_MAX_S = 1.0, 10.0
# One directory call never takes longer than this: under the dashboard's 15 s request timeout,
# with room for the database work around it.
DEADLINE_CAP_S = 12.0
FILETIME_TICKS_PER_S = 10_000_000
FILETIME_UNIX_OFFSET_S = 11_644_473_600   # 1601-01-01 to 1970-01-01, in seconds
_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})


class LdapUnavailable(Exception):
    """The directory could not answer: unreachable, TLS refused, too slow, the service account
    refused, or a reply that makes no sense. `reason` is a fixed short code — `unreachable`,
    `timeout`, `tls`, `service_bind_rejected`, `protocol` — and never carries a credential."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class LdapConfigError(ValueError):
    """The LDAP_* environment cannot be used. The message names the variable, never its value."""


@dataclass(frozen=True)
class LdapIdentity:
    """One AD account. `external_id` is objectGUID in its string form (`guid_from_bytes`);
    `username` is sAMAccountName as AD spells it; `group_dns` are the DNs of its groups (nested
    ones included when LDAP_NESTED_GROUPS=1); `pwd_last_set` is pwdLastSet, a FILETIME — 0 when
    the account must change its password at the next logon, None when it was not read."""
    external_id: str
    username: str
    dn: str
    upn: str | None = None
    email: str | None = None
    display_name: str | None = None
    group_dns: tuple[str, ...] = ()
    disabled: bool = False
    pwd_last_set: int | None = None


@dataclass(frozen=True)
class LdapGroup:
    dn: str
    name: str


class LdapDirectory(Protocol):
    """What Homunculus asks of a directory. Every method raises LdapUnavailable when the
    directory does not answer; "no such account" and "wrong password" are answers (None)."""

    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        """The account with this objectGUID, checked with ONE bind as its DN. None: not found
        (as LDAP_USER_FILTER sees it), or an empty or wrong password. A DISABLED account is
        returned as found, without a bind, so the caller can say why it refuses — when the
        filter lets it through: the DEFAULT filter excludes disabled accounts, so under it a
        disabled account is simply not found (sign-in `bad_credentials`, refresh
        `directory_not_found`; `directory_disabled` needs a custom LDAP_USER_FILTER)."""

    async def find_by_external_id(self, external_id: str) -> LdapIdentity | None:
        """The account with this objectGUID, read with the service account; None if not found."""

    async def search_users(self, query: str, limit: int = 50) -> list[LdapIdentity]:
        """Accounts whose name, display name, UPN or mail contains `query`; at most `limit`."""

    async def search_groups(self, query: str, limit: int = 50) -> list[LdapGroup]:
        """Groups whose cn contains `query`; at most `limit`."""

    async def test_connection(self) -> None:
        """Bind with the service account; raise LdapUnavailable if that fails."""


# ---------------------------------------------------------------- objectGUID
def guid_from_bytes(raw: bytes) -> str:
    """AD's 16-byte objectGUID as the string Homunculus stores in `users.external_id`: the
    lower-case hyphenated form AD's own tools print (the first three fields little-endian)."""
    if len(raw) != 16:
        raise ValueError("objectGUID must be 16 bytes")
    return str(uuid.UUID(bytes_le=bytes(raw)))


def guid_to_bytes(external_id: str) -> bytes:
    """The 16 bytes AD stores for this objectGUID string. ValueError if it is not a UUID."""
    return uuid.UUID(str(external_id)).bytes_le


def canonical_guid(value: str) -> str:
    """Any UUID spelling (braces, capitals) in the stored form."""
    return str(uuid.UUID(str(value)))


# ---------------------------------------------------------------- account state
def is_disabled(user_account_control: int | None) -> bool:
    return bool((user_account_control or 0) & ACCOUNTDISABLE)


def filetime_to_unix(filetime: int) -> float:
    """A FILETIME (100 ns ticks since 1601-01-01 UTC) in Unix seconds."""
    return filetime / FILETIME_TICKS_PER_S - FILETIME_UNIX_OFFSET_S


def password_changed_since(pwd_last_set: int | None, issued_at: int) -> bool:
    """Spec §7, refresh: was the AD password set after a token issued at `issued_at` (Unix
    seconds)? Compared in whole seconds, as `iat` is. 0 means "must change at next logon" —
    what an AD password reset usually sets — and counts as changed. None (not read): no."""
    if pwd_last_set is None:
        return False
    if pwd_last_set <= 0:
        return True
    return pwd_last_set // FILETIME_TICKS_PER_S - FILETIME_UNIX_OFFSET_S > issued_at


def login_matches(key: str, identity: LdapIdentity, attrs: Iterable[str]) -> bool:
    """Whether the typed login `key` (already `normalize_login`-ed) names this account in one of
    the forms `attrs` (LDAP_LOGIN_ATTRS) allows: `samaccountname` — typed bare or as
    `DOMAIN\\name`, the domain part unchecked (one domain per deployment) —
    `userprincipalname`, `mail`."""
    allowed = set(attrs)
    bare = key.rsplit("\\", 1)[-1]
    forms = (("samaccountname", identity.username, bare),
             ("userprincipalname", identity.upn, key),
             ("mail", identity.email, key))
    return any(attr in allowed and value and normalize_login(value) == typed
               for attr, value, typed in forms)


# ---------------------------------------------------------------- configuration
@dataclass(frozen=True)
class LdapConfig:
    """The LDAP_* settings (spec §7, Configuration), checked. Build it with `load_ldap_config`."""
    host: str
    port: int
    use_ssl: bool
    ca_cert: str | None
    allow_insecure: bool
    bind_dn: str
    bind_password: str = field(repr=False)
    base_dn: str
    user_filter: str
    login_attrs: tuple[str, ...]
    nested_groups: bool
    timeout_s: float

    @property
    def deadline_s(self) -> float:
        """The longest one directory call may take, all its LDAP operations together."""
        return min(2 * self.timeout_s, DEADLINE_CAP_S)


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = (env.get(name) or "").strip().lower()
    if not raw:
        return default
    if raw in _TRUE:
        return True
    if raw in _FALSE:
        return False
    raise LdapConfigError(f"{name} must be 1 or 0")


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name) or ""
    if not value.strip():
        raise LdapConfigError(f"{name} is required when LDAP_URL is set")
    return value


def parse_login_attrs(raw: str | None) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return LOGIN_ATTRS
    attrs = tuple(dict.fromkeys(a.strip().lower() for a in raw.split(",") if a.strip()))
    if not attrs or any(a not in LOGIN_ATTRS for a in attrs):
        raise LdapConfigError(
            "LDAP_LOGIN_ATTRS may name only sAMAccountName, userPrincipalName and mail")
    return attrs


def load_ldap_config(env: Mapping[str, str]) -> LdapConfig | None:
    """The directory settings, or None when LDAP_URL is unset (LDAP off). Raises
    LdapConfigError for a setting that cannot be used; the caller logs it and keeps LDAP off —
    the API still starts (spec §9)."""
    url = (env.get("LDAP_URL") or "").strip()
    if not url:
        return None
    allow_insecure = _flag(env, "LDAP_ALLOW_INSECURE", False)
    try:
        # urlsplit's own ValueError can quote the netloc — a password in it included.
        parts = urlsplit(url)
    except ValueError:
        raise LdapConfigError("LDAP_URL must be ldaps://host[:port] and nothing else") from None
    scheme = parts.scheme.lower()
    if scheme not in ("ldaps", "ldap"):
        raise LdapConfigError("LDAP_URL must start with ldaps://")
    if scheme == "ldap" and not allow_insecure:
        raise LdapConfigError(
            "LDAP_URL is ldap:// (plain text: AD passwords would cross the network readable); "
            "use ldaps://, or set LDAP_ALLOW_INSECURE=1 in a lab")
    try:
        port = parts.port
    except ValueError:
        raise LdapConfigError("LDAP_URL has an invalid port") from None
    if (not parts.hostname or parts.username is not None or parts.password is not None
            or parts.path not in ("", "/") or parts.query or parts.fragment):
        raise LdapConfigError("LDAP_URL must be ldaps://host[:port] and nothing else")
    ca_cert = (env.get("LDAP_CA_CERT") or "").strip() or None
    if ca_cert is not None and not os.path.isfile(ca_cert):
        raise LdapConfigError("LDAP_CA_CERT does not name a file")
    user_filter = (env.get("LDAP_USER_FILTER") or "").strip() or DEFAULT_USER_FILTER
    if not (user_filter.startswith("(") and user_filter.endswith(")")):
        raise LdapConfigError("LDAP_USER_FILTER must be one parenthesised LDAP filter")
    raw_timeout = (env.get("LDAP_TIMEOUT_S") or "").strip()
    try:
        timeout_s = float(raw_timeout) if raw_timeout else DEFAULT_TIMEOUT_S
    except ValueError:
        raise LdapConfigError("LDAP_TIMEOUT_S must be a number of seconds") from None
    if not TIMEOUT_MIN_S <= timeout_s <= TIMEOUT_MAX_S:
        raise LdapConfigError("LDAP_TIMEOUT_S must be between 1 and 10 seconds")
    return LdapConfig(
        host=parts.hostname, port=port or (636 if scheme == "ldaps" else 389),
        use_ssl=scheme == "ldaps", ca_cert=ca_cert, allow_insecure=allow_insecure,
        bind_dn=_required(env, "LDAP_BIND_DN").strip(),
        bind_password=_required(env, "LDAP_BIND_PASSWORD"),
        base_dn=_required(env, "LDAP_BASE_DN").strip(), user_filter=user_filter,
        login_attrs=parse_login_attrs(env.get("LDAP_LOGIN_ATTRS")),
        nested_groups=_flag(env, "LDAP_NESTED_GROUPS", True), timeout_s=timeout_s,
    )


# ---------------------------------------------------------------- the app's handle
@dataclass
class LdapRuntime:
    """The directory as the running app holds it (`app.state.ldap`; None when LDAP is off).
    The last connection test is kept here, in memory, for `GET /admin/ldap/status`."""
    directory: LdapDirectory
    url_host: str
    login_attrs: tuple[str, ...] = LOGIN_ATTRS
    last_test_at: datetime | None = None
    last_test_ok: bool | None = None
    last_test_reason: str | None = None

    async def test(self) -> tuple[bool, str | None]:
        """Bind with the service account now; remember and return (ok, reason)."""
        try:
            await self.directory.test_connection()
        except LdapUnavailable as exc:
            ok, reason = False, exc.reason
        else:
            ok, reason = True, None
        self.last_test_at = datetime.now(timezone.utc)
        self.last_test_ok, self.last_test_reason = ok, reason
        return ok, reason

    def close(self) -> None:
        """App shutdown: stop the directory's worker threads, if it has any (`close`)."""
        close = getattr(self.directory, "close", None)
        if callable(close):
            close()


def get_ldap(request: Request) -> LdapRuntime | None:
    """The app's directory, or None when LDAP is off. A FastAPI dependency and a plain call."""
    return getattr(request.app.state, "ldap", None)


async def check_directory_at_startup(runtime: LdapRuntime) -> None:
    """Spec §9: one service-account bind at start-up, logged. A failure is a WARNING, never a
    refusal to boot — local sign-in must keep working while the operator fixes the directory."""
    ok, reason = await runtime.test()
    if ok:
        logger.info("LDAP: service-account bind to %s succeeded", runtime.url_host)
    else:
        logger.warning(
            "LDAP: service-account bind to %s FAILED (%s). Directory accounts get 503 at "
            "sign-in until this is fixed; local accounts sign in as usual.",
            runtime.url_host, reason)
