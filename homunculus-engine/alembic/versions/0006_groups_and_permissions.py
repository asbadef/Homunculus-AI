# homunculus-engine/alembic/versions/0006_groups_and_permissions.py
"""groups and permissions (RBAC); users columns for LDAP sign-in and token versioning

Creates `groups`, `group_permissions`, `user_groups`, `ldap_group_mappings`; adds `username`,
`auth_source`, `external_id`, `ldap_dn`, `token_version`, `last_login_at` to `users`; makes
`users.email`, `users.hashed_password` and `tenant_memberships.role` nullable; seeds the default
groups for every existing tenant; converts every active membership's legacy role into a
`user_groups` row.

ONE STATEMENT PER op.execute / bind.execute: migrations run through the async engine and asyncpg
prepares every statement, so a string holding several statements fails (see 0004).

DOWNGRADE IS LOSSY BY DESIGN: it drops the group tables and restores `role NOT NULL`. It cannot
rebuild roles from groups, and it fails if any user has no password (an AD account) or any
membership has a NULL role. Back the database up before `upgrade` (runbook: pg_dump). The
downgrade also fails restoring `email SET NOT NULL` if an AD account was created with no e-mail
in the meantime. An INACTIVE membership keeps its legacy `role` value but gets no `user_groups`
row; reactivating it later grants no rights until an administrator assigns a group — this is
intended, not a bug. Offline generation (`alembic upgrade --sql`) is not supported: seeding the
default groups reads the `tenants` table at migration time.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23
"""
from __future__ import annotations

import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------------------------
# FROZEN COPY of homunculus.auth.permissions.DEFAULT_GROUPS / LEGACY_ROLE_TO_GROUP as of 0006.
# Deliberately not imported: a migration must produce the same schema forever, while the live
# defaults may change. tests/test_migration_0006_defaults.py pins the two together at authoring.
# ---------------------------------------------------------------------------------------------
_ALL = (
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.admit",
    "admissions.sign_off", "admissions.move.initiate", "admissions.transfer.confirm",
    "admissions.discharge.confirm",
    "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
    "break_glass.use", "audit.view", "users.manage", "groups.manage", "structure.manage",
    "devices.manage",
)
_ATTENDING = (
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.sign_off",
    "admissions.move.initiate", "care_team.claim", "care_team.assign", "handover.sign",
    "break_glass.use",
)
_DEFAULT_GROUPS = (
    {"slug": "hospital_admin", "name": "Sistem Yöneticisi",
     "description": "Kullanıcı, grup, yapı ve cihaz yönetimi; denetim kaydı.",
     "mfa_required": True, "is_system": True, "permissions": _ALL},
    {"slug": "attending", "name": "Sorumlu Hekim",
     "description": "Kabul onayı, transfer/taburcu başlatma, bakım ekibi atama.",
     "mfa_required": True, "is_system": False, "permissions": _ATTENDING},
    {"slug": "unit_physician", "name": "Ünite Hekimi",
     "description": "Kabul onayı ve transfer/taburcu başlatma; bakım ekibi atamaz.",
     "mfa_required": True, "is_system": False,
     "permissions": tuple(p for p in _ATTENDING if not p.startswith("care_team."))},
    {"slug": "physician", "name": "Hekim",
     "description": "Pano, alarm onayı ve eskalasyon, devir imzası, break-glass.",
     "mfa_required": False, "is_system": False,
     "permissions": ("board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                     "handover.sign", "break_glass.use")},
    {"slug": "charge_nurse", "name": "Sorumlu Hemşire",
     "description": "Hasta kabul, transfer/taburcu onayı, nöbet çizelgesi, bakım ekibi.",
     "mfa_required": False, "is_system": False,
     "permissions": ("board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                     "admissions.admit", "admissions.transfer.confirm",
                     "admissions.discharge.confirm", "care_team.claim", "handover.sign",
                     "shifts.manage", "break_glass.use")},
    {"slug": "nurse", "name": "Hemşire",
     "description": "Pano, alarm onayı, hasta kabul, devir imzası.",
     "mfa_required": False, "is_system": False,
     "permissions": ("board.view", "alerts.ack", "admissions.view", "admissions.admit",
                     "admissions.transfer.confirm", "handover.sign")},
    {"slug": "rapid_response", "name": "Hızlı Yanıt Ekibi",
     "description": "Pano, alarm onayı ve eskalasyon, break-glass.",
     "mfa_required": False, "is_system": False,
     "permissions": ("board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                     "break_glass.use")},
    {"slug": "auditor", "name": "Denetçi",
     "description": "Salt okunur: pano ve denetim kaydı.",
     "mfa_required": False, "is_system": False, "permissions": ("board.view", "audit.view")},
    {"slug": "platform_support", "name": "Üretici Destek",
     "description": "Üretici tarafı destek: denetim kaydı ve cihaz uç noktaları.",
     "mfa_required": True, "is_system": False, "permissions": ("audit.view", "devices.manage")},
    {"slug": "pharmacist", "name": "Eczacı",
     "description": "Pano ve kabul kayıtlarını okuma.",
     "mfa_required": False, "is_system": False, "permissions": ("board.view", "admissions.view")},
    {"slug": "biomedical", "name": "Biyomedikal Teknisyen",
     "description": "Cihaz ve araştırma uç noktaları.",
     "mfa_required": False, "is_system": False, "permissions": ("devices.manage",)},
)
_LEGACY = {
    "HOSPITAL_ADMIN": "hospital_admin",
    "ATTENDING": "attending",
    "UNIT_PHYSICIAN": "unit_physician",
    "ASSOCIATE_PHYSICIAN": "physician",
    "ONCALL_PHYSICIAN": "physician",
    "CHARGE_NURSE": "charge_nurse",
    "NURSE": "nurse",
    "RAPID_RESPONSE": "rapid_response",
    "AUDITOR": "auditor",
    "PLATFORM_SUPPORT": "platform_support",
}

_UUID = postgresql.UUID(as_uuid=True)

_INSERT_GROUP = sa.text(
    "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
    "created_at, updated_at) VALUES (:id, :tenant_id, :slug, :name, :description, :mfa, "
    ":system, now(), now()) ON CONFLICT (tenant_id, slug) DO NOTHING"
)
_INSERT_PERMISSION = sa.text(
    "INSERT INTO group_permissions (group_id, permission) "
    "SELECT id, :perm FROM groups WHERE tenant_id = :tenant_id AND slug = :slug "
    "ON CONFLICT DO NOTHING"
)


def _convert_memberships_sql() -> str:
    case = " ".join(f"WHEN '{role}' THEN '{slug}'" for role, slug in _LEGACY.items())
    return (
        "INSERT INTO user_groups (user_id, group_id, source, granted_by_id, created_at) "
        "SELECT m.user_id, g.id, 'manual', m.granted_by_id, now() "
        "FROM tenant_memberships m "
        "JOIN groups g ON g.tenant_id = m.tenant_id "
        f"AND g.slug = CASE m.role::text {case} END "
        "WHERE m.is_active AND m.role IS NOT NULL "
        "ON CONFLICT DO NOTHING"
    )


def upgrade() -> None:
    # ---- pre-flight: the username backfill needs distinct, lower-cased e-mails that fit ----
    bind = op.get_bind()
    clashes = [row[0] for row in bind.execute(sa.text(
        "SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1")).all()]
    too_long = [row[0] for row in bind.execute(sa.text(
        "SELECT email FROM users WHERE length(email) > 128")).all()]
    if clashes or too_long:
        raise RuntimeError(
            "Migration 0006 cannot backfill usernames. E-mails that differ only by case: "
            f"{clashes or 'none'}; e-mails longer than 128 characters: {too_long or 'none'}. "
            "Merge or rename these accounts, then run the upgrade again. Nothing was changed."
        )

    # ---- tables ----
    op.create_table(
        "groups",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("tenant_id", _UUID, nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("mfa_required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_groups_tenant_slug"),
    )
    op.create_index("ix_groups_tenant_id", "groups", ["tenant_id"])

    op.create_table(
        "group_permissions",
        sa.Column("group_id", _UUID, primary_key=True),
        sa.Column("permission", sa.String(length=64), primary_key=True),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "user_groups",
        sa.Column("user_id", _UUID, primary_key=True),
        sa.Column("group_id", _UUID, primary_key=True),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("granted_by_id", _UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_user_groups_group_id", "user_groups", ["group_id"])

    op.create_table(
        "ldap_group_mappings",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("tenant_id", _UUID, nullable=False),
        sa.Column("ad_group_dn", sa.Text(), nullable=False),
        sa.Column("group_id", _UUID, nullable=False),
        sa.Column("created_by_id", _UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("tenant_id", "ad_group_dn", "group_id", name="uq_ldap_mapping"),
    )
    op.create_index("ix_ldap_group_mappings_tenant_id", "ldap_group_mappings", ["tenant_id"])
    op.create_index("ix_ldap_group_mappings_group_id", "ldap_group_mappings", ["group_id"])

    # ---- users ----
    op.add_column("users", sa.Column("username", sa.String(length=128), nullable=True))
    op.add_column("users", sa.Column("auth_source", sa.String(length=16), nullable=False,
                                     server_default="local"))
    op.add_column("users", sa.Column("external_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("ldap_dn", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False,
                                     server_default="0"))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("sessions_revoked_at", sa.DateTime(timezone=True),
                                     nullable=True))
    op.execute("UPDATE users SET email = lower(email)")
    op.execute("UPDATE users SET username = lower(email) WHERE username IS NULL")
    op.alter_column("users", "username", nullable=False)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_external_id", "users", ["external_id"], unique=True)
    op.alter_column("users", "email", nullable=True)
    op.alter_column("users", "hashed_password", nullable=True)

    # ---- memberships: role becomes legacy ----
    op.alter_column("tenant_memberships", "role", nullable=True)

    # ---- default groups for every tenant that exists today ----
    tenant_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM tenants")).all()]
    for tenant_id in tenant_ids:
        for spec in _DEFAULT_GROUPS:
            bind.execute(_INSERT_GROUP, {
                "id": uuid.uuid4(), "tenant_id": tenant_id, "slug": spec["slug"],
                "name": spec["name"], "description": spec["description"],
                "mfa": spec["mfa_required"], "system": spec["is_system"],
            })
            for perm in spec["permissions"]:
                bind.execute(_INSERT_PERMISSION,
                             {"perm": perm, "tenant_id": tenant_id, "slug": spec["slug"]})

    # ---- legacy role -> group, one row per active membership ----
    op.execute(_convert_memberships_sql())


def downgrade() -> None:
    op.drop_index("ix_ldap_group_mappings_group_id", table_name="ldap_group_mappings")
    op.drop_index("ix_ldap_group_mappings_tenant_id", table_name="ldap_group_mappings")
    op.drop_table("ldap_group_mappings")
    op.drop_index("ix_user_groups_group_id", table_name="user_groups")
    op.drop_table("user_groups")
    op.drop_table("group_permissions")
    op.drop_index("ix_groups_tenant_id", table_name="groups")
    op.drop_table("groups")

    op.drop_index("ix_users_external_id", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_column("users", "sessions_revoked_at")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "token_version")
    op.drop_column("users", "ldap_dn")
    op.drop_column("users", "external_id")
    op.drop_column("users", "auth_source")
    op.drop_column("users", "username")
    # Fails if an AD account (no password) or a membership without a role exists — see docstring.
    op.alter_column("users", "hashed_password", nullable=False)
    op.alter_column("users", "email", nullable=False)
    op.alter_column("tenant_memberships", "role", nullable=False)
