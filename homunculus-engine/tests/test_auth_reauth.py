# homunculus-engine/tests/test_auth_reauth.py
"""POST /auth/reauth — unlocking the dashboard's locked screen with the session's own password
(plan G1 Wave 2, decision 4). A wrong password is 403, never 401 (a 401 makes the dashboard
refresh and retry, which would send the password to the directory twice). A local account is
checked with bcrypt and locked for 15 minutes after 5 wrong ones; an AD account's unlock is one
bind, counted in the SAME chain as its sign-ins — a locked screen adds no capacity to lock the
account out of the hospital domain — and driven exactly as a sign-in drives it, so the seeded
model of tests/test_directory_bind_invariant.py, which drives the chain as a sign-in does,
covers the unlocks too (test_an_unlock_drives_the_chain_and_the_audit_as_a_sign_in_does). A
wrong current password at /auth/password counts with the local unlocks. Synthetic accounts
only."""
from __future__ import annotations

import asyncio
import time

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.ldap import DIRECTORY_DOWN
from homunculus.auth.limits import (
    DIRECTORY_BIND_MAX_FAILURES, REAUTH_MAX_FAILURES, Ticket, directory_binds,
)
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.router import _DIRECTORY_THROTTLED, _REAUTH_REFUSED
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.fake_directory import (
    AD_PASSWORD, ad_client, ad_world, audit_events, fresh_user,
)

pytestmark = [pytest.mark.asyncio, requires_db]

PASSWORD = "Gizli-123"
CHOSEN = "Kendi-Parolam-9"
REFUSED = _REAUTH_REFUSED
THROTTLED = _DIRECTORY_THROTTLED


async def _headers(db, user, *, mfa_verified=True) -> dict:
    tokens = issue_tokens(user, await build_context(db, user), mfa_verified=mfa_verified)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _reasons(app) -> list[str]:
    return [r.payload["reason"] for r in audit_events(app, "auth", "reauth.fail")]


# ---------------------------------------------------------------- a local account
@pytest_asyncio.fixture
async def local(db_session):
    tenant = Tenant(name="Sentetik", slug="demo-hastanesi", country_code="TR")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    async def make(username, slug, **kw):
        user = User(username=username, email=f"{username}@example.com", full_name="Sentetik",
                    hashed_password=hash_password(PASSWORD), **kw)
        db_session.add(user)
        await db_session.flush()
        db_session.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
        await db_session.flush()
        await set_manual_groups(db_session, user=user, tenant_id=tenant.id,
                                group_ids=[groups[slug].id], granted_by_id=None)
        return user

    nurse = await make("ayse", "nurse")
    attending = await make("dr.kaya", "attending")
    fresh = await make("yeni", "nurse", must_change_password=True)
    await db_session.commit()
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield {"c": c, "app": app, "nurse": nurse, "attending": attending, "fresh": fresh}


async def test_the_right_password_unlocks_and_nothing_else_changes(local, db_session):
    c, nurse = local["c"], local["nurse"]
    before = await fresh_user(db_session, nurse.id)
    res = await c.post("/auth/reauth", headers=await _headers(db_session, nurse),
                       json={"password": PASSWORD})
    assert (res.status_code, res.json()) == (200, {"ok": True})
    after = await fresh_user(db_session, nurse.id)
    assert (after.token_version, after.last_login_at) == (before.token_version,
                                                          before.last_login_at)
    [ok] = audit_events(local["app"], "auth", "reauth.ok")
    assert ok.payload == {"user": "ayse"}


async def test_a_wrong_password_is_403_never_401(local, db_session):
    c, nurse = local["c"], local["nurse"]
    res = await c.post("/auth/reauth", headers=await _headers(db_session, nurse),
                       json={"password": "yanlis"})
    assert (res.status_code, res.json()["detail"]) == (403, REFUSED)
    assert _reasons(local["app"]) == ["bad_credentials"]
    assert "yanlis" not in str([r.payload for r in local["app"].state.audit.records(limit=100)])


async def test_five_wrong_passwords_lock_the_unlock_and_a_right_one_then_waits(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES):
        assert (await c.post("/auth/reauth", headers=headers,
                             json={"password": "yanlis"})).status_code == 403
    for _ in range(2):
        res = await c.post("/auth/reauth", headers=headers, json={"password": PASSWORD})
        assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    # One row marks the lock engaging; the unlocks it refuses write none.
    assert len(audit_events(local["app"], "auth", "reauth.locked")) == 1
    assert _reasons(local["app"]) == ["bad_credentials"] * REAUTH_MAX_FAILURES


async def test_a_right_password_clears_the_count(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES - 1):
        await c.post("/auth/reauth", headers=headers, json={"password": "yanlis"})
    assert (await c.post("/auth/reauth", headers=headers,
                         json={"password": PASSWORD})).status_code == 200
    for _ in range(REAUTH_MAX_FAILURES - 1):
        assert (await c.post("/auth/reauth", headers=headers,
                             json={"password": "yanlis"})).status_code == 403


async def test_wrong_current_passwords_count_with_the_unlocks(local, db_session):
    """/auth/password is the other place a held token can test the password: its wrong current
    passwords count in the same limit. 3 wrong unlocks + 2 wrong current passwords lock both,
    and both then answer 429 before any check."""
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(3):
        assert (await c.post("/auth/reauth", headers=headers,
                             json={"password": "yanlis"})).status_code == 403
    for _ in range(REAUTH_MAX_FAILURES - 3):
        res = await c.post("/auth/password", headers=headers,
                           json={"current_password": "yanlis", "new_password": CHOSEN})
        assert (res.status_code, res.json()["detail"]) == (400, "Mevcut parola yanlış")
    res = await c.post("/auth/password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": CHOSEN})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    res = await c.post("/auth/reauth", headers=headers, json={"password": PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert len(audit_events(local["app"], "auth", "password.change.locked")) == 1
    assert audit_events(local["app"], "auth", "reauth.locked") == []


async def test_a_burst_sent_at_once_tests_no_more_passwords_than_the_limit(local, db_session):
    """A wrong password is counted once bcrypt has answered, so one account's unlocks and
    password changes are checked one at a time: requests sent all at once — at both routes —
    test at most REAUTH_MAX_FAILURES passwords; the rest are refused at the gate (429), their
    passwords never checked. Without that, every request of a burst passed the gate before the
    first answer came back (a review of plan G1 Wave 2, Task 5)."""
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    half = 2 * REAUTH_MAX_FAILURES
    answers = await asyncio.gather(
        *[c.post("/auth/reauth", headers=headers, json={"password": f"yanlis-{i}"})
          for i in range(half)],
        *[c.post("/auth/password", headers=headers,
                 json={"current_password": f"yanlis-{i}", "new_password": CHOSEN})
          for i in range(half)])
    codes = [r.status_code for r in answers]
    assert codes.count(429) == 2 * half - REAUTH_MAX_FAILURES
    assert codes.count(403) + codes.count(400) == REAUTH_MAX_FAILURES
    wrong_current = [r for r in audit_events(local["app"], "auth", "password.change.fail")
                     if r.payload["reason"] == "wrong_current"]
    assert len(_reasons(local["app"])) + len(wrong_current) == REAUTH_MAX_FAILURES
    assert len(audit_events(local["app"], "auth", "reauth.locked")
               + audit_events(local["app"], "auth", "password.change.locked")) == 1


async def test_a_rule_the_new_password_breaks_is_not_a_wrong_password(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES + 1):
        res = await c.post("/auth/password", headers=headers,
                           json={"current_password": "yanlis", "new_password": "kisa"})
        assert res.status_code == 400                    # too short: the current one is not read
    assert (await c.post("/auth/reauth", headers=headers,
                         json={"password": PASSWORD})).status_code == 200


async def test_a_changed_password_clears_the_count(local, db_session):
    c, nurse = local["c"], local["nurse"]
    headers = await _headers(db_session, nurse)
    for _ in range(REAUTH_MAX_FAILURES - 1):
        await c.post("/auth/reauth", headers=headers, json={"password": "yanlis"})
    res = await c.post("/auth/password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": CHOSEN})
    assert res.status_code == 200
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}
    for _ in range(REAUTH_MAX_FAILURES - 1):
        assert (await c.post("/auth/reauth", headers=fresh,
                             json={"password": "yanlis"})).status_code == 403


async def test_an_empty_password_never_reaches_a_check(local, db_session):
    res = await local["c"].post("/auth/reauth", headers=await _headers(db_session, local["nurse"]),
                                json={"password": ""})
    assert res.status_code == 422
    assert _reasons(local["app"]) == []


async def test_it_takes_a_whole_session(local, db_session):
    c = local["c"]
    assert (await c.post("/auth/reauth", json={"password": PASSWORD})).status_code == 401
    pending = await _headers(db_session, local["attending"], mfa_verified=False)
    res = await c.post("/auth/reauth", headers=pending, json={"password": PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (403, "mfa_required")
    res = await c.post("/auth/reauth", headers=await _headers(db_session, local["fresh"]),
                       json={"password": PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (403, "password_change_required")


# ---------------------------------------------------------------- an AD account
@pytest_asyncio.fixture
async def ad(db_session):
    world = await ad_world(db_session)
    async with ad_client(db_session, world["directory"]) as (c, app):
        yield {**world, "c": c, "app": app}


async def _signed_in(ad) -> dict:
    tokens = (await ad["c"].post("/auth/login", json={"login": "ayilmaz",
                                                      "password": AD_PASSWORD})).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _binds(directory) -> int:
    return sum(1 for method, _ in directory.calls if method == "authenticate")


def _record_ends(monkeypatch) -> list[tuple[bool, float]]:
    """Every `directory_binds.end` the route makes, as (failed, pending_s)."""
    ends: list[tuple[bool, float]] = []
    end = directory_binds.end

    def recording(key, ticket, *, failed, pending_s=0.0):
        ends.append((failed, pending_s))
        end(key, ticket, failed=failed, pending_s=pending_s)

    monkeypatch.setattr(directory_binds, "end", recording)
    return ends


async def test_an_ad_account_unlocks_with_one_bind(ad):
    headers = await _signed_in(ad)
    before = _binds(ad["directory"])
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 200
    assert _binds(ad["directory"]) == before + 1


async def test_unlocks_and_sign_ins_share_one_chain_of_failed_binds(ad):
    """2 wrong unlocks + 1 wrong sign-in = the chain's 3: the next sign-in AND the next unlock
    are refused without asking the directory."""
    headers = await _signed_in(ad)
    c, directory = ad["c"], ad["directory"]
    for _ in range(2):
        res = await c.post("/auth/reauth", headers=headers, json={"password": "yanlis"})
        assert (res.status_code, res.json()["detail"]) == (403, REFUSED)
    assert (await c.post("/auth/login", json={"login": "ayilmaz",
                                              "password": "yanlis"})).status_code == 401
    binds = _binds(directory)
    res = await c.post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert (await c.post("/auth/login", json={"login": "ayilmaz",
                                              "password": AD_PASSWORD})).status_code == 429
    assert _binds(directory) == binds                    # neither reached the directory
    assert _reasons(ad["app"]) == ["bad_credentials", "bad_credentials", "throttled"]


async def test_a_directory_that_does_not_answer_is_503_and_counts_no_failure(ad):
    headers = await _signed_in(ad)
    ad["directory"].unavailable = True
    for _ in range(4):                                   # more than the chain allows
        res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
        assert res.status_code == 503
    ad["directory"].unavailable = False
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 200


async def test_a_bind_cut_off_under_way_counts_in_the_chain(ad, monkeypatch):
    """The deadline cut the unlock's bind off once the password had been sent: the domain
    controller may still count it, so the chain does — dated a deadline later, as a sign-in's
    (test_auth_ldap_login). Three such unlocks fill the chain: the fourth is not tried."""
    headers = await _signed_in(ad)
    ends = _record_ends(monkeypatch)
    directory = ad["directory"]
    directory.unavailable, directory.outage_after_bind = "timeout", True
    for _ in range(DIRECTORY_BIND_MAX_FAILURES):
        res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
        assert res.status_code == 503
    assert ends == [(True, directory.deadline)] * DIRECTORY_BIND_MAX_FAILURES
    directory.unavailable = False
    binds = _binds(directory)
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (429, THROTTLED)
    assert _binds(directory) == binds


@pytest.mark.parametrize("bind_attempted, counted", [(True, True), (None, True), (False, False)])
async def test_a_cancelled_unlock_whose_password_was_sent_counts_and_is_audited(
        ad, monkeypatch, bind_attempted, counted):
    """An unlock cut off (the request cancelled) once the password had reached the directory —
    or without the directory saying (counted, fail closed) — is a failed bind AD may count: the
    chain counts it, dated as late as the longest deadline when nothing says otherwise, and the
    audit trail has its row (`cancelled`), written with nothing awaited. One cut off before the
    bind counts for nothing and has no row."""
    headers = await _signed_in(ad)
    ends = _record_ends(monkeypatch)
    entered = asyncio.Event()

    async def hang(external_id, password):
        entered.set()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError as exc:
            if bind_attempted is not None:
                exc.bind_attempted = bind_attempted
            raise

    ad["directory"].authenticate = hang
    task = asyncio.create_task(ad["c"].post("/auth/reauth", headers=headers,
                                            json={"password": "yanlis"}))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [failed for failed, _ in ends] == [counted]
    assert _reasons(ad["app"]) == (["cancelled"] if counted else [])
    assert "yanlis" not in str([r.payload for r in ad["app"].state.audit.records(limit=100)])


async def test_a_directory_fault_that_may_have_sent_the_password_counts_and_is_audited(
        ad, monkeypatch):
    headers = await _signed_in(ad)
    ends = _record_ends(monkeypatch)

    async def broken(external_id, password):
        raise RuntimeError("library bug")

    ad["directory"].authenticate = broken
    with pytest.raises(RuntimeError):
        await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert [failed for failed, _ in ends] == [True]
    assert _reasons(ad["app"]) == ["directory_error"]


async def test_an_account_past_its_ad_end_date_ends_the_session_and_ends_no_run(ad):
    """The directory returns an expired account WITHOUT a bind (`bound` False): 401, and the
    run of failed binds goes on — no bind reset AD's count, whatever the clock here says."""
    headers = await _signed_in(ad)
    key = str(ad["account"].id)
    for _ in range(2):                                   # two wrong passwords, earlier
        ticket = directory_binds.begin(key)
        directory_binds.end(key, ticket, failed=True)
    ad["directory"].update(ad["ayse"].identity.external_id,
                           account_expires=int((time.time() - 60 + 11_644_473_600) * 10_000_000))
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 401
    assert _reasons(ad["app"]) == ["directory_expired"]
    assert len(directory_binds._chains[key].failures) == 2


def _record_chain(monkeypatch) -> list[tuple]:
    """Every call made on `directory_binds` — begin (and whether it gave a place), end,
    succeeded — with its key and keywords; a ticket is shown as "ticket" (its numbers differ)."""
    calls: list[tuple] = []
    for name in ("begin", "end", "succeeded"):
        real = getattr(directory_binds, name)

        def recording(*args, _real=real, _name=name, **kw):
            result = _real(*args, **kw)
            shown = tuple("ticket" if isinstance(a, Ticket) else a for a in args)
            calls.append((_name, shown, tuple(sorted(kw.items())),
                          "ticket" if isinstance(result, Ticket) else result))
            return result

        monkeypatch.setattr(directory_binds, name, recording)
    return calls


def _outcome(ad, what: str) -> str:
    """Make the directory answer the next bind as `what`; the password to send."""
    directory, external_id = ad["directory"], ad["ayse"].identity.external_id
    if what == "cut":
        directory.unavailable, directory.outage_after_bind = "timeout", True
    elif what == "not_sent":
        directory.unavailable, directory.outage_after_bind = "unreachable", False
    elif what == "answered_oddly":
        directory.unavailable, directory.outage_after_bind = "protocol", True
    elif what == "disabled":
        directory.update(external_id, disabled=True)
    elif what == "expired":
        directory.update(external_id,
                         account_expires=int((time.time() - 60 + 11_644_473_600) * 10_000_000))
    elif what == "fault":
        async def broken(external_id, password):
            raise RuntimeError("library bug")
        directory.authenticate = broken
    return "yanlis" if what == "wrong" else AD_PASSWORD


@pytest.mark.parametrize("what", ["wrong", "right", "cut", "not_sent", "answered_oddly",
                                  "disabled", "expired", "fault"])
async def test_an_unlock_drives_the_chain_and_the_audit_as_a_sign_in_does(ad, monkeypatch, what):
    """The same directory answer, once to a sign-in and once to an unlock: the same calls on
    `directory_binds` (so tests/test_directory_bind_invariant.py's model, which drives the
    chain as a sign-in does, covers the unlocks) and the same failure reason in the audit trail
    (`login.fail` for the one, `reauth.fail` for the other)."""
    headers = await _signed_in(ad)
    password = _outcome(ad, what)
    calls = _record_chain(monkeypatch)

    async def ask(path, **kw):
        try:
            return (await ad["c"].post(path, **kw)).status_code
        except RuntimeError:
            return "fault"

    signed = await ask("/auth/login", json={"login": "ayilmaz", "password": password})
    by_sign_in = calls[:]
    calls.clear()
    unlocked = await ask("/auth/reauth", headers=headers, json={"password": password})
    assert calls == by_sign_in
    assert [r.payload["reason"] for r in audit_events(ad["app"], "auth", "reauth.fail")] == \
        [r.payload["reason"] for r in audit_events(ad["app"], "auth", "login.fail")]
    # What differs is the answer: a wrong password at a lock is 403, never 401.
    expected = {"wrong": (401, 403), "right": (200, 200), "cut": (503, 503),
                "not_sent": (503, 503), "answered_oddly": (503, 503), "disabled": (401, 401),
                "expired": (401, 401), "fault": ("fault", "fault")}[what]
    assert (signed, unlocked) == expected


async def test_an_account_disabled_in_ad_ends_the_session(ad):
    headers = await _signed_in(ad)
    ad["directory"].update(ad["ayse"].identity.external_id, disabled=True)
    res = await ad["c"].post("/auth/reauth", headers=headers, json={"password": AD_PASSWORD})
    assert res.status_code == 401
    assert _reasons(ad["app"]) == ["directory_disabled"]


async def test_without_a_directory_an_ad_account_cannot_unlock(db_session):
    world = await ad_world(db_session)
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    account = (await db_session.execute(select(User).where(User.id == world["account"].id))
               ).scalar_one()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        res = await c.post("/auth/reauth", headers=await _headers(db_session, account),
                           json={"password": AD_PASSWORD})
    assert (res.status_code, res.json()["detail"]) == (503, DIRECTORY_DOWN)
