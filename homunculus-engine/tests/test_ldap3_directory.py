"""`Ldap3Directory` without a server: the filters it sends, how it reads AD's entries, how it
names a failure, its TLS settings — and (Task 3) the class itself over scripted connections."""
from __future__ import annotations

import asyncio
import logging
import socket
import ssl
import struct
import threading
import time
import uuid

import pytest
from ldap3 import Tls
from ldap3.core.exceptions import LDAPException, LDAPResponseTimeoutError, LDAPSocketOpenError

from homunculus.auth.ldap import (
    ADMIN_LANE_SLOTS, DEFAULT_USER_FILTER, LdapGroup, LdapUnavailable, load_ldap_config,
)
from homunculus.auth.ldap3_directory import (
    GROUP_LIMIT, SEARCH_ATTRIBUTES, SLOTS, USER_ATTRIBUTES, Ldap3Directory, _wire_filter,
    canonical_dn, escape_guid, failure_reason, group_search_filter, guid_lookup_filter,
    ldap_from_env,
    nested_groups_filter, parse_group_entry, parse_user_entry, tls_for, user_search_filter,
)

GUID = "6b29fc40-ca47-1067-b31d-00dd010662da"
GUID_ESCAPED = r"\40\fc\29\6b\47\ca\67\10\b3\1d\00\dd\01\06\62\da"
USER_DN = "CN=Ayşe Yılmaz,OU=Personel,DC=hastane,DC=local"
BASE = {
    "LDAP_URL": "ldaps://dc1.hastane.local",
    "LDAP_BIND_DN": "CN=svc-homunculus,OU=Servis,DC=hastane,DC=local",
    "LDAP_BIND_PASSWORD": "Servis-Parolasi-7",
    "LDAP_BASE_DN": "DC=hastane,DC=local",
}


# ---------------------------------------------------------------- filters
def test_every_character_that_could_reshape_a_search_filter_is_escaped():
    escaped = r"a\2a\28b\29\5cc"                       # a*(b)\c
    assert user_search_filter("(objectClass=user)", "a*(b)\\c") == (
        rf"(&(objectClass=user)(|(sAMAccountName=*{escaped}*)(displayName=*{escaped}*)"
        rf"(userPrincipalName=*{escaped}*)(mail=*{escaped}*)))")


def test_an_injection_attempt_stays_a_value():
    attempt = user_search_filter(DEFAULT_USER_FILTER, "*)(objectClass=*")
    template = user_search_filter(DEFAULT_USER_FILTER, "x")
    assert attempt.count("(") == template.count("(") and attempt.count(")") == template.count(")")
    assert r"\2a\29\28objectClass=\2a" in attempt


def test_a_group_query_is_escaped_too():
    assert group_search_filter(" YB-(Hekim) ") == r"(&(objectClass=group)(cn=*YB-\28Hekim\29*))"


def test_the_nested_membership_filter_escapes_the_dn():
    dn = r"CN=Yılmaz\, Ayşe,OU=Personel,DC=hastane,DC=local"
    assert nested_groups_filter(dn) == (
        r"(&(objectClass=group)(member:1.2.840.113556.1.4.1941:="
        r"CN=Yılmaz\5c, Ayşe,OU=Personel,DC=hastane,DC=local))")


ADVERSARIAL = ["*", ")(", "\\", "\x00", "Ayşe Yılmaz", "*)(objectClass=*", "a\\2a)(|(cn=*",
               "\\00(\x00)*\\"]


@pytest.mark.parametrize("query", ADVERSARIAL)
def test_on_the_wire_a_search_value_is_exactly_what_was_typed(query):
    """Compiled by ldap3 itself, as Connection.search sends it: the filter keeps its shape
    (the user filter AND one OR of four substring matches) and each value decodes back to the
    typed text — no character of it became filter syntax."""
    compiled = _wire_filter(user_search_filter(DEFAULT_USER_FILTER, query))
    outer = compiled["and"]
    assert len(outer) == 2 and outer[1].getName() == "or"
    matches = [f["substringFilter"] for f in outer[1]["or"]]
    assert [str(m["type"]) for m in matches] == [
        "sAMAccountName", "displayName", "userPrincipalName", "mail"]
    for match in matches:
        assert [(s.getName(), bytes(s.getComponent())) for s in match["substrings"]] == [
            ("any", query.strip().encode("utf-8"))]


@pytest.mark.parametrize("query", ADVERSARIAL)
def test_on_the_wire_a_group_query_is_exactly_what_was_typed(query):
    outer = _wire_filter(group_search_filter(query))["and"]
    assert len(outer) == 2
    match = outer[1]["substringFilter"]
    assert str(match["type"]) == "cn"
    assert [bytes(s.getComponent()) for s in match["substrings"]] == [
        query.strip().encode("utf-8")]


def test_on_the_wire_the_guid_and_a_dn_are_exact_bytes():
    guid = _wire_filter(guid_lookup_filter(DEFAULT_USER_FILTER, GUID))["and"][1]["equalityMatch"]
    assert (str(guid["attributeDesc"]), bytes(guid["assertionValue"])) == (
        "objectGUID", uuid.UUID(GUID).bytes_le)
    dn = r"CN=Yılmaz\, Ayşe (x)*,OU=Personel,DC=hastane,DC=local"
    nested = _wire_filter(nested_groups_filter(dn))["and"][1]["extensibleMatch"]
    assert (str(nested["matchingRule"]), str(nested["type"]), bytes(nested["matchValue"])) == (
        "1.2.840.113556.1.4.1941", "member", dn.encode("utf-8"))


def test_the_guid_reaches_the_filter_as_escaped_bytes():
    assert escape_guid(GUID) == GUID_ESCAPED          # \29 is ")" — harmless once escaped
    assert guid_lookup_filter(DEFAULT_USER_FILTER, GUID) == (
        f"(&{DEFAULT_USER_FILTER}(objectGUID={GUID_ESCAPED}))")
    with pytest.raises(ValueError):
        escape_guid("not-a-guid")


# ---------------------------------------------------------------- entries
def _entry(**overrides):
    raw = {
        "objectGUID": [uuid.UUID(GUID).bytes_le], "sAMAccountName": [b"AYilmaz"],
        "userPrincipalName": [b"ayilmaz@hastane.local"], "mail": [b"Ayse.Yilmaz@hastane.az"],
        "displayName": ["Ayşe Yılmaz".encode()], "userAccountControl": [b"512"],
        "pwdLastSet": [b"134044992000000000"],
        "memberOf": [b"CN=YB-Hemsire,OU=Gruplar,DC=hastane,DC=local"],
    }
    raw.update(overrides)
    return {"type": "searchResEntry", "dn": USER_DN,
            "raw_attributes": {k: v for k, v in raw.items() if v is not None}}


def test_an_ad_entry_is_read_from_its_raw_attributes():
    identity = parse_user_entry(_entry())
    assert identity.external_id == GUID and identity.username == "AYilmaz"
    assert (identity.dn, identity.upn, identity.email, identity.display_name) == (
        USER_DN, "ayilmaz@hastane.local", "Ayse.Yilmaz@hastane.az", "Ayşe Yılmaz")
    assert identity.group_dns == ("CN=YB-Hemsire,OU=Gruplar,DC=hastane,DC=local",)
    assert identity.disabled is False and identity.pwd_last_set == 134044992000000000


def test_attribute_names_are_matched_whatever_their_case():
    entry = _entry()
    lowered = {**entry,
               "raw_attributes": {k.lower(): v for k, v in entry["raw_attributes"].items()}}
    assert parse_user_entry(lowered) == parse_user_entry(entry)


def test_the_accountdisable_bit_marks_the_account_disabled():
    assert parse_user_entry(_entry(userAccountControl=[b"514"])).disabled is True


def test_account_expires_is_read_raw_and_left_out_when_absent():
    assert parse_user_entry(_entry(accountExpires=[b"133000000000000000"])).account_expires \
        == 133_000_000_000_000_000
    assert parse_user_entry(_entry(accountExpires=[b"9223372036854775807"])).account_expires \
        == 0x7FFF_FFFF_FFFF_FFFF
    assert parse_user_entry(_entry()).account_expires is None


def test_every_account_lookup_asks_for_account_expires():
    assert "accountExpires" in USER_ATTRIBUTES and "accountExpires" in SEARCH_ATTRIBUTES


@pytest.mark.parametrize("overrides", [
    {"objectGUID": None}, {"objectGUID": [b"\x01" * 15]},
    {"sAMAccountName": None}, {"sAMAccountName": [b"  "]},
])
def test_an_entry_without_a_guid_or_a_name_is_not_an_account(overrides):
    assert parse_user_entry(_entry(**overrides)) is None


def test_a_group_entry():
    entry = {"dn": "CN=YB-Hekim,OU=Gruplar,DC=hastane,DC=local",
             "raw_attributes": {"cn": [b"YB-Hekim"]}}
    assert parse_group_entry(entry) == LdapGroup(entry["dn"], "YB-Hekim")
    assert parse_group_entry({"dn": "CN=X,DC=y", "raw_attributes": {}}).name == "CN=X,DC=y"
    assert parse_group_entry({"dn": "", "raw_attributes": {}}) is None


# ---------------------------------------------------------------- DNs
@pytest.mark.parametrize("spellings, canonical", [
    (["CN=X, OU=Y", "cn=x,ou=y", " CN = X ,  OU = Y ", "cN=x,Ou=Y"], "cn=x,ou=y"),
    # One comma, three spellings: `\,`, `\2C`, `\2c`.
    ([r"CN=Yılmaz\, Ayşe,DC=x", r"CN=Yılmaz\2C Ayşe,DC=x", r"cn=YıLMAZ\2c AYŞE, dc=X"],
     r"cn=yılmaz\, ayşe,dc=x"),
    # Hex pairs are UTF-8; a character that needs no escape loses its backslash.
    ([r"CN=Ay\C5\9Fe,DC=x", "CN=Ayşe,DC=x", r"CN=\41y\c5\9fe,DC=x"], "cn=ayşe,dc=x"),
    # What must stay escaped, does — AD's special characters anywhere (ldap3 refuses them
    # bare), a leading or trailing space.
    ([r"CN=a\2Bb\3Dc\3B\22\3C\3E\5C\23,DC=x"], r"cn=a\+b\=c\;\"\<\>\\\#,dc=x"),
    ([r"CN=\#a,DC=x", r"CN=\23a,DC=x"], r"cn=\#a,dc=x"),
    ([r"CN=\ a\ ,DC=x", r"CN=\20a\20,DC=x", r"CN=\ a\20 ,DC=x"], r"cn=\ a\ ,dc=x"),
    (["CN=a+OU=b,DC=x"], "cn=a+ou=b,dc=x"),
])
def test_a_dn_has_one_canonical_spelling(spellings, canonical):
    """How a mapping is stored and how AD's memberOf values are compared with it: spacing,
    escaping and case never make the same group two."""
    for spelling in spellings:
        assert canonical_dn(spelling) == canonical, spelling
    assert canonical_dn(canonical) == canonical


@pytest.mark.parametrize("dn", [
    "", "   ", "yb", "=x", "1CN=x", "CN=,DC=x", "CN=a,b", "CN=x,,DC=y", "CN=x,DC=y,",
    r"CN=a\zb,DC=x", "CN=a;b,DC=x", "<GUID=6b29fc40-ca47-1067-b31d-00dd010662da>",
    "CN=a\x00b,DC=x", r"CN=a\00b,DC=x", "CN=a\nb,DC=x", r"CN=a\0Ab,DC=x", "CN=a\x7fb,DC=x",
    r"CN=a\FF,DC=x", "CN=a\ud800,DC=x",
])
def test_what_is_not_a_dn_or_carries_a_control_character_is_refused(dn):
    """Malformed (RFC 4514, as ldap3 parses it), or a control character — NUL included, raw or
    escaped — or an escape that is not UTF-8: ValueError, never a value to store or compare."""
    with pytest.raises(ValueError):
        canonical_dn(dn)


# ---------------------------------------------------------------- failures
@pytest.mark.parametrize("exc, reason", [
    (LDAPSocketOpenError("unable to open socket", [
        (ssl.SSLCertVerificationError("certificate verify failed"), ("10.0.0.5", 636))]), "tls"),
    (ssl.SSLError("handshake"), "tls"),
    (TimeoutError("timed out"), "timeout"),
    (LDAPResponseTimeoutError("no response"), "timeout"),
    (LDAPSocketOpenError("socket connection error while opening: refused"), "unreachable"),
    (ConnectionRefusedError(111, "refused"), "unreachable"),
    (LDAPException("odd reply"), "protocol"),
])
def test_a_failure_is_named_by_its_cause(exc, reason):
    assert failure_reason(exc) == reason


# ---------------------------------------------------------------- TLS
def test_ldaps_is_verified_against_the_given_ca(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n")
    tls = tls_for(load_ldap_config({**BASE, "LDAP_CA_CERT": str(ca)}))
    assert isinstance(tls, Tls) and tls.validate == ssl.CERT_REQUIRED
    assert tls.ca_certs_file == str(ca)


def test_without_a_ca_the_system_store_verifies():
    tls = tls_for(load_ldap_config(BASE))
    assert tls.validate == ssl.CERT_REQUIRED and tls.ca_certs_file is None


def test_only_the_insecure_flag_without_a_ca_skips_verification(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n")
    insecure = {**BASE, "LDAP_ALLOW_INSECURE": "1"}
    assert tls_for(load_ldap_config(insecure)).validate == ssl.CERT_NONE
    assert tls_for(load_ldap_config({**insecure, "LDAP_CA_CERT": str(ca)})).validate == \
        ssl.CERT_REQUIRED


def test_plain_ldap_has_no_tls_at_all():
    config = load_ldap_config({**BASE, "LDAP_URL": "ldap://dc1.hastane.local",
                               "LDAP_ALLOW_INSECURE": "1"})
    assert tls_for(config) is None


# ---------------------------------------------------------------- the class, over scripted connections
SVC_DN = BASE["LDAP_BIND_DN"]
SVC_PW = BASE["LDAP_BIND_PASSWORD"]
USER_PW = "Dogru-Parola-1"


class Script:
    """What the fake server answers: a password per DN, a result code for a refused bind, an
    error every bind raises (or the bind as one DN only), and one queued (entries, result code)
    reply per search."""

    def __init__(self, *replies):
        self.passwords = {SVC_DN: SVC_PW, USER_DN: USER_PW}
        self.bind_codes: dict[str, int] = {}
        self.error: BaseException | None = None
        self.bind_errors: dict[str, BaseException] = {}
        self.replies = list(replies)
        self.connections: list[FakeConnection] = []
        self.searches: list[dict] = []

    def connect(self, user, password):
        conn = FakeConnection(self, user, password)
        self.connections.append(conn)
        return conn


class FakeConnection:
    """The slice of `ldap3.Connection` that Ldap3Directory uses."""

    def __init__(self, script, user, password):
        self.script, self.user, self._password = script, user, password
        self.result, self.response, self.closed = {}, [], False

    def bind(self):
        error = self.script.bind_errors.get(self.user, self.script.error)
        if error is not None:
            raise error
        ok =self.script.passwords.get(self.user) == self._password
        self.result = {"result": 0 if ok else self.script.bind_codes.get(self.user, 49)}
        return ok

    def search(self, **request):
        self.script.searches.append(request)
        entries, code = self.script.replies.pop(0)
        self.response, self.result = entries, {"result": code}
        return bool(entries)

    def unbind(self):
        self.closed = True


def _directory(script, **env):
    config = load_ldap_config({**BASE, "LDAP_NESTED_GROUPS": "0", **env})
    return Ldap3Directory(config, connect=script.connect)


def _bound_as(script):
    return [c.user for c in script.connections]


async def test_sign_in_finds_the_account_by_guid_then_binds_as_its_dn():
    script = Script(([_entry()], 0))
    identity = await _directory(script).authenticate(GUID, USER_PW)
    assert identity is not None and identity.username == "AYilmaz"
    assert _bound_as(script) == [SVC_DN, USER_DN]
    search = script.searches[0]
    assert search["search_filter"] == guid_lookup_filter(DEFAULT_USER_FILTER, GUID)
    assert search["search_base"] == BASE["LDAP_BASE_DN"] and search["size_limit"] == 2
    assert all(c.closed for c in script.connections)


async def test_a_wrong_password_is_none_not_an_outage():
    script = Script(([_entry()], 0))
    assert await _directory(script).authenticate(GUID, "Yanlis-1") is None
    assert _bound_as(script) == [SVC_DN, USER_DN]


async def test_an_empty_password_or_a_malformed_guid_never_reaches_the_server():
    script = Script()
    directory = _directory(script)
    assert await directory.authenticate(GUID, "") is None
    assert await directory.authenticate("not-a-guid", USER_PW) is None
    assert await directory.find_by_external_id("not-a-guid") is None
    assert script.connections == []


async def test_an_unknown_account_is_none_after_one_service_search():
    script = Script(([], 0))
    assert await _directory(script).authenticate(GUID, USER_PW) is None
    assert _bound_as(script) == [SVC_DN]


async def test_a_disabled_account_is_returned_without_a_bind_as_it():
    script = Script(([_entry(userAccountControl=[b"514"])], 0))
    identity = await _directory(script).authenticate(GUID, "her-neyse")
    assert identity is not None and identity.disabled is True
    assert _bound_as(script) == [SVC_DN]


def _filetime(unix_seconds: float) -> int:
    return int((unix_seconds + 11_644_473_600) * 10_000_000)


async def test_an_expired_account_is_returned_without_a_bind_as_it():
    """Off-boarding by an end date: refused like a disabled account, and no password goes to a
    domain controller for it (no lockout count either)."""
    expired = str(_filetime(time.time() - 3600)).encode()
    script = Script(([_entry(accountExpires=[expired])], 0))
    identity = await _directory(script).authenticate(GUID, "her-neyse")
    assert identity is not None and identity.account_expires == int(expired)
    assert _bound_as(script) == [SVC_DN]


@pytest.mark.parametrize("account_expires", [b"0", b"9223372036854775807", None])
async def test_an_account_that_has_not_expired_still_binds(account_expires):
    later = [str(_filetime(time.time() + 3600)).encode()]
    script = Script(([_entry(accountExpires=[account_expires] if account_expires else later)], 0))
    assert await _directory(script).authenticate(GUID, USER_PW) is not None
    assert _bound_as(script) == [SVC_DN, USER_DN]


async def test_a_refused_service_account_is_an_outage():
    script = Script()
    script.passwords[SVC_DN] = "baska"
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).test_connection()
    assert err.value.reason == "service_bind_rejected"


async def test_a_service_bind_refused_for_another_reason_is_a_protocol_outage():
    script = Script()
    script.passwords[SVC_DN] = "baska"
    script.bind_codes[SVC_DN] = 53                        # unwillingToPerform
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).test_connection()
    assert err.value.reason == "protocol"


class RawSocket:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


@pytest.mark.parametrize("error, reason", [
    (ssl.SSLError("handshake"), "tls"),
    (TimeoutError("handshake timed out"), "timeout"),
])
async def test_a_failed_handshake_closes_the_socket_ldap3_left_open(error, reason):
    """After TCP connect, a failed TLS handshake leaves ldap3's connection "closed" (unbind does
    nothing) with its socket still open."""
    script = Script()
    script.error = error

    def connect(user, password):
        conn = script.connect(user, password)
        conn.socket = RawSocket()
        return conn

    with pytest.raises(LdapUnavailable) as err:
        await Ldap3Directory(load_ldap_config(BASE), connect=connect).test_connection()
    assert err.value.reason == reason
    assert script.connections[0].socket.closed


async def test_a_search_cut_off_by_the_servers_time_limit_is_a_timeout():
    script = Script(([], 3))                              # 3 = timeLimitExceeded
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).find_by_external_id(GUID)
    assert err.value.reason == "timeout"


async def test_a_user_bind_refused_for_another_reason_is_an_outage():
    script = Script(([_entry()], 0))
    script.bind_codes[USER_DN] = 53                       # unwillingToPerform
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).authenticate(GUID, "Yanlis-1")
    assert err.value.reason == "protocol"


@pytest.mark.parametrize("error, reason", [
    (LDAPSocketOpenError("socket connection error while opening: refused"), "unreachable"),
    (LDAPSocketOpenError("unable to open socket", [
        (ssl.SSLCertVerificationError("certificate verify failed"), ("10.0.0.5", 636))]), "tls"),
])
async def test_network_and_tls_failures_are_outages(error, reason, caplog):
    script = Script()
    script.error = error
    with caplog.at_level(logging.WARNING), pytest.raises(LdapUnavailable) as err:
        await _directory(script).authenticate(GUID, USER_PW)
    assert err.value.reason == reason
    assert script.connections[0].closed
    assert USER_PW not in caplog.text and SVC_PW not in caplog.text


async def test_nested_groups_come_from_the_in_chain_rule():
    groups = [{"type": "searchResEntry", "dn": "CN=YB-Hemsire,OU=Gruplar,DC=hastane,DC=local",
               "raw_attributes": {"cn": [b"YB-Hemsire"]}},
              {"type": "searchResEntry", "dn": "CN=Tum-Personel,OU=Gruplar,DC=hastane,DC=local",
               "raw_attributes": {"cn": [b"Tum-Personel"]}}]
    script = Script(([_entry()], 0), (groups, 0))
    identity = await _directory(script, LDAP_NESTED_GROUPS="1").find_by_external_id(GUID)
    assert identity.group_dns == (groups[0]["dn"], groups[1]["dn"])
    nested = script.searches[1]
    assert nested["search_filter"] == nested_groups_filter(USER_DN)
    assert nested["size_limit"] == GROUP_LIMIT


async def test_a_nested_group_list_over_the_limit_is_refused_not_truncated():
    script = Script(([_entry()], 0), ([], 4))             # 4 = sizeLimitExceeded
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script, LDAP_NESTED_GROUPS="1").find_by_external_id(GUID)
    assert err.value.reason == "protocol"


async def test_a_search_is_capped_and_reads_no_group_lists():
    second = _entry(objectGUID=[uuid.uuid4().bytes_le], sAMAccountName=[b"AYildiz"])
    script = Script(([_entry(), second], 4))              # more exist: the first page is enough
    found = await _directory(script).search_users("yil", limit=2)
    assert [i.username for i in found] == ["AYilmaz", "AYildiz"]
    request = script.searches[0]
    assert request["size_limit"] == 2 and "memberOf" not in request["attributes"]
    assert request["search_filter"] == user_search_filter(DEFAULT_USER_FILTER, "yil")


async def test_a_blank_search_never_reaches_the_server():
    script = Script()
    assert await _directory(script).search_users("   ") == []
    assert await _directory(script).search_groups("") == []
    assert script.connections == []


async def test_groups_for_the_mapping_picker():
    entry = {"type": "searchResEntry", "dn": "CN=YB-Hekim,OU=Gruplar,DC=hastane,DC=local",
             "raw_attributes": {"cn": [b"YB-Hekim"]}}
    script = Script(([entry], 0))
    assert await _directory(script).search_groups("hekim") == [LdapGroup(entry["dn"], "YB-Hekim")]
    assert script.searches[0]["search_filter"] == group_search_filter("hekim")


async def test_the_service_account_test_binds_and_closes():
    script = Script()
    await _directory(script).test_connection()
    assert _bound_as(script) == [SVC_DN] and script.connections[0].closed


async def test_a_hung_directory_is_cut_off_at_the_deadline():
    script = Script()

    def slow(user, password):
        time.sleep(0.5)
        return script.connect(user, password)

    directory = Ldap3Directory(load_ldap_config(BASE), connect=slow, deadline_s=0.05)
    started = time.monotonic()
    with pytest.raises(LdapUnavailable) as err:
        await directory.test_connection()
    assert err.value.reason == "timeout" and time.monotonic() - started < 0.4


class Gauge:
    """How many threads are inside directory I/O at once, and the most there ever were."""

    def __init__(self):
        self._lock = threading.Lock()
        self.inside = self.peak = 0

    def __enter__(self):
        with self._lock:
            self.inside += 1
            self.peak = max(self.peak, self.inside)

    def __exit__(self, *exc):
        with self._lock:
            self.inside -= 1


async def _drained(gauge: Gauge, within: float = 5.0) -> None:
    """Wait until no thread is left inside directory I/O (calls cut off keep running)."""
    end = time.monotonic() + within
    while gauge.inside and time.monotonic() < end:
        await asyncio.sleep(0.02)
    assert gauge.inside == 0


async def test_never_more_than_eight_threads_do_directory_io():
    """D6: a call cut off at its deadline keeps its thread until the socket gives up; the cap
    must hold for those threads too, not only for the calls still waited on."""
    gauge = Gauge()

    def slow(user, password):
        with gauge:
            time.sleep(0.3)
        return Script().connect(user, password)

    directory = Ldap3Directory(load_ldap_config(BASE), connect=slow, deadline_s=0.1)
    results = await asyncio.gather(*(directory.test_connection() for _ in range(40)),
                                   return_exceptions=True)
    await _drained(gauge)
    assert {r.reason for r in results if isinstance(r, LdapUnavailable)} == {"timeout"}
    assert all(isinstance(r, LdapUnavailable) for r in results)
    assert gauge.peak <= SLOTS


async def test_a_call_queued_behind_eight_hung_ones_times_out_within_its_own_deadline():
    release = threading.Event()

    def hung(user, password):
        release.wait(5)
        return Script().connect(user, password)

    directory = Ldap3Directory(load_ldap_config(BASE), connect=hung, deadline_s=0.5)
    stuck = [asyncio.create_task(directory.test_connection()) for _ in range(SLOTS)]
    await asyncio.sleep(0.1)                         # all eight threads are taken
    started = time.monotonic()
    try:
        with pytest.raises(LdapUnavailable) as err:
            await directory.test_connection()
        waited = time.monotonic() - started
    finally:
        release.set()
        await asyncio.gather(*stuck, return_exceptions=True)
    assert err.value.reason == "timeout" and waited < 0.5 + 0.15


async def test_directory_work_never_runs_on_the_event_loops_default_threads():
    """asyncpg resolves the database host on asyncio's default executor: a slow directory must
    not queue in front of it."""
    names = []
    script = Script()

    def record(user, password):
        names.append(threading.current_thread().name)
        return script.connect(user, password)

    await Ldap3Directory(load_ldap_config(BASE), connect=record).test_connection()
    assert names and all(name.startswith("ldap") for name in names)


async def test_after_close_a_call_is_an_outage_not_a_crash():
    directory = _directory(Script())
    directory.close()
    with pytest.raises(LdapUnavailable) as err:
        await directory.test_connection()
    assert err.value.reason == "unreachable"


async def test_close_cancels_a_queued_call_as_an_outage():
    release = threading.Event()

    def hung(user, password):
        release.wait(5)
        return Script().connect(user, password)

    directory = Ldap3Directory(load_ldap_config(BASE), connect=hung, deadline_s=3)
    stuck = [asyncio.create_task(directory.test_connection()) for _ in range(SLOTS)]
    await asyncio.sleep(0.1)
    queued = asyncio.create_task(directory.test_connection())
    await asyncio.sleep(0.05)
    directory.close()
    try:
        with pytest.raises(LdapUnavailable) as err:
            await queued
    finally:
        release.set()
        await asyncio.gather(*stuck, return_exceptions=True)
    assert (err.value.reason, err.value.bind_attempted) == ("unreachable", False)


# ---------------------------------------------------------------- the admin lane
def test_the_admin_lane_leaves_most_threads_to_sign_ins():
    assert ADMIN_LANE_SLOTS == 3 and SLOTS - ADMIN_LANE_SLOTS >= 5


async def test_admin_calls_take_at_most_their_lane_and_a_sign_in_is_not_held_up():
    """Two imports' lookups at once against a slow domain controller: never more than
    ADMIN_LANE_SLOTS threads do administration work, so a clinician's sign-in finds a free
    thread and is answered in its own time — not after the imports."""
    gauge = Gauge()
    script = Script(*[([_entry()], 0)] * 21)

    def slow(user, password):
        with gauge:
            time.sleep(0.1)
        return script.connect(user, password)

    directory = _directory_over(slow, deadline_s=5)
    lane = asyncio.Semaphore(ADMIN_LANE_SLOTS)
    imports = [asyncio.create_task(directory.find_by_external_id(GUID, lane=lane))
               for _ in range(20)]
    await asyncio.sleep(0.25)
    assert gauge.peak == ADMIN_LANE_SLOTS                 # the lane is full, and no more
    started = time.monotonic()
    assert await directory.authenticate(GUID, USER_PW) is not None
    took = time.monotonic() - started
    assert not all(task.done() for task in imports)
    assert all(found is not None for found in await asyncio.gather(*imports))
    assert took < 0.2 + 0.15                              # its two binds, no queue
    assert gauge.peak <= ADMIN_LANE_SLOTS + 1
    await _idle(directory)


async def test_a_lane_place_is_held_until_the_thread_ends_and_the_wait_has_its_own_bound():
    """A call cut off at its deadline keeps its thread until the socket gives up: its place in
    the lane is kept as long, or the lane would not cap threads. The wait for a place is bounded
    by the deadline on its own, and the call's deadline starts once it has a place: a call that
    waited 0.2 s and then worked 0.2 s is answered, although together they pass 0.3 s."""
    gauge, connects, gate = Gauge(), [], threading.Event()

    def slow(user, password):
        connects.append(user)
        with gauge:
            if len(connects) == 1:
                gate.wait(5)                              # the first call's thread: held
            else:
                time.sleep(0.2)
        return Script().connect(user, password)

    directory = _directory_over(slow, deadline_s=0.3)
    lane = asyncio.Semaphore(1)
    first = asyncio.create_task(directory.test_connection(lane=lane))
    try:
        with pytest.raises(LdapUnavailable) as err:
            await first                                   # cut off at 0.3 s; its thread: held
        assert err.value.reason == "timeout"
        asked = time.monotonic()
        second = asyncio.create_task(directory.test_connection(lane=lane))
        await asyncio.sleep(0.2)
        assert not second.done() and len(connects) == 1  # no place while that thread runs
    finally:
        gate.set()
    await second                                          # waited 0.2 s, then 0.2 s its own
    assert time.monotonic() - asked > 0.3
    assert gauge.peak == 1
    await _idle(directory)


async def test_a_call_that_waits_its_deadline_for_a_lane_place_is_a_timeout():
    """The lane is full (a thread of a call cut off long ago still runs): an administration
    call waits for a place at most its deadline, then gives up as a timeout — a 503, never an
    unbounded wait — having sent nothing (`bind_attempted` False) and leaving the lane as it
    found it."""
    gate, connects = threading.Event(), []

    def hung(user, password):
        connects.append(user)
        gate.wait(5)
        return Script().connect(user, password)

    directory = _directory_over(hung, deadline_s=0.3)
    lane = asyncio.Semaphore(1)
    first = asyncio.create_task(directory.test_connection(lane=lane))
    try:
        while not connects:
            await asyncio.sleep(0.01)
        started = time.monotonic()
        with pytest.raises(LdapUnavailable) as err:
            await directory.search_users("kaya", lane=lane)
        waited = time.monotonic() - started
    finally:
        gate.set()
    assert (err.value.reason, err.value.bind_attempted) == ("timeout", False)
    assert 0.3 - 0.05 <= waited < 0.3 + 0.15
    assert connects == [SVC_DN]                           # the search never reached the server
    with pytest.raises(LdapUnavailable):
        await first
    await _idle(directory)
    await asyncio.sleep(0)                                # the place is given back on the loop
    await asyncio.wait_for(lane.acquire(), 1)             # it came back...
    assert lane.locked()                                  # ...once


# ---------------------------------------------------------------- was the password sent? (throttle)
def _directory_over(connect, deadline_s: float) -> Ldap3Directory:
    return Ldap3Directory(load_ldap_config({**BASE, "LDAP_NESTED_GROUPS": "0"}),
                          connect=connect, deadline_s=deadline_s)


def _slow_as(dn: str, script: Script, seconds: float,
             entered: threading.Event | None = None):
    """A connect that takes `seconds` to open a connection as `dn`, and only as `dn`."""
    def connect(user, password):
        if user == dn:
            if entered is not None:
                entered.set()
            time.sleep(seconds)
        return script.connect(user, password)
    return connect


async def _idle(directory: Ldap3Directory) -> None:
    """Every worker thread finished, those of calls cut off included: only then can a test say
    that a call never bound afterwards."""
    await asyncio.to_thread(directory._pool.shutdown, wait=True)


async def test_a_call_cut_off_before_the_bind_as_the_account_never_makes_it():
    """A domain controller slow to let the service account in: the caller gets its outage at
    the deadline, marked "no password sent" (the sign-in throttle does not count it), and the
    thread, which runs on, stops before the bind as the account — a call already given up must
    never spend one of the account's attempts in AD's lockout count afterwards."""
    script = Script(([_entry()], 0))
    directory = _directory_over(_slow_as(SVC_DN, script, 0.3), deadline_s=0.1)
    with pytest.raises(LdapUnavailable) as err:
        await directory.authenticate(GUID, USER_PW)
    assert (err.value.reason, err.value.bind_attempted) == ("timeout", False)
    await _idle(directory)
    assert _bound_as(script) == [SVC_DN] and len(script.searches) == 1


async def test_a_call_cut_off_while_queued_sent_no_password_and_never_runs():
    release = threading.Event()
    script = Script(([_entry()], 0))

    def hung(user, password):
        release.wait(5)
        return script.connect(user, password)

    directory = _directory_over(hung, deadline_s=0.3)
    stuck = [asyncio.create_task(directory.test_connection()) for _ in range(SLOTS)]
    await asyncio.sleep(0.1)                         # all eight threads are taken
    try:
        with pytest.raises(LdapUnavailable) as err:
            await directory.authenticate(GUID, USER_PW)
    finally:
        release.set()
        await asyncio.gather(*stuck, return_exceptions=True)
    assert (err.value.reason, err.value.bind_attempted) == ("timeout", False)
    await _idle(directory)
    assert USER_DN not in _bound_as(script)


async def test_a_call_cut_off_during_the_bind_as_the_account_says_the_password_was_sent():
    """AD may count that bind toward the account's lockout whatever its outcome: so does the
    sign-in throttle."""
    script = Script(([_entry()], 0))
    directory = _directory_over(_slow_as(USER_DN, script, 0.3), deadline_s=0.1)
    with pytest.raises(LdapUnavailable) as err:
        await directory.authenticate(GUID, USER_PW)
    assert (err.value.reason, err.value.bind_attempted) == ("timeout", True)
    await _idle(directory)


@pytest.mark.parametrize("dn, sent", [(SVC_DN, False), (USER_DN, True)])
@pytest.mark.parametrize("error, reason", [
    (LDAPResponseTimeoutError("no answer"), "timeout"),
    (LDAPSocketOpenError("socket connection error while opening: refused"), "unreachable"),
    (KeyError("library bug"), "protocol"),
])
async def test_a_failure_says_whether_the_password_had_been_sent(dn, sent, error, reason):
    script = Script(([_entry()], 0))
    script.bind_errors[dn] = error
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).authenticate(GUID, USER_PW)
    assert (err.value.reason, err.value.bind_attempted) == (reason, sent)


async def test_a_user_bind_answered_with_an_unexpected_code_sent_the_password():
    script = Script(([_entry()], 0))
    script.bind_codes[USER_DN] = 53                       # unwillingToPerform
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).authenticate(GUID, "Yanlis-1")
    assert (err.value.reason, err.value.bind_attempted) == ("protocol", True)


async def test_a_search_failure_before_the_bind_sent_no_password():
    script = Script(([_entry()], 0), ([], 4))             # the group list over the limit
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script, LDAP_NESTED_GROUPS="1").authenticate(GUID, USER_PW)
    assert (err.value.reason, err.value.bind_attempted) == ("protocol", False)
    assert _bound_as(script) == [SVC_DN]


@pytest.mark.parametrize("slow_dn, sent", [(SVC_DN, False), (USER_DN, True)])
async def test_a_cancelled_sign_in_says_whether_the_password_had_been_sent(slow_dn, sent):
    """The caller gone (the request cut off, the server stopping): the cancellation carries
    `bind_attempted` as an outage does, and a call cancelled before the bind as the account
    never makes it afterwards."""
    script = Script(([_entry()], 0))
    entered = threading.Event()
    directory = _directory_over(_slow_as(slow_dn, script, 0.3, entered), deadline_s=5)
    caught: list[BaseException] = []

    async def sign_in():
        try:
            await directory.authenticate(GUID, USER_PW)
        except asyncio.CancelledError as exc:
            caught.append(exc)
            raise

    task = asyncio.create_task(sign_in())
    assert await asyncio.to_thread(entered.wait, 5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await _idle(directory)
    assert [exc.bind_attempted for exc in caught] == [sent]
    assert (USER_DN in _bound_as(script)) is sent


@pytest.fixture
def silent_server():
    """A TCP port that accepts connections and never answers: a hung domain controller."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(16)
    held: list[socket.socket] = []

    def accept_forever():
        while True:
            try:
                held.append(srv.accept()[0])
            except OSError:
                return

    threading.Thread(target=accept_forever, daemon=True).start()
    yield srv.getsockname()[1]
    srv.close()
    for conn in held:
        conn.close()


async def test_on_linux_a_directory_that_never_answers_is_a_timeout(silent_server, monkeypatch):
    """Regression: off Windows, ldap3 2.9.1 packs the receive timeout as struct 'LL' — a float
    there raised struct.error, which escaped every directory call as a 500. The real
    Ldap3Directory, ldap3's own socket code, its Linux branch."""
    import ldap3.strategy.base
    monkeypatch.setattr(ldap3.strategy.base, "system", lambda: "Linux")
    config = load_ldap_config({**BASE, "LDAP_URL": f"ldap://127.0.0.1:{silent_server}",
                               "LDAP_ALLOW_INSECURE": "1", "LDAP_TIMEOUT_S": "1"})
    started = time.monotonic()
    with pytest.raises(LdapUnavailable) as err:
        await Ldap3Directory(config).test_connection()
    assert err.value.reason == "timeout"
    assert time.monotonic() - started < config.deadline_s + 0.5


@pytest.mark.parametrize("error", [
    struct.error("required argument is not an integer"),
    KeyError(f"{USER_DN} {SVC_PW}"),
])
async def test_an_unexpected_library_failure_is_a_protocol_outage(error, caplog):
    script = Script()
    script.error = error
    with caplog.at_level(logging.WARNING), pytest.raises(LdapUnavailable) as err:
        await _directory(script).test_connection()
    assert err.value.reason == "protocol"
    assert type(error).__name__ in caplog.text
    assert SVC_PW not in caplog.text and USER_DN not in caplog.text


async def test_check_password_binds_once_as_the_given_dn():
    script = Script()
    directory = _directory(script)
    assert await directory.check_password(SVC_DN, "yanlis") is False
    assert await directory.check_password(SVC_DN, SVC_PW) is True
    assert await directory.check_password(SVC_DN, "") is False
    assert _bound_as(script) == [SVC_DN, SVC_DN]


# ---------------------------------------------------------------- the production wiring
def test_no_url_no_directory():
    assert ldap_from_env({}) is None


def test_an_unusable_configuration_turns_ldap_off_and_says_why(caplog):
    with caplog.at_level(logging.ERROR, logger="homunculus.auth.ldap3_directory"):
        assert ldap_from_env({**BASE, "LDAP_BIND_DN": ""}) is None
    assert "LDAP is OFF" in caplog.text and "LDAP_BIND_DN" in caplog.text


def _never_echoed(caplog, *secrets: str) -> None:
    assert "LDAP is OFF" in caplog.text
    assert all(r.exc_info is None for r in caplog.records)
    for secret in secrets:
        assert secret not in caplog.text


@pytest.mark.parametrize("url", ["ldaps://[dc1", "ldaps://svc:Gizli／Url@dc1.hastane.local"])
def test_a_url_that_cannot_be_split_turns_ldap_off_without_echoing_it(url, caplog):
    with caplog.at_level(logging.DEBUG):
        assert ldap_from_env({**BASE, "LDAP_URL": url}) is None
    _never_echoed(caplog, "Gizli", "[dc1")
    assert "LDAP_URL" in caplog.text


def test_any_failure_reading_the_settings_turns_ldap_off_never_the_api(monkeypatch, caplog):
    def broken(env):
        raise RuntimeError(f"bind as {SVC_DN} with {SVC_PW}")

    monkeypatch.setattr("homunculus.auth.ldap3_directory.load_ldap_config", broken)
    with caplog.at_level(logging.DEBUG):
        assert ldap_from_env(BASE) is None
    _never_echoed(caplog, SVC_PW, SVC_DN)
    assert "RuntimeError" in caplog.text


@pytest.mark.parametrize("user_filter", [
    "()", "(a=b))(|(c=d)", "(a=b)(c=d)", "(&(a=b)", "(!(a=b)(c=d))", "(&)",
])
def test_a_user_filter_ldap3_cannot_parse_turns_ldap_off(user_filter, caplog):
    """Each passes the shallow parenthesis check, then made every AD sign-in a 503."""
    with caplog.at_level(logging.DEBUG):
        assert ldap_from_env({**BASE, "LDAP_USER_FILTER": user_filter}) is None
    _never_echoed(caplog, user_filter)
    assert "LDAP_USER_FILTER" in caplog.text


def test_a_custom_user_filter_that_parses_is_kept():
    custom = "(&(objectClass=user)(memberOf=CN=Homunculus,OU=Gruplar,DC=hastane,DC=local))"
    runtime = ldap_from_env({**BASE, "LDAP_USER_FILTER": custom})
    assert runtime is not None and runtime.directory._config.user_filter == custom


def test_the_insecure_flag_is_announced(caplog):
    with caplog.at_level(logging.WARNING, logger="homunculus.auth.ldap3_directory"):
        runtime = ldap_from_env({**BASE, "LDAP_URL": "ldap://dc1.hastane.local",
                                 "LDAP_ALLOW_INSECURE": "1"})
    assert runtime is not None and "plain ldap://" in caplog.text


def test_a_good_configuration_builds_the_runtime():
    runtime = ldap_from_env({**BASE, "LDAP_LOGIN_ATTRS": "sAMAccountName"})
    assert isinstance(runtime.directory, Ldap3Directory)
    assert (runtime.url_host, runtime.login_attrs, runtime.last_test_ok) == (
        "dc1.hastane.local", ("samaccountname",), None)
    assert SVC_PW not in repr(runtime)
