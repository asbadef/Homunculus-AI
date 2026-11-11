# homunculus-engine/tests/test_readings_unmatched.py
"""G3-05 (spec D4, D8, D9): a device reading whose number matches nobody is kept, with its value, in the
unmatched list — a discharged admission's number always, a number with no identity record under the production
policy. Nothing of it reaches the engine: no alert, no frame, no page, no card. Synthetic numbers and values
only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import prodserver
from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    POLICY_CARD, POLICY_UNMATCHED, READING_UNMATCHED, REASON_DISCHARGED, REASON_UNKNOWN, STATE_UNMATCHED,
    InMemoryReadingStore,
)
from tests.test_ingest_apply import IMMEDIATE, obs
from tests.test_readings_ingest import _Flaky

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
KEY, TYPO = "202600000001", "202600000010"
WHEN = datetime.now(timezone.utc) - timedelta(minutes=5)
WEEK = WHEN - timedelta(days=7)
QUIET = ("ingest", "alert", "first_seen", "notification", "alert_cleared", "reading_dropped_discharged")


def _world(policy=POLICY_UNMATCHED, audit=None, store=None, identities=None, **kw):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else _Flaky()
    identities = identities if identities is not None else InMemoryIdentityStore()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, identities=identities, readings=store,
                     unknown_readings=policy, **kw)
    return app, store, audit, identities


def _admit(identities, key=KEY, source=KABUL, state="admitted"):
    identities.apply("h1", IdentityRecord(key, family="Hasta", given="Test", state=state, source=source,
                                          unit_id="u-1", bed_id="b-1", updated_at=WHEN - timedelta(hours=2)))


def _kinds(audit, key):
    return [r.event_type for r in audit.records(tenant="h1", patient_id=key, limit=1000)]


def _cards(client):
    return [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]


def _measured(app):
    return set(app.state.board_link._engine("h1").patient_ids())


class TestADischargedNumber:
    def test_is_listed_with_its_value_and_nothing_reaches_the_engine(self):
        app, store, audit, identities = _world(policy=POLICY_CARD)        # whatever the policy for unknown numbers
        _admit(identities, state="discharged")
        with TestClient(app) as client:
            queue = app.state.broadcaster.subscribe("h1")
            r = client.post("/ingest", json=obs("heart_rate", 140, KEY, WHEN), headers=DEVICE)
            assert r.status_code == 200 and r.json() == {"patient_id": KEY, "dropped": "discharged"}
            [row] = audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)
            assert (row.patient_id, row.subject) == (KEY, "heart_rate")
            assert row.payload == {"value": 140.0, "unit": "u", "obs_ts": WHEN.isoformat(), "device": "CONNEX-3A",
                                   "reason": "discharged"}
            assert _kinds(audit, KEY) == [READING_UNMATCHED]
            assert queue.empty(), "nothing is published for a listed reading"
            assert KEY not in _cards(client) and KEY not in _measured(app)
            assert client.get(f"/alerts/{KEY}", headers=DEVICE).json()["alerts"] == []
        [listed] = store.unmatched("h1", since=WEEK)
        assert (listed.state, listed.unmatched_reason, listed.received_key, listed.patient_key) == (
            STATE_UNMATCHED, REASON_DISCHARGED, KEY, None)
        assert (listed.code, listed.value, listed.source, listed.observed_at) == ("heart_rate", 140.0, "CONNEX-3A", WHEN)
        assert (listed.audit_id, listed.entry_id, listed.admission_id) == (row.id, None, None)

    def test_a_set_that_would_page_raises_no_alert_no_frame_and_no_notification(self):
        """The owner's decision of 2026-10-26 stands: no alert and no page may come of a discharged number."""
        app, store, audit, identities = _world()
        _admit(identities, state="discharged")
        with TestClient(app) as client:
            queue = app.state.broadcaster.subscribe("h1")
            hub = app.state.notification_hub.subscribe("h1", "nurse")
            for code, value in IMMEDIATE:
                assert client.post("/ingest", json=obs(code, value, KEY, WHEN), headers=DEVICE).json()["dropped"] == "discharged"
            assert queue.empty() and hub.empty()
        assert _kinds(audit, KEY) == [READING_UNMATCHED] * 5
        assert not any(audit.records(tenant="h1", event_type=kind, limit=10) for kind in QUIET)
        assert sorted(r.code for r in store.unmatched("h1", since=WEEK)) == sorted(code for code, _ in IMMEDIATE)

    def test_the_chart_door_still_writes_its_own_drop_row(self):
        """Only `/ingest` changed: a hand entry for a discharged number is refused as before, value not kept."""
        app, store, audit, identities = _world()
        _admit(identities, state="discharged")
        with TestClient(app) as client:
            r = client.post(f"/clinical/{KEY}", headers=DEVICE, json={"entries": [{"code": "lactate", "value": 3.1}],
                                                                       "recorded_at": WHEN.isoformat()})
            assert r.json() == {"patient_id": KEY, "dropped": "discharged"}
        assert _kinds(audit, KEY) == ["reading_dropped_discharged"]
        assert store.unmatched("h1", since=WEEK) == []


class TestAnUnknownNumber:
    def test_under_the_production_policy_is_listed_and_makes_no_card(self):
        app, store, audit, _ = _world(policy=POLICY_UNMATCHED)
        with TestClient(app) as client:
            queue = app.state.broadcaster.subscribe("h1")
            r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert r.status_code == 200 and r.json() == {"patient_id": TYPO, "dropped": "unmatched"}
            assert queue.empty() and TYPO not in _cards(client) and TYPO not in _measured(app)
        [row] = audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)
        assert row.payload["reason"] == "unknown" and row.payload["value"] == 97.0
        assert _kinds(audit, TYPO) == [READING_UNMATCHED]
        [listed] = store.unmatched("h1", since=WEEK)
        assert (listed.unmatched_reason, listed.received_key, listed.patient_key) == (REASON_UNKNOWN, TYPO, None)

    @pytest.mark.parametrize("number", ["20260000001", "2026000000011", "H-0000007", "bed-3"])
    def test_any_number_with_no_record_is_listed_not_only_twelve_digits(self, number):
        """D9: an 11- or 13-digit typo is exactly what the list is for."""
        app, store, _, _ = _world(policy=POLICY_UNMATCHED)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, number, WHEN), headers=DEVICE).json()["dropped"] == "unmatched"
        assert [r.received_key for r in store.unmatched("h1", since=WEEK)] == [number]

    def test_under_the_default_policy_makes_a_card_as_before(self):
        app, store, audit, _ = _world(policy=POLICY_CARD)
        with TestClient(app) as client:
            r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert r.status_code == 200 and "alerts" in r.json()
            assert TYPO in _cards(client)
        assert _kinds(audit, TYPO)[0] == "ingest" and store.unmatched("h1", since=WEEK) == []

    def test_the_default_policy_is_card(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
        with TestClient(app) as client:
            assert "alerts" in client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE).json()

    def test_an_unknown_policy_is_refused_at_start(self):
        with pytest.raises(ValueError, match="unknown_readings"):
            create_app({TOKEN: "h1"}, run_escalation_loop=False, unknown_readings="drop")


class TestWhoIsStillApplied:
    @pytest.mark.parametrize("source", [KABUL, "comed", "manuel"])
    def test_an_admitted_record_of_any_source_is_applied_under_the_production_policy(self, source):
        app, store, audit, identities = _world(policy=POLICY_UNMATCHED)
        _admit(identities, source=source)
        with TestClient(app) as client:
            r = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
            assert "alerts" in r.json() and KEY in _cards(client)
        assert _kinds(audit, KEY)[0] == "ingest" and store.unmatched("h1", since=WEEK) == []

    def test_a_his_discharge_is_still_evaluated(self):
        """A HIS discharge is no tombstone (G2-A11 D4): its card keeps its 24 hours and its readings are scored."""
        app, store, _, identities = _world(policy=POLICY_UNMATCHED)
        _admit(identities, source="comed", state="discharged")
        with TestClient(app) as client:
            assert "alerts" in client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).json()
        assert store.unmatched("h1", since=WEEK) == []


class TestTheNamelessCardOfTheDeployDay:
    def test_it_stays_after_the_restart_and_receives_nothing_new(self):
        """Spec §8: a nameless card that exists on the day stays — the restart replays its old `ingest` rows —
        but under the production policy a new reading for that number goes to the list, not onto the card."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        before, _, _, _ = _world(policy=POLICY_CARD, audit=audit, store=store)
        with TestClient(before) as client:
            assert "alerts" in client.post("/ingest", json=obs("spo2", 97, "S-404", WHEN), headers=DEVICE).json()
        after, _, _, _ = _world(policy=POLICY_UNMATCHED, audit=audit, store=store)
        with TestClient(after) as client:
            assert "S-404" in _cards(client)                             # replayed from its old rows
            later = WHEN + timedelta(minutes=2)
            r = client.post("/ingest", json=obs("spo2", 91, "S-404", later), headers=DEVICE)
            assert r.json() == {"patient_id": "S-404", "dropped": "unmatched"}
            card = next(p for p in client.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == "S-404")
            assert card["latest"]["spo2"] == 97                          # the card did not take the 91
        assert [(r.value, r.unmatched_reason) for r in store.unmatched("h1", since=WEEK)] == [(91.0, REASON_UNKNOWN)]


class TestTheListIsTheOnlyPlace:
    def test_a_table_write_that_fails_answers_500_so_the_bridge_sends_it_again(self):
        app, store, audit, _ = _world(policy=POLICY_UNMATCHED)
        store.fail = {"add"}
        with TestClient(app, raise_server_exceptions=False) as client:
            r = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert r.status_code == 500
            assert len(audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)) == 1   # the row came first
            store.fail = set()
            again = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)      # the bridge's retry
            assert again.status_code == 200 and again.json() == {"patient_id": TYPO, "dropped": "unmatched"}
        assert len(store.unmatched("h1", since=WEEK)) == 1
        assert len(audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)) == 2

    def test_a_re_sent_unmatched_reading_is_a_duplicate(self):
        app, store, audit, _ = _world(policy=POLICY_UNMATCHED)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE).json()["dropped"] == "unmatched"
            again = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert again.json() == {"patient_id": TYPO, "duplicate": True}
        assert len(store.unmatched("h1", since=WEEK)) == 1
        assert len(audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10)) == 1


class TestTheOrderOfTheDoor:
    def test_a_re_send_for_a_number_discharged_since_is_a_duplicate_not_a_second_listed_reading(self):
        """B4 review: the re-send check (D14) runs BEFORE the tombstone branch. A reading the record already holds
        is answered `duplicate` even when its number was discharged after it arrived — the uplink's at-least-once
        re-send must not become a listed copy of a value the patient's record already has. A different reading for
        the same discharged number is still listed."""
        app, store, audit, identities = _world(policy=POLICY_UNMATCHED)
        _admit(identities)
        with TestClient(app) as client:
            first = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
            assert "alerts" in first.json()                              # applied, and the record holds it
            _admit(identities, state="discharged")                       # the admission ends; the number is a tombstone
            again = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
            assert again.status_code == 200 and again.json() == {"patient_id": KEY, "duplicate": True}
            assert store.unmatched("h1", since=WEEK) == []
            assert audit.records(tenant="h1", event_type=READING_UNMATCHED, limit=10) == []
            other = client.post("/ingest", json=obs("spo2", 96, KEY, WHEN + timedelta(minutes=1)), headers=DEVICE)
            assert other.json() == {"patient_id": KEY, "dropped": "discharged"}
        assert [(r.value, r.unmatched_reason) for r in store.unmatched("h1", since=WEEK)] == [(96.0, REASON_DISCHARGED)]


class TestTheProductionPolicy:
    def test_postgres_lists_unknown_numbers_and_the_env_turns_it_back(self):
        url = "postgresql+asyncpg://u:p@db.invalid:5432/homunculus"
        assert prodserver._unknown_readings(url, {}) == POLICY_UNMATCHED
        assert prodserver._unknown_readings(url, {"READINGS_UNKNOWN_KEY": "card"}) == POLICY_CARD
        assert prodserver._unknown_readings(url, {"READINGS_UNKNOWN_KEY": " CARD "}) == POLICY_CARD
        assert prodserver._unknown_readings(url, {"READINGS_UNKNOWN_KEY": "anything else"}) == POLICY_UNMATCHED

    def test_a_development_start_keeps_the_card(self):
        assert prodserver._unknown_readings("", {}) == POLICY_CARD
        assert prodserver._unknown_readings("sqlite:///x.db", {"READINGS_UNKNOWN_KEY": "unmatched"}) == POLICY_CARD
