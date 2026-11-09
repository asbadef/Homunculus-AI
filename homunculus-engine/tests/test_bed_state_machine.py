# homunculus-engine/tests/test_bed_state_machine.py
"""The bed's state machine after G2-B3a (spec §4): a free bed may be reserved for an expected
patient or taken out of service; a reserved bed goes back to free or to its patient and nowhere
else; nothing but a free bed is reserved or blocked. The out-of-service reason and the note belong
to the state they were written with — every transition clears both (R8). No database."""
from __future__ import annotations

import pytest

from homunculus.tenant.models import BED_STATE_TRANSITIONS, Bed, BedState, BedStateReason


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


def test_the_reasons_are_the_four_the_spec_names():
    assert [r.value for r in BedStateReason] == ["FAULT", "ISOLATION_CLEANING", "STAFFING", "OTHER"]


def test_the_note_column_is_encrypted_and_wide_enough_for_a_fernet_text():
    column = Bed.__table__.c.state_note
    assert type(column.type).__name__ == "EncryptedString"
    assert column.type.impl.length == 1536
    assert Bed.__table__.c.state_reason.type.length == 20
