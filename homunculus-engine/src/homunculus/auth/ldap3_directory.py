"""`LdapDirectory` against a real Active Directory, with `ldap3` (pure Python: it runs on the
Windows dev machines and in the python:3.12-slim image without libldap). Spec §7.

  * LDAPS, verified: CERT_REQUIRED against LDAP_CA_CERT (or the system store), host name
    checked by `ldap3`. `ldap://` or an unverified certificate needs LDAP_ALLOW_INSECURE=1, and
    `ldap_from_env` says so loudly at start-up.
  * Every typed value reaches a filter through `ldap3.utils.conv.escape_filter_chars`, the
    objectGUID through `escape_guid` (each byte `\\xx`): a query cannot change a filter's shape.
  * `ldap3` is synchronous: each call runs on the directory's OWN pool of `SLOTS` threads —
    never asyncio's default executor, where asyncpg resolves the database host — and is cut off
    after `LdapConfig.deadline_s` (2 × LDAP_TIMEOUT_S, at most 12 s), waiting for a free thread
    included. A call cut off while it runs keeps its thread until the socket timeouts end it,
    so the pool, not a semaphore, is the cap. The socket connect timeout is LDAP_TIMEOUT_S, the
    receive timeout LDAP_TIMEOUT_S rounded up to whole seconds.
  * An administration call passes the admin lane (`LdapRuntime.admin_lane`, ADMIN_LANE_SLOTS
    places) first: it waits for a place at most `deadline_s` (then LdapUnavailable("timeout"),
    nothing sent), and its own deadline starts once it has one. The place is given back when
    its thread has finished, a call cut off included — so administration never holds more than
    ADMIN_LANE_SLOTS of the SLOTS threads, and sign-ins and refreshes keep the rest.
  * The bounds, then: a sign-in or a refresh (no lane) answers within `deadline_s` — at most
    12 s, under the dashboard's 15 s request timeout. An administration call answers within
    2 × `deadline_s` (the lane wait, then the call) — at most 24 s, 20 s at the default
    LDAP_TIMEOUT_S of 5: past the dashboard's 15 s when the lane is full and the directory
    slow, in which case the panel gives up first and the server's 503 comes later.
  * A call the caller stopped waiting for (its deadline, a cancellation) never binds as the
    account afterwards, and its outage says whether that bind had started
    (`LdapUnavailable.bind_attempted`, `_Attempt`): the sign-in throttle counts only a password
    that reached the domain controller.
  * Results are capped: `size_limit` on the server, and the slice here.
  * A group DN has one spelling for comparing (`canonical_dn`): the stored mapping and AD's
    memberOf are compared in it, whatever spacing, escaping or case either was written in.
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
import string
import threading
import time
import unicodedata
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import Any

from ldap3 import AUTO_BIND_NONE, SIMPLE, SUBTREE, Connection, Server, Tls
from ldap3 import NONE as NO_SERVER_INFO
from ldap3.core.exceptions import (
    LDAPCertificateError, LDAPCommunicationError, LDAPException, LDAPInvalidDnError,
    LDAPResponseTimeoutError, LDAPSocketOpenError, LDAPSSLConfigurationError, LDAPStartTLSError,
)
from ldap3.core.results import (
    RESULT_INVALID_CREDENTIALS, RESULT_SIZE_LIMIT_EXCEEDED, RESULT_SUCCESS,
    RESULT_TIME_LIMIT_EXCEEDED,
)
from ldap3.operation.search import compile_filter, parse_filter
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.dn import parse_dn

from homunculus.auth.ldap import (
    LdapConfig, LdapConfigError, LdapGroup, LdapIdentity, LdapRuntime, LdapUnavailable,
    account_expired, guid_from_bytes, guid_to_bytes, is_disabled, load_ldap_config,
)

logger = logging.getLogger(__name__)

Connect = Callable[[str, str], Any]

USER_ATTRIBUTES = ("objectGUID", "sAMAccountName", "userPrincipalName", "mail", "displayName",
                   "memberOf", "userAccountControl", "pwdLastSet", "accountExpires")
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


# ---------------------------------------------------------------- DNs (pure)
# AD's special characters in a DN value. ldap3's parser refuses each of them bare (AD writes
# them escaped), so they are written escaped here too, wherever they stand.
_DN_SPECIAL = frozenset('\\,+"<>;=#')


def canonical_dn(dn: str) -> str:
    r"""The one spelling a distinguished name is stored and compared in (`ldap_group_mappings`
    against AD's memberOf): ldap3's parser splits and checks it (RFC 4514); spaces around `=`
    and the separators go; every escape is resolved — `\,`, `\2C` and `\2c` are one comma, hex
    pairs are UTF-8 — and written back the one way (`_escape_dn_value`); then lower-cased, as AD
    compares DNs. Idempotent. ValueError when it is not a DN, or carries a control character
    (NUL included, raw or escaped) or an escape that is not UTF-8: nothing to store or match."""
    if _has_control(dn):
        raise ValueError("control character in a DN")
    try:
        parts = parse_dn(_hex_escaped_spaces(dn.strip()), escape=False, strip=True)
    except LDAPInvalidDnError:
        raise ValueError("not a distinguished name") from None
    out = []
    for attribute_type, value, separator in parts:
        text = _unescape_dn_value(value)
        if _has_control(text):
            raise ValueError("control character in a DN")
        out.append(f"{attribute_type}={_escape_dn_value(text)}{separator}")
    return "".join(out).lower()


def _has_control(text: str) -> bool:
    return any(unicodedata.category(ch) == "Cc" for ch in text)


def _hex_escaped_spaces(dn: str) -> str:
    r"""Every escaped space `\ ` written `\20`: ldap3 strips a value's outer spaces BEFORE it
    reads the escapes, which would cut a trailing `\ ` in half. Escapes are read in pairs, so
    `\\` followed by a bare space stays as it is."""
    out: list[str] = []
    i = 0
    while i < len(dn):
        pair = dn[i:i + 2]
        if pair[0] == "\\" and len(pair) == 2:
            out.append("\\20" if pair == "\\ " else pair)
            i += 2
        else:
            out.append(dn[i])
            i += 1
    return "".join(out)


def _unescape_dn_value(value: str) -> str:
    r"""A value as ldap3's parser returns it (escapes still in, already checked) as plain text:
    `\xx` is one byte, `\c` is `c`; the bytes are UTF-8 (UnicodeDecodeError is a ValueError)."""
    raw = bytearray()
    i = 0
    while i < len(value):
        ch = value[i]
        if ch == "\\":
            pair = value[i + 1:i + 3]
            if len(pair) == 2 and all(c in string.hexdigits for c in pair):
                raw.append(int(pair, 16))
                i += 3
                continue
            if i + 1 >= len(value):
                raise ValueError("a DN value ends in a bare backslash")
            ch = value[i + 1]
            i += 1
        raw += ch.encode("utf-8")              # a lone surrogate: UnicodeEncodeError
        i += 1
    return raw.decode("utf-8")


def _escape_dn_value(text: str) -> str:
    r"""Plain text as a DN value: AD's special characters escaped, and a leading or trailing
    space escaped (`\ `) so the parser does not strip it. Whether a space leads or trails is
    read from the TEXT, not the escaped string: `a\` + space escapes to `a\\` + space, which
    already ends in `\ ` and would otherwise keep its space unescaped — a second pass would then
    strip it and name the sibling group `a\`. A one-space value is escaped once."""
    escaped = "".join(f"\\{ch}" if ch in _DN_SPECIAL else ch for ch in text)
    if text.startswith(" "):
        escaped = "\\" + escaped
    if text.endswith(" ") and len(text) > 1:
        escaped = escaped[:-1] + "\\ "
    return escaped


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
        account_expires=_first_int(attrs.get("accountexpires", [])),
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
    """Unbind, then close the raw socket too: after a TLS handshake that failed or timed out
    once TCP had connected, `ldap3` counts the connection as closed (unbind does nothing) while
    its socket is still open."""
    try:
        conn.unbind()
    except Exception:      # closing is best effort; the call's own outcome is what counts
        pass
    sock = getattr(conn, "socket", None)
    if sock is not None:
        try:
            sock.close()
        except Exception:
            pass


def _is_guid(value: str) -> bool:
    try:
        guid_to_bytes(value)
    except (ValueError, TypeError, AttributeError):
        return False
    return True


class _Attempt:
    """One directory call, shared by the event loop and the worker thread that runs it. The
    caller stops waiting (`give_up`: the deadline, a cancellation) and the worker is about to
    bind as the account with the typed password (`start_bind`) under one lock, so exactly one
    of two things happens: that bind starts and the caller learns it did, or it never starts —
    a call already cut off never spends one of the account's attempts in AD's lockout count."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._given_up = False
        self._bind_started = False

    def start_bind(self) -> None:
        """Worker side, immediately before the bind as the account. LdapUnavailable (read by
        nobody) when the caller has gone."""
        with self._lock:
            if self._given_up:
                raise LdapUnavailable("timeout")
            self._bind_started = True

    def give_up(self) -> bool:
        """Event-loop side, when the caller stops waiting: no bind as the account starts after
        this. True when one already had."""
        with self._lock:
            self._given_up = True
            return self._bind_started

    @property
    def bind_started(self) -> bool:
        with self._lock:
            return self._bind_started


def _give_back(loop: asyncio.AbstractEventLoop, lane: asyncio.Semaphore) -> None:
    """A lane place, given back on the event loop once a call's thread has finished (this runs
    on that thread, or on the loop for a call cancelled while queued)."""
    try:
        loop.call_soon_threadsafe(lane.release)
    except RuntimeError:                     # the loop is closed: the app has stopped
        pass


def _guarded(attempt: _Attempt, fn: Callable[..., Any], *args: Any) -> Any:
    """Run `fn` on the worker thread; ANY failure becomes LdapUnavailable — an `ldap3` or socket
    failure by its cause, anything else (a library bug, a reply it cannot parse) as `protocol`,
    so a directory fault is a 503, never a 500 — marked `bind_attempted` when it came after the
    bind as the account had started. Only the exception's type and the reason are logged —
    never its text, which for a bind could name the account or carry a password."""
    try:
        return fn(*args)
    except LdapUnavailable as exc:
        raise LdapUnavailable(exc.reason, bind_attempted=attempt.bind_started) from None
    except (LDAPException, OSError) as exc:
        reason = failure_reason(exc)
        logger.warning("directory call failed (%s): %s", reason, type(exc).__name__)
        raise LdapUnavailable(reason, bind_attempted=attempt.bind_started) from None
    except Exception as exc:
        logger.warning("directory call failed (protocol): unexpected %s", type(exc).__name__)
        raise LdapUnavailable("protocol", bind_attempted=attempt.bind_started) from None


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
        attempt = _Attempt()
        return await self._call(self._authenticate, attempt, external_id, password,
                                attempt=attempt)

    async def find_by_external_id(self, external_id: str, *,
                                  lane: asyncio.Semaphore | None = None) -> LdapIdentity | None:
        if not _is_guid(external_id):
            return None
        return await self._call(self._find, external_id, lane=lane)

    async def search_users(self, query: str, limit: int = RESULT_CAP, *,
                           lane: asyncio.Semaphore | None = None) -> list[LdapIdentity]:
        if not query.strip():
            return []
        return await self._call(self._search_users, query, max(1, min(limit, RESULT_CAP)),
                                lane=lane)

    async def search_groups(self, query: str, limit: int = RESULT_CAP, *,
                            lane: asyncio.Semaphore | None = None) -> list[LdapGroup]:
        if not query.strip():
            return []
        return await self._call(self._search_groups, query, max(1, min(limit, RESULT_CAP)),
                                lane=lane)

    async def test_connection(self, *, lane: asyncio.Semaphore | None = None) -> None:
        await self._call(self._test, lane=lane)

    async def check_password(self, dn: str, password: str) -> bool:
        """One bind as `dn`: True if the password is right. Not part of the protocol — sign-in
        goes through `authenticate`; the read-only integration test uses this."""
        if not password:
            return False
        attempt = _Attempt()
        return await self._call(self._password_ok, attempt, dn, password, attempt=attempt)

    async def _call(self, fn: Callable[..., Any], *args: Any,
                    attempt: _Attempt | None = None,
                    lane: asyncio.Semaphore | None = None) -> Any:
        """`fn` on the pool, within the deadline — the wait for a free thread counts against
        it, and a call cut off while still queued never runs. A `lane` place is taken first,
        waiting for it at most the deadline too (then LdapUnavailable("timeout"): nothing was
        sent), and only then does the call's own deadline start; the place is given back when
        the thread has finished (or the call never ran). So an administration call answers
        within 2 × the deadline, a sign-in or a refresh (no lane) within one. When the caller
        stops waiting (the deadline, a cancellation) `attempt` is given up: a bind as the
        account not started yet never starts, and the outage — or the cancellation, as an
        attribute — carries `bind_attempted`, for the sign-in throttle (auth/router.py)."""
        attempt = _Attempt() if attempt is None else attempt
        loop = asyncio.get_running_loop()
        if lane is not None:
            try:
                async with asyncio.timeout(self._deadline):
                    await lane.acquire()
            except TimeoutError:
                logger.warning("directory call found no admin-lane place within %.1f s",
                               self._deadline)
                raise LdapUnavailable("timeout") from None
        try:
            done = self._pool.submit(_guarded, attempt, fn, *args)
        except RuntimeError:                 # the pool is shut down: the app is stopping
            if lane is not None:
                lane.release()
            raise LdapUnavailable("unreachable") from None
        work = asyncio.wrap_future(done, loop=loop)
        if lane is not None:
            # After wrap_future's own callback: the outcome reaches the caller before the place
            # is given back (a failed import stops its other lookups before one more starts).
            done.add_done_callback(lambda _: _give_back(loop, lane))
        try:
            return await asyncio.wait_for(work, self._deadline)
        except TimeoutError:
            sent = attempt.give_up()
            logger.warning("directory call cut off after %.1f s", self._deadline)
            raise LdapUnavailable("timeout", bind_attempted=sent) from None
        except asyncio.CancelledError as exc:
            sent = attempt.give_up()
            # Cancelled by `close` while queued, not by our own caller: an outage, not a crash.
            task = asyncio.current_task()
            if work.cancelled() and task is not None and not task.cancelling():
                raise LdapUnavailable("unreachable") from None
            exc.bind_attempted = sent
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
        if code == RESULT_TIME_LIMIT_EXCEEDED:          # the server's own time_limit, above
            raise LdapUnavailable("timeout")
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

    def _password_ok(self, attempt: _Attempt, dn: str, password: str) -> bool:
        attempt.start_bind()             # not once the caller has gone; from here AD may count it
        conn = self._connect(dn, password)
        try:
            if conn.bind():
                return True
            if (conn.result or {}).get("result") == RESULT_INVALID_CREDENTIALS:
                return False
            raise LdapUnavailable("protocol")
        finally:
            _close(conn)

    def _authenticate(self, attempt: _Attempt, external_id: str,
                      password: str) -> LdapIdentity | None:
        identity = self._find(external_id)
        # Disabled or past its end date: returned without a bind — the caller refuses it, and
        # no password goes to a domain controller for an account that cannot sign in anyway.
        if (identity is None or identity.disabled
                or account_expired(identity.account_expires, time.time())):
            return identity
        return identity if self._password_ok(attempt, identity.dn, password) else None

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


def _wire_filter(search_filter: str) -> Any:
    """`search_filter` compiled as `Connection.search` compiles it with this module's
    connections (no schema, auto_escape and auto_encode on, names unchecked)."""
    root = parse_filter(search_filter, None, True, True, None, False)
    return compile_filter(root.elements[0])


_PROBE_GUID = "00000000-0000-0000-0000-000000000000"


def check_user_filter(user_filter: str) -> None:
    """LdapConfigError unless LDAP_USER_FILTER is ONE filter `ldap3` can compile, alone and
    inside every filter built from it. Checked at start-up: a filter that cannot be sent would
    otherwise turn every AD sign-in into a 503. Kept here, not in `auth/ldap.py`, which does
    not import `ldap3`."""
    try:
        for search_filter in (user_filter, guid_lookup_filter(user_filter, _PROBE_GUID),
                              user_search_filter(user_filter, "probe")):
            _wire_filter(search_filter)
    except Exception:          # ldap3 raises more than LDAPInvalidFilterError on a bad filter
        raise LdapConfigError("LDAP_USER_FILTER is not one valid LDAP filter") from None


def ldap_from_env(env: Mapping[str, str] | None = None) -> LdapRuntime | None:
    """`app.state.ldap` for production (`api/prodserver.py`): None when LDAP_URL is unset, or —
    logged as an ERROR — when the LDAP_* settings cannot be used. Never raises: an unusable
    directory configuration must not stop the API (spec §9). The log names the variable at
    fault, never its value, and carries no traceback (an exception's text can quote a setting,
    a password included)."""
    env = os.environ if env is None else env
    try:
        config = load_ldap_config(env)
        if config is None:
            return None
        check_user_filter(config.user_filter)
        runtime = LdapRuntime(directory=Ldap3Directory(config), url_host=config.host,
                              login_attrs=config.login_attrs)
    except LdapConfigError as exc:
        _ldap_off(str(exc))
        return None
    except Exception as exc:
        _ldap_off(f"the LDAP_* settings could not be used ({type(exc).__name__})")
        return None
    if config.allow_insecure:
        logger.warning(
            "LDAP_ALLOW_INSECURE=1: %s. Never in a hospital: AD passwords cross this link.",
            "plain ldap://, no encryption" if not config.use_ssl
            else "the domain controller's certificate is NOT verified" if config.ca_cert is None
            else "set, but LDAP_CA_CERT is given, so the certificate is still verified")
    return runtime


def _ldap_off(why: str) -> None:
    logger.error("LDAP is OFF: %s. Local accounts sign in as usual; directory accounts get "
                 "503 until this is fixed.", why)
