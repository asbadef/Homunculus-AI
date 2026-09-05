"""Identity records behind /ingest: FHIR in, board-shaped records out, names encrypted at rest.

Synthetic names. The store follows the AuditLog pattern — a protocol plus an in-memory
implementation for tests and a SQLite one for the server.
"""
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.patient_identity import (
    InMemoryIdentityStore, SqliteIdentityStore, parse_fhir_encounter, parse_fhir_patient,
)
from homunculus.crypto import decrypt_phi
from homunculus.gateway.fhir import GatewayError

WHEN = datetime(2026, 9, 4, 14, 30, tzinfo=timezone.utc)
PATIENT = {
    "resourceType": "Patient",
    "identifier": [{"system": "http://homunculus.local/protocol-no", "value": "20239121"}],
    "name": [{"family": "YILMAZ", "given": ["AYSE"]}],
    "birthDate": "1980-01-15",
    "gender": "female",
    "active": True,
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}
ENCOUNTER = {
    "resourceType": "Encounter",
    "status": "in-progress",
    "subject": {"reference": "Patient/20239121"},
    "location": [{"location": {"display": "YB^304^2"}}],
    "period": {"start": WHEN.isoformat()},
    "meta": {"lastUpdated": WHEN.isoformat(), "source": "comed"},
}


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path):
    made = (InMemoryIdentityStore() if request.param == "memory"
            else SqliteIdentityStore(tmp_path / "identity.db"))
    yield made
    made.close()


def test_a_patient_resource_becomes_a_record(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    record = store.get("h1", "20239121")
    assert (record.family, record.given, record.birth_date) == ("YILMAZ", "AYSE", "1980-01-15")
    assert (record.sex, record.state, record.source) == ("female", "admitted", "comed")
    assert record.display_name == "AYSE YILMAZ"


def test_an_encounter_adds_the_bed_without_erasing_the_name(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    record = store.get("h1", "20239121")
    assert record.family == "YILMAZ"
    assert (record.unit, record.room, record.bed) == ("YB", "304", "2")
    assert record.bed_label == "YB 304-2"


def test_an_encounter_alone_is_a_record_with_a_bed_and_no_name(store):
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    record = store.get("h1", "20239121")
    assert record.display_name == "" and record.bed_label == "YB 304-2"


def test_one_hospital_never_sees_another(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    assert store.get("h2", "20239121") is None
    assert store.admitted_ids("h2") == []


def test_an_older_message_does_not_overwrite_a_newer_record(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    stale = {**PATIENT, "name": [{"family": "ESKI", "given": ["X"]}],
             "meta": {"lastUpdated": (WHEN - timedelta(minutes=5)).isoformat(), "source": "comed"}}
    store.apply("h1", parse_fhir_patient(stale))
    assert store.get("h1", "20239121").family == "YILMAZ"


def test_a_discharge_flips_the_state_and_frees_the_bed(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    done = {**ENCOUNTER, "status": "finished",
            "meta": {"lastUpdated": (WHEN + timedelta(hours=2)).isoformat(), "source": "comed"}}
    store.apply("h1", parse_fhir_encounter(done))
    record = store.get("h1", "20239121")
    assert record.state == "discharged"
    assert store.admitted_ids("h1") == []


def test_a_discharged_record_is_pruned_after_24_hours(store):
    store.apply("h1", parse_fhir_patient({**PATIENT, "active": False}))
    assert store.prune(WHEN + timedelta(hours=23)) == 0
    assert store.prune(WHEN + timedelta(hours=25)) == 1
    assert store.get("h1", "20239121") is None


def test_admitted_ids_lists_the_patients_a_board_must_show(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    assert store.admitted_ids("h1") == ["20239121"]


def test_a_resource_without_a_protocol_number_is_refused_by_name():
    with pytest.raises(GatewayError, match="protocol number"):
        parse_fhir_patient({**PATIENT, "identifier": []})
    with pytest.raises(GatewayError, match="protocol number"):
        parse_fhir_encounter({**ENCOUNTER, "subject": {"reference": "Patient/"}})


def test_a_resource_of_the_wrong_type_is_refused():
    with pytest.raises(GatewayError, match="Patient"):
        parse_fhir_patient(ENCOUNTER)
    with pytest.raises(GatewayError, match="Encounter"):
        parse_fhir_encounter(PATIENT)


def test_the_sqlite_store_encrypts_the_name_at_rest(tmp_path):
    path = tmp_path / "identity.db"
    store = SqliteIdentityStore(path)
    store.apply("h1", parse_fhir_patient(PATIENT))
    row = store._conn.execute("SELECT family FROM identity").fetchone()
    assert decrypt_phi(row[0]) == "YILMAZ"
    store.close()
    assert b"YILMAZ" not in path.read_bytes()


def test_a_key_that_no_longer_matches_costs_the_name_not_the_record(tmp_path, monkeypatch):
    """Rotating PHI_ENCRYPTION_KEY (or replacing the dev fallback with a real key after the
    first admissions) must not turn every board read into a 500: the id and bed still come
    back, the demographics come back empty, and the reason goes to the log."""
    from cryptography.fernet import Fernet

    from homunculus import crypto

    store = SqliteIdentityStore(tmp_path / "identity.db")
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    monkeypatch.setattr(crypto, "_fernet", Fernet(Fernet.generate_key()))   # a different key
    record = store.get("h1", "20239121")
    assert record.patient_id == "20239121" and record.bed_label == "YB 304-2"
    assert (record.family, record.given, record.birth_date, record.sex) == ("", "", "", "unknown")
    assert store.admitted_ids("h1") == ["20239121"]
    store.close()


def test_the_sqlite_store_survives_a_restart(tmp_path):
    path = tmp_path / "identity.db"
    first = SqliteIdentityStore(path)
    first.apply("h1", parse_fhir_patient(PATIENT))
    first.close()
    second = SqliteIdentityStore(path)
    assert second.get("h1", "20239121").given == "AYSE"
    second.close()


def test_a_transfer_can_clear_an_old_bed_without_clearing_demographics(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    transfer = {**ENCOUNTER, "location": [{"location": {"display": "WARD2^^"}}]}
    record = store.apply("h1", parse_fhir_encounter(transfer))
    assert record.display_name == "AYSE YILMAZ"
    assert (record.unit, record.room, record.bed) == ("WARD2", "", "")


def test_message_ordering_normalizes_offsets(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    stale = {**PATIENT, "name": [{"family": "OLD"}],
             "meta": {"lastUpdated": "2026-09-04T17:00:00+04:00", "source": "comed"}}
    assert store.apply("h1", parse_fhir_patient(stale)) is None
    assert store.get("h1", "20239121").family == "YILMAZ"


def test_discharge_without_timestamp_can_be_pruned(store):
    from homunculus.api.patient_identity import IdentityRecord
    record = store.apply("h1", IdentityRecord("NO-TIMESTAMP", state="discharged"))
    assert record.updated_at is not None
    assert store.prune(record.updated_at + timedelta(hours=25)) == 1


def test_a_recent_discharge_stays_in_the_board_inventory(store):
    store.apply("h1", parse_fhir_patient({**PATIENT, "active": False}))
    assert store.patient_ids("h1") == ["20239121"]
    assert store.admitted_ids("h1") == []


def test_encounter_must_reference_a_patient():
    with pytest.raises(GatewayError, match="protocol number"):
        parse_fhir_encounter({**ENCOUNTER, "subject": {"reference": "Device/TEST"}})


def test_null_identifier_is_not_a_patient_named_none():
    with pytest.raises(GatewayError, match="protocol number"):
        parse_fhir_patient({**PATIENT, "identifier": [
            {"system": "http://homunculus.local/protocol-no", "value": None}]})


def test_null_names_remain_empty_and_multiple_given_names_are_preserved():
    record = parse_fhir_patient({**PATIENT, "name": [{"family": None, "given": ["DEMO", "SECOND"]}]})
    assert record.family == "" and record.given == "DEMO SECOND"


def test_an_update_after_discharge_does_not_readmit(store):
    """A08 -- what a HIS sends for any edit, including billing weeks later -- carries no
    admission state. Reading it as "admitted" resurrected discharged patients onto the board,
    where nothing would ever prune them."""
    store.apply("h1", parse_fhir_patient({**PATIENT, "active": False}))
    edit = {**PATIENT, "name": [{"family": "DUZELTME", "given": ["AYSE"]}],
            "meta": {"lastUpdated": (WHEN + timedelta(hours=1)).isoformat(), "source": "comed"}}
    del edit["active"]
    record = store.apply("h1", parse_fhir_patient(edit))
    assert (record.state, record.family) == ("discharged", "DUZELTME")
    assert store.prune(WHEN + timedelta(hours=26)) == 1


def test_a_thin_transfer_keeps_the_name(store):
    """Empty means "not told", never "cleared"."""
    store.apply("h1", parse_fhir_patient(PATIENT))
    thin = {**PATIENT, "name": [{"family": "", "given": []}], "birthDate": "", "gender": "unknown",
            "meta": {"lastUpdated": (WHEN + timedelta(minutes=1)).isoformat(), "source": "comed"}}
    del thin["active"]
    record = store.apply("h1", parse_fhir_patient(thin))
    assert record.display_name == "AYSE YILMAZ" and record.birth_date == "1980-01-15"
    assert record.sex == "female" and record.state == "admitted"


def test_a_stateless_encounter_keeps_the_state_and_moves_the_bed(store):
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    move = {**ENCOUNTER, "status": "unknown", "location": [{"location": {"display": "YB^301^1"}}],
            "meta": {"lastUpdated": (WHEN + timedelta(minutes=1)).isoformat(), "source": "comed"}}
    record = store.apply("h1", parse_fhir_encounter(move))
    assert record.bed_label == "YB 301-1" and record.state == "admitted"


def test_a_discharge_frees_the_bed_but_keeps_the_name(store):
    """The card stays 24 h with a "taburcu" badge; a readmission into the same bed must not show
    two cards with one bed label."""
    store.apply("h1", parse_fhir_patient(PATIENT))
    store.apply("h1", parse_fhir_encounter(ENCOUNTER))
    done = {**ENCOUNTER, "status": "finished",
            "meta": {"lastUpdated": (WHEN + timedelta(hours=2)).isoformat(), "source": "comed"}}
    record = store.apply("h1", parse_fhir_encounter(done))
    assert record.bed_label == "" and record.display_name == "AYSE YILMAZ"


def test_expired_lists_what_prune_would_remove(store):
    store.apply("h1", parse_fhir_patient({**PATIENT, "active": False}))
    store.apply("h2", parse_fhir_patient({**PATIENT, "active": False}))
    assert store.expired("h1", WHEN + timedelta(hours=23)) == []
    [gone] = store.expired("h1", WHEN + timedelta(hours=25))
    assert gone.patient_id == "20239121" and gone.state == "discharged"
    assert len(store.expired("h2", WHEN + timedelta(hours=25))) == 1


def test_a_source_that_is_not_a_short_token_is_refused():
    """meta.source is written into the append-only audit and rendered on cards."""
    for bad in ("", "Comed HIS", "x" * 33, "hasta:YILMAZ", None):
        with pytest.raises(GatewayError, match="meta.source"):
            parse_fhir_patient({**PATIENT, "meta": {"lastUpdated": WHEN.isoformat(), "source": bad}})
