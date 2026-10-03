"""The refresh of an Active Directory session (spec §7, "Refresh for an AD account"; plan
decision D9). An AD account's credential fingerprint covers only its TOTP secret, so
/auth/refresh reads the account back from the directory: disabled, gone, or a password set after
the session began — 401; otherwise its AD groups are applied at once, so the refreshed token
already carries the current rights. A directory that does not answer, or none configured — the
session goes on unchanged, and the audit trail says so. Synthetic accounts only."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
import pytest_asyncio
from sqlalchemy import update

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, ad_client, ad_world, add_mapping, audit_events, fresh_user,
    group_dn, group_rows,
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


@pytest.mark.parametrize("reason", ["unreachable", "timeout", "tls", "service_bind_rejected"])
async def test_every_kind_of_directory_outage_lets_the_session_go_on(client, world, reason):
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].unavailable = reason
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.directory_unavailable") == [reason]
    assert _reasons(app, "refresh.directory_error") == []


@pytest.mark.parametrize("reason", ["protocol", "a-reason-added-later"])
async def test_a_directory_error_that_is_not_an_outage_renews_nothing(client, world, reason):
    """The outage rule covers a directory that cannot be reached or will not let the service
    account in — nothing about the account. `protocol` also covers a reply about THIS account
    that could not be read (an unexpected library error, a group list over the limit): going on
    unsynced there would keep rights AD may have removed. 503, no tokens: the session neither
    ends nor renews, and the client keeps its refresh token and tries again."""
    c, app = client
    tokens = await _signed_in(c, world)
    world["directory"].unavailable = reason
    res = await _refresh(c, tokens)
    assert (res.status_code, res.json()) == (503, {"detail": "Dizin sunucusuna ulaşılamıyor"})
    assert _reasons(app, "refresh.directory_error") == [reason]
    assert _reasons(app, "refresh.directory_unavailable") == []
    world["directory"].unavailable = False
    assert (await _refresh(c, tokens)).status_code == 200      # the refresh token still holds


async def test_no_directory_configured_lets_the_session_go_on(client, world):
    c, app = client
    tokens = await _signed_in(c, world)
    app.state.ldap = None
    assert (await _refresh(c, tokens)).status_code == 200
    assert _reasons(app, "refresh.directory_unavailable") == ["not_configured"]


@pytest.mark.parametrize("dead_because", ["authenticator_reset", "sessions_revoked",
                                          "deactivated"])
async def test_a_refresh_token_already_dead_here_never_asks_the_directory(client, world,
                                                                          db_session,
                                                                          dead_because):
    """The cheap local checks come first: a token the database already refuses (credential
    fingerprint moved, sessions revoked at a deactivation, account inactive) costs no directory
    round trip and leaves no directory audit row."""
    c, app = client
    tokens = await _signed_in(c, world)
    values = {"authenticator_reset": {"totp_secret": "JBSWY3DPEHPK3PXP"},
              "sessions_revoked": {"sessions_revoked_at": datetime.now(timezone.utc)},
              "deactivated": {"is_active": False}}[dead_because]
    await db_session.execute(update(User).where(User.id == world["account"].id).values(**values))
    await db_session.commit()
    assert (await _refresh(c, tokens)).status_code == 401
    assert world["directory"].calls == []
    assert _reasons(app, "refresh.fail") == []
    assert _reasons(app, "refresh.directory_unavailable") == []


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


async def test_an_account_deactivated_while_the_directory_answers_is_refused_at_refresh(
        client, world, db_session):
    """Plan D7: the connection is released during the directory call and the account re-read
    after it — a deactivation made meanwhile ends the session, and nothing is synced."""
    c, _ = client
    tokens = await _signed_in(c, world)
    directory = world["directory"]
    directory.update(world["ayse"].identity.external_id, group_dns=())
    answer = directory.find_by_external_id

    async def deactivate_then_answer(external_id):
        await db_session.execute(update(User).where(User.id == world["account"].id)
                                 .values(is_active=False))
        await db_session.commit()
        return await answer(external_id)

    directory.find_by_external_id = deactivate_then_answer
    assert (await _refresh(c, tokens)).status_code == 401
    assert await group_rows(db_session, world["account"].id) == {("nurse", "ldap")}


async def test_an_mfa_group_gained_in_ad_holds_the_session_at_the_totp_gate(client, world,
                                                                            db_session):
    """Spec §7, Security: the group MFA flag applies to an AD account as to a local one. A
    refresh that brings an MFA group (YB-Sorumlu -> attending) returns a pending-MFA pair; a
    protected route the group may use answers 403 `mfa_required`; enrolment and verification
    work for an account with no local password; the next refresh stays verified."""
    c, _ = client
    await add_mapping(db_session, world["tenant"].id, group_dn("YB-Sorumlu"),
                      world["groups"]["attending"])
    await db_session.commit()
    tokens = await _signed_in(c, world)
    assert tokens["requires_mfa"] is False
    world["directory"].update(world["ayse"].identity.external_id,
                              group_dns=(group_dn("YB-Hemsire"), group_dn("YB-Sorumlu")))
    res = await _refresh(c, tokens)
    assert res.status_code == 200, res.text
    pending = res.json()
    claims = decode_token(pending["access_token"])
    assert (pending["requires_mfa"], pending["mfa_enrolled"]) == (True, False)
    assert claims["groups"] == ["attending", "nurse"] and claims["mfa_verified"] is False
    held = {"Authorization": f"Bearer {pending['access_token']}"}
    gated = await c.get("/admissions", headers=held)
    assert (gated.status_code, gated.json()["detail"]) == (403, "mfa_required")
    assert (await fresh_user(db_session, world["account"].id)).hashed_password is None
    setup = await c.post("/auth/totp/setup", headers=held)
    assert setup.status_code == 200, setup.text
    secret = parse_qs(urlparse(setup.json()["provisioning_uri"]).query)["secret"][0]
    verified = await c.post("/auth/totp/verify", headers=held,
                            json={"code": pyotp.TOTP(secret).now()})
    assert verified.status_code == 200, verified.text
    assert decode_token(verified.json()["access_token"])["mfa_verified"] is True
    through = {"Authorization": f"Bearer {verified.json()['access_token']}"}
    assert (await c.get("/admissions", headers=through)).status_code == 200
    again = await _refresh(c, verified.json())
    assert again.status_code == 200, again.text
    assert decode_token(again.json()["access_token"])["mfa_verified"] is True


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
