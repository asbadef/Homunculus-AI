# homunculus-engine/tests/test_admission_form.py
"""The admission form's rules, held by the server (Group 2 · B1a, spec §5.2, §3.3, §4.4).

Every refusal names one field as `field_invalid:<field>`, the first wrong one in the form's order.
No database: the rules are pure. Synthetic values only."""
from __future__ import annotations

import enum
import json
import math
from datetime import date, datetime, timedelta, timezone

import pytest
from annotated_types import MaxLen
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import Enum as SqlEnum, String

from homunculus.admission.errors import CODES, Refusal
from homunculus.admission.form import (
    CLOCK_SLACK, COMORBIDITY_CODES, check_admission, check_discharge,
)
from homunculus.admission.models import Admission, DischargeDisposition, Patient
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionNoteFields, DischargeStart, PatientIdentity,
)
from homunculus.crypto import EncryptedString, encrypt_phi
from homunculus.rules import patient_relative

TODAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
UNIT = "00000000-0000-0000-0000-00000000000a"
BED = "00000000-0000-0000-0000-00000000000b"
#: A letter of four bytes in UTF-8 (U+1D400 MATHEMATICAL BOLD CAPITAL A): the widest a character gets.
FOUR_BYTES = "\U0001D400"


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
        check_admission(payload, today=TODAY, now=NOW)
    assert caught.value.status == 422
    return caught.value.code


def refused_on_reading(model, data: dict) -> str:
    """A value the body may not carry at all is refused while the body is read, as the same coded
    422 the form's rules answer (FastAPI answers an HTTPException as it is): never a 500."""
    with pytest.raises(HTTPException) as caught:
        model.model_validate(data)
    assert caught.value.status_code == 422
    assert set(caught.value.detail) == {"code", "message"}
    return caught.value.detail["code"]


def test_a_complete_form_passes():
    check_admission(body(), today=TODAY, now=NOW)
    check_admission(body(patient={"national_id": "5AB12CD", "phone": "+994 50 123 45 67",
                                  "relative_phone": "(012) 555-12-34", "father_name": "Sentetik",
                                  "relative_name": "Sentetik Qohum", "companion_name": "Ş"},
                         note={"no_known_allergy": False, "allergies_text": "Penisilin",
                               "weight_kg": 72.5, "height_cm": 171,
                               "comorbidity_codes": ["copd", "dementia"],
                               "admission_datetime": "2026-10-25T11:00:00+04:00"}),
                    today=TODAY, now=NOW)


def test_the_bounds_hold_their_own_edges():
    """The oldest birth date, a five-digit phone, the lightest and shortest plausible patient and
    an admission time exactly the clock's slack ahead are all accepted."""
    check_admission(body(patient={"date_of_birth": "1900-01-01", "phone": "12345"},
                         note={"weight_kg": 0.3, "height_cm": 20,
                               "admission_datetime": (NOW + CLOCK_SLACK).isoformat()}),
                    today=TODAY, now=NOW)


@pytest.mark.parametrize(("patient", "note", "field"), [
    ({"display_name": "   "}, {}, "display_name"),
    # Names a screen would show as nothing: a zero-width space, the Hangul filler (a "letter" to
    # Unicode), the blank Braille pattern; and a name of punctuation only.
    ({"display_name": "​"}, {}, "display_name"),
    ({"display_name": "ㅤㅤ"}, {}, "display_name"),
    ({"display_name": "⠀"}, {}, "display_name"),
    ({"display_name": "-.-"}, {}, "display_name"),
    ({"father_name": "ㅤ"}, {}, "father_name"),
    ({"relative_name": "​⠀"}, {}, "relative_name"),
    ({"companion_name": "ﾠ"}, {}, "companion_name"),
    ({"date_of_birth": "2026-10-27"}, {}, "date_of_birth"),
    ({"date_of_birth": "1899-12-31"}, {}, "date_of_birth"),
    ({"national_id": "5AB12C"}, {}, "national_id"),
    ({"national_id": "5AB-2CD"}, {}, "national_id"),
    ({"phone": "elli"}, {}, "phone"),
    ({"phone": "((((()))))"}, {}, "phone"),
    ({"phone": "+ (12) 3-4"}, {}, "phone"),
    ({"relative_phone": "12"}, {}, "relative_phone"),
    ({}, {"admission_datetime": "2026-10-25T12:00:00"}, "admission_datetime"),
    ({}, {"admission_datetime": "2026-10-25T12:03:00+00:00"}, "admission_datetime"),
    ({}, {"admission_type": None}, "admission_type"),
    ({}, {"admission_diagnosis_free_text": "  "}, "admission_diagnosis_free_text"),
    ({}, {"weight_kg": 0.1}, "weight_kg"),
    ({}, {"weight_kg": 401}, "weight_kg"),
    ({}, {"height_cm": 19.9}, "height_cm"),
    ({}, {"height_cm": 2600}, "height_cm"),
    ({}, {"no_known_allergy": False}, "allergies_text"),
    ({}, {"no_known_allergy": True, "allergies_text": "Penisilin"}, "allergies_text"),
    ({}, {"comorbidity_codes": ["copd", "hypertension"]}, "comorbidity_codes"),
    ({"consent": None}, {}, "consent"),
], ids=lambda value: value if isinstance(value, str) else None)
def test_each_rule_refuses_its_own_field(patient, note, field):
    assert refused(body(patient, note)) == f"field_invalid:{field}"


@pytest.mark.parametrize(("field", "value"), [
    ("weight_kg", math.nan), ("weight_kg", math.inf), ("weight_kg", -math.inf),
    ("height_cm", math.nan), ("height_cm", math.inf), ("height_cm", -math.inf),
])
def test_a_weight_or_height_that_is_not_a_finite_number_is_refused(field, value):
    """JSON as FastAPI reads it (Python's json) carries NaN and ±Infinity."""
    assert refused(body(note={field: value})) == f"field_invalid:{field}"


@pytest.mark.parametrize("value", [True, False, "72"])
@pytest.mark.parametrize("field", ["weight_kg", "height_cm"])
def test_a_weight_or_height_is_a_number_never_a_boolean_or_a_string(field, value):
    """`true` would be read as 1 kg and "72" as 72: a client that sent either sent no number."""
    with pytest.raises(ValidationError) as caught:
        body(note={field: value})
    assert [(e["loc"][-1], e["type"]) for e in caught.value.errors()] == [(field, "float_type")]
    assert body(note={field: 72}).note.model_dump()[field] == 72.0


@pytest.mark.parametrize("value", [True, False, "30"])
def test_a_gestational_age_is_a_number_never_a_boolean_or_a_string(value):
    """The same strictness as weight and height: `true` is not one week."""
    with pytest.raises(ValidationError) as caught:
        body(note={"gestational_age_weeks": value})
    assert [(e["loc"][-1], e["type"]) for e in caught.value.errors()] \
        == [("gestational_age_weeks", "float_type")]
    assert body(note={"gestational_age_weeks": 30}).note.gestational_age_weeks == 30.0
    assert body(note={"gestational_age_weeks": 29.5}).note.gestational_age_weeks == 29.5


@pytest.mark.parametrize("value", [True, False, "7", 7.5, 7.0])
def test_a_postnatal_day_is_a_whole_number_never_a_boolean_a_string_or_a_fraction(value):
    with pytest.raises(ValidationError) as caught:
        body(note={"postnatal_day": value})
    assert [(e["loc"][-1], e["type"]) for e in caught.value.errors()] \
        == [("postnatal_day", "int_type")]
    assert body(note={"postnatal_day": 7}).note.postnatal_day == 7


def test_a_newborn_is_admitted_when_the_caller_passed_the_utc_date():
    """In Baku (UTC+4) the local date runs a day ahead of UTC's from 00:00 to 03:59. A caller that
    passed the UTC date as `today` must not refuse a child born after local midnight."""
    late = datetime(2026, 10, 25, 23, 30, tzinfo=timezone.utc)     # 03:30 on the 26th in Baku
    check_admission(body({"date_of_birth": "2026-10-26"}), today=late.date(), now=late)


def test_the_clock_the_rules_compare_with_must_carry_its_time_zone():
    with pytest.raises(ValueError, match="time zone"):
        check_admission(body(), today=TODAY, now=datetime(2026, 10, 25, 12, 0))


@pytest.mark.parametrize(("where", "extra"), [
    ("top", {"comment": "x"}), ("patient", {"mrn": "x"}), ("note", {"ward": "x"}),
])
def test_a_field_the_form_does_not_have_is_refused_not_dropped(where, extra):
    data = body().model_dump(mode="json")
    if where == "top":
        data.update(extra)
    else:
        data[where].update(extra)
    with pytest.raises(ValidationError) as caught:
        AdmissionCreate.model_validate(data)
    assert [e["type"] for e in caught.value.errors()] == ["extra_forbidden"]


def _text_bounds(schema) -> dict[str, int]:
    """Every text field of a request model with its `max_length` (lists of texts excluded)."""
    bounds = {}
    for name, prop in schema.model_json_schema()["properties"].items():
        for branch in prop.get("anyOf", [prop]):
            if branch.get("type") == "string" and "maxLength" in branch:
                bounds[name] = branch["maxLength"]
    return bounds


def test_every_text_over_its_bound_is_refused_as_a_string_too_long():
    """The dashboard says `string_too_long` with the server's number (apiErrors.js); a generic
    `too_long` it reads as a list's. `OptionalFormText` keeps the former (schemas.py says why)."""
    builders = ((PatientIdentity, lambda name, value: body(patient={name: value})),
                (AdmissionNoteFields, lambda name, value: body(note={name: value})),
                (DischargeStart, lambda name, value: discharge(**{name: value})))
    seen = {}
    for schema, build in builders:
        for name, size in _text_bounds(schema).items():
            build(name, "x" * size)
            with pytest.raises(ValidationError) as caught:
                build(name, "x" * (size + 1))
            assert [(e["loc"][-1], e["type"]) for e in caught.value.errors()] \
                == [(name, "string_too_long")], name
            seen[name] = size
    # Review I-3 (a): these had no bound, so a long one reached its column and was a 500.
    assert {name: seen.get(name) for name in (
        "cardiac_surgery_name", "baseline_spo2_range", "baseline_heart_rate_range",
        "baseline_blood_pressure_range", "baseline_respiratory_rate_range",
        "baseline_temperature_range")} == {"cardiac_surgery_name": 200, "baseline_spo2_range": 64,
                                           "baseline_heart_rate_range": 64,
                                           "baseline_blood_pressure_range": 64,
                                           "baseline_respiratory_rate_range": 64,
                                           "baseline_temperature_range": 64}
    assert len(seen) == 24        # every bounded text of the three request models: 11 + 10 + 3


# ---------------------------------------------------------------- what reaches a column
#: Each request model, the table its fields land in, and the fields that land under another name.
FORM_COLUMNS = (
    (PatientIdentity, Patient, {}),
    (AdmissionNoteFields, Admission, {}),
    (DischargeStart, Admission, {"institution": "discharge_institution",
                                 "reported_by": "discharge_reported_by", "note": "discharge_note"}),
)


def _longest(schema, name: str) -> str | None:
    """The longest value a field lets in, as the column receives it, in the widest characters
    (four bytes each); None when the schema sets no bound."""
    info = schema.model_fields[name]
    bound = next((m.max_length for m in info.metadata if isinstance(m, MaxLen)), None)
    if bound is not None:
        return FOUR_BYTES * bound
    if info.annotation is date:                       # stored as its ISO form (admission/router.py)
        return date.max.isoformat()
    if isinstance(info.annotation, type) and issubclass(info.annotation, enum.Enum):
        return max((member.value for member in info.annotation), key=len)
    return None


def test_every_column_the_form_writes_holds_the_longest_value_its_schema_lets_in():
    """`max_length` counts characters; a varchar(n) column counts characters too, but an encrypted
    one holds the ciphertext of the value's UTF-8 bytes. A value the schema accepts and the column
    cannot hold is a 500 from the database (review I-3)."""
    checked, short = [], []
    for schema, model, renamed in FORM_COLUMNS:
        for name in schema.model_fields:
            column = model.__table__.columns.get(renamed.get(name, name))
            if column is None or isinstance(column.type, SqlEnum):
                continue
            encrypted = isinstance(column.type, EncryptedString)
            sql_type = column.type.impl if encrypted else column.type
            if not isinstance(sql_type, String) or sql_type.length is None:
                continue                                    # Text, JSON, numbers, UUIDs, booleans
            longest = _longest(schema, name)
            stored = None if longest is None else len(encrypt_phi(longest) if encrypted else longest)
            checked.append(column.name)
            if stored is None or stored > sql_type.length:
                short.append((column.name, stored, sql_type.length))
    assert short == []
    assert len(checked) == 25     # 13 of patients (all encrypted), 9 + 3 of admissions


# ---------------------------------------------------------------- control characters
@pytest.mark.parametrize(("part", "field", "value"), [
    # in the clear …
    ("note", "allergies_text", "Sentetik\u0000alerji"),
    ("note", "admission_diagnosis_free_text", "Sentetik\u0000tanı"),
    ("note", "comorbidities_text", "\u001b[2J"),
    ("note", "cardiac_surgery_name", "Sentetik\u007f"),
    ("note", "baseline_spo2_range", "88\u0000-92"),
    ("note", "admission_note_narrative", "Sentetik\u0085not"),
    ("note", "icd10_codes", ["J96.0", "J18\u0000"]),
    ("note", "known_allergies", [{"agent": "Sentetik\u0000"}]),
    ("note", "active_medications_on_admission", [{"Sentetik\u0000": ["x"]}]),
    # … and encrypted, so a name never stores one
    ("patient", "display_name", "Sentetik\u0000Hasta"),
    ("patient", "father_name", "Sentetik\u0007"),
    ("patient", "phone", "+994\u000050"),
    ("patient", "his_patient_reference", "HIS\u0000"),
], ids=lambda value: value if isinstance(value, str) and value.isidentifier() else None)
def test_a_control_character_in_any_text_is_refused_as_its_field(part, field, value):
    data = body().model_dump(mode="json")
    data[part][field] = value
    assert refused_on_reading(AdmissionCreate, data) == f"field_invalid:{field}"


@pytest.mark.parametrize("field", ["institution", "reported_by", "note"])
def test_a_control_character_in_the_discharge_decision_is_refused_as_its_field(field):
    data = {"disposition": "EXITUS", field: "Sentetik\u0000"}
    assert refused_on_reading(DischargeStart, data) == f"field_invalid:{field}"


def test_tab_and_line_breaks_stay_in_a_note():
    text = "Sentetik satır 1\r\n\tSentetik satır 2\n"
    assert body(note={"admission_note_narrative": text}).note.admission_note_narrative == text
    assert discharge(note=text).note == text


def test_a_coded_refusal_stops_the_reading_at_the_first_text_that_earns_it():
    """The answer names that field alone; another fault in the body (here a sex that is not one)
    is answered once the text is fixed, not beside it. `schemas._refusal` says so."""
    data = body().model_dump(mode="json")
    data["patient"].update(sex="bogus", father_name="Sentetik\u0000", phone="+994\u000050")
    assert refused_on_reading(AdmissionCreate, data) == "field_invalid:father_name"
    data["patient"]["father_name"] = "Sentetik"
    assert refused_on_reading(AdmissionCreate, data) == "field_invalid:phone"
    data["patient"]["phone"] = "+994 50 123 45 67"
    with pytest.raises(ValidationError) as caught:
        AdmissionCreate.model_validate(data)
    assert [e["loc"][-1] for e in caught.value.errors()] == ["sex"]


# ---------------------------------------------------------------- the note's free-form JSON lists
JSON_LISTS = ["active_comorbidities", "active_medications_on_admission", "known_allergies"]


def nested(depth: int) -> list:
    """A list of `depth` containers, alternately list and dict, the outer list the first level:
    `[{"a": [{"a": …}]}]`. Built from the inside out, so building it recurses nowhere."""
    node: object = "leaf"
    for level in range(depth, 0, -1):
        node = [node] if level % 2 else {"a": node}
    return node


@pytest.mark.parametrize("field", JSON_LISTS)
def test_a_json_list_nests_eight_containers_deep_and_no_deeper(field):
    """An allergy or a medication is a record of a few fields, not a tree."""
    data = body().model_dump(mode="json")
    data["note"][field] = nested(8)
    AdmissionCreate.model_validate(data)
    data["note"][field] = nested(9)
    assert refused_on_reading(AdmissionCreate, data) == f"field_invalid:{field}"


def test_a_json_list_nested_past_the_recursion_limit_is_refused_not_a_500():
    """A walk that recurses ends in a RecursionError (a 500) long before the body is too big."""
    data = body().model_dump(mode="json")
    data["note"]["known_allergies"] = nested(5_000)
    assert refused_on_reading(AdmissionCreate, data) == "field_invalid:known_allergies"


@pytest.mark.parametrize("shape", [
    lambda x: [{"dose": x}], lambda x: [{"dose": [1, x]}], lambda x: [{"dose": {"deep": x}}],
], ids=["in a field", "in a list", "in a record"])
@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
@pytest.mark.parametrize("field", JSON_LISTS)
def test_a_json_list_holds_no_number_that_is_not_finite(field, value, shape):
    """Python's json reads NaN and ±Infinity; JSONB cannot store them (a 500 at the database)."""
    data = body().model_dump(mode="json")
    data["note"][field] = shape(value)
    assert refused_on_reading(AdmissionCreate, data) == f"field_invalid:{field}"


def test_a_json_list_keeps_every_other_scalar():
    kept = [{"agent": "Penisilin", "dose": 1.5, "units": 2, "zero": 0.0, "given": True,
             "note": None, "tags": ["a", 3, 4.25, False, None]}]
    data = body().model_dump(mode="json")
    data["note"]["known_allergies"] = kept
    assert AdmissionCreate.model_validate(data).note.known_allergies == kept


async def test_a_nan_over_http_is_the_coded_422_not_a_500():
    app = FastAPI()

    @app.post("/admit")
    async def admit(payload: AdmissionCreate) -> dict:
        return {"ok": True}

    data = body().model_dump(mode="json")
    data["note"]["known_allergies"] = [{"dose": "__nan__"}]
    raw = json.dumps(data).replace('"__nan__"', "NaN")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://kabul") as client:
        answer = await client.post("/admit", content=raw,
                                   headers={"content-type": "application/json"})
    assert answer.status_code == 422
    assert answer.json()["detail"]["code"] == "field_invalid:known_allergies"


async def test_a_nul_over_http_is_the_coded_422_not_a_500():
    """PostgreSQL refuses NUL in text and in JSONB; the body never reaches it with one."""
    app = FastAPI()

    @app.post("/admit")
    async def admit(payload: AdmissionCreate) -> dict:
        return {"ok": True}

    data = body().model_dump(mode="json")
    data["note"]["allergies_text"] = "Sentetik\u0000alerji"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://kabul") as client:
        answer = await client.post("/admit", json=data)
    assert answer.status_code == 422
    assert answer.json() == {"detail": {"code": "field_invalid:allergies_text",
                                        "message": answer.json()["detail"]["message"]}}
    assert "Sentetik" not in answer.text                  # the value is never echoed back


def test_the_first_wrong_field_in_the_forms_order_is_the_one_named():
    assert refused(body({"consent": None, "display_name": " "},
                        {"admission_type": None})) == "field_invalid:display_name"


def test_the_forms_codes_are_codes_the_engine_reads():
    """The checkboxes send engine codes; a code the engine dropped must fail here, not quietly."""
    assert set(COMORBIDITY_CODES) == set(patient_relative._COMORBIDITY_EXPLAINS)


def test_every_other_refusal_has_a_stable_code():
    """Exactly these: a code added to errors.py is added here, and to the dashboard's map."""
    assert CODES == {"bed_not_available", "bed_closed", "out_of_scope", "critical_alarm_open",
                     "patient_number_exhausted", "invalid_transition", "missing_attending",
                     "open_admission", "bed_in_use", "has_open_beds", "name_taken",
                     "bed_label_taken"}


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
    ({"disposition": "OTHER_INSTITUTION", "institution": "​"}, "institution"),
    # A field that belongs to another disposition is refused, not stored beside this one.
    ({"disposition": "HOME", "institution": "Sentetik Klinika"}, "institution"),
    ({"disposition": "EXITUS", "institution": "Sentetik Klinika"}, "institution"),
    ({"disposition": "HOME", "reported_by": "Dr. Sentetik"}, "reported_by"),
    ({"disposition": "OTHER_INSTITUTION", "institution": "Sentetik Klinika",
      "reported_by": "Dr. Sentetik"}, "reported_by"),
    ({"disposition": "EXITUS", "reported_by": "ㅤ"}, "reported_by"),
    ({"discharge_at": "2026-10-25T12:05:00+00:00"}, "discharge_at"),
    ({"discharge_at": "2026-10-25T11:00:00"}, "discharge_at"),
    ({"discharge_at": "2026-10-20T11:00:00+00:00"}, "discharge_at"),
], ids=lambda value: value if isinstance(value, str) else None)
def test_a_discharge_decision_is_refused_where_it_is_incomplete_or_impossible(over, field):
    with pytest.raises(Refusal) as caught:
        check_discharge(discharge(**over), now=NOW, admitted_at=NOW - timedelta(days=2))
    assert caught.value.code == f"field_invalid:{field}"


@pytest.mark.parametrize(("over", "field"), [
    ({"disposition": "HOME", "institution": ""}, "institution"),
    ({"disposition": "HOME", "institution": "   "}, "institution"),
    ({"disposition": "EXITUS", "institution": " \t "}, "institution"),
    ({"disposition": "HOME", "reported_by": "   "}, "reported_by"),
    ({"disposition": "OTHER_INSTITUTION", "institution": "Sentetik Klinika", "reported_by": ""},
     "reported_by"),
    ({"disposition": "EXITUS", "reported_by": "  "}, "reported_by"),
])
def test_a_blank_institution_or_reporter_is_not_written_and_is_stored_as_none(over, field):
    """A box left with a space in it is a box left empty: no refusal for a field that belongs to
    another disposition, and nothing blank for the column."""
    decision = discharge(**over)
    assert getattr(decision, field) is None
    check_discharge(decision, now=NOW, admitted_at=NOW - timedelta(days=2))


def test_a_written_institution_and_reporter_are_kept_as_written():
    assert discharge(disposition="OTHER_INSTITUTION", institution=" Sentetik Klinika ") \
        .institution == " Sentetik Klinika "
    assert discharge(disposition="EXITUS", reported_by="Dr. Sentetik").reported_by == "Dr. Sentetik"


def test_the_rule_reads_a_blank_as_not_written_even_from_a_payload_the_schema_did_not_shape():
    """`check_discharge` asks the same question (`_blank`) as the schema, so a decision built
    around the schema's validators is not refused for a box left blank either."""
    blank = DischargeStart.model_construct(disposition=DischargeDisposition.HOME, institution="  ",
                                           reported_by=" ", discharge_at=None, note=None)
    check_discharge(blank, now=NOW, admitted_at=None)
    exitus = DischargeStart.model_construct(disposition=DischargeDisposition.EXITUS,
                                            institution="", reported_by="  ", discharge_at=None,
                                            note=None)
    check_discharge(exitus, now=NOW, admitted_at=None)


def test_a_discharge_a_minute_ahead_of_the_server_is_a_clock_not_the_future():
    check_discharge(discharge(discharge_at="2026-10-25T12:01:00+00:00"), now=NOW,
                    admitted_at=NOW - timedelta(days=2))
    check_discharge(discharge(disposition="OTHER_INSTITUTION", institution="Sentetik Klinika"),
                    now=NOW, admitted_at=None)
    check_discharge(discharge(disposition="EXITUS", reported_by="Dr. Sentetik"),
                    now=NOW, admitted_at=None)


def test_the_clock_slack_is_exactly_two_minutes():
    assert CLOCK_SLACK == timedelta(minutes=2)
    check_discharge(discharge(discharge_at=(NOW + CLOCK_SLACK).isoformat()), now=NOW,
                    admitted_at=None)
    with pytest.raises(Refusal) as caught:
        check_discharge(discharge(discharge_at=(NOW + CLOCK_SLACK + timedelta(microseconds=1))
                                  .isoformat()), now=NOW, admitted_at=None)
    assert caught.value.code == "field_invalid:discharge_at"
    late = (NOW + CLOCK_SLACK + timedelta(microseconds=1)).isoformat()
    assert refused(body(note={"admission_datetime": late})) == "field_invalid:admission_datetime"


@pytest.mark.parametrize(("now", "admitted_at"), [
    (datetime(2026, 10, 25, 12, 0), None),
    (NOW, datetime(2026, 10, 23, 12, 0)),
])
def test_a_clock_without_its_time_zone_is_a_named_error_not_a_type_error(now, admitted_at):
    """`now` and `admitted_at` are the server's, never the request's: a naive one is a caller's
    mistake, said in words rather than as Python's "can't compare offset-naive …"."""
    with pytest.raises(ValueError, match="time zone"):
        check_discharge(discharge(discharge_at="2026-10-25T11:00:00+00:00"), now=now,
                        admitted_at=admitted_at)


@pytest.mark.parametrize("extra", [{"discharge_summary": "x"}, {"confirmed": True}])
def test_the_discharge_decision_takes_no_other_field(extra):
    with pytest.raises(ValidationError) as caught:
        discharge(**extra)
    assert [e["type"] for e in caught.value.errors()] == ["extra_forbidden"]
