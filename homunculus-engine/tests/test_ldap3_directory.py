"""`Ldap3Directory` without a server: the filters it sends, how it reads AD's entries, how it
names a failure, its TLS settings — and (Task 3) the class itself over scripted connections."""
from __future__ import annotations

import ssl
import uuid

import pytest
from ldap3 import Tls
from ldap3.core.exceptions import LDAPException, LDAPResponseTimeoutError, LDAPSocketOpenError

from homunculus.auth.ldap import DEFAULT_USER_FILTER, LdapGroup, load_ldap_config
from homunculus.auth.ldap3_directory import (
    escape_guid, failure_reason, group_search_filter, guid_lookup_filter, nested_groups_filter,
    parse_group_entry, parse_user_entry, tls_for, user_search_filter,
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
