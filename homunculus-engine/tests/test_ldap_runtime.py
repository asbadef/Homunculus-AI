"""The app's handle on the directory (`LdapRuntime`), the start-up check (spec §9), and the
FakeDirectory every LDAP route test stands on — held to the contract Ldap3Directory keeps
(tests/test_ldap3_directory.py)."""
from __future__ import annotations

import logging

import pytest

from homunculus.auth.ldap import LdapUnavailable, check_directory_at_startup
from tests.fake_directory import AD_PASSWORD, FakeDirectory, person, runtime


async def test_the_fake_signs_in_by_guid_and_password_only():
    p = person("AYilmaz")
    directory = FakeDirectory([p])
    eid = p.identity.external_id
    assert await directory.authenticate(eid, AD_PASSWORD) == p.identity
    assert await directory.authenticate(eid, "yanlis") is None
    assert await directory.authenticate(eid, "") is None
    assert await directory.authenticate("00000000-0000-0000-0000-000000000000",
                                        AD_PASSWORD) is None
    assert ("authenticate", eid) in directory.calls
    assert all(AD_PASSWORD not in str(call) for call in directory.calls)


async def test_the_fake_returns_a_disabled_account_without_checking_its_password():
    p = person("Eski", disabled=True)
    found = await FakeDirectory([p]).authenticate(p.identity.external_id, "her-neyse")
    assert found is not None and found.disabled is True


async def test_the_fake_can_be_down():
    directory = FakeDirectory([person("AYilmaz")])
    directory.unavailable = True
    with pytest.raises(LdapUnavailable) as err:
        await directory.search_users("ayse")
    assert err.value.reason == "unreachable"


async def test_a_connection_test_is_remembered():
    rt = runtime(FakeDirectory())
    assert (rt.last_test_at, rt.last_test_ok) == (None, None)
    assert await rt.test() == (True, None)
    assert rt.last_test_ok is True and rt.last_test_at is not None
    rt.directory.unavailable = True
    assert await rt.test() == (False, "unreachable")
    assert (rt.last_test_ok, rt.last_test_reason) == (False, "unreachable")


async def test_the_startup_check_logs_success_and_failure_and_never_raises(caplog):
    rt = runtime(FakeDirectory())
    with caplog.at_level(logging.INFO, logger="homunculus.auth.ldap"):
        await check_directory_at_startup(rt)
        rt.directory.unavailable = True
        await check_directory_at_startup(rt)
    assert "bind to dc1.hastane.local succeeded" in caplog.text
    assert "FAILED (unreachable)" in caplog.text
    assert [r.levelname for r in caplog.records if r.getMessage().startswith("LDAP:")] == \
        ["INFO", "WARNING"]
