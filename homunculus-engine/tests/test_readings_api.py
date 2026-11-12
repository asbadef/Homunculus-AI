# homunculus-engine/tests/test_readings_api.py
"""G3-05 (spec D10–D12, §4): the unmatched list and its two actions against the DB-less app — who may, who sees
what, every refusal, a linked reading entering the real engine at its own time with the device as its source, a
claim released when the write fails, and a restart replaying the same picture. Synthetic numbers and values only
(CLAUDE.md rule 6)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    LIST_MAX, POLICY_CARD, POLICY_UNMATCHED, READING_ASSIGNED, READING_NEEDS_PERSON, READING_REJECTED,
    REASON_UNKNOWN, RESOLVE_ALREADY_HELD, STATE_ASSIGNED, STATE_REJECTED, STATE_UNMATCHED, device_reading,
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


def _app(audit=None, store=None, identities=None, policy=POLICY_UNMATCHED):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else _Flaky(admitted={("h1", KEY): ADMISSION})
    identities = identities if identities is not None else _identities()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, resolve_scope=_resolve_scope,
                     audit=audit, identities=identities, readings=store, unknown_readings=policy)
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
        assert all(row.payload["actor"] == "hem.ayse" for row in rows)    # the chain names who linked each one (I-4)
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

    def test_a_target_the_engine_has_measured_but_no_identity_names_can_be_linked_under_the_policy_card(self):
        """E-5, the positive path: «an identity record or a patient the engine has measured». A bedside value
        charted for a number nobody admitted puts it on the board; a reading may then be linked to it — under the
        policy `card` (D9), where such a card is what a number nobody admitted makes. The reading carries no stay
        (no admission record), and the link makes no second card. (A discharged number's set: under `card` an
        unknown number's reading is applied, never listed.)"""
        app, store, _ = _app(policy=POLICY_CARD)
        with TestClient(app, raise_server_exceptions=False) as client:
            nobody = "202600000077"
            _chart(client, [{"code": "heart_rate", "value": 80}], _ago(minutes=20), nobody)
            _send(client, [("spo2", 97)], key=GONE)
            ids = _ids(client, GONE)
            r = _assign(client, ids, nobody)
            assert r.status_code == 200, r.text
            [row] = store.get("h1", ids)
            assert (row.state, row.patient_key, row.admission_id) == (STATE_ASSIGNED, nobody, None)
            patients = [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
            assert patients.count(nobody) == 1

    def test_under_the_policy_unmatched_a_nameless_card_is_no_target(self, world):
        """Final review (minor 5): in the hospital (policy `unmatched`) a number nobody is admitted under is listed,
        never applied — a card with no identity record is a leftover, and a link must not feed it. 404, as for a
        patient who is not on the board; nothing is claimed."""
        client, store, audit = world
        nobody = "202600000077"
        _chart(client, [{"code": "heart_rate", "value": 80}], _ago(minutes=20), nobody)   # a card, no identity
        _send(client, [("spo2", 97)])
        ids = _ids(client)
        r = _assign(client, ids, nobody)
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert store.get("h1", ids)[0].state == STATE_UNMATCHED
        assert audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10) == []

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

    def test_a_raise_after_a_readings_ingest_row_leaves_it_linked_and_releases_only_the_rest(self):
        """The second reading's `ingest` row was written and the table's row filed at once (B6 review); then a
        later append (its alert) fails. The engine holds the reading, the trail names it, the table has it linked:
        it is NOT released (released, a retry or a link elsewhere would write a second `ingest` row). The first
        reading stays linked too; the third, never attempted, goes back to the list. The answer is 500, and the
        audit row names the two that went in."""
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
            assert states == {"heart_rate": (STATE_ASSIGNED, KEY),       # applied and filed
                              "resp_rate": (STATE_ASSIGNED, KEY),        # its `ingest` row was written: filed too
                              "spo2": (STATE_UNMATCHED, None)}           # not yet attempted: back on the list
            assert [x["code"] for s in _list(client)["sets"] for x in s["readings"]] == ["spo2"]
            # each `ingest` row names its reading and the person who linked it (I-4)
            by_code = {x.code: x.id for x in store.get("h1", ids)}
            rows = {e.subject: e for e in audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)}
            assert {code: (e.payload["reading"], e.payload["actor"]) for code, e in rows.items()} == {
                "heart_rate": (by_code["heart_rate"], "hem.ayse"), "resp_rate": (by_code["resp_rate"], "hem.ayse")}
            # B6 review: the part that DID go in is audited — one `reading_assigned` row naming the two linked
            # readings (not the released one), by whom, under the patient
            [linked] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
            assert (linked.patient_id, linked.subject) == (KEY, "reading")
            assert linked.payload == {"readings": [by_code["heart_rate"], by_code["resp_rate"]], "received_key": TYPO,
                                      "reason": "unknown", "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(),
                                      "actor": "hem.ayse"}

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
        the row may fail too: the answer is still the original 500, and nothing else is raised."""
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
            assert states == {"heart_rate": (STATE_ASSIGNED, KEY), "resp_rate": (STATE_ASSIGNED, KEY),
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

    def _slow_link(self, then):
        """A set of three whose first reading is in when `then(store, ids)` runs — the minutes a slow audit takes, in
        which `reconcile` (or another hand) gets at the claims the set has not reached yet. Answers the app, the
        store, the trail, the ids in attempt order, and what the link answered."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 88), ("spo2", 97), ("temperature", 37.2)])
            ids = _ids(client)
            assert [row.code for row in store.get("h1", ids)] == ["heart_rate", "spo2", "temperature"]
            plain = audit.append
            hits = {"n": 0}

            def append(event):
                written = plain(event)
                if event.event_type == "ingest":
                    hits["n"] += 1
                    if hits["n"] == 1:
                        then(store, ids)
                return written
            audit.append = append
            r = _assign(client, ids)
            audit.append = plain
            return client, store, audit, ids, r, hits, _list(client)

    def test_a_claim_released_while_the_set_is_in_work_stops_the_link(self):
        """B10 review: a set of 50 readings against a degraded audit outlives CLAIM_STALE and `reconcile` puts the
        claims not yet reached back on the list. Applied anyway, the reading would be in the engine AND waiting in
        the list. The set stops at the first reading that is no longer its claim: nothing more reaches the engine,
        the part that went in is audited, and the answer is 409 `reading_not_unmatched`."""
        _, store, audit, ids, r, hits, listed = self._slow_link(lambda store, ids: store.release("h1", ids[1:]))
        assert (r.status_code, _code(r)) == (409, "reading_not_unmatched")
        assert hits["n"] == 1 and len(audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=10)) == 1
        states = {row.code: (row.state, row.patient_key) for row in store.get("h1", ids)}
        assert states == {"heart_rate": (STATE_ASSIGNED, KEY), "spo2": (STATE_UNMATCHED, None),
                          "temperature": (STATE_UNMATCHED, None)}
        assert [x["code"] for s in listed["sets"] for x in s["readings"]] == ["spo2", "temperature"]
        [linked] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
        assert linked.payload["readings"] == [ids[0]]                    # only the reading that went in

    def test_a_claim_another_hand_made_since_is_left_to_that_hand(self):
        """The released claim was made again by someone else: this set neither applies the reading nor puts THEIR
        claim back on the list. The claim this request still holds (the third) goes back."""
        def another_hand(store, ids):
            store.release("h1", ids[1:])
            store.claim("h1", [ids[1]], by="hem.zeynep", at=datetime.now(timezone.utc))
        _, store, audit, ids, r, hits, _ = self._slow_link(another_hand)
        assert (r.status_code, _code(r)) == (409, "reading_not_unmatched")
        assert hits["n"] == 1
        spo2, temperature = store.get("h1", ids[1:])
        assert (spo2.state, spo2.patient_key, spo2.resolved_by) == (STATE_ASSIGNED, None, "hem.zeynep")
        assert temperature.state == STATE_UNMATCHED

    def test_a_claim_the_same_person_made_again_is_a_different_claim(self):
        """The same nurse linking the set again after the release is another request's claim, made at another
        instant: this one stops all the same."""
        def again(store, ids):
            store.release("h1", ids[1:])
            store.claim("h1", ids[1:], by="hem.ayse", at=datetime.now(timezone.utc) + timedelta(seconds=5))
        _, store, audit, ids, r, hits, _ = self._slow_link(again)
        assert (r.status_code, _code(r)) == (409, "reading_not_unmatched")
        assert hits["n"] == 1
        assert all(row.state == STATE_ASSIGNED and row.patient_key is None for row in store.get("h1", ids[1:]))


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


# ----------------------------------------------------------------------------- the independent review's findings

def _ingest_rows(audit, patient=KEY):
    return [r for r in audit.records(tenant="h1", event_type="ingest", limit=1000) if r.patient_id == patient]


LATE = "202600000077"                    # a number listed as unknown, admitted afterwards


def _frames(queue, key=KEY) -> list[dict]:
    """The frames published for `key` since `queue` subscribed (app.state.broadcaster)."""
    out = []
    while not queue.empty():
        frame = queue.get_nowait()
        if frame.get("patient_id") == key:
            out.append(frame)
    return out


def _history(client, code, key=KEY):
    return client.app.state.board_link._engine("h1").state(key).history(SignalCode(code))


class TestOneReadingEntersTheTargetOnce:
    """Review I-1: D14 compares the number a reading arrived under, and a linked row keeps the WRONG one — so the
    device's re-send under the corrected number was not recognised, and the engine, the trail and the replay held
    one measurement twice. The record is asked under the patient it is FILED under as well, in both orders."""

    def test_a_linked_reading_re_sent_under_the_corrected_number_is_a_duplicate(self, world):
        client, store, audit = world
        _send(client, [("heart_rate", 131)])                              # under the typo: listed
        assert _assign(client, _ids(client)).status_code == 200
        r = client.post("/ingest", json=obs("heart_rate", 131, KEY, WHEN), headers=DEVICE)
        assert r.json() == {"patient_id": KEY, "duplicate": True}
        assert len(_ingest_rows(audit)) == 1 and len(_history(client, "heart_rate")) == 1
        assert len(store.for_patient("h1", KEY, since=WHEN - timedelta(hours=1), until=WHEN + timedelta(hours=1))) == 1

    def test_a_reading_re_sent_under_the_corrected_number_first_is_not_entered_again_by_the_link(self, world):
        """The other order: the device re-sends under KEY (applied), then the nurse links the typo's set to KEY."""
        client, store, audit = world
        _send(client, [("heart_rate", 131)])                              # under the typo: listed
        ids = _ids(client)
        r = client.post("/ingest", json=obs("heart_rate", 131, KEY, WHEN), headers=DEVICE)
        assert "alerts" in r.json()                                       # KEY is admitted: applied
        linked = _assign(client, ids)
        assert linked.status_code == 200 and linked.json()["assigned"] == ids
        assert len(_ingest_rows(audit)) == 1 and len(_history(client, "heart_rate")) == 1     # not twice
        [row] = store.get("h1", ids)
        assert (row.state, row.patient_key, row.resolved_by) == (STATE_REJECTED, None, "hem.ayse")
        assert row.resolve_reason == RESOLVE_ALREADY_HELD and row.value == 131.0      # closed; the value is kept
        [assigned] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
        assert assigned.payload["already_held"] == ids and assigned.payload["readings"] == ids
        assert _list(client) == {"count": 0, "sets": []}

    def test_in_one_set_only_the_reading_the_target_holds_is_left_out(self, world):
        client, store, audit = world
        _send(client, [("heart_rate", 131), ("spo2", 97)])
        ids = _ids(client)
        assert "alerts" in client.post("/ingest", json=obs("heart_rate", 131, KEY, WHEN), headers=DEVICE).json()
        assert _assign(client, ids).status_code == 200
        by_code = {row.code: row for row in store.get("h1", ids)}
        assert (by_code["heart_rate"].state, by_code["heart_rate"].patient_key) == (STATE_REJECTED, None)
        assert (by_code["spo2"].state, by_code["spo2"].patient_key) == (STATE_ASSIGNED, KEY)
        assert {r.subject for r in _ingest_rows(audit)} == {"heart_rate", "spo2"} and len(_ingest_rows(audit)) == 2
        [assigned] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
        assert assigned.payload["already_held"] == [by_code["heart_rate"].id]

    def test_a_set_linked_to_the_number_it_arrived_under_is_applied_not_closed_as_held(self):
        """B6 re-review (Critical): a number listed as unknown, admitted since, then linked to ITSELF — the natural
        case. The claimed rows carry that very number; they must not answer for themselves (`filed_under`, not
        `seen`): every reading goes into the engine."""
        identities = _identities()
        app, store, audit = _app(identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97), ("heart_rate", 88)], key=LATE)
            identities.apply("h1", IdentityRecord(LATE, family="Hasta", given="Test", state="admitted", source=KABUL,
                                                  unit_id="u-1", bed_id="b-77", updated_at=WHEN + timedelta(minutes=1)))
            ids = _ids(client, LATE)
            r = _assign(client, ids, LATE)
            assert r.status_code == 200 and r.json()["assigned"] == ids, r.text
            rows = _ingest_rows(audit, LATE)
            assert sorted(e.payload["reading"] for e in rows) == ids          # an `ingest` row per reading
            assert all(e.payload["actor"] == "hem.ayse" for e in rows)
            assert len(_history(client, "spo2", LATE)) == 1 and len(_history(client, "heart_rate", LATE)) == 1
            assert [(x.state, x.patient_key, x.received_key) for x in store.get("h1", ids)] == [
                (STATE_ASSIGNED, LATE, LATE)] * 2
            [assigned] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
            assert "already_held" not in assigned.payload and assigned.patient_id == LATE
            # and the device sending it again under that number is now the duplicate it is
            again = client.post("/ingest", json=obs("spo2", 97, LATE, WHEN), headers=DEVICE)
            assert again.json() == {"patient_id": LATE, "duplicate": True} and len(_ingest_rows(audit, LATE)) == 2

    def test_a_target_that_holds_nothing_of_the_set_gets_no_already_held_key(self, world):
        client, _, audit = world
        _send(client, [("heart_rate", 131)])
        assert _assign(client, _ids(client)).status_code == 200
        [assigned] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
        assert "already_held" not in assigned.payload

    def test_a_store_that_cannot_answer_links_the_reading(self, caplog):
        """The check fails OPEN, as the door's: a doubt never keeps a reading out. Logged: class and hospital only."""
        store = _Leaky(admitted={("h1", KEY): ADMISSION})
        app, _, audit = _app(store=store)
        with caplog.at_level(logging.ERROR, logger="homunculus.api.readings"), \
                TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 131.5)])
            ids = _ids(client)
            store.fail = {"filed_under"}
            assert _assign(client, ids).status_code == 200
        assert len(_ingest_rows(audit)) == 1
        text = " ".join(r.getMessage() for r in caplog.records)
        assert "RuntimeError" in text and "h1" in text and KEY not in text and "131.5" not in text


class _Leaky(_Flaky):
    """A store that fails with a driver's kind of text — the number and the value in it."""

    def seen(self, tenant, received_key, code, observed_at, source, value):
        if "seen" in self.fail:
            raise RuntimeError(f"Failing row contains ({received_key}, {value})")
        return super().seen(tenant, received_key, code, observed_at, source, value)

    def filed_under(self, tenant, patient_key, code, observed_at, source, value):
        if "filed_under" in self.fail:
            raise RuntimeError(f"Failing row contains ({patient_key}, {value})")
        return super().filed_under(tenant, patient_key, code, observed_at, source, value)

    def add(self, row):
        if "add" in self.fail:
            raise RuntimeError(f"Failing row contains ({row.received_key}, {row.value})")
        return super().add(row)


class TestARetryAfterAPartialFailure:
    """Review I-2: the table's row used to be filed after the whole tail, so a failure inside the tail (an alert
    row) made the bridge's retry look new — and enter the engine and the trail a second time. It is filed the
    moment the `ingest` row is written."""

    def test_a_retry_after_a_failed_alert_append_is_a_duplicate_and_the_engine_holds_the_value_once(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        body = obs("heart_rate", 140, KEY, WHEN)
        with TestClient(app, raise_server_exceptions=False) as client:
            audit.fail_on = "alert"
            first = client.post("/ingest", json=body, headers=DEVICE)
            retry = client.post("/ingest", json=body, headers=DEVICE)
            assert first.status_code == 500
            assert (retry.status_code, retry.json()) == (200, {"patient_id": KEY, "duplicate": True})
            assert len(_ingest_rows(audit)) == 1 and len(_history(client, "heart_rate")) == 1
            assert len(store.for_patient("h1", KEY, since=WHEN - timedelta(hours=1),
                                         until=WHEN + timedelta(hours=1))) == 1

    def test_a_retry_after_a_failed_ingest_append_is_applied_once(self):
        """The window that remains, stated: the `ingest` append itself failed, so there is no row and nothing is
        filed — the retry is the first time the trail sees the reading."""
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        body = obs("heart_rate", 140, KEY, WHEN)
        with TestClient(app, raise_server_exceptions=False) as client:
            audit.fail_on = "ingest"
            assert client.post("/ingest", json=body, headers=DEVICE).status_code == 500
            assert store.for_patient("h1", KEY, since=WHEN - timedelta(hours=1), until=WHEN + timedelta(hours=1)) == []
            assert "alerts" in client.post("/ingest", json=body, headers=DEVICE).json()
            assert len(_ingest_rows(audit)) == 1

    def test_the_door_still_answers_what_it_answered(self, world):
        client, store, audit = world
        r = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
        assert r.status_code == 200 and sorted(r.json()) == ["alerts", "patient_id"]
        [row] = store.for_patient("h1", KEY, since=WHEN - timedelta(hours=1), until=WHEN + timedelta(hours=1))
        assert (row.audit_id, row.entry_id, row.admission_id) == (_ingest_rows(audit)[0].id,) * 2 + (ADMISSION,)

    def test_a_link_whose_tail_fails_leaves_the_reading_filed_so_a_re_send_is_a_duplicate(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 140)])
            ids = _ids(client)
            audit.fail_on = "alert"
            assert _assign(client, ids).status_code == 500
            [row] = store.get("h1", ids)
            assert (row.state, row.patient_key) == (STATE_ASSIGNED, KEY)           # filed, not left claimed
            again = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
            assert again.json() == {"patient_id": KEY, "duplicate": True}
            assert len(_ingest_rows(audit)) == 1 and len(_history(client, "heart_rate")) == 1


class TestAResentReadingFinishesAFailedTail:
    """Re-review: since the table's row is filed at once, a request whose tail failed is answered `duplicate` on the
    bridge's re-send — and the alert it raised must still be stamped, told and framed, once, with no second
    `ingest` row and no `alert` row. An ordinary re-send, with nothing missed, writes and publishes nothing."""

    @staticmethod
    def _post(client, code, value):
        return client.post("/ingest", json=obs(code, value, KEY, WHEN), headers=DEVICE)

    @staticmethod
    def _rows(audit, kind):
        return audit.records(tenant="h1", patient_id=KEY, event_type=kind, limit=100)

    def test_the_stamp_and_the_frame_come_with_the_re_send_exactly_once(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            queue = client.app.state.broadcaster.subscribe("h1")
            audit.fail_on = "alert"
            assert self._post(client, "heart_rate", 140).status_code == 500
            assert self._rows(audit, "first_seen") == [] and _frames(queue) == []      # the tail never got there
            retry = self._post(client, "heart_rate", 140)
            assert (retry.status_code, retry.json()) == (200, {"patient_id": KEY, "duplicate": True})
            firing = sorted(a.kind for a in client.app.state.board_link._engine("h1").active_alerts(KEY))
            assert firing and sorted(r.subject for r in self._rows(audit, "first_seen")) == firing   # stamped, once
            assert len(_frames(queue)) == 1                                               # the card went out, once
            # what a re-send must not do: a second `ingest` row, an `alert` row, a second engine point
            assert len(_ingest_rows(audit)) == 1 and len(_history(client, "heart_rate")) == 1
            assert self._rows(audit, "alert") == []
            # and the next re-send finds nothing left to finish
            again = self._post(client, "heart_rate", 140)
            assert again.json() == {"patient_id": KEY, "duplicate": True}
            assert len(self._rows(audit, "first_seen")) == len(firing) and _frames(queue) == []

    def test_the_nurses_notification_comes_with_the_re_send_exactly_once(self):
        audit = _FailsOnce()
        app, store, _ = _app(audit=audit)
        with TestClient(app, raise_server_exceptions=False) as client:
            told = client.app.state.notification_hub.subscribe("h1", "nurse")
            assert self._post(client, "heart_rate", 140).status_code == 200
            assert self._post(client, "resp_rate", 30).status_code == 200
            assert self._rows(audit, "notification") == []                       # the alert is not immediate yet
            audit.fail_on = "alert"
            assert self._post(client, "spo2", 88).status_code == 500             # … it turns immediate on this one
            assert self._rows(audit, "notification") == [] and told.empty()
            retry = self._post(client, "spo2", 88)
            assert retry.json() == {"patient_id": KEY, "duplicate": True}
            [note] = self._rows(audit, "notification")
            assert (note.subject, note.payload["audience"]) == ("news2", "nurse")
            assert told.qsize() == 1 and told.get_nowait()["patient_id"] == KEY
            self._post(client, "spo2", 88)
            assert len(self._rows(audit, "notification")) == 1 and told.empty()  # told once
            assert len(_ingest_rows(audit)) == 3

    def test_an_ordinary_re_send_stamps_tells_and_publishes_nothing(self, world):
        client, store, audit = world
        for code, value in IMMEDIATE:
            assert "alerts" in self._post(client, code, value).json()
        trail = len(audit.records(tenant="h1", limit=1000))
        assert len(self._rows(audit, "notification")) == 1
        queue = client.app.state.broadcaster.subscribe("h1")
        told = client.app.state.notification_hub.subscribe("h1", "nurse")
        for code, value in IMMEDIATE:                                            # the Connex re-sends its buffer
            assert self._post(client, code, value).json() == {"patient_id": KEY, "duplicate": True}
        assert len(audit.records(tenant="h1", limit=1000)) == trail              # not one row
        assert _frames(queue) == [] and told.empty()

    def test_the_re_send_of_a_listed_reading_has_no_tail(self, world):
        """A number the engine does not hold has no alerts to finish: no row, no frame."""
        client, _, audit = world
        _send(client, [("heart_rate", 140)], key=TYPO)
        trail = len(audit.records(tenant="h1", limit=1000))
        queue = client.app.state.broadcaster.subscribe("h1")
        again = client.post("/ingest", json=obs("heart_rate", 140, TYPO, WHEN), headers=DEVICE)
        assert again.json() == {"patient_id": TYPO, "duplicate": True}
        assert len(audit.records(tenant="h1", limit=1000)) == trail and _frames(queue, TYPO) == []


class TestAnAdmittedNumberIsThatPatientsScope:
    """Review I-3: a number unknown when its readings arrived and ADMITTED since belongs to a patient now: its set
    is visible only where the caller's scope reaches that patient, however its reason still reads."""
    LATE = LATE

    def _arrive_then_admit(self, client, identities, unit="u-2"):
        client.post("/ingest", json=obs("spo2", 86, self.LATE, WHEN), headers=DEVICE)
        identities.apply("h1", IdentityRecord(self.LATE, family="Hasta", given="Test", state="admitted", source=KABUL,
                                              unit_id=unit, bed_id="b-77", updated_at=WHEN + timedelta(minutes=1)))

    def test_a_scoped_nurse_does_not_see_the_set_of_another_units_patient(self):
        identities = _identities()
        app, store, _ = _app(identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            self._arrive_then_admit(client, identities)
            ids = _ids(client, self.LATE)
            assert ids and _ids(client, self.LATE, WARD2) == ids and _ids(client, self.LATE, NURSE) == ids
            assert _ids(client, self.LATE, WARD1) == []                 # unit u-1: not hers
            assert _list(client, WARD1)["count"] == 0

    def test_nor_can_she_reject_it_or_link_it_to_her_own_patient(self):
        identities = _identities()
        app, store, _ = _app(identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            self._arrive_then_admit(client, identities)
            ids = _ids(client, self.LATE)
            assert _code(_reject(client, ids, headers=WARD1)) == "reading_not_unmatched"
            assert _code(_assign(client, ids, KEY, WARD1)) == "reading_not_unmatched"
            assert store.get("h1", ids)[0].state == STATE_UNMATCHED

    def test_a_number_nobody_is_admitted_under_stays_everybodys(self, world):
        client, _, _ = world
        _send(client, [("spo2", 97)], key=TYPO)
        assert all(_ids(client, TYPO, who) for who in (NURSE, WARD1, WARD2))

    def test_the_scope_card_is_built_uncounted(self):
        """A list polled every minute by every nurse is no bed-access event: a HIS-fed patient on a location the
        bed map does not cover must not move the discovery counter (`BedMap.unmatched`)."""
        from homunculus.tenant.bedmap import BedMap
        bedmap, identities = BedMap(), _identities()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, resolve_scope=_resolve_scope,
                         audit=InMemoryAuditLog(), identities=identities, readings=_Flaky(), bedmap=bedmap,
                         unknown_readings=POLICY_UNMATCHED)
        with TestClient(app, raise_server_exceptions=False) as client:
            client.post("/ingest", json=obs("spo2", 86, self.LATE, WHEN), headers=DEVICE)
            identities.apply("h1", IdentityRecord(self.LATE, family="Hasta", given="Test", state="admitted",
                                                  source="comed", unit="ICU", room="9", bed="9",
                                                  updated_at=WHEN + timedelta(minutes=1)))
            before = bedmap.unmatched()
            for _ in range(2):
                _list(client, WARD1)
            assert bedmap.unmatched() == before


class TestTheListIsBoundedAtTheDatabase:
    def test_the_list_asks_the_store_for_a_bounded_number_of_rows(self, world, monkeypatch):
        """Review M2: the newest UNMATCHED_ROWS_MAX rows are read, never a week of a flooded list; when the cut
        bites, `truncated` says so and `count` is the number of sets among the rows read."""
        import homunculus.api.readings as module
        client, store, _ = world
        monkeypatch.setattr(module, "UNMATCHED_ROWS_MAX", 5)
        TestTheList._fill(store, 8)
        body = _list(client)
        assert (body["count"], body["truncated"]) == (5, True)
        assert [s["observed_at"] for s in body["sets"]] == [(WHEN - timedelta(seconds=i)).isoformat() for i in range(5)]

    def test_rows_exactly_at_the_bound_are_not_a_cut(self, world, monkeypatch):
        import homunculus.api.readings as module
        client, store, _ = world
        monkeypatch.setattr(module, "UNMATCHED_ROWS_MAX", 5)
        TestTheList._fill(store, 5)
        body = _list(client)
        assert body["count"] == 5 and "truncated" not in body


class TestTheLogsCarryNoNumberOrValue:
    """Review M1: the driver's text («Failing row contains (…)») carries the number and the value. A failed table
    write, or a failed duplicate check, is logged with the hospital and the class only — and no traceback."""

    @pytest.mark.parametrize("failing", ["add", "seen"])
    def test_the_door_logs_the_class_and_the_hospital_only(self, caplog, failing):
        store = _Leaky(admitted={("h1", KEY): ADMISSION})
        app, _, _ = _app(store=store)
        store.fail = {failing}
        with caplog.at_level(logging.ERROR, logger="homunculus.api.app"), \
                TestClient(app, raise_server_exceptions=False) as client:
            r = client.post("/ingest", json=obs("spo2", 91.5, KEY, WHEN), headers=DEVICE)
            assert r.status_code == 200 and "alerts" in r.json()           # the request never fails for it
        [logged] = [rec for rec in caplog.records if rec.name == "homunculus.api.app" and rec.levelno >= logging.ERROR]
        assert "RuntimeError" in logged.getMessage() and "h1" in logged.getMessage()
        assert logged.exc_info is None
        assert KEY not in caplog.text and "91.5" not in caplog.text and "Failing row" not in caplog.text


# ----------------------------------------------------------------------------- the final review's findings

NEXT = "202600000004"                    # the next patient in a discharged patient's bed
Q_ADMISSION = "33333333-3333-4333-8333-333333333333"


class TestAReadingFromBeforeTheTargetsStay:
    """Final review (I-1): protocols are handed out in order, so a mistyped number is often the NEXT one. P's round
    under it, measured hours ago, is listed «unknown»; then the number is given to a new patient Q in another unit.
    The set must not leave P's ward for Q's, and must never be linked to Q — P's values would score as Q's. The same
    path: a discharged patient's buffered round, linked to the next patient in that bed."""

    @staticmethod
    def _world(**stays):
        """KEY (P, unit u-1) admitted six hours ago; TYPO handed to Q ten minutes ago (her record is applied by
        `_give_typo_to_q`, unit u-2)."""
        store = _Flaky(admitted={("h1", KEY): ADMISSION, ("h1", TYPO): Q_ADMISSION},
                       admitted_at={("h1", KEY): _ago(hours=6), ("h1", TYPO): _ago(minutes=10)}, **stays)
        identities = _identities()
        app, _, audit = _app(store=store, identities=identities)
        return app, store, audit, identities

    @staticmethod
    def _give_typo_to_q(identities):
        identities.apply("h1", IdentityRecord(TYPO, family="Yeni", given="Hasta", state="admitted", source=KABUL,
                                              unit_id="u-2", bed_id="b-9", updated_at=_ago(minutes=10)))

    def test_the_round_stays_on_ps_ward_cannot_be_linked_to_q_and_links_to_p(self):
        """The reviewer's scenario: before the fix the set left u-1 for u-2, and linking it to Q put P's values
        under Q."""
        app, store, audit, identities = self._world()
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 88), ("sbp", 85)], key=TYPO, when=_ago(hours=3))      # P's round, typo
            assert _ids(client, TYPO, WARD1)
            self._give_typo_to_q(identities)
            ids = _ids(client, TYPO, WARD1)
            assert len(ids) == 2, "P's ward no longer sees P's round"
            assert _ids(client, TYPO, WARD2) == ids                       # everybody's, as an unknown number's
            r = _assign(client, ids, TYPO, WARD2)
            assert (r.status_code, _code(r)) == (409, "reading_before_stay")
            assert r.json()["detail"]["message"].startswith("The reading was measured before the patient's stay")
            assert [row.state for row in store.get("h1", ids)] == [STATE_UNMATCHED] * 2      # nothing claimed
            assert _ingest_rows(audit, TYPO) == [] and audit.records(tenant="h1", event_type=READING_ASSIGNED,
                                                                     limit=10) == []
            linked = _assign(client, ids, KEY, WARD1)                     # P's ward links it to P
            assert linked.status_code == 200, linked.text
            assert [(row.state, row.patient_key) for row in store.get("h1", ids)] == [(STATE_ASSIGNED, KEY)] * 2

    def test_p_s_ward_may_reject_it_too(self):
        app, store, _, identities = self._world()
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 88)], key=TYPO, when=_ago(hours=3))
            self._give_typo_to_q(identities)
            ids = _ids(client, TYPO, WARD1)
            assert _reject(client, ids, headers=WARD1).status_code == 200
            assert store.get("h1", ids)[0].state == STATE_REJECTED

    def test_a_round_measured_since_her_stay_began_is_still_her_scope_and_links_to_her(self):
        """The complement — B6 review I-3 stands: measured after Q's stay began, the set arrived before her record
        did; it is shown where the scope reaches Q, and links to her. A round measured a minute before the stay
        began is within the clock tolerance (BEDSIDE_SKEW) and is hers too."""
        app, store, _, identities = self._world()
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 88)], key=TYPO, when=_ago(minutes=5))
            _send(client, [("spo2", 89)], key=TYPO, when=_ago(minutes=11))
            self._give_typo_to_q(identities)
            assert _ids(client, TYPO, WARD1) == []
            for s in _list(client, WARD2)["sets"]:
                ids = [x["id"] for x in s["readings"]]
                r = _assign(client, ids, TYPO, WARD2)
                assert r.status_code == 200, r.text
            assert _list(client, WARD2)["count"] == 0

    def test_a_discharged_patients_round_cannot_be_linked_to_the_next_patient_in_that_bed(self):
        """GONE lay in u-1, bed b-3, and was discharged; her monitor's buffered round, measured three hours ago, is
        listed «taburcu». NEXT was admitted to that bed ten minutes ago: the round is not hers."""
        store = _Flaky(admitted={("h1", KEY): ADMISSION, ("h1", NEXT): Q_ADMISSION},
                       admitted_at={("h1", KEY): _ago(hours=6), ("h1", NEXT): _ago(minutes=10)})
        identities = _identities()
        identities.apply("h1", IdentityRecord(NEXT, family="Yeni", given="Hasta", state="admitted", source=KABUL,
                                              unit_id="u-1", bed_id="b-3", updated_at=_ago(minutes=10)))
        app, _, audit = _app(store=store, identities=identities)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("heart_rate", 131)], key=GONE, when=_ago(hours=3))
            [listed] = _list(client, WARD1)["sets"]
            assert listed["reason"] == "discharged"
            ids = _ids(client, GONE, WARD1)
            r = _assign(client, ids, NEXT, WARD1)
            assert (r.status_code, _code(r)) == (409, "reading_before_stay")
            assert store.get("h1", ids)[0].state == STATE_UNMATCHED and _ingest_rows(audit, NEXT) == []
            assert _reject(client, ids, headers=WARD1).status_code == 200      # closed with a reason, value kept

    def test_a_transferred_patients_round_from_before_the_move_can_be_linked(self):
        """KEY's stay began six hours ago and moved here an hour ago: the move opened a new admission row, but the
        stay is one, walked back to its kabul (`stay_start`). A round measured between the kabul and the move is
        hers; one measured before the kabul is not."""
        store = _Flaky(admitted={("h1", KEY): ADMISSION}, admitted_at={("h1", KEY): _ago(hours=6)},
                       moved_at={("h1", KEY): _ago(hours=1)})
        app, _, _ = _app(store=store)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 95)], key=TYPO, when=_ago(hours=3))
            ids = _ids(client)
            r = _assign(client, ids, KEY)
            assert r.status_code == 200, r.text
            assert [(row.state, row.patient_key) for row in store.get("h1", ids)] == [(STATE_ASSIGNED, KEY)]
            _send(client, [("spo2", 94)], key=TYPO, when=_ago(hours=7))
            early = _ids(client)
            assert _code(_assign(client, early, KEY)) == "reading_before_stay"

    def test_a_target_whose_stay_this_deployment_does_not_hold_is_not_refused(self, world):
        """A patient with no open admission here (a HIS-fed one, or a key the store does not know) has no stay start:
        the guard has nothing to compare with and the link goes as before."""
        client, store, _ = world
        _send(client, [("spo2", 97)], when=_ago(hours=20))
        r = _assign(client, _ids(client), OTHER)                      # OTHER: a kabul record, no open admission row
        assert r.status_code == 200, r.text


class TestAWithdrawnReadingIsNotLinkedBack:
    """Final review (minor 3): the link did not ask whether «hatalı giriş» withdrew the reading under the target. The
    device re-sent its round under the corrected number, a nurse withdrew a wrong value of it, and the typo's set
    still waits; linking it put the struck-out value back into the scores whenever the store could not answer."""

    def test_the_withdrawn_reading_is_closed_as_held_and_never_entered_again(self):
        store = _Leaky(admitted={("h1", KEY): ADMISSION})
        app, _, audit = _app(store=store)
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("sbp", 180), ("spo2", 97)])                    # under the typo: listed
            ids = _ids(client)
            assert "alerts" in client.post("/ingest", json=obs("sbp", 180, KEY, WHEN), headers=DEVICE).json()
            [direct] = _ingest_rows(audit)
            w = client.post(f"/clinical/{KEY}/entries/{direct.id}/retract", json={"reason": "manşet gevşekti, yanlış"},
                            headers=NURSE)
            assert w.status_code == 200, w.text
            store.fail = {"filed_under"}                                   # the store cannot answer: it fails open
            r = _assign(client, ids)
            assert r.status_code == 200, r.text
            assert sorted(x.subject for x in _ingest_rows(audit)) == ["sbp", "spo2"]     # no second sbp row
            assert _history(client, "sbp") == []                            # not back in the scores
            by_code = {row.code: row for row in store.get("h1", ids)}
            assert (by_code["sbp"].state, by_code["sbp"].resolve_reason) == (STATE_REJECTED, RESOLVE_ALREADY_HELD)
            assert (by_code["spo2"].state, by_code["spo2"].patient_key) == (STATE_ASSIGNED, KEY)
            [assigned] = audit.records(tenant="h1", event_type=READING_ASSIGNED, limit=10)
            assert assigned.payload["already_held"] == [by_code["sbp"].id]


class TestANamelessCardUnderThePolicyUnmatched:
    """Final review (minor 5): under the policy `unmatched` a number with no identity record is listed, never applied.
    A card the engine still holds under such a number is a leftover: the re-send of a listed reading must not finish
    its tail (stamp, tell, frame)."""

    def test_the_re_send_of_a_listed_reading_stamps_tells_and_publishes_nothing(self, world):
        client, _, audit = world
        nobody = "202600000077"
        _chart(client, [{"code": code, "value": value} for code, value in IMMEDIATE], _ago(minutes=20), nobody)
        _send(client, [("spo2", 97)], key=nobody)                            # no identity: listed, not applied
        # What a failed first tail would have left: the card's alerts unstamped and untold.
        client.app.state.ack_stores["h1"].first_seen.clear()
        client.app.state.notifier.prune("h1", set())
        trail = len(audit.records(tenant="h1", limit=1000))
        queue = client.app.state.broadcaster.subscribe("h1")
        told = client.app.state.notification_hub.subscribe("h1", "nurse")
        again = client.post("/ingest", json=obs("spo2", 97, nobody, WHEN), headers=DEVICE)
        assert again.json() == {"patient_id": nobody, "duplicate": True}
        assert len(audit.records(tenant="h1", limit=1000)) == trail          # no first_seen, no notification row
        assert _frames(queue, nobody) == [] and told.empty()


class TestTheListReadsOffTheLoop:
    def test_a_durable_stores_list_is_read_in_a_worker_thread(self):
        """Final review (minor 8): up to UNMATCHED_ROWS_MAX rows, polled every minute by every nurse — a durable
        store's read runs in a thread, not on the event loop (as the hourly reconcile does)."""
        import threading

        class _Durable(_Flaky):
            durable = True
            threads: set = set()

            def unmatched(self, tenant, **kw):
                self.threads.add(threading.current_thread())
                return super().unmatched(tenant, **kw)
        store = _Durable(admitted={("h1", KEY): ADMISSION})
        app, _, _ = _app(store=store)

        async def loop_thread():
            return threading.current_thread()
        with TestClient(app, raise_server_exceptions=False) as client:
            _send(client, [("spo2", 97)])
            assert _list(client)["count"] == 1
            on_the_loop = client.portal.call(loop_thread)
        assert store.threads and on_the_loop not in store.threads

    def test_a_store_in_memory_is_read_on_the_loop(self, world):
        import threading
        client, store, _ = world
        seen = []
        real = store.unmatched

        def unmatched(tenant, **kw):
            seen.append(threading.current_thread())
            return real(tenant, **kw)
        store.unmatched = unmatched

        async def loop_thread():
            return threading.current_thread()
        _list(client)
        assert seen == [client.portal.call(loop_thread)]
