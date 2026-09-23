"""Shape checks on the identity tables — no database needed.

These catch the mistakes a migration cannot: a column that the ORM thinks is NOT NULL while
the migration made it nullable, or a table the migration creates that never registered on
Base.metadata (so tests' create_all and Alembic's autogenerate silently disagree).
"""
from __future__ import annotations

from homunculus.auth.models import Group, GroupPermission, LdapGroupMapping, User, UserGroup
from homunculus.auth.models import TenantMembership
from homunculus.db import Base


def test_the_four_rbac_tables_are_registered():
    for name in ("groups", "group_permissions", "user_groups", "ldap_group_mappings"):
        assert name in Base.metadata.tables, name


def test_user_columns_for_login_and_token_versioning():
    cols = User.__table__.c
    assert cols.username.nullable is False and cols.username.unique is True
    assert cols.email.nullable is True
    assert cols.hashed_password.nullable is True
    assert cols.auth_source.nullable is False
    assert cols.external_id.nullable is True and cols.external_id.unique is True
    assert cols.token_version.nullable is False
    assert cols.last_login_at.nullable is True


def test_membership_role_is_now_optional_and_unused():
    assert TenantMembership.__table__.c.role.nullable is True


def test_group_slug_is_unique_per_tenant():
    names = {c.name for c in Group.__table__.constraints}
    assert "uq_groups_tenant_slug" in names


def test_user_group_link_is_keyed_by_user_and_group():
    pk = [c.name for c in UserGroup.__table__.primary_key.columns]
    assert sorted(pk) == ["group_id", "user_id"]
    assert UserGroup.__table__.c.source.default.arg == "manual"


def test_group_permission_is_keyed_by_group_and_permission():
    pk = [c.name for c in GroupPermission.__table__.primary_key.columns]
    assert sorted(pk) == ["group_id", "permission"]


def test_ldap_mapping_is_unique_per_tenant_dn_and_group():
    names = {c.name for c in LdapGroupMapping.__table__.constraints}
    assert "uq_ldap_mapping" in names


def test_indexes_that_the_migration_also_creates():
    user_indexes = {i.name: i for i in User.__table__.indexes}
    assert user_indexes["ix_users_external_id"].unique is True
    assert "ix_user_groups_group_id" in {i.name for i in UserGroup.__table__.indexes}


def test_server_defaults_the_migration_backfill_relies_on():
    assert User.__table__.c.auth_source.server_default.arg == "local"
    assert str(User.__table__.c.token_version.server_default.arg) == "0"
    assert UserGroup.__table__.c.source.server_default.arg == "manual"
    assert Group.__table__.c.mfa_required.server_default is not None
    assert Group.__table__.c.is_system.server_default is not None


def test_the_async_loaders_the_services_rely_on():
    from sqlalchemy import inspect
    assert inspect(Group).relationships["permissions"].lazy == "selectin"
    assert inspect(UserGroup).relationships["group"].lazy == "selectin"
    assert inspect(User).relationships["group_links"].lazy == "raise"
    assert inspect(UserGroup).relationships["user"].lazy == "raise"
