# homunculus-engine/tests/test_kabul_identity.py
"""The join of the admissions world to the board (Group 2 · B1a, spec §4.3): a `kabul` identity
carries its own bed and unit, the board places the card by them without the bed map, and a
discharged `kabul` identity is a tombstone — never pruned, never on the board, and a removal that
reaches the unit's scoped screens. HIS-fed records keep working as before. No database (the
memory and SQLite stores; the Postgres one is in test_patient_identity_postgres.py). Synthetic."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import (
    KABUL, IdentityRecord, InMemoryIdentityStore, SqliteIdentityStore,
)
from homunculus.canonical import Observation, SignalCode
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
