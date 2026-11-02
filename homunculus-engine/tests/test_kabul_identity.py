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
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import (
    DISCHARGED_TTL, KABUL, PROTOCOL_SYSTEM, IdentityRecord, InMemoryIdentityStore,
    SqliteIdentityStore, parse_fhir_encounter, parse_fhir_patient,
)
from homunculus.canonical import Observation, SignalCode
from homunculus.crypto import encrypt_phi
from homunculus.pipeline import Engine
from homunculus.scope import Scope, ScopeReason, build_scope, sees_patient
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


HEAD = {"Authorization": "Bearer tok-1"}


def reading(code: str = "spo2", value: float = 97.0, at: datetime = T0 + timedelta(hours=2),
            pid: str = "H2600001") -> dict:
    """A device reading as the bridge posts it to `/ingest` (synthetic)."""
    return {"resourceType": "Observation", "status": "final",
            "code": {"coding": [{"system": "http://homunculus.local/obs", "code": code}]},
            "subject": {"reference": f"Patient/{pid}"}, "effectiveDateTime": at.isoformat(),
            "valueQuantity": {"value": value, "unit": "u"}, "device": {"display": "nce"}}


def dropped_rows(audit: InMemoryAuditLog) -> list:
    return audit.records(tenant="h1", event_type="reading_dropped_discharged", limit=100)


def test_a_reading_for_a_discharged_number_through_ingest_is_dropped_before_the_engine():
    """A-11 (the user, 2026-10-26) through Lane A's `/ingest` (G2-A11, D3): a reading for a
    tombstone never reaches the engine. One audit row tells the ward a monitor still carries the
    number; no frame is pushed (the discharge's one removal is the retirement's, A-11d), and the
    board stays empty. Rewritten at the merge from `…_publishes_its_removal` (X54), whose reading
    still reached the engine."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    identities.apply("h1", admitted())
    identities.apply("h1", discharged())
    app = create_app({"tok-1": "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
    with TestClient(app) as client:
        queue = app.state.broadcaster.subscribe("h1")
        response = client.post("/ingest", json=reading(), headers=HEAD)
        assert response.status_code == 200
        assert response.json() == {"patient_id": "H2600001", "dropped": "discharged"}
        assert queue.empty()
        (row,) = dropped_rows(audit)
        assert (row.patient_id, row.subject, row.payload) == \
            ("H2600001", "spo2", {"patient_id": "H2600001", "code": "spo2"})
        assert client.get("/patients", headers=HEAD).json()["patients"] == []


def test_a_tombstone_outlives_the_retention_sweep_and_its_readings_are_still_dropped():
    """A-25 (Lane A's condition 4): the real escalation cycle a day past the discharge runs the
    24 h retention sweep. A `kabul` tombstone is exempt (`_is_expired`), so it is still there and a
    reading for its number is still dropped — while a HIS discharge of the same age, the control,
    is swept off the board and out of the store."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    identities.apply("h1", admitted())
    identities.apply("h1", discharged())                              # at T0 + 1 h
    identities.apply("h1", IdentityRecord(patient_id="20239121", given="HIS HASTA", bed="2",
                                          state="admitted", source="comed", updated_at=T0))
    identities.apply("h1", IdentityRecord(patient_id="20239121", state="discharged",
                                          source="comed", updated_at=T0 + timedelta(hours=1)))
    app = create_app({"tok-1": "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
    later = timedelta(hours=25)
    assert later > DISCHARGED_TTL
    with TestClient(app) as client:
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, T0 + timedelta(hours=1) + later)

        assert identities.get("h1", "20239121") is None              # the control was swept
        frames = []
        while not queue.empty():
            frames.append(queue.get_nowait())
        assert [(f["patient_id"], f["removed"]) for f in frames] == [("20239121", True)]
        tomb = identities.get("h1", "H2600001")
        assert (tomb.state, tomb.source, tomb.bed_id, tomb.unit_id) == ("discharged", KABUL, BED, UNIT)

        response = client.post("/ingest", json=reading(at=T0 + timedelta(hours=26)), headers=HEAD)
        assert response.status_code == 200
        assert response.json() == {"patient_id": "H2600001", "dropped": "discharged"}
        assert len(dropped_rows(audit)) == 1
        assert queue.empty()
        assert client.get("/patients", headers=HEAD).json()["patients"] == []


def test_the_escalation_cycle_retiring_an_alerting_tombstone_tells_its_units_screens():
    """G2-A11 D6 with A-25: a discharge whose retire call never came is retired by the escalation
    cycle, and the one removal it publishes is the tombstone's board (`tombstone_board`, from the
    record the guard already read) — the last bed and unit, no name — so the screen scoped to that
    unit is told too, and no other. Before the merge it was the bare removal, `identity: null`,
    which no scoped screen ever receives."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    identities.apply("h1", admitted())
    app = create_app({"tok-1": "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
    with TestClient(app) as client:
        assert client.post("/ingest", json=reading("heart_rate", 140), headers=HEAD).status_code == 200
        assert client.get("/alerts/H2600001", headers=HEAD).json()["alerts"]          # one fires
        identities.apply("h1", discharged())                          # the retire call never came
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.escalation_cycle, T0 + timedelta(hours=2))

        frames = []
        while not queue.empty():
            frames.append(queue.get_nowait())
        (frame,) = [f for f in frames if f.get("removed")]
        assert frame["patient_id"] == "H2600001"
        assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
        assert "Sentetik" not in repr(frame)
        assert sees_patient(frame, build_scope("MEMBER", unit_ids=[UNIT]))
        assert not sees_patient(frame, build_scope("MEMBER", unit_ids=["another-unit"]))
        assert [r.payload["reason"] for r in audit.records(
            tenant="h1", event_type="alert_cleared", patient_id="H2600001", limit=100)] == ["discharged"]
        assert client.get("/alerts/H2600001", headers=HEAD).json()["alerts"] == []


UNIT_NURSE = Caller(hospital="h1", actor="hemsire1", groups=("nurse",),
                    perms=frozenset({"board.view", "clinical.chart"}))
NURSE_HEAD = {"Authorization": "Bearer nurse-jwt"}
LACTATE_CHART = {"entries": [{"code": "lactate", "value": 1.2}]}


def unit_scoped_app(unit_id: str):
    """The app with a tombstone and one nurse whose scope is one unit — a JWT and a scope
    resolver, as production wires them, without the database."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    identities.apply("h1", admitted())
    identities.apply("h1", discharged())

    async def resolve_jwt(token):
        return UNIT_NURSE if token == "nurse-jwt" else None

    async def resolve_scope(token):
        return Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({unit_id}))

    app = create_app({"tok-1": "h1"}, run_escalation_loop=False, audit=audit,
                     identities=identities, resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)
    return app, audit


def rows(audit: InMemoryAuditLog, event_type: str) -> list:
    return audit.records(tenant="h1", event_type=event_type, limit=100)


def test_a_nurse_of_the_tombstones_last_unit_charting_it_is_told_dropped_not_not_found():
    """A-25 (Lane A's note 5): a tombstone sits on no bed, so the scope check of a single-patient
    route reads it at its last bed and unit (`tombstone_board`). The unit's own nurse reaches
    `/clinical`, whose drop answers — and no `scope_denied` row records a look outside her scope
    that never happened. Nothing reaches the engine."""
    app, audit = unit_scoped_app(UNIT)
    with TestClient(app) as client:
        response = client.post("/clinical/H2600001", json=LACTATE_CHART, headers=NURSE_HEAD)
    assert response.status_code == 200
    assert response.json() == {"patient_id": "H2600001", "dropped": "discharged"}
    (row,) = rows(audit, "reading_dropped_discharged")
    assert (row.patient_id, row.subject) == ("H2600001", "lactate")
    assert rows(audit, "scope_denied") == [] and rows(audit, "chart") == []
    assert app.state.board_link._engine("h1").patient_ids() == []


def test_a_nurse_of_another_unit_charting_a_tombstone_is_still_not_found():
    app, audit = unit_scoped_app("another-unit")
    with TestClient(app) as client:
        response = client.post("/clinical/H2600001", json=LACTATE_CHART, headers=NURSE_HEAD)
    assert response.status_code == 404
    (denied,) = rows(audit, "scope_denied")
    assert denied.patient_id == "H2600001"
    assert rows(audit, "reading_dropped_discharged") == [] and rows(audit, "chart") == []
    assert app.state.board_link._engine("h1").patient_ids() == []


def test_one_tombstone_predicate_lives_beside_kabul():
    """A-25 (Lane A's O1/O4): what a tombstone is, is said once — `patient_identity.is_tombstone`,
    next to `KABUL` — and the alert lifecycle and the board read that one."""
    from homunculus.api import alert_lifecycle, board, patient_identity

    assert alert_lifecycle.is_tombstone is patient_identity.is_tombstone
    assert not hasattr(alert_lifecycle, "KABUL_SOURCE")
    assert not hasattr(board, "_is_tombstone")
    assert patient_identity.is_tombstone(discharged())
    assert not patient_identity.is_tombstone(admitted())
    assert not patient_identity.is_tombstone(IdentityRecord("20239121", state="discharged",
                                                            source="comed"))
    assert not patient_identity.is_tombstone(None)


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
