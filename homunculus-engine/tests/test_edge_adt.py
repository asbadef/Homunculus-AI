"""HL7 ADT -> PatientIdentity, and its FHIR rendering for the uplink.

All names here are synthetic. Comed sends A01/A02/A03/A08 keyed on the protocol number the
nurse also types into the Connex Spot; that number is PID-3.1 and the join key everywhere.
"""
from datetime import datetime, timezone

import pytest

from homunculus.edge.adt import PatientIdentity, identity_to_fhir, is_adt, parse_hl7_adt
from homunculus.gateway.fhir import GatewayError

A01 = (
    "MSH|^~\\&|COMED|HOSP|HOMUNCULUS|HOSP|20260904143000||ADT^A01|MSG1|P|2.5\r"
    "EVN|A01|20260904143000\r"
    "PID|1||20239121^^^COMED^PI||YILMAZ^AYSE^N||19800115|F\r"
    "PV1|1|I|YB^304^2||||||||||||||||V1\r"
)
ORU = (
    "MSH|^~\\&|CDIS-NCE|WelchAllyn|EMR|HIS|20260904143525||ORU^R01^ORU_R01|X1|P|2.6\r"
    "PID|1||20239121^^^X^PI\r"
    "OBX|1|NM|150456^MDC_PULS_OXIM_SAT_O2^MDC||97|%|||||F\r"
)


def test_an_admit_carries_id_name_birth_sex_and_bed():
    identity = parse_hl7_adt(A01)
    assert identity == PatientIdentity(
        patient_id="20239121",
        family="YILMAZ",
        given="AYSE",
        birth_date="1980-01-15",
        sex="female",
        unit="YB",
        room="304",
        bed="2",
        state="admitted",
        at=datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc),
    )


def test_a_transfer_changes_only_the_location():
    """A02 moves the bed and says nothing about admission (state None): the receiving stores
    keep whatever state they hold, so a transfer can never readmit or discharge anyone."""
    a02 = A01.replace("ADT^A01", "ADT^A02").replace("YB^304^2", "YB^301^1")
    identity = parse_hl7_adt(a02)
    assert (identity.room, identity.bed, identity.state) == ("301", "1", None)


def test_a_discharge_marks_the_record_discharged():
    a03 = A01.replace("ADT^A01", "ADT^A03")
    assert parse_hl7_adt(a03).state == "discharged"
    a13 = A01.replace("ADT^A01", "ADT^A13")      # discharge cancelled -> back to admitted
    assert parse_hl7_adt(a13).state == "admitted"
    a11 = A01.replace("ADT^A01", "ADT^A11")      # admit cancelled -> discharged
    assert parse_hl7_adt(a11).state == "discharged"


def test_a_message_that_is_not_adt_is_not_ours():
    assert parse_hl7_adt(ORU) is None
    assert parse_hl7_adt("garbage") is None


def test_an_unhandled_adt_type_is_ignored_rather_than_guessed():
    a31 = A01.replace("ADT^A01", "ADT^A31")
    assert parse_hl7_adt(a31) is None


def test_is_adt_is_true_for_any_trigger_and_false_for_non_adt():
    assert is_adt(A01) is True
    assert is_adt(A01.replace("ADT^A01", "ADT^A05")) is True   # a trigger we do not act on
    assert is_adt(ORU) is False
    assert is_adt("garbage") is False


def test_an_adt_without_a_protocol_number_is_refused_by_name():
    empty = A01.replace("20239121^^^COMED^PI", "^^^COMED^PI")
    with pytest.raises(GatewayError, match="PID-3"):
        parse_hl7_adt(empty)


def test_a_repeated_pid3_with_no_id_in_the_first_repetition_is_refused_not_scavenged():
    # First repetition ("^^^MEDNET^MR") carries no value in CX.1-3 -- "MEDNET" sits in CX.4, off
    # limits by the same rule that keeps CX.4/CX.5 out of the single-repetition case. The real
    # protocol number sits in the second repetition, but the parser only ever reads the first --
    # so this refuses rather than reaching past the "~" for it or returning "MEDNET".
    repeated = A01.replace("20239121^^^COMED^PI", "^^^MEDNET^MR~20239121^^^COMED^PI")
    with pytest.raises(GatewayError, match="PID-3"):
        parse_hl7_adt(repeated)


def test_a_repeated_pid3_uses_only_the_first_repetitions_id():
    # First repetition carries a usable id; a second repetition follows after "~". The first
    # repetition's id wins -- the parser never looks past the first "~".
    repeated = A01.replace("20239121^^^COMED^PI", "20239121^^^COMED^PI~99887^^^COMED^MR")
    assert parse_hl7_adt(repeated).patient_id == "20239121"


def test_the_identity_renders_as_a_fhir_patient_and_encounter():
    patient, encounter = identity_to_fhir(parse_hl7_adt(A01), source="comed")
    assert patient["resourceType"] == "Patient"
    assert patient["identifier"][0]["value"] == "20239121"
    assert patient["name"][0] == {"family": "YILMAZ", "given": ["AYSE"]}
    assert patient["birthDate"] == "1980-01-15"
    assert patient["gender"] == "female"
    assert patient["active"] is True
    assert patient["meta"] == {"lastUpdated": "2026-09-04T14:30:00+00:00", "source": "comed"}

    assert encounter["resourceType"] == "Encounter"
    assert encounter["status"] == "in-progress"
    assert encounter["subject"] == {"reference": "Patient/20239121"}
    assert encounter["location"][0]["location"]["display"] == "YB^304^2"
    assert encounter["meta"]["lastUpdated"] == "2026-09-04T14:30:00+00:00"


def test_a_discharged_identity_renders_as_inactive_and_finished():
    a03 = A01.replace("ADT^A01", "ADT^A03")
    patient, encounter = identity_to_fhir(parse_hl7_adt(a03), source="comed")
    assert patient["active"] is False
    assert encounter["status"] == "finished"


def test_an_update_says_nothing_about_admission():
    """A08 is what a HIS sends for any edit -- a name correction, a billing field -- including
    long after discharge. Reading it as "admitted" put discharged patients back on the board."""
    a08 = A01.replace("ADT^A01", "ADT^A08")
    assert parse_hl7_adt(a08).state is None


def test_a_stateless_identity_renders_without_active_and_with_status_unknown():
    a02 = A01.replace("ADT^A01", "ADT^A02")
    patient, encounter = identity_to_fhir(parse_hl7_adt(a02), source="comed")
    assert "active" not in patient
    assert encounter["status"] == "unknown"
    assert encounter["location"][0]["location"]["display"] == "YB^304^2"
