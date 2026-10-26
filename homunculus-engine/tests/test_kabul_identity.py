# homunculus-engine/tests/test_kabul_identity.py
"""The join of the admissions world to the board (Group 2 · B1a, spec §4.3): a `kabul` identity
carries its own bed and unit, the board places the card by them without the bed map, and a
discharged `kabul` identity is a tombstone — never pruned, never on the board, and a removal that
reaches the unit's scoped screens. HIS-fed records keep working as before. No database (the
memory and SQLite stores; the Postgres one is in test_patient_identity_postgres.py). Synthetic."""
from __future__ import annotations

import os
import sqlite3
import stat
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.ackstore import AckStore
from homunculus.api.app import create_app
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import (
    KABUL, PROTOCOL_SYSTEM, IdentityRecord, InMemoryIdentityStore, SqliteIdentityStore,
    parse_fhir_encounter, parse_fhir_patient,
)
from homunculus.canonical import Observation, SignalCode
from homunculus.crypto import encrypt_phi
from homunculus.pipeline import Engine
from homunculus.scope import build_scope, sees_patient
from homunculus.tenant.bedmap import BedMap, BedRef

T0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
BED = "5f0c6a1e-0000-4000-8000-0000000000b1"
UNIT = "5f0c6a1e-0000-4000-8000-0000000000a1"


def admitted(pid: str = "H2600001", **over) -> IdentityRecord:
    return IdentityRecord(**{"patient_id": pid, "given": "Sentetik Hasta", "birth_date": "1970-01-01",
                             "sex": "female", "bed": "1A", "state": "admitted", "source": KABUL,
                             "updated_at": T0, "bed_id": BED, "unit_id": UNIT, **over})


def discharged(pid: str = "H2600001", at: datetime = T0 + timedelta(hours=1)) -> IdentityRecord:
    return IdentityRecord(patient_id=pid, state="discharged", source=KABUL, updated_at=at)


def measured(engine: Engine, pid: str) -> None:
    engine.ingest(Observation(patient_id=pid, code=SignalCode.HEART_RATE, value=88.0, unit="/min",
                              timestamp=T0, source_device="test"), now=T0)


# ---------------------------------------------------------------- the record
def test_a_kabul_record_publishes_its_own_bed_and_unit():
    card = admitted().as_board()
    assert (card["bed_id"], card["unit_id"], card["source"]) == (BED, UNIT, "kabul")
    assert card["bed_label"] == "1A"


def test_discharge_frees_the_bed_and_keeps_the_last_place():
    store = InMemoryIdentityStore()
    store.apply("hosp", admitted())
    after = store.apply("hosp", discharged())
    assert (after.state, after.bed, after.bed_label) == ("discharged", "", "")
    assert (after.bed_id, after.unit_id) == (BED, UNIT)
    assert after.display_name == "Sentetik Hasta"


@pytest.mark.parametrize("make", [lambda p: InMemoryIdentityStore(),
                                  lambda p: SqliteIdentityStore(p / "identity.db")],
                         ids=["memory", "sqlite"])
def test_a_discharged_kabul_record_is_never_pruned_and_a_his_one_still_is(make, tmp_path):
    store = make(tmp_path)
    store.apply("hosp", admitted())
    store.apply("hosp", discharged())
    store.apply("hosp", IdentityRecord(patient_id="20239121", given="HIS HASTA", bed="2",
                                       state="admitted", source="comed", updated_at=T0))
    store.apply("hosp", IdentityRecord(patient_id="20239121", state="discharged", source="comed",
                                       updated_at=T0 + timedelta(hours=1)))
    later = T0 + timedelta(days=30)
    assert [r.patient_id for r in store.expired("hosp", later)] == ["20239121"]
    assert store.prune(later) == 1
    assert store.get("hosp", "H2600001").state == "discharged"
    assert store.get("hosp", "20239121") is None


def test_the_sqlite_store_keeps_the_ids_across_a_restart(tmp_path):
    first = SqliteIdentityStore(tmp_path / "identity.db")
    first.apply("hosp", admitted())
    first.close()
    again = SqliteIdentityStore(tmp_path / "identity.db")
    record = again.get("hosp", "H2600001")
    assert (record.bed_id, record.unit_id, record.source) == (BED, UNIT, "kabul")


# ---------------------------------------------------------------- the board
def test_the_card_lands_on_its_own_bed_without_the_bed_map():
    card = identity_only_board(admitted(), BedMap())["identity"]
    assert (card["bed_id"], card["unit_id"], card["bed_matched"], card["bed_key"]) == \
        (BED, UNIT, True, None)
    assert card["bed_label"] == "1A"
    measured_engine = Engine()
    measured(measured_engine, "H2600001")
    board = patient_board(measured_engine, "H2600001", AckStore(), identity=admitted(),
                          bedmap=BedMap())
    assert (board["identity"]["bed_id"], board["identity"]["unit_id"]) == (BED, UNIT)


def test_a_his_record_still_resolves_through_the_bed_map():
    bedmap = BedMap({"YB^304^2": BedRef(bed_id="bed-his", unit_id="unit-his", label="YB 304-2")})
    record = IdentityRecord(patient_id="20239121", unit="YB", room="304", bed="2",
                            state="admitted", source="comed", updated_at=T0)
    card = identity_only_board(record, bedmap)["identity"]
    assert (card["bed_id"], card["unit_id"], card["bed_matched"], card["bed_key"]) == \
        ("bed-his", "unit-his", True, "YB^304^2")


def test_a_discharged_kabul_patient_is_not_on_the_board_measured_or_not():
    engine, store = Engine(), InMemoryIdentityStore()
    store.apply("hosp", admitted("H2600001"))
    store.apply("hosp", admitted("H2600002", bed_id="other-bed", bed="1B"))
    store.apply("hosp", discharged("H2600001"))
    store.apply("hosp", discharged("H2600002"))
    measured(engine, "H2600001")                  # readings still came for the first
    store.apply("hosp", admitted("H2600003", bed_id="third-bed", bed="1C"))
    ids = [b["patient_id"] for b in board_snapshot(engine, AckStore(), identities=store,
                                                   hospital="hosp")]
    assert ids == ["H2600003"]


def test_a_discharged_his_card_still_stays_its_24_hours():
    store = InMemoryIdentityStore()
    store.apply("hosp", IdentityRecord(patient_id="20239121", given="HIS HASTA", bed="2",
                                       state="admitted", source="comed", updated_at=T0))
    store.apply("hosp", IdentityRecord(patient_id="20239121", state="discharged", source="comed",
                                       updated_at=T0 + timedelta(hours=1)))
    boards = board_snapshot(Engine(), AckStore(), identities=store, hospital="hosp")
    assert [b["identity"]["state"] for b in boards] == ["discharged"]


def test_a_tombstones_board_is_a_removal_with_the_last_bed_and_no_name():
    engine = Engine()
    measured(engine, "H2600001")
    tomb = IdentityRecord(**{**admitted().__dict__, "state": "discharged", "bed": ""})
    frame = patient_board(engine, "H2600001", AckStore(), identity=tomb)
    assert frame["removed"] is True
    assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
    assert "Sentetik" not in repr(frame)


def test_the_removal_reaches_a_screen_scoped_to_that_unit_and_no_other():
    """The SSE stream drops what `sees_patient` refuses (api/app.py `sse_board_frames`)."""
    tomb = IdentityRecord(**{**admitted().__dict__, "state": "discharged", "bed": ""})
    frame = patient_board(Engine(), "H2600001", AckStore(), identity=tomb)
    assert sees_patient(frame, build_scope("MEMBER", unit_ids=[UNIT]))
    assert sees_patient(frame, build_scope("MEMBER", bed_ids=[BED]))
    assert not sees_patient(frame, build_scope("MEMBER", unit_ids=["another-unit"]))


def test_the_board_of_an_unmeasured_tombstone_creates_no_engine_state():
    """`patient_board` reads `engine.state()`, which creates the patient: a tombstone's removal
    must be built before that, or every removal would put the number back into the engine."""
    engine = Engine()
    tomb = IdentityRecord(**{**admitted().__dict__, "state": "discharged", "bed": ""})
    frame = patient_board(engine, "H2600001", AckStore(), identity=tomb)
    assert frame["removed"] is True
    assert engine.patient_ids() == []


def test_a_reading_for_a_discharged_number_through_ingest_publishes_its_removal():
    """X54 on the real app: the reading reaches the engine, the frame pushed to the screens is
    the card's removal (last bed and unit, no name), and the board stays empty."""
    identities = InMemoryIdentityStore()
    identities.apply("h1", admitted())
    identities.apply("h1", discharged())
    app = create_app({"tok-1": "h1"}, run_escalation_loop=False, identities=identities)
    reading = {
        "resourceType": "Observation", "status": "final",
        "code": {"coding": [{"system": "http://homunculus.local/obs", "code": "spo2"}]},
        "subject": {"reference": "Patient/H2600001"},
        "effectiveDateTime": (T0 + timedelta(hours=2)).isoformat(),
        "valueQuantity": {"value": 97.0, "unit": "%"},
        "device": {"display": "nce"},
    }
    head = {"Authorization": "Bearer tok-1"}
    with TestClient(app) as client:
        queue = app.state.broadcaster.subscribe("h1")
        assert client.post("/ingest", json=reading, headers=head).status_code == 200
        frame = queue.get_nowait()
        assert (frame["patient_id"], frame["removed"]) == ("H2600001", True)
        assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
        assert "Sentetik" not in repr(frame)
        assert queue.empty()
        assert client.get("/patients", headers=head).json()["patients"] == []


# ---------------------------------------------------------------- the stores (Task 5 review)
STORES = pytest.mark.parametrize(
    "make", [lambda p: InMemoryIdentityStore(), lambda p: SqliteIdentityStore(p / "identity.db")],
    ids=["memory", "sqlite"])
LATER = T0 + timedelta(hours=2)        # newer than the discharge: a refusal is never "stale"


def another_feed(kind: str, source: str, pid: str) -> IdentityRecord:
    """What the HIS bridge or a manual entry sends for a number, parsed as /ingest parses it."""
    meta = {"lastUpdated": LATER.isoformat(), "source": source}
    if kind == "Patient":
        return parse_fhir_patient({
            "resourceType": "Patient", "identifier": [{"system": PROTOCOL_SYSTEM, "value": pid}],
            "name": [{"family": "BASKA", "given": ["Sentetik"]}], "active": True, "meta": meta})
    return parse_fhir_encounter({
        "resourceType": "Encounter", "status": "in-progress",
        "subject": {"reference": f"Patient/{pid}"},
        "location": [{"location": {"display": "YB^304^2"}}], "meta": meta})


@STORES
@pytest.mark.parametrize("kind,source", [("Patient", "manuel"), ("Patient", "comed"),
                                         ("Encounter", "manuel")],
                         ids=["a manuel write", "a comed revival", "a manuel encounter"])
def test_no_other_feed_rewrites_a_kabul_record(make, kind, source, tmp_path):
    """A tombstone cannot be flipped back to admitted, an admitted `kabul` card cannot be moved
    off its own bed: only the admission that wrote the record writes it again."""
    store = make(tmp_path)
    store.apply("hosp", admitted("H2600001"))
    store.apply("hosp", discharged("H2600001"))
    store.apply("hosp", admitted("H2600002", bed_id="other-bed", bed="1B"))
    tomb, card = store.get("hosp", "H2600001"), store.get("hosp", "H2600002")
    assert store.apply("hosp", another_feed(kind, source, "H2600001")) is None
    assert store.apply("hosp", another_feed(kind, source, "H2600002")) is None
    assert store.get("hosp", "H2600001") == tomb
    assert store.get("hosp", "H2600002") == card
    assert store.admitted_ids("hosp") == ["H2600002"]


@STORES
def test_a_tombstone_is_not_in_the_board_inventory_and_a_discharged_his_record_still_is(
        make, tmp_path):
    """`patient_ids` is what every board load walks: tombstones are kept for good, so listing
    them would slow each load by every patient the ward has ever discharged."""
    store = make(tmp_path)
    store.apply("hosp", admitted("H2600001"))
    store.apply("hosp", discharged("H2600001"))
    store.apply("hosp", admitted("H2600002", bed_id="other-bed", bed="1B"))
    store.apply("hosp", IdentityRecord(patient_id="20239121", given="HIS HASTA", bed="2",
                                       state="discharged", source="comed", updated_at=T0))
    assert store.patient_ids("hosp") == ["20239121", "H2600002"]
    assert store.get("hosp", "H2600001").state == "discharged"       # kept, only not listed


_BEFORE_DIAGNOSES = ("CREATE TABLE identity (tenant TEXT NOT NULL, patient_id TEXT NOT NULL,"
                     " family TEXT, given TEXT, birth_date TEXT, sex TEXT,"
                     " unit TEXT, room TEXT, bed TEXT,"
                     " state TEXT NOT NULL, source TEXT, updated_at TEXT,"
                     " PRIMARY KEY (tenant, patient_id))")
_BEFORE_BED_IDS = _BEFORE_DIAGNOSES.replace(" updated_at TEXT,", " updated_at TEXT, diagnoses TEXT,")


def old_file(path, schema: str) -> None:
    """A SQLite identity file as an older engine left it: one HIS patient, no new columns."""
    conn = sqlite3.connect(str(path))
    conn.execute(schema)
    conn.execute("INSERT INTO identity (tenant, patient_id, family, given, birth_date, sex, unit,"
                 " room, bed, state, source, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                 ("hosp", "20239121", encrypt_phi("HASTA"), encrypt_phi("Sentetik"),
                  encrypt_phi("1970-01-01"), encrypt_phi("female"), "YB", "304", "2", "admitted",
                  "comed", T0.isoformat()))
    conn.commit()
    conn.close()


@pytest.mark.parametrize("schema", [_BEFORE_DIAGNOSES, _BEFORE_BED_IDS],
                         ids=["before diagnoses", "before bed ids"])
def test_an_old_sqlite_file_gains_only_the_missing_columns_and_keeps_its_rows(schema, tmp_path):
    path = tmp_path / "identity.db"
    old_file(path, schema)
    store = SqliteIdentityStore(path)
    his = store.get("hosp", "20239121")
    assert (his.display_name, his.bed_label, his.diagnoses, his.bed_id, his.unit_id) == \
        ("Sentetik HASTA", "YB 304-2", (), "", "")
    store.apply("hosp", admitted())
    store.close()
    again = SqliteIdentityStore(path)                  # a second start: nothing left to add
    assert (again.get("hosp", "H2600001").bed_id, again.get("hosp", "H2600001").unit_id) == \
        (BED, UNIT)
    columns = [row[1] for row in again._conn.execute("PRAGMA table_info(identity)")]
    assert columns[-3:] == ["diagnoses", "bed_id", "unit_id"]
    again.close()


@pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0,
                    reason="root writes a read-only file")
def test_a_sqlite_file_that_cannot_be_upgraded_stops_the_start(tmp_path):
    """Only a column already there is skipped. Any other failure — here a read-only file — is
    raised, not swallowed into a store whose every read then fails on a missing column."""
    path = tmp_path / "identity.db"
    old_file(path, _BEFORE_BED_IDS)
    os.chmod(path, stat.S_IREAD)
    try:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            SqliteIdentityStore(path)
    finally:
        os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
