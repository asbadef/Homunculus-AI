# homunculus-engine/tests/test_readings_ingest.py
"""G3-05 (spec D6, D7, D8, D14): the two doors write the per-admission record. A matched device reading is a
`vital_readings` row with its `ingest` row's id and its stay; a re-sent one is recognised before the engine; the
bedside set typed at /clinical is filed as `manual`. The table never fails a request the engine has taken.
Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    MANUAL_CODES, ORIGIN_DEVICE, ORIGIN_MANUAL, SOURCE_MAX, STATE_RECORDED, InMemoryReadingStore,
)
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
KEY = "202600000001"
ADMISSION = "11111111-1111-4111-8111-111111111111"      # a synthetic admission id
WHEN = datetime.now(timezone.utc) - timedelta(minutes=5)
WINDOW = {"since": WHEN - timedelta(hours=1), "until": WHEN + timedelta(hours=1)}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


class _Flaky(InMemoryReadingStore):
    """A store whose `seen` or `add` raises on demand — the database going away mid-request."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.fail: set[str] = set()
        self.closed = False

    def seen(self, *args, **kw):
        if "seen" in self.fail:
            raise RuntimeError("readings down")
        return super().seen(*args, **kw)

    def add(self, row):
        if "add" in self.fail:
            raise RuntimeError("readings down")
        return super().add(row)

    def admission_of(self, tenant, key):
        if "admission_of" in self.fail:
            raise RuntimeError("readings down")
        return super().admission_of(tenant, key)

    def close(self):
        self.closed = True


@pytest.fixture()
def world():
    """The app on a store that knows KEY's admission, with an identity store a test admits patients into."""
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    store = _Flaky(admitted={("h1", KEY): ADMISSION})
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit,
                     identities=identities, readings=store)
    with TestClient(app) as client:
        yield client, store, audit, identities


def _admit(identities, key=KEY, source=KABUL, state="admitted"):
    identities.apply("h1", IdentityRecord(key, family="Hasta", given="Test", state=state, source=source,
                                          updated_at=WHEN - timedelta(hours=2)))


def _rows(store, key=KEY):
    return store.for_patient("h1", key, **WINDOW)


def _ingest_rows(audit, key=KEY):
    return audit.records(tenant="h1", patient_id=key, event_type="ingest", limit=100)


def _history(client, key, code):
    """The engine's readings of one code, through the handle BoardLink is given; [] for an id it never measured."""
    engine = client.app.state.board_link._engine("h1")
    if key not in engine.patient_ids():
        return []
    return [o.value for o in engine.state(key).history(code)]


class TestAMatchedDeviceReading:
    def test_is_filed_with_its_ingest_row_and_its_stay(self, world):
        client, store, audit, identities = world
        _admit(identities)
        r = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
        assert r.status_code == 200 and "duplicate" not in r.json()
        [written] = _ingest_rows(audit)
        [row] = _rows(store)
        assert (row.origin, row.state, row.source, row.recorded_by) == (ORIGIN_DEVICE, STATE_RECORDED, "CONNEX-3A", None)
        assert (row.received_key, row.patient_key, row.code, row.value, row.unit) == (KEY, KEY, "spo2", 97.0, "u")
        assert row.observed_at == WHEN and row.received_at >= WHEN
        assert row.audit_id == row.entry_id == written.id                # the row «hatalı giriş» will name
        assert row.admission_id == ADMISSION                             # D8: stamped at arrival
        assert "reading" not in written.payload                          # only a linked reading carries one (B6)

    def test_of_a_his_fed_patient_has_no_stay(self, world):
        """D8: a record of another source keeps today's path — filed under its number, `admission_id` NULL."""
        client, store, _, identities = world
        _admit(identities, source="comed")
        assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
        [row] = _rows(store)
        assert (row.patient_key, row.admission_id) == (KEY, None)

    def test_under_a_number_with_no_identity_is_filed_under_that_number(self, world):
        """The default policy for an unknown number is `card` (D9, Task B5): the reading is applied, so it is recorded."""
        client, store, _, _ = world
        assert client.post("/ingest", json=obs("spo2", 97, "S-404", WHEN), headers=DEVICE).status_code == 200
        [row] = _rows(store, "S-404")
        assert (row.patient_key, row.admission_id, row.state) == ("S-404", None, STATE_RECORDED)

    def test_keeps_a_device_name_to_the_columns_width(self, world):
        client, store, _, _ = world
        long_name = "CONNEX-" + "X" * 100
        assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN, device=long_name), headers=DEVICE).status_code == 200
        [row] = _rows(store)
        assert row.source == long_name[:SOURCE_MAX] and len(row.source) == 64
        again = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN, device=long_name), headers=DEVICE)
        assert again.json() == {"patient_id": KEY, "duplicate": True}    # compared as it was kept


class TestAReSentReading:
    def test_is_answered_duplicate_with_no_row_no_point_and_no_frame(self, world):
        client, store, audit, _ = world
        first = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert first.status_code == 200 and "alerts" in first.json()
        trail = len(audit.records(tenant="h1", limit=1000))
        queue = client.app.state.broadcaster.subscribe("h1")
        again = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert again.status_code == 200 and again.json() == {"patient_id": KEY, "duplicate": True}
        assert len(audit.records(tenant="h1", limit=1000)) == trail      # no audit row at all
        assert _history(client, KEY, _code("heart_rate")) == [140.0]     # one point in the engine
        assert queue.empty() and len(_rows(store)) == 1

    @pytest.mark.parametrize("change", [
        {"value": 141}, {"when": WHEN + timedelta(seconds=1)}, {"device": "CONNEX-3B"}, {"patient": "202600000002"},
        {"code": "resp_rate"},
    ])
    def test_another_value_time_device_number_or_code_is_another_reading(self, world, change):
        client, _, audit, _ = world
        base = {"code": "heart_rate", "value": 140, "patient": KEY, "when": WHEN, "device": "CONNEX-3A"}
        assert client.post("/ingest", json=obs(**base), headers=DEVICE).status_code == 200
        other = client.post("/ingest", json=obs(**{**base, **change}), headers=DEVICE)
        assert other.status_code == 200 and "duplicate" not in other.json()
        assert len(audit.records(tenant="h1", event_type="ingest", limit=100)) == 2

    def test_a_store_that_cannot_answer_fails_open(self, world):
        """D14: a store error must never drop a measurement — the reading is ingested."""
        client, store, audit, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE).status_code == 200
        store.fail = {"seen"}
        again = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert again.status_code == 200 and "alerts" in again.json()
        assert len(_ingest_rows(audit)) == 2
        assert len(_rows(store)) == 1                                    # the table's own index refused the twin


class TestTheTableNeverFailsARequestTheEngineTook:
    def test_a_failed_table_write_still_answers_200_with_the_audit_row_and_the_point(self, world):
        client, store, audit, _ = world
        store.fail = {"add"}
        r = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert r.status_code == 200 and "alerts" in r.json()
        assert len(_ingest_rows(audit)) == 1 and _history(client, KEY, _code("heart_rate")) == [140.0]
        assert _rows(store) == []                                        # `reconcile` files it (Task B10)

    def test_a_failed_admission_lookup_does_not_fail_it_either(self, world):
        client, store, audit, identities = world
        _admit(identities)
        store.fail = {"admission_of"}
        assert client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE).status_code == 200
        assert len(_ingest_rows(audit)) == 1 and _rows(store) == []

    def test_a_failed_table_write_does_not_fail_a_chart(self, world):
        client, store, audit, _ = world
        store.fail = {"add"}
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 16}],
                                                  "recorded_at": WHEN.isoformat()}, headers=NURSE)
        assert r.status_code == 200 and r.json()["charted"] == 1
        assert len(audit.records(tenant="h1", event_type="chart", limit=10)) == 1


class TestTheBedsideSetIsFiledAsManual:
    def test_each_value_of_the_set_is_a_manual_row_with_its_chart_row(self, world):
        client, store, _, identities = world
        _admit(identities)
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"recorded_at": WHEN.isoformat(), "entries": [
            {"code": "resp_rate", "value": 16}, {"code": "spo2", "value": 97}, {"code": "supplemental_oxygen", "value": 0},
            {"code": "acvpu", "value": 0}]})
        assert r.status_code == 200, r.text
        entries = {e["code"]: e["entry"] for e in r.json()["entries"]}
        rows = {row.code: row for row in _rows(store)}
        assert set(rows) == {"resp_rate", "spo2", "supplemental_oxygen", "acvpu"}
        for code, row in rows.items():
            assert (row.origin, row.source, row.recorded_by, row.state) == (ORIGIN_MANUAL, "clinician", "hem.ayse", STATE_RECORDED)
            assert row.audit_id == row.entry_id == entries[code]
            assert (row.received_key, row.patient_key, row.admission_id) == (KEY, KEY, ADMISSION)
            assert row.observed_at == WHEN and row.received_at >= WHEN
        assert (rows["resp_rate"].value, rows["resp_rate"].unit) == (16.0, "/min")

    def test_what_is_not_the_bedside_set_is_not_filed(self, world):
        """D6: the fluid volumes have their own ledger; a lactate, a mark and a pressor rate are no bedside vital."""
        client, store, _, _ = world
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"recorded_at": WHEN.isoformat(), "entries": [
            {"code": "urine_output_ml", "value": 200}, {"code": "lactate", "value": 2.1},
            {"code": "suspected_infection", "value": 1}, {"code": "heart_rate", "value": 88}]})
        assert r.status_code == 200, r.text
        assert [row.code for row in _rows(store)] == ["heart_rate"]

    def test_the_filed_codes_are_the_withdrawable_ones_minus_the_fluids(self):
        assert MANUAL_CODES == {"resp_rate", "spo2", "supplemental_oxygen", "sbp", "map", "heart_rate", "acvpu",
                                "temperature"}

    def test_a_chart_through_the_device_token_names_nobody(self, world):
        client, store, _, _ = world
        r = client.post(f"/clinical/{KEY}", headers=DEVICE, json={"entries": [{"code": "heart_rate", "value": 88}],
                                                                   "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200
        [row] = _rows(store)
        assert (row.origin, row.recorded_by) == (ORIGIN_MANUAL, "tenant-token")

    def test_an_equal_hand_value_is_never_a_duplicate_of_the_devices(self, world):
        client, store, _, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 88, KEY, WHEN, device="clinician"), headers=DEVICE).status_code == 200
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"entries": [{"code": "heart_rate", "value": 88}],
                                                                  "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200 and r.json()["charted"] == 1
        assert sorted(row.origin for row in _rows(store)) == [ORIGIN_DEVICE, ORIGIN_MANUAL]

    def test_a_discharged_number_files_nothing_at_the_chart_door(self, world):
        client, store, _, identities = world
        _admit(identities, state="discharged")
        r = client.post(f"/clinical/{KEY}", headers=NURSE, json={"entries": [{"code": "heart_rate", "value": 88}],
                                                                  "recorded_at": WHEN.isoformat()})
        assert r.json() == {"patient_id": KEY, "dropped": "discharged"}
        assert _rows(store) == []


def _code(slug):
    from homunculus.canonical import SignalCode
    return SignalCode(slug)


def test_without_a_store_the_app_keeps_the_record_in_memory():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    assert isinstance(app.state.readings, InMemoryReadingStore)
    with TestClient(app) as client:
        assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
    assert len(app.state.readings.for_patient("h1", KEY, **WINDOW)) == 1


def test_the_store_is_released_at_shutdown():
    store = _Flaky()
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=store)):
        assert store.closed is False
    assert store.closed is True
