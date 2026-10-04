"""Read-only checks against the hospital's real directory (spec §10), run by hand on the VM —
see docs/EDGE-BRIDGE-LOCAL.md, "Active Directory sign-in (optional)". Skipped unless
LDAP_TEST_URL, LDAP_TEST_BIND_DN, LDAP_TEST_BIND_PASSWORD and LDAP_TEST_BASE_DN are set.
Optional, each read like the API's own LDAP_* variable of the same name (empty = the default):
LDAP_TEST_CA_CERT, LDAP_TEST_USER_FILTER, LDAP_TEST_NESTED_GROUPS, LDAP_TEST_TIMEOUT_S,
LDAP_TEST_ALLOW_INSECURE; and LDAP_TEST_QUERY, part of a name the account search should find
(default "a"). It binds and searches; it writes nothing.

The one failed bind is made as the SERVICE account with a wrong password, never as a clinician:
a failed bind counts toward the account's AD lockout, and a test must not move a nurse's counter
(plan decision D16). One run moves the service account's counter by one.

Beyond "it answers", it checks two things that fail SILENTLY in production when they are wrong:
  * the service account can read pwdLastSet and accountExpires — otherwise a password changed or
    an account expired in AD never ends a Homunculus session (the refresh has "no opinion");
  * a group as the mapping picker returns it (`search_groups`) and the same group in a member's
    memberOf have one canonical spelling (`canonical_dn`) — otherwise a mapping made in the
    panel never matches at sign-in, and nobody gets the mapped group's rights."""
from __future__ import annotations

import os
import secrets
import warnings
from dataclasses import replace

import pytest
from ldap3.utils.dn import parse_dn

from homunculus.auth.ldap import LdapConfig, LdapConfigError, LdapIdentity, load_ldap_config
from homunculus.auth.ldap3_directory import (
    Ldap3Directory, _unescape_dn_value, canonical_dn, check_user_filter,
)
from tests.conftest import requires_ldap

pytestmark = requires_ldap

_OPTIONAL = ("LDAP_CA_CERT", "LDAP_USER_FILTER", "LDAP_NESTED_GROUPS", "LDAP_TIMEOUT_S",
             "LDAP_ALLOW_INSECURE")
_MEMBERS_TRIED = 10       # accounts read by GUID while looking for one with groups
_GROUPS_TRIED = 5         # of that account's groups, looked up through the picker


def _config() -> LdapConfig:
    env = {
        "LDAP_URL": os.environ["LDAP_TEST_URL"],
        "LDAP_BIND_DN": os.environ["LDAP_TEST_BIND_DN"],
        "LDAP_BIND_PASSWORD": os.environ["LDAP_TEST_BIND_PASSWORD"],
        "LDAP_BASE_DN": os.environ["LDAP_TEST_BASE_DN"],
        **{name: os.getenv(name.replace("LDAP_", "LDAP_TEST_", 1), "") for name in _OPTIONAL},
    }
    try:
        config = load_ldap_config(env)
        assert config is not None
        check_user_filter(config.user_filter)
    except LdapConfigError as exc:
        pytest.fail(f"the API would leave LDAP OFF with these settings: {exc}")
    return config


def _query() -> str:
    return os.getenv("LDAP_TEST_QUERY") or "a"


@pytest.fixture
def config() -> LdapConfig:
    return _config()


@pytest.fixture
def directory(config):
    directory = Ldap3Directory(config)
    yield directory
    directory.close()


async def _people(directory: Ldap3Directory, limit: int) -> list[LdapIdentity]:
    found = await directory.search_users(_query(), limit=limit)
    assert found, (f"the account search for {_query()!r} found nobody under LDAP_BASE_DN; set "
                   "LDAP_TEST_QUERY to part of a known name")
    return found


async def test_the_service_account_binds(directory):
    await directory.test_connection()


async def test_a_search_finds_people_and_each_reads_back_by_guid(directory):
    found = await _people(directory, 5)
    for identity in found:
        assert len(identity.external_id) == 36 and identity.username and identity.dn
    again = await directory.find_by_external_id(found[0].external_id)
    assert again is not None and again.dn == found[0].dn


async def test_a_wrong_password_is_an_answer_not_an_outage(config, directory):
    wrong = "homunculus-yanlis-" + secrets.token_hex(8)
    assert await directory.check_password(config.bind_dn, wrong) is False


async def test_the_service_account_reads_pwd_last_set_and_account_expires(directory):
    """Read by GUID, as the refresh reads an account. AD keeps both on every user account, so
    "absent on every account found" means the service account may not read them."""
    found = await _people(directory, 5)
    accounts = [a for a in [await directory.find_by_external_id(i.external_id) for i in found]
                if a is not None]
    assert accounts, "none of the accounts found could be read back by objectGUID"
    unread = [attr for attr, field in (("pwdLastSet", "pwd_last_set"),
                                       ("accountExpires", "account_expires"))
              if all(getattr(a, field) is None for a in accounts)]
    assert not unread, (
        f"{' and '.join(unread)} came back for none of the {len(accounts)} account(s) read: the "
        f"service account may not read {'it' if len(unread) == 1 else 'them'}. Homunculus would "
        "then never notice a password changed "
        "(pwdLastSet) or an account expired (accountExpires) in AD — those refresh checks are "
        "silently off. Ask hospital IT to let the service account read pwdLastSet, "
        "accountExpires, userAccountControl and memberOf on user objects.")


def _under(dn: str, base: str) -> bool:
    return dn == base or dn.endswith("," + base)


def _first_value(dn: str) -> str:
    """The text of the DN's first RDN value (a group's cn), escapes resolved."""
    return _unescape_dn_value(parse_dn(dn, escape=False, strip=True)[0][1])


async def test_a_members_group_has_one_spelling_in_memberof_and_in_the_group_picker(config):
    """memberOf as AD stores it (LDAP_NESTED_GROUPS=0, so the raw attribute), against the DN the
    mapping picker shows for the same group. Groups outside LDAP_BASE_DN are left out: the
    picker cannot offer them, and with nested groups on sign-in does not see them either."""
    direct = Ldap3Directory(replace(config, nested_groups=False))
    try:
        base = canonical_dn(config.base_dn)
        member_of: list[str] = []
        for identity in await _people(direct, _MEMBERS_TRIED):
            account = await direct.find_by_external_id(identity.external_id)
            if account is not None and account.group_dns:
                member_of = list(account.group_dns)
                break
        if not member_of:
            pytest.skip(f"none of the first {_MEMBERS_TRIED} accounts found for {_query()!r} "
                        "has a group in memberOf; set LDAP_TEST_QUERY to a member of a group "
                        "that will be mapped")
        unreadable, outside, checked = [], 0, []
        for dn in member_of:
            try:
                key = canonical_dn(dn)
            except ValueError:
                unreadable.append(dn)
                continue
            if not _under(key, base):
                outside += 1
            elif len(checked) < _GROUPS_TRIED:
                checked.append((dn, key))
        if unreadable:
            # Not a failure: only a group that is to be mapped matters, and this test cannot
            # know which ones will be. Shown in the run's warnings summary.
            warnings.warn(
                f"memberOf values that are not a DN Homunculus can read: {unreadable}. A "
                "mapping to such a group cannot be created and never matches at sign-in (a "
                "bare '#' or '=' in a group name does this) — do not plan to map it.",
                stacklevel=1)
        if not checked:
            pytest.skip(f"all {outside} groups of the account found lie outside LDAP_BASE_DN; "
                        "the picker cannot offer them — set LDAP_BASE_DN to cover the groups "
                        "that will be mapped")
        for dn, key in checked:
            picked = await direct.search_groups(_first_value(dn)[:64], limit=50)
            spellings = [group.dn for group in picked]
            assert any(canonical_dn(group.dn) == key for group in picked), (
                f"the group picker does not return memberOf's {dn!r} in the same canonical "
                f"spelling ({key!r}); it returned {spellings}. A mapping made from the picker "
                "would never match this group at sign-in.")
    finally:
        direct.close()
