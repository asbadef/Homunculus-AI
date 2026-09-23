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
