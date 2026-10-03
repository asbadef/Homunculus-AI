"""Sign-in of an Active Directory account (spec §7, the LDAP branch of §4) against a
FakeDirectory and the test Postgres: the password goes to the directory once, a wrong one is
401, a directory that does not answer is 503, the profile and the AD-mapped groups follow AD,
and neither the audit trail nor the log ever holds a password. Synthetic accounts only."""
from __future__ import annotations

import asyncio
import logging
import time

import pytest
import pytest_asyncio
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.auth import ldap_sync
from homunculus.auth.groups import lock_admin_guard, set_manual_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.ldap import LdapUnavailable
from homunculus.auth.models import User
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, ad_client, ad_world, add_directory_account, audit_events,
    fresh_user, group_dn, group_rows, person,
)

pytestmark = [pytest.mark.asyncio, requires_db]


@pytest_asyncio.fixture
async def world(db_session):
    return await ad_world(db_session)


@pytest_asyncio.fixture
async def client(db_session, world):
    async with ad_client(db_session, world["directory"]) as pair:
        yield pair


async def _login(c, login, password=AD_PASSWORD):
    return await c.post("/auth/login", json={"login": login, "password": password})


def _reasons(app):
    return [r.payload["reason"] for r in audit_events(app, "auth", "login.fail")]


async def test_an_ad_account_signs_in_with_its_directory_password(client, world, db_session):
    c, app = client
    res = await _login(c, "ayilmaz")
    assert res.status_code == 200, res.text
    body = res.json()
    assert decode_token(body["access_token"])["groups"] == ["nurse"]
    assert body["requires_mfa"] is False
    user = await fresh_user(db_session, world["account"].id)
    assert (user.full_name, user.email, user.ldap_dn) == (
        "Ayşe Yılmaz", "ayse.yilmaz@hastane.az", world["ayse"].identity.dn)
    assert user.last_login_at is not None and user.hashed_password is None
    [ok] = audit_events(app, "auth", "login.ok")
    assert (ok.payload["source"], ok.payload["profile"]) == (
        "ldap", ["email", "full_name", "ldap_dn"])


@pytest.mark.parametrize("login", [
    "ayilmaz", "AYILMAZ", "HASTANE\\ayilmaz", "ayilmaz@hastane.local",
    # A Turkish keyboard: `i` auto-capitalised to `İ`, or a dotless `ı` typed for `i` — in the
    # bare name, and inside the DOMAIN\ and UPN forms (the lookup and login_matches both fold).
    "AYİLMAZ", "ayılmaz", "HASTANE\\AYİLMAZ", "AYİLMAZ@HASTANE.LOCAL",
])
async def test_every_directory_login_form_reaches_the_same_account(client, world, login):
    c, _ = client
    res = await _login(c, login)
    assert res.status_code == 200, (login, res.text)
    assert decode_token(res.json()["access_token"])["sub"] == str(world["account"].id)


async def test_a_lookalike_letter_is_not_folded_into_a_login(client, world):
    """Only the Turkish i's are folded: a fullwidth `Ａ` is another login, refused without asking
    the directory."""
    c, app = client
    assert (await _login(c, "ＡYILMAZ")).status_code == 401
    assert world["directory"].calls == [] and _reasons(app) == ["bad_credentials"]


async def test_the_ad_mail_signs_in_once_the_account_carries_it(client, world):
    c, _ = client
    assert (await _login(c, "ayse.yilmaz@hastane.az")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 200        # copies the mail from AD
    assert (await _login(c, "Ayse.Yilmaz@hastane.az")).status_code == 200


async def test_ldap_login_attrs_switch_a_login_form_off(client, world):
    c, app = client
    app.state.ldap.login_attrs = ("samaccountname",)
    assert (await _login(c, "ayilmaz@hastane.local")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 200
    app.state.ldap.login_attrs = ("userprincipalname",)
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert (await _login(c, "ayilmaz@hastane.local")).status_code == 200


async def test_a_wrong_password_is_401_and_no_password_is_kept_anywhere(client, world, caplog):
    c, app = client
    with caplog.at_level(logging.DEBUG, logger="homunculus"):
        wrong = await _login(c, "ayilmaz", "Yanlis-Parola-9")
        right = await _login(c, "ayilmaz")
    assert (wrong.status_code, right.status_code) == (401, 200)
    assert _reasons(app) == ["bad_credentials"]
    trail = str([r.payload for r in app.state.audit.records(limit=10_000)])
    for secret in ("Yanlis-Parola-9", AD_PASSWORD):
        assert secret not in trail and secret not in caplog.text


async def test_a_directory_that_does_not_answer_is_503_never_401(client, world):
    c, app = client
    world["directory"].unavailable = True
    res = await _login(c, "ayilmaz")
    assert (res.status_code, res.json()["detail"]) == (503, "Dizin sunucusuna ulaşılamıyor")
    assert [(r.payload["reason"], r.tenant) for r in audit_events(app, "auth", "login.fail")] \
        == [("directory_unavailable", "demo-hastanesi")]


async def test_without_a_directory_an_ad_account_gets_503(client, world):
    c, app = client
    app.state.ldap = None
    assert (await _login(c, "ayilmaz")).status_code == 503
    assert _reasons(app) == ["directory_unavailable"]


async def test_an_account_disabled_in_ad_is_refused_and_stays_active_here(client, world,
                                                                        db_session):
    c, app = client
    world["directory"].update(world["ayse"].identity.external_id, disabled=True)
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert _reasons(app) == ["directory_disabled"]
    assert (await fresh_user(db_session, world["account"].id)).is_active is True


def _filetime(unix_seconds: float) -> int:
    return int((unix_seconds + 11_644_473_600) * 10_000_000)


async def test_an_account_past_its_ad_end_date_is_refused_and_stays_active_here(client, world,
                                                                              db_session):
    """accountExpires is how HR often off-boards: an end date, not a disabled flag — and the
    default LDAP_USER_FILTER does not exclude it. Refused like a disabled account, the password
    unchecked (Ldap3Directory makes no bind for it); the local flag is not changed."""
    c, app = client
    world["directory"].update(world["ayse"].identity.external_id,
                              account_expires=_filetime(time.time() - 60))
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    assert _reasons(app) == ["directory_expired"] * 2
    assert (await fresh_user(db_session, world["account"].id)).is_active is True


@pytest.mark.parametrize("ends", ["never (0)", "never (max)", "later"])
async def test_an_account_whose_ad_end_date_has_not_come_signs_in(client, world, ends):
    c, _ = client
    value = {"never (0)": 0, "never (max)": 0x7FFF_FFFF_FFFF_FFFF,
             "later": _filetime(time.time() + 3600)}[ends]
    world["directory"].update(world["ayse"].identity.external_id, account_expires=value)
    assert (await _login(c, "ayilmaz")).status_code == 200


async def test_a_deactivated_account_never_reaches_the_directory(client, world, db_session):
    c, app = client
    await db_session.execute(update(User).where(User.id == world["account"].id)
                             .values(is_active=False))
    await db_session.commit()
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert world["directory"].calls == [] and _reasons(app) == ["inactive"]


async def test_an_account_deactivated_while_the_directory_answers_is_refused(client, world,
                                                                           db_session):
    c, app = client
    directory = world["directory"]
    answer = directory.authenticate

    async def deactivate_then_answer(external_id, password):
        await db_session.execute(update(User).where(User.id == world["account"].id)
                                 .values(is_active=False))
        await db_session.commit()
        return await answer(external_id, password)

    directory.authenticate = deactivate_then_answer
    assert (await _login(c, "ayilmaz")).status_code == 401
    assert _reasons(app) == ["inactive"]


async def test_an_empty_password_never_reaches_the_directory(client, world):
    c, app = client
    assert (await _login(c, "ayilmaz", "")).status_code == 401
    assert world["directory"].calls == [] and _reasons(app) == ["bad_credentials"]


async def test_sign_in_applies_the_ad_group_mapping_and_audits_each_change(client, world,
                                                                         db_session):
    c, app = client
    eid = world["ayse"].identity.external_id
    assert (await _login(c, "ayilmaz")).status_code == 200
    world["directory"].update(eid, group_dns=(group_dn("YB-Hekim"),))
    user = await fresh_user(db_session, world["account"].id)
    await set_manual_groups(db_session, user=user, tenant_id=world["tenant"].id,
                            group_ids=[world["groups"]["charge_nurse"].id], granted_by_id=None)
    await db_session.commit()
    res = await _login(c, "ayilmaz")
    assert decode_token(res.json()["access_token"])["groups"] == ["charge_nurse", "physician"]
    assert await group_rows(db_session, user.id) == {
        ("charge_nurse", "manual"), ("physician", "ldap")}
    assert (await _login(c, "ayilmaz")).status_code == 200            # nothing changes now
    changes = [(r.payload["actor"], r.payload["target"], r.payload["before"], r.payload["after"])
               for r in audit_events(app, "admin", "user.groups")]
    assert changes == [
        ("ldap-sync", str(user.id), [], ["nurse"]),
        ("ldap-sync", str(user.id), ["charge_nurse", "nurse"], ["charge_nurse", "physician"]),
    ]


async def test_without_a_local_administrator_an_ad_removal_still_applies_at_sign_in(
        client, world, db_session):
    """The administrator guard counts LOCAL administrators, which an AD account's sync can never
    lower. A tenant that has none (the last one deactivated outside the API) must still see an
    AD-side removal take effect, not have it rolled back at every sign-in."""
    c, app = client
    assert (await _login(c, "ayilmaz")).status_code == 200
    await db_session.execute(update(User).where(User.id == world["admin"].id)
                             .values(is_active=False))
    await db_session.commit()
    world["directory"].update(world["ayse"].identity.external_id, group_dns=())
    res = await _login(c, "ayilmaz")
    assert res.status_code == 200, res.text
    assert decode_token(res.json()["access_token"])["groups"] == []
    assert await group_rows(db_session, world["account"].id) == set()
    assert audit_events(app, "admin", "ldap.sync.guarded") == []


async def _until_a_session_waits_for_an_advisory_lock(db: AsyncSession) -> None:
    """Return once some database session is queued on an advisory lock (the tenant's admin
    lock); fail after 5 s."""
    for _ in range(250):
        waiting = (await db.execute(text(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
        ))).scalar_one()
        await db.rollback()
        if waiting:
            return
        await asyncio.sleep(0.02)
    raise AssertionError("no session ever waited for the tenant's admin lock")


async def test_a_sign_in_queued_behind_an_admin_write_does_not_deadlock(client, world,
                                                                        db_session):
    """Every writer takes the tenant's admin lock BEFORE it updates an account's row: an /admin
    write holds the lock, then updates the row. A first sign-in has groups to sync, so it waits
    for that lock — and must not hold the account's row meanwhile (the profile update used to
    be flushed first: a deadlock, and a 500 for the sign-in)."""
    c, _ = client
    uid, tid = world["account"].id, world["tenant"].id
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    async with maker() as admin:
        await lock_admin_guard(admin, tid)
        sign_in = asyncio.create_task(_login(c, "ayilmaz"))
        await _until_a_session_waits_for_an_advisory_lock(db_session)
        await admin.execute(update(User).where(User.id == uid).values(full_name="Elle yazıldı"))
        await admin.commit()
    res = await sign_in
    assert res.status_code == 200, res.text
    assert decode_token(res.json()["access_token"])["groups"] == ["nurse"]
    assert (await fresh_user(db_session, uid)).full_name == "Ayşe Yılmaz"   # AD's, written after


async def test_an_ad_mail_taken_by_a_concurrent_sign_in_never_fails_this_one(client, world,
                                                                             db_session,
                                                                             monkeypatch):
    """Plan D11: a sign-in never fails on the e-mail's unique constraint. The check that the
    mail is free and the write are not atomic — two accounts sharing an AD mail can sign in for
    the first time at once. Made deterministic: right after this sign-in's check, another
    session commits the same mail on the other account."""
    c, app = client
    other = world["directory"].add(person("BYilmaz", email="Ayse.Yilmaz@hastane.az"))
    other_account = await add_directory_account(db_session, world["tenant"].id, other)
    await db_session.commit()
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    check = ldap_sync.login_in_use

    async def taken_right_after_the_check(db, value, *, except_id=None):
        in_use = await check(db, value, except_id=except_id)
        async with maker() as concurrent:
            await concurrent.execute(update(User).where(User.id == other_account.id)
                                     .values(email=value))
            await concurrent.commit()
        return in_use

    monkeypatch.setattr(ldap_sync, "login_in_use", taken_right_after_the_check)
    res = await _login(c, "ayilmaz")
    assert res.status_code == 200, res.text
    ayse = await fresh_user(db_session, world["account"].id)
    assert (ayse.email, ayse.full_name) == (None, "Ayşe Yılmaz")    # the rest of the profile
    assert (await fresh_user(db_session, other_account.id)).email == "ayse.yilmaz@hastane.az"
    [ok] = audit_events(app, "auth", "login.ok")
    assert ok.payload["profile"] == ["full_name", "ldap_dn"]


# ---------------------------------------------------------------- timing parity (spec §4)
async def _arrange_failure(case, c, app, world, db):
    """Put the world in the state `case` names; returns the (login, password) to send."""
    directory, eid, uid = world["directory"], world["ayse"].identity.external_id, \
        world["account"].id
    if case == "unknown_login":
        return "kimse", "Yanlis-Parola-9"
    if case == "local_wrong_password":
        return "admin", "Yanlis-Parola-9"
    if case in ("ad_inactive", "ad_without_external_id"):
        values = {"is_active": False} if case == "ad_inactive" else {"external_id": None}
        await db.execute(update(User).where(User.id == uid).values(**values))
        await db.commit()
    elif case == "ad_empty_password":
        return "ayilmaz", ""
    elif case == "ad_wrong_password":
        return "ayilmaz", "Yanlis-Parola-9"
    elif case == "ad_disabled_in_directory":
        directory.update(eid, disabled=True)
    elif case == "ad_expired_in_directory":
        directory.update(eid, account_expires=_filetime(time.time() - 60))
    elif case == "ad_login_form_switched_off":
        app.state.ldap.login_attrs = ("samaccountname",)
        return "ayilmaz@hastane.local", AD_PASSWORD
    elif case == "ad_deactivated_during_the_directory_call":
        answer = directory.authenticate

        async def deactivate_then_answer(external_id, password):
            await db.execute(update(User).where(User.id == uid).values(is_active=False))
            await db.commit()
            return await answer(external_id, password)

        directory.authenticate = deactivate_then_answer
    elif case == "ad_throttled":
        for _ in range(3):
            assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    elif case == "ad_directory_down":
        directory.unavailable = True
    return "ayilmaz", AD_PASSWORD


@pytest.mark.parametrize("case, status, bcrypts", [
    ("unknown_login", 401, 1),
    ("local_wrong_password", 401, 1),
    ("ad_inactive", 401, 1),
    ("ad_without_external_id", 401, 1),
    ("ad_empty_password", 401, 1),
    ("ad_wrong_password", 401, 1),
    ("ad_disabled_in_directory", 401, 1),
    ("ad_expired_in_directory", 401, 1),
    ("ad_login_form_switched_off", 401, 1),
    ("ad_deactivated_during_the_directory_call", 401, 1),
    # The status itself says what the timing would (429: an AD account, throttled; 503: an AD
    # account, directory down): no dummy bcrypt there.
    ("ad_throttled", 429, 0),
    ("ad_directory_down", 503, 0),
])
async def test_every_401_costs_the_bcrypt_an_unknown_login_costs(client, world, db_session,
                                                                  monkeypatch, case, status,
                                                                  bcrypts):
    """Spec §4: response time must not reveal whether the account exists. An AD failure that
    skipped bcrypt answered in ~3 ms against ~200 ms for an unknown login or a local wrong
    password — telling AD accounts, and deactivated ones, apart: a target list for lockout
    attacks. Counted, not timed: each 401 runs exactly the unknown login's dummy comparison."""
    import homunculus.auth.router as auth_router

    c, app = client
    login, password = await _arrange_failure(case, c, app, world, db_session)
    real, ran = auth_router.run_bcrypt, []

    async def counting(fn, *args):
        ran.append((fn.__name__, args[:2]))
        return await real(fn, *args)

    monkeypatch.setattr(auth_router, "run_bcrypt", counting)
    res = await _login(c, login, password)
    assert res.status_code == status, res.text
    dummy = ("verify_local_password", (None, None))
    if case == "local_wrong_password":
        dummy = ("verify_local_password", ("local", world["admin"].hashed_password))
    assert ran == [dummy] * bcrypts


THROTTLED = "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin"


def _binds(directory) -> int:
    return sum(1 for method, _ in directory.calls if method == "authenticate")


async def test_three_failed_binds_throttle_the_account_without_asking_the_directory(client,
                                                                                    world):
    """Each failed bind also counts toward the hospital DOMAIN's lockout: Homunculus must not be
    a way to lock a nurse out of every hospital system."""
    c, app = client
    for _ in range(3):
        assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    asked = _binds(world["directory"])
    for login in ("ayilmaz", "HASTANE\\ayilmaz"):        # the right password, any login form
        res = await _login(c, login)
        assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert _binds(world["directory"]) == asked == 3
    assert _reasons(app) == ["bad_credentials"] * 3 + ["throttled"] * 2
    trail = str([r.payload for r in app.state.audit.records(limit=10_000)])
    assert "Yanlis-Parola-9" not in trail and AD_PASSWORD not in trail


async def test_a_successful_sign_in_resets_the_throttle(client, world):
    c, _ = client
    for _ in range(2):
        assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 200
    for _ in range(2):
        assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 200


async def test_the_throttle_holds_against_concurrent_attempts(client, world):
    c, _ = client
    directory = world["directory"]
    answer = directory.authenticate

    async def slow(external_id, password):
        await asyncio.sleep(0.05)
        return await answer(external_id, password)

    directory.authenticate = slow
    codes = [r.status_code for r in await asyncio.gather(
        *(_login(c, "ayilmaz", "Yanlis-Parola-9") for _ in range(8)))]
    assert sorted(codes) == [401] * 3 + [429] * 5
    assert _binds(directory) == 3


async def test_a_failure_before_the_directory_call_never_holds_a_throttle_place(client, world,
                                                                               monkeypatch):
    """A reserved place is released on every path; one that leaked would throttle the account
    until the next restart."""
    c, _ = client
    rollback = AsyncSession.rollback

    async def broken(self):
        raise RuntimeError("database gone")

    monkeypatch.setattr(AsyncSession, "rollback", broken)
    for _ in range(3):
        with pytest.raises(RuntimeError):
            await _login(c, "ayilmaz")
    monkeypatch.setattr(AsyncSession, "rollback", rollback)
    assert (await _login(c, "ayilmaz")).status_code == 200


@pytest.mark.parametrize("reason, counted", [("timeout", True), ("unreachable", False)])
async def test_an_outage_counts_only_when_a_bind_may_have_been_made(client, world, reason,
                                                                   counted):
    """Cut off at the deadline, the call's thread may still bind — and fail: counted. A domain
    controller that cannot be reached took no bind."""
    c, _ = client

    async def down(external_id, password):
        raise LdapUnavailable(reason)

    world["directory"].authenticate = down
    codes = [(await _login(c, "ayilmaz")).status_code for _ in range(4)]
    assert codes == [503, 503, 503, 429 if counted else 503]


async def test_another_ad_account_is_not_throttled(client, world, db_session):
    c, _ = client
    other = world["directory"].add(person("BKaya"))
    await add_directory_account(db_session, world["tenant"].id, other)
    await db_session.commit()
    for _ in range(3):
        assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    assert (await _login(c, "ayilmaz")).status_code == 429
    assert (await _login(c, "bkaya")).status_code == 200


async def test_a_local_account_has_no_throttle(client, world):
    c, app = client
    for _ in range(5):
        assert (await _login(c, "admin", "Yanlis-Parola-9")).status_code == 401
    assert (await _login(c, "admin", ADMIN_PASSWORD)).status_code == 200
    assert "throttled" not in _reasons(app)


async def test_an_unknown_directory_shaped_login_is_a_plain_401(client, world):
    c, app = client
    for login in ("kimse@hastane.local", "HASTANE\\kimse"):
        assert (await _login(c, login)).status_code == 401
    assert world["directory"].calls == []
    assert {(r.payload["reason"], r.tenant) for r in audit_events(app, "auth", "login.fail")} \
        == {("bad_credentials", "-")}


async def test_a_local_account_never_reaches_the_directory(client, world):
    c, _ = client
    assert (await _login(c, "admin", ADMIN_PASSWORD)).status_code == 200
    assert world["directory"].calls == []


async def test_a_upn_shaped_login_never_falls_back_to_a_local_account(client, world):
    c, _ = client
    assert (await _login(c, "admin@baska.local", ADMIN_PASSWORD)).status_code == 401
