# homunculus-engine/tests/test_tasks_api.py
"""G3-02: /tasks against the DB-less app — the derived vital task, the hand tasks, the rights, the scope."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.tasks import DEFAULT_SETTINGS, TASK_NOT_OPEN, VITAL_SKIPPED, InMemoryTaskStore
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.tenant.bedmap import BedMap

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
ADMIN = {"Authorization": "Bearer admin-jwt"}
H2_NURSE = {"Authorization": "Bearer h2-nurse-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart", "tasks.view", "tasks.manage"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("auditor",), perms=frozenset({"board.view"})),
    "admin-jwt": Caller(hospital="h1", actor="admin.lbys", groups=("hospital_admin",),
                        perms=frozenset({"board.view", "tasks.view", "tasks.manage", "structure.manage"})),
    "h2-nurse-jwt": Caller(hospital="h2", actor="hem.zeynep", groups=("nurse",),
                           perms=frozenset({"board.view", "clinical.chart", "tasks.view", "tasks.manage"})),
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
        assert vital["anchor_at"][:16] == at.isoformat()[:16]
        # `entries` are this shift's cells: an entry 5 min back is in the previous shift during the first 5 min of one.
        in_shift = at >= datetime.fromisoformat(body["shift"]["start"])
        assert len(vital["entries"]) == (1 if in_shift else 0)
        assert card["tasks"] == []

    def test_a_band_without_an_interval_has_no_vital_task(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 26}], at)        # 3 points → b3_single, NULL
        assert _card(client, "S-001")["vital"] is None

    def test_the_admission_is_the_anchor_when_nothing_was_charted(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        _ingest(client, "S-002", "map", 80, at)                     # a value NEWS2 does not score is no vital measurement (G3-05 D15)
        vital = _card(client, "S-002")["vital"]
        assert vital["state"] == "late"                              # admitted 20 h ago, b0 = 12 h, no hand set
        assert vital["anchor_at"] == (NOW - timedelta(hours=20)).isoformat()

    def test_unknown_when_there_is_neither(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        _ingest(client, "S-003", "map", 80, at)                     # on the board, with nothing NEWS2 scores measured
        vital = _card(client, "S-003")["vital"]
        assert vital["state"] == "unknown" and vital["due_at"] is None

    def test_a_withdrawn_entry_is_not_an_anchor(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _ingest(client, "S-001", "map", 80, at)                     # keeps the card on the board after the withdrawal
        saved = _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        entry = saved["entries"][0]["entry"]
        r = client.post(f"/clinical/S-001/entries/{entry}/retract", json={"reason": "yanlış hasta"}, headers=NURSE)
        assert r.status_code == 200, r.text
        vital = _card(client, "S-001")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_device_token_reads_too(self, client):
        assert _tasks(client, DEVICE).status_code == 200

    def test_a_set_stamped_up_to_two_minutes_ahead_is_the_anchor_at_once(self, client):
        ahead = datetime.now(timezone.utc) + timedelta(minutes=1)          # the bedside clock runs a minute fast
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], ahead)
        vital = _card(client, "S-001")["vital"]
        assert vital["state"] == "plan" and vital["anchor_at"] == ahead.isoformat()

    def test_one_board_read_gives_each_patient_its_own_anchor(self, client, store, monkeypatch):
        now = datetime.now(timezone.utc)
        stamps = {"S-001": now - timedelta(minutes=5), "S-002": now - timedelta(hours=2), "S-003": now - timedelta(hours=13)}
        for patient, at in stamps.items():
            _chart(client, patient, [{"code": "resp_rate", "value": 16}], at)
        _seen(client, "S-004")                                                  # no hand set, no admission
        audit, reads, admissions = client.app.state.audit, [], []
        real_records, real_admitted = audit.records, store.admitted_at

        def records(**kw):
            reads.append(kw)
            return real_records(**kw)

        def admitted_at(tenant, patient_id):
            admissions.append(patient_id)
            return real_admitted(tenant, patient_id)

        monkeypatch.setattr(audit, "records", records)
        monkeypatch.setattr(store, "admitted_at", admitted_at)
        vitals = {p["patient_id"]: p["vital"] for p in _tasks(client).json()["patients"]}
        for patient, at in stamps.items():
            assert vitals[patient]["anchor_at"] == at.isoformat(), patient
            assert vitals[patient]["entries"] in ([], [at.isoformat()]), patient   # the shift window cuts, never mixes
        assert [vitals[p]["state"] for p in ("S-001", "S-002", "S-003", "S-004")] == ["plan", "plan", "late", "unknown"]
        assert len([kw for kw in reads if "chart" in (kw.get("event_types") or ())]) == 1
        assert len([kw for kw in reads if kw.get("event_type") == VITAL_SKIPPED]) == 1
        assert admissions == ["S-004"]                                          # only the patient without an anchor

    def test_an_unreadable_or_too_long_window_is_422(self, client):
        start = datetime.now(timezone.utc)
        assert _tasks(client, **{"from": "dün"}).status_code == 422
        assert _tasks(client, to="yarın").status_code == 422
        week = (start + timedelta(days=7)).isoformat()
        assert _tasks(client, **{"from": start.isoformat(), "to": week}).status_code == 200
        longer = (start + timedelta(days=7, minutes=1)).isoformat()
        assert _tasks(client, **{"from": start.isoformat(), "to": longer}).status_code == 422


def _create(client, headers=NURSE, **over):
    body = {"patient_id": "S-001", "title": "Pansuman",
            "due_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "target_role": "nurse", **over}
    return client.post("/tasks", json=body, headers=headers)


def _seen(client, patient="S-001"):
    """Puts the patient on the board without measuring a NEWS2 input: a device MAP. (A device heart rate would
    anchor the vital task since G3-05, D15.)"""
    _ingest(client, patient, "map", 80, datetime.now(timezone.utc) - timedelta(minutes=3))


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

    def test_a_skip_more_than_one_interval_late_lasts_until_the_next_due_point(self, client):
        _seen(client)
        at = datetime.now(timezone.utc) - timedelta(hours=30)
        # Not one of the six bedside vitals, so a set 30 h back is accepted (G3-01 X12); still a NEWS2 input.
        _chart(client, "S-001", [{"code": "supplemental_oxygen", "value": False}], at)
        assert _card(client, "S-001")["vital"]["state"] == "late"                  # due at +12 h, +24 h passed too
        r = client.post("/tasks/vitals/S-001/skip", json={"reason": "hasta görüntülemede"}, headers=NURSE)
        assert r.status_code == 200, r.text
        until = r.json()["skipped_until"]
        assert until == (at + timedelta(minutes=3 * 720)).isoformat()             # +36 h: the first due point after now
        assert datetime.fromisoformat(until) > datetime.now(timezone.utc)
        vital = _card(client, "S-001")["vital"]
        assert vital["state"] == "skipped" and vital["due_at"] == until

    def test_a_newer_hand_set_ends_the_skip(self, client):
        at = datetime.now(timezone.utc) - timedelta(hours=13)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        assert client.post("/tasks/vitals/S-001/skip", json={"reason": "hasta görüntülemede"}, headers=NURSE).status_code == 200
        assert _card(client, "S-001")["vital"]["state"] == "skipped"
        later = datetime.now(timezone.utc)                                          # measured after the skip
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], later)
        vital = _card(client, "S-001")["vital"]
        assert vital["state"] == "plan" and vital["skipped_until"] is None and vital["anchor_at"] == later.isoformat()

    def test_a_close_that_lost_the_race_is_409_and_writes_nothing(self, client, store, monkeypatch):
        _seen(client)
        task = _create(client).json()
        stale = store.get("h1", task["id"])                                         # read before the other nurse closed it
        assert client.post(f"/tasks/{task['id']}/done", headers=NURSE).status_code == 200
        monkeypatch.setattr(store, "get", lambda tenant, task_id: stale)
        r = client.post(f"/tasks/{task['id']}/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 409 and r.json()["detail"]["code"] == TASK_NOT_OPEN
        kinds = [r.event_type for r in client.app.state.audit.records(tenant="h1", limit=1000)]
        assert kinds.count("task_skipped") == 0

    def test_skipping_a_vital_task_that_is_not_due_is_409(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)          # plan
        assert client.post("/tasks/vitals/S-001/skip", json={"reason": "x"}, headers=NURSE).status_code == 409
        _seen(client, "S-003")                                                       # unknown anchor
        assert client.post("/tasks/vitals/S-003/skip", json={"reason": "x"}, headers=NURSE).status_code == 409


class TestSettings:
    def test_defaults_until_saved_structure_manage_only(self, client):
        assert client.get("/tasks/settings", headers=NURSE).status_code == 403
        r = client.get("/tasks/settings", headers=ADMIN)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["configured"] is False and body["shift_start_a"] == 8 and body["shift_start_b"] == 20
        assert body["grace_min"] == 30 and body["intervals"] == DEFAULT_SETTINGS.intervals
        assert body["default_source"] == {"b0": "news2-rcp-2017"}

    def test_put_validates_saves_and_audits(self, client):
        good = {"shift_start_a": 8, "shift_start_b": 20, "grace_min": 45,
                "intervals": {"b0": 720, "b1_4": 360, "b3_single": 60, "b5_6": 60, "b7": 30}}
        r = client.put("/tasks/settings", json=good, headers=ADMIN)
        assert r.status_code == 200, r.text
        assert r.json()["configured"] is True and r.json()["grace_min"] == 45 and r.json()["updated_by"] == "admin.lbys"
        assert client.get("/tasks/settings", headers=ADMIN).json()["intervals"]["b1_4"] == 360
        assert client.put("/tasks/settings", json={**good, "shift_start_b": 8}, headers=ADMIN).status_code == 422
        assert client.put("/tasks/settings", json={**good, "grace_min": 241}, headers=ADMIN).status_code == 422
        assert client.put("/tasks/settings", json={**good, "intervals": {**good["intervals"], "b7": 4}}, headers=ADMIN).status_code == 422
        assert client.put("/tasks/settings", json={**good, "intervals": {"b0": 720}}, headers=ADMIN).status_code == 422
        rows = client.app.state.audit.records(tenant="h1", event_type="task_settings_changed", limit=5)
        assert rows[-1].payload["actor"] == "admin.lbys" and rows[-1].payload["after"]["grace_min"] == 45
        assert rows[-1].payload["before"]["grace_min"] == 30

    def test_the_first_save_audits_the_defaults_as_not_configured(self, client):
        good = {"shift_start_a": 8, "shift_start_b": 20, "grace_min": 45,
                "intervals": {"b0": 720, "b1_4": 360, "b3_single": 60, "b5_6": 60, "b7": 30}}
        assert client.put("/tasks/settings", json=good, headers=ADMIN).status_code == 200
        rows = client.app.state.audit.records(tenant="h1", event_type="task_settings_changed", limit=5)
        assert rows[-1].payload["before"]["configured"] is False
        assert client.put("/tasks/settings", json={**good, "grace_min": 30}, headers=ADMIN).status_code == 200
        rows = client.app.state.audit.records(tenant="h1", event_type="task_settings_changed", limit=5)
        assert rows[-1].payload["before"]["configured"] is True and rows[-1].payload["before"]["grace_min"] == 45

    def test_the_queue_uses_the_saved_intervals(self, client):
        client.put("/tasks/settings", json={"shift_start_a": 8, "shift_start_b": 20, "grace_min": 30,
                                            "intervals": {"b0": 720, "b1_4": None, "b3_single": 60, "b5_6": None, "b7": None}},
                   headers=ADMIN)
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 26}], at)          # b3_single, now 60 min
        vital = _card(client, "S-001")["vital"]
        assert vital["band"] == "b3_single" and vital["interval_min"] == 60 and vital["state"] == "plan"


_CLOSE = (("claim", None), ("done", None), ("skip", {"reason": "hasta taburcu"}))


class TestScope:
    def test_a_task_whose_patient_left_the_board_is_404(self, client, store):
        _seen(client)
        task = _create(client).json()
        client.portal.call(client.app.state.retire_patient, "h1", "S-001")
        assert all(p["patient_id"] != "S-001" for p in _tasks(client).json()["patients"])
        for action, body in _CLOSE:
            r = client.post(f"/tasks/{task['id']}/{action}", json=body, headers=NURSE)
            assert r.status_code == 404, (action, r.text)
        row = store.get("h1", task["id"])
        assert row.state == "open" and row.claimed_by is None

    def test_another_hospital_neither_sees_nor_touches_the_task(self, client, store):
        _seen(client)
        task = _create(client).json()
        body = _tasks(client, H2_NURSE).json()
        assert all(p["patient_id"] != "S-001" for p in body["patients"])
        assert all(t["id"] != task["id"] for p in body["patients"] for t in p["tasks"])
        for action, payload in _CLOSE:
            r = client.post(f"/tasks/{task['id']}/{action}", json=payload, headers=H2_NURSE)
            assert r.status_code == 404, (action, r.text)
        assert client.post("/tasks/vitals/S-001/skip", json={"reason": "x"}, headers=H2_NURSE).status_code == 404
        assert _create(client, H2_NURSE).status_code == 404
        row = store.get("h1", task["id"])
        assert row.state == "open" and row.claimed_by is None
        written = {r.event_type for r in client.app.state.audit.records(tenant="h2", limit=1000)}
        assert not written & {"task_created", "task_claimed", "task_done", "task_skipped", VITAL_SKIPPED}


def test_the_task_store_is_released_at_shutdown():
    closed = []
    store = InMemoryTaskStore()
    store.close = lambda: closed.append(True)
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, tasks=store)
    with TestClient(app):
        assert closed == []
    assert closed == [True]


def test_each_patient_carries_the_unit_and_bed_key_its_card_sits_on():
    """G4-02 (spec D4): the card keeps its unit and its bed key under `identity` (api/board.py
    `_bed_resolution`); `/tasks` reads them from there — a top-level field the card does not carry was
    always null. A card with no identity has neither. Synthetic patients and a synthetic bed map."""
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(patient_id="S-010", given="Sentetik", family="Hasta",
                                          unit="YB", room="304", bed="1", source="comed", updated_at=NOW))
    bedmap = BedMap.from_dict({"beds": {"YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"}}})
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, identities=identities,
                     bedmap=bedmap, tasks=InMemoryTaskStore(zones={"h1": "UTC"}))
    with TestClient(app) as c:
        _ingest(c, "S-010", "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
        _ingest(c, "S-011", "heart_rate", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
        board = {p["patient_id"]: p for p in c.get("/patients", headers=DEVICE).json()["patients"]}
        r = _tasks(c, DEVICE)
    assert r.status_code == 200, r.text
    cards = {p["patient_id"]: p for p in r.json()["patients"]}
    assert board["S-010"]["identity"]["unit_id"] == "unit-adult"            # the board resolved it
    assert cards["S-010"]["unit_id"] == "unit-adult"
    assert cards["S-010"]["bed_key"] == board["S-010"]["identity"]["bed_key"]
    assert cards["S-010"]["bed_key"] is not None
    assert board["S-011"]["identity"] is None                                 # a device-only card
    assert cards["S-011"]["unit_id"] is None and cards["S-011"]["bed_key"] is None


class TestADeviceReadingCountsForTheVitalTask:
    """G3-05 (spec D5, D15): overrides G3-02 D2 — the anchor is the last measurement of a NEWS2 input, whoever
    made it: the nurse by hand or the device."""

    def test_a_device_reading_is_the_anchor(self, client, store):
        at = datetime.now(timezone.utc) - timedelta(minutes=4)
        _ingest(client, "S-002", "spo2", 97, at)                         # admitted 20 h ago: late until now
        vital = _card(client, "S-002")["vital"]
        assert vital["anchor_at"] == at.isoformat() and vital["state"] == "plan"
        assert vital["entries"] == ([at.isoformat()] if at >= datetime.fromisoformat(_tasks(client).json()["shift"]["start"]) else [])

    def test_the_newest_of_a_hand_entry_and_a_device_reading_wins(self, client):
        now = datetime.now(timezone.utc)
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], now - timedelta(minutes=50))
        _ingest(client, "S-001", "heart_rate", 80, now - timedelta(minutes=10))
        assert _card(client, "S-001")["vital"]["anchor_at"] == (now - timedelta(minutes=10)).isoformat()
        _chart(client, "S-001", [{"code": "acvpu", "value": 0}], now - timedelta(minutes=2))
        assert _card(client, "S-001")["vital"]["anchor_at"] == (now - timedelta(minutes=2)).isoformat()

    def test_a_device_value_that_is_no_news2_input_is_not_an_anchor(self, client):
        _ingest(client, "S-003", "map", 80, datetime.now(timezone.utc) - timedelta(minutes=3))
        vital = _card(client, "S-003")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_withdrawn_device_reading_is_not_an_anchor(self, client):
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _ingest(client, "S-001", "map", 80, at)                          # keeps the card on the board
        _ingest(client, "S-001", "spo2", 97, at)
        entry = client.app.state.audit.records(tenant="h1", patient_id="S-001", event_type="ingest", limit=1, newest=True)[-1].id
        assert _card(client, "S-001")["vital"]["anchor_at"] == at.isoformat()
        r = client.post(f"/clinical/S-001/entries/{entry}/retract", json={"reason": "yanlış hastadan ölçüldü"}, headers=NURSE)
        assert r.status_code == 200, r.text
        vital = _card(client, "S-001")["vital"]
        assert vital["anchor_at"] is None and vital["state"] == "unknown"

    def test_a_device_reading_stamped_in_the_future_is_ignored(self, client):
        """The door's own skew is two minutes (BEDSIDE_SKEW): a device clock an hour fast anchors nothing."""
        now = datetime.now(timezone.utc)
        _ingest(client, "S-001", "spo2", 97, now + timedelta(hours=1))
        assert _card(client, "S-001")["vital"]["anchor_at"] is None
        _ingest(client, "S-001", "spo2", 96, now + timedelta(minutes=1))
        assert _card(client, "S-001")["vital"]["anchor_at"] == (now + timedelta(minutes=1)).isoformat()

    def test_after_a_device_round_the_task_resets_and_the_news2_is_partial(self, client):
        """Q4: the device sends no respiration rate and no consciousness — the timer resets all the same, and
        the answer says the score is partial until they are entered by hand."""
        at = datetime.now(timezone.utc) - timedelta(minutes=3)
        for code, value in (("spo2", 97), ("sbp", 122), ("heart_rate", 78), ("temperature", 36.8)):
            _ingest(client, "S-001", code, value, at)
        vital = _card(client, "S-001")["vital"]
        assert (vital["state"], vital["anchor_at"], vital["partial"]) == ("plan", at.isoformat(), True)

    def test_a_device_reading_ends_a_skip_as_a_hand_entry_does(self, client, store):
        store.save_settings("h1", DEFAULT_SETTINGS, by="admin", now=NOW)
        _ingest(client, "S-002", "map", 80, datetime.now(timezone.utc) - timedelta(minutes=30))   # on the board, late
        r = client.post("/tasks/vitals/S-002/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(client, "S-002")["vital"]["state"] == "skipped"
        _ingest(client, "S-002", "spo2", 97, datetime.now(timezone.utc))
        assert _card(client, "S-002")["vital"]["state"] == "plan"

    def test_skipping_reads_the_device_anchor_too(self, client):
        """The one-patient read (`hand_entries`) and the board's read agree: a patient the device has just
        measured has no vital task due, so there is nothing to skip."""
        _ingest(client, "S-002", "spo2", 97, datetime.now(timezone.utc) - timedelta(minutes=3))
        r = client.post("/tasks/vitals/S-002/skip", json={"reason": "hasta ameliyatta"}, headers=NURSE)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "vital_not_due"


class TestAWithdrawalNamesTheReadingNotOnlyOneRow:
    """G3-05 (B7 review): a device reading the trail holds TWICE (a `seen` that failed open; data from before it
    existed) is ONE reading, and a withdrawal that names either copy withdraws both — `rehydrate`'s rule, which the
    anchor reads through the same key. A hand entry is withdrawn by its own id alone."""

    AT_AGO = timedelta(minutes=5)

    def _world(self, values, *, code="spo2"):
        """An app over a trail of `code` readings at one instant — one `ingest` row per value, in order — and a
        device MAP that keeps the card on the board. Returns (app, the instant, the rows' ids)."""
        at = datetime.now(timezone.utc) - self.AT_AGO
        audit = InMemoryAuditLog()

        def row(kind, value):
            payload = {"value": value, "unit": "", "obs_ts": at.isoformat(), "device": "CONNEX-3A"}
            return audit.append(AuditEvent("h1", "ingest", "S-001", kind, payload)).id

        row("map", 80)
        ids = [row(code, value) for value in values]
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit,
                         tasks=InMemoryTaskStore(zones={"h1": "UTC"}))
        return app, at, ids

    @staticmethod
    def _withdraw(client, entry):
        r = client.post(f"/clinical/S-001/entries/{entry}/retract", json={"reason": "yanlış hastadan ölçüldü"},
                        headers=NURSE)
        assert r.status_code == 200, r.text

    @pytest.mark.parametrize("chosen", [0, 1])
    def test_two_identical_rows_one_withdrawn_neither_anchors(self, chosen):
        app, at, ids = self._world([97, 97])
        with TestClient(app) as c:
            vital = _card(c, "S-001")["vital"]
            assert vital["anchor_at"] == at.isoformat() and len(vital["entries"]) in (0, 2)   # both copies, before
            self._withdraw(c, ids[chosen])
            vital = _card(c, "S-001")["vital"]
            assert vital["anchor_at"] is None and vital["state"] == "unknown" and vital["entries"] == []

    def test_a_different_value_at_the_same_time_still_anchors(self):
        app, at, ids = self._world([97, 97, 96])
        with TestClient(app) as c:
            self._withdraw(c, ids[0])
            vital = _card(c, "S-001")["vital"]
            assert vital["anchor_at"] == at.isoformat() and vital["state"] == "plan"
            # one stamp, the 96's — neither copy of the 97 is left to count
            in_shift = at >= datetime.fromisoformat(_tasks(c).json()["shift"]["start"])
            assert vital["entries"] == ([at.isoformat()] if in_shift else [])

    def test_the_same_reading_of_another_patient_is_not_withdrawn(self):
        """The key names the patient: a withdrawal under S-001 takes nothing from S-002's identical reading."""
        app, at, ids = self._world([97])
        with TestClient(app) as c:
            _ingest(c, "S-002", "spo2", 97, at)
            self._withdraw(c, ids[0])
            assert _card(c, "S-001")["vital"]["anchor_at"] is None
            assert _card(c, "S-002")["vital"]["anchor_at"] == at.isoformat()

    def test_a_hand_entry_is_withdrawn_by_its_own_id_alone(self, client):
        """Two hand entries alike in code, time and value are two entries (G3-01 D12): the twin rule is the
        device's, and a withdrawal of one `chart` row leaves the other to anchor."""
        at = datetime.now(timezone.utc) - timedelta(minutes=5)
        _ingest(client, "S-001", "map", 80, at)                          # keeps the card on the board
        first = _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)["entries"][0]["entry"]
        _chart(client, "S-001", [{"code": "resp_rate", "value": 16}], at)
        r = client.post(f"/clinical/S-001/entries/{first}/retract", json={"reason": "yanlış hasta"}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(client, "S-001")["vital"]["anchor_at"] == at.isoformat()


def test_an_unmatched_reading_resets_nothing_until_it_is_linked():
    """D15: an unmatched reading writes no `ingest` row under a patient; linked, it counts at its own time."""
    from homunculus.api.readings import POLICY_UNMATCHED
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(patient_id="202600000001", given="Test", family="Hasta", source="kabul",
                                          unit_id="u-1", bed_id="b-1", updated_at=NOW))
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, identities=identities,
                     tasks=InMemoryTaskStore(zones={"h1": "UTC"}), unknown_readings=POLICY_UNMATCHED)
    with TestClient(app) as c:
        at = datetime.now(timezone.utc) - timedelta(minutes=6)
        _ingest(c, "202600000010", "spo2", 97, at)                       # a typo: listed
        assert _card(c, "202600000001")["vital"]["anchor_at"] is None
        [waiting] = c.get("/readings/unmatched", headers=NURSE).json()["sets"]
        ids = [v["id"] for v in waiting["readings"]]
        r = c.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": "202600000001"}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(c, "202600000001")["vital"]["anchor_at"] == at.isoformat()
