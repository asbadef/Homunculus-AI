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

from homunculus.auth.ldap import DEFAULT_USER_FILTER, LdapGroup, LdapUnavailable, load_ldap_config
from homunculus.auth.ldap3_directory import (
    GROUP_LIMIT, SLOTS, Ldap3Directory, escape_guid, failure_reason, group_search_filter,
    guid_lookup_filter, ldap_from_env, nested_groups_filter, parse_group_entry,
    parse_user_entry, tls_for, user_search_filter,
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
    error every bind raises, and one queued (entries, result code) reply per search."""

    def __init__(self, *replies):
        self.passwords = {SVC_DN: SVC_PW, USER_DN: USER_PW}
        self.bind_codes: dict[str, int] = {}
        self.error: BaseException | None = None
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
        if self.script.error is not None:
            raise self.script.error
        ok = self.script.passwords.get(self.user) == self._password
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


async def test_a_refused_service_account_is_an_outage():
    script = Script()
    script.passwords[SVC_DN] = "baska"
    with pytest.raises(LdapUnavailable) as err:
        await _directory(script).test_connection()
    assert err.value.reason == "service_bind_rejected"


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
    assert err.value.reason == "unreachable"


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
