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
