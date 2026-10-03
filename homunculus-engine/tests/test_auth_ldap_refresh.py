"""The refresh of an Active Directory session (spec §7, "Refresh for an AD account"; plan
decision D9). An AD account's credential fingerprint covers only its TOTP secret, so
/auth/refresh reads the account back from the directory: disabled, gone, or a password set after
the session began — 401; otherwise its AD groups are applied at once, so the refreshed token
already carries the current rights. A directory that does not answer, or none configured — the
session goes on unchanged, and the audit trail says so. Synthetic accounts only."""
from __future__ import annotations

import time

import pytest
import pytest_asyncio
from sqlalchemy import update

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, ad_client, ad_world, audit_events, fresh_user, group_dn,
    group_rows,
)

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    return await ad_world(db_session)


@pytest_asyncio.fixture
async def client(db_session, world):
    async with ad_client(db_session, world["directory"]) as pair:
        yield pair


async def _signed_in(c, world, login="ayilmaz", password=AD_PASSWORD) -> dict:
    res = await c.post("/auth/login", json={"login": login, "password": password})
    assert res.status_code == 200, res.text
    world["directory"].calls.clear()
    return res.json()


async def _refresh(c, tokens):
    return await c.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})


def _reasons(app, subject):
    return [r.payload["reason"] for r in audit_events(app, "auth", subject)]


def _filetime(unix_seconds: int) -> int:
    return (unix_seconds + 11_644_473_600) * 10_000_000


async def test_an_unchanged_ad_account_refreshes_after_asking_the_directory(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    assert world["directory"].calls == [
        ("find_by_external_id", world["ayse"].identity.external_id)]
    assert decode_token(res.json()["access_token"])["groups"] == ["nurse"]
    assert _reasons(app, "refresh.fail") == []
    assert len(audit_events(app, "admin", "user.groups")) == 1      # the sign-in's; no change now


async def test_an_account_disabled_in_ad_loses_its_session_at_the_next_refresh(client, world,
                                                                             db_session):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id, disabled=True)
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_disabled"]
    assert (await fresh_user(db_session, world["account"].id)).is_active is True


async def test_a_password_set_in_ad_after_the_session_began_ends_it(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    iat = decode_token(tokens["refresh_token"])["iat"]
    world["directory"].update(world["ayse"].identity.external_id,
                              pwd_last_set=_filetime(iat + 60))
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_password_changed"]


async def test_a_password_set_before_the_session_began_does_not(client, world):
    c, _ = client
    tokens = await _signed_in(c, world)
    iat = decode_token(tokens["refresh_token"])["iat"]
    world["directory"].update(world["ayse"].identity.external_id,
                              pwd_last_set=_filetime(iat - 3600))
    assert (await _refresh(c, tokens)).status_code == 200


async def test_must_change_password_at_next_logon_ends_the_session(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id, pwd_last_set=0)
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_password_changed"]


async def test_an_account_past_its_ad_end_date_loses_its_session_at_the_next_refresh(
        client, world, db_session):
    """accountExpires (off-boarding by an end date) passes the default LDAP_USER_FILTER; the
    refresh must end the session as it does for a disabled account."""
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id,
                              account_expires=_filetime(int(time.time()) - 60))
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_expired"]
    assert (await fresh_user(db_session, world["account"].id)).is_active is True


@pytest.mark.parametrize("ends", ["never (0)", "never (max)", "later"])
async def test_an_account_whose_ad_end_date_has_not_come_keeps_its_session(client, world, ends):
    c, app = client
    tokens = await _signed_in(c, world)
    value = {"never (0)": 0, "never (max)": 0x7FFF_FFFF_FFFF_FFFF,
             "later": _filetime(int(time.time()) + 3600)}[ends]
    world["directory"].update(world["ayse"].identity.external_id, account_expires=value)
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.fail") == []


async def test_an_account_gone_from_the_directory_loses_its_session(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].people.pop(world["ayse"].identity.external_id)
    assert (await _refresh(c, tokens)).status_code == 401
    assert _reasons(app, "refresh.fail") == ["directory_not_found"]


async def test_a_directory_that_does_not_answer_lets_the_session_go_on(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].unavailable = True
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.directory_unavailable") == ["unreachable"]


async def test_no_directory_configured_lets_the_session_go_on(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    app.state.ldap = None
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.directory_unavailable") == ["not_configured"]


async def test_a_local_accounts_refresh_never_asks_the_directory(client, world):
    c, _ = client
    tokens = await _signed_in(c, world, "admin", ADMIN_PASSWORD)
    assert (await _refresh(c, tokens)).status_code == 200
    assert world["directory"].calls == []


# ---------------------------------------------------------------- the group sync at refresh
async def test_a_refresh_after_leaving_the_mapped_ad_group_drops_the_right_at_once(
        client, world, db_session):
    c, app = client
    tokens = await _signed_in(c, world)
    old = {"Authorization": f"Bearer {tokens['access_token']}"}
    world["directory"].update(world["ayse"].identity.external_id, group_dns=())
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    claims = decode_token(res.json()["access_token"])
    assert claims["groups"] == [] and "board.view" not in claims["perms"]
    assert await group_rows(db_session, world["account"].id) == set()
    last = audit_events(app, "admin", "user.groups")[-1]
    assert (last.payload["actor"], last.payload["before"], last.payload["after"]) == (
        "ldap-sync", ["nurse"], [])
    assert (await c.get("/auth/me", headers=old)).status_code == 401    # the old token is retired


async def test_a_refresh_after_joining_a_mapped_ad_group_carries_the_new_right(client, world,
                                                                             db_session):
    c, _ = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id,
                              group_dns=(group_dn("YB-Hemsire"), group_dn("YB-Hekim")))
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    claims = decode_token(res.json()["access_token"])
    assert claims["groups"] == ["nurse", "physician"] and "alerts.escalate" in claims["perms"]
    assert await group_rows(db_session, world["account"].id) == {
        ("nurse", "ldap"), ("physician", "ldap")}


async def test_without_a_local_administrator_an_ad_removal_still_applies_at_refresh(
        client, world, db_session):
    """As at sign-in: in a tenant with no active local administrator, the guard (which counts
    local ones only) has nothing to keep, so an AD-side removal reaches the refreshed token."""
    c, app = client
    tokens = await _signed_in(c, world)
    await db_session.execute(update(User).where(User.id == world["admin"].id)
                             .values(is_active=False))
    await db_session.commit()
    world["directory"].update(world["ayse"].identity.external_id, group_dns=())
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    assert decode_token(res.json()["access_token"])["groups"] == []
    assert await group_rows(db_session, world["account"].id) == set()
    assert audit_events(app, "admin", "ldap.sync.guarded") == []


async def test_a_directory_that_does_not_answer_changes_no_group_at_refresh(client, world,
                                                                          db_session):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].update(world["ayse"].identity.external_id, group_dns=())
    world["directory"].unavailable = True
    res = await _refresh(c, tokens)
    assert res.status_code == 200
    assert decode_token(res.json()["access_token"])["groups"] == ["nurse"]
    assert await group_rows(db_session, world["account"].id) == {("nurse", "ldap")}
    assert len(audit_events(app, "admin", "user.groups")) == 1      # the sign-in's only
    assert _reasons(app, "refresh.directory_unavailable") == ["unreachable"]
