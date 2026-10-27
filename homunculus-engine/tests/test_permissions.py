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
    "devices.manage", "clinical.chart", "scores.sign",
    "beds.release",       # G2-B1a (spec D8)
}


def test_the_catalogue_is_exactly_the_specified_twenty_two_keys():
    assert len(SPEC_KEYS) == 22
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
              "PLATFORM_SUPPORT", "PHARMACIST", "BIOMEDICAL"}
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
                                "break_glass.use", "clinical.chart", "scores.sign"}),
    "unit_physician": (True, False, {"board.view", "alerts.ack", "alerts.escalate",
                                     "admissions.view", "admissions.sign_off",
                                     "admissions.move.initiate", "handover.sign",
                                     "break_glass.use", "clinical.chart", "scores.sign"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use", "clinical.chart",
                                 "scores.sign"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "care_team.claim", "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart", "beds.release"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                      "admissions.view", "break_glass.use", "clinical.chart"}),
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


def test_clinical_and_scoring_keys_exist_and_are_granted_as_designed():
    from homunculus.auth.permissions import DEFAULT_GROUPS, PERMISSIONS

    assert "clinical.chart" in PERMISSIONS
    assert "scores.sign" in PERMISSIONS
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    for slug in ("attending", "unit_physician", "physician", "charge_nurse", "nurse",
                 "rapid_response"):
        assert "clinical.chart" in by_slug[slug], slug
    for slug in ("attending", "unit_physician", "physician"):
        assert "scores.sign" in by_slug[slug], slug
    for slug in ("charge_nurse", "nurse", "rapid_response", "auditor", "pharmacist",
                 "biomedical", "platform_support"):
        assert "scores.sign" not in by_slug[slug], slug


def test_a_cleaned_bed_is_released_by_the_wards_nurses_and_no_one_else_by_default():
    """G2-B1a, spec D8: a ward turns its beds over at night without an administrator. Changing the
    structure stays `structure.manage`; the system group holds every key by rule."""
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    holders = {slug for slug, perms in by_slug.items() if "beds.release" in perms}
    assert holders == {"nurse", "charge_nurse", "hospital_admin"}
    assert "structure.manage" not in by_slug["nurse"] | by_slug["charge_nurse"]


def test_legacy_pharmacist_and_biomedical_convert():
    from homunculus.auth.permissions import LEGACY_ROLE_TO_GROUP

    assert LEGACY_ROLE_TO_GROUP["PHARMACIST"] == "pharmacist"
    assert LEGACY_ROLE_TO_GROUP["BIOMEDICAL"] == "biomedical"
