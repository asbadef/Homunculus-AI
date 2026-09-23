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
    "admissions.sign_off", "admissions.move.initiate", "admissions.move.confirm",
    "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
    "break_glass.use", "audit.view", "users.manage", "groups.manage", "structure.manage",
    "devices.manage",
}


def test_the_catalogue_is_exactly_the_specified_eighteen_keys():
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
    assert "admissions.move.confirm" in by_slug["charge_nurse"]
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
