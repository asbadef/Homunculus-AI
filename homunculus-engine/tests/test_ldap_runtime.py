"""The app's handle on the directory (`LdapRuntime`), the start-up check (spec §9), and the
FakeDirectory every LDAP route test stands on — held to the contract Ldap3Directory keeps
(tests/test_ldap3_directory.py)."""
from __future__ import annotations

import logging

import pytest

from homunculus.auth.ldap import LdapGroup, LdapUnavailable, check_directory_at_startup
from tests.fake_directory import AD_PASSWORD, FakeDirectory, group_dn, person, runtime


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


@pytest.mark.parametrize("reason", ["timeout", "tls", "service_bind_rejected", "protocol"])
async def test_the_fake_can_be_down_for_any_reason_the_real_one_names(reason):
    directory = FakeDirectory([person("AYilmaz")])
    directory.unavailable = reason
    with pytest.raises(LdapUnavailable) as err:
        await directory.test_connection()
    assert err.value.reason == reason


@pytest.mark.parametrize("after_bind", [False, True])
async def test_the_fake_says_whether_a_sign_in_outage_came_after_the_password_was_sent(
        after_bind):
    p = person("AYilmaz")
    directory = FakeDirectory([p])
    directory.unavailable, directory.outage_after_bind = "timeout", after_bind
    with pytest.raises(LdapUnavailable) as err:
        await directory.authenticate(p.identity.external_id, AD_PASSWORD)
    assert (err.value.reason, err.value.bind_attempted) == ("timeout", after_bind)
    with pytest.raises(LdapUnavailable) as err:
        await directory.find_by_external_id(p.identity.external_id)
    assert err.value.bind_attempted is False         # only a sign-in binds as the account


async def test_like_the_real_one_the_fake_refuses_bad_input_before_the_server_is_asked():
    """An empty password, a malformed objectGUID or a blank query never reaches the server:
    the answer is the same whether or not the directory is up, and nothing is recorded."""
    p = person("AYilmaz")
    directory = FakeDirectory([p], groups=[LdapGroup(group_dn("YB-Hekim"), "YB-Hekim")])
    directory.unavailable = True
    assert await directory.authenticate(p.identity.external_id, "") is None
    assert await directory.authenticate("not-a-guid", AD_PASSWORD) is None
    assert await directory.find_by_external_id("not-a-guid") is None
    assert await directory.search_users("   ") == []
    assert await directory.search_groups("") == []
    assert directory.calls == []


async def test_like_the_real_one_a_fake_search_reads_no_group_lists():
    p = person("AYilmaz", groups=(group_dn("YB-Hemsire"),))
    [found] = await FakeDirectory([p]).search_users("yilmaz")
    assert found.external_id == p.identity.external_id and found.group_dns == ()


async def test_like_the_real_one_the_fake_caps_a_search_between_1_and_50():
    directory = FakeDirectory([person(f"Kullanici{i:02d}") for i in range(60)],
                              groups=[LdapGroup(group_dn(f"YB-{i:02d}"), f"YB-{i:02d}")
                                      for i in range(60)])
    assert len(await directory.search_users("kullanici", limit=500)) == 50
    assert len(await directory.search_users("kullanici", limit=0)) == 1
    assert len(await directory.search_groups("yb-", limit=500)) == 50
    assert len(await directory.search_groups("yb-", limit=-3)) == 1


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
