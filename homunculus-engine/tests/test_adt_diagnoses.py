"""ICD-10 diagnoses ride in with the admission, so nobody has to type them.

The hospital's ADT already carries them in DG1 and always has; the admission form asked a
clinician to type them again into a free-text box. Every diagnosis carried here is one nobody
enters and one nobody mistypes — and it is the first half of turning that form from a page you
fill in into a page you confirm.

The rule that governs the whole path: an empty diagnosis list means "this message did not say",
never "this patient has none". A transfer says nothing about diagnosis and must not blank what
the admission established.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from homunculus.api.patient_identity import (
    InMemoryIdentityStore, parse_fhir_encounter,
)
from homunculus.edge.adt import identity_to_fhir, parse_hl7_adt

WHEN = "20260908090000"

ADMIT = (
    "MSH|^~\\&|COMED|HOSP|HOM|ICU|" + WHEN + "||ADT^A01|MSG1|P|2.5\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE||19670417|F\r"
    "PV1|1|I|YB^304^2\r"
    "DG1|1||A41.9^Sepsis, unspecified^I10||" + WHEN + "|A\r"
    "DG1|2||J18.9^Pneumonia, unspecified organism^I10||" + WHEN + "|W\r"
)

TRANSFER_NO_DG1 = (
    "MSH|^~\\&|COMED|HOSP|HOM|ICU|20260908100000||ADT^A02|MSG2|P|2.5\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE||19670417|F\r"
    "PV1|1|I|YB^305^1\r"
)


class TestParsingDG1:
    def test_every_diagnosis_is_read(self):
        identity = parse_hl7_adt(ADMIT)
        assert [d.code for d in identity.diagnoses] == ["A41.9", "J18.9"]

    def test_the_text_and_coding_system_travel_with_the_code(self):
        [first, _] = parse_hl7_adt(ADMIT).diagnoses
        assert first.text == "Sepsis, unspecified"
        assert first.system == "I10"

    def test_the_diagnosis_kind_is_kept(self):
        """A=admitting, W=working, F=final. An admitting diagnosis and a final one are not the
        same claim, and a card that flattened them would say more than the HIS did."""
        admitting, working = parse_hl7_adt(ADMIT).diagnoses
        assert (admitting.kind, working.kind) == ("A", "W")

    def test_a_message_with_no_dg1_carries_none_rather_than_failing(self):
        assert parse_hl7_adt(TRANSFER_NO_DG1).diagnoses == ()

    def test_a_dg1_with_no_code_is_dropped_rather_than_kept_blank(self):
        """A blank chip on a clinical card invites someone to trust it."""
        message = ADMIT + "DG1|3||^Sadece metin^I10||" + WHEN + "|A\r"
        assert [d.code for d in parse_hl7_adt(message).diagnoses] == ["A41.9", "J18.9"]

    def test_a_repeated_code_is_carried_once(self):
        message = ADMIT + "DG1|3||A41.9^Sepsis, unspecified^I10||" + WHEN + "|F\r"
        assert [d.code for d in parse_hl7_adt(message).diagnoses] == ["A41.9", "J18.9"]

    def test_older_interfaces_that_put_the_text_in_dg1_4_are_understood(self):
        message = (
            "MSH|^~\\&|COMED|HOSP|HOM|ICU|" + WHEN + "||ADT^A01|MSG9|P|2.5\r"
            "PID|1||55555^^^COMED^PI||KAYA^MEHMET||19800101|M\r"
            "PV1|1|I|YB^301^1\r"
            "DG1|1||N17.9|Akut böbrek yetmezliği|" + WHEN + "|A\r"
        )
        [dx] = parse_hl7_adt(message).diagnoses
        assert dx.code == "N17.9" and dx.text == "Akut böbrek yetmezliği"

    def test_a_malformed_dg1_never_costs_the_message_its_patient(self):
        """The patient and the bed matter more than the diagnosis list."""
        message = ADMIT + "DG1\r"
        identity = parse_hl7_adt(message)
        assert identity.patient_id == "20239121"
        assert identity.bed_label == "YB 304-2"


class TestCrossingToFhirAndBack:
    def test_diagnoses_survive_the_round_trip(self):
        identity = parse_hl7_adt(ADMIT)
        _patient, encounter = identity_to_fhir(identity, source="comed")
        record = parse_fhir_encounter(encounter)
        assert [d["code"] for d in record.diagnoses] == ["A41.9", "J18.9"]
        assert record.diagnoses[0]["text"] == "Sepsis, unspecified"

    def test_a_message_with_none_omits_the_field_entirely(self):
        """So the receiving side can tell "not told" from "none"."""
        _patient, encounter = identity_to_fhir(parse_hl7_adt(TRANSFER_NO_DG1), source="comed")
        assert "reasonCode" not in encounter

    def test_a_reasoncode_entry_with_no_code_is_ignored(self):
        encounter = {
            "resourceType": "Encounter", "status": "in-progress",
            "subject": {"reference": "Patient/1"},
            "location": [{"location": {"display": "YB^1^1"}}],
            "meta": {"lastUpdated": "2026-09-08T09:00:00+00:00", "source": "comed"},
            "reasonCode": [{"coding": [{"code": ""}]}, {"coding": [{"code": "A41.9"}]}],
        }
        assert [d["code"] for d in parse_fhir_encounter(encounter).diagnoses] == ["A41.9"]


class TestTheMergeRule:
    """"Not told" must never read as "none"."""

    @pytest.fixture()
    def store(self):
        return InMemoryIdentityStore()

    def _apply(self, store, message):
        _patient, encounter = identity_to_fhir(parse_hl7_adt(message), source="comed")
        return store.apply("h1", parse_fhir_encounter(encounter))

    def test_an_admission_establishes_the_diagnoses(self, store):
        record = self._apply(store, ADMIT)
        assert [d["code"] for d in record.diagnoses] == ["A41.9", "J18.9"]

    def test_a_later_transfer_does_not_blank_them(self, store):
        self._apply(store, ADMIT)
        moved = self._apply(store, TRANSFER_NO_DG1)
        assert moved.bed_label == "YB 305-1"          # the bed did change
        assert [d["code"] for d in moved.diagnoses] == ["A41.9", "J18.9"]   # the diagnoses did not

    def test_a_later_message_that_does_say_replaces_the_list(self, store):
        self._apply(store, ADMIT)
        updated = (
            "MSH|^~\\&|COMED|HOSP|HOM|ICU|20260908110000||ADT^A08|MSG3|P|2.5\r"
            "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE||19670417|F\r"
            "PV1|1|I|YB^305^1\r"
            "DG1|1||A41.51^Sepsis due to E coli^I10||20260908110000|F\r"
        )
        record = self._apply(store, updated)
        assert [d["code"] for d in record.diagnoses] == ["A41.51"]

    def test_the_board_card_carries_them(self, store):
        record = self._apply(store, ADMIT)
        card = record.as_board()
        assert [d["code"] for d in card["diagnoses"]] == ["A41.9", "J18.9"]
