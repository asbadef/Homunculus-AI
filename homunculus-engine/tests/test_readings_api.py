# homunculus-engine/tests/test_readings_api.py
"""G3-05 (spec D10–D12, §4): the unmatched list and its two actions against the DB-less app — who may, who sees
what, every refusal, a linked reading entering the real engine at its own time with the device as its source, a
claim released when the write fails, and a restart replaying the same picture. Synthetic numbers and values only
(CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    LIST_MAX, POLICY_UNMATCHED, READING_ASSIGNED, READING_NEEDS_PERSON, READING_REJECTED, REASON_UNKNOWN,
    STATE_ASSIGNED, STATE_REJECTED, STATE_UNMATCHED, device_reading,
)
from homunculus.canonical import Observation, SignalCode
from homunculus.scope import Scope, ScopeReason
from homunculus.scope.resolver import UNKNOWN as UNKNOWN_SCOPE
from tests.test_ingest_apply import IMMEDIATE, obs
from tests.test_readings_ingest import _Flaky

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}            # unscoped here: no resolver names her
WARD1 = {"Authorization": "Bearer ward1-jwt"}            # scoped to unit u-1
WARD2 = {"Authorization": "Bearer ward2-jwt"}            # scoped to unit u-2
BLIP = {"Authorization": "Bearer blip-jwt"}              # a scope that cannot be read
VIEWER = {"Authorization": "Bearer viewer-jwt"}
CHART = frozenset({"board.view", "clinical.chart"})
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",), perms=CHART),
    "ward1-jwt": Caller(hospital="h1", actor="hem.leyla", groups=("nurse",), perms=CHART),
    "ward2-jwt": Caller(hospital="h1", actor="hem.zeynep", groups=("nurse",), perms=CHART),
    "blip-jwt": Caller(hospital="h1", actor="hem.nur", groups=("nurse",), perms=CHART),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}
SCOPES = {
    "ward1-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"u-1"})),
    "ward2-jwt": Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"u-2"})),
    "blip-jwt": UNKNOWN_SCOPE,
}
KEY, OTHER, GONE, TYPO = "202600000001", "202600000002", "202600000003", "202600000010"
ADMISSION = "11111111-1111-4111-8111-111111111111"       # a synthetic admission id
WHEN = datetime.now(timezone.utc) - timedelta(minutes=30)
WEEK = WHEN - timedelta(days=7)
WHY = "yanlış numara girilmiş, hasta bulunamadı"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


async def _resolve_scope(credential: str) -> Scope:
    return SCOPES.get(credential, Scope(True, ScopeReason.UNRESTRICTED_ROLE))


class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once — the database going away mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


class _Counting(InMemoryIdentityStore):
    """An identity store that remembers every key it was asked for."""

    def __init__(self):
        super().__init__()
        self.reads: list[str] = []

    def get(self, tenant, patient_id):
        self.reads.append(patient_id)
        return super().get(tenant, patient_id)


def _identities(store: InMemoryIdentityStore | None = None) -> InMemoryIdentityStore:
    """KEY admitted in unit u-1, OTHER admitted in unit u-2, GONE discharged from unit u-1 (a tombstone)."""
    store = store if store is not None else InMemoryIdentityStore()
    for key, unit, state in ((KEY, "u-1", "admitted"), (OTHER, "u-2", "admitted"), (GONE, "u-1", "discharged")):
        store.apply("h1", IdentityRecord(key, family="Hasta", given="Test", state=state, source=KABUL,
                                         unit_id=unit, bed_id=f"b-{key[-1]}", updated_at=WHEN - timedelta(hours=3)))
    return store


def _app(audit=None, store=None, identities=None):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else _Flaky(admitted={("h1", KEY): ADMISSION})
    identities = identities if identities is not None else _identities()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, resolve_scope=_resolve_scope,
                     audit=audit, identities=identities, readings=store, unknown_readings=POLICY_UNMATCHED)
    return app, store, audit


@pytest.fixture()
def world():
    app, store, audit = _app()
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, store, audit


def _send(client, pairs, key=TYPO, when=WHEN, device="CONNEX-3A"):
    """Device readings the door lists: one set (one number, one device, one time)."""
    for code, value in pairs:
        r = client.post("/ingest", json=obs(code, value, key, when, device=device), headers=DEVICE)
        assert r.status_code == 200 and "dropped" in r.json(), r.text


def _list(client, headers=NURSE):
    r = client.get("/readings/unmatched", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(client, key=TYPO, headers=NURSE):
    """The ids of every waiting reading under `key`, ascending — the order the two actions answer them in."""
    return sorted(reading["id"] for s in _list(client, headers)["sets"] if s["received_key"] == key
                  for reading in s["readings"])


def _assign(client, ids, patient=KEY, headers=NURSE):
    return client.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": patient}, headers=headers)


def _reject(client, ids, reason=WHY, headers=NURSE):
    return client.post("/readings/unmatched/reject", json={"readings": ids, "reason": reason}, headers=headers)


def _code(r):
    detail = r.json()["detail"]
    return detail["code"] if isinstance(detail, dict) else detail


def _card(client, key=KEY):
    return next(p for p in client.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == key)


def _firing(card) -> list[str]:
    """The alerts firing now: every alert on the card carries `resolved_at`, None while its rule fires."""
    return sorted(a["kind"] for a in card["alerts"] if a["resolved_at"] is None)


def _ago(**span) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**span)


def _chart(client, entries, at, key=KEY):
    r = client.post(f"/clinical/{key}", json={"entries": entries, "recorded_at": at.isoformat()}, headers=NURSE)
    assert r.status_code == 200, r.text


def _overdue(client, key=KEY):
    """An overdue antibiotic on `key`: suspected infection with platelets 120 is SOFA 1; a MAP of 60 charted 90
    minutes ago makes it sepsis then, which starts the antibiotic hour; a temperature charted now finds the hour
    gone with no antibiotic given — `antibiotic_overdue` (tests/test_bedside_retract.py `_overdue`)."""
    _chart(client, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
           _ago(minutes=90), key)
    _chart(client, [{"code": "map", "value": 60}], _ago(minutes=90), key)
    _chart(client, [{"code": "temperature", "value": 37.0}], _ago(minutes=5), key)
    assert "antibiotic_overdue" in _firing(_card(client, key))


class TestWhoMay:
    ROUTES = [("GET", "/readings/unmatched"), ("POST", "/readings/unmatched/assign"), ("POST", "/readings/unmatched/reject")]

    @pytest.mark.parametrize("method,path", ROUTES)
    def test_no_credential_is_401(self, world, method, path):
        client, _, _ = world
        assert client.request(method, path, **({"json": {}} if method == "POST" else {})).status_code == 401

    @pytest.mark.parametrize("method,path", ROUTES)
    def test_the_chart_permission_is_needed(self, world, method, path):
        client, _, _ = world
        r = client.request(method, path, headers=VIEWER, **({"json": {}} if method == "POST" else {}))
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: clinical.chart")

    @pytest.mark.parametrize("method,path", ROUTES)
    def test_a_device_token_is_refused(self, world, method, path):
        """D10: a person only — the bridge's token names nobody, and the list is a person's work."""
        client, _, _ = world
        r = client.request(method, path, headers=DEVICE, **({"json": {}} if method == "POST" else {}))
        assert (r.status_code, r.json()["detail"]) == (403, READING_NEEDS_PERSON)


class TestTheList:
    def test_an_empty_list(self, world):
        client, _, _ = world
        assert _list(client) == {"count": 0, "sets": []}

    def test_readings_are_grouped_into_sets_newest_arrival_first(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97), ("heart_rate", 88)], key=TYPO, when=WHEN)
        _send(client, [("temperature", 37.2)], key=GONE, when=WHEN + timedelta(minutes=1))
        body = _list(client)
        assert body["count"] == 2 and [s["received_key"] for s in body["sets"]] == [GONE, TYPO]
        late, early = body["sets"]
        assert (late["reason"], early["reason"]) == ("discharged", "unknown")
        assert (early["source"], early["observed_at"], early["linkable"]) == ("CONNEX-3A", WHEN.isoformat(), True)
        assert early["received_at"] >= early["observed_at"]
        assert [(r["code"], r["value"], r["unit"]) for r in early["readings"]] == [("heart_rate", 88.0, "u"), ("spo2", 97.0, "u")]
        assert all(isinstance(r["id"], int) and sorted(r) == ["code", "id", "unit", "value"] for r in early["readings"])
        assert sorted(early) == ["linkable", "observed_at", "readings", "reason", "received_at", "received_key", "source"]

    def test_another_device_or_another_time_is_another_set(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        _send(client, [("spo2", 96)], when=WHEN, device="CONNEX-3B")
        _send(client, [("spo2", 95)], when=WHEN + timedelta(minutes=10))
        assert _list(client)["count"] == 3

    def test_a_reading_older_than_a_day_is_listed_but_not_linkable(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN - timedelta(hours=25))
        [old] = _list(client)["sets"]
        assert old["linkable"] is False

    def test_a_reading_that_arrived_more_than_seven_days_ago_is_off_the_list(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        [row] = store.unmatched("h1", since=WEEK)
        from dataclasses import replace
        store._rows[row.id] = replace(row, received_at=row.received_at - timedelta(days=8))
        assert _list(client) == {"count": 0, "sets": []}

    @staticmethod
    def _fill(store, sets: int) -> None:
        """`sets` waiting sets under one number, one per second of measurement and of arrival — the newest first is
        index 0 (a monitor left on a discharged number lists a set per round)."""
        arrived = datetime.now(timezone.utc)
        for i in range(sets):
            reading = Observation(patient_id=TYPO, code=SignalCode.SPO2, value=90.0 + i % 10, unit="u",
                                  timestamp=WHEN - timedelta(seconds=i), source_device="CONNEX-3A")
            assert store.add(device_reading("h1", reading, received_at=arrived - timedelta(seconds=i),
                                            audit_id=1000 + i, reason=REASON_UNKNOWN)) is not None

    def test_the_list_is_capped_at_the_newest_sets_and_says_so(self, world):
        """B6 review: LIST_MAX sets, the newest arrivals; `count` is the true number and `truncated` says the
        answer is short of them."""
        client, store, _ = world
        self._fill(store, LIST_MAX + 1)
        body = _list(client)
        assert (body["count"], len(body["sets"]), body["truncated"]) == (LIST_MAX + 1, LIST_MAX, True)
        assert body["sets"][0]["observed_at"] == WHEN.isoformat()
        kept = {s["observed_at"] for s in body["sets"]}
        assert (WHEN - timedelta(seconds=LIST_MAX)).isoformat() not in kept          # the oldest one is the one cut
        assert (WHEN - timedelta(seconds=LIST_MAX - 1)).isoformat() in kept

    def test_a_list_of_exactly_the_cap_is_not_truncated(self, world):
        client, store, _ = world
        self._fill(store, LIST_MAX)
        body = _list(client)
        assert (body["count"], len(body["sets"])) == (LIST_MAX, LIST_MAX) and "truncated" not in body


class TestWhoSeesWhat:
    def test_an_unknown_number_is_everybodys(self, world):
        """D11: a set under an unknown number has no patient — hidden from scoped users it would never be worked."""
        client, _, _ = world
        _send(client, [("spo2", 97)], key=TYPO)
        for headers in (NURSE, WARD1, WARD2):
            assert [s["received_key"] for s in _list(client, headers)["sets"]] == [TYPO]

    def test_a_discharged_number_is_shown_where_the_scope_reaches_its_last_unit(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], key=GONE)                          # GONE lay in u-1
        assert _list(client, WARD1)["count"] == 1 and _list(client, NURSE)["count"] == 1
        assert _list(client, WARD2) == {"count": 0, "sets": []}

    def test_a_set_the_caller_cannot_see_cannot_be_linked_or_rejected_by_id(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)], key=GONE)
        ids = _ids(client, GONE)
        assert (_assign(client, ids, OTHER, WARD2).status_code, _code(_assign(client, ids, OTHER, WARD2))) == (409, "reading_not_unmatched")
        assert _code(_reject(client, ids, headers=WARD2)) == "reading_not_unmatched"
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_scope_that_cannot_be_read_is_503_not_an_empty_list(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        r = client.get("/readings/unmatched", headers=BLIP)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")

    def test_a_scope_that_cannot_be_read_is_503_on_assign_and_on_reject_and_nothing_is_claimed(self, world):
        client, store, audit = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        for r in (_assign(client, ids, KEY, BLIP), _reject(client, ids, headers=BLIP)):
            assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED
        assert audit.records(tenant="h1", event_type="scope_denied", limit=10) == []     # a blip is no violation

    def test_a_scoped_user_whose_unit_was_the_discharged_patients_last_unit_can_link_that_set(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)], key=GONE)                                    # GONE lay in u-1
        ids = _ids(client, GONE, WARD1)
        assert ids and _ids(client, GONE, WARD2) == []
        r = _assign(client, ids, KEY, WARD1)                                       # KEY lies in u-1 too
        assert r.status_code == 200, r.text
        assert [row.state for row in store.get("h1", ids)] == [STATE_ASSIGNED]

    def test_a_scoped_user_whose_unit_was_the_discharged_patients_last_unit_can_reject_that_set(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)], key=GONE)
        ids = _ids(client, GONE, WARD1)
        assert _reject(client, ids, headers=WARD1).status_code == 200
        assert [row.state for row in store.get("h1", ids)] == [STATE_REJECTED]

    def test_the_visibility_of_a_number_is_decided_once_per_request(self):
        """B6 review: the decision for a discharged number is an identity read (a SELECT and a decrypt on the event
        loop). Many rows under one number cost one read — in the list, and in the two actions."""
        identities = _identities(_Counting())
        app, store, _ = _app(identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            for minute in range(3):
                _send(client, [("spo2", 97), ("heart_rate", 88)], key=GONE, when=WHEN + timedelta(minutes=minute))
            identities.reads.clear()
            assert _list(client, WARD1)["count"] == 3
            assert identities.reads.count(GONE) == 1
            [first, *_] = _list(client, WARD1)["sets"]
            identities.reads.clear()
            assert _reject(client, [x["id"] for x in first["readings"]], headers=WARD1).status_code == 200
            assert identities.reads.count(GONE) == 1                     # two rows of the set, one read


class TestLinking:
    def test_a_linked_set_enters_the_engine_at_its_own_time_with_the_device_as_its_source(self, world):
        client, store, audit = world
        _send(client, IMMEDIATE)
        ids = _ids(client)
        queue = client.app.state.broadcaster.subscribe("h1")
        r = _assign(client, ids)
        assert r.status_code == 200, r.text
        assert r.json() == {"assigned": ids, "patient_id": KEY, "alerts": ["news2"]}
        # the engine: every value, at the measurement's own time, from the device — never «elle»
        state = client.app.state.board_link._engine("h1").state(KEY)
        for code, value in IMMEDIATE:
            [point] = state.history(SignalCode(code))
            assert (point.value, point.timestamp, point.source_device) == (float(value), WHEN, "CONNEX-3A")
        # … so the card scores exactly as if the device had sent the set under the right number
        card = _card(client)
        direct, _, _ = _app()
        with TestClient(direct) as other:
            for code, value in IMMEDIATE:
                assert "alerts" in other.post("/ingest", json=obs(code, value, KEY, WHEN), headers=DEVICE).json()
            want = _card(other)
        assert card["latest"]["news2"] == want["latest"]["news2"]
        assert [a["kind"] for a in card["alerts"]] == [a["kind"] for a in want["alerts"]] == ["news2"]
        assert not queue.empty()                                         # the card's frame went out
        # the trail: ordinary `ingest` rows under the patient, each naming its reading, then one row for the set
        rows = audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=100)
        assert sorted(row.payload["reading"] for row in rows) == ids
        assert all(row.payload["device"] == "CONNEX-3A" and row.payload["obs_ts"] == WHEN.isoformat() for row in rows)
        assert len(audit.records(tenant="h1", patient_id=KEY, event_type="notification", limit=10)) == 1
        [linked] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
        assert (linked.patient_id, linked.subject) == (KEY, "reading")
        assert linked.payload == {"readings": ids, "received_key": TYPO, "reason": "unknown", "device": "CONNEX-3A",
                                  "obs_ts": WHEN.isoformat(), "actor": "hem.ayse"}
        # the table: filed under the patient and the stay, the number as typed kept
        by_entry = {row.payload["reading"]: row.id for row in rows}
        for row in store.get("h1", ids):
            assert (row.state, row.patient_key, row.received_key, row.admission_id) == (STATE_ASSIGNED, KEY, TYPO, ADMISSION)
            assert (row.entry_id, row.resolved_by) == (by_entry[row.id], "hem.ayse")
        assert _list(client) == {"count": 0, "sets": []}

    def test_a_double_link_is_409(self, world):
        client, _, audit = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        assert _assign(client, ids).status_code == 200
        again = _assign(client, ids)
        assert (again.status_code, _code(again)) == (409, "reading_not_unmatched")
        assert len(audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)) == 1

    def test_an_unknown_id_is_409_and_claims_nothing(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids + [ids[0] + 999])
        assert (r.status_code, _code(r)) == (409, "reading_not_unmatched")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_ids_of_two_sets_are_422(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        _send(client, [("spo2", 96)], when=WHEN + timedelta(minutes=10))
        ids = _ids(client)
        r = _assign(client, ids)
        assert (r.status_code, _code(r)) == (422, "reading_set_mixed")
        assert all(row.state == STATE_UNMATCHED for row in store.get("h1", ids))

    def test_a_reading_older_than_24_hours_cannot_be_linked_only_rejected(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN - timedelta(hours=25))
        ids = _ids(client)
        r = _assign(client, ids)
        assert (r.status_code, _code(r)) == (409, "reading_too_old")
        assert _reject(client, ids).status_code == 200

    def test_a_discharged_target_is_409(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids, GONE)
        assert (r.status_code, _code(r)) == (409, "reading_target_discharged")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_target_out_of_scope_is_404_and_audited(self, world):
        client, _, audit = world
        _send(client, [("spo2", 97)])
        r = _assign(client, _ids(client, headers=WARD1), OTHER, WARD1)   # OTHER lies in u-2
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert len(audit.records(tenant="h1", patient_id=OTHER, event_type="scope_denied", limit=10)) == 1

    def test_a_target_nobody_is_admitted_under_is_404_and_makes_no_card(self, world):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids, "202600000099")
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert "202600000099" not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    @pytest.mark.parametrize("body", [
        {}, {"readings": [], "patient_id": KEY}, {"readings": "1", "patient_id": KEY}, {"readings": [True], "patient_id": KEY},
        {"readings": [1.5], "patient_id": KEY}, {"readings": [1, 1], "patient_id": KEY}, {"readings": list(range(1, 52)), "patient_id": KEY},
        {"readings": [1]}, {"readings": [1], "patient_id": ""}, {"readings": [1], "patient_id": 7},
        {"readings": [0], "patient_id": KEY}, {"readings": [-1], "patient_id": KEY},
        {"readings": [2**63], "patient_id": KEY}, {"readings": [10**30], "patient_id": KEY},
    ])
    def test_a_malformed_body_is_422(self, world, body):
        client, _, _ = world
        assert client.post("/readings/unmatched/assign", json=body, headers=NURSE).status_code == 422

    def test_an_id_past_a_64_bit_integer_is_422_and_the_largest_one_names_no_reading(self, world):
        """B6 review: an id the table cannot hold is a malformed body (422), never a 500 from the database; the
        largest it can hold is merely not waiting (409)."""
        client, _, _ = world
        for path, extra in (("assign", {"patient_id": KEY}), ("reject", {"reason": WHY})):
            r = client.post(f"/readings/unmatched/{path}", json={"readings": [2**63], **extra}, headers=NURSE)
            assert r.status_code == 422, path
            r = client.post(f"/readings/unmatched/{path}", json={"readings": [2**63 - 1], **extra}, headers=NURSE)
            assert (r.status_code, _code(r)) == (409, "reading_not_unmatched"), path

    def test_a_scoped_nurse_links_to_her_own_patient(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        assert _assign(client, _ids(client, headers=WARD1), KEY, WARD1).status_code == 200

    def test_a_target_the_engine_has_measured_but_no_identity_names_can_be_linked(self, world):
        """E-5, the positive path: «an identity record or a patient the engine has measured». A bedside value
        charted for a number nobody admitted puts it on the board; a reading may then be linked to it. The reading
        carries no stay (no admission record), and the link makes no second card."""
        client, store, _ = world
        nobody = "202600000077"
        _chart(client, [{"code": "heart_rate", "value": 80}], _ago(minutes=20), nobody)
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids, nobody)
        assert r.status_code == 200, r.text
        [row] = store.get("h1", ids)
        assert (row.state, row.patient_key, row.admission_id) == (STATE_ASSIGNED, nobody, None)
        patients = [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
        assert patients.count(nobody) == 1

    def test_a_first_reading_whose_write_fails_stays_claimed_and_the_rest_go_back_to_be_linked_by_a_retry(self):
        """The first reading's `ingest` append fails — nothing reached the audit trail for it, but the engine took
        the value already (`apply` evaluates before it writes). That reading, the one in progress, stays CLAIMED
        for `reconcile` (B10) to decide (B3 review); the one not yet attempted goes back to the list, and a retry
        of it links."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97), ("heart_rate", 88)])             # attempted in id order: spo2, heart_rate
            ids = _ids(client)
            audit.fail_on = "ingest"
            assert _assign(client, ids).status_code == 500
            states = {row.code: row for row in store.get("h1", ids)}
            assert states["spo2"].state == STATE_ASSIGNED and states["spo2"].patient_key is None
            assert states["spo2"].resolved_by == "hem.ayse"              # a claim: owned, not yet filed
            assert states["heart_rate"].state == STATE_UNMATCHED and states["heart_rate"].resolved_by is None
            [still] = _list(client)["sets"][0]["readings"]               # the set, short of the claimed reading
            assert (_list(client)["count"], still["code"]) == (1, "heart_rate")
            assert _assign(client, [still["id"]]).status_code == 200
            assert store.get("h1", [still["id"]])[0].state == STATE_ASSIGNED

    def test_a_raise_mid_set_keeps_the_reading_in_progress_claimed_and_releases_the_rest(self):
        """B3 review, change 1: the second reading's `ingest` row was written but a later append (its alert) fails —
        the engine holds it and the audit trail names it. It is NOT released (released, a retry or a link elsewhere
        would write a second `ingest` row for it): it stays claimed, `patient_key` None, for `reconcile` to finish
        from its `ingest` row. The first reading, applied and finalized, stays linked; the third, never attempted,
        goes back to the list. The answer is 500."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 140), ("resp_rate", 30), ("spo2", 88)])    # attempted in id order
            ids = _ids(client)
            assert [row.code for row in store.get("h1", ids)] == ["heart_rate", "resp_rate", "spo2"]
            seen = {"n": 0}
            plain = audit.append

            def append(event):
                if event.event_type == "ingest":
                    seen["n"] += 1
                elif seen["n"] == 2 and event.event_type != READING_ASSIGNED:   # a later append of the SECOND reading
                    raise RuntimeError("audit down")
                return plain(event)
            audit.append = append
            r = _assign(client, ids)
            audit.append = plain
            assert r.status_code == 500
            assert seen["n"] == 2                                        # the third reading was never attempted
            states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
            assert states == {"heart_rate": (STATE_ASSIGNED, KEY),       # applied and finalized: stays linked
                              "resp_rate": (STATE_ASSIGNED, None),       # in progress: stays claimed
                              "spo2": (STATE_UNMATCHED, None)}           # not yet attempted: back on the list
            assert [x["code"] for s in _list(client)["sets"] for x in s["readings"]] == ["spo2"]
            # its `ingest` row is there, naming it: `reconcile` finalizes the claim from it, never a second row
            [row] = [e for e in audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)
                     if e.subject == "resp_rate"]
            assert row.payload["reading"] == next(x.id for x in store.get("h1", ids) if x.code == "resp_rate")
            # B6 review: the part that DID go in is audited — one `reading_assigned` row naming only the linked
            # reading (not the claimed one, not the released one), by whom, under the patient
            [linked] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
            by_code = {x.code: x.id for x in store.get("h1", ids)}
            assert (linked.patient_id, linked.subject) == (KEY, "reading")
            assert linked.payload == {"readings": [by_code["heart_rate"]], "received_key": TYPO, "reason": "unknown",
                                      "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(), "actor": "hem.ayse"}

    def test_a_raise_with_no_reading_linked_writes_no_assigned_row(self):
        """Nothing went in (the first reading is the one in progress): there is no part of the set to audit."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97), ("heart_rate", 88)])
            audit.fail_on = "ingest"
            assert _assign(client, _ids(client)).status_code == 500
            assert audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10) == []

    def test_a_failing_audit_of_the_linked_part_changes_no_answer_after_a_raise(self):
        """B6 review: the partial row is best effort. The audit being down is why the link raised, and the append of
        the row may fail too: the answer is still the original 500, nothing else is raised, and the claims stand."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 140), ("resp_rate", 30), ("spo2", 88)])
            ids = _ids(client)
            seen = {"n": 0}
            plain = audit.append

            def append(event):
                if event.event_type == "ingest":
                    seen["n"] += 1
                elif seen["n"] == 2:                                     # every later append fails, the row too
                    raise RuntimeError("audit down")
                return plain(event)
            audit.append = append
            r = _assign(client, ids)
            audit.append = plain
            assert r.status_code == 500
            assert audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10) == []
            states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
            assert states == {"heart_rate": (STATE_ASSIGNED, KEY), "resp_rate": (STATE_ASSIGNED, None),
                              "spo2": (STATE_UNMATCHED, None)}

    def test_a_reading_the_engine_took_is_never_released(self):
        """The second reading's `ingest` append fails: the first is in the engine and stays claimed and linked;
        the one IN PROGRESS stays claimed (`assigned`, `patient_key` None — `reconcile` finalizes it from its
        `ingest` row, or releases it after CLAIM_STALE: the engine may hold it already); only the reading not
        yet attempted goes back to the list."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 88)])
            first = _ids(client)
            assert _assign(client, first).status_code == 200             # … so the next `ingest` append is a later one
            _send(client, [("spo2", 97), ("temperature", 37.2), ("resp_rate", 16)], when=WHEN + timedelta(minutes=1))
            ids = _ids(client)

            seen = {"n": 0}
            plain = audit.append

            def append(event):
                if event.event_type == "ingest":
                    seen["n"] += 1
                    if seen["n"] == 2:
                        raise RuntimeError("audit down")
                return plain(event)
            audit.append = append
            assert _assign(client, ids).status_code == 500
            audit.append = plain
            states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
            # attempt order is by id: spo2, temperature, resp_rate. The second `ingest` append (temperature) fails.
            assert states == {"spo2": (STATE_ASSIGNED, KEY),
                              "temperature": (STATE_ASSIGNED, None),       # in progress: stays claimed
                              "resp_rate": (STATE_UNMATCHED, None)}        # not yet attempted: released
            assert [x["code"] for s in _list(client)["sets"] for x in s["readings"]] == ["resp_rate"]

    def test_a_restart_replays_the_same_picture(self):
        audit, store = InMemoryAuditLog(), _Flaky(admitted={("h1", KEY): ADMISSION})
        first, _, _ = _app(audit=audit, store=store)
        with TestClient(first) as client:
            _send(client, IMMEDIATE)
            assert _assign(client, _ids(client)).status_code == 200
            live = _card(client)
        second, _, _ = _app(audit=audit, store=store)
        with TestClient(second) as client:
            again = _card(client)
            assert again["latest"]["news2"] == live["latest"]["news2"]
            assert [(a["kind"], a["severity"]) for a in again["alerts"]] == [(a["kind"], a["severity"]) for a in live["alerts"]]
            assert TYPO not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
            assert _list(client) == {"count": 0, "sets": []}

    @pytest.mark.parametrize("acknowledged", [False, True], ids=["unacknowledged", "acknowledged"])
    def test_a_back_dated_link_is_judged_now_and_leaves_an_overdue_antibiotic_overdue(self, acknowledged):
        """B6 review: every link is back-dated (up to 24 h). Judged at its measurement, a linked SpO2 from six hours
        ago would have replaced the `antibiotic_overdue` with an `antibiotic_due` (the hour running again — false
        reassurance) and, acknowledged, ended its episode. A link is judged at the wall clock; the value keeps its
        own time. A restart agrees: the replay judges a linked `ingest` row where the link did."""
        audit, store, identities = InMemoryAuditLog(), _Flaky(admitted={("h1", KEY): ADMISSION}), _identities()
        first, _, _ = _app(audit=audit, store=store, identities=identities)
        with TestClient(first) as client:
            _overdue(client)
            if acknowledged:
                acked = client.post("/ack", json={"patient_id": KEY, "kind": "antibiotic_overdue", "role": "nurse"},
                                    headers=DEVICE)
                assert acked.status_code == 200, acked.text
            cleared = len(audit.records(tenant="h1", patient_id=KEY, event_type="alert_cleared", limit=100))
            then = _ago(hours=6)
            _send(client, [("spo2", 97)], when=then)
            assert _assign(client, _ids(client)).status_code == 200
            live = _firing(_card(client))
            assert "antibiotic_overdue" in live and "antibiotic_due" not in live
            assert len(audit.records(tenant="h1", patient_id=KEY, event_type="alert_cleared", limit=100)) == cleared
            [point] = client.app.state.board_link._engine("h1").state(KEY).history(SignalCode("spo2"))
            assert point.timestamp == then                               # judged now, kept at its own time
            [row] = audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)
            assert row.payload["obs_ts"] == then.isoformat()             # … and audited at it
        second, _, _ = _app(audit=audit, store=store, identities=identities)
        with TestClient(second) as client:
            again = _firing(_card(client))
            assert "antibiotic_overdue" in again and "antibiotic_due" not in again

    def test_a_stale_linked_set_does_not_score_by_itself_but_a_fresh_one_does(self, world):
        """B6 review: judged now, a linked set measured six hours ago is stale for NEWS2's freshness and raises
        nothing on its own; the same set measured ten minutes ago counts."""
        client, _, _ = world
        old = _ago(hours=6)
        _send(client, IMMEDIATE, when=old)
        r = _assign(client, _ids(client))
        assert r.status_code == 200 and r.json()["alerts"] == []
        assert _firing(_card(client)) == []
        state = client.app.state.board_link._engine("h1").state(KEY)
        for code, _ in IMMEDIATE:
            [point] = state.history(SignalCode(code))
            assert point.timestamp == old                                # stored at its own time all the same
        _send(client, IMMEDIATE, when=_ago(minutes=10))
        r = _assign(client, _ids(client))
        assert r.status_code == 200 and r.json()["alerts"] == ["news2"]
        assert _firing(_card(client)) == ["news2"]

    def test_the_door_still_judges_a_back_dated_reading_at_its_own_time(self, world):
        """B6 review: only the link changed. The same set the test above links and finds stale is, sent to `/ingest`
        by the device, judged at the time it was measured, as ever."""
        client, _, _ = world
        old = _ago(hours=6)
        for code, value in IMMEDIATE:
            r = client.post("/ingest", json=obs(code, value, KEY, old), headers=DEVICE)
            assert r.status_code == 200 and "alerts" in r.json(), r.text
        assert [a["kind"] for a in r.json()["alerts"]] == ["news2"]

    def test_a_re_sent_linked_reading_is_a_duplicate(self, world):
        client, _, audit = world
        _send(client, [("spo2", 97)])
        assert _assign(client, _ids(client)).status_code == 200
        r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
        assert r.json() == {"patient_id": TYPO, "duplicate": True}
        assert _list(client) == {"count": 0, "sets": []}

    def test_a_discharge_between_two_readings_of_a_set_stops_the_link(self):
        """B3 review, change 2: the target's identity is read again before EACH reading goes in. A discharge that
        lands between two readings (the first reading's `ingest` row is the hook here) puts nothing more into the
        engine — no card, no frame, no notification for a discharged number (D4) — and answers 409
        `reading_target_discharged`. The reading already applied stays applied and finalized; the rest are
        released back to the list."""
        audit = _FailsOnce()
        identities = _identities()
        app, store, _ = _app(audit=audit, identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 88), ("spo2", 97), ("temperature", 37.2)])
            ids = _ids(client)
            order = [row.code for row in store.get("h1", ids)]
            assert order == ["heart_rate", "spo2", "temperature"]
            plain = audit.append
            hits = {"n": 0}

            def append(event):
                written = plain(event)
                if event.event_type == "ingest":
                    hits["n"] += 1
                    if hits["n"] == 1:                                   # the first reading is in: discharge KEY now
                        identities.apply("h1", IdentityRecord(KEY, family="Hasta", given="Test", state="discharged",
                                                              source=KABUL, unit_id="u-1", bed_id=f"b-{KEY[-1]}",
                                                              updated_at=datetime.now(timezone.utc)))
                return written
            audit.append = append
            r = _assign(client, ids)
            audit.append = plain
            assert (r.status_code, _code(r)) == (409, "reading_target_discharged")
            assert hits["n"] == 1                                        # nothing more reached the audit trail
            states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
            assert states == {"heart_rate": (STATE_ASSIGNED, KEY),       # applied and finalized: stays applied
                              "spo2": (STATE_UNMATCHED, None),           # released
                              "temperature": (STATE_UNMATCHED, None)}
            assert len(audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)) == 1
            assert [x["code"] for s in _list(client)["sets"] for x in s["readings"]] == ["spo2", "temperature"]
            # B6 review: the one reading that went in is audited — a row naming only it
            [linked] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
            by_code = {x.code: x.id for x in store.get("h1", ids)}
            assert (linked.patient_id, linked.subject) == (KEY, "reading")
            assert linked.payload == {"readings": [by_code["heart_rate"]], "received_key": TYPO, "reason": "unknown",
                                      "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(), "actor": "hem.ayse"}

    def test_a_discharge_before_the_first_reading_links_nothing_and_writes_no_row(self):
        """The target is discharged between the check and the first reading: nothing went in, so nothing is
        audited, and the whole set is back on the list."""
        identities = _identities()
        app, store, audit = _app(identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 88), ("spo2", 97)])
            ids = _ids(client)
            real = identities.get
            gone = IdentityRecord(KEY, family="Hasta", given="Test", state="discharged", source=KABUL, unit_id="u-1",
                                  bed_id=f"b-{KEY[-1]}", updated_at=datetime.now(timezone.utc))
            calls = {"n": 0}

            def get(tenant, patient_id):
                if patient_id == KEY:
                    calls["n"] += 1
                    if calls["n"] >= 2:                                  # the first read is `_link_target`'s
                        return gone
                return real(tenant, patient_id)
            identities.get = get
            r = _assign(client, ids)
            identities.get = real
            assert (r.status_code, _code(r)) == (409, "reading_target_discharged")
            assert all(row.state == STATE_UNMATCHED for row in store.get("h1", ids))
            assert audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10) == []
            assert audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10) == []

    def test_a_failing_audit_of_the_linked_part_changes_no_answer_after_a_discharge(self):
        """B6 review: as after a raise — the partial row is best effort, and the answer stays 409."""
        audit = _FailsOnce()
        identities = _identities()
        app, store, _ = _app(audit=audit, identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 88), ("spo2", 97)])
            ids = _ids(client)
            plain = audit.append

            def append(event):
                if event.event_type == READING_ASSIGNED:
                    raise RuntimeError("audit down")
                written = plain(event)
                if event.event_type == "ingest":
                    identities.apply("h1", IdentityRecord(KEY, family="Hasta", given="Test", state="discharged",
                                                          source=KABUL, unit_id="u-1", bed_id=f"b-{KEY[-1]}",
                                                          updated_at=datetime.now(timezone.utc)))
                return written
            audit.append = append
            r = _assign(client, ids)
            audit.append = plain
            assert (r.status_code, _code(r)) == (409, "reading_target_discharged")
            assert audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10) == []
            states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
            assert states == {"heart_rate": (STATE_ASSIGNED, KEY), "spo2": (STATE_UNMATCHED, None)}


class TestRejecting:
    def test_a_rejected_set_is_closed_with_its_reason_and_the_value_is_kept(self, world):
        client, store, audit = world
        _send(client, [("spo2", 97), ("heart_rate", 88)])
        ids = _ids(client)
        r = _reject(client, ids, reason=f"  {WHY}  ")
        assert r.status_code == 200 and r.json() == {"rejected": ids}
        for row in store.get("h1", ids):
            assert (row.state, row.resolve_reason, row.resolved_by, row.patient_key) == (STATE_REJECTED, WHY, "hem.ayse", None)
        assert sorted(row.value for row in store.get("h1", ids)) == [88.0, 97.0]
        [closed] = audit.records(tenant="h1", event_type=READING_REJECTED, limit=10)
        assert (closed.patient_id, closed.subject) == (TYPO, "reading")
        assert closed.payload == {"readings": ids, "received_key": TYPO, "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(),
                                  "reason": WHY, "actor": "hem.ayse"}
        assert audit.records(tenant="h1", event_type="ingest", limit=10) == []      # nothing reached the engine
        assert _list(client) == {"count": 0, "sets": []}

    @pytest.mark.parametrize("reason", ["kısa", " " * 20, "x" * 201, None, 7])
    def test_the_reason_is_10_to_200_characters(self, world, reason):
        client, store, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _reject(client, ids, reason=reason)
        assert (r.status_code, _code(r)) == (422, "reading_reason_length")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_reason_of_exactly_10_and_of_200_is_taken(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        assert _reject(client, _ids(client), reason="ğ" * 10).status_code == 200
        _send(client, [("spo2", 96)], when=WHEN + timedelta(minutes=1))
        assert _reject(client, _ids(client), reason="ğ" * 200).status_code == 200

    def test_a_second_rejection_and_a_link_after_it_are_409(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        assert _reject(client, ids).status_code == 200
        assert _code(_reject(client, ids)) == "reading_not_unmatched"
        assert _code(_assign(client, ids)) == "reading_not_unmatched"

    def test_ids_of_two_sets_are_422(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], when=WHEN)
        _send(client, [("spo2", 96)], when=WHEN + timedelta(minutes=10))
        r = _reject(client, _ids(client))
        assert (r.status_code, _code(r)) == (422, "reading_set_mixed")

    def test_a_failed_audit_row_releases_the_claim(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97)])
            ids = _ids(client)
            audit.fail_on = READING_REJECTED
            assert _reject(client, ids).status_code == 500
            assert store.get("h1", ids)[0].state == STATE_UNMATCHED and _list(client)["count"] == 1
            assert _reject(client, ids).status_code == 200

    def test_a_re_sent_rejected_reading_is_a_duplicate(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)])
        assert _reject(client, _ids(client)).status_code == 200
        r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
        assert r.json() == {"patient_id": TYPO, "duplicate": True}
        assert _list(client) == {"count": 0, "sets": []}


def test_another_hospital_neither_sees_nor_touches_the_list():
    people = {**PEOPLE, "h2-jwt": Caller(hospital="h2", actor="hem.h2", groups=("nurse",), perms=CHART)}

    async def resolve(credential):
        return people.get(credential)
    store = _Flaky()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=resolve, identities=_identities(),
                     readings=store, unknown_readings=POLICY_UNMATCHED)
    h2 = {"Authorization": "Bearer h2-jwt"}
    with TestClient(app) as client:
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        assert _list(client, h2) == {"count": 0, "sets": []}
        assert _code(_reject(client, ids, headers=h2)) == "reading_not_unmatched"
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED
