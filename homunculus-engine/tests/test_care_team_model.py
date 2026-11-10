# homunculus-engine/tests/test_care_team_model.py
"""The care team's rows and the transfer's two columns as the models declare them (G2-B1c, spec
T6, F2, §5.1, D9; G2-B1b spec D8, §5.9). No database.
- One ACTIVE row per member and admission, and one active ATTENDING per admission: two PARTIAL
  unique indexes, mirrored for SQLite (scripts/dev_local.py, E10). The old constraint, which held
  `is_active` in its key and so allowed one CLOSED row per member, is gone (F2).
- B1b's `transfer_reason` (text, one of six or NULL) and `transfer_note` (encrypted, as wide as
  every encrypted column) are declared, and no route writes them before B1b (X2)."""
from __future__ import annotations

from sqlalchemy import Index, UniqueConstraint

from homunculus.admission.models import (
    CARE_TEAM_ACTIVE_INDEX, CARE_TEAM_ATTENDING_INDEX, PHI_COLUMN_LENGTH, Admission,
    CareTeamMember, TransferReason,
)


def _indexes(model) -> dict[str, Index]:
    return {index.name: index for index in model.__table__.indexes}


def test_one_active_row_per_member_and_admission_is_a_partial_unique_index():
    index = _indexes(CareTeamMember)[CARE_TEAM_ACTIVE_INDEX]
    assert index.unique and [c.name for c in index.columns] == ["admission_id", "user_id"]
    for dialect in ("postgresql", "sqlite"):
        assert str(index.dialect_options[dialect]["where"]) == "is_active"


def test_one_active_attending_per_admission_is_a_partial_unique_index():
    index = _indexes(CareTeamMember)[CARE_TEAM_ATTENDING_INDEX]
    assert index.unique and [c.name for c in index.columns] == ["admission_id"]
    for dialect in ("postgresql", "sqlite"):
        assert str(index.dialect_options[dialect]["where"]) == "is_active AND role = 'ATTENDING'"


def test_the_old_constraint_that_allowed_one_closed_row_per_member_is_gone():
    assert [c for c in CareTeamMember.__table__.constraints if isinstance(c, UniqueConstraint)] == []


def test_the_six_transfer_reasons_are_b1bs():
    assert [r.value for r in TransferReason] == [
        "CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST", "OTHER"]


def test_the_transfer_columns_are_declared_and_the_note_is_encrypted():
    table = Admission.__table__
    assert table.c.transfer_reason.nullable and table.c.transfer_reason.type.length == 32
    note = table.c.transfer_note
    assert note.nullable and type(note.type).__name__ == "EncryptedString"
    assert note.type.impl.length == PHI_COLUMN_LENGTH
    checks = {c.name: str(c.sqltext) for c in table.constraints
              if c.name == "ck_admissions_transfer_reason"}
    assert checks == {"ck_admissions_transfer_reason":
                      "transfer_reason IS NULL OR transfer_reason IN ('CLINICAL_NEED', 'TO_ICU', "
                      "'ICU_TO_WARD', 'ISOLATION', 'PATIENT_OR_FAMILY_REQUEST', 'OTHER')"}
