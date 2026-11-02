"""G3-01 (D8, X10): the preview scores what the chart door would chart — the card's own NEWS2 of a copy of
the patient's state with the entries added — and writes nothing. Synthetic patients and values only."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.clinical import AT_FUTURE, AT_TOO_OLD, MAP_NOT_BELOW_SBP
from homunculus.api.identity import Caller
from homunculus.rules.news2 import points_for

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
RISKY = [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 91}, {"code": "sbp", "value": 88}]
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}


async def _resolve(credential: str):
    return PEOPLE.get(credential)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve)
    with TestClient(app) as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _preview(client, entries, at=None, headers=AUTH, pid="bed-3"):
    body = {"entries": entries} | ({"recorded_at": at} if at else {})
    return client.post(f"/clinical/{pid}/preview", json=body, headers=headers)


def _chart(client, entries, at=None, pid="bed-3"):
    body = {"entries": entries} | ({"recorded_at": at} if at else {})
    return client.post(f"/clinical/{pid}", json=body, headers=AUTH)


def _patients(client):
    return client.get("/patients", headers=AUTH).json()["patients"]


def _card(client, pid="bed-3"):
    return next(p for p in _patients(client) if p["patient_id"] == pid)


class TestThePreview:
    def test_it_answers_the_cards_news2_for_the_entries(self, client):
        r = _preview(client, RISKY, at=_ago(5))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["preview"] is True
        news2 = body["news2"]
        assert news2["breakdown"]["respiration_rate"] == points_for("respiration_rate", 26)
        assert news2["partial"] is True and "pulse" in news2["missing"]

    def test_it_writes_nothing_and_creates_no_patient(self, client):
        before = len(client.app.state.audit.records(tenant="h1", limit=10_000))
        assert _preview(client, RISKY, at=_ago(5)).status_code == 200
        assert len(client.app.state.audit.records(tenant="h1", limit=10_000)) == before
        assert all(p["patient_id"] != "bed-3" for p in _patients(client))

    def test_it_leaves_a_measured_patient_as_it_was(self, client):
        assert _chart(client, [{"code": "heart_rate", "value": 80}], at=_ago(10)).status_code == 200
        card = _card(client)
        assert _preview(client, RISKY, at=_ago(5)).status_code == 200
        after = _card(client)
        assert after["latest"]["news2"]["breakdown"] == card["latest"]["news2"]["breakdown"]
        assert after["alerts"] == card["alerts"]

    def test_its_news2_is_the_cards_after_the_same_entries_are_saved(self, client):
        """D8's parity, by construction (X10): one function, one state, the same values at the same time."""
        at = _ago(5)
        preview = _preview(client, RISKY, at=at).json()["news2"]
        assert _chart(client, RISKY, at=at).status_code == 200
        card = _card(client)["latest"]["news2"]
        for key in ("total", "partial", "missing", "red_param", "breakdown", "stale", "assumed",
                    "measured_at", "fresh_until", "last_charted"):
            assert preview[key] == card[key], key

    def test_it_refuses_what_the_door_refuses(self, client):
        assert _preview(client, [{"code": "heart_rate", "value": 301}]).status_code == 400
        r = _preview(client, [{"code": "sbp", "value": 90}, {"code": "map", "value": 95}])
        assert (r.status_code, r.json()["detail"]) == (400, MAP_NOT_BELOW_SBP)
        assert _preview(client, []).status_code == 400

    def test_it_refuses_a_json_boolean_as_the_door_does(self, client):
        """Task 1's review: a bool is an int in Python, and a `true` heart rate would score as 1 bpm. The
        preview parses with the door's own `build_entries`, so it must refuse it with the door's words."""
        entries = [{"code": "heart_rate", "value": True}]
        door, preview = _chart(client, entries), _preview(client, entries)
        assert (preview.status_code, preview.json()["detail"]) == (door.status_code, door.json()["detail"])
        assert preview.status_code == 400

    def test_it_compares_a_repeated_code_at_its_worst_as_the_door_does(self, client):
        entries = [{"code": "map", "value": 95}, {"code": "map", "value": 60}, {"code": "sbp", "value": 90}]
        door, preview = _chart(client, entries), _preview(client, entries)
        assert (preview.status_code, preview.json()["detail"]) == (400, MAP_NOT_BELOW_SBP)
        assert preview.json() == door.json()

    @pytest.mark.parametrize("minutes, detail", [(25 * 60, AT_TOO_OLD), (-30, AT_FUTURE)])
    def test_it_holds_the_doors_time_bound(self, client, minutes, detail):
        r = _preview(client, RISKY, at=_ago(minutes))
        assert (r.status_code, r.json()["detail"]) == (400, detail)

    def test_it_needs_a_credential_and_the_chart_permission(self, client):
        assert client.post("/clinical/bed-3/preview", json={"entries": RISKY}).status_code == 401
        assert _preview(client, RISKY, headers=VIEWER).status_code == 403
        assert _preview(client, RISKY, headers=NURSE).status_code == 200

    def test_a_discharged_number_is_dropped_as_the_door_drops_it(self):
        from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
        store = InMemoryIdentityStore()
        store.apply("h1", IdentityRecord(patient_id="bed-9", state="discharged", source=KABUL,
                                         updated_at=datetime.now(timezone.utc)))
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, identities=store)
        with TestClient(app) as c:
            r = c.post("/clinical/bed-9/preview", json={"entries": RISKY}, headers=AUTH)
            assert r.status_code == 200, r.text
            assert r.json()["dropped"] == "discharged" and "news2" not in r.json()
