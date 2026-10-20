"""GET /patients/{id}/trends through HTTP: who may read it, what it answers, and what it never does.

`test_trends.py` fixes what the builder computes. These fix the door: the board's permission and the
board's scope check guard it, a window outside 6/24/72 is the caller's error in the reader's words,
a scope that cannot be read is 503 rather than "no such patient", an unknown id creates nothing, and
the read itself writes nothing to the audit. Synthetic ward only (`p-a1`…, units `unit-adult` /
`unit-nicu`), as tests/test_api_scope.py builds it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.board import _PUBLISHED_SIGNALS
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.auth.permissions import DEFAULT_GROUPS
from homunculus.scope import Scope, build_scope
from homunculus.scope.resolver import UNKNOWN
from homunculus.tenant.bedmap import BedMap

TOKEN = {"Authorization": "Bearer bridge-token"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
NURSE_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "nurse"))
BIOMED_PERMS = frozenset(next(g["permissions"] for g in DEFAULT_GROUPS if g["slug"] == "biomedical"))
ADULT = build_scope("NURSE", unit_ids=["unit-adult"])
WHOLE = build_scope("HOSPITAL_ADMIN")
BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"},
    "YB^304^2": {"bed_id": "bed-a2", "unit_id": "unit-adult"},
    "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu"},
}})


def _identities() -> InMemoryIdentityStore:
    store = InMemoryIdentityStore()
    for pid, unit, room, bed in (("p-a1", "YB", "304", "1"), ("p-a2", "YB", "304", "2"),
                                 ("p-n1", "YYB", "12", "A")):
        store.apply("demo", IdentityRecord(patient_id=pid, given="X", family="Y", unit=unit,
                                           room=room, bed=bed, source="comed",
                                           updated_at=datetime(2026, 10, 19, tzinfo=timezone.utc)))
    return store


def _app(scope: Scope = WHOLE, perms: frozenset[str] = NURSE_PERMS,
         looked_up: list[str] | None = None):
    """`looked_up`, when given, collects the credential of every scope look-up the app makes."""
    async def resolve_scope(credential: str) -> Scope:
        if looked_up is not None:
            looked_up.append(credential)
        return scope

    async def resolve_jwt(_credential: str) -> Caller:
        return Caller(hospital="demo", actor="nurse-1", groups=("nurse",), perms=perms)

    return create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                      identities=_identities(), bedmap=BEDMAP,
                      resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)


def _reading(client: TestClient, pid: str, code: str, value: float, minutes_ago: float = 10) -> None:
    """One reading through the bridge's credential, stamped relative to the real clock: the route
    cuts its window at the server's `now`."""
    at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    r = client.post("/ingest", headers=TOKEN, json={
        "resourceType": "Observation", "subject": {"reference": f"Patient/{pid}"},
        "effectiveDateTime": at.isoformat(), "code": {"coding": [{"code": code}]},
        "valueQuantity": {"value": value, "unit": "u"},
    })
    assert r.status_code == 200, r.text


def _rows(app, event_type: str | None = None) -> list:
    return [r for r in app.state.audit.records(tenant="demo", limit=10_000)
            if event_type is None or r.event_type == event_type]


def _channel(answer: dict, key: str) -> dict:
    return next(c for c in answer["channels"] if c["key"] == key)


@pytest.fixture
def ward():
    app = _app()
    with TestClient(app) as client:
        for pid in ("p-a1", "p-n1"):
            _reading(client, pid, "heart_rate", 84)
        yield app, client


class TestTheAnswer:
    def test_the_shape_and_the_channel_order(self, ward):
        _app, client = ward
        r = client.get("/patients/p-a1/trends", headers=TOKEN)
        assert r.status_code == 200, r.text
        answer = r.json()
        assert answer["hours"] == 24                                   # the default window
        assert [c["key"] for c in answer["channels"]] == list(_PUBLISHED_SIGNALS)
        assert (answer["bands_source"], answer["news2_scale"]) == ("news2-rcp-2017", 1)
        assert _channel(answer, "heart_rate")["latest"]["value"] == 84.0

    @pytest.mark.parametrize("hours", ["6", "24", "72"])
    def test_the_three_windows(self, ward, hours):
        _app, client = ward
        r = client.get(f"/patients/p-a1/trends?hours={hours}", headers=NURSE)
        assert (r.status_code, r.json()["hours"]) == (200, int(hours))

    def test_the_window_ends_at_the_servers_utc_now(self, ward):
        _app, client = ward
        before = datetime.now(timezone.utc)
        answer = client.get("/patients/p-a1/trends", headers=NURSE).json()
        after = datetime.now(timezone.utc)
        slack = timedelta(seconds=5)
        for key in ("since", "until", "generated_at"):
            assert answer[key].endswith("+00:00"), (key, answer[key])
        for key in ("until", "generated_at"):
            assert before - slack <= datetime.fromisoformat(answer[key]) <= after + slack, key
        assert (datetime.fromisoformat(answer["until"]) - datetime.fromisoformat(answer["since"])
                == timedelta(hours=24))

    def test_the_hours_reach_the_builder_a_ten_hour_old_reading_is_in_24_and_72_only(self, ward):
        _app, client = ward
        _reading(client, "p-a1", "spo2", 96, minutes_ago=600)
        seen = {h: len(_channel(client.get(f"/patients/p-a1/trends?hours={h}", headers=NURSE).json(),
                                "spo2")["points"])
                for h in (6, 24, 72)}
        assert seen == {6: 0, 24: 1, 72: 1}

    def test_bands_only_on_the_news2_channels(self, ward):
        _app, client = ward
        answer = client.get("/patients/p-a1/trends", headers=NURSE).json()
        assert [c["key"] for c in answer["channels"] if c["bands"]["news2"] is None] == ["map", "lactate"]

    def test_a_charted_normal_becomes_the_band_and_the_engines_judgement(self, ward):
        _app, client = ward
        r = client.put("/clinical/p-a1/profile", headers=TOKEN,
                       json={"baselines": {"heart_rate": {"low": 80, "high": 90}}})
        assert r.status_code == 200, r.text
        hr = _channel(client.get("/patients/p-a1/trends", headers=NURSE).json(), "heart_rate")
        assert hr["bands"]["own_normal"] == {"low": 80.0, "high": 90.0}
        assert hr["latest"]["within_own_normal"] is True

    def test_an_alarm_episode_is_a_marker(self, ward):
        _app, client = ward
        _reading(client, "p-a1", "spo2", 85, minutes_ago=5)           # NEWS2 3 on one parameter
        markers = client.get("/patients/p-a1/trends", headers=NURSE).json()["markers"]
        assert {"kind": "alarm", "label": "news2"} in [{k: m[k] for k in ("kind", "label")} for m in markers]

    def test_a_charted_dose_is_a_marker(self, ward):
        _app, client = ward
        r = client.post("/clinical/p-a1", headers=TOKEN,
                        json={"entries": [{"code": "antibiotic_administered", "value": 1}]})
        assert r.status_code == 200, r.text
        markers = client.get("/patients/p-a1/trends", headers=NURSE).json()["markers"]
        assert [m["kind"] for m in markers] == ["antibiotic"]

    def test_the_read_writes_nothing_to_the_audit(self, ward):
        app, client = ward
        before = len(_rows(app))
        for _ in range(3):
            assert client.get("/patients/p-a1/trends", headers=NURSE).status_code == 200
        assert len(_rows(app)) == before


class TestTheDoor:
    @pytest.mark.parametrize("hours", ["12", "0", "abc", "6.0", "-24", ""])
    def test_any_other_window_is_the_callers_error(self, ward, hours):
        _app, client = ward
        r = client.get(f"/patients/p-a1/trends?hours={hours}", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (400, "geçersiz hours: 6, 24 veya 72 olmalı")

    def test_no_credential_is_401(self, ward):
        _app, client = ward
        assert client.get("/patients/p-a1/trends").status_code == 401

    def test_without_board_view_it_is_403_before_the_scope_is_asked(self):
        # p-n1 is OUT of ADULT's scope: were the scope asked first, this would be 404 and a
        # scope_denied row. A patient in scope could not tell the two orders apart.
        app = _app(ADULT, perms=frozenset())
        with TestClient(app) as client:
            _reading(client, "p-n1", "heart_rate", 84)
            r = client.get("/patients/p-n1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert not _rows(app, "scope_denied")

    def test_without_board_view_an_unreadable_scope_is_still_403_not_503(self):
        app = _app(UNKNOWN, perms=frozenset())
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            r = client.get("/patients/p-a1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert not _rows(app, "scope_denied")

    def test_a_biomedical_caller_is_403_and_the_scope_is_never_looked_up(self):
        # devices.manage is a right of its own: it opens no patient, and the refusal comes before
        # any look-up of what the caller may see.
        looked_up: list[str] = []
        app = _app(WHOLE, perms=BIOMED_PERMS, looked_up=looked_up)
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            r = client.get("/patients/p-a1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")
        assert looked_up == []

    def test_the_scope_is_looked_up_once_per_read(self):
        # The chart polls every minute: a second look-up is doubled work, and a blip between the
        # two would turn a readable scope into a 404 for a patient who is in it.
        looked_up: list[str] = []
        app = _app(ADULT, looked_up=looked_up)
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            _reading(client, "p-n1", "heart_rate", 84)
            assert client.get("/patients/p-a1/trends", headers=NURSE).status_code == 200
            assert looked_up == ["nurse-jwt"]
            assert client.get("/patients/p-n1/trends", headers=NURSE).status_code == 404
            assert looked_up == ["nurse-jwt", "nurse-jwt"]

    def test_out_of_scope_is_404_like_an_unknown_id_and_is_audited(self):
        app = _app(ADULT)
        with TestClient(app) as client:
            _reading(client, "p-n1", "heart_rate", 84)
            r = client.get("/patients/p-n1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        [row] = _rows(app, "scope_denied")
        assert (row.patient_id, row.payload["actor"]) == ("p-n1", "nurse-1")

    def test_an_unknown_id_is_404_and_creates_nothing(self, ward):
        _app, client = ward
        r = client.get("/patients/ghost-1/trends", headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        board = client.get("/patients", headers=TOKEN).json()["patients"]
        assert "ghost-1" not in [p["patient_id"] for p in board]

    def test_an_unreadable_scope_is_503_not_a_missing_patient(self):
        app = _app(UNKNOWN)
        with TestClient(app) as client:
            _reading(client, "p-a1", "heart_rate", 84)
            refused = client.get("/patients/p-a1/trends", headers=NURSE)
            device = client.get("/patients/p-a1/trends", headers=TOKEN)
        assert (refused.status_code, refused.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert not _rows(app, "scope_denied")
        assert device.status_code == 200                               # the machine credential is unscoped

    def test_an_admitted_patient_with_no_reading_is_served_empty_and_stays_unmeasured(self, ward):
        _app, client = ward
        r = client.get("/patients/p-a2/trends", headers=NURSE)
        assert r.status_code == 200
        assert {c["key"]: c["points"] for c in r.json()["channels"]} == {k: [] for k in _PUBLISHED_SIGNALS}
        card = next(p for p in client.get("/patients", headers=TOKEN).json()["patients"]
                    if p["patient_id"] == "p-a2")
        assert card["latest"]["news2"] is None                          # still the identity-only card
