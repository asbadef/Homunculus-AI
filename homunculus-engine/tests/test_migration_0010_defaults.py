# homunculus-engine/tests/test_migration_0010_defaults.py
"""Migration 0010 seeds a FROZEN copy of the default groups. This test pins that copy to the
snapshot below — the defaults as they stood at revision 0010. It deliberately does not import
the live DEFAULT_GROUPS: those may change for tenants created later, and a released migration
must not follow them. If this test fails, the migration file was edited; revert it."""
from __future__ import annotations

import importlib.util
from pathlib import Path

from homunculus.auth.permissions import ALL_PERMISSIONS
from homunculus.auth.service import normalize_login

ATTENDING = {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
             "admissions.sign_off", "admissions.move.initiate", "care_team.claim",
             "care_team.assign", "handover.sign", "break_glass.use", "clinical.chart",
             "scores.sign"}
SNAPSHOT = {   # slug: (mfa_required, is_system, permissions) as of 0010
    "hospital_admin": (True, True, {
        "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.admit",
        "admissions.sign_off", "admissions.move.initiate", "admissions.transfer.confirm",
        "admissions.discharge.confirm", "care_team.claim", "care_team.assign", "handover.sign",
        "shifts.manage", "break_glass.use", "audit.view", "users.manage", "groups.manage",
        "structure.manage", "devices.manage", "clinical.chart", "scores.sign"}),
    "attending": (True, False, ATTENDING),
    "unit_physician": (True, False, ATTENDING - {"care_team.claim", "care_team.assign"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use", "clinical.chart",
                                 "scores.sign"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                    "admissions.admit", "admissions.transfer.confirm",
                                    "admissions.discharge.confirm", "care_team.claim",
                                    "handover.sign", "shifts.manage", "break_glass.use",
                                    "clinical.chart"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                      "admissions.view", "break_glass.use", "clinical.chart"}),
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
    "PHARMACIST": "pharmacist", "BIOMEDICAL": "biomedical",
}

# What 0010's frozen login fold makes of a legacy e-mail, as of 0010.
FOLD_SNAPSHOT = {
    "  Ayse.Demir@Example.COM ": "ayse.demir@example.com",
    "Aydın@Hastane.az": "aydin@hastane.az",
    "İLKER@HASTANE.AZ": "ilker@hastane.az",
    "IŞIK@hastane.az": "işik@hastane.az",
    "şükrü@hastane.az": "şükrü@hastane.az",
}

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0010_groups_and_permissions.py"


def _load():
    spec = importlib.util.spec_from_file_location("migration_0010", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_frozen_defaults_match_the_0010_snapshot():
    frozen = {g["slug"]: g for g in _load()._DEFAULT_GROUPS}
    assert frozen.keys() == SNAPSHOT.keys()
    for slug, (mfa, system, perms) in SNAPSHOT.items():
        assert set(frozen[slug]["permissions"]) == perms, slug
        assert frozen[slug]["mfa_required"] is mfa, slug
        assert frozen[slug]["is_system"] is system, slug


def test_the_frozen_legacy_map_matches_the_snapshot():
    assert _load()._LEGACY == LEGACY_SNAPSHOT


def test_every_frozen_key_is_still_in_the_catalogue():
    """Retiring a catalogue key needs a data migration for the rows 0010 wrote; this is the
    reminder. Adding keys is free."""
    for g in _load()._DEFAULT_GROUPS:
        assert set(g["permissions"]) <= ALL_PERMISSIONS, g["slug"]


def test_revision_chain():
    m = _load()
    assert m.revision == "0010" and m.down_revision == "0009"


def test_the_frozen_login_fold_matches_the_0010_snapshot():
    fold = _load()._fold_login
    assert {raw: fold(raw) for raw in FOLD_SNAPSHOT} == FOLD_SNAPSHOT


def test_sign_in_still_folds_like_0010():
    """0010 stored every legacy login through its frozen fold. If sign-in's `normalize_login`
    ever folds differently, logins 0010 wrote stop matching what users type: do NOT edit 0010 —
    write a new migration that re-folds the stored usernames and e-mails."""
    assert {raw: normalize_login(raw) for raw in FOLD_SNAPSHOT} == FOLD_SNAPSHOT
