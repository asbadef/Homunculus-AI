"""The LDAP configuration and the pure rules of a directory sign-in (spec §7): the LDAP_*
environment, objectGUID's string form, the ACCOUNTDISABLE bit, pwdLastSet against a token, and
which typed login forms name an account. No network, no database."""
from __future__ import annotations

import pytest

from homunculus.auth.ldap import (
    DEFAULT_USER_FILTER, LOGIN_ATTRS, LdapConfigError, LdapIdentity, canonical_guid,
    guid_from_bytes, guid_to_bytes, is_disabled, load_ldap_config, login_matches,
    password_changed_since,
)
from homunculus.auth.service import directory_login_alternative

BASE = {
    "LDAP_URL": "ldaps://dc1.hastane.local",
    "LDAP_BIND_DN": "CN=svc-homunculus,OU=Servis,DC=hastane,DC=local",
    "LDAP_BIND_PASSWORD": "Servis-Parolasi-7",
    "LDAP_BASE_DN": "DC=hastane,DC=local",
}
GUID = "6b29fc40-ca47-1067-b31d-00dd010662da"


def _env(**changes: str | None) -> dict[str, str]:
    env = dict(BASE)
    for key, value in changes.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return env


# ---------------------------------------------------------------- configuration
def test_no_url_means_the_directory_is_off():
    assert load_ldap_config({}) is None
    assert load_ldap_config({"LDAP_URL": "   "}) is None


def test_the_defaults():
    config = load_ldap_config(BASE)
    assert (config.host, config.port, config.use_ssl) == ("dc1.hastane.local", 636, True)
    assert config.ca_cert is None and config.allow_insecure is False
    assert config.user_filter == DEFAULT_USER_FILTER
    assert config.login_attrs == LOGIN_ATTRS
    assert config.nested_groups is True
    assert (config.timeout_s, config.deadline_s) == (5.0, 10.0)


def test_an_explicit_port_and_options(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("-----BEGIN CERTIFICATE-----\n")
    config = load_ldap_config(_env(
        LDAP_URL="ldaps://DC1.hastane.local:3269", LDAP_CA_CERT=str(ca),
        LDAP_NESTED_GROUPS="0", LDAP_TIMEOUT_S="2", LDAP_LOGIN_ATTRS="sAMAccountName, mail"))
    assert (config.host, config.port) == ("dc1.hastane.local", 3269)
    assert config.ca_cert == str(ca) and config.nested_groups is False
    assert (config.timeout_s, config.deadline_s) == (2.0, 4.0)
    assert config.login_attrs == ("samaccountname", "mail")


def test_the_deadline_never_reaches_the_dashboards_15_seconds():
    assert load_ldap_config(_env(LDAP_TIMEOUT_S="10")).deadline_s == 12.0


def test_plain_ldap_needs_the_insecure_flag():
    with pytest.raises(LdapConfigError, match="LDAP_ALLOW_INSECURE"):
        load_ldap_config(_env(LDAP_URL="ldap://dc1.hastane.local"))
    config = load_ldap_config(_env(LDAP_URL="ldap://dc1.hastane.local", LDAP_ALLOW_INSECURE="1"))
    assert (config.use_ssl, config.port, config.allow_insecure) == (False, 389, True)


@pytest.mark.parametrize("url", [
    "https://dc1.hastane.local", "ldaps://", "ldaps://dc1.hastane.local/DC=x",
    "ldaps://dc1.hastane.local:99999", "ldaps://dc1.hastane.local?x=1",
])
def test_a_url_that_is_not_just_a_host_is_refused(url):
    with pytest.raises(LdapConfigError, match="LDAP_URL"):
        load_ldap_config(_env(LDAP_URL=url))


@pytest.mark.parametrize("url", [
    "ldaps://[dc1",                                          # "Invalid IPv6 URL"
    "ldaps://svc:Gizli／Url@dc1.hastane.local",         # NFKC: urlsplit echoes the netloc
])
def test_a_url_python_cannot_split_is_a_config_error_that_never_echoes_it(url):
    with pytest.raises(LdapConfigError, match="LDAP_URL") as err:
        load_ldap_config(_env(LDAP_URL=url))
    assert "Gizli" not in str(err.value) and "[dc1" not in str(err.value)
    assert err.value.__cause__ is None and err.value.__suppress_context__


def test_credentials_in_the_url_are_refused_and_never_echoed():
    with pytest.raises(LdapConfigError) as err:
        load_ldap_config(_env(LDAP_URL="ldaps://svc:Gizli-Url-Parola@dc1.hastane.local"))
    assert "Gizli-Url-Parola" not in str(err.value)


@pytest.mark.parametrize("name", ["LDAP_BIND_DN", "LDAP_BIND_PASSWORD", "LDAP_BASE_DN"])
def test_the_service_account_and_the_base_are_required(name):
    with pytest.raises(LdapConfigError, match=name):
        load_ldap_config(_env(**{name: None}))
    with pytest.raises(LdapConfigError, match=name):
        load_ldap_config(_env(**{name: "  "}))


def test_the_ca_certificate_must_be_a_file(tmp_path):
    with pytest.raises(LdapConfigError, match="LDAP_CA_CERT"):
        load_ldap_config(_env(LDAP_CA_CERT=str(tmp_path / "missing.pem")))
    with pytest.raises(LdapConfigError, match="LDAP_CA_CERT"):
        load_ldap_config(_env(LDAP_CA_CERT=str(tmp_path)))   # Docker's missing-file trap: a dir


@pytest.mark.parametrize("value", ["0.5", "11", "abc"])
def test_the_timeout_is_a_number_between_1_and_10_seconds(value):
    with pytest.raises(LdapConfigError, match="LDAP_TIMEOUT_S"):
        load_ldap_config(_env(LDAP_TIMEOUT_S=value))


@pytest.mark.parametrize("value", ["cn", "sAMAccountName,cn", " , "])
def test_login_attrs_name_only_the_three_login_attributes(value):
    with pytest.raises(LdapConfigError, match="LDAP_LOGIN_ATTRS"):
        load_ldap_config(_env(LDAP_LOGIN_ATTRS=value))


def test_the_user_filter_must_be_one_parenthesised_filter():
    with pytest.raises(LdapConfigError, match="LDAP_USER_FILTER"):
        load_ldap_config(_env(LDAP_USER_FILTER="objectClass=user"))
    custom = "(&(objectClass=user)(memberOf=CN=Homunculus,OU=Gruplar,DC=hastane,DC=local))"
    assert load_ldap_config(_env(LDAP_USER_FILTER=custom)).user_filter == custom


def test_a_flag_is_1_or_0():
    with pytest.raises(LdapConfigError, match="LDAP_NESTED_GROUPS"):
        load_ldap_config(_env(LDAP_NESTED_GROUPS="belki"))


def test_the_service_password_never_appears_in_a_repr():
    assert "Servis-Parolasi-7" not in repr(load_ldap_config(BASE))


# ---------------------------------------------------------------- objectGUID
def test_objectguid_bytes_read_as_ads_own_tools_print_them():
    raw = bytes.fromhex("40fc296b47ca6710b31d00dd010662da")    # as AD stores it
    assert guid_from_bytes(raw) == GUID
    assert guid_to_bytes(GUID) == raw
    assert canonical_guid("{6B29FC40-CA47-1067-B31D-00DD010662DA}") == GUID


def test_a_guid_is_16_bytes_or_a_uuid():
    with pytest.raises(ValueError):
        guid_from_bytes(b"\x01" * 15)
    with pytest.raises(ValueError):
        guid_to_bytes("not-a-guid")


# ---------------------------------------------------------------- userAccountControl, pwdLastSet
@pytest.mark.parametrize("uac, disabled", [
    (512, False), (514, True), (66048, False), (66050, True), (None, False),
])
def test_the_accountdisable_bit(uac, disabled):
    assert is_disabled(uac) is disabled


def _filetime(unix_seconds: int, ticks: int = 0) -> int:
    return (unix_seconds + 11_644_473_600) * 10_000_000 + ticks


def test_filetime_counts_from_1601():
    unix_epoch = 116_444_736_000_000_000                # 1970-01-01 as a FILETIME
    assert password_changed_since(unix_epoch + 10_000_000, 0) is True    # 1 s after
    assert password_changed_since(unix_epoch, 0) is False


def test_a_password_set_after_the_token_ends_the_session():
    iat = 1_790_000_000
    assert password_changed_since(_filetime(iat + 5), iat) is True
    assert password_changed_since(_filetime(iat - 5), iat) is False
    assert password_changed_since(_filetime(iat, 5_000_000), iat) is False   # the same second
    assert password_changed_since(None, iat) is False                         # not read
    assert password_changed_since(0, iat) is True                             # must change at next logon


# ---------------------------------------------------------------- typed login forms
AYSE = LdapIdentity(external_id=GUID, username="AYilmaz",
                    dn="CN=Ayşe Yılmaz,OU=Personel,DC=hastane,DC=local",
                    upn="ayilmaz@hastane.local", email="Ayse.Yilmaz@hastane.az")


@pytest.mark.parametrize("key, ok", [
    ("ayilmaz", True), ("hastane\\ayilmaz", True), ("ayilmaz@hastane.local", True),
    ("ayse.yilmaz@hastane.az", True), ("ayilmaz@baska.local", False), ("yilmaz", False),
    ("", False),
    ("x\\ayse.yilmaz@hastane.az", False),       # DOMAIN\ goes with sAMAccountName only
    ("x\\ayilmaz@hastane.local", False),
])
def test_a_login_names_the_account_in_any_allowed_form(key, ok):
    assert login_matches(key, AYSE, LOGIN_ATTRS) is ok


def test_ldap_login_attrs_switch_forms_off():
    assert login_matches("ayilmaz", AYSE, ("userprincipalname",)) is False
    assert login_matches("ayse.yilmaz@hastane.az", AYSE, ("samaccountname",)) is False
    assert login_matches("ayilmaz@hastane.local", AYSE, ("samaccountname", "mail")) is False
    assert login_matches("ayilmaz@hastane.local", AYSE, ("userprincipalname",)) is True


def test_an_account_without_upn_or_mail_answers_to_its_name_only():
    bare = LdapIdentity(external_id=GUID, username="servis", dn="CN=servis,DC=hastane,DC=local")
    assert login_matches("servis", bare, LOGIN_ATTRS) is True
    assert login_matches("servis@hastane.local", bare, LOGIN_ATTRS) is False


@pytest.mark.parametrize("key, name", [
    ("hastane\\ayilmaz", "ayilmaz"), ("ayilmaz@hastane.local", "ayilmaz"), ("ayilmaz", None),
    ("hastane\\", None), ("@hastane.local", None),
])
def test_the_bare_name_inside_a_directory_login(key, name):
    assert directory_login_alternative(key) == name
