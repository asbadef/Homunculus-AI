# homunculus-engine/tests/test_tasks_api.py
"""G3-02: /tasks against the DB-less app — the derived vital task, the hand tasks, the rights, the scope."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.tasks import DEFAULT_SETTINGS, TASK_NOT_OPEN, InMemoryTaskStore

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
ADMIN = {"Authorization": "Bearer admin-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart", "tasks.view", "tasks.manage"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("auditor",), perms=frozenset({"board.view"})),
    "admin-jwt": Caller(hospital="h1", actor="admin.lbys", groups=("hospital_admin",),
                        perms=frozenset({"board.view", "tasks.view", "tasks.manage", "structure.manage"})),
}
NOW = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def store():
    return InMemoryTaskStore(zones={"h1": "UTC"}, admitted={("h1", "S-002"): NOW - timedelta(hours=20)})


@pytest.fixture()
def client(store):
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, tasks=store)
    with TestClient(app) as c:
        yield c


def _ingest(client, patient, code, value, at):
    """A monitor observation through the device door — a FHIR Observation, as /ingest reads it."""
    fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": at.isoformat(),
            "valueQuantity": {"value": value, "unit": ""}}
    r = client.post("/ingest", json=fhir, headers=DEVICE)
    assert r.status_code == 200, r.text


def _chart(client, patient, entries, at):
    r = client.post(f"/clinical/{patient}", json={"recorded_at": at.isoformat(), "entries": entries}, headers=NURSE)
    assert r.status_code == 200, r.text
    return r.json()


def _tasks(client, headers=NURSE, **params):
    return client.get("/tasks", params=params, headers=headers)


def _card(client, patient):
    return next(p for p in _tasks(client).json()["patients"] if p["patient_id"] == patient)


class TestReading:
    def test_needs_tasks_view(self, client):
        assert _tasks(client, VIEWER).status_code == 403

    def test_answers_the_shift_window_the_settings_and_one_entry_per_patient(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        r = _tasks(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["shift"]["start"] <= body["now"] < body["shift"]["end"]
        assert body["settings"]["grace_min"] == 30 and body["settings"]["intervals"]["b0"] == 720
        card = next(p for p in body["patients"] if p["patient_id"] == "S-001")
        vital = card["vital"]
        assert vital["state"] == "plan" and vital["band"] == "b0" and vital["interval_min"] == 720
        assert vital["anchor_at"][:16] == at.isoformat()[:16] and len(vital["entries"]) == 1
        assert card["tasks"] == []

    def test_a_band_without_an_interval_has_no_vital_task(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 26}], at)        # 3 points → b3_single, NULL
        assert _card(client, "S-001")["vital"] is None

    def test_the_admission_is_the_anchor_when_nothing_was_charted(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        _ingest(client, "S-002", "heart_rate", 80, at)              # a monitor value is NOT a hand entry
        vital = _card(client, "S-002")["vital"]
        assert vital["state"] == "late"                              # admitted 20 h ago, b0 = 12 h, no hand set
        assert vital["anchor_at"] == (NOW - timedelta(hours=20)).isoformat()

    def test_unknown_when_there_is_neither(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        _ingest(client, "S-003", "heart_rate", 80, at)
        vital = _card(client, "S-003")["vital"]
        assert vital["state"] == "unknown" and vital["due_at"] is None

    def test_a_withdrawn_entry_is_not_an_anchor(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _ingest(client, "S-001", "heart_rate", 80, at)              # keeps the card on the board after the withdrawal
        saved = _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        entry = saved["entries"][0]["entry"]
        r = client.post(f"/clinical/S-001/entries/{entry}/retract", json={"reason": "yanlış hasta"}, headers=NURSE)
        assert r.status_code == 200, r.text
        vital = _card(client, "S-001")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_device_token_reads_too(self, client):
        assert _tasks(client, DEVICE).status_code == 200
