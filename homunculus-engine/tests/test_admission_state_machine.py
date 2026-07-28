"""Admission state machine (§1.4) — pure logic, no DB."""
import uuid
from datetime import datetime, timezone

import pytest

from homunculus.admission.models import (
    ADMISSION_STATE_TRANSITIONS, Admission, AdmissionState,
)


def _admission(state: AdmissionState) -> Admission:
    a = Admission(
        patient_id=uuid.uuid4(), tenant_id=uuid.uuid4(), state=state,
        admission_datetime=datetime.now(timezone.utc),
        admitting_unit_id=uuid.uuid4(), bed_id=uuid.uuid4(),
        admission_diagnosis_free_text="Sepsis kriterleri değerlendirilecek",
    )
    return a


@pytest.mark.parametrize("src,dst", [
    (AdmissionState.DRAFT, AdmissionState.ACTIVE),
    (AdmissionState.ACTIVE, AdmissionState.PENDING_DISCHARGE),
    (AdmissionState.ACTIVE, AdmissionState.PENDING_TRANSFER),
    (AdmissionState.PENDING_DISCHARGE, AdmissionState.DISCHARGED),
    (AdmissionState.PENDING_TRANSFER, AdmissionState.TRANSFERRED),
    (AdmissionState.PENDING_DISCHARGE, AdmissionState.ACTIVE),  # cancel discharge
    (AdmissionState.PENDING_TRANSFER, AdmissionState.ACTIVE),   # cancel transfer
])
def test_valid_transitions(src, dst):
    a = _admission(src)
    a.transition_to(dst)
    assert a.state == dst


@pytest.mark.parametrize("src,dst", [
    (AdmissionState.DRAFT, AdmissionState.DISCHARGED),
    (AdmissionState.DRAFT, AdmissionState.PENDING_TRANSFER),
    (AdmissionState.ACTIVE, AdmissionState.DISCHARGED),      # must go via PENDING
    (AdmissionState.DISCHARGED, AdmissionState.ACTIVE),      # terminal
    (AdmissionState.TRANSFERRED, AdmissionState.ACTIVE),     # terminal
])
def test_invalid_transitions_raise(src, dst):
    a = _admission(src)
    with pytest.raises(ValueError):
        a.transition_to(dst)


def test_terminal_states_have_no_transitions():
    assert ADMISSION_STATE_TRANSITIONS[AdmissionState.DISCHARGED] == set()
    assert ADMISSION_STATE_TRANSITIONS[AdmissionState.TRANSFERRED] == set()
