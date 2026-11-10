# homunculus-engine/tests/test_bed_state_machine.py
"""The bed's state machine after G2-B3a (spec §4): a free bed may be reserved for an expected
patient or taken out of service; a reserved bed goes back to free or to its patient and nowhere
else; nothing but a free bed is reserved or blocked. The out-of-service reason and the note belong
to the state they were written with — every transition clears both (R8). No database."""
from __future__ import annotations

import re

import pytest
from sqlalchemy import CheckConstraint

from homunculus.crypto import EncryptedString, encrypt_phi
from homunculus.tenant.models import (
    BED_STATE_TRANSITIONS, STATE_NOTE_COLUMN_LENGTH, Bed, BedState, BedStateReason,
)


def test_a_free_bed_can_be_reserved_or_taken_out_of_service():
    assert {BedState.RESERVED, BedState.BLOCKED} <= BED_STATE_TRANSITIONS[BedState.AVAILABLE]


def test_a_reserved_bed_goes_back_to_free_or_to_its_patient_and_nowhere_else():
    assert BED_STATE_TRANSITIONS[BedState.RESERVED] == {BedState.AVAILABLE, BedState.OCCUPIED}


@pytest.mark.parametrize("state", [s for s in BedState if s is not BedState.AVAILABLE],
                         ids=lambda s: s.value)
def test_only_a_free_bed_is_reserved_or_blocked(state):
    allowed = BED_STATE_TRANSITIONS.get(state, set())
    assert BedState.RESERVED not in allowed and BedState.BLOCKED not in allowed


def test_out_of_service_and_maintenance_both_return_to_free():
    assert BED_STATE_TRANSITIONS[BedState.BLOCKED] == {BedState.AVAILABLE}
    assert BED_STATE_TRANSITIONS[BedState.MAINTENANCE] == {BedState.AVAILABLE}


def test_every_transition_clears_the_reason_and_the_note():
    bed = Bed(label="1", state=BedState.AVAILABLE)
    bed.transition_to(BedState.BLOCKED)
    bed.state_reason, bed.state_note = BedStateReason.FAULT.value, "Sentetik arıza"
    bed.transition_to(BedState.AVAILABLE)
    assert (bed.state_reason, bed.state_note) == (None, None)
    bed.transition_to(BedState.RESERVED)
    bed.state_note = "Sentetik planlı kabul"
    bed.transition_to(BedState.OCCUPIED)
    assert (bed.state_reason, bed.state_note) == (None, None)


def test_a_refused_transition_leaves_the_reason_and_the_note_alone():
    bed = Bed(label="1", state=BedState.AVAILABLE)
    bed.transition_to(BedState.BLOCKED)
    bed.state_reason, bed.state_note = BedStateReason.FAULT.value, "Sentetik arıza"
    with pytest.raises(ValueError):
        bed.transition_to(BedState.RESERVED)
    assert bed.state is BedState.BLOCKED
    assert (bed.state_reason, bed.state_note) == ("FAULT", "Sentetik arıza")


def test_the_reasons_are_the_four_the_spec_names():
    assert [r.value for r in BedStateReason] == ["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]


def test_the_check_constraint_lists_exactly_the_reasons_of_the_enum():
    """A fifth reason is a migration: the model's CHECK must follow the enum, or the model and the
    database (migration 0016 carries the same text) drift apart without a test noticing."""
    checks = [c for c in Bed.__table__.constraints
              if isinstance(c, CheckConstraint) and c.name == "ck_beds_state_reason"]
    assert len(checks) == 1
    assert re.findall(r"'([A-Z_]+)'", str(checks[0].sqltext)) == [r.value for r in BedStateReason]


def test_the_note_column_is_encrypted_and_wide_enough_for_a_fernet_text():
    column = Bed.__table__.c.state_note
    assert isinstance(column.type, EncryptedString)
    assert column.type.impl.length == STATE_NOTE_COLUMN_LENGTH == 1536
    assert Bed.__table__.c.state_reason.type.length == 20
    # 200 four-byte letters (800 UTF-8 bytes) is the widest note the schema will let in (R8).
    assert len(encrypt_phi("𝔸" * 200)) <= STATE_NOTE_COLUMN_LENGTH
