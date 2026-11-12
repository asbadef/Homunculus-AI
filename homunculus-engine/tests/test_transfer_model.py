# homunculus-engine/tests/test_transfer_model.py
"""The transfer's reason and note on the admission (G2-B1b, spec D4, D8, §5.9), as the models map
them: six reasons, checked by `ck_admissions_transfer_reason` with the same values as migration
0018's CHECK; the reason a short text; the note encrypted at rest and wide enough for the
ciphertext of 200 four-byte letters; both NULL unless a transfer writes them. No database."""
from __future__ import annotations

import re

from sqlalchemy import CheckConstraint

from homunculus.admission.models import PHI_COLUMN_LENGTH, Admission, TransferReason
from homunculus.crypto import EncryptedString, encrypt_phi

CHECK = "ck_admissions_transfer_reason"


def test_the_six_reasons_in_the_prototypes_order():
    assert [r.value for r in TransferReason] == [
        "CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST",
        "OTHER"]


def test_the_check_names_exactly_the_six_reasons():
    checks = [c for c in Admission.__table__.constraints
              if isinstance(c, CheckConstraint) and c.name == CHECK]
    assert len(checks) == 1
    sql = str(checks[0].sqltext)
    assert "transfer_reason IS NULL" in sql
    assert re.findall(r"'([A-Z_]+)'", sql) == [r.value for r in TransferReason]


def test_the_reason_is_a_short_text_and_the_note_an_encrypted_one_wide_enough():
    reason, note = Admission.__table__.c.transfer_reason, Admission.__table__.c.transfer_note
    assert reason.nullable and note.nullable
    assert reason.type.length >= max(len(r.value) for r in TransferReason)
    assert isinstance(note.type, EncryptedString)
    assert note.type.impl.length == PHI_COLUMN_LENGTH
    # 200 four-byte letters is the longest note the route lets in (spec §5.1, D8).
    assert len(encrypt_phi("𝔸" * 200)) <= PHI_COLUMN_LENGTH
