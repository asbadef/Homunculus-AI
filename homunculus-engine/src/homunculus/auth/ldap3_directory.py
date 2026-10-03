"""`LdapDirectory` against a real Active Directory, with `ldap3` (pure Python: it runs on the
Windows dev machines and in the python:3.12-slim image without libldap). Spec §7.

  * LDAPS, verified: CERT_REQUIRED against LDAP_CA_CERT (or the system store), host name
    checked by `ldap3`. `ldap://` or an unverified certificate needs LDAP_ALLOW_INSECURE=1, and
    `ldap_from_env` says so loudly at start-up.
  * Every typed value reaches a filter through `ldap3.utils.conv.escape_filter_chars`, the
    objectGUID through `escape_guid` (each byte `\\xx`): a query cannot change a filter's shape.
  * `ldap3` is synchronous: each call runs on the directory's OWN pool of `SLOTS` threads —
    never asyncio's default executor, where asyncpg resolves the database host — and is cut off
    after `LdapConfig.deadline_s` (2 × LDAP_TIMEOUT_S, at most 12 s — under the dashboard's 15 s
    request timeout), waiting for a free thread included. A call cut off while it runs keeps
    its thread until the socket timeouts end it, so the pool, not a semaphore, is the cap. The socket connect timeout is
    LDAP_TIMEOUT_S, the receive timeout LDAP_TIMEOUT_S rounded up to whole seconds.
  * Results are capped: `size_limit` on the server, and the slice here.
  * A network or TLS failure becomes LdapUnavailable(reason); a wrong password is None.
  * The clinician's password goes to one bind. It is not kept, logged or put into an
    exception; an empty one never reaches the server (an empty simple bind is anonymous).
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import ssl
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import Any

from ldap3 import AUTO_BIND_NONE, SIMPLE, SUBTREE, Connection, Server, Tls
from ldap3 import NONE as NO_SERVER_INFO
from ldap3.core.exceptions import (
    LDAPCertificateError, LDAPCommunicationError, LDAPException, LDAPResponseTimeoutError,
    LDAPSocketOpenError, LDAPSSLConfigurationError, LDAPStartTLSError,
)
from ldap3.core.results import (
    RESULT_INVALID_CREDENTIALS, RESULT_SIZE_LIMIT_EXCEEDED, RESULT_SUCCESS,
)
from ldap3.utils.conv import escape_filter_chars

from homunculus.auth.ldap import (
    LdapConfig, LdapConfigError, LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable,
    guid_from_bytes, guid_to_bytes, is_disabled, load_ldap_config,
)

logger = logging.getLogger(__name__)

Connect = Callable[[str, str], Any]

USER_ATTRIBUTES = ("objectGUID", "sAMAccountName", "userPrincipalName", "mail", "displayName",
                   "memberOf", "userAccountControl", "pwdLastSet")
# A search lists accounts to pick from; their group lists are not shown, so not read.
SEARCH_ATTRIBUTES = tuple(a for a in USER_ATTRIBUTES if a != "memberOf")
GROUP_ATTRIBUTES = ("cn",)
IN_CHAIN = "1.2.840.113556.1.4.1941"   # LDAP_MATCHING_RULE_IN_CHAIN: nested membership
GROUP_LIMIT = 1000     # nested groups of one account; more is an error, never a truncation
RESULT_CAP = 50
SLOTS = 8              # threads doing directory I/O at once, calls cut off included


# ---------------------------------------------------------------- filters (pure)
def escape_guid(external_id: str) -> str:
    """objectGUID as a filter value: its 16 bytes, each written `\\xx` (RFC 4515), so a byte
    that happens to be `(`, `)`, `*` or NUL cannot end the value. ValueError if not a UUID."""
    return "".join(f"\\{byte:02x}" for byte in guid_to_bytes(external_id))


def guid_lookup_filter(user_filter: str, external_id: str) -> str:
    """Decision D5: LDAP_USER_FILTER applies here too — what it excludes cannot sign in."""
    return f"(&{user_filter}(objectGUID={escape_guid(external_id)}))"


def user_search_filter(user_filter: str, query: str) -> str:
    q = escape_filter_chars(query.strip())
    return (f"(&{user_filter}(|(sAMAccountName=*{q}*)(displayName=*{q}*)"
            f"(userPrincipalName=*{q}*)(mail=*{q}*)))")


def group_search_filter(query: str) -> str:
    return f"(&(objectClass=group)(cn=*{escape_filter_chars(query.strip())}*))"


def nested_groups_filter(user_dn: str) -> str:
    return f"(&(objectClass=group)(member:{IN_CHAIN}:={escape_filter_chars(user_dn)}))"


# ---------------------------------------------------------------- entries (pure)
def _decode(value: Any) -> str:
    return value.decode("utf-8", "replace") if isinstance(value, (bytes, bytearray)) else str(value)


def _attributes(entry: Mapping[str, Any]) -> dict[str, list[Any]]:
    """The entry's raw attributes, names lower-cased (AD returns its own capitalisation)."""
    raw = entry.get("raw_attributes") or {}
    return {str(name).lower(): list(values or []) for name, values in raw.items()}


def _first_text(values: list[Any]) -> str | None:
    return (_decode(values[0]).strip() or None) if values else None


def _first_int(values: list[Any]) -> int | None:
    text = _first_text(values)
    try:
        return int(text) if text is not None else None
    except ValueError:
        return None


def parse_user_entry(entry: Mapping[str, Any]) -> LdapIdentity | None:
    """An `ldap3` search result entry as an LdapIdentity, read from its RAW attributes:
    objectGUID is binary, and raw values do not depend on the schema being loaded. None without
    a 16-byte objectGUID, a sAMAccountName or a DN."""
    attrs = _attributes(entry)
    guid = (attrs.get("objectguid") or [b""])[0]
    username = _first_text(attrs.get("samaccountname", []))
    dn = str(entry.get("dn") or "")
    if not isinstance(guid, (bytes, bytearray)) or len(guid) != 16 or not username or not dn:
        return None
    return LdapIdentity(
        external_id=guid_from_bytes(bytes(guid)), username=username, dn=dn,
        upn=_first_text(attrs.get("userprincipalname", [])),
        email=_first_text(attrs.get("mail", [])),
        display_name=_first_text(attrs.get("displayname", [])),
        group_dns=tuple(_decode(v) for v in attrs.get("memberof", [])),
        disabled=is_disabled(_first_int(attrs.get("useraccountcontrol", []))),
        pwd_last_set=_first_int(attrs.get("pwdlastset", [])),
    )


def parse_group_entry(entry: Mapping[str, Any]) -> LdapGroup | None:
    dn = str(entry.get("dn") or "")
    if not dn:
        return None
    return LdapGroup(dn=dn, name=_first_text(_attributes(entry).get("cn", [])) or dn)


# ---------------------------------------------------------------- failures and TLS (pure)
_TLS_FAILURES = (ssl.SSLError, LDAPSSLConfigurationError, LDAPStartTLSError, LDAPCertificateError)
_TIMEOUTS = (TimeoutError, LDAPResponseTimeoutError)


def failure_reason(exc: BaseException) -> str:
    """The LdapUnavailable reason for an `ldap3` or socket failure. `ldap3` reports a failed
    connection to a host with several addresses as one LDAPSocketOpenError whose second argument
    lists each address's own exception; those are read too."""
    causes: list[BaseException] = [exc]
    if (isinstance(exc, LDAPSocketOpenError) and len(exc.args) > 1
            and isinstance(exc.args[1], list)):
        causes += [item[0] for item in exc.args[1]
                   if isinstance(item, tuple) and item and isinstance(item[0], BaseException)]
    if any(isinstance(c, _TLS_FAILURES) for c in causes):
        return "tls"
    if any(isinstance(c, _TIMEOUTS) for c in causes):
        return "timeout"
    if any(isinstance(c, (LDAPCommunicationError, OSError)) for c in causes):
        return "unreachable"
    return "protocol"


def tls_for(config: LdapConfig) -> Tls | None:
    """None for ldap://. For ldaps:// the certificate is verified (and its name checked by
    `ldap3`) against LDAP_CA_CERT, or the system store when that is unset — unless
    LDAP_ALLOW_INSECURE=1 AND no CA was given, the one case that skips verification."""
    if not config.use_ssl:
        return None
    verify = not (config.allow_insecure and config.ca_cert is None)
    return Tls(validate=ssl.CERT_REQUIRED if verify else ssl.CERT_NONE,
               ca_certs_file=config.ca_cert)


# ---------------------------------------------------------------- the directory
def _close(conn: Any) -> None:
    try:
        conn.unbind()
    except Exception:      # closing is best effort; the call's own outcome is what counts
        pass


def _is_guid(value: str) -> bool:
    try:
        guid_to_bytes(value)
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _guarded(fn: Callable[..., Any], *args: Any) -> Any:
    """Run `fn` on the worker thread; ANY failure becomes LdapUnavailable — an `ldap3` or socket
    failure by its cause, anything else (a library bug, a reply it cannot parse) as `protocol`,
    so a directory fault is a 503, never a 500. Only the exception's type and the reason are
    logged — never its text, which for a bind could name the account or carry a password."""
    try:
        return fn(*args)
    except LdapUnavailable:
        raise
    except (LDAPException, OSError) as exc:
        reason = failure_reason(exc)
        logger.warning("directory call failed (%s): %s", reason, type(exc).__name__)
        raise LdapUnavailable(reason) from None
    except Exception as exc:
        logger.warning("directory call failed (protocol): unexpected %s", type(exc).__name__)
        raise LdapUnavailable("protocol") from None


class Ldap3Directory:
    """The protocol over `ldap3`. `connect(user_dn, password)` returns an unbound connection —
    injected by tests; the default opens one per the configuration."""

    def __init__(self, config: LdapConfig, *, connect: Connect | None = None,
                 deadline_s: float | None = None) -> None:
        self._config = config
        self._connect: Connect = connect or self._open
        self._deadline = config.deadline_s if deadline_s is None else deadline_s
        self._pool = ThreadPoolExecutor(max_workers=SLOTS, thread_name_prefix="ldap")

    def close(self) -> None:
        """App shutdown: calls still queued are cancelled (each caller gets LdapUnavailable);
        running ones end on their own, bounded by the socket timeouts. Later calls are
        LdapUnavailable("unreachable")."""
        self._pool.shutdown(wait=False, cancel_futures=True)

    # ---- the protocol (event loop side)
    async def authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        if not password or not _is_guid(external_id):
            return None
        return await self._call(self._authenticate, external_id, password)

    async def find_by_external_id(self, external_id: str) -> LdapIdentity | None:
        if not _is_guid(external_id):
            return None
        return await self._call(self._find, external_id)

    async def search_users(self, query: str, limit: int = RESULT_CAP) -> list[LdapIdentity]:
        if not query.strip():
            return []
        return await self._call(self._search_users, query, max(1, min(limit, RESULT_CAP)))

    async def search_groups(self, query: str, limit: int = RESULT_CAP) -> list[LdapGroup]:
        if not query.strip():
            return []
        return await self._call(self._search_groups, query, max(1, min(limit, RESULT_CAP)))

    async def test_connection(self) -> None:
        await self._call(self._test)

    async def check_password(self, dn: str, password: str) -> bool:
        """One bind as `dn`: True if the password is right. Not part of the protocol — sign-in
        goes through `authenticate`; the read-only integration test uses this."""
        if not password:
            return False
        return await self._call(self._password_ok, dn, password)

    async def _call(self, fn: Callable[..., Any], *args: Any) -> Any:
        """`fn` on the pool, within the deadline — the wait for a free thread counts against
        it, and a call cut off while still queued never runs."""
        try:
            work = asyncio.get_running_loop().run_in_executor(self._pool, _guarded, fn, *args)
        except RuntimeError:                 # the pool is shut down: the app is stopping
            raise LdapUnavailable("unreachable") from None
        try:
            return await asyncio.wait_for(work, self._deadline)
        except TimeoutError:
            logger.warning("directory call cut off after %.1f s", self._deadline)
            raise LdapUnavailable("timeout") from None
        except asyncio.CancelledError:
            # Cancelled by `close` while queued, not by our own caller: an outage, not a crash.
            task = asyncio.current_task()
            if work.cancelled() and task is not None and not task.cancelling():
                raise LdapUnavailable("unreachable") from None
            raise

    # ---- the worker-thread side
    def _open(self, user: str, password: str) -> Any:
        server = Server(self._config.host, port=self._config.port,
                        use_ssl=self._config.use_ssl, tls=tls_for(self._config),
                        get_info=NO_SERVER_INFO, connect_timeout=self._config.timeout_s)
        # The receive timeout must be an int: off Windows, ldap3 2.9.1 packs it with
        # struct.pack('LL', ...), which refuses a float. Rounded up, it stays under the deadline
        # (ceil(t) <= 2t for t >= 1).
        return Connection(server, user=user, password=password, authentication=SIMPLE,
                          auto_bind=AUTO_BIND_NONE, read_only=True, raise_exceptions=False,
                          receive_timeout=math.ceil(self._config.timeout_s),
                          auto_referrals=False, check_names=False)

    def _service(self) -> Any:
        conn = self._connect(self._config.bind_dn, self._config.bind_password)
        try:
            bound = conn.bind()
        except BaseException:
            _close(conn)
            raise
        if bound:
            return conn
        code = (conn.result or {}).get("result")
        _close(conn)
        raise LdapUnavailable("service_bind_rejected" if code == RESULT_INVALID_CREDENTIALS
                              else "protocol")

    def _search(self, conn: Any, search_filter: str, attributes: tuple[str, ...],
                size_limit: int, *, truncated_ok: bool = True) -> list[dict]:
        conn.search(search_base=self._config.base_dn, search_filter=search_filter,
                    search_scope=SUBTREE, attributes=list(attributes), size_limit=size_limit,
                    time_limit=max(1, math.ceil(self._config.timeout_s)))
        code = (conn.result or {}).get("result")
        if code != RESULT_SUCCESS and not (truncated_ok and code == RESULT_SIZE_LIMIT_EXCEEDED):
            raise LdapUnavailable("protocol")
        entries = [e for e in (conn.response or []) if e.get("type") == "searchResEntry"]
        return entries[:size_limit]

    def _find(self, external_id: str) -> LdapIdentity | None:
        conn = self._service()
        try:
            entries = self._search(
                conn, guid_lookup_filter(self._config.user_filter, external_id),
                USER_ATTRIBUTES, 2)
            identity = parse_user_entry(entries[0]) if len(entries) == 1 else None
            if identity is not None and self._config.nested_groups:
                groups = self._search(conn, nested_groups_filter(identity.dn), GROUP_ATTRIBUTES,
                                      GROUP_LIMIT, truncated_ok=False)
                identity = replace(identity, group_dns=tuple(
                    str(e["dn"]) for e in groups if e.get("dn")))
            return identity
        finally:
            _close(conn)

    def _password_ok(self, dn: str, password: str) -> bool:
        conn = self._connect(dn, password)
        try:
            if conn.bind():
                return True
            if (conn.result or {}).get("result") == RESULT_INVALID_CREDENTIALS:
                return False
            raise LdapUnavailable("protocol")
        finally:
            _close(conn)

    def _authenticate(self, external_id: str, password: str) -> LdapIdentity | None:
        identity = self._find(external_id)
        if identity is None or identity.disabled:
            return identity
        return identity if self._password_ok(identity.dn, password) else None

    def _search_users(self, query: str, limit: int) -> list[LdapIdentity]:
        conn = self._service()
        try:
            entries = self._search(conn, user_search_filter(self._config.user_filter, query),
                                   SEARCH_ATTRIBUTES, limit)
        finally:
            _close(conn)
        return [i for i in map(parse_user_entry, entries) if i is not None]

    def _search_groups(self, query: str, limit: int) -> list[LdapGroup]:
        conn = self._service()
        try:
            entries = self._search(conn, group_search_filter(query), GROUP_ATTRIBUTES, limit)
        finally:
            _close(conn)
        return [g for g in map(parse_group_entry, entries) if g is not None]

    def _test(self) -> None:
        _close(self._service())


def ldap_from_env(env: Mapping[str, str] | None = None) -> LdapRuntime | None:
    """`app.state.ldap` for production (`api/prodserver.py`): None when LDAP_URL is unset, or —
    logged as an ERROR — when the LDAP_* settings cannot be used. Never raises: an unusable
    directory configuration must not stop the API (spec §9)."""
    env = os.environ if env is None else env
    try:
        config = load_ldap_config(env)
    except LdapConfigError as exc:
        logger.error("LDAP is OFF: %s. Local accounts sign in as usual; directory accounts get "
                     "503 until this is fixed.", exc)
        return None
    if config is None:
        return None
    if config.allow_insecure:
        logger.warning(
            "LDAP_ALLOW_INSECURE=1: %s. Never in a hospital: AD passwords cross this link.",
            "plain ldap://, no encryption" if not config.use_ssl
            else "the domain controller's certificate is NOT verified" if config.ca_cert is None
            else "set, but LDAP_CA_CERT is given, so the certificate is still verified")
    return LdapRuntime(directory=Ldap3Directory(config), url_host=config.host,
                       login_attrs=config.login_attrs)
