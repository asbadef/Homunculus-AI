"""
Which permission guards which route — checked against a table written out by hand.

The table is the plan's Task 7 guard tables and the spec's §5 enforcement table, transcribed; it is
deliberately NOT generated from the code, so a guard that drifts (a wrong key, a dropped guard, a
new unguarded route) fails here instead of shipping. The HTTP tests at the bottom check that the
guards actually admit and refuse by group, end to end through sign-in context and token.

Creating a tenant demands no group permission at all: it is a platform operator's action
(`require_platform_operator`, spec §5), written in the table as the sentinel `PLATFORM`.
"""
from __future__ import annotations

import uuid

import pytest_asyncio
from fastapi import APIRouter, FastAPI
from sqlalchemy import func, select

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import Group
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db
from tests.route_walk import api_routes
from tests.signed_in import add_user, api_client, bearer

GUARDED_MODULES = {
    "homunculus.admission.router",
    "homunculus.escalation.router",
    "homunculus.tenant.router",
}

_S = "structure.manage"

# Not a permission key (keys are dotted lower-case): the route is guarded by
# `require_platform_operator`, which marks itself `.platform_only`.
PLATFORM = frozenset({"<platform operator>"})

EXPECTED: dict[tuple[str, str], frozenset[str]] = {
    # tenant/router.py — the whole physical hierarchy, reads included (spec §5: /tenant/*)
    ("POST", "/tenant/tenants"): PLATFORM,
    ("GET", "/tenant/tenants"): frozenset({_S}),
    ("POST", "/tenant/tenants/{tenant_id}/sites"): frozenset({_S}),
    ("GET", "/tenant/tenants/{tenant_id}/sites"): frozenset({_S}),
    ("POST", "/tenant/sites/{site_id}/units"): frozenset({_S}),
    ("GET", "/tenant/sites/{site_id}/units"): frozenset({_S}),
    ("POST", "/tenant/units/{unit_id}/rooms"): frozenset({_S}),
    ("GET", "/tenant/units/{unit_id}/rooms"): frozenset({_S}),
    ("POST", "/tenant/rooms/{room_id}/beds"): frozenset({_S}),
    ("GET", "/tenant/rooms/{room_id}/beds"): frozenset({_S}),
    ("POST", "/tenant/beds/{bed_id}/transition"): frozenset({_S}),
    # admission/router.py
    ("POST", "/admissions"): frozenset({"admissions.admit"}),
    ("GET", "/admissions"): frozenset({"admissions.view"}),
    ("GET", "/admissions/{admission_id}"): frozenset({"admissions.view"}),
    ("GET", "/admissions/{admission_id}/patient"): frozenset({"admissions.view"}),
    ("GET", "/admissions/{admission_id}/care-team"): frozenset({"admissions.view"}),
    ("POST", "/admissions/{admission_id}/sign-off"): frozenset({"admissions.sign_off"}),
    ("POST", "/admissions/{admission_id}/care-team/claim"): frozenset({"care_team.claim"}),
    ("POST", "/admissions/{admission_id}/care-team"): frozenset({"care_team.assign"}),
    ("POST", "/admissions/{admission_id}/transfer/initiate"):
        frozenset({"admissions.move.initiate"}),
    ("POST", "/admissions/{admission_id}/discharge/initiate"):
        frozenset({"admissions.move.initiate"}),
    ("POST", "/admissions/{admission_id}/transfer/confirm"):
        frozenset({"admissions.transfer.confirm"}),
    ("POST", "/admissions/{admission_id}/discharge/confirm"):
        frozenset({"admissions.discharge.confirm"}),
    ("POST", "/shift-schedule"): frozenset({"shifts.manage"}),
    ("POST", "/handovers"): frozenset({"handover.sign"}),
    ("POST", "/handovers/{handover_id}/sign-outgoing"): frozenset({"handover.sign"}),
    ("POST", "/handovers/{handover_id}/countersign"): frozenset({"handover.sign"}),
    # escalation/router.py
    ("POST", "/alerts"): frozenset({"alerts.escalate"}),
    ("POST", "/alerts/{alert_id}/escalate"): frozenset({"alerts.escalate"}),
    ("POST", "/alerts/{alert_id}/acknowledge"): frozenset({"alerts.ack"}),
    ("POST", "/alerts/{alert_id}/snooze"): frozenset({"alerts.ack"}),
    ("POST", "/break-glass"): frozenset({"break_glass.use"}),
    ("POST", "/break-glass/{session_id}/extend"): frozenset({"break_glass.use"}),
    ("POST", "/break-glass/{session_id}/close"): frozenset({"break_glass.use"}),
}


def _app() -> FastAPI:
    return create_app({"t": "HOSP1"}, run_escalation_loop=False)


def _guards(dependant) -> frozenset[str]:
    """Every key demanded anywhere in the route's dependency tree (`require_permission` records
    its keys on the dependency it returns), plus `PLATFORM` where `require_platform_operator`
    guards it."""
    found: set[str] = set()
    stack = [dependant]
    while stack:
        node = stack.pop()
        found |= getattr(node.call, "permissions", frozenset())
        if getattr(node.call, "platform_only", False):
            found |= PLATFORM
        stack.extend(node.dependencies)
    return frozenset(found)


def _actual() -> dict[tuple[str, str], frozenset[str]]:
    table: dict[tuple[str, str], frozenset[str]] = {}
    for route in api_routes(_app()):
        if route.endpoint.__module__ in GUARDED_MODULES:
            for method in route.methods:
                table[(method, route.path)] = _guards(route.dependant)
    return table


# ---------------------------------------------------------------- the walker itself
def test_the_walker_finds_router_routes_with_their_full_paths():
    paths = {route.path for route in api_routes(_app())}
    assert {"/auth/login", "/tenant/tenants", "/admissions/{admission_id}/sign-off"} <= paths


def test_the_walker_also_reads_plain_routes_on_the_app():
    app = FastAPI()

    @app.get("/plain")
    def plain():
        return {}

    assert [route.path for route in api_routes(app)] == ["/plain"]


def test_the_walker_refuses_an_include_it_cannot_report_in_full():
    router = APIRouter(prefix="/inner")

    @router.get("/x")
    def x():
        return {}

    app = FastAPI()
    app.include_router(router, prefix="/v1")
    try:
        routes = api_routes(app)
    except ValueError:
        return                                  # wrapped include with its own prefix: refused
    assert [route.path for route in routes] == ["/v1/inner/x"]   # a FastAPI that flattens


# ---------------------------------------------------------------- the map
def test_the_table_covers_all_34_guarded_routes():
    assert len(EXPECTED) == 34


def test_no_guarded_route_is_missing_from_the_table():
    assert sorted(set(_actual()) - set(EXPECTED)) == []


def test_no_table_entry_lacks_a_route():
    assert sorted(set(EXPECTED) - set(_actual())) == []


def test_every_guarded_route_demands_a_permission_or_a_platform_operator():
    assert sorted(key for key, guards in _actual().items() if not guards) == []


def test_every_guarded_route_demands_exactly_the_expected_permission():
    actual = _actual()
    wrong = {key: (actual[key], want) for key, want in EXPECTED.items()
             if key in actual and actual[key] != want}
    assert wrong == {}


# ---------------------------------------------------------------- end to end, by group
@pytest_asyncio.fixture
async def guarded(db_session):
    """A tenant with its default groups, one user in each of three groups, a platform operator
    (a vendor-side account in no tenant and no group), and a client. Tokens are minted as sign-in
    does, MFA-verified wherever the group requires MFA."""
    tenant = Tenant(name="Demo", slug="demo-hastanesi", country_code="TR", timezone="UTC")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    auth: dict[str, dict[str, str]] = {}
    for slug in ("hospital_admin", "nurse", "attending"):
        user = await add_user(db_session, username=f"{slug}@example.com", tenant_id=tenant.id,
                              group=groups[slug])
        auth[slug] = await bearer(db_session, user)
    operator = await add_user(db_session, username="operator@example.com",
                              platform_support=True)
    auth["platform"] = await bearer(db_session, operator)

    async with api_client(db_session) as client:
        yield client, auth


NEW_TENANT = {"name": "Yeni Hastane", "slug": "yeni-hastane", "country_code": "TR",
              "timezone": "UTC"}
PLATFORM_ONLY = "Platform operatörü yetkisi gerekli"


@requires_db
async def test_a_nurse_may_not_create_a_tenant(guarded):
    client, auth = guarded
    r = await client.post("/tenant/tenants", json=NEW_TENANT, headers=auth["nurse"])
    assert r.status_code == 403
    assert r.json()["detail"] == PLATFORM_ONLY


@requires_db
async def test_a_hospital_administrator_may_not_create_a_tenant(guarded, db_session):
    """A tenant a hospital administrator created would have no members and could not be
    administered through /admin, which works inside the caller's own tenant only."""
    client, auth = guarded
    r = await client.post("/tenant/tenants", json=NEW_TENANT, headers=auth["hospital_admin"])
    assert r.status_code == 403
    assert r.json()["detail"] == PLATFORM_ONLY
    assert (await db_session.execute(
        select(func.count(Tenant.id)).where(Tenant.slug == "yeni-hastane"))).scalar_one() == 0


@requires_db
async def test_a_platform_operator_creates_a_tenant_with_its_default_groups(guarded, db_session):
    client, auth = guarded
    r = await client.post("/tenant/tenants", json=NEW_TENANT, headers=auth["platform"])
    assert r.status_code == 201, r.text

    created = uuid.UUID(r.json()["id"])
    assert (await db_session.execute(
        select(func.count(Group.id)).where(Group.tenant_id == created))).scalar_one() == 11


@requires_db
async def test_a_duplicate_tenant_slug_is_a_409_not_a_500(guarded, db_session):
    client, auth = guarded
    first = await client.post("/tenant/tenants", json=NEW_TENANT, headers=auth["platform"])
    again = await client.post("/tenant/tenants", json={**NEW_TENANT, "name": "Başka"},
                              headers=auth["platform"])

    assert first.status_code == 201
    assert again.status_code == 409 and "yeni-hastane" in again.json()["detail"]
    assert (await db_session.execute(
        select(func.count(Tenant.id)).where(Tenant.slug == "yeni-hastane"))).scalar_one() == 1


@requires_db
async def test_a_nurse_may_not_sign_off_an_admission(guarded):
    client, auth = guarded
    r = await client.post(f"/admissions/{uuid.uuid4()}/sign-off", headers=auth["nurse"])
    assert r.status_code == 403
    assert r.json()["detail"] == "permission required: admissions.sign_off"


@requires_db
async def test_an_attending_passes_the_sign_off_guard(guarded):
    client, auth = guarded
    r = await client.post(f"/admissions/{uuid.uuid4()}/sign-off", headers=auth["attending"])
    assert r.status_code == 404        # past the guard; the admission does not exist
