# homunculus-engine/tests/test_admission_form.py
"""The admission form's rules, held by the server (Group 2 · B1a, spec §5.2, §3.3, §4.4).

Every refusal names one field as `field_invalid:<field>`, the first wrong one in the form's order.
No database: the rules are pure. Synthetic values only."""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

import pytest

from homunculus.admission.errors import CODES, Refusal
from homunculus.admission.form import COMORBIDITY_CODES, check_admission, check_discharge
from homunculus.admission.schemas import AdmissionCreate, DischargeStart
from homunculus.rules import patient_relative

TODAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
UNIT = "00000000-0000-0000-0000-00000000000a"
BED = "00000000-0000-0000-0000-00000000000b"


def body(patient: dict | None = None, note: dict | None = None) -> AdmissionCreate:
    """A complete, valid form: what the Kabul tab sends with every required field filled."""
    return AdmissionCreate.model_validate({
        "patient": {"display_name": "Sentetik Hasta", "date_of_birth": "1970-01-01",
                    "sex": "female", "consent": "KVKK_SIGNED", **(patient or {})},
        "note": {"admitting_unit_id": UNIT, "bed_id": BED, "admission_type": "ICU",
                 "admission_diagnosis_free_text": "Sentetik tanı", "no_known_allergy": True,
                 **(note or {})},
    })


def refused(payload: AdmissionCreate) -> str:
    with pytest.raises(Refusal) as caught:
        check_admission(payload, today=TODAY)
    assert caught.value.status == 422
    return caught.value.code


def test_a_complete_form_passes():
    check_admission(body(), today=TODAY)
    check_admission(body(patient={"national_id": "5AB12CD", "phone": "+994 50 123 45 67",
                                  "relative_phone": "(012) 555-12-34"},
                         note={"no_known_allergy": False, "allergies_text": "Penisilin",
                               "weight_kg": 72.5, "height_cm": 171,
                               "comorbidity_codes": ["copd", "dementia"]}),
                    today=TODAY)


@pytest.mark.parametrize(("patient", "note", "field"), [
    ({"display_name": "   "}, {}, "display_name"),
    ({"date_of_birth": "2026-10-26"}, {}, "date_of_birth"),
    ({"national_id": "5AB12C"}, {}, "national_id"),
    ({"national_id": "5AB-2CD"}, {}, "national_id"),
    ({"phone": "elli"}, {}, "phone"),
    ({"relative_phone": "12"}, {}, "relative_phone"),
    ({}, {"admission_type": None}, "admission_type"),
    ({}, {"admission_diagnosis_free_text": "  "}, "admission_diagnosis_free_text"),
    ({}, {"weight_kg": 0.1}, "weight_kg"),
    ({}, {"weight_kg": 401}, "weight_kg"),
    ({}, {"height_cm": 2600}, "height_cm"),
    ({}, {"no_known_allergy": False}, "allergies_text"),
    ({}, {"no_known_allergy": True, "allergies_text": "Penisilin"}, "allergies_text"),
    ({}, {"comorbidity_codes": ["copd", "hypertension"]}, "comorbidity_codes"),
    ({"consent": None}, {}, "consent"),
], ids=lambda value: value if isinstance(value, str) else None)
def test_each_rule_refuses_its_own_field(patient, note, field):
    assert refused(body(patient, note)) == f"field_invalid:{field}"


def test_a_weight_that_is_not_a_number_is_refused():
    payload = body()
    payload.note.weight_kg = math.nan
    assert refused(payload) == "field_invalid:weight_kg"


def test_the_first_wrong_field_in_the_forms_order_is_the_one_named():
    assert refused(body({"consent": None, "display_name": " "},
                        {"admission_type": None})) == "field_invalid:display_name"


def test_the_forms_codes_are_codes_the_engine_reads():
    """The checkboxes send engine codes; a code the engine dropped must fail here, not quietly."""
    assert set(COMORBIDITY_CODES) == set(patient_relative._COMORBIDITY_EXPLAINS)


def test_every_other_refusal_has_a_stable_code():
    assert {"bed_not_available", "bed_closed", "out_of_scope", "critical_alarm_open",
            "patient_number_exhausted", "invalid_transition", "missing_attending"} <= CODES


def test_a_workflow_refusal_answers_its_code_beside_its_words():
    """The dashboard maps the code and never the words (spec §4.4)."""
    from homunculus.admission.router import _wf
    from homunculus.admission.service import WorkflowError

    answer = _wf(WorkflowError("Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
                               "bed_not_available"))
    assert answer.status_code == 409
    assert answer.detail == {"code": "bed_not_available",
                             "message": "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit."}
    assert _wf(WorkflowError("Only an ACTIVE admission can be discharged.")).detail["code"] \
        == "invalid_transition"


# ---------------------------------------------------------------- the discharge decision
def discharge(**over) -> DischargeStart:
    return DischargeStart.model_validate({"disposition": "HOME", **over})


def test_a_discharge_home_needs_nothing_more():
    check_discharge(discharge(), now=NOW, admitted_at=NOW - timedelta(days=2))


@pytest.mark.parametrize(("over", "field"), [
    ({"disposition": "OTHER_INSTITUTION"}, "institution"),
    ({"disposition": "OTHER_INSTITUTION", "institution": "  "}, "institution"),
    ({"discharge_at": "2026-10-25T12:05:00+00:00"}, "discharge_at"),
    ({"discharge_at": "2026-10-25T11:00:00"}, "discharge_at"),
    ({"discharge_at": "2026-10-20T11:00:00+00:00"}, "discharge_at"),
], ids=lambda value: value if isinstance(value, str) else None)
def test_a_discharge_decision_is_refused_where_it_is_incomplete_or_impossible(over, field):
    with pytest.raises(Refusal) as caught:
        check_discharge(discharge(**over), now=NOW, admitted_at=NOW - timedelta(days=2))
    assert caught.value.code == f"field_invalid:{field}"


def test_a_discharge_a_minute_ahead_of_the_server_is_a_clock_not_the_future():
    check_discharge(discharge(discharge_at="2026-10-25T12:01:00+00:00"), now=NOW,
                    admitted_at=NOW - timedelta(days=2))
    check_discharge(discharge(disposition="OTHER_INSTITUTION", institution="Sentetik Klinika"),
                    now=NOW, admitted_at=None)
