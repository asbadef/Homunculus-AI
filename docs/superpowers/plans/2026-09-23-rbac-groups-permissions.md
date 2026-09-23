# RBAC — groups, permissions, user management (Plan 1 of 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `UserRole` enum with administrator-defined groups that carry permission sets, put the permissions in the JWT with a per-user `token_version`, guard every route by permission, and give the dashboard a real user/group administration screen — as specified in `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md` (§1–§6, §8–§10). LDAP/AD is Plan 2.

**Architecture:** A fixed permission catalogue in code (`auth/permissions.py`); `groups` / `group_permissions` / `user_groups` tables per tenant, seeded with defaults; sign-in computes the union of the user's groups' permissions into the access token (`perms`, `groups`, `tenant`, `mfa_required`, `mfa_verified`, `tv`); `get_principal` checks `tv` against `users.token_version` on every request so group changes take effect on the next transparent refresh; `require_permission("…")` replaces `require_roles(...)`; the board routes in `api/app.py` resolve a JWT into a `Caller` carrying the permissions; a new `/admin` router manages users and groups; the dashboard gates navigation by `perms` and wires its admin page to the real API in live mode.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (async, asyncpg), Alembic, python-jose, bcrypt, pyotp, pytest + httpx; React 18, Vite, Vitest + Testing Library, `qrcode` (new dependency, QR for TOTP enrolment).

**Branch:** `feat/ldap-rbac` (already created; the spec is committed there as `4a94487`).

**Review amendments (after Task 1's code review, 2026-09-23):** the confirm permission is split
into `admissions.transfer.confirm` (nurse, charge_nurse) and `admissions.discharge.confirm`
(charge_nurse) so no legacy role loses a right (19 keys); the system group holds the whole
catalogue by rule at token issuance and its rights are immutable; an *administrator* for the
last-admin guard holds both `users.manage` and `groups.manage`; migration 0006's frozen defaults
are pinned to a snapshot in the test, not to the live defaults. The spec carries the same changes.

**Do not deploy mid-plan.** Between migration 0006 (Task 3) and the sign-in rewrite (Task 6) and the
seed rewrite (Task 7), stored e-mails are lower-cased while sign-in still matches case-sensitively,
and the seed cannot create the administrator. The branch reaches the VM only after Task 20.

**Baseline note:** the working tree contains untracked Infinity-branch files. `tests/test_infinity_research_api.py` fails at collection *before this plan starts* (`UserRole.BIOMEDICAL` does not exist). Every full backend run in this plan therefore uses `--ignore=tests/test_infinity_research_api.py`. Do not modify the untracked Infinity files; the spec records that `infinity_research.py` becomes `require_permission("devices.manage")` when that branch is merged.

**Commands:** backend tests run from `homunculus-engine/` with `.venv/Scripts/python.exe -m pytest …`; DB-backed tests need `TEST_DATABASE_URL` (a Postgres whose database name contains `test`, see `tests/conftest.py`) and are skipped otherwise. Frontend tests run from `dashboard/` with `npx vitest run …`. Commits are made from the repository root.

---

## File structure

**Backend — create**

| File | Responsibility |
| --- | --- |
| `homunculus-engine/src/homunculus/auth/permissions.py` | The permission catalogue, the default groups, the legacy-role → group map, `effective_permissions`. Pure data + pure functions. |
| `homunculus-engine/src/homunculus/auth/groups.py` | Group persistence logic: seed defaults, read a user's groups, replace manual memberships, bump token versions, count administrators, resolve a user's tenant. |
| `homunculus-engine/src/homunculus/auth/audit.py` | `append_audit(request, …)` — one place that writes auth/admin events to `app.state.audit`. |
| `homunculus-engine/src/homunculus/admin/__init__.py`, `schemas.py`, `service.py`, `router.py` | The `/admin` API: users, groups, permission catalogue, guards, audit. |
| `homunculus-engine/alembic/versions/0006_groups_and_permissions.py` | Tables, `users` columns, default groups per tenant, legacy conversion. |
| `homunculus-engine/tests/test_permissions.py`, `test_auth_models.py`, `test_migration_0006_defaults.py`, `test_migration_0006_conversion.py`, `test_groups_service.py`, `test_auth_dependencies.py`, `test_auth_tokens.py`, `test_auth_login.py`, `test_board_permissions.py`, `test_jwt_caller.py`, `test_admin_api.py` | Tests, one file per unit. |

**Backend — modify**

| File | Change |
| --- | --- |
| `auth/models.py` | New columns on `User`; `TenantMembership.role` nullable and unused; `Group`, `GroupPermission`, `UserGroup`, `LdapGroupMapping`; `UserRole` and `MFA_REQUIRED_ROLES` deleted (Task 7). |
| `auth/dependencies.py` | `Principal`, `get_principal_pre_mfa`, `get_principal`, `get_current_user`, `get_current_user_pre_mfa`, `require_permission`; `require_roles` deleted (Task 7). |
| `auth/service.py` | Login by username/e-mail, dummy bcrypt, `build_session`, `issue_tokens` with the new claims, `change_password`. |
| `auth/jwt.py` | `create_refresh_token(subject, extra=None)`. |
| `auth/schemas.py` | `LoginRequest.login` (+ `email` alias), `TokenResponse.mfa_enrolled`, richer `UserMeResponse`, `PasswordChangeRequest`. |
| `auth/router.py` | New login flow, audit, `/auth/password`, `/auth/me` with groups and perms. |
| `auth/seed.py` | Bootstrap admin gets `username` and the `hospital_admin` group. |
| `auth/totp.py` | Docstring only (no role list). |
| `admission/router.py`, `escalation/router.py`, `tenant/router.py` | `require_permission` guards; tenant creation seeds the default groups. |
| `api/identity.py` | `Caller` dataclass. |
| `api/app.py` | `resolve_jwt` → `Caller`; `_caller`, `_require`; permission checks and attribution on the board routes; `/admin` router mounted. |
| `api/prodserver.py` | `make_jwt_caller_resolver`; the membership-slug resolver removed. |
| `tests/test_dual_credentials.py`, `tests/test_auth_seed.py` | Updated for `Caller` and groups. `tests/test_jwt_hospital_lookup.py` deleted (replaced by `test_jwt_caller.py`). |

**Frontend — create**

| File | Responsibility |
| --- | --- |
| `dashboard/src/ui.jsx` | `Field`, `inputCls`, `btnCls`, `ActionOverlay` — moved out of `ClinicalDemo.jsx` so new admin components can share them. |
| `dashboard/src/permissions.js` | Permission keys, demo ROLE → perms table, `hasPerm`, `hasAny`, `uiRoleFromPerms`. |
| `dashboard/src/liveAdmin.js` | Adapters from `/admin` payloads to UI shapes. |
| `dashboard/src/admin/GroupAdmin.jsx`, `LiveUserAdmin.jsx`, `LiveStaffTab.jsx` | The live-mode staff tab: groups + users, backed by the API. |
| Tests: `permissions.test.js`, `liveAdmin.test.js`, `admin/GroupAdmin.test.jsx`, `admin/LiveUserAdmin.test.jsx`, `nav.test.js` | One per unit. |

**Frontend — modify**

| File | Change |
| --- | --- |
| `liveAuth.js` | `sessionFromToken`, `accessProblem`; the role map deleted. |
| `liveStore.js` | Session carries `perms`/`groups`; `live: true`; MFA enrolment; ack without `role`; admin actions. |
| `backendApi.js` | `/admin/*`, `/auth/password`, ack body without role, 204 handling. |
| `clinicalDemo.js` | Demo sessions carry `perms` via `permsForRole`. |
| `clinicalI18n.js` | `rbac` block in TR / AZ / EN / RU. |
| `ClinicalDemo.jsx` | Imports from `ui.jsx`; `NAV_ITEMS` by permission; tab gating; `MfaGate` enrolment with QR; live staff tab. |
| `liveAuth.test.js`, `liveStore.test.js`, `liveStore.live.test.js` | Updated for `perms`. |
| `package.json` | `qrcode` dependency. |

**Docs:** `docs/homunculus-rehber-TR.md` glossary entries (Task 21).

---

## Task 1: Permission catalogue and default groups

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/permissions.py`
- Test: `homunculus-engine/tests/test_permissions.py`

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_permissions.py
"""The permission catalogue is the single list of things a signed-in user may do.

Everything else — group defaults, route guards, the dashboard — refers to these keys. A key
used anywhere that is not in the catalogue must fail loudly, at import time, not at request
time as a 403 nobody can explain.
"""
from __future__ import annotations

import pytest

from homunculus.auth.permissions import (
    ALL_PERMISSIONS, DEFAULT_GROUPS, LEGACY_ROLE_TO_GROUP, PERMISSIONS, UnknownPermission,
    effective_permissions, validate_permissions,
)

SPEC_KEYS = {
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.admit",
    "admissions.sign_off", "admissions.move.initiate", "admissions.transfer.confirm",
    "admissions.discharge.confirm",
    "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
    "break_glass.use", "audit.view", "users.manage", "groups.manage", "structure.manage",
    "devices.manage",
}


def test_the_catalogue_is_exactly_the_specified_nineteen_keys():
    assert set(PERMISSIONS) == SPEC_KEYS
    assert ALL_PERMISSIONS == frozenset(SPEC_KEYS)


def test_every_key_has_a_description():
    for key, description in PERMISSIONS.items():
        assert description.strip(), key


def test_validate_accepts_known_keys_and_preserves_order():
    assert validate_permissions(["alerts.ack", "board.view"]) == ("alerts.ack", "board.view")


def test_validate_refuses_an_unknown_key_by_name():
    with pytest.raises(UnknownPermission, match="alerts.acknowledge"):
        validate_permissions(["board.view", "alerts.acknowledge"])


def test_every_default_group_only_uses_catalogue_keys():
    for group in DEFAULT_GROUPS:
        unknown = set(group["permissions"]) - ALL_PERMISSIONS
        assert not unknown, (group["slug"], unknown)


def test_default_group_slugs_are_unique_and_hospital_admin_is_the_only_system_group():
    slugs = [g["slug"] for g in DEFAULT_GROUPS]
    assert len(slugs) == len(set(slugs))
    assert [g["slug"] for g in DEFAULT_GROUPS if g["is_system"]] == ["hospital_admin"]


def test_hospital_admin_holds_every_permission():
    admin = next(g for g in DEFAULT_GROUPS if g["slug"] == "hospital_admin")
    assert set(admin["permissions"]) == SPEC_KEYS
    assert admin["mfa_required"] is True


def test_the_legacy_rights_are_preserved_group_by_group():
    """Spec §3: for every route that had a role guard, the mapped group holds exactly that right."""
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    assert "care_team.claim" in by_slug["attending"] and "care_team.assign" in by_slug["attending"]
    assert "care_team.claim" not in by_slug["unit_physician"]
    assert "care_team.claim" not in by_slug["physician"]
    assert "care_team.claim" not in by_slug["nurse"]
    assert "care_team.claim" in by_slug["charge_nurse"]
    assert "admissions.sign_off" in by_slug["unit_physician"]
    assert "admissions.sign_off" not in by_slug["physician"]
    assert "shifts.manage" in by_slug["charge_nurse"] and "shifts.manage" not in by_slug["nurse"]
    assert "admissions.transfer.confirm" in by_slug["nurse"]          # nurses confirm transfers today
    assert "admissions.discharge.confirm" not in by_slug["nurse"]      # discharge stays charge-nurse
    assert "admissions.transfer.confirm" in by_slug["charge_nurse"]
    assert "admissions.discharge.confirm" in by_slug["charge_nurse"]
    assert "admissions.admit" in by_slug["nurse"]
    assert by_slug["auditor"] == {"board.view", "audit.view"}
    assert by_slug["biomedical"] == {"devices.manage"}


def test_every_legacy_role_maps_to_a_default_group():
    legacy = {"ATTENDING", "ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN", "UNIT_PHYSICIAN",
              "CHARGE_NURSE", "NURSE", "RAPID_RESPONSE", "HOSPITAL_ADMIN", "AUDITOR",
              "PLATFORM_SUPPORT"}
    assert set(LEGACY_ROLE_TO_GROUP) == legacy
    slugs = {g["slug"] for g in DEFAULT_GROUPS}
    assert set(LEGACY_ROLE_TO_GROUP.values()) <= slugs


def test_effective_permissions_is_the_union_across_groups():
    assert effective_permissions([["board.view"], ["board.view", "alerts.ack"]]) == \
        frozenset({"board.view", "alerts.ack"})
    assert effective_permissions([]) == frozenset()


def test_a_bare_string_is_refused_not_split_into_characters():
    with pytest.raises(TypeError):
        validate_permissions("board.view")
    with pytest.raises(TypeError):
        effective_permissions(["board.view"])   # a flat list where sets were expected


# The whole §3 table, so a stray key added to any group fails here, not in a ward.
SPEC_GROUPS = {
    "hospital_admin": (True, True, SPEC_KEYS),
    "attending": (True, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                "admissions.sign_off", "admissions.move.initiate",
                                "care_team.claim", "care_team.assign", "handover.sign",
                                "break_glass.use"}),
    "unit_physician": (True, False, {"board.view", "alerts.ack", "alerts.escalate",
                                     "admissions.view", "admissions.sign_off",
                                     "admissions.move.initiate", "handover.sign",
                                     "break_glass.use"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "care_team.claim", "handover.sign", "shifts.manage",
                                    "break_glass.use"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                      "admissions.view", "break_glass.use"}),
    "auditor": (False, False, {"board.view", "audit.view"}),
    "platform_support": (True, False, {"audit.view", "devices.manage"}),
    "pharmacist": (False, False, {"board.view", "admissions.view"}),
    "biomedical": (False, False, {"devices.manage"}),
}


def test_every_default_group_matches_the_spec_table_exactly():
    by_slug = {g["slug"]: g for g in DEFAULT_GROUPS}
    assert set(by_slug) == set(SPEC_GROUPS)
    for slug, (mfa, system, perms) in SPEC_GROUPS.items():
        g = by_slug[slug]
        assert g["mfa_required"] is mfa, slug
        assert g["is_system"] is system, slug
        assert set(g["permissions"]) == perms, slug
        assert len(g["permissions"]) == len(set(g["permissions"])), slug   # no duplicates
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_permissions.py -q`
Expected: `ModuleNotFoundError: No module named 'homunculus.auth.permissions'`

- [ ] **Step 3: Write the catalogue**

```python
# homunculus-engine/src/homunculus/auth/permissions.py
"""The permission catalogue and the default groups.

A permission is a *feature-level* right ("acknowledge an alert", "manage users"). Groups hold
sets of them; a user's effective rights are the union over their groups. The catalogue lives in
code, not in the database: the set of things the software can do is a property of the software,
while which group may do them is a hospital decision and lives in `groups` / `group_permissions`.

Every route guard, the default groups below and the dashboard refer to these keys. An unknown key
raises `UnknownPermission` from `validate_permissions`, and `require_permission` calls it at
import time — a typo in a guard fails at startup, never as a 403 in a ward.

PHI RULE: no patient data here. CLINICAL RULE: infrastructure only.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import TypedDict

PERMISSIONS: dict[str, str] = {
    "board.view": "See the live board, patient detail and the event stream",
    "alerts.ack": "Acknowledge or snooze an alert",
    "alerts.escalate": "Create an alert manually; escalate one",
    "admissions.view": "Read admissions and patient records",
    "admissions.admit": "Create an admission",
    "admissions.sign_off": "Physician sign-off of an admission",
    "admissions.move.initiate": "Initiate a transfer or discharge",
    "admissions.transfer.confirm": "Confirm a transfer arrival",
    "admissions.discharge.confirm": "Confirm a discharge; release the bed",
    "care_team.claim": "Claim a care-team role on a patient",
    "care_team.assign": "Assign others to a patient's care team",
    "handover.sign": "Sign or countersign a handover",
    "shifts.manage": "Create shift schedules",
    "break_glass.use": "Open, extend or close a break-glass session",
    "audit.view": "Read the audit trail",
    "users.manage": "Users: create, edit, activate, reset password or MFA, set groups; "
                    "LDAP import and group mapping",
    "groups.manage": "Groups and their permission sets",
    "structure.manage": "Tenant, site, unit, room and bed configuration",
    "devices.manage": "Device and research endpoints",
}

ALL_PERMISSIONS: frozenset[str] = frozenset(PERMISSIONS)


class UnknownPermission(ValueError):
    """A key that is not in the catalogue."""


def validate_permissions(keys: Iterable[str]) -> tuple[str, ...]:
    """Return `keys` as a tuple, or raise `UnknownPermission` naming every unknown key."""
    if isinstance(keys, str):
        raise TypeError("expected an iterable of permission keys, not a single string")
    keys = tuple(keys)
    unknown = [k for k in keys if k not in PERMISSIONS]
    if unknown:
        raise UnknownPermission(f"unknown permission(s): {', '.join(unknown)}")
    return keys


def effective_permissions(permission_sets: Iterable[Iterable[str]]) -> frozenset[str]:
    """The union of several groups' permissions — a user's effective rights."""
    out: set[str] = set()
    for keys in permission_sets:
        if isinstance(keys, str):
            raise TypeError("expected an iterable of permission SETS, got a bare key")
        out.update(keys)
    return frozenset(out)


# ---------------------------------------------------------------- default groups (spec §3)
#
# Seeded for every tenant. The legacy `UserRole` values map one-to-one onto these so that the
# migration moves nobody to a different tier; the rights that DO change are the routes that used
# to accept any signed-in user (spec §3, "What the defaults tighten").
#
# Names are Turkish: this is what the administrator sees in the pilot hospital. The dashboard
# translates the *slug* for other UI languages.
_ATTENDING = (
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.sign_off",
    "admissions.move.initiate", "care_team.claim", "care_team.assign", "handover.sign",
    "break_glass.use",
)


class GroupSpec(TypedDict):
    slug: str
    name: str
    description: str
    mfa_required: bool
    is_system: bool
    permissions: tuple[str, ...]


# The SYSTEM group (`is_system`) holds the whole catalogue BY RULE at token issuance — including
# keys added after a tenant was seeded — and its rows cannot be edited. Its rows are seeded all
# the same, so the admin screen can show them.
DEFAULT_GROUPS: tuple[GroupSpec, ...] = (
    {"slug": "hospital_admin", "name": "Sistem Yöneticisi",
     "description": "Kullanıcı, grup, yapı ve cihaz yönetimi; denetim kaydı.",
     "mfa_required": True, "is_system": True, "permissions": tuple(PERMISSIONS)},
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

# Legacy `UserRole` value -> default group slug. Used once, by migration 0006.
LEGACY_ROLE_TO_GROUP: dict[str, str] = {
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

def _self_check() -> None:
    """Import-time invariants: every default key is in the catalogue, slugs are unique, every
    legacy role maps to a default slug, and exactly one group is the system group."""
    slugs = [g["slug"] for g in DEFAULT_GROUPS]
    if len(slugs) != len(set(slugs)):
        raise RuntimeError("DEFAULT_GROUPS: duplicate slug")
    for g in DEFAULT_GROUPS:
        validate_permissions(g["permissions"])
    missing = set(LEGACY_ROLE_TO_GROUP.values()) - set(slugs)
    if missing:
        raise RuntimeError(f"LEGACY_ROLE_TO_GROUP names unknown group(s): {sorted(missing)}")
    if [g["slug"] for g in DEFAULT_GROUPS if g["is_system"]] != ["hospital_admin"]:
        raise RuntimeError("exactly one system group, hospital_admin, is expected")


_self_check()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_permissions.py -q`
Expected: `12 passed`

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
git commit -m "feat(auth): permission catalogue and default groups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: Models — groups tables and the new user columns

`UserRole` stays in this task (routers still import it); it is deleted in Task 7.

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/models.py`
- Test: `homunculus-engine/tests/test_auth_models.py`

- [ ] **Step 1: Write the failing test**

```python
# homunculus-engine/tests/test_auth_models.py
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_models.py -q`
Expected: `ImportError: cannot import name 'Group'`

- [ ] **Step 3: Rewrite `auth/models.py`**

Replace the whole file with:

```python
"""
Identity tables: users, tenant memberships, groups, group permissions, user–group links, and the
LDAP group mapping (used by Plan 2).

A user's rights come from the groups they hold in a tenant; the permission catalogue is in
`auth/permissions.py`. `tenant_memberships.role` is a legacy column: nullable, never written,
kept only so the PostgreSQL enum type can be dropped in a later cleanup migration.

PHI RULE: No real patient data. This file contains only identity/auth data.
CLINICAL RULE: System states criteria met — never diagnoses.
"""
from __future__ import annotations
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from homunculus.db import Base

AUTH_LOCAL = "local"
AUTH_LDAP = "ldap"
SOURCE_MANUAL = "manual"
SOURCE_LDAP = "ldap"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    """DEPRECATED — deleted in this same plan (Task 7) once every router uses permissions."""
    ATTENDING = "ATTENDING"
    ASSOCIATE_PHYSICIAN = "ASSOCIATE_PHYSICIAN"
    ONCALL_PHYSICIAN = "ONCALL_PHYSICIAN"
    UNIT_PHYSICIAN = "UNIT_PHYSICIAN"
    CHARGE_NURSE = "CHARGE_NURSE"
    NURSE = "NURSE"
    RAPID_RESPONSE = "RAPID_RESPONSE"
    HOSPITAL_ADMIN = "HOSPITAL_ADMIN"
    AUDITOR = "AUDITOR"
    PLATFORM_SUPPORT = "PLATFORM_SUPPORT"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Sign-in identifier. Stored lower-case (see auth.service.normalize_login); for a local
    # account it is the e-mail, for an AD account the sAMAccountName.
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    # Optional: AD accounts do not always carry `mail`. Stored lower-case.
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Bcrypt hash — never plaintext. NULL for an AD account: a local sign-in against NULL fails.
    hashed_password: Mapped[str | None] = mapped_column(String(72), nullable=True)
    auth_source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=AUTH_LOCAL, server_default=AUTH_LOCAL
    )
    # AD objectGUID — stable across renames and OU moves (Plan 2).
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    ldap_dn: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Incremented whenever the user's rights change; an access token whose `tv` claim differs
    # is refused, and the client's transparent refresh mints one with the current rights.
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TOTP secret (Base32)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Vendor-side staff flag — extra audit controls
    is_platform_support: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    memberships: Mapped[list[TenantMembership]] = relationship(
        "TenantMembership",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="TenantMembership.user_id",
    )
    group_links: Mapped[list[UserGroup]] = relationship(
        "UserGroup",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="UserGroup.user_id",
    )


class TenantMembership(Base):
    """Links a User to a Tenant. Rights come from `user_groups`, not from `role`."""
    __tablename__ = "tenant_memberships"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # LEGACY. In PostgreSQL this column is still the `userrole` enum type; the ORM reads it as
    # text and never writes it. Dropped in a later cleanup migration.
    role: Mapped[str | None] = mapped_column(String(40), nullable=True)
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship("User", foreign_keys=[user_id], back_populates="memberships")


class Group(Base):
    """An administrator-defined group in one tenant, carrying a set of permission keys."""
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Only `hospital_admin`: cannot be deleted.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    permissions: Mapped[list[GroupPermission]] = relationship(
        "GroupPermission", back_populates="group", cascade="all, delete-orphan", lazy="selectin",
    )

    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_groups_tenant_slug"),)

    @property
    def permission_keys(self) -> list[str]:
        return sorted(p.permission for p in self.permissions)


class GroupPermission(Base):
    __tablename__ = "group_permissions"

    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[str] = mapped_column(String(64), primary_key=True)

    group: Mapped[Group] = relationship("Group", back_populates="permissions")


class UserGroup(Base):
    """A user's membership in a group. `source` says who put them there: an administrator
    (`manual`) or the AD group mapping (`ldap`); the LDAP sync only ever touches its own rows."""
    __tablename__ = "user_groups"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True,
        index=True,
    )
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SOURCE_MANUAL, server_default=SOURCE_MANUAL
    )
    granted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship("User", foreign_keys=[user_id], back_populates="group_links")
    group: Mapped[Group] = relationship("Group", lazy="selectin")


class LdapGroupMapping(Base):
    """AD group DN (stored lower-case) -> Homunculus group. Written and read in Plan 2."""
    __tablename__ = "ldap_group_mappings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ad_group_dn: Mapped[str] = mapped_column(Text, nullable=False)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        UniqueConstraint("tenant_id", "ad_group_dn", "group_id", name="uq_ldap_mapping"),
    )
```

- [ ] **Step 4: Run the model tests and the whole pure suite**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_models.py -q`
Expected: `7 passed`

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: everything that passed before still passes (`TenantMembership.role` is still written by
`seed.py` as an enum member — that write is a `UserRole` value going into a `String` column; the
DB-backed seed test is skipped without `TEST_DATABASE_URL`, and Task 7 rewrites the seed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/models.py homunculus-engine/tests/test_auth_models.py
git commit -m "feat(auth): group, permission and user-group tables; username, auth_source and token_version on users

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: Migration 0006

**Files:**
- Create: `homunculus-engine/alembic/versions/0006_groups_and_permissions.py`
- Test: `homunculus-engine/tests/test_migration_0006_defaults.py`, `tests/test_migration_0006_conversion.py`, `tests/test_migration_0006_schema_parity.py`

- [ ] **Step 1: Write the failing test**

The migration carries a *frozen copy* of the defaults (a migration must not change when the
live defaults change later). The test pins that copy to a snapshot **inside the test** — never
to the live `DEFAULT_GROUPS`, which are free to evolve for tenants created later. At authoring
time the snapshot, the migration and the live defaults are identical; only the first two must
stay so.

```python
# homunculus-engine/tests/test_migration_0006_defaults.py
"""Migration 0006 seeds a FROZEN copy of the default groups. This test pins that copy to the
snapshot below — the defaults as they stood at revision 0006. It deliberately does not import
the live DEFAULT_GROUPS: those may change for tenants created later, and a released migration
must not follow them. If this test fails, the migration file was edited; revert it."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from homunculus.auth.permissions import ALL_PERMISSIONS

ATTENDING = {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
             "admissions.sign_off", "admissions.move.initiate", "care_team.claim",
             "care_team.assign", "handover.sign", "break_glass.use"}
SNAPSHOT = {   # slug: (mfa_required, is_system, permissions) as of 0006
    "hospital_admin": (True, True, {
        "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.admit",
        "admissions.sign_off", "admissions.move.initiate", "admissions.transfer.confirm",
        "admissions.discharge.confirm", "care_team.claim", "care_team.assign", "handover.sign",
        "shifts.manage", "break_glass.use", "audit.view", "users.manage", "groups.manage",
        "structure.manage", "devices.manage"}),
    "attending": (True, False, ATTENDING),
    "unit_physician": (True, False, ATTENDING - {"care_team.claim", "care_team.assign"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                    "admissions.admit", "admissions.transfer.confirm",
                                    "admissions.discharge.confirm", "care_team.claim",
                                    "handover.sign", "shifts.manage", "break_glass.use"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                      "admissions.view", "break_glass.use"}),
    "auditor": (False, False, {"board.view", "audit.view"}),
    "platform_support": (True, False, {"audit.view", "devices.manage"}),
    "pharmacist": (False, False, {"board.view", "admissions.view"}),
    "biomedical": (False, False, {"devices.manage"}),
}
LEGACY_SNAPSHOT = {
    "HOSPITAL_ADMIN": "hospital_admin", "ATTENDING": "attending",
    "UNIT_PHYSICIAN": "unit_physician", "ASSOCIATE_PHYSICIAN": "physician",
    "ONCALL_PHYSICIAN": "physician", "CHARGE_NURSE": "charge_nurse", "NURSE": "nurse",
    "RAPID_RESPONSE": "rapid_response", "AUDITOR": "auditor", "PLATFORM_SUPPORT": "platform_support",
}

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0006_groups_and_permissions.py"


def _load():
    spec = importlib.util.spec_from_file_location("migration_0006", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_frozen_defaults_match_the_0006_snapshot():
    frozen = {g["slug"]: g for g in _load()._DEFAULT_GROUPS}
    assert frozen.keys() == SNAPSHOT.keys()
    for slug, (mfa, system, perms) in SNAPSHOT.items():
        assert set(frozen[slug]["permissions"]) == perms, slug
        assert frozen[slug]["mfa_required"] is mfa, slug
        assert frozen[slug]["is_system"] is system, slug


def test_the_frozen_legacy_map_matches_the_snapshot():
    assert _load()._LEGACY == LEGACY_SNAPSHOT


def test_every_frozen_key_is_still_in_the_catalogue():
    """Retiring a catalogue key needs a data migration for the rows 0006 wrote; this is the
    reminder. Adding keys is free."""
    for g in _load()._DEFAULT_GROUPS:
        assert set(g["permissions"]) <= ALL_PERMISSIONS, g["slug"]


def test_revision_chain():
    m = _load()
    assert m.revision == "0006" and m.down_revision == "0005"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_migration_0006_defaults.py -q`
Expected: `FileNotFoundError` (module path does not exist)

- [ ] **Step 3: Write the migration**

```python
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
rebuild roles from groups, and it fails if any user has no password or no e-mail (an AD account)
or any membership has a NULL role. Back the database up before `upgrade` (runbook: pg_dump).

An INACTIVE membership keeps its legacy `role` but gets no group: reactivating it later grants no
rights until an administrator assigns a group. That is intended. Offline mode (`alembic upgrade
--sql`) is not supported: the seeding reads the tenants table.

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
```

- [ ] **Step 4: Run the pin test**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_migration_0006_defaults.py -q`
Expected: `4 passed`

- [ ] **Step 5: If a test database is available, run the migration against it**

Only when `TEST_DATABASE_URL` is set (the fixture's guard requires "test" in the database name):

Run: `cd homunculus-engine && DATABASE_URL="$TEST_DATABASE_URL" .venv/Scripts/python.exe -m alembic upgrade head && DATABASE_URL="$TEST_DATABASE_URL" .venv/Scripts/python.exe -m alembic downgrade 0005 && DATABASE_URL="$TEST_DATABASE_URL" .venv/Scripts/python.exe -m alembic upgrade head`
Expected: three clean runs, no error. (The DB-backed pytest fixture drops and recreates the tables afterwards, so this leaves nothing behind.)

- [ ] **Step 5b: Prove the legacy conversion on a real database**

```python
# homunculus-engine/tests/test_migration_0006_conversion.py
"""Migration 0006 on a database that holds legacy roles: one user_groups row per active
membership, in the mapped group; usernames backfilled from e-mail; 11 default groups per tenant.

Runs the real Alembic chain, so it needs TEST_DATABASE_URL. It rebuilds the `public` schema —
the conftest guard already refuses any database whose name does not contain "test".
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

ROOT = Path(__file__).resolve().parents[1]
LEGACY = ["HOSPITAL_ADMIN", "ATTENDING", "UNIT_PHYSICIAN", "ASSOCIATE_PHYSICIAN",
          "ONCALL_PHYSICIAN", "CHARGE_NURSE", "NURSE", "RAPID_RESPONSE", "AUDITOR",
          "PLATFORM_SUPPORT"]
EXPECTED = {"HOSPITAL_ADMIN": "hospital_admin", "ATTENDING": "attending",
            "UNIT_PHYSICIAN": "unit_physician", "ASSOCIATE_PHYSICIAN": "physician",
            "ONCALL_PHYSICIAN": "physician", "CHARGE_NURSE": "charge_nurse", "NURSE": "nurse",
            "RAPID_RESPONSE": "rapid_response", "AUDITOR": "auditor",
            "PLATFORM_SUPPORT": "platform_support"}


def _sync_url() -> str:
    for scheme in ("postgresql+asyncpg://", "postgresql://"):
        if TEST_DATABASE_URL.startswith(scheme):
            return "postgresql+psycopg2://" + TEST_DATABASE_URL[len(scheme):]
    return TEST_DATABASE_URL


@pytest.fixture
def clean_db(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)   # alembic/env.py reads this
    engine = create_engine(_sync_url())
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    yield engine, cfg
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


def test_legacy_roles_become_group_memberships(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0005")

    demo, other = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as conn:
        for tid, slug in ((demo, "demo-hastanesi"), (other, "other")):
            conn.execute(text("INSERT INTO tenants (id, name, slug, country_code, timezone, is_active) "
                              "VALUES (:id, :slug, :slug, 'TR', 'UTC', true)"), {"id": tid, "slug": slug})

        def add_user(email, name):
            uid = uuid.uuid4()
            conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                              "is_active, is_platform_support) VALUES (:id, :email, :name, 'x', false, "
                              "true, false)"), {"id": uid, "email": email, "name": name})
            return uid

        def add_membership(uid, tid, role, active=True):
            conn.execute(text("INSERT INTO tenant_memberships (id, user_id, tenant_id, role, is_active) "
                              "VALUES (:id, :uid, :tid, CAST(:role AS userrole), :active)"),
                         {"id": uuid.uuid4(), "uid": uid, "tid": tid, "role": role, "active": active})

        for role in LEGACY:
            add_membership(add_user(f"{role}@Example.com", role), demo, role)
        add_membership(add_user("inactive@example.com", "INACTIVE"), demo, "ATTENDING", active=False)
        add_membership(add_user("other-nurse@example.com", "OTHER_NURSE"), other, "NURSE")

    command.upgrade(cfg, "head")

    with engine.begin() as conn:
        per_tenant = dict(conn.execute(text("SELECT tenant_id, count(*) FROM groups GROUP BY tenant_id")).all())
        assert per_tenant == {demo: 11, other: 11}
        rows = conn.execute(text(
            "SELECT u.full_name AS who, g.slug, g.tenant_id AS group_tenant, m.tenant_id AS member_tenant, "
            "ug.source FROM user_groups ug JOIN users u ON u.id = ug.user_id "
            "JOIN groups g ON g.id = ug.group_id JOIN tenant_memberships m ON m.user_id = ug.user_id")).all()
        assert len(rows) == len(LEGACY) + 1                          # one row per ACTIVE membership
        assert {r.who: r.slug for r in rows if r.who != "OTHER_NURSE"} == EXPECTED
        assert next(r for r in rows if r.who == "OTHER_NURSE").slug == "nurse"
        assert all(r.group_tenant == r.member_tenant for r in rows)   # never across tenants
        assert all(r.source == "manual" for r in rows)
        assert "INACTIVE" not in {r.who for r in rows}                # inactive membership: no group
        users = conn.execute(text("SELECT username, email, auth_source, token_version FROM users")).all()
        assert all(r.username == r.email == r.email.lower() for r in users)
        assert all(r.auth_source == "local" and r.token_version == 0 for r in users)
        nullable = conn.execute(text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'tenant_memberships' AND column_name = 'role'")).scalar_one()
        assert nullable == "YES"
        assert conn.execute(text("SELECT count(*) FROM tenant_memberships WHERE role IS NULL")).scalar_one() == 0


def test_email_case_collisions_block_the_upgrade_before_any_change(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "0005")
    with engine.begin() as conn:
        for email in ("Ayse@example.com", "ayse@example.com"):
            conn.execute(text("INSERT INTO users (id, email, full_name, hashed_password, totp_enabled, "
                              "is_active, is_platform_support) VALUES (:id, :email, 'x', 'x', false, "
                              "true, false)"), {"id": uuid.uuid4(), "email": email})
    with pytest.raises(Exception, match="differ only by case"):
        command.upgrade(cfg, "head")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0005"
        assert conn.execute(text("SELECT to_regclass('public.groups')")).scalar_one() is None
```

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_migration_0006_conversion.py -q`
Expected: `2 passed` with `TEST_DATABASE_URL`, `2 skipped` without.

- [ ] **Step 5c: Prove the migration and the models describe the same RBAC schema**

Tests build the schema with `Base.metadata.create_all`; production builds it with Alembic. A drift
between the two passes every test and fails on the ward, so compare them with Alembic's own
autogenerate comparison, scoped to the tables and columns this migration owns.

```python
# homunculus-engine/tests/test_migration_0006_schema_parity.py
"""Alembic (production) and Base.metadata (tests) must agree on the RBAC tables and the users
columns migration 0006 adds. Scoped to those objects: older tables carry known, harmless
differences (nullable timestamps) that are not this migration's business."""
from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, text

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import TEST_DATABASE_URL, requires_db

pytestmark = [requires_db]

ROOT = Path(__file__).resolve().parents[1]
OWNED_TABLES = {"groups", "group_permissions", "user_groups", "ldap_group_mappings", "users"}
OWNED_USER_COLUMNS = {"username", "email", "hashed_password", "auth_source", "external_id",
                      "ldap_dn", "token_version", "last_login_at"}


def _sync_url() -> str:
    for scheme in ("postgresql+asyncpg://", "postgresql://"):
        if TEST_DATABASE_URL.startswith(scheme):
            return "postgresql+psycopg2://" + TEST_DATABASE_URL[len(scheme):]
    return TEST_DATABASE_URL


def _owned(object_, name, type_, reflected, compare_to):
    """include_object, not include_name: Alembic runs include_name only over the REFLECTED
    (database) side, so excluded-but-existing tables would show up as "missing" on the metadata
    side. include_object is consulted on both sides."""
    if type_ == "table":
        return name in OWNED_TABLES
    if type_ == "column":
        table_name = object_.table.name if object_ is not None else None
        if table_name == "users":
            return name in OWNED_USER_COLUMNS
    return True


@pytest.fixture
def migrated(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    engine = create_engine(_sync_url())
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")
    yield engine
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()


def test_alembic_and_the_models_agree_on_the_rbac_schema(migrated):
    with migrated.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True,
            "compare_server_default": False,   # text renderings differ; the values are tested elsewhere
            "include_object": _owned,
        })
        diffs = compare_metadata(ctx, Base.metadata)
    assert diffs == [], diffs
```

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_migration_0006_schema_parity.py -q`
Expected: `1 passed` with `TEST_DATABASE_URL` (an empty diff list), `1 skipped` without. If it reports a
difference, fix the MIGRATION to match the model unless the model is wrong — the models are what
every service is written against.

- [ ] **Step 5d: The single-head guard**

`tests/test_audit_postgres.py::test_migration_chain_has_a_single_head` pins the head revision; bump its expected value from `"0005"` to `"0006"` (one-line change, separate commit `test(db): bump the single-head guard to 0006`).

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/alembic/versions/0006_groups_and_permissions.py homunculus-engine/tests/test_migration_0006_defaults.py homunculus-engine/tests/test_migration_0006_conversion.py homunculus-engine/tests/test_migration_0006_schema_parity.py
git commit -m "feat(db): migration 0006 — groups, permissions, user columns, legacy role conversion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: Group service

**Files:**
- Create: `homunculus-engine/src/homunculus/auth/groups.py`
- Test: `homunculus-engine/tests/test_groups_service.py` (DB-backed, skipped without `TEST_DATABASE_URL`)

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_groups_service.py
"""Group persistence: seeding, membership, token-version bumps and the administrator count."""
from __future__ import annotations

import pytest

from homunculus.auth.groups import (
    GroupError, bump_group_members, count_admins, ensure_default_groups, groups_of,
    set_manual_groups, summarize, tenant_of_user,
)
from homunculus.auth.models import (
    SOURCE_LDAP, Group, GroupPermission, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]


async def _tenant(db, slug="demo-hastanesi"):
    t = Tenant(name=slug, slug=slug, country_code="TR")
    db.add(t)
    await db.flush()
    return t


async def _user(db, tenant, username, *, active=True):
    u = User(username=username, email=f"{username}@example.com", full_name=username,
             hashed_password="x", is_active=active)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
    await db.flush()
    return u


async def test_seeding_creates_the_defaults_once(db_session):
    t = await _tenant(db_session)
    first = await ensure_default_groups(db_session, t.id)
    second = await ensure_default_groups(db_session, t.id)
    assert set(first) == {g["slug"] for g in DEFAULT_GROUPS}
    assert {s: g.id for s, g in first.items()} == {s: g.id for s, g in second.items()}
    assert first["hospital_admin"].is_system is True
    assert "users.manage" in first["hospital_admin"].permission_keys


async def test_manual_groups_are_replaced_and_ldap_rows_are_kept(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    db_session.add(UserGroup(user_id=u.id, group_id=groups["auditor"].id, source=SOURCE_LDAP))
    await db_session.flush()

    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    slugs = sorted(link.group.slug for link in await groups_of(db_session, u.id, t.id))
    assert slugs == ["auditor", "nurse"]

    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["charge_nurse"].id], granted_by_id=None)
    slugs = sorted(link.group.slug for link in await groups_of(db_session, u.id, t.id))
    assert slugs == ["auditor", "charge_nurse"]          # ldap row survived, manual replaced


async def test_changing_groups_bumps_the_token_version(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    assert u.token_version == 0
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id], granted_by_id=None)
    assert u.token_version == 1


async def test_a_group_from_another_tenant_is_refused(db_session):
    t1 = await _tenant(db_session, "a")
    t2 = await _tenant(db_session, "b")
    g1 = await ensure_default_groups(db_session, t1.id)
    await ensure_default_groups(db_session, t2.id)
    u = await _user(db_session, t2, "ayse")
    with pytest.raises(GroupError):
        await set_manual_groups(db_session, user=u, tenant_id=t2.id,
                                group_ids=[g1["nurse"].id], granted_by_id=None)


async def test_summarize_unions_permissions_and_mfa(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "ayse")
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["nurse"].id, groups["attending"].id],
                            granted_by_id=None)
    s = summarize(await groups_of(db_session, u.id, t.id))
    assert s.slugs == ("attending", "nurse")
    assert "admissions.admit" in s.perms and "admissions.sign_off" in s.perms
    assert s.mfa_required is True                       # attending demands it


async def test_a_system_group_member_holds_the_whole_catalogue_by_rule(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    u = await _user(db_session, t, "admin")
    await set_manual_groups(db_session, user=u, tenant_id=t.id,
                            group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    # Simulate a tenant seeded before a key existed: drop one row from the system group.
    admin = groups["hospital_admin"]
    admin.permissions.remove(next(p for p in admin.permissions if p.permission == "audit.view"))
    await db_session.flush()
    s = summarize(await groups_of(db_session, u.id, t.id))
    assert "audit.view" in s.perms                       # by rule, not by rows


async def test_count_admins_counts_active_users_holding_both_admin_permissions(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    a = await _user(db_session, t, "admin")
    b = await _user(db_session, t, "pasif", active=False)
    for u in (a, b):
        await set_manual_groups(db_session, user=u, tenant_id=t.id,
                                group_ids=[groups["hospital_admin"].id], granted_by_id=None)
    # users.manage alone is not an administrator: groups.manage is needed too.
    half = Group(tenant_id=t.id, slug="user_desk", name="Kullanıcı Masası", is_system=False)
    half.permissions = [GroupPermission(permission="users.manage")]
    db_session.add(half)
    await db_session.flush()
    c = await _user(db_session, t, "yarim")
    await set_manual_groups(db_session, user=c, tenant_id=t.id, group_ids=[half.id],
                            granted_by_id=None)
    assert await count_admins(db_session, t.id) == 1
    assert await count_admins(db_session, t.id, excluding_user_id=a.id) == 0
    assert await count_admins(db_session, t.id, excluding_group_id=groups["hospital_admin"].id) == 0


async def test_bump_group_members_touches_every_member(db_session):
    t = await _tenant(db_session)
    groups = await ensure_default_groups(db_session, t.id)
    a = await _user(db_session, t, "a")
    b = await _user(db_session, t, "b")
    for u in (a, b):
        await set_manual_groups(db_session, user=u, tenant_id=t.id,
                                group_ids=[groups["nurse"].id], granted_by_id=None)
    assert await bump_group_members(db_session, groups["nurse"].id) == 2
    await db_session.refresh(a)
    assert a.token_version == 2                         # 1 from set_manual_groups, 1 from bump


async def test_tenant_of_user_is_the_lowest_slug(db_session):
    t1 = await _tenant(db_session, "kardiyoloji")
    t2 = await _tenant(db_session, "acil")
    u = await _user(db_session, t1, "dr")
    db_session.add(TenantMembership(user_id=u.id, tenant_id=t2.id))
    await db_session.flush()
    ref = await tenant_of_user(db_session, u.id)
    assert ref is not None and ref.slug == "acil" and ref.id == t2.id


async def test_a_user_without_membership_has_no_tenant(db_session):
    u = User(username="yalniz", email="yalniz@example.com", full_name="Yalnız",
             hashed_password="x")
    db_session.add(u)
    await db_session.flush()
    assert await tenant_of_user(db_session, u.id) is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_groups_service.py -q`
Expected: `ModuleNotFoundError: No module named 'homunculus.auth.groups'` — the import fails before any skip

- [ ] **Step 3: Write the service**

```python
# homunculus-engine/src/homunculus/auth/groups.py
"""Group persistence: seeding the defaults, a user's groups, manual membership, token-version
bumps, the administrator count that guards the last admin, and a user's tenant.

Pure decisions (union of permissions, which tenant wins) are in `permissions.py` and
`api/identity.py`; this module is the part that touches the database.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.identity import hospital_for_slugs
from homunculus.auth.models import (
    SOURCE_MANUAL, Group, GroupPermission, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import ALL_PERMISSIONS, DEFAULT_GROUPS, effective_permissions
from homunculus.tenant.models import Tenant


class GroupError(ValueError):
    """A group operation that cannot be carried out (unknown group, wrong tenant)."""


@dataclass(frozen=True)
class GroupSummary:
    slugs: tuple[str, ...]
    names: tuple[str, ...]
    perms: frozenset[str]
    mfa_required: bool


@dataclass(frozen=True)
class TenantRef:
    id: uuid.UUID
    slug: str


async def ensure_default_groups(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Group]:
    """Create any default group this tenant is missing. Idempotent. Returns slug -> Group."""
    result = await db.execute(select(Group).where(Group.tenant_id == tenant_id))
    existing = {g.slug: g for g in result.scalars().all()}
    for spec in DEFAULT_GROUPS:
        if spec["slug"] in existing:
            continue
        group = Group(
            tenant_id=tenant_id, slug=spec["slug"], name=spec["name"],
            description=spec["description"], mfa_required=spec["mfa_required"],
            is_system=spec["is_system"],
        )
        group.permissions = [GroupPermission(permission=p) for p in spec["permissions"]]
        db.add(group)
        existing[spec["slug"]] = group
    await db.flush()
    return existing


async def groups_of(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> list[UserGroup]:
    """The user's group links in one tenant, with `link.group` loaded."""
    stmt = (
        select(UserGroup)
        .join(Group, Group.id == UserGroup.group_id)
        .where(UserGroup.user_id == user_id, Group.tenant_id == tenant_id)
    )
    return list((await db.execute(stmt)).scalars().all())


def summarize(links: Iterable[UserGroup]) -> GroupSummary:
    """What a token is minted from. A SYSTEM group grants the whole catalogue by rule, so an
    administrator never falls behind a catalogue that grew after the tenant was seeded."""
    groups = sorted((link.group for link in links), key=lambda g: g.slug)
    if any(g.is_system for g in groups):
        perms = ALL_PERMISSIONS
    else:
        perms = effective_permissions(g.permission_keys for g in groups)
    return GroupSummary(
        slugs=tuple(g.slug for g in groups),
        names=tuple(g.name for g in groups),
        perms=perms,
        mfa_required=any(g.mfa_required for g in groups),
    )


async def set_manual_groups(
    db: AsyncSession, *, user: User, tenant_id: uuid.UUID,
    group_ids: Iterable[uuid.UUID], granted_by_id: uuid.UUID | None,
) -> list[UserGroup]:
    """Make the user's MANUAL memberships in this tenant exactly `group_ids`. LDAP-sourced rows
    are never touched here. Bumps the user's token version."""
    wanted = set(group_ids)
    if wanted:
        rows = (await db.execute(
            select(Group.id).where(Group.tenant_id == tenant_id, Group.id.in_(wanted))
        )).scalars().all()
        if set(rows) != wanted:
            raise GroupError("unknown group for this tenant")
    current = await groups_of(db, user.id, tenant_id)
    manual = {link.group_id: link for link in current if link.source == SOURCE_MANUAL}
    for group_id, link in manual.items():
        if group_id not in wanted:
            await db.delete(link)
    for group_id in wanted - set(manual):
        db.add(UserGroup(user_id=user.id, group_id=group_id, source=SOURCE_MANUAL,
                         granted_by_id=granted_by_id))
    user.token_version += 1
    await db.flush()
    return await groups_of(db, user.id, tenant_id)


async def bump_group_members(db: AsyncSession, group_id: uuid.UUID) -> int:
    """Invalidate every member's access tokens after the group itself changed."""
    members = select(UserGroup.user_id).where(UserGroup.group_id == group_id)
    result = await db.execute(
        update(User).where(User.id.in_(members)).values(token_version=User.token_version + 1)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount or 0


def _holds(tenant_id: uuid.UUID, permission: str, excluding_group_id: uuid.UUID | None):
    """EXISTS: the outer User has `permission` through some group of the tenant. A system group
    counts for every permission, matching the rule in `summarize`."""
    stmt = (
        select(UserGroup.user_id)
        .join(Group, Group.id == UserGroup.group_id)
        .outerjoin(GroupPermission, GroupPermission.group_id == Group.id)
        .where(UserGroup.user_id == User.id, Group.tenant_id == tenant_id,
               (GroupPermission.permission == permission) | (Group.is_system == True))  # noqa: E712
    )
    if excluding_group_id is not None:
        stmt = stmt.where(Group.id != excluding_group_id)
    return stmt.exists()


async def count_admins(
    db: AsyncSession, tenant_id: uuid.UUID, *,
    excluding_user_id: uuid.UUID | None = None, excluding_group_id: uuid.UUID | None = None,
) -> int:
    """Active ADMINISTRATORS of the tenant: users holding both `users.manage` and
    `groups.manage`, through any of their groups. The last one is protected (spec §6)."""
    stmt = (
        select(func.count(User.id))
        .where(User.is_active == True)  # noqa: E712
        .where(_holds(tenant_id, "users.manage", excluding_group_id))
        .where(_holds(tenant_id, "groups.manage", excluding_group_id))
    )
    if excluding_user_id is not None:
        stmt = stmt.where(User.id != excluding_user_id)
    return int((await db.execute(stmt)).scalar_one())


async def tenant_of_user(db: AsyncSession, user_id: uuid.UUID) -> TenantRef | None:
    """The tenant a user's session runs in: the lowest slug among active memberships — the
    same deterministic rule the board resolver applied per request until now."""
    rows = (await db.execute(
        select(Tenant.id, Tenant.slug)
        .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
        .where(TenantMembership.user_id == user_id,
               TenantMembership.is_active == True)  # noqa: E712
    )).all()
    slug = hospital_for_slugs([row.slug for row in rows])
    if slug is None:
        return None
    return next(TenantRef(id=row.id, slug=row.slug) for row in rows if row.slug == slug)
```

- [ ] **Step 4: Run the tests**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_groups_service.py -q`
Expected: `10 passed` with `TEST_DATABASE_URL`, `10 skipped` without — and no import error either way.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/groups.py homunculus-engine/tests/test_groups_service.py
git commit -m "feat(auth): group service — defaults, membership, token-version bumps, admin count

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: `Principal`, `require_permission` and the MFA gate

`require_roles` stays in this task as a temporary shim (routers still import it); Task 7 deletes it.

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/dependencies.py` (rewrite)
- Test: `homunculus-engine/tests/test_auth_dependencies.py`

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_auth_dependencies.py
"""Authorisation at the route boundary, with the database faked out.

`get_principal_pre_mfa` is the only dependency that touches the database; overriding it lets
every rule above it — permission any-of, the MFA gate, the pre-MFA exceptions — be tested with
a plain FastAPI app and no Postgres. The token-version and claim checks are tested against the
real decoder with `get_user_by_id` monkeypatched.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt

from homunculus.auth import dependencies as deps
from homunculus.auth import jwt as auth_jwt
from homunculus.auth.dependencies import (
    Principal, get_current_user, get_current_user_pre_mfa, get_principal_pre_mfa,
    require_permission,
)
from homunculus.auth.jwt import create_access_token, create_refresh_token
from homunculus.auth.models import User
from homunculus.auth.permissions import UnknownPermission
from homunculus.db import get_db


def _user(**kw) -> User:
    return User(id=kw.get("id", uuid.uuid4()), username="ayse", email="ayse@example.com",
                full_name="Ayşe Demir", is_active=kw.get("is_active", True),
                token_version=kw.get("token_version", 0))


def _principal(perms=(), *, mfa_required=False, mfa_verified=False) -> Principal:
    return Principal(user=_user(), tenant="demo-hastanesi", groups=("nurse",),
                     perms=frozenset(perms), mfa_required=mfa_required, mfa_verified=mfa_verified)


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/ack", dependencies=[Depends(require_permission("alerts.ack"))])
    def ack():
        return {"ok": True}

    @app.get("/either", dependencies=[Depends(require_permission("alerts.ack", "alerts.escalate"))])
    def either():
        return {"ok": True}

    @app.get("/me")
    def me(user: User = Depends(get_current_user_pre_mfa)):
        return {"username": user.username}

    @app.get("/any")
    def any_route(user: User = Depends(get_current_user)):
        return {"username": user.username}

    return app


def _client(principal: Principal) -> TestClient:
    app = _app()
    app.dependency_overrides[get_principal_pre_mfa] = lambda: principal
    return TestClient(app)


def test_a_route_opens_for_a_principal_holding_the_permission():
    assert _client(_principal(["alerts.ack"])).get("/ack").status_code == 200


def test_a_route_is_forbidden_without_the_permission_and_names_it():
    res = _client(_principal(["board.view"])).get("/ack")
    assert res.status_code == 403
    assert "alerts.ack" in res.json()["detail"]


def test_several_keys_mean_any_of_them():
    assert _client(_principal(["alerts.escalate"])).get("/either").status_code == 200
    assert _client(_principal(["board.view"])).get("/either").status_code == 403


def test_an_unknown_permission_key_fails_at_definition_not_at_request_time():
    with pytest.raises(UnknownPermission):
        require_permission("alerts.acknowledge")


def test_the_mfa_gate_blocks_everything_but_the_pre_mfa_routes():
    c = _client(_principal(["alerts.ack"], mfa_required=True, mfa_verified=False))
    assert c.get("/me").status_code == 200
    assert c.get("/any").status_code == 403 and c.get("/any").json()["detail"] == "mfa_required"
    assert c.get("/ack").status_code == 403


def test_the_mfa_gate_opens_once_verified():
    c = _client(_principal(["alerts.ack"], mfa_required=True, mfa_verified=True))
    assert c.get("/any").status_code == 200
    assert c.get("/ack").status_code == 200


def test_a_missing_bearer_is_401_before_any_database_work():
    assert TestClient(_app()).get("/any").status_code == 401


# --- the real decoder and the token-version check --------------------------------------------

@pytest.fixture
def real_client(monkeypatch):
    """The real `get_principal_pre_mfa`, with the user lookup faked and no database."""
    stored = _user(id=uuid.UUID("11111111-1111-1111-1111-111111111111"), token_version=3)

    async def fake_get_user_by_id(_db, user_id):
        return stored if user_id == stored.id else None

    async def no_db():
        yield None

    monkeypatch.setattr(deps, "get_user_by_id", fake_get_user_by_id)
    app = _app()
    app.dependency_overrides[get_db] = no_db
    return TestClient(app), stored


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_a_token_with_the_current_version_is_accepted(real_client):
    client, stored = real_client
    token = create_access_token(str(stored.id), extra={"perms": ["alerts.ack"], "tv": 3})
    assert client.get("/ack", headers=_bearer(token)).status_code == 200


def test_a_token_from_before_a_rights_change_is_refused(real_client):
    client, stored = real_client
    token = create_access_token(str(stored.id), extra={"perms": ["alerts.ack"], "tv": 2})
    res = client.get("/ack", headers=_bearer(token))
    assert res.status_code == 401 and res.json()["detail"] == "token_version"


def test_a_refresh_token_never_authorises_a_route(real_client):
    client, stored = real_client
    assert client.get("/any", headers=_bearer(create_refresh_token(str(stored.id)))).status_code == 401


def test_an_expired_access_token_is_refused(real_client):
    client, stored = real_client
    now = datetime.now(timezone.utc)
    expired = jose_jwt.encode(
        {"sub": str(stored.id), "iat": now - timedelta(hours=2), "exp": now - timedelta(hours=1),
         "jti": "x", "type": "access", "tv": 3},
        auth_jwt.JWT_SECRET, algorithm=auth_jwt.JWT_ALGORITHM,
    )
    assert client.get("/any", headers=_bearer(expired)).status_code == 401


def test_an_unknown_user_is_refused(real_client):
    client, _stored = real_client
    token = create_access_token(str(uuid.uuid4()), extra={"tv": 0})
    assert client.get("/any", headers=_bearer(token)).status_code == 401
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_dependencies.py -q`
Expected: `ImportError: cannot import name 'Principal'`

- [ ] **Step 3: Rewrite `auth/dependencies.py`**

```python
"""
FastAPI dependencies for authentication and authorisation.

    get_principal_pre_mfa   decode the access token, load the user, check is_active and the
                            token version -> Principal (401 on any failure)
    get_principal           + the MFA gate: 403 `mfa_required` while a TOTP step is pending
    get_current_user        the User behind get_principal
    get_current_user_pre_mfa the User behind get_principal_pre_mfa — ONLY for /auth/totp/*, /auth/me
    require_permission(*k)  any-of check against the token's `perms` -> 403 naming the keys

The permission check reads the token, not the database: the token was minted from the user's
groups, and `token_version` guarantees it still reflects them (a change bumps the version and
this dependency refuses the old token, so the client's transparent refresh mints a current one).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import User
from homunculus.auth.permissions import validate_permissions
from homunculus.auth.service import get_user_by_id
from homunculus.db import get_db

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    """Who is calling, as the signed token says — plus the freshly loaded User row."""
    user: User
    tenant: str | None
    groups: tuple[str, ...]
    perms: frozenset[str]
    mfa_required: bool
    mfa_verified: bool


def _unauthorized(detail: str = "Invalid or missing authentication credentials") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail,
                         headers={"WWW-Authenticate": "Bearer"})


def access_claims(token: str) -> dict:
    """Decode an ACCESS token or raise 401. A refresh token (same secret) is refused by `type`."""
    try:
        claims = decode_token(token)
    except JWTError:
        raise _unauthorized()
    if claims.get("type") != "access" or not claims.get("sub"):
        raise _unauthorized()
    return claims


async def get_principal_pre_mfa(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> Principal:
    if not credentials:
        raise _unauthorized()
    claims = access_claims(credentials.credentials)
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except ValueError:
        raise _unauthorized()
    user = await get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    if int(claims.get("tv", 0)) != int(user.token_version):
        # The user's rights changed after this token was minted. The client refreshes and gets
        # a token built from the current groups; nothing is lost but one round trip.
        raise _unauthorized("token_version")
    return Principal(
        user=user,
        tenant=claims.get("tenant"),
        groups=tuple(claims.get("groups") or ()),
        perms=frozenset(claims.get("perms") or ()),
        mfa_required=bool(claims.get("mfa_required")),
        mfa_verified=bool(claims.get("mfa_verified")),
    )


async def get_principal(principal: Principal = Depends(get_principal_pre_mfa)) -> Principal:
    if principal.mfa_required and not principal.mfa_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="mfa_required")
    return principal


async def get_current_user(principal: Principal = Depends(get_principal)) -> User:
    return principal.user


async def get_current_user_pre_mfa(
    principal: Principal = Depends(get_principal_pre_mfa),
) -> User:
    return principal.user


# Existing routers import this name; it is the MFA-gated user, exactly as before.
get_current_active_user = get_current_user


def require_permission(*keys: str):
    """Dependency factory: the caller must hold ANY of `keys`. Unknown keys fail here, at
    import time, so a typo in a route guard stops the service from starting."""
    wanted = frozenset(validate_permissions(keys))

    async def _check(principal: Principal = Depends(get_principal)) -> User:
        if not (principal.perms & wanted):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"permission required: {' or '.join(sorted(wanted))}",
            )
        return principal.user

    return _check


# --------------------------------------------------------------------------------------------
# TEMPORARY SHIM — deleted in Task 7 together with UserRole. Routers still import it; the
# tokens issued from Task 6 on carry no `roles` claim, so this refuses everything until each
# router is moved to require_permission. Nothing ships between those two tasks.
# --------------------------------------------------------------------------------------------
def require_roles(*roles):
    async def _check(principal: Principal = Depends(get_principal)) -> User:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="role guards are being replaced by permissions")
    return _check
```

- [ ] **Step 4: Run the tests**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_dependencies.py -q`
Expected: `12 passed`

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: no import errors; the same pass count as before this task.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/dependencies.py homunculus-engine/tests/test_auth_dependencies.py
git commit -m "feat(auth): Principal, require_permission, token-version check and the MFA gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: Sign-in, token claims, refresh, `/auth/me`, `/auth/password`

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/jwt.py`
- Modify: `homunculus-engine/src/homunculus/auth/service.py` (rewrite)
- Modify: `homunculus-engine/src/homunculus/auth/schemas.py` (rewrite)
- Create: `homunculus-engine/src/homunculus/auth/audit.py`
- Modify: `homunculus-engine/src/homunculus/auth/router.py` (rewrite)
- Test: `homunculus-engine/tests/test_auth_tokens.py` (pure), `homunculus-engine/tests/test_auth_login.py` (DB-backed)

- [ ] **Step 1: Write the failing pure tests**

```python
# homunculus-engine/tests/test_auth_tokens.py
"""Token issuance and the sign-in helpers, without a database."""
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import LoginRequest
from homunculus.auth.service import (
    AuthContext, hash_password, issue_tokens, normalize_login, verify_local_password,
)


def _user(**kw) -> User:
    return User(id=uuid.uuid4(), username="ayse", email="ayse@example.com", full_name="Ayşe",
                hashed_password=kw.get("hashed_password", hash_password("Gizli-123")),
                auth_source=kw.get("auth_source", "local"), token_version=kw.get("tv", 4),
                totp_enabled=kw.get("totp_enabled", False), is_active=True)


def _ctx(**kw) -> AuthContext:
    return AuthContext(tenant_id=uuid.uuid4(), tenant="demo-hastanesi",
                       groups=("nurse",), group_names=("Hemşire",),
                       perms=frozenset({"board.view", "alerts.ack"}),
                       mfa_required=kw.get("mfa_required", False))


def test_the_access_token_carries_tenant_groups_perms_flags_and_version():
    tokens = issue_tokens(_user(), _ctx(), mfa_verified=False)
    claims = decode_token(tokens["access_token"])
    assert claims["tenant"] == "demo-hastanesi"
    assert claims["groups"] == ["nurse"]
    assert claims["perms"] == ["alerts.ack", "board.view"]
    assert claims["mfa_required"] is False and claims["mfa_verified"] is False
    assert claims["tv"] == 4 and claims["type"] == "access"
    assert "roles" not in claims


def test_requires_mfa_means_a_totp_step_is_still_pending():
    assert issue_tokens(_user(), _ctx(mfa_required=True), mfa_verified=False)["requires_mfa"] is True
    assert issue_tokens(_user(), _ctx(mfa_required=True), mfa_verified=True)["requires_mfa"] is False
    assert issue_tokens(_user(), _ctx(mfa_required=False), mfa_verified=False)["requires_mfa"] is False


def test_mfa_enrolled_reports_the_users_totp_state():
    assert issue_tokens(_user(totp_enabled=True), _ctx(), mfa_verified=False)["mfa_enrolled"] is True
    assert issue_tokens(_user(), _ctx(), mfa_verified=False)["mfa_enrolled"] is False


def test_the_refresh_token_remembers_that_mfa_was_verified():
    tokens = issue_tokens(_user(), _ctx(mfa_required=True), mfa_verified=True)
    assert decode_token(tokens["refresh_token"])["mfa_verified"] is True
    assert "tv" not in decode_token(tokens["refresh_token"])


def test_normalize_login_lowercases_and_trims():
    assert normalize_login("  Ayse.Demir@Example.COM ") == "ayse.demir@example.com"
    assert normalize_login(None) == ""


def test_verify_local_password_accepts_the_right_password():
    assert verify_local_password(_user(), "Gizli-123") is True
    assert verify_local_password(_user(), "yanlis") is False


def test_verify_local_password_fails_closed_and_still_costs_a_bcrypt_compare(monkeypatch):
    calls = []
    import homunculus.auth.service as svc
    real = svc.verify_password

    def counting(plain, hashed):
        calls.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(svc, "verify_password", counting)
    assert verify_local_password(None, "x") is False
    assert verify_local_password(_user(hashed_password=None), "x") is False
    assert verify_local_password(_user(auth_source=AUTH_LDAP), "x") is False
    assert len(calls) == 3                      # a dummy compare each time — no timing oracle


def test_login_request_accepts_the_legacy_email_field_as_an_alias():
    assert LoginRequest(email="A@B.co", password="x").identifier == "A@B.co"
    assert LoginRequest(login="ayse", password="x").identifier == "ayse"
    with pytest.raises(ValidationError):
        LoginRequest(password="x")
```

- [ ] **Step 2: Run the pure tests to verify they fail**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_tokens.py -q`
Expected: `ImportError: cannot import name 'AuthContext'`

- [ ] **Step 3: Extend `auth/jwt.py`**

Replace `create_refresh_token` with:

```python
def create_refresh_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    """The refresh token carries `mfa_verified` (set after a TOTP step) so that the hourly
    transparent refresh does not send a verified clinician back to the MFA gate. It never
    carries `tv`: a rights change must survive a refresh, not end the session."""
    payload = {
        "sub": subject,
        "iat": _now(),
        "exp": _now() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "jti": str(uuid.uuid4()),
        "type": "refresh",
        **(extra or {}),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
```

- [ ] **Step 4: Rewrite `auth/service.py`**

```python
"""
Authentication business logic: passwords, the sign-in lookup, the session context a token is
minted from, token issuance, TOTP, password change.
"""
from __future__ import annotations
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import groups_of, summarize, tenant_of_user
from homunculus.auth.jwt import create_access_token, create_refresh_token
from homunculus.auth.models import AUTH_LOCAL, User
from homunculus.auth.totp import generate_provisioning_uri, generate_totp_secret, verify_totp

# bcrypt is used directly: passlib has been unmaintained since 2020 and is incompatible with
# bcrypt >= 4.1 (it raised "password cannot be longer than 72 bytes" for every password, which
# made user creation and login impossible).
_BCRYPT_MAX_BYTES = 72


def _secret(plain: str) -> bytes:
    """Encode for bcrypt, which hashes at most 72 bytes. Longer secrets are truncated — bcrypt's
    own long-standing behaviour, made explicit here instead of left to the driver to reject."""
    return plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_secret(plain), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_secret(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False   # malformed stored hash must fail the login, not crash it


# Compared against when there is no such account, no local password, or an AD account: the
# response then costs the same bcrypt work as a wrong password, so timing does not reveal
# whether a login exists.
_DUMMY_HASH = hash_password("homunculus-no-such-account")


def normalize_login(value: str | None) -> str:
    return (value or "").strip().lower()


async def find_user_by_login(db: AsyncSession, login: str) -> User | None:
    """By username OR e-mail, case-insensitively (both are stored lower-case)."""
    key = normalize_login(login)
    if not key:
        return None
    result = await db.execute(select(User).where(or_(User.username == key, User.email == key)))
    return result.scalars().first()


def verify_local_password(user: User | None, password: str) -> bool:
    """True only for an existing LOCAL account whose bcrypt hash matches. Every other case
    performs a dummy comparison and returns False."""
    if user is None or user.auth_source != AUTH_LOCAL or not user.hashed_password:
        verify_password(password, _DUMMY_HASH)
        return False
    return verify_password(password, user.hashed_password)


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


@dataclass(frozen=True)
class AuthContext:
    """What a token is minted from: the resolved tenant and the user's groups in it."""
    tenant_id: uuid.UUID | None
    tenant: str | None
    groups: tuple[str, ...]
    group_names: tuple[str, ...]
    perms: frozenset[str]
    mfa_required: bool


EMPTY_CONTEXT = AuthContext(None, None, (), (), frozenset(), False)


async def build_context(db: AsyncSession, user: User) -> AuthContext:
    ref = await tenant_of_user(db, user.id)
    if ref is None:
        return EMPTY_CONTEXT
    summary = summarize(await groups_of(db, user.id, ref.id))
    return AuthContext(tenant_id=ref.id, tenant=ref.slug, groups=summary.slugs,
                       group_names=summary.names, perms=summary.perms,
                       mfa_required=summary.mfa_required)


def issue_tokens(user: User, ctx: AuthContext, *, mfa_verified: bool) -> dict:
    """Access + refresh tokens. `requires_mfa` means "a TOTP step is still pending"."""
    access = create_access_token(
        subject=str(user.id),
        extra={
            "tenant": ctx.tenant,
            "groups": list(ctx.groups),
            "perms": sorted(ctx.perms),
            "mfa_required": ctx.mfa_required,
            "mfa_verified": mfa_verified,
            "tv": int(user.token_version),
        },
    )
    refresh = create_refresh_token(subject=str(user.id), extra={"mfa_verified": mfa_verified})
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "requires_mfa": bool(ctx.mfa_required and not mfa_verified),
        "mfa_enrolled": bool(user.totp_enabled),
    }


def mark_login(user: User) -> None:
    user.last_login_at = datetime.now(timezone.utc)


async def setup_totp(db: AsyncSession, user: User) -> tuple[str, str]:
    """Generate and store a new TOTP secret. Returns (secret, provisioning_uri)."""
    secret = generate_totp_secret()
    user.totp_secret = secret
    user.totp_enabled = False  # Only enabled after first successful verify
    await db.commit()
    uri = generate_provisioning_uri(secret, user.email or user.username)
    return secret, uri


async def enable_totp(db: AsyncSession, user: User, code: str) -> bool:
    if not user.totp_secret:
        return False
    if not verify_totp(user.totp_secret, code):
        return False
    user.totp_enabled = True
    await db.commit()
    return True


class PasswordError(ValueError):
    """A password change that cannot be made; the message is shown to the user."""


async def change_password(db: AsyncSession, user: User, current: str, new: str) -> None:
    if user.auth_source != AUTH_LOCAL:
        raise PasswordError("Parola Active Directory tarafından yönetiliyor")
    if not verify_local_password(user, current):
        raise PasswordError("Mevcut parola yanlış")
    if len(new) < 8:
        raise PasswordError("Yeni parola en az 8 karakter olmalı")
    user.hashed_password = hash_password(new)
    user.token_version += 1
    await db.commit()
```

- [ ] **Step 5: Rewrite `auth/schemas.py`**

```python
"""Pydantic request/response schemas for auth endpoints."""
from __future__ import annotations
import uuid
from datetime import datetime

from pydantic import BaseModel, model_validator


class LoginRequest(BaseModel):
    login: str | None = None     # username or e-mail
    email: str | None = None     # legacy alias — the mobile client still sends `email`
    password: str

    @model_validator(mode="after")
    def _needs_an_identifier(self):
        if not (self.login or self.email):
            raise ValueError("login is required")
        return self

    @property
    def identifier(self) -> str:
        return self.login or self.email or ""


class TOTPSetupResponse(BaseModel):
    provisioning_uri: str
    # NOTE: Never include secret in API response — use QR code only
    message: str = "Scan this URI with Google or Microsoft Authenticator"


class TOTPVerifyRequest(BaseModel):
    code: str  # 6-digit TOTP code


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str
    requires_mfa: bool           # a TOTP step is still pending for this session
    mfa_enrolled: bool = False   # the user already has a verified authenticator


class RefreshRequest(BaseModel):
    refresh_token: str


class GroupBrief(BaseModel):
    slug: str
    name: str


class UserMeResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str
    auth_source: str
    totp_enabled: bool
    is_active: bool
    created_at: datetime
    tenant: str | None
    groups: list[GroupBrief]
    perms: list[str]


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
```

- [ ] **Step 6: Create `auth/audit.py`**

```python
# homunculus-engine/src/homunculus/auth/audit.py
"""Auth and admin events go to the same append-only trail as the clinical events.

`create_app` puts the AuditLog on `app.state.audit`; a router mounted anywhere else (a bare
FastAPI in a test) simply has no trail, and that must not turn into a 500 on sign-in.
"""
from __future__ import annotations

from fastapi import Request

from homunculus.api.audit import AuditEvent


def append_audit(request: Request, *, tenant: str | None, event_type: str, subject: str,
                 payload: dict) -> None:
    log = getattr(request.app.state, "audit", None)
    if log is None:
        return
    log.append(AuditEvent(tenant or "-", event_type, "", subject, payload))
```

- [ ] **Step 7: Rewrite `auth/router.py`**

```python
"""
Auth API routes.
POST /auth/login        — username or e-mail + password; returns tokens (requires_mfa when a
                          TOTP step is still pending, mfa_enrolled when the user has one)
POST /auth/totp/setup   — generate TOTP secret + QR provisioning URI (allowed before MFA)
POST /auth/totp/verify  — verify 6-digit code; re-issues tokens with mfa_verified=True
POST /auth/refresh      — exchange refresh token for new tokens built from the CURRENT groups
GET  /auth/me           — profile, tenant, groups, permissions (allowed before MFA)
POST /auth/password     — change own password (local accounts)
"""
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import get_current_user, get_current_user_pre_mfa
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, User
from homunculus.auth.schemas import (
    GroupBrief, LoginRequest, PasswordChangeRequest, RefreshRequest, TOTPSetupResponse,
    TOTPVerifyRequest, TokenResponse, UserMeResponse,
)
from homunculus.auth.service import (
    PasswordError, build_context, change_password, enable_totp, find_user_by_login,
    get_user_by_id, issue_tokens, mark_login, normalize_login, setup_totp,
    verify_local_password,
)
from homunculus.auth.totp import verify_totp
from homunculus.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse, summary="Sign in with username or e-mail")
async def login(body: LoginRequest, request: Request,
                db: AsyncSession = Depends(get_db)) -> TokenResponse:
    key = normalize_login(body.identifier)
    user = await find_user_by_login(db, key)

    if user is not None and user.auth_source == AUTH_LDAP:
        # Plan 2 wires the directory in here. Until then an AD account cannot sign in, and the
        # reason is the directory — a 503 the clinician should report, never a 401.
        append_audit(request, tenant=None, event_type="auth", subject="login.fail",
                     payload={"login": key, "reason": "directory_unavailable"})
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Dizin sunucusuna ulaşılamıyor")

    if not verify_local_password(user, body.password):
        append_audit(request, tenant=None, event_type="auth", subject="login.fail",
                     payload={"login": key, "reason": "bad_credentials"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        append_audit(request, tenant=None, event_type="auth", subject="login.fail",
                     payload={"login": key, "reason": "inactive"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    ctx = await build_context(db, user)
    mark_login(user)
    await db.commit()
    append_audit(request, tenant=ctx.tenant, event_type="auth", subject="login.ok",
                 payload={"login": key, "user": user.username, "source": user.auth_source})
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=False))


@router.post("/totp/setup", response_model=TOTPSetupResponse, summary="Setup TOTP authenticator")
async def totp_setup(
    current_user: User = Depends(get_current_user_pre_mfa),
    db: AsyncSession = Depends(get_db),
) -> TOTPSetupResponse:
    _secret, uri = await setup_totp(db, current_user)
    return TOTPSetupResponse(provisioning_uri=uri)


@router.post("/totp/verify", response_model=TokenResponse,
             summary="Verify TOTP and get MFA-verified tokens")
async def totp_verify(
    body: TOTPVerifyRequest,
    current_user: User = Depends(get_current_user_pre_mfa),
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TOTP not set up")

    if not current_user.totp_enabled:
        # First-time activation.
        if not await enable_totp(db, current_user, body.code):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")
    elif not verify_totp(current_user.totp_secret, body.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")

    ctx = await build_context(db, current_user)
    return TokenResponse(**issue_tokens(current_user, ctx, mfa_verified=True))


@router.post("/refresh", response_model=TokenResponse,
             summary="Exchange refresh token for tokens built from the current groups")
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
    )
    try:
        payload = decode_token(body.refresh_token)
        if payload.get("type") != "refresh":
            raise credentials_exc
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError, KeyError):
        raise credentials_exc

    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise credentials_exc

    ctx = await build_context(db, user)
    return TokenResponse(**issue_tokens(user, ctx, mfa_verified=bool(payload.get("mfa_verified"))))


@router.get("/me", response_model=UserMeResponse, summary="Current user profile")
async def me(current_user: User = Depends(get_current_user_pre_mfa),
             db: AsyncSession = Depends(get_db)) -> UserMeResponse:
    ctx = await build_context(db, current_user)
    return UserMeResponse(
        id=current_user.id, username=current_user.username, email=current_user.email,
        full_name=current_user.full_name, auth_source=current_user.auth_source,
        totp_enabled=current_user.totp_enabled, is_active=current_user.is_active,
        created_at=current_user.created_at, tenant=ctx.tenant,
        groups=[GroupBrief(slug=s, name=n) for s, n in zip(ctx.groups, ctx.group_names)],
        perms=sorted(ctx.perms),
    )


@router.post("/password", summary="Change own password (local accounts)")
async def password(body: PasswordChangeRequest, request: Request,
                   current_user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)) -> dict:
    try:
        await change_password(db, current_user, body.current_password, body.new_password)
    except PasswordError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    append_audit(request, tenant=None, event_type="auth", subject="password.change",
                 payload={"user": current_user.username})
    return {"ok": True}
```

- [ ] **Step 8: Run the pure tests**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_tokens.py tests/test_auth_dependencies.py -q`
Expected: `20 passed`

- [ ] **Step 9: Write the DB-backed sign-in tests**

```python
# homunculus-engine/tests/test_auth_login.py
"""Sign-in end to end against the real router, the real dependencies and a test Postgres.

The app is driven through httpx's ASGI transport on the SAME event loop as the db_session
fixture — a TestClient would run the app on another loop and asyncpg connections cannot cross
loops.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
from homunculus.auth.service import hash_password
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

PASSWORD = "Gizli-123"


@pytest_asyncio.fixture
async def world(db_session):
    """One tenant with its default groups, an admin (MFA group) and a nurse (no MFA)."""
    tenant = Tenant(name="Demo", slug="demo-hastanesi", country_code="TR")
    db_session.add(tenant)
    await db_session.flush()
    groups = await ensure_default_groups(db_session, tenant.id)

    async def make(username, email, group_slug, **kw):
        u = User(username=username, email=email, full_name=username.title(),
                 hashed_password=kw.pop("hashed_password", hash_password(PASSWORD)), **kw)
        db_session.add(u)
        await db_session.flush()
        db_session.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
        await db_session.flush()
        await set_manual_groups(db_session, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
        return u

    admin = await make("admin", "admin@example.com", "hospital_admin")
    nurse = await make("ayse", "ayse.demir@example.com", "nurse")
    ldap_user = await make("ldapci", "ldapci@example.com", "nurse", auth_source=AUTH_LDAP,
                           hashed_password=None)
    await make("pasif", "pasif@example.com", "nurse", is_active=False)
    await db_session.commit()
    return {"tenant": tenant, "groups": groups, "admin": admin, "nurse": nurse, "ldap": ldap_user}


@pytest_asyncio.fixture
async def client(db_session):
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, app


async def _login(c, login, password=PASSWORD):
    return await c.post("/auth/login", json={"login": login, "password": password})


async def test_sign_in_by_username_and_by_email_case_insensitively(client, world):
    c, _ = client
    assert (await _login(c, "ayse")).status_code == 200
    assert (await _login(c, "AYSE.DEMIR@example.com")).status_code == 200


async def test_the_legacy_email_field_still_signs_in(client, world):
    c, _ = client
    res = await c.post("/auth/login", json={"email": "ayse", "password": PASSWORD})
    assert res.status_code == 200


async def test_the_token_carries_the_groups_and_permissions(client, world):
    c, _ = client
    body = (await _login(c, "ayse")).json()
    claims = decode_token(body["access_token"])
    assert claims["tenant"] == "demo-hastanesi" and claims["groups"] == ["nurse"]
    assert "admissions.admit" in claims["perms"] and "users.manage" not in claims["perms"]
    assert body["requires_mfa"] is False


async def test_an_mfa_group_member_is_held_at_the_gate_and_told_to_enrol(client, world):
    c, _ = client
    body = (await _login(c, "admin")).json()
    assert body["requires_mfa"] is True and body["mfa_enrolled"] is False
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    assert (await c.get("/auth/me", headers=headers)).status_code == 200      # allowed pre-MFA
    assert (await c.post("/auth/password", headers=headers,
                         json={"current_password": PASSWORD, "new_password": "Yeni-Parola-1"})
            ).status_code == 403                                            # gated


async def test_wrong_password_unknown_login_and_inactive_are_all_401(client, world):
    c, _ = client
    assert (await _login(c, "ayse", "yanlis")).status_code == 401
    assert (await _login(c, "kimse")).status_code == 401
    assert (await _login(c, "pasif")).status_code == 401


async def test_an_ad_account_gets_503_not_401_until_the_directory_exists(client, world):
    c, _ = client
    res = await _login(c, "ldapci", "her-neyse")
    assert res.status_code == 503
    assert "Dizin" in res.json()["detail"]


async def test_me_reports_groups_and_permissions(client, world):
    c, _ = client
    token = (await _login(c, "ayse")).json()["access_token"]
    me = (await c.get("/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["username"] == "ayse" and me["tenant"] == "demo-hastanesi"
    assert me["groups"] == [{"slug": "nurse", "name": "Hemşire"}]
    assert "board.view" in me["perms"]


async def test_a_group_change_invalidates_the_old_token_and_refresh_carries_the_new_rights(
        client, world, db_session):
    c, _ = client
    tokens = (await _login(c, "ayse")).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert (await c.get("/auth/me", headers=headers)).status_code == 200

    await set_manual_groups(db_session, user=world["nurse"], tenant_id=world["tenant"].id,
                            group_ids=[world["groups"]["charge_nurse"].id], granted_by_id=None)
    await db_session.commit()

    assert (await c.get("/auth/me", headers=headers)).status_code == 401
    refreshed = (await c.post("/auth/refresh",
                              json={"refresh_token": tokens["refresh_token"]})).json()
    claims = decode_token(refreshed["access_token"])
    assert claims["groups"] == ["charge_nurse"] and "shifts.manage" in claims["perms"]


async def test_password_change_works_and_retires_the_old_token(client, world):
    c, _ = client
    tokens = (await _login(c, "ayse")).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    res = await c.post("/auth/password", headers=headers,
                       json={"current_password": PASSWORD, "new_password": "Yeni-Parola-1"})
    assert res.status_code == 200
    assert (await c.get("/auth/me", headers=headers)).status_code == 401   # tv bumped
    assert (await _login(c, "ayse", "Yeni-Parola-1")).status_code == 200
    assert (await _login(c, "ayse", PASSWORD)).status_code == 401


async def test_sign_ins_are_audited_without_the_password(client, world):
    c, app = client
    await _login(c, "ayse")
    await _login(c, "ayse", "yanlis")
    records = app.state.audit.records(event_type="auth")
    subjects = [r.subject for r in records]
    assert "login.ok" in subjects and "login.fail" in subjects
    for r in records:
        assert PASSWORD not in str(r.payload) and "yanlis" not in str(r.payload)
```

- [ ] **Step 10: Run the DB-backed tests**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_auth_login.py -q`
Expected: `10 passed` with `TEST_DATABASE_URL`, `10 skipped` without.

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: all pass. (`tests/test_auth_seed.py` still imports `UserRole`, which exists until Task 7.)

- [ ] **Step 11: Commit**

```bash
git add homunculus-engine/src/homunculus/auth/jwt.py homunculus-engine/src/homunculus/auth/service.py homunculus-engine/src/homunculus/auth/schemas.py homunculus-engine/src/homunculus/auth/audit.py homunculus-engine/src/homunculus/auth/router.py homunculus-engine/tests/test_auth_tokens.py homunculus-engine/tests/test_auth_login.py
git commit -m "feat(auth): sign in by username or e-mail; tokens carry tenant, groups, perms, MFA flags and tv; own-password change; auth audit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: Route guards move to permissions; `UserRole` is deleted; the seed uses groups

**Files:**
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/src/homunculus/escalation/router.py`
- Modify: `homunculus-engine/src/homunculus/tenant/router.py`
- Modify: `homunculus-engine/src/homunculus/auth/models.py` (delete `UserRole`)
- Modify: `homunculus-engine/src/homunculus/auth/dependencies.py` (delete the `require_roles` shim)
- Modify: `homunculus-engine/src/homunculus/auth/totp.py` (docstring)
- Modify: `homunculus-engine/src/homunculus/auth/seed.py` (rewrite)
- Modify: `homunculus-engine/tests/test_auth_seed.py` (rewrite)

- [ ] **Step 1: Rewrite the seed test (it will fail until the seed is rewritten)**

```python
# homunculus-engine/tests/test_auth_seed.py
"""
Bootstrap seeding: the first tenant, its default groups, and one administrator in
`hospital_admin`. Without this a fresh database has zero users and nobody can sign in.
Synthetic credentials only — real deployments pass their own via environment variables.
"""
from __future__ import annotations

import pytest
from sqlalchemy import func, select

from homunculus.auth.groups import groups_of
from homunculus.auth.models import Group, TenantMembership, User
from homunculus.auth.seed import seed_bootstrap
from homunculus.auth.service import verify_password
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

ARGS = dict(
    tenant_name="Demo Hastanesi", tenant_slug="demo-hastanesi", country_code="TR",
    email="Admin@Example.com", full_name="Demo Yönetici", password="Str0ng-Pass-123",
)


async def test_seed_creates_tenant_groups_admin_and_membership(db_session):
    tenant, user = await seed_bootstrap(db_session, **ARGS)

    assert tenant.slug == "demo-hastanesi"
    assert user.username == "admin@example.com" and user.email == "admin@example.com"
    assert user.is_active is True and user.auth_source == "local"
    assert user.hashed_password != "Str0ng-Pass-123"
    assert verify_password("Str0ng-Pass-123", user.hashed_password)

    membership = (await db_session.execute(
        select(TenantMembership).where(TenantMembership.user_id == user.id)
    )).scalar_one()
    assert membership.tenant_id == tenant.id and membership.role is None

    slugs = [link.group.slug for link in await groups_of(db_session, user.id, tenant.id)]
    assert slugs == ["hospital_admin"]
    assert (await db_session.execute(
        select(func.count(Group.id)).where(Group.tenant_id == tenant.id))).scalar_one() == 11


async def test_seed_is_idempotent(db_session):
    await seed_bootstrap(db_session, **ARGS)
    await seed_bootstrap(db_session, **ARGS)   # re-running must not duplicate

    assert (await db_session.execute(select(func.count(User.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Tenant.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(TenantMembership.id)))).scalar_one() == 1
    assert (await db_session.execute(select(func.count(Group.id)))).scalar_one() == 11


async def test_seed_refuses_an_email_the_login_api_would_reject(db_session):
    """`.local` / `localhost` fail EmailStr validation; refuse them at seed time so no
    deployment ships an administrator whose address the UI's own validation rejects."""
    with pytest.raises(ValueError, match="e-posta|email"):
        await seed_bootstrap(db_session, **{**ARGS, "email": "admin@hastane.local"})
```

- [ ] **Step 2: Rewrite `auth/seed.py`**

```python
"""
Bootstrap seeding — the first tenant, its default groups, and its first administrator.

A freshly migrated database has no users, so nobody could sign in and no admin could create
anyone. This module creates that first account. It is **idempotent**: running it again on an
already-seeded database changes nothing.

Credentials come from the caller (CLI reads them from the environment) — never hardcoded.
"""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.auth.groups import ensure_default_groups, groups_of, set_manual_groups
from homunculus.auth.models import TenantMembership, User
from homunculus.auth.service import hash_password, normalize_login
from homunculus.tenant.models import Tenant


class _EmailCheck(BaseModel):
    """The dashboard validates addresses the same way; never seed one it would refuse."""
    email: EmailStr


def _validate_email(email: str) -> None:
    try:
        _EmailCheck(email=email)
    except ValidationError as exc:
        raise ValueError(
            f"Geçersiz e-posta {email!r}: giriş ekranı bu adresi kabul etmez, "
            f"bu hesapla giriş yapılamaz."
        ) from exc


async def seed_bootstrap(
    db: AsyncSession,
    *,
    tenant_name: str,
    tenant_slug: str,
    country_code: str,
    email: str,
    full_name: str,
    password: str,
    timezone: str = "UTC",
) -> tuple[Tenant, User]:
    """Create (or return) the bootstrap tenant, its default groups, the admin user, the
    membership, and the admin's `hospital_admin` group membership."""
    _validate_email(email)
    key = normalize_login(email)

    tenant = (await db.execute(
        select(Tenant).where(Tenant.slug == tenant_slug)
    )).scalar_one_or_none()
    if tenant is None:
        tenant = Tenant(
            name=tenant_name, slug=tenant_slug,
            country_code=country_code.upper(), timezone=timezone,
        )
        db.add(tenant)
        await db.flush()
    groups = await ensure_default_groups(db, tenant.id)

    user = (await db.execute(
        select(User).where(User.username == key)
    )).scalar_one_or_none()
    if user is None:
        user = User(
            username=key, email=key, full_name=full_name,
            hashed_password=hash_password(password), is_active=True,
        )
        db.add(user)
        await db.flush()

    membership = (await db.execute(
        select(TenantMembership).where(
            TenantMembership.user_id == user.id,
            TenantMembership.tenant_id == tenant.id,
        )
    )).scalar_one_or_none()
    if membership is None:
        db.add(TenantMembership(user_id=user.id, tenant_id=tenant.id))
        await db.flush()

    held = {link.group.slug for link in await groups_of(db, user.id, tenant.id)}
    if "hospital_admin" not in held:
        await set_manual_groups(db, user=user, tenant_id=tenant.id,
                                group_ids=[groups["hospital_admin"].id], granted_by_id=None)

    await db.commit()
    await db.refresh(tenant)
    await db.refresh(user)
    return tenant, user
```

- [ ] **Step 3: Move the admission router to permissions**

In `admission/router.py`, replace the two auth imports:

```python
from homunculus.auth.dependencies import require_permission
from homunculus.auth.models import User
```

Replace the module docstring's "Role guards follow…" paragraph with:

```python
"""
FastAPI routes for the patient admission workflow (§4, §5).

Permission guards (see auth/permissions.py):
  * admissions.admit           open an admission
  * admissions.view            list / read admissions, patients and care teams
  * admissions.sign_off        physician sign-off
  * admissions.move.initiate   initiate a transfer or discharge
  * admissions.transfer.confirm   confirm a transfer arrival
  * admissions.discharge.confirm  confirm a discharge, release the bed
  * care_team.claim / .assign  claim or assign a care-team role
  * shifts.manage              shift schedules
  * handover.sign              open, sign, countersign a handover

PHI: patient identity is returned only in the admission-detail endpoint. List and
board contexts never include patient identity here.
"""
```

Then change every guard — the old text on the left becomes the new text on the right:

| Route | Old | New |
| --- | --- | --- |
| `POST ""` create_admission | `dependencies=[Depends(require_roles(UserRole.NURSE, UserRole.CHARGE_NURSE))]` | `dependencies=[Depends(require_permission("admissions.admit"))]` |
| `GET ""`, `GET /{id}`, `GET /{id}/patient`, `GET /{id}/care-team` | `dependencies=[Depends(get_current_active_user)]` | `dependencies=[Depends(require_permission("admissions.view"))]` |
| sign_off | `user: User = Depends(require_roles(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),` | `user: User = Depends(require_permission("admissions.sign_off")),` |
| claim_attending | `user: User = Depends(require_roles(\n        UserRole.ATTENDING, UserRole.CHARGE_NURSE, UserRole.HOSPITAL_ADMIN)),` | `user: User = Depends(require_permission("care_team.claim")),` |
| add_care_team_member | `user: User = Depends(require_roles(UserRole.ATTENDING)),` | `user: User = Depends(require_permission("care_team.assign")),` |
| transfer_initiate, discharge_initiate | `user: User = Depends(require_roles(UserRole.ATTENDING, UserRole.UNIT_PHYSICIAN)),` | `user: User = Depends(require_permission("admissions.move.initiate")),` |
| transfer_confirm | `user: User = Depends(require_roles(UserRole.NURSE, UserRole.CHARGE_NURSE)),` | `user: User = Depends(require_permission("admissions.transfer.confirm")),` |
| discharge_confirm | `user: User = Depends(require_roles(UserRole.CHARGE_NURSE)),` | `user: User = Depends(require_permission("admissions.discharge.confirm")),` |
| create_shift_schedule | `user: User = Depends(require_roles(UserRole.CHARGE_NURSE)),` | `user: User = Depends(require_permission("shifts.manage")),` |
| open_handover, sign_outgoing, countersign | `user: User = Depends(get_current_active_user),` | `user: User = Depends(require_permission("handover.sign")),` |

The `_admin`-style comment lines that mention roles ("Attending claims themselves; charge nurse / admin assign…") stay as they are.

- [ ] **Step 4: Move the escalation router to permissions**

In `escalation/router.py`, replace the import line `from homunculus.auth.dependencies import get_current_active_user` with `from homunculus.auth.dependencies import require_permission`, replace the docstring's "Role guards follow…" block with:

```python
"""
FastAPI routes for the alarm, escalation and break-glass subsystem.

Permission guards (see auth/permissions.py):
  * alerts.escalate   create an alert manually; escalate one to the RRT tier
  * alerts.ack        acknowledge or snooze (CRITICAL acknowledgement enforces reason + note)
  * break_glass.use   open, extend, close a break-glass session

PHI: alerts carry only internal ids plus a PHI-minimal summary (bed label + finding),
never patient-identifiable data.
"""
```

and change the guards:

| Route | New parameter line |
| --- | --- |
| create_alert, manual_escalate | `user: User = Depends(require_permission("alerts.escalate")),` |
| acknowledge_alert, snooze_alert | `user: User = Depends(require_permission("alerts.ack")),` |
| activate_break_glass, extend_break_glass, close_break_glass | `user: User = Depends(require_permission("break_glass.use")),` |

- [ ] **Step 5: Move the tenant router to permissions and seed groups on tenant creation**

In `tenant/router.py`:

```python
from homunculus.auth.dependencies import require_permission
from homunculus.auth.groups import ensure_default_groups
from homunculus.db import get_db
```

(delete `from homunculus.auth.models import UserRole`), replace

```python
# Only HOSPITAL_ADMIN may configure the physical hierarchy (§2).
_admin = Depends(require_roles(UserRole.HOSPITAL_ADMIN))
```

with

```python
# The physical hierarchy is configured by whoever holds structure.manage (hospital_admin by
# default). Mutations AND reads: the tree names units and beds, which is operational data.
_admin = Depends(require_permission("structure.manage"))
```

and in `create_tenant`, after `db.add(tenant)` add a flush and the group seeding:

```python
    db.add(tenant)
    await db.flush()
    # A tenant without its default groups could never be administered.
    await ensure_default_groups(db, tenant.id)
    await db.commit()
```

- [ ] **Step 6: Delete `UserRole`, the shim, and the role list in the TOTP docstring**

In `auth/models.py` delete the whole `class UserRole(str, enum.Enum): …` block, the `MFA_REQUIRED_ROLES` set that Task 2 kept alongside it (Task 6's `service.py` no longer imports it), and the `import enum` line. In `auth/dependencies.py` delete everything from the `# TEMPORARY SHIM` comment block to the end of the file. In `auth/totp.py` replace the docstring with:

```python
"""
TOTP utilities using pyotp.
Whether MFA is required is a property of the user's groups (`groups.mfa_required`).
"""
```

- [ ] **Step 7: Verify nothing tracked still references the old names**

Run: `cd homunculus-engine && grep -rn "require_roles\|UserRole\|MFA_REQUIRED_ROLES\|get_current_active_user" src tests --include=*.py`
Expected: only `src/homunculus/api/infinity_research.py` (untracked, Infinity branch) and, for `get_current_active_user`, only its alias definition in `auth/dependencies.py`.

- [ ] **Step 8: Run the suite**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: all pass (the seed tests are skipped without `TEST_DATABASE_URL`; with it, 3 pass).

- [ ] **Step 9: Commit**

```bash
git add homunculus-engine/src/homunculus/admission/router.py homunculus-engine/src/homunculus/escalation/router.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/src/homunculus/auth/models.py homunculus-engine/src/homunculus/auth/dependencies.py homunculus-engine/src/homunculus/auth/totp.py homunculus-engine/src/homunculus/auth/seed.py homunculus-engine/tests/test_auth_seed.py
git commit -m "feat(auth): every router guards by permission; UserRole and require_roles removed; seed puts the admin in hospital_admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: The board routes resolve a JWT to a `Caller` and check permissions

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/identity.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py`
- Modify: `homunculus-engine/tests/test_dual_credentials.py`
- Test: `homunculus-engine/tests/test_board_permissions.py`

- [ ] **Step 1: Write the failing tests**

Replace the fixture in `tests/test_dual_credentials.py` with one that returns a `Caller`:

```python
import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller


@pytest.fixture
def client():
    async def fake_jwt(token: str) -> Caller | None:
        # Stands in for: decode JWT -> load user -> check active + tv -> Caller from claims.
        if token == "valid-jwt":
            return Caller(hospital="demo-hastanesi", actor="dr.elif", groups=("attending",),
                          perms=frozenset({"board.view", "alerts.ack"}))
        return None

    app = create_app(
        {"bridge-token": "demo-hastanesi"},
        run_escalation_loop=False,
        resolve_jwt=fake_jwt,
    )
    with TestClient(app) as c:
        yield c
```

Every existing test in that file stays as written. Then create:

```python
# homunculus-engine/tests/test_board_permissions.py
"""The board routes check the caller's permissions — for a JWT. The device path (static tenant
token) is a machine credential and is exempt, exactly as before."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent

CALLERS = {
    "nurse-jwt": Caller(hospital="HOSP1", actor="ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "alerts.ack"})),
    "auditor-jwt": Caller(hospital="HOSP1", actor="denetci", groups=("auditor",),
                          perms=frozenset({"board.view", "audit.view"})),
    "biomed-jwt": Caller(hospital="HOSP1", actor="ahmet", groups=("biomedical",),
                         perms=frozenset({"devices.manage"})),
}


@pytest.fixture
def client():
    async def resolve(token):
        return CALLERS.get(token)

    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False, resolve_jwt=resolve)
    with TestClient(app) as c:
        yield c


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    return "bed-3"


def test_board_view_opens_the_board_and_the_ticket(client):
    assert client.get("/patients", headers=_hdr("nurse-jwt")).status_code == 200
    assert client.get("/alerts/bed-3", headers=_hdr("nurse-jwt")).status_code == 200
    assert client.post("/stream-ticket", headers=_hdr("nurse-jwt")).status_code == 200


def test_without_board_view_the_board_is_forbidden_not_unauthorised(client):
    res = client.get("/patients", headers=_hdr("biomed-jwt"))
    assert res.status_code == 403 and "board.view" in res.json()["detail"]
    assert client.post("/stream-ticket", headers=_hdr("biomed-jwt")).status_code == 403


def test_ack_needs_alerts_ack_and_is_attributed_to_the_token_not_the_body(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "doctor"},
                      headers=_hdr("nurse-jwt"))
    assert res.status_code == 200
    shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] == "ayse"          # the signed-in user, not "doctor"

    audit = client.get("/audit?event_type=ack", headers=_hdr("auditor-jwt")).json()["records"]
    assert audit[-1]["payload"]["role"] == "ayse" and audit[-1]["payload"]["groups"] == ["nurse"]


def test_ack_is_forbidden_without_alerts_ack(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock"},
                      headers=_hdr("auditor-jwt"))
    assert res.status_code == 403


def test_audit_needs_audit_view(client):
    assert client.get("/audit", headers=_hdr("auditor-jwt")).status_code == 200
    assert client.get("/audit", headers=_hdr("nurse-jwt")).status_code == 403


def test_view_is_recorded_for_the_signed_in_user(client):
    assert client.post("/view", json={"patient_id": "bed-3", "role": "whatever"},
                       headers=_hdr("nurse-jwt")).status_code == 200
    rec = client.get("/audit?event_type=view", headers=_hdr("auditor-jwt")).json()["records"][-1]
    assert rec["payload"]["role"] == "ayse"


def test_the_device_token_is_exempt_and_keeps_the_body_role(client):
    p = _drive_shock(client)
    res = client.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"},
                      headers=_hdr("tok"))
    assert res.status_code == 200
    shock = next(a for a in res.json()["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged_by"] == "nurse"
    assert client.get("/audit", headers=_hdr("tok")).status_code == 200
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_dual_credentials.py tests/test_board_permissions.py -q`
Expected: `ImportError: cannot import name 'Caller'`

- [ ] **Step 3: Add `Caller` to `api/identity.py`**

Append to the module (keep `hospital_for_slugs` and `unmatched_hospital_keys`):

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class Caller:
    """Who is calling a board route.

    A device (the bridge's static tenant token) has no `actor`: it is a machine identity and
    is exempt from permission checks — it can only ever reach the hospital its token names.
    A clinician's JWT resolves to an actor, their groups and their permissions.
    """
    hospital: str
    actor: str | None = None
    groups: tuple[str, ...] = ()
    perms: frozenset[str] = frozenset()

    @property
    def is_device(self) -> bool:
        return self.actor is None

    def can(self, permission: str) -> bool:
        return self.is_device or permission in self.perms
```

Move the `from dataclasses import dataclass` line up with the other imports.

- [ ] **Step 4: Change `create_app` in `api/app.py`**

Add the import `from homunculus.api.identity import Caller` next to the other `homunculus.api` imports. In the `create_app` signature replace

```python
    resolve_jwt_hospital: Callable[[str], Awaitable[str | None]] | None = None,
```

with

```python
    resolve_jwt: Callable[[str], Awaitable[Caller | None]] | None = None,
```

and in the docstring replace the sentence starting "`resolve_jwt_hospital`, if given, …" with:

```
    `resolve_jwt`, if given, resolves a clinician's JWT to a `Caller` (hospital, actor, groups,
    permissions), letting the board routes accept a JWT as well as the tenant token and check
    permissions — injected so it can be tested without Postgres.
```

Replace the whole `_hospital` function with:

```python
    async def _caller(authorization: str | None) -> Caller:
        """Resolve the caller from either credential.

        The static token is tried first: it is the device path, and it must not depend on the
        database being reachable for authentication. Only then is the value treated as a JWT.
        """
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        credential = authorization.split(" ", 1)[1]

        hospital = tenants.get(credential)
        if hospital is not None:
            return Caller(hospital=hospital)

        if resolve_jwt is not None:
            caller = await resolve_jwt(credential)
            if caller is not None:
                return caller

        raise HTTPException(status_code=401, detail="unknown credential")

    def _require(caller: Caller, permission: str) -> None:
        """A device passes; a clinician needs the permission in their token."""
        if not caller.can(permission):
            raise HTTPException(status_code=403, detail=f"permission required: {permission}")
```

Then update each route. `/ingest`: replace its first line `hospital = await _hospital(authorization)` with

```python
        hospital = (await _caller(authorization)).hospital
```

`/ack`:

```python
    @app.post("/ack")
    async def ack(authorization: str | None = Header(default=None), body: dict = Body(...)):
        caller = await _caller(authorization)
        _require(caller, "alerts.ack")
        hospital = caller.hospital
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind = body.get("patient_id"), body.get("kind")
        # A clinician is attributed from the signed token; only the device path may name a role.
        actor = caller.actor or body.get("role", "unknown")
        if (patient_id, kind) not in _live_keys(engine):
            raise HTTPException(status_code=404, detail="no such active alert")
        store.acknowledge(patient_id, kind, actor, datetime.now(timezone.utc))
        store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        audit.append(AuditEvent(hospital, "ack", patient_id, kind,
                                {"role": actor, "groups": list(caller.groups),
                                 "at": datetime.now(timezone.utc).isoformat()}))
        board = patient_board(engine, patient_id, store,
                              identity=identities.get(hospital, patient_id))
        await broadcaster.publish(hospital, board)
        return board
```

`/view`:

```python
    @app.post("/view")
    async def view(authorization: str | None = Header(default=None), body: dict = Body(...)):
        """Record that a clinician opened a patient — attributed from the token."""
        caller = await _caller(authorization)
        _require(caller, "board.view")
        patient_id = body.get("patient_id", "")
        audit.append(AuditEvent(caller.hospital, "view", patient_id, "",
                                {"role": caller.actor or body.get("role", "unknown"),
                                 "groups": list(caller.groups)}))
        return {"ok": True}
```

`/patients`, `/alerts/{patient_id}`, `/stream-ticket` — replace the `hospital = await _hospital(authorization)` line in each with:

```python
        caller = await _caller(authorization)
        _require(caller, "board.view")
        hospital = caller.hospital
```

`/audit`:

```python
        caller = await _caller(authorization)
        _require(caller, "audit.view")
        hospital = caller.hospital
```

- [ ] **Step 5: Run the tests**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_dual_credentials.py tests/test_board_permissions.py tests/test_api_ack.py tests/test_api_audit.py -q`
Expected: all pass (`test_api_ack.py` and `test_api_audit.py` use the device token and are unchanged).

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: only `tests/test_jwt_hospital_lookup.py` fails (it still imports the old resolver — Task 9 replaces it).

- [ ] **Step 6: Commit**

```bash
git add homunculus-engine/src/homunculus/api/identity.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_dual_credentials.py homunculus-engine/tests/test_board_permissions.py
git commit -m "feat(api): board routes resolve a JWT to a Caller, check permissions and attribute from the token

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: Production resolver — token → `Caller`

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/prodserver.py`
- Delete: `homunculus-engine/tests/test_jwt_hospital_lookup.py`
- Test: `homunculus-engine/tests/test_jwt_caller.py`

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_jwt_caller.py
"""The real JWT -> Caller resolver, with the database read faked out.

`load_user` is the only collaborator that touches Postgres; everything the resolver decides —
undecodable token, refresh token, unknown or inactive user, stale token version, pending MFA,
no tenant — is exercised here with real signed tokens and no database.
"""
from __future__ import annotations

import uuid

from homunculus.api.prodserver import UserAuthRow, make_jwt_caller_resolver
from homunculus.auth.jwt import create_access_token, create_refresh_token

UID = "11111111-1111-1111-1111-111111111111"
ROW = UserAuthRow(username="ayse", is_active=True, token_version=2)


def _load(row=ROW):
    async def read(user_id: str):
        return row if user_id == UID else None
    return read


def _token(**extra):
    base = {"tenant": "demo-hastanesi", "groups": ["nurse"], "perms": ["board.view"],
            "mfa_required": False, "mfa_verified": False, "tv": 2}
    return create_access_token(UID, extra={**base, **extra})


async def test_a_good_token_becomes_a_caller():
    caller = await make_jwt_caller_resolver(_load())(_token())
    assert caller is not None
    assert caller.hospital == "demo-hastanesi" and caller.actor == "ayse"
    assert caller.groups == ("nurse",) and caller.perms == frozenset({"board.view"})
    assert caller.is_device is False


async def test_garbage_and_refresh_tokens_are_not_callers():
    resolve = make_jwt_caller_resolver(_load())
    assert await resolve("not-a-jwt") is None
    assert await resolve(create_refresh_token(UID)) is None


async def test_an_unknown_or_inactive_user_is_not_a_caller():
    assert await make_jwt_caller_resolver(_load(None))(_token()) is None
    inactive = UserAuthRow(username="ayse", is_active=False, token_version=2)
    assert await make_jwt_caller_resolver(_load(inactive))(_token()) is None


async def test_a_stale_token_version_is_refused():
    assert await make_jwt_caller_resolver(_load())(_token(tv=1)) is None


async def test_a_pending_mfa_step_blocks_the_board():
    resolve = make_jwt_caller_resolver(_load())
    assert await resolve(_token(mfa_required=True, mfa_verified=False)) is None
    assert await resolve(_token(mfa_required=True, mfa_verified=True)) is not None


async def test_no_tenant_means_no_hospital():
    assert await make_jwt_caller_resolver(_load())(_token(tenant=None)) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_jwt_caller.py -q`
Expected: `ImportError: cannot import name 'UserAuthRow'`

- [ ] **Step 3: Replace the resolver in `api/prodserver.py`**

Delete `_decode_access_token`, `make_jwt_hospital_resolver`, `_tenant_slug_query` and `_read_tenant_slugs` (keep `_parse_tenants`, `_audit`, `warn_about_unmatched_tenants`, `_read_all_tenant_slugs`, `make_startup_tenant_check`, `_identities`). Add, after `_audit`:

```python
from dataclasses import dataclass

from homunculus.api.identity import Caller


@dataclass(frozen=True)
class UserAuthRow:
    """The three columns the board resolver needs from `users`."""
    username: str
    is_active: bool
    token_version: int


def _decode_access_claims(token: str) -> dict | None:
    """The project's real JWT check. A refresh token is signed with the same secret, so only
    the `type` claim tells them apart — it must never authorise the clinical board."""
    from jose import JWTError

    from homunculus.auth.jwt import decode_token

    try:
        claims = decode_token(token)
    except JWTError:
        return None
    if claims.get("type") != "access" or not claims.get("sub"):
        return None
    return claims


def make_jwt_caller_resolver(
    load_user: Callable[[str], Awaitable[UserAuthRow | None]],
    *,
    decode: Callable[[str], dict | None] = _decode_access_claims,
) -> Callable[[str], Awaitable[Caller | None]]:
    """Build the `resolve_jwt` hook `create_app` calls when a bearer value isn't a tenant token.

    The token is signed, so its `tenant`, `groups` and `perms` are trusted as minted; the one
    database read checks the user is still active and the token version is current — the same
    two checks `get_principal_pre_mfa` makes on the routers.
    """

    async def resolve(token: str) -> Caller | None:
        claims = decode(token)
        if claims is None:
            return None
        row = await load_user(str(claims["sub"]))
        if row is None or not row.is_active:
            return None
        if int(claims.get("tv", 0)) != int(row.token_version):
            return None
        if claims.get("mfa_required") and not claims.get("mfa_verified"):
            return None
        tenant = claims.get("tenant")
        if not tenant:
            return None
        return Caller(
            hospital=tenant, actor=row.username,
            groups=tuple(claims.get("groups") or ()),
            perms=frozenset(claims.get("perms") or ()),
        )

    return resolve


async def _read_user_auth(user_id: str) -> UserAuthRow | None:
    """Run the user read against the real database."""
    import uuid

    from sqlalchemy import select

    from homunculus.auth.models import User
    from homunculus.db import AsyncSessionLocal

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return None
    async with AsyncSessionLocal() as session:
        row = (await session.execute(
            select(User.username, User.is_active, User.token_version).where(User.id == uid)
        )).first()
    if row is None:
        return None
    return UserAuthRow(username=row.username, is_active=row.is_active,
                       token_version=row.token_version)
```

Move `from dataclasses import dataclass` and `from homunculus.api.identity import Caller` up to the module's import block (`hospital_for_slugs` is no longer imported here; keep `unmatched_hospital_keys`). At the bottom replace `resolve_jwt_hospital=make_jwt_hospital_resolver(_read_tenant_slugs),` with:

```python
    resolve_jwt=make_jwt_caller_resolver(_read_user_auth),
```

Update the module docstring's `TENANTS` line to read: `TENANTS "tokenA:slugA,tokenB:slugB" (device bearer tokens; the slug is the tenant slug and the engine's hospital key)`.

- [ ] **Step 4: Delete the old test and run**

Run: `git rm -q homunculus-engine/tests/test_jwt_hospital_lookup.py`

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_jwt_caller.py tests/test_identity.py -q`
Expected: `6 passed` + the identity tests still pass.

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/prodserver.py homunculus-engine/tests/test_jwt_caller.py
git commit -m "feat(api): production JWT resolver yields a Caller from the token's tenant, groups and perms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: The `/admin` API — users, groups, permission catalogue, guards, audit

**Files:**
- Create: `homunculus-engine/src/homunculus/admin/__init__.py` (empty)
- Create: `homunculus-engine/src/homunculus/admin/schemas.py`
- Create: `homunculus-engine/src/homunculus/admin/service.py`
- Create: `homunculus-engine/src/homunculus/admin/router.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (mount the router)
- Test: `homunculus-engine/tests/test_admin_api.py` (DB-backed)

- [ ] **Step 1: Write the failing tests**

```python
# homunculus-engine/tests/test_admin_api.py
"""The administration API end to end: scoping to the caller's tenant, the guards that keep a
tenant administrable, token invalidation on change, and the audit trail."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups, set_manual_groups
from homunculus.auth.jwt import decode_token
from homunculus.auth.models import AUTH_LDAP, TenantMembership, User
from homunculus.auth.service import build_context, hash_password, issue_tokens
from homunculus.db import get_db
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

pytestmark = [pytest.mark.asyncio, requires_db]

PASSWORD = "Gizli-123"


async def _make_user(db, tenant, groups, username, group_slug, **kw):
    u = User(username=username, email=f"{username}@example.com", full_name=username.title(),
             hashed_password=kw.pop("hashed_password", hash_password(PASSWORD)), **kw)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant.id))
    await db.flush()
    if group_slug:
        await set_manual_groups(db, user=u, tenant_id=tenant.id,
                                group_ids=[groups[group_slug].id], granted_by_id=None)
    return u


@pytest_asyncio.fixture
async def world(db_session):
    t = Tenant(name="Demo", slug="demo-hastanesi", country_code="TR")
    other = Tenant(name="Other", slug="other", country_code="TR")
    db_session.add_all([t, other])
    await db_session.flush()
    groups = await ensure_default_groups(db_session, t.id)
    other_groups = await ensure_default_groups(db_session, other.id)
    admin = await _make_user(db_session, t, groups, "admin", "hospital_admin")
    nurse = await _make_user(db_session, t, groups, "ayse", "nurse")
    ldap = await _make_user(db_session, t, groups, "ldapci", "nurse",
                            auth_source=AUTH_LDAP, hashed_password=None)
    stranger = await _make_user(db_session, other, other_groups, "yabanci", "nurse")
    await db_session.commit()
    return {"tenant": t, "groups": groups, "admin": admin, "nurse": nurse, "ldap": ldap,
            "stranger": stranger, "other_groups": other_groups}


@pytest_asyncio.fixture
async def client(db_session):
    app = create_app({"bridge-token": "demo-hastanesi"}, run_escalation_loop=False)

    async def _db():
        yield db_session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, app


async def _headers(db, user, *, mfa_verified=True):
    """Mint a token straight from the service, so an MFA group does not gate the tests."""
    ctx = await build_context(db, user)
    tokens = issue_tokens(user, ctx, mfa_verified=mfa_verified)
    return {"Authorization": f"Bearer {tokens['access_token']}"}, tokens


# ---------------------------------------------------------------- permissions & groups

async def test_the_catalogue_needs_groups_manage(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    res = await c.get("/admin/permissions", headers=admin)
    assert res.status_code == 200 and {p["key"] for p in res.json()} >= {"board.view", "users.manage"}
    assert (await c.get("/admin/permissions", headers=nurse)).status_code == 403


async def test_groups_are_listed_with_member_counts(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    groups = {g["slug"]: g for g in (await c.get("/admin/groups", headers=admin)).json()}
    assert groups["nurse"]["member_count"] == 2 and groups["hospital_admin"]["member_count"] == 1
    assert groups["hospital_admin"]["is_system"] is True
    assert "yabanci" not in str(groups)              # the other tenant's world is invisible


async def test_create_patch_and_delete_a_custom_group(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/groups", headers=admin, json={
        "slug": "it_destek", "name": "BT Destek", "description": "",
        "mfa_required": False, "permissions": ["users.manage"]})
    assert res.status_code == 201
    gid = res.json()["id"]
    assert (await c.post("/admin/groups", headers=admin, json={
        "slug": "it_destek", "name": "x", "permissions": []})).status_code == 409
    assert (await c.post("/admin/groups", headers=admin, json={
        "slug": "Kötü Slug", "name": "x", "permissions": []})).status_code == 422
    assert (await c.post("/admin/groups", headers=admin, json={
        "slug": "bilinmez", "name": "x", "permissions": ["alerts.acknowledge"]})).status_code == 422

    res = await c.patch(f"/admin/groups/{gid}", headers=admin,
                        json={"name": "BT", "permissions": ["users.manage", "audit.view"]})
    assert res.status_code == 200 and sorted(res.json()["permissions"]) == ["audit.view", "users.manage"]
    assert (await c.delete(f"/admin/groups/{gid}", headers=admin)).status_code == 204


async def test_system_and_populated_groups_cannot_be_deleted(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.delete(f"/admin/groups/{world['groups']['hospital_admin'].id}",
                           headers=admin)).status_code == 409
    assert (await c.delete(f"/admin/groups/{world['groups']['nurse'].id}",
                           headers=admin)).status_code == 409


async def test_changing_a_groups_permissions_retires_its_members_tokens(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, nurse_tokens = await _headers(db_session, world["nurse"])
    assert (await c.get("/auth/me", headers=nurse)).status_code == 200

    res = await c.patch(f"/admin/groups/{world['groups']['nurse'].id}", headers=admin,
                        json={"permissions": ["board.view"]})
    assert res.status_code == 200
    # The bump is a SQL UPDATE; the shared test session still holds the pre-bump User object.
    # A real request loads its own copy, so refresh to see what production would see.
    await db_session.refresh(world["nurse"])

    assert (await c.get("/auth/me", headers=nurse)).status_code == 401
    refreshed = (await c.post("/auth/refresh",
                              json={"refresh_token": nurse_tokens["refresh_token"]})).json()
    assert decode_token(refreshed["access_token"])["perms"] == ["board.view"]


async def test_the_system_groups_rights_are_immutable_but_its_labels_are_not(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    gid = world["groups"]["hospital_admin"].id
    assert (await c.patch(f"/admin/groups/{gid}", headers=admin,
                          json={"permissions": ["board.view"]})).status_code == 409
    assert (await c.patch(f"/admin/groups/{gid}", headers=admin,
                          json={"mfa_required": False})).status_code == 409
    res = await c.patch(f"/admin/groups/{gid}", headers=admin, json={"name": "BT Yönetimi"})
    assert res.status_code == 200 and res.json()["name"] == "BT Yönetimi"


async def test_the_last_administrator_cannot_lose_groups_manage_either(client, world, db_session):
    """An administrator holds users.manage AND groups.manage; moving the only one into a group
    that has just users.manage would leave nobody able to edit groups."""
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/groups", headers=admin, json={
        "slug": "user_desk", "name": "Kullanıcı Masası", "permissions": ["users.manage"]})
    assert res.status_code == 201
    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [res.json()["id"]]})
    assert res.status_code == 409


# ---------------------------------------------------------------- users

async def test_users_are_listed_with_their_groups_in_this_tenant(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    users = {u["username"]: u for u in (await c.get("/admin/users", headers=admin)).json()}
    assert set(users) == {"admin", "ayse", "ldapci"}
    assert [g["slug"] for g in users["ayse"]["groups"]] == ["nurse"]
    assert users["ayse"]["groups"][0]["source"] == "manual"
    assert users["ldapci"]["auth_source"] == "ldap"


async def test_create_a_local_user_who_can_then_sign_in(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.post("/admin/users", headers=admin, json={
        "username": "Selin.Arslan", "email": "Selin@Example.com", "full_name": "Selin Arslan",
        "password": "Gecici-Parola-1", "group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 201
    body = res.json()
    assert body["username"] == "selin.arslan" and body["email"] == "selin@example.com"
    assert [g["slug"] for g in body["groups"]] == ["charge_nurse"]
    login = await c.post("/auth/login", json={"login": "selin.arslan", "password": "Gecici-Parola-1"})
    assert login.status_code == 200
    assert (await c.post("/admin/users", headers=admin, json={
        "username": "selin.arslan", "full_name": "x", "password": "Gecici-Parola-1"})).status_code == 409


async def test_set_groups_and_the_last_admin_guard(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    res = await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    assert res.status_code == 200 and [g["slug"] for g in res.json()["groups"]] == ["charge_nurse"]

    res = await c.put(f"/admin/users/{world['admin'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["groups"]["nurse"].id)]})
    assert res.status_code == 409                    # would leave nobody with users.manage


async def test_deactivation_guard_and_effect(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    nurse, _ = await _headers(db_session, world["nurse"])
    assert (await c.patch(f"/admin/users/{world['admin'].id}", headers=admin,
                          json={"is_active": False})).status_code == 409
    assert (await c.patch(f"/admin/users/{world['nurse'].id}", headers=admin,
                          json={"is_active": False})).status_code == 200
    assert (await c.get("/auth/me", headers=nurse)).status_code == 401


async def test_password_and_mfa_resets(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.post(f"/admin/users/{world['nurse'].id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})).status_code == 200
    assert (await c.post("/auth/login", json={"login": "ayse", "password": "Yeni-Parola-1"})
            ).status_code == 200
    assert (await c.post(f"/admin/users/{world['ldap'].id}/reset-password", headers=admin,
                         json={"password": "Yeni-Parola-1"})).status_code == 400
    world["nurse"].totp_secret, world["nurse"].totp_enabled = "SECRET", True
    await db_session.commit()
    assert (await c.post(f"/admin/users/{world['nurse'].id}/reset-mfa", headers=admin)
            ).status_code == 200
    await db_session.refresh(world["nurse"])
    assert world["nurse"].totp_enabled is False and world["nurse"].totp_secret is None


async def test_another_tenants_user_is_not_found(client, world, db_session):
    c, _ = client
    admin, _ = await _headers(db_session, world["admin"])
    assert (await c.patch(f"/admin/users/{world['stranger'].id}", headers=admin,
                          json={"full_name": "x"})).status_code == 404
    res = await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                      json={"group_ids": [str(world["other_groups"]["nurse"].id)]})
    assert res.status_code == 422                    # a group of another tenant


async def test_admin_actions_are_audited(client, world, db_session):
    c, app = client
    admin, _ = await _headers(db_session, world["admin"])
    await c.post("/admin/groups", headers=admin,
                 json={"slug": "gecici", "name": "Geçici", "permissions": ["board.view"]})
    await c.put(f"/admin/users/{world['nurse'].id}/groups", headers=admin,
                json={"group_ids": [str(world["groups"]["charge_nurse"].id)]})
    subjects = [r.subject for r in app.state.audit.records(event_type="admin")]
    assert "group.create" in subjects and "user.groups" in subjects
    rec = next(r for r in app.state.audit.records(event_type="admin") if r.subject == "user.groups")
    assert rec.payload["actor"] == "admin" and rec.payload["after"] == ["charge_nurse"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_admin_api.py -q`
Expected: with `TEST_DATABASE_URL`, every test fails with `404` on `/admin/...`; without it, skipped. (Nothing imports the admin package yet, so there is no import error to see.)

- [ ] **Step 3: Write the schemas**

```python
# homunculus-engine/src/homunculus/admin/schemas.py
"""Request/response shapes of the /admin API."""
from __future__ import annotations
import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

_SLUG = re.compile(r"^[a-z0-9_]{2,64}$")


class PermissionOut(BaseModel):
    key: str
    description: str


class GroupOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    mfa_required: bool
    is_system: bool
    permissions: list[str]
    member_count: int


class GroupCreate(BaseModel):
    slug: str
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    mfa_required: bool = False
    permissions: list[str] = []

    @field_validator("slug")
    @classmethod
    def _slug_shape(cls, value: str) -> str:
        if not _SLUG.match(value):
            raise ValueError("slug: 2-64 characters, lower-case letters, digits and _ only")
        return value


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    mfa_required: bool | None = None
    permissions: list[str] | None = None


class UserGroupOut(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    source: str


class UserOut(BaseModel):
    id: uuid.UUID
    username: str
    email: str | None
    full_name: str
    auth_source: str
    is_active: bool
    totp_enabled: bool
    last_login_at: datetime | None
    groups: list[UserGroupOut]


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=128)
    email: str | None = None
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8)
    group_ids: list[uuid.UUID] = []


class UserPatch(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = None
    is_active: bool | None = None


class UserGroupsIn(BaseModel):
    group_ids: list[uuid.UUID]


class PasswordResetIn(BaseModel):
    password: str = Field(min_length=8)
```

- [ ] **Step 4: Write the service**

```python
# homunculus-engine/src/homunculus/admin/service.py
"""Administration logic: groups and users of ONE tenant, with the guards that keep a tenant
administrable. Every function raises AdminError(status, detail); the router turns that into
the HTTP response and rolls the session back, so a refused change leaves nothing behind."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from homunculus.auth.groups import (
    GroupError, bump_group_members, count_admins, set_manual_groups,
)
from homunculus.auth.models import (
    AUTH_LOCAL, Group, GroupPermission, LdapGroupMapping, TenantMembership, User, UserGroup,
)
from homunculus.auth.permissions import UnknownPermission, validate_permissions
from homunculus.auth.service import hash_password, normalize_login
from homunculus.tenant.models import Tenant

LAST_ADMIN = "Son yönetici yetkisi kaldırılamaz"


class AdminError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def tenant_id_for_slug(db: AsyncSession, slug: str | None) -> uuid.UUID:
    if not slug:
        raise AdminError(403, "Hesabınıza kurum tanımlanmamış")
    tenant_id = (await db.execute(select(Tenant.id).where(Tenant.slug == slug))).scalar_one_or_none()
    if tenant_id is None:
        raise AdminError(404, "Tenant not found")
    return tenant_id


# ---------------------------------------------------------------- groups

async def list_groups(db: AsyncSession, tenant_id: uuid.UUID) -> list[tuple[Group, int]]:
    counts = (
        select(UserGroup.group_id, func.count().label("n")).group_by(UserGroup.group_id)
    ).subquery()
    stmt = (
        select(Group, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.group_id == Group.id)
        .where(Group.tenant_id == tenant_id)
        .order_by(Group.slug)
    )
    return [(group, int(n)) for group, n in (await db.execute(stmt)).all()]


async def get_group(db: AsyncSession, tenant_id: uuid.UUID, group_id: uuid.UUID) -> Group:
    group = (await db.execute(
        select(Group).where(Group.id == group_id, Group.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if group is None:
        raise AdminError(404, "Group not found")
    return group


async def member_count(db: AsyncSession, group_id: uuid.UUID) -> int:
    return int((await db.execute(
        select(func.count()).select_from(UserGroup).where(UserGroup.group_id == group_id)
    )).scalar_one())


def _keys(permissions: list[str]) -> list[str]:
    try:
        return list(dict.fromkeys(validate_permissions(permissions)))
    except UnknownPermission as exc:
        raise AdminError(422, str(exc))


async def create_group(db: AsyncSession, tenant_id: uuid.UUID, *, slug: str, name: str,
                       description: str | None, mfa_required: bool,
                       permissions: list[str]) -> Group:
    keys = _keys(permissions)
    exists = (await db.execute(
        select(Group.id).where(Group.tenant_id == tenant_id, Group.slug == slug)
    )).scalar_one_or_none()
    if exists is not None:
        raise AdminError(409, "Bu kısa ad zaten kullanılıyor")
    group = Group(tenant_id=tenant_id, slug=slug, name=name.strip(), description=description,
                  mfa_required=mfa_required, is_system=False)
    group.permissions = [GroupPermission(permission=k) for k in keys]
    db.add(group)
    await db.flush()
    return group


async def update_group(db: AsyncSession, tenant_id: uuid.UUID, group: Group, *,
                       name: str | None, description: str | None, mfa_required: bool | None,
                       permissions: list[str] | None) -> Group:
    if group.is_system and (permissions is not None or mfa_required is not None):
        # The system group's rights are a rule, not rows (spec §3); only its labels may change.
        raise AdminError(409, "Sistem grubunun izinleri ve MFA kuralı değiştirilemez")
    rights_changed = False
    if name is not None:
        group.name = name.strip()
    if description is not None:
        group.description = description
    if mfa_required is not None and mfa_required != group.mfa_required:
        group.mfa_required = mfa_required
        rights_changed = True
    if permissions is not None:
        new = set(_keys(permissions))
        old = set(group.permission_keys)
        if new != old:
            for gp in list(group.permissions):
                if gp.permission not in new:
                    group.permissions.remove(gp)
            for key in sorted(new - old):
                group.permissions.append(GroupPermission(permission=key))
            rights_changed = True
    if rights_changed:
        group.updated_at = datetime.now(timezone.utc)   # onupdate never fires for a rows-only change
    await db.flush()
    if rights_changed:
        await bump_group_members(db, group.id)
        if await count_admins(db, tenant_id) == 0:
            raise AdminError(409, LAST_ADMIN)
    return group


async def delete_group(db: AsyncSession, group: Group) -> None:
    if group.is_system:
        raise AdminError(409, "Sistem grubu silinemez")
    if await member_count(db, group.id) > 0:
        raise AdminError(409, "Üyesi olan grup silinemez")
    mappings = int((await db.execute(
        select(func.count()).select_from(LdapGroupMapping)
        .where(LdapGroupMapping.group_id == group.id)
    )).scalar_one())
    if mappings > 0:
        raise AdminError(409, "AD eşlemesi olan grup silinemez")
    await db.delete(group)
    await db.flush()


# ---------------------------------------------------------------- users

def _tenant_users(tenant_id: uuid.UUID):
    return (
        select(User)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .where(TenantMembership.tenant_id == tenant_id,
               TenantMembership.is_active == True)  # noqa: E712
        .options(selectinload(User.group_links).selectinload(UserGroup.group))
        # A re-fetch after set_manual_groups must show the rows it added/deleted, not the
        # collection the identity map already holds.
        .execution_options(populate_existing=True)
    )


async def list_users(db: AsyncSession, tenant_id: uuid.UUID) -> list[User]:
    return list((await db.execute(_tenant_users(tenant_id).order_by(User.username))).scalars().all())


async def get_tenant_user(db: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> User:
    user = (await db.execute(_tenant_users(tenant_id).where(User.id == user_id))).scalars().first()
    if user is None:
        raise AdminError(404, "User not found")
    return user


async def _refuse_duplicate_login(db: AsyncSession, *, username: str | None, email: str | None,
                                  except_id: uuid.UUID | None = None) -> None:
    clauses = []
    if username:
        clauses.append(User.username == username)
    if email:
        clauses.append(User.email == email)
        clauses.append(User.username == email)
    if not clauses:
        return
    from sqlalchemy import or_
    stmt = select(User.id).where(or_(*clauses))
    if except_id is not None:
        stmt = stmt.where(User.id != except_id)
    if (await db.execute(stmt)).first() is not None:
        raise AdminError(409, "Bu kullanıcı adı veya e-posta zaten kayıtlı")


async def create_local_user(db: AsyncSession, tenant_id: uuid.UUID, *, username: str,
                            email: str | None, full_name: str, password: str,
                            group_ids: list[uuid.UUID], actor_id: uuid.UUID) -> User:
    key = normalize_login(username)
    mail = normalize_login(email) or None
    if not key:
        raise AdminError(422, "Kullanıcı adı zorunludur")
    await _refuse_duplicate_login(db, username=key, email=mail)
    user = User(username=key, email=mail, full_name=full_name.strip(),
                hashed_password=hash_password(password), auth_source=AUTH_LOCAL)
    db.add(user)
    await db.flush()
    db.add(TenantMembership(user_id=user.id, tenant_id=tenant_id, granted_by_id=actor_id))
    await db.flush()
    try:
        await set_manual_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids,
                                granted_by_id=actor_id)
    except GroupError as exc:
        raise AdminError(422, str(exc))
    return await get_tenant_user(db, tenant_id, user.id)


async def patch_user(db: AsyncSession, tenant_id: uuid.UUID, user: User, *,
                     full_name: str | None, email: str | None, is_active: bool | None) -> User:
    if full_name is not None:
        user.full_name = full_name.strip()
    if email is not None:
        mail = normalize_login(email) or None
        await _refuse_duplicate_login(db, username=None, email=mail, except_id=user.id)
        user.email = mail
    if is_active is not None and is_active != user.is_active:
        user.is_active = is_active
        user.token_version += 1
        await db.flush()
        if not is_active and await count_admins(db, tenant_id) == 0:
            raise AdminError(409, "Son yönetici pasifleştirilemez")
    await db.flush()
    return user


async def set_user_groups(db: AsyncSession, tenant_id: uuid.UUID, user: User,
                          group_ids: list[uuid.UUID], actor_id: uuid.UUID) -> User:
    try:
        await set_manual_groups(db, user=user, tenant_id=tenant_id, group_ids=group_ids,
                                granted_by_id=actor_id)
    except GroupError as exc:
        raise AdminError(422, str(exc))
    if await count_admins(db, tenant_id) == 0:
        raise AdminError(409, LAST_ADMIN)
    return await get_tenant_user(db, tenant_id, user.id)


async def reset_password(db: AsyncSession, user: User, password: str) -> None:
    if user.auth_source != AUTH_LOCAL:
        raise AdminError(400, "Parola Active Directory tarafından yönetiliyor")
    user.hashed_password = hash_password(password)
    user.token_version += 1
    await db.flush()


async def reset_mfa(db: AsyncSession, user: User) -> None:
    user.totp_secret = None
    user.totp_enabled = False
    user.token_version += 1
    await db.flush()
```

- [ ] **Step 5: Write the router**

```python
# homunculus-engine/src/homunculus/admin/router.py
"""
/admin — users and groups of the caller's tenant.

  GET    /admin/permissions               groups.manage
  GET    /admin/groups                    groups.manage
  POST   /admin/groups                    groups.manage
  PATCH  /admin/groups/{id}               groups.manage
  DELETE /admin/groups/{id}               groups.manage
  GET    /admin/users                     users.manage
  POST   /admin/users                     users.manage
  PATCH  /admin/users/{id}                users.manage
  PUT    /admin/users/{id}/groups         users.manage
  POST   /admin/users/{id}/reset-password users.manage
  POST   /admin/users/{id}/reset-mfa      users.manage

Everything is scoped to the tenant in the caller's token; a user or group of another tenant
is a 404. Every mutation is audited as event_type "admin".
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admin import service
from homunculus.admin.schemas import (
    GroupCreate, GroupOut, GroupPatch, PasswordResetIn, PermissionOut, UserCreate,
    UserGroupOut, UserGroupsIn, UserOut, UserPatch,
)
from homunculus.admin.service import AdminError
from homunculus.auth.audit import append_audit
from homunculus.auth.dependencies import Principal, get_principal, require_permission
from homunculus.auth.models import Group, User
from homunculus.auth.permissions import ALL_PERMISSIONS, PERMISSIONS
from homunculus.db import get_db

router = APIRouter(prefix="/admin", tags=["admin"])

_groups = [Depends(require_permission("groups.manage"))]
_users = [Depends(require_permission("users.manage"))]


def _http(exc: AdminError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


async def _scope(principal: Principal, db: AsyncSession) -> uuid.UUID:
    try:
        return await service.tenant_id_for_slug(db, principal.tenant)
    except AdminError as exc:
        raise _http(exc)


def _group_out(group: Group, count: int) -> GroupOut:
    return GroupOut(id=group.id, slug=group.slug, name=group.name,
                    description=group.description, mfa_required=group.mfa_required,
                    is_system=group.is_system,
                    # A system group's rights are the whole catalogue by rule (spec §3); report
                    # that, not the rows seeded when the tenant was created.
                    permissions=sorted(ALL_PERMISSIONS) if group.is_system else group.permission_keys,
                    member_count=count)


def _user_out(user: User, tenant_id: uuid.UUID) -> UserOut:
    links = sorted((l for l in user.group_links if l.group.tenant_id == tenant_id),
                   key=lambda l: l.group.slug)
    return UserOut(
        id=user.id, username=user.username, email=user.email, full_name=user.full_name,
        auth_source=user.auth_source, is_active=user.is_active, totp_enabled=user.totp_enabled,
        last_login_at=user.last_login_at,
        groups=[UserGroupOut(id=l.group.id, slug=l.group.slug, name=l.group.name,
                             source=l.source) for l in links],
    )


def _audit(request: Request, principal: Principal, kind: str, target: str, *,
           before=None, after=None) -> None:
    append_audit(request, tenant=principal.tenant, event_type="admin", subject=kind,
                 payload={"actor": principal.user.username, "target": target,
                          "before": before, "after": after})


async def _run(db: AsyncSession, coro):
    """Await a service call; on AdminError roll back so a refused change leaves nothing."""
    try:
        return await coro
    except AdminError as exc:
        await db.rollback()
        raise _http(exc)


# ---------------------------------------------------------------- permissions & groups

@router.get("/permissions", response_model=list[PermissionOut], dependencies=_groups)
async def list_permissions() -> list[PermissionOut]:
    return [PermissionOut(key=k, description=d) for k, d in PERMISSIONS.items()]


@router.get("/groups", response_model=list[GroupOut], dependencies=_groups)
async def list_groups(principal: Principal = Depends(get_principal),
                      db: AsyncSession = Depends(get_db)) -> list[GroupOut]:
    tenant_id = await _scope(principal, db)
    return [_group_out(g, n) for g, n in await service.list_groups(db, tenant_id)]


@router.post("/groups", response_model=GroupOut, status_code=status.HTTP_201_CREATED,
             dependencies=_groups)
async def create_group(body: GroupCreate, request: Request,
                       principal: Principal = Depends(get_principal),
                       db: AsyncSession = Depends(get_db)) -> GroupOut:
    tenant_id = await _scope(principal, db)
    group = await _run(db, service.create_group(
        db, tenant_id, slug=body.slug, name=body.name, description=body.description,
        mfa_required=body.mfa_required, permissions=body.permissions))
    await db.commit()
    _audit(request, principal, "group.create", str(group.id),
           after={"slug": group.slug, "permissions": group.permission_keys,
                  "mfa_required": group.mfa_required})
    return _group_out(group, 0)


@router.patch("/groups/{group_id}", response_model=GroupOut, dependencies=_groups)
async def update_group(group_id: uuid.UUID, body: GroupPatch, request: Request,
                       principal: Principal = Depends(get_principal),
                       db: AsyncSession = Depends(get_db)) -> GroupOut:
    tenant_id = await _scope(principal, db)
    group = await _run(db, service.get_group(db, tenant_id, group_id))
    before = {"name": group.name, "permissions": group.permission_keys,
              "mfa_required": group.mfa_required}
    group = await _run(db, service.update_group(
        db, tenant_id, group, name=body.name, description=body.description,
        mfa_required=body.mfa_required, permissions=body.permissions))
    await db.commit()
    _audit(request, principal, "group.update", str(group.id), before=before,
           after={"name": group.name, "permissions": group.permission_keys,
                  "mfa_required": group.mfa_required})
    return _group_out(group, await service.member_count(db, group.id))


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=_groups)
async def delete_group(group_id: uuid.UUID, request: Request,
                       principal: Principal = Depends(get_principal),
                       db: AsyncSession = Depends(get_db)) -> Response:
    tenant_id = await _scope(principal, db)
    group = await _run(db, service.get_group(db, tenant_id, group_id))
    slug = group.slug
    await _run(db, service.delete_group(db, group))
    await db.commit()
    _audit(request, principal, "group.delete", str(group_id), before={"slug": slug})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------- users

@router.get("/users", response_model=list[UserOut], dependencies=_users)
async def list_users(principal: Principal = Depends(get_principal),
                     db: AsyncSession = Depends(get_db)) -> list[UserOut]:
    tenant_id = await _scope(principal, db)
    return [_user_out(u, tenant_id) for u in await service.list_users(db, tenant_id)]


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED,
             dependencies=_users)
async def create_user(body: UserCreate, request: Request,
                      principal: Principal = Depends(get_principal),
                      db: AsyncSession = Depends(get_db)) -> UserOut:
    tenant_id = await _scope(principal, db)
    user = await _run(db, service.create_local_user(
        db, tenant_id, username=body.username, email=body.email, full_name=body.full_name,
        password=body.password, group_ids=body.group_ids, actor_id=principal.user.id))
    await db.commit()
    out = _user_out(user, tenant_id)
    _audit(request, principal, "user.create", str(user.id),
           after={"username": out.username, "groups": [g.slug for g in out.groups]})
    return out


@router.patch("/users/{user_id}", response_model=UserOut, dependencies=_users)
async def update_user(user_id: uuid.UUID, body: UserPatch, request: Request,
                      principal: Principal = Depends(get_principal),
                      db: AsyncSession = Depends(get_db)) -> UserOut:
    tenant_id = await _scope(principal, db)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    before = {"full_name": user.full_name, "email": user.email, "is_active": user.is_active}
    user = await _run(db, service.patch_user(
        db, tenant_id, user, full_name=body.full_name, email=body.email,
        is_active=body.is_active))
    await db.commit()
    _audit(request, principal, "user.update", str(user.id), before=before,
           after={"full_name": user.full_name, "email": user.email, "is_active": user.is_active})
    return _user_out(await service.get_tenant_user(db, tenant_id, user.id), tenant_id)


@router.put("/users/{user_id}/groups", response_model=UserOut, dependencies=_users)
async def set_user_groups(user_id: uuid.UUID, body: UserGroupsIn, request: Request,
                          principal: Principal = Depends(get_principal),
                          db: AsyncSession = Depends(get_db)) -> UserOut:
    tenant_id = await _scope(principal, db)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    before = [g.slug for g in _user_out(user, tenant_id).groups]
    user = await _run(db, service.set_user_groups(db, tenant_id, user, body.group_ids,
                                                  principal.user.id))
    await db.commit()
    out = _user_out(user, tenant_id)
    _audit(request, principal, "user.groups", str(user.id), before=before,
           after=[g.slug for g in out.groups])
    return out


@router.post("/users/{user_id}/reset-password", dependencies=_users)
async def reset_password(user_id: uuid.UUID, body: PasswordResetIn, request: Request,
                         principal: Principal = Depends(get_principal),
                         db: AsyncSession = Depends(get_db)) -> dict:
    tenant_id = await _scope(principal, db)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    await _run(db, service.reset_password(db, user, body.password))
    await db.commit()
    _audit(request, principal, "user.password_reset", str(user.id))
    return {"ok": True}


@router.post("/users/{user_id}/reset-mfa", dependencies=_users)
async def reset_mfa(user_id: uuid.UUID, request: Request,
                    principal: Principal = Depends(get_principal),
                    db: AsyncSession = Depends(get_db)) -> dict:
    tenant_id = await _scope(principal, db)
    user = await _run(db, service.get_tenant_user(db, tenant_id, user_id))
    await _run(db, service.reset_mfa(db, user))
    await db.commit()
    _audit(request, principal, "user.mfa_reset", str(user.id))
    return {"ok": True}
```

- [ ] **Step 6: Mount the router**

In `api/app.py`, next to the other router imports inside `create_app`:

```python
    from homunculus.admin.router import router as admin_router
```

and after `app.include_router(break_glass_router)`:

```python
    app.include_router(admin_router)
```

Create the empty `homunculus-engine/src/homunculus/admin/__init__.py`.

- [ ] **Step 7: Run the tests**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest tests/test_admin_api.py -q`
Expected: `15 passed` with `TEST_DATABASE_URL`, `15 skipped` without.

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add homunculus-engine/src/homunculus/admin homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_admin_api.py
git commit -m "feat(admin): /admin API — users, groups, permission catalogue, last-admin guards, audit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11 (frontend): Shared form primitives move to `ui.jsx`

The new admin components need `Field`, `inputCls`, `btnCls` and `ActionOverlay`, which today are
private to the 4000-line `ClinicalDemo.jsx`. Moving them is a mechanical extraction; nothing else
about the file changes in this task.

**Files:**
- Create: `dashboard/src/ui.jsx`
- Modify: `dashboard/src/ClinicalDemo.jsx`
- Test: `dashboard/src/ui.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// dashboard/src/ui.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field, ActionOverlay, inputCls, btnCls } from "./ui.jsx";
import { getTheme } from "./clinicalTheme.js";

const T = getTheme("icu");

describe("ui primitives", () => {
  it("Field renders its label, children and hint", () => {
    render(<Field T={T} label="Ad Soyad" hint="Zorunlu"><input aria-label="ad" /></Field>);
    expect(screen.getByText("Ad Soyad")).toBeInTheDocument();
    expect(screen.getByLabelText("ad")).toBeInTheDocument();
    expect(screen.getByText("Zorunlu")).toBeInTheDocument();
  });

  it("ActionOverlay shows a title and closes from its button", () => {
    const onClose = vi.fn();
    render(<ActionOverlay T={T} title="Başlık" onClose={onClose}><p>içerik</p></ActionOverlay>);
    expect(screen.getByText("Başlık")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });

  it("class helpers produce theme-bound class strings", () => {
    expect(inputCls(T)).toContain(T.input);
    expect(btnCls(T, "danger")).toContain(T.danger);
    expect(btnCls(T)).toContain(T.primary);
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `cd dashboard && npx vitest run src/ui.test.jsx`
Expected: FAIL — `Failed to resolve import "./ui.jsx"`

- [ ] **Step 3: Create `ui.jsx`**

```jsx
// src/ui.jsx — small form and overlay primitives shared by the clinical workspace and the admin
// panels. Moved out of ClinicalDemo.jsx so a component in another file can use them without
// importing the whole workspace.
import React from "react";
import { X } from "lucide-react";

export function Field({ T, label, hint, children }) {
  return (
    <label className="block">
      <div className={`mb-1 font-medium ${T.sizes.label} ${T.muted}`}>{label}</div>
      {children}
      {hint && <div className={`mt-1 text-xs ${T.faint}`}>{hint}</div>}
    </label>
  );
}

export const inputCls = (T) => `w-full rounded-lg border px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-brand/40 ${T.input} ${T.sizes.nav}`;

export function btnCls(T, kind = "primary") {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
  const map = { primary: T.primary, ghost: T.ghost, danger: T.danger, warn: T.warn };
  return `${base} ${map[kind] || T.primary} ${T.sizes.nav}`;
}

export function ActionOverlay({ T, title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={onClose} />
      <div className={`relative w-full max-w-sm rounded-2xl border ${T.border} ${T.card} p-5 shadow-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h4 className={`font-bold ${T.heading}`}>{title}</h4>
          <button onClick={onClose} className={`grid h-8 w-8 place-items-center rounded-lg ${T.ghost}`}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Remove the four definitions from `ClinicalDemo.jsx` and import them**

Delete, from `ClinicalDemo.jsx`:

- the `function Field({ T, label, hint, children }) { … }` block (immediately after the `Menu` component),
- the `const inputCls = (T) => …;` line,
- the `function btnCls(T, kind = "primary") { … }` block,
- the `function ActionOverlay({ T, title, onClose, children }) { … }` block (just before `function UserRow`).

Add, after the `./clinicalTheme.js` import block:

```jsx
import { Field, inputCls, btnCls, ActionOverlay } from "./ui.jsx";
```

- [ ] **Step 5: Run the whole frontend suite**

Run: `cd dashboard && npx vitest run`
Expected: all green (same count as before plus 3).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/ui.jsx dashboard/src/ui.test.jsx dashboard/src/ClinicalDemo.jsx
git commit -m "refactor(dashboard): Field, inputCls, btnCls and ActionOverlay move to ui.jsx

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12 (frontend): Permission keys; demo sessions carry `perms`

**Files:**
- Create: `dashboard/src/permissions.js`
- Modify: `dashboard/src/clinicalDemo.js`
- Test: `dashboard/src/permissions.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// dashboard/src/permissions.test.js
import { describe, it, expect } from "vitest";
import {
  PERMISSION_KEYS, permsForRole, hasPerm, hasAny, uiRoleFromPerms,
} from "./permissions.js";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";

describe("permission keys", () => {
  it("mirrors the backend catalogue (19 keys)", () => {
    expect(PERMISSION_KEYS).toHaveLength(19);
    expect(PERMISSION_KEYS).toContain("board.view");
    expect(PERMISSION_KEYS).toContain("devices.manage");
  });

  it("gives each demo role the spec's default set", () => {
    expect(permsForRole("HOSPITAL_ADMIN")).toEqual(PERMISSION_KEYS);
    expect(permsForRole("ATTENDING")).toContain("admissions.sign_off");
    expect(permsForRole("ATTENDING")).toContain("care_team.assign");
    expect(permsForRole("CHARGE_NURSE")).toContain("admissions.admit");
    expect(permsForRole("CHARGE_NURSE")).not.toContain("admissions.sign_off");
    expect(permsForRole("RRT")).toContain("alerts.escalate");
    expect(permsForRole("PHARMACIST")).toEqual(["board.view", "admissions.view"]);
    expect(permsForRole("BIOMEDICAL")).toEqual(["devices.manage"]);
    expect(permsForRole("NOPE")).toEqual([]);
  });

  it("hasPerm / hasAny fail closed on bad input", () => {
    expect(hasPerm(["board.view"], "board.view")).toBe(true);
    expect(hasPerm(null, "board.view")).toBe(false);
    expect(hasAny(["alerts.ack"], ["alerts.ack", "alerts.escalate"])).toBe(true);
    expect(hasAny(["board.view"], ["alerts.ack"])).toBe(false);
    expect(hasAny(undefined, ["alerts.ack"])).toBe(false);
    expect(hasAny([], null)).toBe(true);           // no requirement = open
  });

  it("derives a display role from permissions, most privileged first", () => {
    expect(uiRoleFromPerms(["users.manage", "board.view"])).toBe(ROLE.HOSPITAL_ADMIN);
    expect(uiRoleFromPerms(["admissions.sign_off"])).toBe(ROLE.ATTENDING);
    expect(uiRoleFromPerms(["admissions.admit"])).toBe(ROLE.CHARGE_NURSE);
    expect(uiRoleFromPerms(["alerts.escalate"])).toBe(ROLE.RRT);
    expect(uiRoleFromPerms(["devices.manage"])).toBe(ROLE.BIOMEDICAL);
    expect(uiRoleFromPerms(["admissions.view"])).toBe(ROLE.PHARMACIST);
    expect(uiRoleFromPerms([])).toBeNull();
  });
});

describe("demo sessions carry perms", () => {
  it("loginAs attaches the role's permissions to the session user", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.CHARGE_NURSE);
    expect(store.getState().user.perms).toContain("admissions.admit");
    expect(store.getState().user.perms).not.toContain("users.manage");
  });

  it("a PIN switch re-derives perms for the new user", () => {
    const store = createDemoStore(buildRealisticState());
    store.loginAs(ROLE.CHARGE_NURSE);
    store.switchUserByPin("9999");           // Sistem Yöneticisi
    expect(store.getState().user.perms).toContain("users.manage");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/permissions.test.js`
Expected: FAIL — cannot resolve `./permissions.js`

- [ ] **Step 3: Create `permissions.js`**

```js
// src/permissions.js — the permission keys the UI gates on, mirrored from the backend catalogue
// (homunculus-engine/src/homunculus/auth/permissions.py). The backend is the source of truth:
// the live session's `perms` come from the token; this table only gives the SIMULATION the same
// vocabulary so both modes share one gate.

export const PERMISSION_KEYS = [
  "board.view", "alerts.ack", "alerts.escalate",
  "admissions.view", "admissions.admit", "admissions.sign_off",
  "admissions.move.initiate", "admissions.transfer.confirm", "admissions.discharge.confirm",
  "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
  "break_glass.use", "audit.view",
  "users.manage", "groups.manage", "structure.manage", "devices.manage",
];

// Demo ROLE -> the spec's default group permissions (§3). Not used in live mode.
export const ROLE_PERMS = {
  HOSPITAL_ADMIN: [...PERMISSION_KEYS],
  ATTENDING: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.sign_off",
    "admissions.move.initiate", "care_team.claim", "care_team.assign", "handover.sign",
    "break_glass.use",
  ],
  CHARGE_NURSE: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.admit",
    "admissions.transfer.confirm", "admissions.discharge.confirm", "care_team.claim",
    "handover.sign", "shifts.manage", "break_glass.use",
  ],
  RRT: ["board.view", "alerts.ack", "alerts.escalate", "admissions.view", "break_glass.use"],
  PHARMACIST: ["board.view", "admissions.view"],
  BIOMEDICAL: ["devices.manage"],
};

export function permsForRole(role) {
  return ROLE_PERMS[role] ? [...ROLE_PERMS[role]] : [];
}

export function hasPerm(perms, key) {
  return Array.isArray(perms) && perms.includes(key);
}

/** True when `keys` is empty/absent (nothing required) or the session holds any of them. */
export function hasAny(perms, keys) {
  if (!keys || keys.length === 0) return true;
  return Array.isArray(perms) && keys.some((k) => perms.includes(k));
}

/** A DISPLAY role for icons and labels only — never used to gate anything. */
export function uiRoleFromPerms(perms) {
  const p = Array.isArray(perms) ? perms : [];
  if (p.includes("users.manage")) return "HOSPITAL_ADMIN";
  if (p.includes("admissions.sign_off")) return "ATTENDING";
  if (p.includes("admissions.admit")) return "CHARGE_NURSE";
  if (p.includes("alerts.escalate")) return "RRT";
  if (p.includes("devices.manage")) return "BIOMEDICAL";
  if (p.includes("admissions.view")) return "PHARMACIST";
  return null;
}
```

- [ ] **Step 4: Attach perms to every demo session**

In `clinicalDemo.js` add the import near the top:

```js
import { permsForRole } from "./permissions.js";
```

Inside `createDemoStore`, just before `function login(email, credential) {`, add:

```js
  // Every session user carries `perms` so navigation gates on permissions in both modes.
  const sessionUser = (u) => ({ email: u.email, full_name: u.full_name, role: u.role, perms: permsForRole(u.role) });
```

Then replace the five session writes:

| Function | Old | New |
| --- | --- | --- |
| `login` | `set({ user: { email: who.email, full_name: who.full_name, role: who.role },` | `set({ user: sessionUser(who),` |
| `attemptLogin` | `set({ user: { email: who.email, full_name: who.full_name, role: who.role }, mfaPending: null });` | `set({ user: sessionUser(who), mfaPending: null });` |
| `completeMfaLogin` | `set({ user: { email: u.email, full_name: u.full_name, role: u.role }, mfaPending: null });` | `set({ user: sessionUser(u), mfaPending: null });` |
| `loginAs` | `set({ user: { email: who.email, full_name: who.full_name, role: who.role }, mfaPending: null });` | `set({ user: sessionUser(who), mfaPending: null });` |
| `switchUserByPin` | `set({ user: { email: u.email, full_name: u.full_name, role: u.role } });` | `set({ user: sessionUser(u) });` |

- [ ] **Step 5: Run the tests**

Run: `cd dashboard && npx vitest run src/permissions.test.js src/clinicalDemo.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/permissions.js dashboard/src/permissions.test.js dashboard/src/clinicalDemo.js
git commit -m "feat(dashboard): permission keys; demo sessions carry perms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13 (frontend): `liveAuth.js` reads the session from the token

**Files:**
- Modify: `dashboard/src/liveAuth.js` (rewrite)
- Modify: `dashboard/src/liveAuth.test.js` (rewrite)

- [ ] **Step 1: Rewrite the tests**

```js
// dashboard/src/liveAuth.test.js
import { describe, it, expect } from "vitest";
import {
  decodeJwtPayload, sessionFromToken, accessProblem, secretFromProvisioningUri,
  NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";

/** Build an unsigned JWT-shaped token (only the payload matters to the client). */
function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("decodeJwtPayload", () => {
  it("reads the payload of a base64url token", () => {
    expect(decodeJwtPayload(tokenWith({ sub: "u1" })).sub).toBe("u1");
  });
  it("returns null for a malformed token instead of throwing", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
  });
  it("handles unicode in the payload", () => {
    expect(decodeJwtPayload(tokenWith({ name: "Dr. Elif Yılmaz" })).name).toBe("Dr. Elif Yılmaz");
  });
});

describe("sessionFromToken", () => {
  it("reads tenant, groups, perms and the MFA flags", () => {
    const s = sessionFromToken(tokenWith({
      tenant: "demo-hastanesi", groups: ["nurse"], perms: ["board.view", "alerts.ack"],
      mfa_required: true, mfa_verified: false,
    }));
    expect(s).toEqual({
      tenant: "demo-hastanesi", groups: ["nurse"], perms: ["board.view", "alerts.ack"],
      mfaRequired: true, mfaVerified: false,
    });
  });

  it("fails closed on missing or malformed claims", () => {
    expect(sessionFromToken(tokenWith({ sub: "u1" }))).toEqual({
      tenant: null, groups: [], perms: [], mfaRequired: false, mfaVerified: false,
    });
    expect(sessionFromToken(tokenWith({ perms: "board.view", groups: 7 })).perms).toEqual([]);
    expect(sessionFromToken(tokenWith({ perms: ["board.view", 3, null] })).perms).toEqual(["board.view"]);
    expect(sessionFromToken("garbage")).toBeNull();
  });
});

describe("accessProblem", () => {
  const s = (perms) => ({ tenant: "t", groups: [], perms, mfaRequired: false, mfaVerified: false });
  it("refuses a session with no permissions at all", () => {
    expect(accessProblem(s([]))).toBe(NO_PERMISSIONS);
    expect(accessProblem(null)).toBe(NO_PERMISSIONS);
  });
  it("refuses a session that cannot see the board", () => {
    expect(accessProblem(s(["devices.manage"]))).toBe(NO_BOARD_ACCESS);
  });
  it("accepts a session with board.view", () => {
    expect(accessProblem(s(["board.view"]))).toBeNull();
  });
});

describe("secretFromProvisioningUri", () => {
  it("extracts the shared secret for manual authenticator entry", () => {
    expect(secretFromProvisioningUri("otpauth://totp/Homunculus:ayse?secret=JBSWY3DPEHPK3PXP&issuer=Homunculus"))
      .toBe("JBSWY3DPEHPK3PXP");
  });
  it("returns null when there is none", () => {
    expect(secretFromProvisioningUri("otpauth://totp/x")).toBeNull();
    expect(secretFromProvisioningUri("nonsense")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/liveAuth.test.js`
Expected: FAIL — `sessionFromToken` is not exported

- [ ] **Step 3: Rewrite `liveAuth.js`**

```js
// src/liveAuth.js — read the session the backend put into the access token.
//
// The token carries {tenant, groups, perms, mfa_required, mfa_verified}. The UI gates on
// `perms` and nothing else; there is no role map any more, so there is nothing to widen by
// accident. Reading fails closed: a claim that is not the expected shape is treated as absent.

/** Reason codes for refusing a session. */
export const NO_PERMISSIONS = "NO_PERMISSIONS";
export const NO_BOARD_ACCESS = "NO_BOARD_ACCESS";

/** Decode a JWT payload client-side (display only — the signature is verified by the API). */
export function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The session described by an access token, or null when the token is unreadable. */
export function sessionFromToken(token) {
  const p = decodeJwtPayload(token);
  if (!p || typeof p !== "object") return null;
  return {
    tenant: typeof p.tenant === "string" ? p.tenant : null,
    groups: strings(p.groups),
    perms: strings(p.perms),
    mfaRequired: p.mfa_required === true,
    mfaVerified: p.mfa_verified === true,
  };
}

/** Why a session cannot open the clinical UI, or null when it can. */
export function accessProblem(session) {
  if (!session || session.perms.length === 0) return NO_PERMISSIONS;
  if (!session.perms.includes("board.view")) return NO_BOARD_ACCESS;
  return null;
}

/** The shared secret inside an otpauth:// URI, for manual entry into an authenticator. */
export function secretFromProvisioningUri(uri) {
  try {
    return new URL(uri).searchParams.get("secret") || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd dashboard && npx vitest run src/liveAuth.test.js`
Expected: `11 passed`. (`liveStore.test.js` now fails to import `roleFromToken` — Task 14 rewrites the store.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/liveAuth.js dashboard/src/liveAuth.test.js
git commit -m "feat(dashboard): the session is read from the token's perms; the role map is gone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14 (frontend): The live store — session with perms, MFA enrolment, ack attribution

**Files:**
- Modify: `dashboard/src/liveStore.js`
- Modify: `dashboard/src/liveStore.test.js` (rewrite)
- Modify: `dashboard/src/liveStore.live.test.js` (token + two assertions)

- [ ] **Step 1: Rewrite `liveStore.test.js`**

```js
// dashboard/src/liveStore.test.js
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { ROLE } from "./clinicalDemo.js";

function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

const ADMIN_PERMS = ["board.view", "alerts.ack", "users.manage", "groups.manage"];
const adminToken = tokenWith({ tenant: "t1", groups: ["hospital_admin"], perms: ADMIN_PERMS });
const nurseToken = tokenWith({ tenant: "t1", groups: ["nurse"], perms: ["board.view", "alerts.ack", "admissions.admit"] });
const biomedToken = tokenWith({ tenant: "t1", groups: ["biomedical"], perms: ["devices.manage"] });
const mfaToken = tokenWith({ tenant: "t1", groups: ["hospital_admin"], perms: ADMIN_PERMS, mfa_required: true, mfa_verified: false });

/** Minimal stand-in for the simulation store the live store wraps. */
function fakeBase(extra = {}) {
  let state = { user: null, mfaPending: null, beds: ["bed-1"], ...extra };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    admitPatient: vi.fn(() => "admitted"),
    logout: vi.fn(() => { state = { ...state, user: null }; }),
  };
}

const ME = { email: "admin@example.com", username: "admin", full_name: "Sistem Yöneticisi",
             groups: [{ slug: "hospital_admin", name: "Sistem Yöneticisi" }], totp_enabled: false };

function fakeApi({ login, me, verifyTotp, setupTotp, accessToken } = {}) {
  return {
    login: login || vi.fn(async () => ({ access_token: adminToken, requires_mfa: false, mfa_enrolled: false })),
    me: me || vi.fn(async () => ME),
    verifyTotp: verifyTotp || vi.fn(async () => ({ access_token: adminToken, requires_mfa: false, mfa_enrolled: true })),
    setupTotp: setupTotp || vi.fn(async () => ({
      provisioning_uri: "otpauth://totp/Homunculus:admin?secret=JBSWY3DPEHPK3PXP&issuer=Homunculus",
    })),
    accessToken: accessToken || vi.fn(() => null),
    logout: vi.fn(),
  };
}

describe("liveStore — real authentication over the simulation", () => {
  it("opens a session carrying the token's perms and groups", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.attemptLogin("admin", "gizli");

    expect(api.login).toHaveBeenCalledWith("admin", "gizli");
    expect(store.getState().user).toEqual({
      email: "admin@example.com", username: "admin", full_name: "Sistem Yöneticisi",
      role: ROLE.HOSPITAL_ADMIN, perms: ADMIN_PERMS, groups: ["hospital_admin"],
      groupNames: ["Sistem Yöneticisi"],
    });
    expect(store.getState().live).toBe(true);
  });

  it("derives a display role from perms for a nurse", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("ayse", "gizli");
    expect(store.getState().user.role).toBe(ROLE.CHARGE_NURSE);
    expect(store.getState().user.perms).toContain("admissions.admit");
  });

  it("holds the session at the MFA gate and says whether the user is enrolled", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: false })) });
    const store = createLiveStore({ api, base: fakeBase() });

    const res = await store.attemptLogin("admin", "gizli");

    expect(res).toEqual({ mfaRequired: true, enrolled: false });
    expect(store.getState().user).toBeNull();
    expect(store.getState().mfaPending).toMatchObject({
      email: "admin", full_name: "Sistem Yöneticisi", enrolled: false, live: true,
      groupNames: ["Sistem Yöneticisi"],
    });
  });

  it("completes the session once the TOTP code verifies", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: true })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");

    await store.completeMfaLogin(" 123456 ");

    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
    expect(store.getState().user.perms).toEqual(ADMIN_PERMS);
    expect(store.getState().mfaPending).toBeNull();
  });

  it("live MFA enrolment returns the provisioning URI and the manual key", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const setup = await store.setupMfa({ userId: "ignored" });
    expect(setup.provisioningUri).toMatch(/^otpauth:/);
    expect(setup.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("cancelling the MFA gate clears the pending session and the tokens", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: true })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");

    store.cancelMfaLogin();

    expect(store.getState().mfaPending).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("REFUSES a session with no permissions and drops the tokens", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: tokenWith({ sub: "u1" }), requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.attemptLogin("bos", "gizli")).rejects.toThrow(/yetki/i);
    expect(store.getState().user).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("REFUSES a session that cannot see the board", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: biomedToken, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.attemptLogin("ahmet", "gizli")).rejects.toThrow(/Panoya/i);
    expect(api.logout).toHaveBeenCalled();
  });

  it("surfaces the backend's own error message on a bad password", async () => {
    const api = fakeApi({ login: vi.fn(async () => { throw new Error("Invalid credentials"); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.attemptLogin("a", "yanlis")).rejects.toThrow(/Invalid credentials/);
  });

  it("logging out clears the session and the tokens", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");
    store.logout();
    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it("notifies subscribers when the session changes", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const seen = vi.fn();
    store.subscribe(seen);
    await store.attemptLogin("admin", "gizli");
    expect(seen).toHaveBeenCalled();
  });

  it("delegates everything else to the simulation, which keeps working", () => {
    const base = fakeBase({ structure: { units: ["unit-1"] } });
    const store = createLiveStore({ api: fakeApi(), base });
    expect(store.getState().structure.units).toEqual(["unit-1"]);
    expect(store.admitPatient({})).toBe("admitted");
  });

  it("restoreSession reopens a stored session", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => adminToken) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(true);
    expect(store.getState().user.perms).toEqual(ADMIN_PERMS);
  });

  it("restoreSession lands a pending-MFA token on the gate, not in the app", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => mfaToken) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(true);
    expect(store.getState().user).toBeNull();
    expect(store.getState().mfaPending).toMatchObject({ enrolled: false, live: true });
  });

  it("restoreSession clears stale tokens when the profile cannot be read", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => adminToken), me: vi.fn(async () => { throw new Error("401"); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(false);
    expect(api.logout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Update `liveStore.live.test.js`**

Replace the token line:

```js
const nurseToken = tokenWith({ tenant: "t1", groups: ["nurse"], perms: ["board.view", "alerts.ack"] });
```

In the test "acknowledges through the API using the id AckModal actually sends, and refreshes"
change the comment's tail to "the actor is attributed by the API from the token" and the
assertion to:

```js
    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis");
```

Rename the next test to `"acknowledges without inventing an actor when nobody is signed in"` and
change its assertion to the same `toHaveBeenCalledWith("bed-3", "sepsis")`.

- [ ] **Step 3: Run to verify failure**

Run: `cd dashboard && npx vitest run src/liveStore.test.js src/liveStore.live.test.js`
Expected: FAIL — `roleFromToken` import error / assertions on `perms`.

- [ ] **Step 4: Change `liveStore.js`**

Replace the `liveAuth` import with:

```js
import {
  sessionFromToken, accessProblem, secretFromProvisioningUri, NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";
import { uiRoleFromPerms } from "./permissions.js";
```

In the `overlay` initialiser add, after `tenantSetup: true,`:

```js
    // Tells the UI it is talking to the real backend: simulation-only controls hide on it.
    live: true,
```

Replace `resolveRole` and `openSession` with:

```js
  /** The session in a token, refusing anything that cannot open the clinical UI. */
  function resolveSession(accessToken) {
    const session = sessionFromToken(accessToken);
    const problem = accessProblem(session);
    if (problem === NO_PERMISSIONS) {
      api.logout();
      throw new Error("Hesabınıza kurum yetkisi tanımlanmamış. Sistem yöneticinizle görüşün.");
    }
    if (problem === NO_BOARD_ACCESS) {
      api.logout();
      throw new Error("Panoya erişim yetkiniz yok. Sistem yöneticinizle görüşün.");
    }
    return session;
  }

  /** The UI's user object. `role` is DISPLAY ONLY (icons, labels); gating uses `perms`. */
  function sessionUser(me, session) {
    const groups = Array.isArray(me.groups) ? me.groups : [];
    return {
      email: me.email, username: me.username, full_name: me.full_name,
      role: uiRoleFromPerms(session.perms),
      perms: session.perms, groups: session.groups,
      groupNames: groups.map((g) => g.name),
    };
  }

  function pendingMfa(login, me, session, enrolled) {
    return {
      email: login, full_name: me.full_name, role: uiRoleFromPerms(session.perms),
      groupNames: (me.groups || []).map((g) => g.name), enrolled, live: true,
    };
  }

  /** Fetch the profile and open the session. */
  async function openSession(session) {
    const me = await api.me();
    setOverlay({ user: sessionUser(me, session), mfaPending: null });
    emit();
    return { mfaRequired: false };
  }
```

In `acknowledgeAlert` delete the `const role = …` line and change the call to
`await api.acknowledge(patientId, kind);`; change the doc comment's last sentence to
"The actor is attributed by the API from the signed token, never sent from here."

Replace the `attemptLogin`, `completeMfaLogin`, `restoreSession` methods and add `setupMfa`,
`cancelMfaLogin`, `changePassword` in the returned object:

```js
    /** Password step. Resolves to {mfaRequired, enrolled?} — the UI shows the TOTP gate when
     *  mfaRequired, and the enrolment (QR) flow inside it when not yet enrolled. */
    async attemptLogin(login, credential) {
      const tokens = await api.login(login, credential);
      const session = resolveSession(tokens.access_token);
      if (tokens.requires_mfa) {
        // The profile is readable before the MFA step; the gate shows who is enrolling.
        const me = await api.me();
        const enrolled = tokens.mfa_enrolled === true;
        setOverlay({ user: null, mfaPending: pendingMfa(login, me, session, enrolled) });
        emit();
        return { mfaRequired: true, enrolled };
      }
      return openSession(session);
    },

    /** Authenticator step of the LOGIN flow — exchanges the 6-digit code for MFA-verified tokens. */
    async completeMfaLogin(code) {
      const tokens = await api.verifyTotp(String(code).trim());
      return openSession(resolveSession(tokens.access_token));
    },

    /** Live MFA enrolment: the API mints the secret; the gate shows the QR and the manual key. */
    async setupMfa() {
      const res = await api.setupTotp();
      return {
        provisioningUri: res.provisioning_uri,
        secret: secretFromProvisioningUri(res.provisioning_uri),
      };
    },

    /** Back out of the MFA gate. Overrides the simulation's version, which writes to the base
     *  store — leaving OUR overlay's mfaPending set and the gate stuck on screen. */
    cancelMfaLogin() {
      api.logout();
      setOverlay({ user: null, mfaPending: null });
      emit();
    },

    changePassword(current, next) {
      return api.changePassword(current, next);
    },

    /** Reopen the session from tokens a previous page load left in storage. A token whose MFA
     *  step is still pending lands on the gate, never in the app. */
    async restoreSession() {
      if (typeof api.accessToken !== "function" || !api.accessToken()) return false;
      try {
        const me = await api.me();
        const session = resolveSession(api.accessToken());  // reread: me() may have refreshed
        if (session.mfaRequired && !session.mfaVerified) {
          setOverlay({ user: null, mfaPending: pendingMfa(me.email || me.username, me, session,
                                                          me.totp_enabled === true) });
        } else {
          setOverlay({ user: sessionUser(me, session), mfaPending: null });
        }
        emit();
        return true;
      } catch {
        api.logout();
        return false;
      }
    },
```

- [ ] **Step 5: Run the tests**

Run: `cd dashboard && npx vitest run src/liveStore.test.js src/liveStore.live.test.js`
Expected: all pass (`15` + the live file's tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/liveStore.js dashboard/src/liveStore.test.js dashboard/src/liveStore.live.test.js
git commit -m "feat(dashboard): live session carries perms; MFA enrolment against the API; ack attributed by the token

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15 (frontend): API client admin methods, adapters, store admin actions

**Files:**
- Modify: `dashboard/src/backendApi.js`
- Create: `dashboard/src/liveAdmin.js`
- Modify: `dashboard/src/liveStore.js` (admin overlay + actions)
- Test: `dashboard/src/backendApi.admin.test.js`, `dashboard/src/liveAdmin.test.js`, `dashboard/src/liveStore.admin.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// dashboard/src/backendApi.admin.test.js
import { describe, it, expect, vi } from "vitest";
import { createBackendApi } from "./backendApi.js";

/** A fetch stand-in that records calls and answers from `handler(url, init)`. */
function fakeFetch(handler) {
  const impl = vi.fn(async (url, init = {}) => {
    const r = handler(url, init) || { status: 200, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
  return impl;
}

async function signedIn(handler) {
  const fetchImpl = fakeFetch((url, init) => {
    if (url === "/auth/login") return { status: 200, body: { access_token: "A", refresh_token: "R" } };
    return handler(url, init);
  });
  const api = createBackendApi({ baseUrl: "", fetchImpl });
  await api.login("admin", "pw");
  return { api, fetchImpl };
}

const lastCall = (fetchImpl) => fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];

describe("backendApi — admin and account calls", () => {
  it("acknowledge sends only the patient and the kind", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: {} }));
    await api.acknowledge("bed-3", "sepsis");
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/ack");
    expect(JSON.parse(init.body)).toEqual({ patient_id: "bed-3", kind: "sepsis" });
    expect(init.headers.Authorization).toBe("Bearer A");
  });

  it("setUserGroups PUTs the group ids", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: { id: "u1" } }));
    await api.adminSetUserGroups("u1", ["g1", "g2"]);
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/admin/users/u1/groups");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ group_ids: ["g1", "g2"] });
  });

  it("a 204 from DELETE resolves to null instead of failing on an empty body", async () => {
    const { api } = await signedIn(() => ({ status: 204, body: undefined }));
    expect(await api.adminDeleteGroup("g1")).toBeNull();
  });

  it("changePassword posts both passwords to /auth/password", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: { ok: true } }));
    await api.changePassword("eski", "yeni-parola");
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/auth/password");
    expect(JSON.parse(init.body)).toEqual({ current_password: "eski", new_password: "yeni-parola" });
  });

  it("the other admin calls hit the documented paths", async () => {
    const seen = [];
    const { api } = await signedIn((url, init) => { seen.push(`${init.method || "GET"} ${url}`); return { status: 200, body: [] }; });
    await api.adminPermissions(); await api.adminGroups(); await api.adminUsers();
    await api.adminCreateGroup({ slug: "x" }); await api.adminUpdateGroup("g", { name: "y" });
    await api.adminCreateUser({ username: "u" }); await api.adminUpdateUser("u", { is_active: false });
    await api.adminResetPassword("u", "p"); await api.adminResetMfa("u");
    expect(seen).toEqual([
      "GET /admin/permissions", "GET /admin/groups", "GET /admin/users",
      "POST /admin/groups", "PATCH /admin/groups/g",
      "POST /admin/users", "PATCH /admin/users/u",
      "POST /admin/users/u/reset-password", "POST /admin/users/u/reset-mfa",
    ]);
  });
});
```

```js
// dashboard/src/liveAdmin.test.js
import { describe, it, expect } from "vitest";
import { userFromApi, groupFromApi } from "./liveAdmin.js";

describe("liveAdmin adapters", () => {
  it("maps an /admin/users row onto the UI shape and separates manual group ids", () => {
    const u = userFromApi({
      id: "u1", username: "ayse", email: null, full_name: "Ayşe Demir", auth_source: "ldap",
      is_active: true, totp_enabled: true, last_login_at: "2026-09-23T08:00:00Z",
      groups: [{ id: "g1", slug: "nurse", name: "Hemşire", source: "ldap" },
               { id: "g2", slug: "auditor", name: "Denetçi", source: "manual" }],
    });
    expect(u).toMatchObject({ id: "u1", username: "ayse", email: null, active: true, mfa: true,
                              authSource: "ldap", lastLoginAt: "2026-09-23T08:00:00Z" });
    expect(u.groups.map((g) => g.slug)).toEqual(["nurse", "auditor"]);
    expect(u.manualGroupIds).toEqual(["g2"]);
  });

  it("fails closed on missing fields", () => {
    const u = userFromApi({ id: "u2", username: "x", full_name: "X" });
    expect(u).toMatchObject({ active: true, mfa: false, authSource: "local", groups: [], manualGroupIds: [], lastLoginAt: null });
  });

  it("maps an /admin/groups row", () => {
    expect(groupFromApi({ id: "g1", slug: "nurse", name: "Hemşire", description: null, mfa_required: false,
                          is_system: false, permissions: ["board.view"], member_count: 3 }))
      .toEqual({ id: "g1", slug: "nurse", name: "Hemşire", description: "", mfaRequired: false,
                 isSystem: false, permissions: ["board.view"], memberCount: 3 });
  });
});
```

```js
// dashboard/src/liveStore.admin.test.js
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";

function fakeBase() {
  let state = { user: null, mfaPending: null };
  const listeners = new Set();
  return { getState: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, logout: vi.fn() };
}

const USERS = [{ id: "u1", username: "ayse", full_name: "Ayşe", is_active: true, totp_enabled: false, groups: [] }];
const GROUPS = [{ id: "g1", slug: "nurse", name: "Hemşire", mfa_required: false, is_system: false, permissions: ["board.view"], member_count: 1 }];
const PERMS = [{ key: "board.view", description: "See the board" }];

function fakeApi(overrides = {}) {
  return {
    login: vi.fn(), me: vi.fn(), logout: vi.fn(), accessToken: vi.fn(() => null),
    adminUsers: vi.fn(async () => USERS),
    adminGroups: vi.fn(async () => GROUPS),
    adminPermissions: vi.fn(async () => PERMS),
    adminCreateUser: vi.fn(async () => ({})), adminUpdateUser: vi.fn(async () => ({})),
    adminSetUserGroups: vi.fn(async () => ({})), adminResetPassword: vi.fn(async () => ({ ok: true })),
    adminResetMfa: vi.fn(async () => ({ ok: true })),
    adminCreateGroup: vi.fn(async () => ({})), adminUpdateGroup: vi.fn(async () => ({})),
    adminDeleteGroup: vi.fn(async () => null),
    ...overrides,
  };
}

describe("liveStore — administration", () => {
  it("starts with empty admin state so the simulated staff never shows", () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    expect(store.getState().adminUsers).toEqual([]);
    expect(store.getState().adminGroups).toEqual([]);
    expect(store.getState().adminPermissions).toEqual([]);
  });

  it("loadAdmin fills users, groups and the catalogue", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    await store.loadAdmin();
    const s = store.getState();
    expect(s.adminUsers[0]).toMatchObject({ username: "ayse", active: true });
    expect(s.adminGroups[0]).toMatchObject({ slug: "nurse", memberCount: 1 });
    expect(s.adminPermissions).toEqual(PERMS);
    expect(s.adminError).toBeNull();
  });

  it("a refused call leaves the rest loaded and records the reason", async () => {
    const api = fakeApi({ adminGroups: vi.fn(async () => { throw new Error("permission required: groups.manage"); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.loadAdmin();
    expect(store.getState().adminUsers).toHaveLength(1);
    expect(store.getState().adminGroups).toEqual([]);
    expect(store.getState().adminError).toMatch(/groups.manage/);
  });

  it("saving a group creates or updates, then reloads", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.adminSaveGroup({ slug: "it", name: "BT", description: "", mfaRequired: true, permissions: ["users.manage"] });
    expect(api.adminCreateGroup).toHaveBeenCalledWith({ slug: "it", name: "BT", description: "", mfa_required: true, permissions: ["users.manage"] });
    await store.adminSaveGroup({ id: "g1", slug: "nurse", name: "Hemşire", description: "x", mfaRequired: false, permissions: ["board.view"] });
    expect(api.adminUpdateGroup).toHaveBeenCalledWith("g1", { name: "Hemşire", description: "x", mfa_required: false, permissions: ["board.view"] });
    expect(api.adminUsers).toHaveBeenCalledTimes(2);        // reloaded after each save
  });

  it("user actions call the API and reload", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.adminSetUserGroups("u1", ["g1"]);
    await store.adminUpdateUser("u1", { is_active: false });
    await store.adminResetMfa("u1");
    await store.adminDeleteGroup("g1");
    expect(api.adminSetUserGroups).toHaveBeenCalledWith("u1", ["g1"]);
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u1", { is_active: false });
    expect(api.adminUsers).toHaveBeenCalledTimes(4);
  });

  it("errors from the API propagate to the caller", async () => {
    const api = fakeApi({ adminDeleteGroup: vi.fn(async () => { throw new Error("Üyesi olan grup silinemez"); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.adminDeleteGroup("g1")).rejects.toThrow(/silinemez/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/backendApi.admin.test.js src/liveAdmin.test.js src/liveStore.admin.test.js`
Expected: FAIL — missing module / missing methods.

- [ ] **Step 3: Extend `backendApi.js`**

In `authed`, before `return res.json();` add:

```js
    if (res.status === 204) return null;
```

Replace `acknowledge(patientId, kind, role)` with:

```js
    /** The actor is attributed by the API from the token; nothing about who is sent. */
    acknowledge(patientId, kind) {
      return authed("/ack", { method: "POST", body: { patient_id: patientId, kind } });
    },

    changePassword(currentPassword, newPassword) {
      return authed("/auth/password", { method: "POST",
                                        body: { current_password: currentPassword, new_password: newPassword } });
    },

    // ---- administration (/admin, see homunculus-engine admin/router.py) ----
    adminPermissions() { return authed("/admin/permissions"); },
    adminGroups() { return authed("/admin/groups"); },
    adminCreateGroup(body) { return authed("/admin/groups", { method: "POST", body }); },
    adminUpdateGroup(id, body) { return authed(`/admin/groups/${id}`, { method: "PATCH", body }); },
    adminDeleteGroup(id) { return authed(`/admin/groups/${id}`, { method: "DELETE" }); },
    adminUsers() { return authed("/admin/users"); },
    adminCreateUser(body) { return authed("/admin/users", { method: "POST", body }); },
    adminUpdateUser(id, body) { return authed(`/admin/users/${id}`, { method: "PATCH", body }); },
    adminSetUserGroups(id, groupIds) {
      return authed(`/admin/users/${id}/groups`, { method: "PUT", body: { group_ids: groupIds } });
    },
    adminResetPassword(id, password) {
      return authed(`/admin/users/${id}/reset-password`, { method: "POST", body: { password } });
    },
    adminResetMfa(id) { return authed(`/admin/users/${id}/reset-mfa`, { method: "POST" }); },
```

Update the file's header comment: the client now also speaks the administration API.

- [ ] **Step 4: Create `liveAdmin.js`**

```js
// src/liveAdmin.js — adapters from the /admin payloads onto the shapes the admin panels render.
// Fail closed: a missing flag reads as the safer value (inactive is NOT assumed — an account the
// API says nothing about is shown as it is, active, so nobody is quietly hidden).

export function userFromApi(u) {
  const groups = Array.isArray(u.groups) ? u.groups : [];
  const mapped = groups.map((g) => ({ id: g.id, slug: g.slug, name: g.name, source: g.source || "manual" }));
  return {
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    full_name: u.full_name,
    authSource: u.auth_source || "local",
    active: u.is_active !== false,
    mfa: u.totp_enabled === true,
    lastLoginAt: u.last_login_at ?? null,
    groups: mapped,
    manualGroupIds: mapped.filter((g) => g.source === "manual").map((g) => g.id),
  };
}

export function groupFromApi(g) {
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description || "",
    mfaRequired: g.mfa_required === true,
    isSystem: g.is_system === true,
    permissions: Array.isArray(g.permissions) ? [...g.permissions] : [],
    memberCount: Number(g.member_count) || 0,
  };
}
```

- [ ] **Step 5: Add the admin overlay and actions to `liveStore.js`**

Add the import:

```js
import { userFromApi, groupFromApi } from "./liveAdmin.js";
```

In the `overlay` initialiser add, after `live: true,`:

```js
    // Administration state lives under its own keys so the simulation's `users` is untouched
    // (the simulated admission/care pickers still read it in live mode; they are not backed).
    adminUsers: [], adminGroups: [], adminPermissions: [], adminError: null,
```

Before `return {` add:

```js
  /** Load users, groups and the catalogue. A refused call (403) leaves the others loaded and
   *  the reason in `adminError` — a nurse-manager without groups.manage still sees users. */
  async function loadAdmin() {
    const [users, groups, perms] = await Promise.allSettled([
      api.adminUsers(), api.adminGroups(), api.adminPermissions(),
    ]);
    const failed = [users, groups, perms].find((r) => r.status === "rejected");
    setOverlay({
      adminUsers: users.status === "fulfilled" ? users.value.map(userFromApi) : [],
      adminGroups: groups.status === "fulfilled" ? groups.value.map(groupFromApi) : [],
      adminPermissions: perms.status === "fulfilled" ? perms.value : [],
      adminError: failed ? (failed.reason?.message || String(failed.reason)) : null,
    });
    emit();
  }

  /** Run an admin call, then reload so the screen shows what the server now holds. */
  const thenReload = async (promise) => {
    const result = await promise;
    await loadAdmin();
    return result;
  };
```

In the returned object add:

```js
    loadAdmin,
    adminCreateUser: (body) => thenReload(api.adminCreateUser(body)),
    adminUpdateUser: (id, body) => thenReload(api.adminUpdateUser(id, body)),
    adminSetUserGroups: (id, groupIds) => thenReload(api.adminSetUserGroups(id, groupIds)),
    adminResetPassword: (id, password) => api.adminResetPassword(id, password),
    adminResetMfa: (id) => thenReload(api.adminResetMfa(id)),
    adminSaveGroup: (g) => thenReload(g.id
      ? api.adminUpdateGroup(g.id, { name: g.name, description: g.description,
                                     mfa_required: g.mfaRequired, permissions: g.permissions })
      : api.adminCreateGroup({ slug: g.slug, name: g.name, description: g.description,
                               mfa_required: g.mfaRequired, permissions: g.permissions })),
    adminDeleteGroup: (id) => thenReload(api.adminDeleteGroup(id)),
```

- [ ] **Step 6: Run the tests**

Run: `cd dashboard && npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/backendApi.js dashboard/src/liveAdmin.js dashboard/src/liveStore.js dashboard/src/backendApi.admin.test.js dashboard/src/liveAdmin.test.js dashboard/src/liveStore.admin.test.js
git commit -m "feat(dashboard): admin API client, adapters and store actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16 (frontend): i18n — the `rbac` strings in TR / AZ / EN / RU

**Files:**
- Modify: `dashboard/src/clinicalI18n.js`
- Test: `dashboard/src/i18n.rbac.test.js`

- [ ] **Step 1: Write the failing test**

```js
// dashboard/src/i18n.rbac.test.js
import { describe, it, expect } from "vitest";
import { cstrings, LANGS } from "./clinicalI18n.js";
import { PERMISSION_KEYS } from "./permissions.js";

describe("rbac strings", () => {
  const langs = LANGS.map((l) => l[0]);          // LANGS entries are [key, label, flag]
  it("every language has the rbac block with a label for every permission key", () => {
    for (const lang of langs) {
      const R = cstrings(lang).rbac;
      expect(R, lang).toBeDefined();
      for (const key of PERMISSION_KEYS) expect(R.perm[key], `${lang} ${key}`).toBeTruthy();
      for (const k of ["groupsTitle", "usersTitle", "newGroup", "save", "delete", "deleteConfirm",
                       "username", "tempPassword", "editGroups", "resetPassword", "resetMfa",
                       "sourceLdap", "mfaManualKey", "passwordManagedByAd"]) {
        expect(R[k], `${lang} ${k}`).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/i18n.rbac.test.js`
Expected: FAIL — `rbac` undefined for `tr`.

- [ ] **Step 3: Add the block to each language**

In `clinicalI18n.js`, inside **each** of the four language objects, insert the `rbac` object
immediately before that language's `pr13: {` line.

Turkish (`tr`):

```js
    rbac: {
      groupsTitle: "Gruplar ve İzinler",
      groupsSub: "Her grup bir izin kümesi taşır; bir kullanıcı gruplarının birleşimi kadar yetkilidir.",
      usersTitle: "Kullanıcılar", usersSub: "Yerel hesaplar burada açılır; AD hesapları içe alınır.",
      newGroup: "Yeni grup", editGroup: "Grubu düzenle", groupName: "Grup adı", groupSlug: "Kısa ad",
      groupSlugHint: "Küçük harf, rakam ve _ (ör. sorumlu_hemsire). Sonradan değişmez.",
      groupDesc: "Açıklama", mfaRequired: "İki adımlı doğrulama zorunlu",
      mfaRequiredHint: "Bu gruptaki herkes girişte doğrulama kodu girer.",
      permissions: "İzinler", members: "üye", system: "Sistem grubu",
      save: "Kaydet", cancel: "Vazgeç", delete: "Sil", deleteConfirm: "Bu grup silinsin mi?",
      noGroups: "Henüz grup yok.", loading: "Yükleniyor…", loadFailed: "Yönetim verisi alınamadı",
      username: "Kullanıcı adı", usernameHint: "Girişte kullanılır; küçük harfe çevrilir.",
      email: "E-posta", emailOptional: "E-posta (isteğe bağlı)", fullName: "Ad Soyad",
      tempPassword: "Geçici parola", tempPasswordHint: "En az 8 karakter; kullanıcı ilk girişte değiştirir.",
      createUser: "Kullanıcı oluştur", groupsLabel: "Gruplar", editGroups: "Grupları düzenle",
      editGroupsHint: "AD eşlemesinden gelen üyelikler burada değiştirilemez.", saveGroups: "Grupları kaydet",
      sourceLocal: "Yerel", sourceLdap: "Active Directory", lastLogin: "Son giriş", never: "Hiç",
      active: "Aktif", passive: "Pasif",
      resetPassword: "Parola sıfırla", newPassword: "Yeni parola", resetMfa: "MFA sıfırla",
      deactivate: "Pasifleştir", activate: "Aktifleştir",
      passwordManagedByAd: "Parola Active Directory tarafından yönetiliyor",
      noGroupsAssigned: "Grup atanmamış", fromAd: "AD",
      mfaManualKey: "Elle giriş anahtarı", mfaCopy: "Kopyala", copied: "Kopyalandı",
      mfaQrUnavailable: "QR üretilemedi; anahtarı elle girin.",
      perm: {
        "board.view": "Panoyu görme", "alerts.ack": "Alarm onaylama",
        "alerts.escalate": "Alarm oluşturma ve eskalasyon",
        "admissions.view": "Kabul kayıtlarını okuma", "admissions.admit": "Hasta kabul",
        "admissions.sign_off": "Kabul onayı (hekim)",
        "admissions.move.initiate": "Transfer/taburcu başlatma",
        "admissions.transfer.confirm": "Transfer onaylama",
        "admissions.discharge.confirm": "Taburcu onaylama",
        "care_team.claim": "Bakım ekibinde rol üstlenme", "care_team.assign": "Bakım ekibi atama",
        "handover.sign": "Devir-teslim imzalama", "shifts.manage": "Nöbet çizelgesi",
        "break_glass.use": "Acil erişim (break-glass)", "audit.view": "Denetim kaydını görme",
        "users.manage": "Kullanıcı yönetimi", "groups.manage": "Grup ve izin yönetimi",
        "structure.manage": "Yapı yönetimi (ünite/oda/yatak)", "devices.manage": "Cihaz yönetimi",
      },
    },
```

Azerbaijani (`az`):

```js
    rbac: {
      groupsTitle: "Qruplar və İcazələr",
      groupsSub: "Hər qrup bir icazə dəsti daşıyır; istifadəçi qruplarının birləşməsi qədər səlahiyyətlidir.",
      usersTitle: "İstifadəçilər", usersSub: "Yerli hesablar burada açılır; AD hesabları idxal edilir.",
      newGroup: "Yeni qrup", editGroup: "Qrupu redaktə et", groupName: "Qrup adı", groupSlug: "Qısa ad",
      groupSlugHint: "Kiçik hərf, rəqəm və _ (məs. mesul_tibb_bacisi). Sonradan dəyişmir.",
      groupDesc: "Təsvir", mfaRequired: "İki mərhələli doğrulama məcburidir",
      mfaRequiredHint: "Bu qrupdakı hər kəs girişdə doğrulama kodu daxil edir.",
      permissions: "İcazələr", members: "üzv", system: "Sistem qrupu",
      save: "Yadda saxla", cancel: "İmtina", delete: "Sil", deleteConfirm: "Bu qrup silinsin?",
      noGroups: "Hələ qrup yoxdur.", loading: "Yüklənir…", loadFailed: "İdarəetmə məlumatı alınmadı",
      username: "İstifadəçi adı", usernameHint: "Girişdə istifadə olunur; kiçik hərfə çevrilir.",
      email: "E-poçt", emailOptional: "E-poçt (könüllü)", fullName: "Ad Soyad",
      tempPassword: "Müvəqqəti parol", tempPasswordHint: "Ən azı 8 simvol; istifadəçi ilk girişdə dəyişir.",
      createUser: "İstifadəçi yarat", groupsLabel: "Qruplar", editGroups: "Qrupları redaktə et",
      editGroupsHint: "AD uyğunlaşdırmasından gələn üzvlüklər burada dəyişdirilə bilməz.", saveGroups: "Qrupları yadda saxla",
      sourceLocal: "Yerli", sourceLdap: "Active Directory", lastLogin: "Son giriş", never: "Heç",
      active: "Aktiv", passive: "Passiv",
      resetPassword: "Parolu sıfırla", newPassword: "Yeni parol", resetMfa: "MFA sıfırla",
      deactivate: "Passivləşdir", activate: "Aktivləşdir",
      passwordManagedByAd: "Parol Active Directory tərəfindən idarə olunur",
      noGroupsAssigned: "Qrup təyin edilməyib", fromAd: "AD",
      mfaManualKey: "Əl ilə giriş açarı", mfaCopy: "Kopyala", copied: "Kopyalandı",
      mfaQrUnavailable: "QR yaradıla bilmədi; açarı əl ilə daxil edin.",
      perm: {
        "board.view": "Panoya baxış", "alerts.ack": "Həyəcan siqnalını təsdiq",
        "alerts.escalate": "Həyəcan siqnalı yaratma və eskalasiya",
        "admissions.view": "Qəbul qeydlərini oxuma", "admissions.admit": "Xəstə qəbulu",
        "admissions.sign_off": "Qəbul təsdiqi (həkim)",
        "admissions.move.initiate": "Köçürmə/evə yazılma başlatma",
        "admissions.transfer.confirm": "Köçürmə təsdiqi",
        "admissions.discharge.confirm": "Evə yazılma təsdiqi",
        "care_team.claim": "Baxım komandasında rol götürmə", "care_team.assign": "Baxım komandası təyini",
        "handover.sign": "Növbə təhvili imzası", "shifts.manage": "Növbə cədvəli",
        "break_glass.use": "Təcili giriş (break-glass)", "audit.view": "Audit qeydinə baxış",
        "users.manage": "İstifadəçi idarəsi", "groups.manage": "Qrup və icazə idarəsi",
        "structure.manage": "Struktur idarəsi (bölmə/otaq/çarpayı)", "devices.manage": "Cihaz idarəsi",
      },
    },
```

English (`en`):

```js
    rbac: {
      groupsTitle: "Groups and Permissions",
      groupsSub: "Each group carries a set of permissions; a user holds the union of their groups.",
      usersTitle: "Users", usersSub: "Local accounts are created here; AD accounts are imported.",
      newGroup: "New group", editGroup: "Edit group", groupName: "Group name", groupSlug: "Short name",
      groupSlugHint: "Lower-case letters, digits and _ (e.g. charge_nurse). Cannot be changed later.",
      groupDesc: "Description", mfaRequired: "Two-step verification required",
      mfaRequiredHint: "Everyone in this group enters a verification code at sign-in.",
      permissions: "Permissions", members: "members", system: "System group",
      save: "Save", cancel: "Cancel", delete: "Delete", deleteConfirm: "Delete this group?",
      noGroups: "No groups yet.", loading: "Loading…", loadFailed: "Administration data could not be loaded",
      username: "Username", usernameHint: "Used at sign-in; stored in lower case.",
      email: "Email", emailOptional: "Email (optional)", fullName: "Full name",
      tempPassword: "Temporary password", tempPasswordHint: "At least 8 characters; the user changes it at first sign-in.",
      createUser: "Create user", groupsLabel: "Groups", editGroups: "Edit groups",
      editGroupsHint: "Memberships that come from the AD mapping cannot be changed here.", saveGroups: "Save groups",
      sourceLocal: "Local", sourceLdap: "Active Directory", lastLogin: "Last sign-in", never: "Never",
      active: "Active", passive: "Inactive",
      resetPassword: "Reset password", newPassword: "New password", resetMfa: "Reset MFA",
      deactivate: "Deactivate", activate: "Activate",
      passwordManagedByAd: "The password is managed by Active Directory",
      noGroupsAssigned: "No groups assigned", fromAd: "AD",
      mfaManualKey: "Manual entry key", mfaCopy: "Copy", copied: "Copied",
      mfaQrUnavailable: "The QR code could not be rendered; enter the key manually.",
      perm: {
        "board.view": "View the board", "alerts.ack": "Acknowledge alerts",
        "alerts.escalate": "Create and escalate alerts",
        "admissions.view": "Read admissions", "admissions.admit": "Admit patients",
        "admissions.sign_off": "Sign off admissions (physician)",
        "admissions.move.initiate": "Initiate transfer/discharge",
        "admissions.transfer.confirm": "Confirm transfer",
        "admissions.discharge.confirm": "Confirm discharge",
        "care_team.claim": "Claim a care-team role", "care_team.assign": "Assign the care team",
        "handover.sign": "Sign handovers", "shifts.manage": "Shift schedules",
        "break_glass.use": "Emergency access (break-glass)", "audit.view": "View the audit trail",
        "users.manage": "Manage users", "groups.manage": "Manage groups and permissions",
        "structure.manage": "Manage structure (unit/room/bed)", "devices.manage": "Manage devices",
      },
    },
```

Russian (`ru`):

```js
    rbac: {
      groupsTitle: "Группы и права",
      groupsSub: "Каждая группа несёт набор прав; пользователь имеет объединение прав своих групп.",
      usersTitle: "Пользователи", usersSub: "Локальные учётные записи создаются здесь; учётные записи AD импортируются.",
      newGroup: "Новая группа", editGroup: "Изменить группу", groupName: "Название группы", groupSlug: "Короткое имя",
      groupSlugHint: "Строчные буквы, цифры и _ (напр. charge_nurse). Не меняется впоследствии.",
      groupDesc: "Описание", mfaRequired: "Двухэтапная проверка обязательна",
      mfaRequiredHint: "Все участники этой группы вводят код при входе.",
      permissions: "Права", members: "участн.", system: "Системная группа",
      save: "Сохранить", cancel: "Отмена", delete: "Удалить", deleteConfirm: "Удалить эту группу?",
      noGroups: "Групп пока нет.", loading: "Загрузка…", loadFailed: "Не удалось загрузить данные администрирования",
      username: "Имя пользователя", usernameHint: "Используется при входе; хранится в нижнем регистре.",
      email: "Эл. почта", emailOptional: "Эл. почта (необязательно)", fullName: "Полное имя",
      tempPassword: "Временный пароль", tempPasswordHint: "Не менее 8 символов; пользователь меняет его при первом входе.",
      createUser: "Создать пользователя", groupsLabel: "Группы", editGroups: "Изменить группы",
      editGroupsHint: "Членство, полученное из сопоставления AD, здесь изменить нельзя.", saveGroups: "Сохранить группы",
      sourceLocal: "Локальная", sourceLdap: "Active Directory", lastLogin: "Последний вход", never: "Никогда",
      active: "Активен", passive: "Неактивен",
      resetPassword: "Сбросить пароль", newPassword: "Новый пароль", resetMfa: "Сбросить MFA",
      deactivate: "Деактивировать", activate: "Активировать",
      passwordManagedByAd: "Пароль управляется Active Directory",
      noGroupsAssigned: "Группы не назначены", fromAd: "AD",
      mfaManualKey: "Ключ для ручного ввода", mfaCopy: "Копировать", copied: "Скопировано",
      mfaQrUnavailable: "QR-код не удалось построить; введите ключ вручную.",
      perm: {
        "board.view": "Просмотр панели", "alerts.ack": "Подтверждение тревог",
        "alerts.escalate": "Создание и эскалация тревог",
        "admissions.view": "Чтение госпитализаций", "admissions.admit": "Госпитализация пациентов",
        "admissions.sign_off": "Подтверждение госпитализации (врач)",
        "admissions.move.initiate": "Инициировать перевод/выписку",
        "admissions.transfer.confirm": "Подтвердить перевод",
        "admissions.discharge.confirm": "Подтвердить выписку",
        "care_team.claim": "Взять роль в бригаде", "care_team.assign": "Назначить бригаду",
        "handover.sign": "Подписание передачи смены", "shifts.manage": "График смен",
        "break_glass.use": "Экстренный доступ (break-glass)", "audit.view": "Просмотр журнала аудита",
        "users.manage": "Управление пользователями", "groups.manage": "Управление группами и правами",
        "structure.manage": "Управление структурой (отделение/палата/койка)", "devices.manage": "Управление устройствами",
      },
    },
```

- [ ] **Step 4: Run the tests**

Run: `cd dashboard && npx vitest run src/i18n.rbac.test.js src/i18n.test.jsx`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/clinicalI18n.js dashboard/src/i18n.rbac.test.js
git commit -m "feat(dashboard): rbac strings in TR, AZ, EN and RU

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 17 (frontend): `GroupAdmin` panel

**Files:**
- Create: `dashboard/src/admin/GroupAdmin.jsx`
- Test: `dashboard/src/admin/GroupAdmin.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// dashboard/src/admin/GroupAdmin.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { GroupAdmin } from "./GroupAdmin.jsx";
import { cstrings } from "../clinicalI18n.js";
import { getTheme } from "../clinicalTheme.js";

const T = getTheme("icu");
const S = cstrings("tr");

const GROUPS = [
  { id: "g1", slug: "hospital_admin", name: "Sistem Yöneticisi", description: "", mfaRequired: true,
    isSystem: true, permissions: ["users.manage", "board.view"], memberCount: 1 },
  { id: "g2", slug: "nurse", name: "Hemşire", description: "Servis", mfaRequired: false,
    isSystem: false, permissions: ["board.view"], memberCount: 4 },
];
const PERMS = [
  { key: "board.view", description: "See the board" },
  { key: "users.manage", description: "Manage users" },
];

function setup({ perms = ["groups.manage"], store = {} } = {}) {
  const fakeStore = {
    adminSaveGroup: vi.fn(async () => ({})),
    adminDeleteGroup: vi.fn(async () => null),
    ...store,
  };
  const state = { user: { perms }, adminGroups: GROUPS, adminPermissions: PERMS };
  render(<GroupAdmin T={T} S={S} store={fakeStore} state={state} />);
  return fakeStore;
}

describe("GroupAdmin", () => {
  beforeEach(() => { vi.spyOn(window, "confirm").mockReturnValue(true); });

  it("lists groups with member counts, flags and translated permission labels", () => {
    setup();
    const nurse = within(screen.getByTestId("group-nurse"));
    expect(nurse.getByText("Hemşire")).toBeInTheDocument();
    expect(nurse.getByText(/4 üye/)).toBeInTheDocument();
    expect(nurse.getByText("Panoyu görme")).toBeInTheDocument();
    const admin = within(screen.getByTestId("group-hospital_admin"));
    expect(admin.getByText(/Sistem grubu/)).toBeInTheDocument();
  });

  it("creates a group from the editor", async () => {
    const store = setup();
    fireEvent.click(screen.getByText("Yeni grup"));
    fireEvent.change(screen.getByLabelText("Grup adı"), { target: { value: "BT Destek" } });
    fireEvent.change(screen.getByLabelText(/^Kısa ad/), { target: { value: "IT_destek" } });
    fireEvent.click(screen.getByLabelText("İki adımlı doğrulama zorunlu"));
    fireEvent.click(screen.getByLabelText(/Kullanıcı yönetimi/));
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0]).toMatchObject({
      id: null, slug: "it_destek", name: "BT Destek", mfaRequired: true, permissions: ["users.manage"],
    });
  });

  it("edits an existing group without offering to change its slug", async () => {
    const store = setup();
    fireEvent.click(screen.getByLabelText("Grubu düzenle Hemşire"));
    expect(screen.queryByLabelText(/^Kısa ad/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Kullanıcı yönetimi/));
    fireEvent.click(screen.getByText("Kaydet"));
    await waitFor(() => expect(store.adminSaveGroup).toHaveBeenCalled());
    expect(store.adminSaveGroup.mock.calls[0][0]).toMatchObject({
      id: "g2", permissions: ["board.view", "users.manage"],
    });
  });

  it("deletes after confirmation, but never offers to delete a system group", async () => {
    const store = setup();
    expect(screen.queryByLabelText("Sil Sistem Yöneticisi")).toBeNull();
    fireEvent.click(screen.getByLabelText("Sil Hemşire"));
    await waitFor(() => expect(store.adminDeleteGroup).toHaveBeenCalledWith("g2"));
  });

  it("surfaces the server's refusal", async () => {
    setup({ store: { adminDeleteGroup: vi.fn(async () => { throw new Error("Üyesi olan grup silinemez"); }) } });
    fireEvent.click(screen.getByLabelText("Sil Hemşire"));
    expect(await screen.findByText("Üyesi olan grup silinemez")).toBeInTheDocument();
  });

  it("is read-only without groups.manage", () => {
    setup({ perms: ["users.manage"] });
    expect(screen.queryByText("Yeni grup")).toBeNull();
    expect(screen.queryByLabelText("Grubu düzenle Hemşire")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/admin/GroupAdmin.test.jsx`
Expected: FAIL — cannot resolve `./GroupAdmin.jsx`

- [ ] **Step 3: Write the component**

```jsx
// src/admin/GroupAdmin.jsx — groups and their permission sets, backed by /admin/groups.
// Renders only what the API returned (state.adminGroups / state.adminPermissions); every change
// goes through the store, which reloads from the server afterwards.
import React, { useState } from "react";
import { Plus, Pencil, Trash2, ShieldCheck, Lock } from "lucide-react";
import { Field, inputCls, btnCls, ActionOverlay } from "../ui.jsx";
import { hasPerm } from "../permissions.js";

const BLANK = { id: null, slug: "", name: "", description: "", mfaRequired: false, permissions: [] };

export function GroupAdmin({ T, S, store, state }) {
  const R = S.rbac;
  const groups = state.adminGroups || [];
  const catalogue = state.adminPermissions || [];
  const canManage = hasPerm(state.user?.perms, "groups.manage");
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const permLabel = (key) => R.perm[key] || key;
  const toggle = (key) => setEditing((g) => ({
    ...g,
    permissions: g.permissions.includes(key) ? g.permissions.filter((k) => k !== key) : [...g.permissions, key],
  }));

  const save = async () => {
    setBusy(true);
    try { await store.adminSaveGroup(editing); setEditing(null); setErr(""); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  const remove = async (g) => {
    if (!window.confirm(R.deleteConfirm)) return;
    try { await store.adminDeleteGroup(g.id); setErr(""); }
    catch (ex) { setErr(ex.message); }
  };

  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className={`font-bold ${T.heading}`}>{R.groupsTitle}</h3>
        {canManage && (
          <button onClick={() => setEditing({ ...BLANK })} className={btnCls(T, "primary")}>
            <Plus size={15} /> {R.newGroup}
          </button>
        )}
      </div>
      <p className={`mb-4 text-sm ${T.muted}`}>{R.groupsSub}</p>
      {err && <div className="mb-3 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      {groups.length === 0 && <div className={`text-sm ${T.faint}`}>{R.noGroups}</div>}

      <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {groups.map((g) => (
          <div key={g.id} className="px-3 py-2.5" data-testid={`group-${g.slug}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0">
                <div className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${T.text}`}>
                  {g.name}
                  {g.isSystem && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${T.chip}`}>
                      <Lock size={10} className="mr-1 inline" />{R.system}
                    </span>
                  )}
                  {g.mfaRequired && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                      <ShieldCheck size={10} className="mr-1 inline" />MFA
                    </span>
                  )}
                </div>
                <div className={`truncate text-xs ${T.faint}`}>
                  {g.slug} · {g.memberCount} {R.members}{g.description ? ` · ${g.description}` : ""}
                </div>
                <div className={`mt-1 flex flex-wrap gap-1 text-[11px] ${T.muted}`}>
                  {g.permissions.map((k) => (
                    <span key={k} className={`rounded-md px-1.5 py-0.5 ${T.subtle}`}>{permLabel(k)}</span>
                  ))}
                </div>
              </div>
              {canManage && (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button onClick={() => setEditing({ ...g })} className={btnCls(T, "ghost")}
                    aria-label={`${R.editGroup} ${g.name}`}><Pencil size={14} /></button>
                  {!g.isSystem && (
                    <button onClick={() => remove(g)} className={btnCls(T, "ghost")}
                      aria-label={`${R.delete} ${g.name}`}><Trash2 size={14} /></button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ActionOverlay T={T} title={editing.id ? R.editGroup : R.newGroup} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <Field T={T} label={R.groupName}>
              <input className={inputCls(T)} value={editing.name} autoFocus
                onChange={(e) => setEditing((g) => ({ ...g, name: e.target.value }))} />
            </Field>
            {!editing.id && (
              <Field T={T} label={R.groupSlug} hint={R.groupSlugHint}>
                <input className={inputCls(T)} value={editing.slug}
                  onChange={(e) => setEditing((g) => ({ ...g, slug: e.target.value.toLowerCase() }))} />
              </Field>
            )}
            <Field T={T} label={R.groupDesc}>
              <input className={inputCls(T)} value={editing.description}
                onChange={(e) => setEditing((g) => ({ ...g, description: e.target.value }))} />
            </Field>
            <label className={`flex items-center gap-2 text-sm ${T.text}`}>
              <input type="checkbox" checked={editing.mfaRequired}
                onChange={(e) => setEditing((g) => ({ ...g, mfaRequired: e.target.checked }))} />
              {R.mfaRequired}
            </label>
            <div className={`text-xs font-semibold uppercase ${T.faint}`}>{R.permissions}</div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {catalogue.map((p) => (
                <label key={p.key} className={`flex cursor-pointer items-center gap-2 rounded-lg border ${T.border} ${T.subtle} px-2.5 py-1.5 text-sm`}>
                  <input type="checkbox" checked={editing.permissions.includes(p.key)} onChange={() => toggle(p.key)} />
                  <span className={T.text}>{permLabel(p.key)}</span>
                  <span className={`ml-auto font-mono text-[10px] ${T.faint}`}>{p.key}</span>
                </label>
              ))}
            </div>
            {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
            <button onClick={save} disabled={busy} className={`${btnCls(T, "primary")} w-full`}>{R.save}</button>
          </div>
        </ActionOverlay>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd dashboard && npx vitest run src/admin/GroupAdmin.test.jsx`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/admin/GroupAdmin.jsx dashboard/src/admin/GroupAdmin.test.jsx
git commit -m "feat(dashboard): GroupAdmin panel — groups, permission checkboxes, MFA flag

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 18 (frontend): `LiveUserAdmin` and the `LiveStaffTab`

**Files:**
- Create: `dashboard/src/admin/LiveUserAdmin.jsx`
- Create: `dashboard/src/admin/LiveStaffTab.jsx`
- Test: `dashboard/src/admin/LiveUserAdmin.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// dashboard/src/admin/LiveUserAdmin.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LiveUserAdmin } from "./LiveUserAdmin.jsx";
import { LiveStaffTab } from "./LiveStaffTab.jsx";
import { cstrings } from "../clinicalI18n.js";
import { getTheme } from "../clinicalTheme.js";

const T = getTheme("icu");
const S = cstrings("tr");

const GROUPS = [
  { id: "g1", slug: "nurse", name: "Hemşire", description: "", mfaRequired: false, isSystem: false, permissions: [], memberCount: 1 },
  { id: "g2", slug: "charge_nurse", name: "Sorumlu Hemşire", description: "", mfaRequired: false, isSystem: false, permissions: [], memberCount: 0 },
];
const USERS = [
  { id: "u1", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Demir", authSource: "local",
    active: true, mfa: false, lastLoginAt: null,
    groups: [{ id: "g1", slug: "nurse", name: "Hemşire", source: "manual" }], manualGroupIds: ["g1"] },
  { id: "u2", username: "ldapci", email: null, full_name: "AD Kullanıcı", authSource: "ldap",
    active: true, mfa: true, lastLoginAt: "2026-09-23T08:00:00Z",
    groups: [{ id: "g1", slug: "nurse", name: "Hemşire", source: "ldap" }], manualGroupIds: [] },
];

function setup({ store = {}, users = USERS } = {}) {
  const fakeStore = {
    adminCreateUser: vi.fn(async () => ({})),
    adminUpdateUser: vi.fn(async () => ({})),
    adminSetUserGroups: vi.fn(async () => ({})),
    adminResetPassword: vi.fn(async () => ({ ok: true })),
    adminResetMfa: vi.fn(async () => ({ ok: true })),
    ...store,
  };
  const state = { user: { perms: ["users.manage", "groups.manage"] }, adminUsers: users, adminGroups: GROUPS };
  render(<LiveUserAdmin T={T} S={S} store={fakeStore} state={state} />);
  return fakeStore;
}

describe("LiveUserAdmin", () => {
  it("lists users with source, groups, MFA and activity", () => {
    setup();
    const ayse = within(screen.getByTestId("user-ayse"));
    expect(ayse.getByText("Ayşe Demir")).toBeInTheDocument();
    expect(ayse.getByText("Yerel")).toBeInTheDocument();
    expect(ayse.getByText("Hemşire")).toBeInTheDocument();
    const ad = within(screen.getByTestId("user-ldapci"));
    expect(ad.getByText("Active Directory")).toBeInTheDocument();
    expect(ad.getByText("MFA")).toBeInTheDocument();
  });

  it("creates a local user with the chosen groups", async () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText(/^Kullanıcı adı/), { target: { value: "Selin.Arslan" } });
    fireEvent.change(screen.getByLabelText("Ad Soyad"), { target: { value: "Selin Arslan" } });
    fireEvent.change(screen.getByLabelText(/^Geçici parola/), { target: { value: "Gecici-Parola-1" } });
    const form = screen.getByTestId("create-user-form");
    fireEvent.click(within(form).getByLabelText("Sorumlu Hemşire"));
    fireEvent.click(screen.getByText("Kullanıcı oluştur"));
    await waitFor(() => expect(store.adminCreateUser).toHaveBeenCalled());
    expect(store.adminCreateUser.mock.calls[0][0]).toEqual({
      username: "Selin.Arslan", email: null, full_name: "Selin Arslan",
      password: "Gecici-Parola-1", group_ids: ["g2"],
    });
  });

  it("edits manual groups and shows AD-sourced ones as locked", async () => {
    const store = setup();
    fireEvent.click(within(screen.getByTestId("user-ldapci")).getByText("Grupları düzenle"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Hemşire/)).toBeDisabled();        // ldap-sourced ("Hemşire AD")
    fireEvent.click(within(dialog).getByLabelText("Sorumlu Hemşire"));
    fireEvent.click(within(dialog).getByText("Grupları kaydet"));
    await waitFor(() => expect(store.adminSetUserGroups).toHaveBeenCalledWith("u2", ["g2"]));
  });

  it("offers a password reset only for local accounts", () => {
    setup();
    expect(within(screen.getByTestId("user-ayse")).getByText("Parola sıfırla")).toBeInTheDocument();
    expect(within(screen.getByTestId("user-ldapci")).queryByText("Parola sıfırla")).toBeNull();
  });

  it("deactivates and reactivates through the store", async () => {
    const store = setup();
    fireEvent.click(within(screen.getByTestId("user-ayse")).getByText("Pasifleştir"));
    await waitFor(() => expect(store.adminUpdateUser).toHaveBeenCalledWith("u1", { is_active: false }));
  });

  it("surfaces a refusal from the server", async () => {
    setup({ store: { adminUpdateUser: vi.fn(async () => { throw new Error("Son yönetici pasifleştirilemez"); }) } });
    fireEvent.click(within(screen.getByTestId("user-ayse")).getByText("Pasifleştir"));
    expect(await screen.findByText("Son yönetici pasifleştirilemez")).toBeInTheDocument();
  });
});

describe("LiveStaffTab", () => {
  it("loads the administration data once on mount and renders both panels", async () => {
    const store = { loadAdmin: vi.fn(async () => {}) };
    const state = { user: { perms: ["users.manage", "groups.manage"] }, adminUsers: [], adminGroups: [],
                    adminPermissions: [], adminError: null };
    render(<LiveStaffTab T={T} S={S} store={store} state={state} />);
    await waitFor(() => expect(store.loadAdmin).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("Kullanıcılar").length).toBeGreaterThan(0);
    expect(screen.getByText("Gruplar ve İzinler")).toBeInTheDocument();
  });

  it("shows the load error when the API refused", () => {
    const store = { loadAdmin: vi.fn(async () => {}) };
    const state = { user: { perms: ["users.manage"] }, adminUsers: [], adminGroups: [],
                    adminPermissions: [], adminError: "permission required: groups.manage" };
    render(<LiveStaffTab T={T} S={S} store={store} state={state} />);
    expect(screen.getByText(/groups.manage/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd dashboard && npx vitest run src/admin/LiveUserAdmin.test.jsx`
Expected: FAIL — cannot resolve the two modules

- [ ] **Step 3: Write `LiveUserAdmin.jsx`**

```jsx
// src/admin/LiveUserAdmin.jsx — the user list and local-account creation, backed by /admin/users.
// Only actions the backend implements exist here: create (local), edit groups, activate /
// deactivate, reset password (local only), reset MFA. Invitations, quick PINs, per-user MFA
// policy and unit assignment live only in the simulation and are deliberately absent.
import React, { useState } from "react";
import { KeyRound, Power, ShieldAlert, Users, Check } from "lucide-react";
import { Field, inputCls, btnCls, ActionOverlay } from "../ui.jsx";

const BLANK = { username: "", email: "", full_name: "", password: "", group_ids: [] };

function CreateUserForm({ T, R, store, groups }) {
  const [f, setF] = useState({ ...BLANK });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setF((s) => ({
    ...s, group_ids: s.group_ids.includes(id) ? s.group_ids.filter((x) => x !== id) : [...s.group_ids, id],
  }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await store.adminCreateUser({
        username: f.username.trim(), email: f.email.trim() || null, full_name: f.full_name.trim(),
        password: f.password, group_ids: f.group_ids,
      });
      setF({ ...BLANK });
      setErr("");
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="create-user-form">
      <Field T={T} label={R.username} hint={R.usernameHint}>
        <input className={inputCls(T)} value={f.username} onChange={(e) => setF((s) => ({ ...s, username: e.target.value }))} />
      </Field>
      <Field T={T} label={R.fullName}>
        <input className={inputCls(T)} value={f.full_name} onChange={(e) => setF((s) => ({ ...s, full_name: e.target.value }))} />
      </Field>
      <Field T={T} label={R.emailOptional}>
        <input className={inputCls(T)} value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} />
      </Field>
      <Field T={T} label={R.tempPassword} hint={R.tempPasswordHint}>
        <input className={inputCls(T)} type="text" value={f.password} onChange={(e) => setF((s) => ({ ...s, password: e.target.value }))} />
      </Field>
      <div className={`text-xs font-semibold uppercase ${T.faint}`}>{R.groupsLabel}</div>
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <label key={g.id} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border ${T.border} ${T.subtle} px-2.5 py-1.5 text-sm`}>
            <input type="checkbox" checked={f.group_ids.includes(g.id)} onChange={() => toggle(g.id)} />
            <span className={T.text}>{g.name}</span>
          </label>
        ))}
      </div>
      {err && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-500">{err}</div>}
      <button type="submit" disabled={busy} className={`${btnCls(T, "primary")} w-full`}>{R.createUser}</button>
    </form>
  );
}

function UserRowLive({ T, R, store, groups, u }) {
  const [modal, setModal] = useState(null); // "groups" | "password" | null
  const [sel, setSel] = useState(u.manualGroupIds);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const run = async (fn) => { try { await fn(); setErr(""); setModal(null); } catch (ex) { setErr(ex.message); } };
  const ldapIds = new Set(u.groups.filter((g) => g.source === "ldap").map((g) => g.id));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const local = u.authSource === "local";

  return (
    <div className="px-3 py-2.5" data-testid={`user-${u.username}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className={`truncate text-sm font-semibold ${T.text}`}>{u.full_name}</div>
          <div className={`truncate text-xs ${T.faint}`}>{u.username}{u.email ? ` · ${u.email}` : ""}</div>
          <div className={`text-[11px] ${T.faint}`}>
            {R.lastLogin}: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : R.never}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${T.chip}`}>{local ? R.sourceLocal : R.sourceLdap}</span>
          {u.groups.length === 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] ${T.chip}`}>{R.noGroupsAssigned}</span>}
          {u.groups.map((g) => (
            <span key={g.id} className={`rounded-full px-2 py-0.5 text-xs ${T.chip}`}>
              {g.name}{g.source === "ldap" ? ` (${R.fromAd})` : ""}
            </span>
          ))}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${u.active ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>
            {u.active ? R.active : R.passive}
          </span>
          {u.mfa && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">MFA</span>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={() => { setSel(u.manualGroupIds); setModal("groups"); }} className={btnCls(T, "ghost")}><Users size={14} /> {R.editGroups}</button>
        {local && <button onClick={() => setModal("password")} className={btnCls(T, "ghost")}><KeyRound size={14} /> {R.resetPassword}</button>}
        <button onClick={() => run(() => store.adminResetMfa(u.id))} className={btnCls(T, "ghost")}><ShieldAlert size={14} /> {R.resetMfa}</button>
        <button onClick={() => run(() => store.adminUpdateUser(u.id, { is_active: !u.active }))} className={btnCls(T, "ghost")}>
          <Power size={14} /> {u.active ? R.deactivate : R.activate}
        </button>
      </div>
      {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}

      {modal === "groups" && (
        <ActionOverlay T={T} title={R.editGroups} onClose={() => setModal(null)}>
          <div role="dialog" aria-label={R.editGroups}>
            <p className={`mb-2 text-sm ${T.muted}`}>{R.editGroupsHint}</p>
            <div className="space-y-1.5">
              {groups.map((g) => {
                const locked = ldapIds.has(g.id);
                return (
                  <label key={g.id} className={`flex items-center gap-2.5 rounded-lg border ${T.border} ${T.subtle} px-3 py-2 text-sm ${locked ? "opacity-60" : "cursor-pointer"}`}>
                    <input type="checkbox" disabled={locked} checked={locked || sel.includes(g.id)} onChange={() => toggle(g.id)} />
                    <span className={T.text}>{g.name}</span>
                    {locked && <span className={`ml-auto text-[10px] ${T.faint}`}>{R.fromAd}</span>}
                  </label>
                );
              })}
            </div>
            {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
            <button onClick={() => run(() => store.adminSetUserGroups(u.id, sel))} className={`${btnCls(T, "primary")} mt-3 w-full`}>
              <Check size={15} /> {R.saveGroups}
            </button>
          </div>
        </ActionOverlay>
      )}

      {modal === "password" && (
        <ActionOverlay T={T} title={R.resetPassword} onClose={() => { setModal(null); setPw(""); }}>
          <Field T={T} label={R.newPassword} hint={R.tempPasswordHint}>
            <input type="text" className={inputCls(T)} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </Field>
          {err && <div className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">{err}</div>}
          <button onClick={() => run(async () => { await store.adminResetPassword(u.id, pw); setPw(""); })}
            className={`${btnCls(T, "primary")} mt-3 w-full`}><Check size={15} /> {R.resetPassword}</button>
        </ActionOverlay>
      )}
    </div>
  );
}

export function LiveUserAdmin({ T, S, store, state }) {
  const R = S.rbac;
  const users = state.adminUsers || [];
  const groups = state.adminGroups || [];
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 font-bold ${T.heading}`}>{R.usersTitle}</h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{R.usersSub}</p>
      <CreateUserForm T={T} R={R} store={store} groups={groups} />
      <div className={`mt-4 text-xs font-semibold uppercase ${T.faint}`}>{R.usersTitle}</div>
      <div className={`mt-2 divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {users.map((u) => <UserRowLive key={u.id} T={T} R={R} store={store} groups={groups} u={u} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `LiveStaffTab.jsx`**

```jsx
// src/admin/LiveStaffTab.jsx — the "staff" tab of the admin page in LIVE mode: loads the
// administration data from the API once, then renders the users and groups panels.
import React, { useEffect } from "react";
import { LiveUserAdmin } from "./LiveUserAdmin.jsx";
import { GroupAdmin } from "./GroupAdmin.jsx";

export function LiveStaffTab({ T, S, store, state }) {
  useEffect(() => { store.loadAdmin(); }, [store]);
  return (
    <div className="space-y-4">
      {state.adminError && (
        <div className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-600">
          {S.rbac.loadFailed}: {state.adminError}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <LiveUserAdmin T={T} S={S} store={store} state={state} />
        <GroupAdmin T={T} S={S} store={store} state={state} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `cd dashboard && npx vitest run src/admin`
Expected: all pass (6 + 6 + 2).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/admin/LiveUserAdmin.jsx dashboard/src/admin/LiveStaffTab.jsx dashboard/src/admin/LiveUserAdmin.test.jsx
git commit -m "feat(dashboard): live user administration — create, groups, activate, password and MFA reset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 19 (frontend): `ClinicalDemo.jsx` — navigation by permission, live staff tab, MFA enrolment with QR

**Files:**
- Modify: `dashboard/package.json` (add `qrcode`)
- Modify: `dashboard/src/ClinicalDemo.jsx`
- Test: `dashboard/src/nav.test.js`

- [ ] **Step 1: Install the QR renderer**

Run: `cd dashboard && npm install qrcode@^1.5.4`
Expected: `package.json` gains `"qrcode": "^1.5.4"` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Write the failing navigation test**

```js
// dashboard/src/nav.test.js
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, canSee, ADMIN_TABS } from "./ClinicalDemo.jsx";
import { permsForRole } from "./permissions.js";

const keysFor = (perms) => NAV_ITEMS.filter((i) => canSee(i, perms)).map((i) => i.key);

describe("navigation gates on permissions", () => {
  it("the board, alarms and heatmap are open to every signed-in user", () => {
    expect(keysFor([])).toEqual(["board", "alarms", "heatmap"]);
  });

  it("keeps today's demo layout for the attending, the charge nurse and the admin", () => {
    expect(keysFor(permsForRole("ATTENDING"))).toEqual(["board", "admission", "care", "alarms", "results", "heatmap"]);
    expect(keysFor(permsForRole("CHARGE_NURSE"))).toEqual(["board", "admission", "care", "alarms", "results", "heatmap"]);
    expect(keysFor(permsForRole("HOSPITAL_ADMIN"))).toContain("admin");
  });

  it("opens the admin page to anyone holding an administrative permission", () => {
    expect(keysFor(["devices.manage"])).toContain("admin");
    expect(keysFor(["audit.view"])).toContain("admin");
    expect(keysFor(["board.view"])).not.toContain("admin");
  });

  it("admin tabs are gated per permission and simulation-only tabs hide in live mode", () => {
    const visible = (perms, live) => ADMIN_TABS.filter((t) => canSee(t, perms) && !(live && t.demoOnly)).map((t) => t.key);
    expect(visible(["devices.manage"], true)).toEqual(["devices"]);
    expect(visible(["users.manage"], false)).toContain("security");
    expect(visible(["users.manage"], true)).not.toContain("security");
    expect(visible(["users.manage", "groups.manage"], true)).toContain("staff");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd dashboard && npx vitest run src/nav.test.js`
Expected: FAIL — `NAV_ITEMS` / `canSee` / `ADMIN_TABS` are not exported

- [ ] **Step 4: Navigation and page guard**

In `ClinicalDemo.jsx` add the imports (next to the `./ui.jsx` import):

```jsx
import { hasAny } from "./permissions.js";
import { LiveStaffTab } from "./admin/LiveStaffTab.jsx";
import QRCode from "qrcode";
```

Replace the `NAV_ITEMS` constant and `canSee` with:

```jsx
// `perm` is a list — the item shows when the session holds ANY of them; null = everyone.
export const NAV_ITEMS = [
  { key: "board", icon: LayoutGrid, perm: null, group: "clinical" },
  { key: "admission", icon: UserPlus, perm: ["admissions.admit", "admissions.sign_off"], group: "clinical" },
  { key: "care", icon: Users, perm: ["care_team.claim", "care_team.assign"], group: "clinical" },
  { key: "alarms", icon: Bell, perm: null, group: "clinical" },
  { key: "results", icon: Inbox, perm: ["admissions.view"], group: "ops" },
  { key: "heatmap", icon: Grid3x3, perm: null, group: "ops" },
  { key: "admin", icon: Settings,
    perm: ["users.manage", "groups.manage", "structure.manage", "devices.manage", "audit.view"], group: "admin" },
];
```

```jsx
export function canSee(item, perms) { return hasAny(perms, item.perm); }
```

In `Sidebar`, replace

```jsx
  const role = state.user?.role;
  const visible = NAV_ITEMS.filter((i) => canSee(i, role));
```

with

```jsx
  const perms = state.user?.perms || [];
  const visible = NAV_ITEMS.filter((i) => canSee(i, perms));
```

In the page guard inside `ClinicalDemo` (the block starting `// guard: page not permitted for the
current role`), replace

```jsx
  const role = state.user.role;
  const activeItem = NAV_ITEMS.find((i) => i.key === page);
  const effectivePage = activeItem && canSee(activeItem, role) ? page : "board";
```

with

```jsx
  const perms = state.user.perms || [];
  const activeItem = NAV_ITEMS.find((i) => i.key === page);
  const effectivePage = activeItem && canSee(activeItem, perms) ? page : "board";
```

- [ ] **Step 5: Admin page tabs**

Above `function AdminPage(` add the exported tab table (labels are resolved inside the component
because they come from `S`):

```jsx
// Admin tabs: `perm` any-of, like NAV_ITEMS. `demoOnly` tabs write only to the simulation and
// are hidden in live mode — a control that writes nowhere is never shown as if it worked.
export const ADMIN_TABS = [
  { key: "reports", icon: BarChart3, perm: ["audit.view", "users.manage", "structure.manage"], label: (S) => S.pr8.reports },
  { key: "structure", icon: Building2, perm: ["structure.manage"], label: (S) => S.pr7.hierarchy },
  { key: "staff", icon: Users, perm: ["users.manage", "groups.manage"], label: (S) => S.pr7.staffMatrix },
  { key: "security", icon: Shield, perm: ["users.manage"], demoOnly: true, label: (S) => S.pr10.inviteTitle },
  { key: "devices", icon: Radio, perm: ["devices.manage"], label: (S) => S.pr7.devices },
  { key: "audit", icon: ScrollText, perm: ["audit.view"], label: (S) => S.pr7.auditSearch },
  { key: "archive", icon: Archive, perm: ["users.manage"], label: (S) => S.pr13.archiveTitle },
  { key: "sessions", icon: Monitor, perm: ["users.manage"], label: (S) => S.pr13.sessionsTitle },
];
```

Replace the start of `AdminPage` — from `function AdminPage({ T, S, store, state }) {` through the
end of the `TABS` array and the `return (` — with:

```jsx
function AdminPage({ T, S, store, state }) {
  const perms = state.user?.perms || [];
  const live = state.live === true;
  const tabs = ADMIN_TABS.filter((t) => canSee(t, perms) && !(live && t.demoOnly));
  const [tab, setTab] = useState(tabs[0]?.key || "reports");
  const active = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key || "reports");
  const TABS = tabs.map((t) => ({ key: t.key, label: t.label(S), icon: t.icon }));
  return (
```

and inside the returned JSX replace every `tab === "…"` with `active === "…"` and the button's
`active = tab === t.key` with `const isActive = active === t.key;` (use `isActive` in the
className). Replace the `staff` branch with:

```jsx
      {active === "staff" && (live
        ? <LiveStaffTab T={T} S={S} store={store} state={state} />
        : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <UserAdmin T={T} S={S} store={store} state={state} />
            <StaffMatrix T={T} S={S} store={store} state={state} />
          </div>
        ))}
```

- [ ] **Step 6: The MFA gate — async enrolment, QR, manual key, group names**

Replace the top of `MfaGate` (from `function MfaGate(` through the `useEffect` that calls
`store.setupMfa`) with:

```jsx
function MfaGate({ T, S, store, pending, lang, setLang, live = false }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [setup, setSetup] = useState(null); // { provisioningUri, secret }
  const [qr, setQr] = useState(null);       // data URL, when the renderer is available
  const [copied, setCopied] = useState(false);
  const enrolled = pending.enrolled;

  // Not enrolled: mint the secret (sync in the simulation, async against the API), then try to
  // draw the QR. The manual key is always shown, so a failed QR render costs nothing.
  useEffect(() => {
    if (enrolled) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => store.setupMfa({ userId: pending.userId }))
      .then((s) => { if (!cancelled) setSetup(s); return s; })
      .then((s) => (s?.provisioningUri ? QRCode.toDataURL(s.provisioningUri) : null))
      .then((url) => { if (!cancelled && url) setQr(url); })
      .catch(() => { /* the manual key below still works */ });
    return () => { cancelled = true; };
  }, [enrolled, pending.userId]);

  const copyKey = () => {
    try { navigator.clipboard?.writeText(setup?.secret || ""); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
```

Replace the subtitle line `{pending.full_name} · {S.roleName[pending.role]}` with:

```jsx
            <p className={`text-xs ${T.muted}`}>
              {pending.full_name} · {pending.groupNames?.length ? pending.groupNames.join(", ") : S.roleName[pending.role]}
            </p>
```

Replace the "Kayıtsız kullanıcı: QR + gizli anahtar göster" block with:

```jsx
        {!enrolled && setup && (
          <div className={`mb-4 rounded-2xl border ${T.border} ${T.glassSubtle} p-4`}>
            {qr ? (
              <img src={qr} alt="TOTP QR" className="mx-auto mb-3 h-36 w-36 rounded-xl bg-white p-1" />
            ) : (
              <div className={`mx-auto mb-3 grid h-32 w-32 place-items-center rounded-xl ${T.subtle}`}>
                <QrCode size={104} className={T.faint} />
              </div>
            )}
            {!qr && <div className={`mb-2 text-center text-[11px] ${T.faint}`}>{S.rbac.mfaQrUnavailable}</div>}
            <div className={`text-center text-[11px] ${T.faint}`}>{S.rbac.mfaManualKey}</div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <code className={`font-mono text-sm tracking-widest ${T.text}`}>
                {(setup.secret || "").replace(/(.{4})/g, "$1 ").trim()}
              </code>
              <button type="button" onClick={copyKey} className={btnCls(T, "ghost")}>
                {copied ? S.rbac.copied : S.rbac.mfaCopy}
              </button>
            </div>
          </div>
        )}
```

Replace the demo hint `<span className={`text-[11px] ${T.faint}`}>{S.pr11.mfaDemoHint}</span>` with:

```jsx
          {!live && <span className={`text-[11px] ${T.faint}`}>{S.pr11.mfaDemoHint}</span>}
```

Where `MfaGate` is rendered (the `if (state.mfaPending) return <MfaGate …` line), pass
`live={state.live === true}`.

- [ ] **Step 7: Run the whole frontend suite and build**

Run: `cd dashboard && npx vitest run`
Expected: all green, including `src/nav.test.js` (4).

Run: `cd dashboard && npm run build`
Expected: a clean Vite build (this also proves the `qrcode` import resolves in the browser bundle).

- [ ] **Step 8: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/ClinicalDemo.jsx dashboard/src/nav.test.js
git commit -m "feat(dashboard): navigation and admin tabs gate on permissions; live staff tab; MFA enrolment with QR

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 20: Documentation, end-to-end check, plan record

**Files:**
- Modify: `docs/homunculus-rehber-TR.md`
- Modify: `docs/superpowers/plans/2026-09-23-rbac-groups-permissions.md` (execution status)

- [ ] **Step 1: Glossary entries in the Turkish guide**

In `docs/homunculus-rehber-TR.md`, at the end of section `## 3. Sözlük` (before `## 4.`), add:

```markdown
### 3.x Kimlik ve yetki terimleri

**Grup (group)**
- *Basit:* Kullanıcıların konulduğu kutu: Hemşire, Sorumlu Hemşire, Hekim, Sistem Yöneticisi…
  Yönetici yeni kutu açabilir, adını ve içindekileri değiştirebilir.
- *Homunculus'ta:* Her grup bir **izin kümesi** taşır. Bir kullanıcının yetkisi, üye olduğu
  grupların izinlerinin **birleşimidir**. Varsayılan 11 grup kurulumda hazır gelir
  (`auth/permissions.py`); yalnızca `hospital_admin` silinemez.

**İzin (permission)**
- *Basit:* "Panoyu görebilir", "alarm onaylayabilir", "kullanıcı yönetebilir" gibi tek tek haklar.
- *Homunculus'ta:* 18 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`…). Liste kodda
  yaşar, çünkü yazılımın *yapabildikleri* yazılımın özelliğidir; *kimin* yapabileceği ise
  hastanenin kararıdır ve veritabanında (gruplarda) yaşar. Her API rotası bir izinle korunur.

**RBAC (rol tabanlı erişim denetimi)**
- *Basit:* "Kişiye göre" değil "göreve göre" yetki. Yeni bir hemşire geldiğinde tek tek hak
  vermek yerine Hemşire grubuna eklenir.
- *Homunculus'ta:* Girişte kullanıcının izinleri **token'a yazılır** (`perms`); rotalar token'a
  bakar, veritabanına gitmez. Yetkisi değişen kullanıcının `token_version` sayacı artar; eski
  token reddedilir, istemci fark ettirmeden yenisini alır. Pasifleştirme anında etkilidir.

**MFA (iki adımlı doğrulama)**
- *Homunculus'ta:* Grup bazlıdır (`mfa_required`). Yöneticiler ve sorumlu hekimler için
  varsayılan olarak açık; doğrulama kodu girilmeden API hiçbir klinik rotaya izin vermez.
```

(Replace `3.x` with the next free subsection number in the file.)

- [ ] **Step 2: Full backend run**

Run: `cd homunculus-engine && .venv/Scripts/python.exe -m pytest -q --ignore=tests/test_infinity_research_api.py`
Expected: all pass; DB-backed suites pass when `TEST_DATABASE_URL` is set, otherwise skipped.

- [ ] **Step 3: Full frontend run and build**

Run: `cd dashboard && npx vitest run && npm run build`
Expected: green, clean build.

- [ ] **Step 4: Manual end-to-end against a local stack (when a Postgres is available)**

1. `cd homunculus-engine && alembic upgrade head && SEED_ADMIN_PASSWORD=… python scripts/seed_admin.py`
2. Start the API (`uvicorn homunculus.api.prodserver:app --port 8000`) and the dashboard (`npm run dev`).
3. Sign in as the seeded admin: the MFA gate shows the QR and the manual key; enrol; the board opens.
4. Admin → Personel (staff) tab: create a local nurse in `nurse`; sign in as the nurse in a second
   browser; the sidebar shows board, admission, alarms, heatmap only; Admin is absent.
5. Move the nurse to `charge_nurse` from the admin browser; in the nurse's browser the next
   request refreshes transparently and "results"/"care" appear without a sign-out.
6. Deactivate the nurse: their next request lands on the login screen.
7. Try to deactivate the admin: the UI shows "Son yönetici pasifleştirilemez".
8. `GET /audit?event_type=admin` (as admin) lists every step above.

- [ ] **Step 5: Record the outcome in this plan**

Add an `## Execution status — <date>` section under the title (the repository's convention, see
`2026-09-04-comed-adt-identity.md`) stating which tasks ran, what was verified locally, and which
acceptance steps (Step 4 above, the VM deployment) have not been run.

- [ ] **Step 6: Commit**

```bash
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-09-23-rbac-groups-permissions.md
git commit -m "docs: groups, permissions, RBAC and MFA in the Turkish guide; plan execution status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Follow-ups this plan deliberately leaves (for the record)

- **Plan 2 — LDAP/AD:** `auth/ldap.py`, the LDAP branch of `/auth/login`, `/admin/ldap/*`, the AD
  panel, `LDAP_*` configuration and the directory tests (spec §7). The 503 branch in the login
  route and the `ldap_group_mappings` table are already in place for it.
- `/ingest` still accepts a clinician JWT (as today); the spec lists no permission for it. Worth a
  dedicated `observations.ingest` permission or a device-only rule in a follow-up.
- The `archive` and `sessions` admin tabs still write only to the simulation in live mode; only
  `security` (invitations) is hidden by this plan, as the spec scoped.
- The Infinity branch's `infinity_research.py` must switch to `require_permission("devices.manage")`
  when merged.
- Dropping the PostgreSQL `userrole` enum type and `tenant_memberships.role` (cleanup migration).
