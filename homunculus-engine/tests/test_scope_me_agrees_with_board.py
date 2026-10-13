"""`/scope/me` must decide what the BOARD decides, under every scope reason.

The route existed to answer the question a screen has to be able to ask — *why is my board this
size* — and it answered a different one. `scope/router._view` called `build_scope` with the
grants, the role and the own-patient list and **omitted both of the arguments the board's own
resolver passes** (`scope/resolver.make_scope_resolver`): `enforce_unassigned` and
`break_glass_patient_ids`. So on a deployment that had turned enforcement on, an unassigned
clinician was told "your scope is unrestricted" by this route while the board showed her nothing;
and a clinician holding an open break-glass session had its patient omitted here, which is the one
grant that is reason-bound and audited.

These tests are written as an AGREEMENT between the two, not as assertions about the route's
output: each one resolves the scope through the board's resolver and through HTTP and compares
them. That is the property that was broken, and a future change to either side that re-breaks it
fails here rather than in a hospital. Four reasons, one test each: `role`, `assigned`,
`unassigned` (both with enforcement and without) and `break_glass` — and the fifth answer the
resolver gives, `unknown`, for an account with no active membership or no active account here:
`read_role` answers None for it, the resolver turns None into UNKNOWN (sees nothing), and the
route passed the None to `build_scope`, which read it as "unassigned" and, with enforcement off,
UNRESTRICTED — a deactivated nurse reported to her administrator as seeing every patient.

Synthetic staff and one synthetic patient only.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.models import Patient
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.escalation.models import BreakGlassReason, BreakGlassSession
from homunculus.scope import service
from homunculus.scope.models import StaffScope  # noqa: F401  (staff_scopes, before create_all)
from homunculus.scope.resolver import UNKNOWN, break_glass_in_tenant
from homunculus.scope.rules import ScopeReason, build_scope
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def _make_user(db, tenant, groups, username, group_slug, **kw):
    user = User(username=username, email=f"{username}@example.com",
                full_name=username.title(), hashed_password=hash_password("Gizli-123"), **kw)
    db.add(user)
    await db.flush()
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
    await db.flush()
    if group_slug:
        await set_manual_groups(db, user=user, tenant_id=tenant.id,
                               group_ids=[groups[group_slug].id], granted_by_id=None)
    return user


@pytest_asyncio.fixture
async def world(db_session):
    tenant = Tenant(name="Sentetik", slug="sentetik", country_code="AZ")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)
    out = {
        "tenant": tenant, "groups": groups,
        "admin": await _make_user(db_session, tenant, groups, "mudur", "hospital_admin"),
        "nurse": await _make_user(db_session, tenant, groups, "aygun", "nurse"),
    }
    await db_session.commit()
    return out


@pytest_asyncio.fixture
async def client(db_session):
    from homunculus.api.app import create_app

    app = create_app({"bridge-token": "sentetik"}, run_escalation_loop=False)
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.app = app
        yield c


async def _headers(db, user):
    tokens = issue_tokens(user, await build_context(db, user), mfa_verified=True)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _as_the_board_sees_it(db, user, tenant, *, enforce_unassigned):
    """The scope the BOARD's resolver would build for this user, from the same four reads plus the
    two arguments the route used to omit (`scope/resolver.make_scope_resolver`) — and, as the
    resolver does, UNKNOWN for a role of None: no active account or membership here sees nothing."""
    role = await service.read_role(db, user.id, tenant.id)
    if role is None:
        return UNKNOWN
    grants = await service.read_grants(db, user.id, tenant.id)
    return build_scope(
        role,
        unit_ids=[g.unit_id for g in grants if g.unit_id],
        bed_ids=[g.bed_id for g in grants if g.bed_id],
        own_patient_ids=await service.read_own_patient_ids(db, user.id, tenant.id),
        break_glass_patient_ids=await break_glass_in_tenant(db, user.id, tenant.id),
        enforce_unassigned=enforce_unassigned,
    )


def _agree(answer: dict, scope) -> None:
    """Every field of the route's answer against the board's own scope.

    `ScopeView` carries no patient IDENTIFIER (the router's PHI rule), so the own-patient half of
    the agreement is a COUNT — `own_patients`, the figure `Scope.as_dict()` publishes on the
    board's own `scope` block. It is what makes the break-glass case checkable at all: without
    it, "the route passes the break-glass patients to `build_scope`" was a claim the test could
    not see past `reason`.
    """
    assert answer["unrestricted"] is scope.unrestricted, answer
    assert answer["reason"] == scope.reason, answer
    assert sorted(answer["unit_ids"]) == sorted(scope.unit_ids), answer
    assert sorted(answer["bed_ids"]) == sorted(scope.bed_ids), answer
    assert answer["own_patients"] == len(scope.own_patient_ids), answer


async def _me(client, db, user) -> dict:
    res = await client.get("/scope/me", headers=await _headers(db, user))
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------- the four reasons

async def test_an_administrator_is_unrestricted_by_role_and_both_say_so(db_session, world, client):
    answer = await _me(client, db_session, world["admin"])
    assert answer["reason"] == ScopeReason.UNRESTRICTED_ROLE
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["admin"], world["tenant"], enforce_unassigned=False))


async def test_an_assigned_nurse_agrees_with_the_board(db_session, world, client):
    await service.replace_grants(db_session, tenant_id=world["tenant"].id,
                                 user_id=world["nurse"].id,
                                 grants=[("REA-01", ""), ("", "REA-01-2")], granted_by_id=None)
    await db_session.commit()
    answer = await _me(client, db_session, world["nurse"])
    assert answer["reason"] == ScopeReason.ASSIGNED
    assert answer["unrestricted"] is False
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_an_unassigned_nurse_agrees_with_the_board_while_enforcement_is_off(
        db_session, world, client, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    answer = await _me(client, db_session, world["nurse"])
    # Unassigned stays unrestricted until a deployment decides otherwise — and the route says
    # WHY, which is the whole reason it reports a reason at all.
    assert (answer["unrestricted"], answer["reason"]) == (True, ScopeReason.UNASSIGNED)
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_an_unassigned_nurse_agrees_with_the_board_once_enforcement_is_on(
        db_session, world, client, monkeypatch):
    # THE DEFECT. Before the fix this route answered `unrestricted: true` here — "you see
    # everything" — while the board showed this nurse nothing at all.
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    answer = await _me(client, db_session, world["nurse"])
    assert (answer["unrestricted"], answer["reason"]) == (False, ScopeReason.UNASSIGNED)
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=True))


async def test_break_glass_is_the_reason_and_both_say_so(db_session, world, client, monkeypatch):
    # An otherwise unassigned clinician who broke glass: the emergency is the only reason she can
    # see anything, and the route used to omit it entirely.
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    patient = Patient(tenant_id=world["tenant"].id, display_name="Ayşe Sentetik",
                      date_of_birth="1980-01-01", sex="F", his_patient_reference="S-001")
    db_session.add(patient)
    await db_session.flush()
    db_session.add(BreakGlassSession(
        tenant_id=world["tenant"].id, user_id=world["nurse"].id, patient_id=patient.id,
        reason=BreakGlassReason.CARDIAC_ARREST,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
    ))
    await db_session.commit()

    answer = await _me(client, db_session, world["nurse"])
    assert (answer["unrestricted"], answer["reason"]) == (False, ScopeReason.BREAK_GLASS)
    assert answer["own_patients"] == 1            # the one patient the session names, as a count
    assert "S-001" not in json.dumps(answer)      # and never as an identifier
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_a_closed_break_glass_session_grants_nothing_here_either(
        db_session, world, client, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    patient = Patient(tenant_id=world["tenant"].id, display_name="Kamran Sintetik",
                      date_of_birth="1975-05-05", sex="M", his_patient_reference="S-002")
    db_session.add(patient)
    await db_session.flush()
    db_session.add(BreakGlassSession(
        tenant_id=world["tenant"].id, user_id=world["nurse"].id, patient_id=patient.id,
        reason=BreakGlassReason.RAPID_DETERIORATION,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        closed_at=datetime.now(timezone.utc),
    ))
    await db_session.commit()
    answer = await _me(client, db_session, world["nurse"])
    # Back to plain "unassigned": the 30-minute box is the point of break-glass.
    assert answer["reason"] == ScopeReason.UNASSIGNED
    assert answer["own_patients"] == 0
    _agree(answer, await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


# ---------------------------------------------------------------- the administrator's counter

async def test_the_unassigned_count_leaves_out_those_who_need_no_grant(db_session, world, client):
    """`GET /scope/unassigned` is the number that says whether the scope table has ever been
    filled in. It used to count the administrator — unrestricted by role, needing no grant — so
    on a pilot with one administrator it read "1" forever: a permanent "there is work here" about
    a person for whom there is none. Only members who WOULD need a grant are counted."""
    headers = await _headers(db_session, world["admin"])
    res = await client.get("/scope/unassigned", headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["unassigned_users"] == 1          # the nurse; not the administrator

    await service.replace_grants(db_session, tenant_id=world["tenant"].id,
                                 user_id=world["nurse"].id,
                                 grants=[("REA-01", "")], granted_by_id=None)
    await db_session.commit()
    res = await client.get("/scope/unassigned", headers=headers)
    assert res.json()["unassigned_users"] == 0          # and now the table is filled in


# ---------------------------------------------------------------- the administrator's own view

async def test_the_administrator_route_decides_the_same_way(db_session, world, client, monkeypatch):
    """`GET /scope/{user_id}` shares `_view`, so it gains the same correction.

    This is what the administration screen's scope editor reads, and it is the one that would have
    told an administrator "this nurse's scope is unrestricted — nothing to assign here" about a
    nurse whose board was empty.
    """
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    res = await client.get(f"/scope/{world['nurse'].id}",
                           headers=await _headers(db_session, world["admin"]))
    assert res.status_code == 200, res.text
    assert (res.json()["unrestricted"], res.json()["reason"]) == (False, ScopeReason.UNASSIGNED)
    _agree(res.json(), await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=True))


async def test_a_deactivated_account_sees_nothing_here_as_on_the_board(db_session, world, client, monkeypatch):
    """`read_role` answers None for an account that is not active, and the board's resolver turns
    None into UNKNOWN: it sees nothing. `_view` handed the None to `build_scope`, which read it as
    "no assignment" — and, with enforcement off, as UNRESTRICTED. The administrator's own route told
    her a deactivated nurse "sees every patient". The membership stays active, so the route still
    answers rather than 404ing; what it answers is now the board's."""
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    world["nurse"].is_active = False
    await db_session.commit()
    res = await client.get(f"/scope/{world['nurse'].id}",
                           headers=await _headers(db_session, world["admin"]))
    assert res.status_code == 200, res.text
    assert (res.json()["unrestricted"], res.json()["reason"]) == (False, "unknown")
    _agree(res.json(), await _as_the_board_sees_it(
        db_session, world["nurse"], world["tenant"], enforce_unassigned=False))


async def test_an_unknown_user_is_still_not_found(db_session, world, client):
    res = await client.get(f"/scope/{uuid.uuid4()}",
                           headers=await _headers(db_session, world["admin"]))
    assert res.status_code == 404, res.text
