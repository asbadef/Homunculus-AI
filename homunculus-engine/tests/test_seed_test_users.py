"""scripts/seed_test_users.py: one synthetic account per legacy role, each in the ONE group that
role maps to. The trap it must avoid: `seed_bootstrap` always grants `hospital_admin`, so a port
through it would make every test account an administrator."""
from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path

import pytest
from sqlalchemy import func, select

from homunculus.auth.groups import groups_of, set_manual_groups
from homunculus.auth.models import Group, TenantMembership, User, UserGroup
from homunculus.auth.permissions import LEGACY_ROLE_TO_GROUP
from homunculus.auth.seed import seed_bootstrap
from homunculus.auth.service import verify_password
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


seed_script = _load("seed_test_users")

PASSWORD = "Synthetic-Test-Pass-1"   # synthetic, test-only


async def _groups_by_email(db, tenant_id) -> dict[str, list[str]]:
    users = (await db.execute(select(User).where(User.email.like("test.%")))).scalars().all()
    return {u.email: [link.group.slug for link in await groups_of(db, u.id, tenant_id)]
            for u in users}


def test_dev_local_loads_both_seed_scripts_without_running_them():
    """dev_local.py loads the seeders by path; a removed import (UserRole) broke it at load."""
    dev_local = _load("dev_local")
    for name in ("seed_admin", "seed_test_users"):
        module = dev_local._load(name)
        assert inspect.iscoroutinefunction(module.main), name


def test_every_legacy_role_has_one_test_account():
    roles = [role for role, _, _ in seed_script.TEST_USERS]
    assert sorted(roles) == sorted(LEGACY_ROLE_TO_GROUP)
    assert len({local for _, local, _ in seed_script.TEST_USERS}) == len(roles)


@requires_db
async def test_each_account_gets_only_its_roles_group(db_session):
    result = await seed_script.seed_test_users(
        db_session, tenant_slug="demo-hastanesi", domain="homunculus.health",
        shared_password=PASSWORD)

    assert result.tenant_created is True and result.existing == []
    assert len(result.created) == len(seed_script.TEST_USERS)
    tenant = (await db_session.execute(
        select(Tenant).where(Tenant.slug == "demo-hastanesi"))).scalar_one()

    by_email = await _groups_by_email(db_session, tenant.id)
    expected = {f"{local}@homunculus.health": [LEGACY_ROLE_TO_GROUP[role]]
                for role, local, _ in seed_script.TEST_USERS}
    assert by_email == expected
    admins = [email for email, slugs in by_email.items() if "hospital_admin" in slugs]
    assert admins == ["test.yonetici@homunculus.health"]

    users = (await db_session.execute(select(User))).scalars().all()
    for user in users:
        assert user.username == user.email and verify_password(PASSWORD, user.hashed_password)
        membership = (await db_session.execute(select(TenantMembership).where(
            TenantMembership.user_id == user.id))).scalar_one()
        assert membership.tenant_id == tenant.id and membership.is_active and membership.role is None
    mfa = {account.email for account in result.created if account.mfa_required}
    assert mfa == {"test.sorumlu.hekim@homunculus.health", "test.unite.hekimi@homunculus.health",
                   "test.yonetici@homunculus.health", "test.destek@homunculus.health"}


@requires_db
async def test_rerun_leaves_existing_accounts_alone(db_session):
    first = await seed_script.seed_test_users(
        db_session, tenant_slug="demo-hastanesi", domain="homunculus.health",
        shared_password=PASSWORD)
    tenant = (await db_session.execute(select(Tenant))).scalar_one()
    nurse = (await db_session.execute(
        select(User).where(User.email == "test.hemsire@homunculus.health"))).scalar_one()
    auditor = (await db_session.execute(select(Group).where(
        Group.tenant_id == tenant.id, Group.slug == "auditor"))).scalar_one()
    await set_manual_groups(db_session, user=nurse, tenant_id=tenant.id,
                            group_ids={auditor.id}, granted_by_id=None)
    await db_session.commit()

    second = await seed_script.seed_test_users(
        db_session, tenant_slug="demo-hastanesi", domain="homunculus.health",
        shared_password="Another-Synthetic-Pass-2")

    assert second.created == [] and second.tenant_created is False
    assert sorted(second.existing) == sorted(a.email for a in first.created)
    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 12
    assert (await db_session.execute(
        select(func.count(TenantMembership.id)))).scalar_one() == 12
    assert (await db_session.execute(select(func.count(Group.id)))).scalar_one() == 11
    await db_session.refresh(nurse)
    assert verify_password(PASSWORD, nurse.hashed_password)
    assert [l.group.slug for l in await groups_of(db_session, nurse.id, tenant.id)] == ["auditor"]


@requires_db
async def test_joins_the_bootstrapped_tenant_without_touching_its_admin(db_session):
    tenant, admin = await seed_bootstrap(
        db_session, tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi",
        country_code="TR", email="admin@homunculus.health", full_name="Demo Yönetici",
        password="Str0ng-Pass-123")

    result = await seed_script.seed_test_users(
        db_session, tenant_slug="demo-hastanesi", domain="homunculus.health",
        shared_password=PASSWORD)

    assert result.tenant_created is False
    assert (await db_session.execute(select(func.count(Tenant.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Group.id)))).scalar_one() == 11
    admin_group = (await db_session.execute(select(Group).where(
        Group.tenant_id == tenant.id, Group.slug == "hospital_admin"))).scalar_one()
    holders = (await db_session.execute(
        select(User.email).join(UserGroup, UserGroup.user_id == User.id)
        .where(UserGroup.group_id == admin_group.id)
    )).scalars().all()
    assert sorted(holders) == ["admin@homunculus.health", "test.yonetici@homunculus.health"]
    assert [l.group.slug for l in await groups_of(db_session, admin.id, tenant.id)] == [
        "hospital_admin"]
