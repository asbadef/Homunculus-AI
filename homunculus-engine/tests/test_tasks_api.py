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


def _create(client, headers=NURSE, **over):
    body = {"patient_id": "S-001", "title": "Pansuman",
            "due_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "target_role": "nurse", **over}
    return client.post("/tasks", json=body, headers=headers)


def _seen(client, patient="S-001"):
    _ingest(client, patient, "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))


class TestWriting:
    def test_needs_tasks_manage_and_a_person(self, client):
        _seen(client)
        assert _create(client, VIEWER).status_code == 403
        assert _create(client, DEVICE).status_code == 403

    def test_creates_lists_and_audits(self, client):
        _seen(client)
        r = _create(client)
        assert r.status_code == 201, r.text
        task = r.json()
        assert task["state"] == "open" and task["late"] is False and task["created_by"] == "hem.ayse"
        assert task["title"] == "Pansuman"
        assert [t["id"] for t in _card(client, "S-001")["tasks"]] == [task["id"]]
        rows = client.app.state.audit.records(tenant="h1", event_type="task_created", limit=10)
        assert rows and rows[-1].payload == {"task": task["id"], "patient_id": "S-001", "due_at": task["due_at"],
                                              "target_role": "nurse", "actor": "hem.ayse"}

    def test_refusals(self, client):
        _seen(client)
        assert _create(client, title="").status_code == 422
        assert _create(client, title="x" * 201).status_code == 422
        assert _create(client, due_at=(datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()).status_code == 422
        assert _create(client, due_at=(datetime.now(timezone.utc) + timedelta(days=8)).isoformat()).status_code == 422
        assert _create(client, target_role="vet").status_code == 422
        assert _create(client, patient_id="S-404").status_code == 404        # not on the caller's board

    def test_claim_done_skip_and_409_after_closing(self, client):
        _seen(client)
        task = _create(client).json()
        r = client.post(f"/tasks/{task['id']}/claim", headers=NURSE)
        assert r.status_code == 200 and r.json()["claimed_by"] == "hem.ayse"
        r = client.post(f"/tasks/{task['id']}/done", headers=NURSE)
        assert r.status_code == 200 and r.json()["state"] == "done" and r.json()["closed_by"] == "hem.ayse"
        r = client.post(f"/tasks/{task['id']}/done", headers=NURSE)
        assert r.status_code == 409 and r.json()["detail"]["code"] == TASK_NOT_OPEN
        other = _create(client).json()
        r = client.post(f"/tasks/{other['id']}/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 200 and r.json()["state"] == "skipped"
        assert client.post(f"/tasks/{other['id']}/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
        assert client.post("/tasks/nope/done", headers=NURSE).status_code == 404
        kinds = [r.event_type for r in client.app.state.audit.records(tenant="h1", limit=1000)]
        assert kinds.count("task_claimed") == 1 and kinds.count("task_done") == 1 and kinds.count("task_skipped") == 1

    def test_skip_reason_is_required_and_bounded(self, client):
        _seen(client)
        task = _create(client).json()
        assert client.post(f"/tasks/{task['id']}/skip", json={"reason": ""}, headers=NURSE).status_code == 422
        assert client.post(f"/tasks/{task['id']}/skip", json={"reason": "x" * 201}, headers=NURSE).status_code == 422

    def test_skipping_the_vital_task_hides_it_for_one_interval(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(hours=13)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)          # b0, due 1 h ago → late
        assert _card(client, "S-001")["vital"]["state"] == "late"
        r = client.post("/tasks/vitals/S-001/skip", json={"reason": "hasta görüntülemede"}, headers=NURSE)
        assert r.status_code == 200, r.text
        until = r.json()["skipped_until"]
        assert until == (at + timedelta(minutes=1440)).isoformat()                 # the due point after the current one
        vital = _card(client, "S-001")["vital"]
        assert vital["state"] == "skipped" and vital["due_at"] == until
        rows = client.app.state.audit.records(tenant="h1", event_type="vital_skipped", limit=5)
        assert rows[-1].payload == {"patient_id": "S-001", "until": until, "actor": "hem.ayse"}

    def test_skipping_a_vital_task_that_is_not_due_is_409(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)          # plan
        assert client.post("/tasks/vitals/S-001/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
        _seen(client, "S-003")                                                       # unknown anchor
        assert client.post("/tasks/vitals/S-003/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
