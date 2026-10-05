"""Sign-in of an Active Directory account (spec §7, the LDAP branch of §4) against a
FakeDirectory and the test Postgres: the password goes to the directory once, a wrong one is
401, a directory that does not answer is 503, the profile and the AD-mapped groups follow AD,
and neither the audit trail nor the log ever holds a password. Synthetic accounts only."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid

import pytest
import pytest_asyncio
from ldap3.core.exceptions import LDAPResponseTimeoutError
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.auth import ldap_sync
from homunculus.auth.groups import lock_admin_guard, set_manual_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.ldap import DEADLINE_CAP_S, load_ldap_config
from homunculus.auth.ldap3_directory import Ldap3Directory
from homunculus.auth.limits import directory_binds
from homunculus.auth.models import User
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ADMIN_PASSWORD, DOMAIN_DN, ad_client, ad_world, add_directory_account,
    audit_events, fresh_user, group_dn, group_rows, person,
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


async def test_a_clock_stepping_back_across_the_end_date_never_ends_a_run_without_a_bind(
        client, world, monkeypatch):
    """The directory finds her account past its end date and returns it WITHOUT a bind; then
    the server's clock steps back across that date (an NTP correction) before the route reads
    the answer. Only the directory knows whether her bind was made (`LdapIdentity.bound`): the
    route does not end her run of failed binds — no bind reset AD's count — and does not sign
    her in."""
    c, app = client
    expires = time.time() - 60
    world["directory"].update(world["ayse"].identity.external_id,
                              account_expires=_filetime(expires))
    key = str(world["account"].id)
    for _ in range(2):                                   # two wrong passwords, earlier
        ticket = directory_binds.begin(key)
        directory_binds.end(key, ticket, failed=True)
    ended: list[str] = []
    succeeded = directory_binds.succeeded

    def recording(slot, ticket):
        ended.append(slot)
        succeeded(slot, ticket)

    monkeypatch.setattr(directory_binds, "succeeded", recording)
    stepped_back = type("Clock", (), {"time": staticmethod(lambda: expires - 3600),
                                      "monotonic": staticmethod(time.monotonic)})
    import homunculus.auth.router as auth_router
    monkeypatch.setattr(auth_router, "time", stepped_back)
    res = await _login(c, "ayilmaz")                     # her right password, never sent
    assert res.status_code == 401, res.text
    assert _reasons(app) == ["directory_expired"]
    assert ended == []
    assert len(directory_binds._chains[key].failures) == 2


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


def _held(monkeypatch, *readings: float) -> list[float]:
    """Stand-ins for the sign-in route's clock (`readings`, then the last one again) and sleep;
    returns the list each requested sleep is appended to."""
    import homunculus.auth.router as auth_router

    clock, slept = list(readings), []

    async def sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(auth_router, "_now", lambda: clock.pop(0) if len(clock) > 1 else clock[0])
    monkeypatch.setattr(auth_router, "_sleep", sleep)
    return slept


@pytest.mark.parametrize("case, status", [
    ("unknown_login", 401),
    ("local_wrong_password", 401),
    ("ad_inactive", 401),
    ("ad_empty_password", 401),
    ("ad_wrong_password", 401),
    ("ad_disabled_in_directory", 401),
    ("ad_deactivated_during_the_directory_call", 401),
    ("ad_throttled", 429),
    ("ad_directory_down", 503),
    ("signs_in", 200),
])
async def test_every_401_is_held_to_the_floor_and_nothing_else_is(client, world, db_session,
                                                                   monkeypatch, case, status):
    """Spec §4: timing must not tell an AD account — round trips to the domain controller —
    from an unknown or a local login. Every 401 answers no sooner than LOGIN_FAILURE_FLOOR_S
    after the request reached the route, by a sleep (no CPU); a success, a 429 and a 503 are
    never held. The clock stands still here, so a 401 asks for the whole floor."""
    from homunculus.auth.router import LOGIN_FAILURE_FLOOR_S

    c, app = client
    login, password = await _arrange_failure(case, c, app, world, db_session)
    slept = _held(monkeypatch, 100.0)
    res = await _login(c, login, password)
    assert res.status_code == status, res.text
    assert slept == ([LOGIN_FAILURE_FLOOR_S] if status == 401 else [])


@pytest.mark.parametrize("elapsed", [0.0, 0.2, 0.49, 0.5, 3.0])
async def test_the_floor_counts_from_the_start_of_the_request(client, world, monkeypatch,
                                                              elapsed):
    from homunculus.auth.router import LOGIN_FAILURE_FLOOR_S

    assert 0 < LOGIN_FAILURE_FLOOR_S <= 1          # far below the dashboard's 15 s timeout
    c, _ = client
    slept = _held(monkeypatch, 100.0, 100.0 + elapsed)
    assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    rest = LOGIN_FAILURE_FLOOR_S - elapsed
    assert slept == ([pytest.approx(rest)] if rest > 0 else [])
    assert elapsed + sum(slept) >= LOGIN_FAILURE_FLOOR_S - 1e-9


@pytest.mark.parametrize("case", [
    "unknown_login", "local_wrong_password", "ad_inactive", "ad_wrong_password",
    "ad_deactivated_during_the_directory_call",
])
async def test_the_floor_is_slept_without_a_database_connection(client, world, db_session,
                                                                monkeypatch, case):
    """A refused sign-in waits out the floor with its database connection back in the pool
    (nothing is written on a 401 path): a burst of wrong passwords at shift change must not
    pin the pool for LOGIN_FAILURE_FLOOR_S each. Counted in the pool itself, at the moment the
    route sleeps."""
    import homunculus.auth.router as auth_router

    c, app = client
    login, password = await _arrange_failure(case, c, app, world, db_session)
    held: list[int] = []

    async def sleep(seconds):
        held.append(db_session.bind.pool.checkedout() - baseline)

    monkeypatch.setattr(auth_router, "_now", lambda: 100.0)      # the clock stands still
    monkeypatch.setattr(auth_router, "_sleep", sleep)
    baseline = db_session.bind.pool.checkedout()
    res = await _login(c, login, password)
    assert res.status_code == 401, res.text
    assert held == [0]


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


async def test_wrong_passwords_failing_while_the_right_one_is_checked_stay_counted(client, world):
    """The clinician signs in — the directory slow to answer her — while two wrong passwords
    for her account fail. Their binds may have reached the domain controller after hers, and
    AD counts them after the reset her bind made: her success does not forget them. One more
    wrong password reaches the directory, then 429."""
    c, app = client
    directory = world["directory"]
    answer = directory.authenticate
    asked, gate = asyncio.Event(), asyncio.Event()

    async def slow_for_the_right_one(external_id, password):
        if password == AD_PASSWORD:
            asked.set()
            await gate.wait()
        return await answer(external_id, password)

    directory.authenticate = slow_for_the_right_one
    right = asyncio.create_task(_login(c, "ayilmaz"))
    await asyncio.wait_for(asked.wait(), 5)
    for _ in range(2):
        assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 429   # hers runs
    gate.set()
    assert (await right).status_code == 200
    assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 401
    assert (await _login(c, "ayilmaz", "Yanlis-Parola-9")).status_code == 429
    assert _binds(directory) == 4                    # hers and three wrong ones


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


@pytest.mark.parametrize("reason, after_bind", [
    ("timeout", False),        # the service bind or the search cut off, or queued: none sent
    ("protocol", False),       # a search reply that made no sense, a group list over the limit
    ("unreachable", False),
    ("timeout", True),         # the bind as the account cut off: AD may count it
    ("protocol", True),        # the bind as the account answered with an unexpected code
])
async def test_an_outage_counts_only_when_the_password_was_sent(client, world, reason,
                                                                after_bind):
    """A clinician who retried through a domain controller blip, the password never sent, must
    not be refused for 15 minutes; an outage once the bind as the account had started may have
    cost an attempt in AD's lockout count, and is counted (fail closed)."""
    c, _ = client
    directory = world["directory"]
    directory.unavailable, directory.outage_after_bind = reason, after_bind
    codes = [(await _login(c, "ayilmaz")).status_code for _ in range(4)]
    assert codes == [503, 503, 503, 429 if after_bind else 503]
    directory.unavailable = False
    assert (await _login(c, "ayilmaz")).status_code == (429 if after_bind else 200)


@pytest.mark.parametrize("bind_attempted, counted", [(False, False), (True, True), (None, True)])
async def test_a_cancelled_sign_in_counts_only_when_the_password_was_sent(client, world,
                                                                         bind_attempted,
                                                                         counted):
    """The request cut off while the directory works: counted only when the directory says the
    bind as the account had started (Ldap3Directory marks the cancellation); a cancellation it
    did not mark is counted (None: fail closed)."""
    c, _ = client
    entered = asyncio.Event()

    async def hang(external_id, password):
        entered.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError as exc:
            if bind_attempted is not None:
                exc.bind_attempted = bind_attempted
            raise

    world["directory"].authenticate = hang
    for _ in range(3):
        entered.clear()
        task = asyncio.create_task(_login(c, "ayilmaz"))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    del world["directory"].authenticate                   # the directory answers again
    assert (await _login(c, "ayilmaz")).status_code == (429 if counted else 200)


@pytest.mark.parametrize("bind_attempted, audited", [(True, True), (None, True), (False, False)])
async def test_a_cancelled_sign_in_whose_password_was_sent_is_audited(client, world, monkeypatch,
                                                                     bind_attempted, audited):
    """A sign-in cut off (the request cancelled) once her password had reached the directory —
    or without the directory saying (counted, fail closed) — is a failed bind AD may count. It
    gets its `login.fail` row like any other, `reason` "cancelled", under her hospital, so the
    runbook's look at the last 15 minutes before a restart sees it. The row is written with
    nothing awaited: it is there even when every await after the cancellation is cancelled
    again (as anyio's cancel scopes do). One cut off before the bind counts for nothing in AD
    or the throttle, and has no row."""
    import homunculus.auth.router as auth_router

    c, app = client
    entered = asyncio.Event()
    cancelled = False
    lookup = auth_router.tenant_of_user

    async def cancelled_again_after_the_cancellation(db, user_id):
        if cancelled:
            raise asyncio.CancelledError
        return await lookup(db, user_id)

    monkeypatch.setattr(auth_router, "tenant_of_user", cancelled_again_after_the_cancellation)

    async def hang(external_id, password):
        nonlocal cancelled
        entered.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError as exc:
            cancelled = True
            if bind_attempted is not None:
                exc.bind_attempted = bind_attempted
            raise

    world["directory"].authenticate = hang
    task = asyncio.create_task(_login(c, "ayilmaz", "Yanlis-Parola-9"))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    rows = [(r.payload, r.tenant) for r in audit_events(app, "auth", "login.fail")]
    assert rows == ([({"login": "ayilmaz", "reason": "cancelled"}, "demo-hastanesi")]
                    if audited else [])
    assert "Yanlis-Parola-9" not in str([r.payload for r in app.state.audit.records()])


async def test_a_directory_fault_that_may_have_sent_the_password_is_audited(client, world):
    """Not an outage the directory reported but a fault (a bug): the bind may have been made, so
    the throttle counts it (fail closed) and the audit trail has its row, `directory_error`."""
    c, app = client

    async def broken(external_id, password):
        raise RuntimeError("library bug")

    world["directory"].authenticate = broken
    with pytest.raises(RuntimeError):
        await _login(c, "ayilmaz")
    assert _reasons(app) == ["directory_error"]


async def test_a_wrong_password_is_audited_before_anything_is_awaited(client, world,
                                                                    monkeypatch):
    """Every failed bind the throttle counts is audited at once: a sign-in cancelled during the
    dummy bcrypt that follows a wrong password still leaves its `bad_credentials` row."""
    import homunculus.auth.router as auth_router

    c, app = client

    async def cancelled(fn, *args):
        raise asyncio.CancelledError

    monkeypatch.setattr(auth_router, "run_bcrypt", cancelled)
    with pytest.raises(asyncio.CancelledError):
        await _login(c, "ayilmaz", "Yanlis-Parola-9")
    assert _reasons(app) == ["bad_credentials"]


def _record_ends(monkeypatch) -> list[tuple[bool, float]]:
    """Every `directory_binds.end` the route makes, as (failed, pending_s)."""
    ends: list[tuple[bool, float]] = []
    end = directory_binds.end

    def recording(key, ticket, *, failed, pending_s=0.0):
        ends.append((failed, pending_s))
        end(key, ticket, failed=failed, pending_s=pending_s)

    monkeypatch.setattr(directory_binds, "end", recording)
    return ends


@pytest.mark.parametrize("reason, pending", [
    ("timeout", True), ("unreachable", True), ("protocol", False),
])
async def test_a_bind_cut_off_under_way_is_dated_as_late_as_the_dc_may_count_it(
        client, world, monkeypatch, reason, pending):
    """The deadline cut the bind as the account off once the password had been sent: the
    domain controller has not answered and may still count it, up to a deadline later — the
    failure is dated then (`bind_pending_s`), so the run lasts 15 minutes from that. A bind the
    directory answered (an unexpected code) is dated when it answered."""
    c, _ = client
    ends = _record_ends(monkeypatch)
    directory = world["directory"]
    directory.unavailable, directory.outage_after_bind = reason, True
    assert (await _login(c, "ayilmaz")).status_code == 503
    assert ends == [(True, directory.deadline if pending else 0.0)]


class _HerBindGoesUnanswered:
    """ldap3's connection as Ldap3Directory uses it, scripted: the service account binds and
    finds `whom` by objectGUID; `whom`'s own bind goes out and ldap3's receive timeout gives up
    on its answer — the domain controller has the request and has not answered."""
    socket = None

    def __init__(self, whom, user: str) -> None:
        self.whom, self.user = whom.identity, user
        self.result: dict = {}
        self.response: list = []

    def open(self, read_server_info=True):
        pass

    def bind(self):
        if self.user == self.whom.dn:
            raise LDAPResponseTimeoutError("no answer")
        self.result = {"result": 0}
        return True

    def search(self, **request):
        self.response = [{"type": "searchResEntry", "dn": self.whom.dn, "raw_attributes": {
            "objectGUID": [uuid.UUID(self.whom.external_id).bytes_le],
            "sAMAccountName": [self.whom.username.encode("utf-8")]}}]
        self.result = {"result": 0}
        return True

    def unbind(self):
        pass


async def test_a_bind_whose_answer_ldap3_stopped_waiting_for_is_dated_a_deadline_later(
        db_session, world):
    """The real Ldap3Directory: her bind reached the domain controller, which did not answer
    before ldap3's receive timeout. The DC may still count it — up to a deadline later — so
    the route records the failure dated then (her run lasts 15 minutes from that, not from
    now), and the 503 goes to the audit trail as a sign-in failure."""
    config = load_ldap_config({
        "LDAP_URL": "ldaps://dc1.hastane.local", "LDAP_BIND_DN": f"CN=svc,{DOMAIN_DN}",
        "LDAP_BIND_PASSWORD": "Servis-1", "LDAP_BASE_DN": DOMAIN_DN,
        "LDAP_NESTED_GROUPS": "0"})
    directory = Ldap3Directory(config, connect=lambda user, password: _HerBindGoesUnanswered(
        world["ayse"], user))
    try:
        async with ad_client(db_session, directory) as (c, app):
            before = time.monotonic()
            res = await _login(c, "ayilmaz", "Yanlis-Parola-9")
            after = time.monotonic()
    finally:
        directory.close()
    assert res.status_code == 503
    assert _reasons(app) == ["directory_unavailable"]
    chain = directory_binds._chains[str(world["account"].id)]
    assert len(chain.failures) == 1
    assert before + config.deadline_s <= chain.last <= after + config.deadline_s


@pytest.mark.parametrize("marks, recorded", [
    ({"bind_attempted": True, "bind_pending_s": 7.5}, (True, 7.5)),
    ({"bind_attempted": False, "bind_pending_s": 0.0}, (False, 0.0)),
    ({}, (True, DEADLINE_CAP_S)),            # unmarked: counted, as late as any deadline
])
async def test_a_cancelled_sign_in_is_dated_as_its_directory_marked_it(client, world,
                                                                      monkeypatch, marks,
                                                                      recorded):
    c, _ = client
    ends = _record_ends(monkeypatch)
    entered = asyncio.Event()

    async def hang(external_id, password):
        entered.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError as exc:
            for name, value in marks.items():
                setattr(exc, name, value)
            raise

    world["directory"].authenticate = hang
    task = asyncio.create_task(_login(c, "ayilmaz"))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert ends == [recorded]


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
