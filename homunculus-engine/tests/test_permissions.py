"""The permission catalogue is the single list of things a signed-in user may do.

Everything else — group defaults, route guards, the dashboard — refers to these keys. A key
used anywhere that is not in the catalogue must fail loudly, at import time, not at request
time as a 403 nobody can explain.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

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
    "devices.map_beds",   # G2-ESLEME monitor→bed editor (spec D2)
    "beds.manage_state",  # G2-B3a Doluluk: reserve / out of service (spec D4)
    "tasks.view",         # G3-02 Görevlerim (spec D8): open the queue, read /tasks
    "tasks.manage",       # G3-02: write a task, claim, close, skip; skip a vital measurement
    "summary.view",       # G4-02 Yönetici özeti (spec D2, D3): the page, GET /handovers/pending
    "pharmacy.view",      # G3-04 Eczane (spec D2): the page, GET /pharmacy
}


def test_the_catalogue_is_exactly_the_specified_twenty_eight_keys():
    assert len(SPEC_KEYS) == 28
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
    assert "care_team.claim" not in by_slug["charge_nurse"]     # G2-B1c (D7): it could only fail (T1)
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
                                "break_glass.use", "clinical.chart", "scores.sign",
                                "tasks.view", "tasks.manage", "pharmacy.view"}),
    "unit_physician": (True, False, {"board.view", "alerts.ack", "alerts.escalate",
                                     "admissions.view", "admissions.sign_off",
                                     "admissions.move.initiate", "handover.sign",
                                     "break_glass.use", "clinical.chart", "scores.sign",
                                     "tasks.view", "tasks.manage", "pharmacy.view"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use", "clinical.chart",
                                 "scores.sign", "tasks.view", "tasks.manage", "pharmacy.view"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release",
                                    "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart", "beds.release", "tasks.view", "tasks.manage"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                      "admissions.view", "break_glass.use", "clinical.chart",
                                      "tasks.view", "tasks.manage"}),
    "auditor": (False, False, {"board.view", "audit.view"}),
    "platform_support": (True, False, {"audit.view", "devices.manage"}),
    "pharmacist": (False, False, {"board.view", "admissions.view", "pharmacy.view"}),
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


def test_a_monitor_is_bound_to_a_bed_by_the_charge_nurse_and_the_administrator_by_default():
    """Spec D2: the administrator (by rule: the system group holds every key) and the charge nurse,
    so a moved monitor can be fixed at night. Not biomedical: `devices.manage` opens the research
    window, a different right."""
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    holders = {slug for slug, perms in by_slug.items() if "devices.map_beds" in perms}
    assert holders == {"charge_nurse", "hospital_admin"}
    assert "devices.map_beds" not in by_slug["biomedical"] | by_slug["platform_support"]


def test_a_cleaned_bed_is_released_by_the_wards_nurses_and_no_one_else_by_default():
    """G2-B1a, spec D8: a ward turns its beds over at night without an administrator. Changing the
    structure stays `structure.manage`; the system group holds every key by rule."""
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    holders = {slug for slug, perms in by_slug.items() if "beds.release" in perms}
    assert holders == {"nurse", "charge_nurse", "hospital_admin"}
    assert "structure.manage" not in by_slug["nurse"] | by_slug["charge_nurse"]


def test_the_charge_nurse_and_only_she_among_the_ward_groups_manages_bed_states():
    holders = {g["slug"] for g in DEFAULT_GROUPS if "beds.manage_state" in g["permissions"]}
    assert holders == {"hospital_admin", "charge_nurse"}


def test_the_care_team_is_claimed_and_assigned_by_physicians_alone_by_default():
    """G2-B1c (D7, T1): the care team is physicians'. A charge nurse's claim could only be refused
    (`care_team_not_physician`), so she no longer holds the key, and her group no longer says
    «bakım ekibi». Assigning stays the attending's ("Ünite Hekimi … bakım ekibi atamaz"); the
    system group holds every key by rule."""
    by_slug = {g["slug"]: g for g in DEFAULT_GROUPS}
    claim = {slug for slug, g in by_slug.items() if "care_team.claim" in g["permissions"]}
    assign = {slug for slug, g in by_slug.items() if "care_team.assign" in g["permissions"]}
    assert claim == assign == {"hospital_admin", "attending"}
    assert "bakım ekibi" not in by_slug["charge_nurse"]["description"]


def test_the_charge_nurse_text_a_new_tenant_gets_is_the_text_migration_0018_leaves():
    """G2-B1c (X3): migration 0018 rewrites the default description of the tenants seeded before
    it, and `DEFAULT_GROUPS` seeds the new ones. The two are one text, or a migrated hospital and
    a new one would show different words for the same group. No database: the migration file is
    loaded by its path (its name starts with a digit, so it is not importable)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0018_care_team_transfer.py"
    spec = importlib.util.spec_from_file_location("migration_0018_care_team_transfer", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    charge = next(g for g in DEFAULT_GROUPS if g["slug"] == "charge_nurse")
    assert charge["description"] == migration.CHARGE_AFTER
    assert charge["description"] != migration.CHARGE_BEFORE


def test_legacy_pharmacist_and_biomedical_convert():
    from homunculus.auth.permissions import LEGACY_ROLE_TO_GROUP

    assert LEGACY_ROLE_TO_GROUP["PHARMACIST"] == "pharmacist"
    assert LEGACY_ROLE_TO_GROUP["BIOMEDICAL"] == "biomedical"


def test_the_summary_is_the_system_administrators_alone_by_default():
    """G4-02 (spec D2): `summary.view` is in no default group; the system group holds it by rule (it holds
    the whole catalogue at token issuance), so no migration seeds it. A hospital can give it to another
    group later on the Roles screen."""
    holders = {g["slug"] for g in DEFAULT_GROUPS if "summary.view" in g["permissions"]}
    assert holders == {"hospital_admin"}
    admin = next(g for g in DEFAULT_GROUPS if g["slug"] == "hospital_admin")
    assert admin["permissions"] == tuple(PERMISSIONS)
    assert PERMISSIONS["summary.view"].startswith("Open the Yönetici özeti page")


def test_the_pharmacy_page_is_the_pharmacists_and_the_physicians_by_default():
    """G3-04 (spec D2): the carried rule — «eczacı ve sorumlu hekim görür, hemşire görmez». The pharmacist and
    the three physician groups hold `pharmacy.view`; the system group holds every key by rule; the nurse, the
    charge nurse, the rapid-response team, the auditor, biomedical and vendor support do not. Migration 0019
    writes the same four groups' rows for the tenants seeded before it."""
    holders = {g["slug"] for g in DEFAULT_GROUPS if "pharmacy.view" in g["permissions"]}
    assert holders == {"hospital_admin", "pharmacist", "attending", "unit_physician", "physician"}
    assert PERMISSIONS["pharmacy.view"].startswith("Open the Eczane page")
    assert PERMISSIONS["pharmacy.view"].endswith("read-only")
    assert list(PERMISSIONS)[-1] == "pharmacy.view"          # appended after summary.view: the mirrors' order
