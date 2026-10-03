"""`LdapDirectory` against a real Active Directory, with `ldap3` (pure Python: it runs on the
Windows dev machines and in the python:3.12-slim image without libldap). Spec §7.

  * LDAPS, verified: CERT_REQUIRED against LDAP_CA_CERT (or the system store), host name
    checked by `ldap3`. `ldap://` or an unverified certificate needs LDAP_ALLOW_INSECURE=1, and
    `ldap_from_env` says so loudly at start-up.
  * Every typed value reaches a filter through `ldap3.utils.conv.escape_filter_chars`, the
    objectGUID through `escape_guid` (each byte `\\xx`): a query cannot change a filter's shape.
  * `ldap3` is synchronous: each call runs on a worker thread (`asyncio.to_thread`), at most
    `SLOTS` at once, and is cut off after `LdapConfig.deadline_s` (2 × LDAP_TIMEOUT_S, at most
    12 s — under the dashboard's 15 s request timeout). The socket connect and receive
    timeouts are LDAP_TIMEOUT_S each.
  * Results are capped: `size_limit` on the server, and the slice here.
  * A network or TLS failure becomes LdapUnavailable(reason); a wrong password is None.
  * The clinician's password goes to one bind. It is not kept, logged or put into an
    exception; an empty one never reaches the server (an empty simple bind is anonymous).
"""
from __future__ import annotations

import ssl
from collections.abc import Mapping
from typing import Any

from ldap3 import Tls
from ldap3.core.exceptions import (
    LDAPCertificateError, LDAPCommunicationError, LDAPResponseTimeoutError, LDAPSocketOpenError,
    LDAPSSLConfigurationError, LDAPStartTLSError,
)
from ldap3.utils.conv import escape_filter_chars

from homunculus.auth.ldap import (
    LdapConfig, LdapGroup, LdapIdentity, guid_from_bytes, guid_to_bytes, is_disabled,
)

USER_ATTRIBUTES = ("objectGUID", "sAMAccountName", "userPrincipalName", "mail", "displayName",
                   "memberOf", "userAccountControl", "pwdLastSet")
# A search lists accounts to pick from; their group lists are not shown, so not read.
SEARCH_ATTRIBUTES = tuple(a for a in USER_ATTRIBUTES if a != "memberOf")
GROUP_ATTRIBUTES = ("cn",)
IN_CHAIN = "1.2.840.113556.1.4.1941"   # LDAP_MATCHING_RULE_IN_CHAIN: nested membership
GROUP_LIMIT = 1000     # nested groups of one account; more is an error, never a truncation
RESULT_CAP = 50
SLOTS = 8              # directory calls at once, each on its own worker thread


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
