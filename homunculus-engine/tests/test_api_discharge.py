# tests/test_api_discharge.py
"""G2-A11: a patient discharged through a Homunculus admission (a `kabul` tombstone in the identity
store) leaves the alert world. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

TOKEN = "tok-1"
HEAD = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc)

# Five readings that score NEWS2 12 (pulse 3, respiration 3, SpO2 3, systolic 3, temperature 2):
# an `immediate` news2 alert, the only urgency `escalate()` ever pages (final review).
IMMEDIATE = [("heart_rate", 140), ("resp_rate", 30), ("spo2", 88), ("sbp", 85), ("temperature", 39.5)]


class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once - the database going away
    mid-request (as tests/test_api_clinical.py)."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


def _obs(code, value, patient, when=WHEN):
    return {"resourceType": "Observation", "status": "final",
            "code": {"coding": [{"system": "http://homunculus.local/obs", "code": code}]},
            "subject": {"reference": f"Patient/{patient}"},
            "effectiveDateTime": when.isoformat(),
            "valueQuantity": {"value": value, "unit": "u"}, "device": {"display": "nce"}}


def _his_patient(patient, source="comed", active=True):
    return {"resourceType": "Patient",
            "identifier": [{"system": "http://homunculus.local/protocol-no", "value": patient}],
            "name": [{"family": "TEST", "given": ["SYNTH"]}],
            "birthDate": "1980-01-15", "gender": "female", "active": active,
            "meta": {"lastUpdated": WHEN.isoformat(), "source": source}}


def _kabul(store, patient, state="admitted", at=WHEN):
    """What Lane B's admission writes: a record whose source is `kabul`; discharged, a tombstone."""
    store.apply("h1", IdentityRecord(patient, family="TEST", given="SYNTH", state=state,
                                     source="kabul", updated_at=at))


@pytest.fixture
def app():
    audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
    application = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit,
                             identities=identities)
    application.state.test_identities = identities
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def _rows(app, event_type, patient=None):
    return app.state.audit.records(tenant="h1", event_type=event_type, patient_id=patient, limit=1000)


class TestAReadingForADischargedNumber:
    def test_is_dropped_before_the_engine_with_one_audit_row(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        queue = app.state.broadcaster.subscribe("h1")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-1"), headers=HEAD)
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        [row] = _rows(app, "reading_dropped_discharged")
        assert row.patient_id == "H-1" and row.subject == "heart_rate"
        assert row.payload == {"patient_id": "H-1", "code": "heart_rate"}
        assert _rows(app, "ingest", "H-1") == [] and _rows(app, "alert", "H-1") == []
        assert queue.empty(), "nothing is published for a dropped reading"
        assert client.get("/alerts/H-1", headers=HEAD).json()["alerts"] == []
        cards = client.get("/patients", headers=HEAD).json()["patients"]
        assert all(c["latest"]["heart_rate"] is None for c in cards if c["patient_id"] == "H-1")

    def test_is_dropped_at_clinical_too_one_row_per_entry(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.post("/clinical/H-1", headers=HEAD, json={"entries": [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.1}],
            "recorded_at": WHEN.isoformat()})
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        assert {row.subject for row in _rows(app, "reading_dropped_discharged")} == {"suspected_infection", "lactate"}
        assert _rows(app, "chart", "H-1") == []

    def test_a_malformed_chart_for_a_discharged_number_is_still_400(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.post("/clinical/H-1", headers=HEAD, json={"entries": [{"code": "nope", "value": 1}]})
        assert r.status_code == 400
        assert _rows(app, "reading_dropped_discharged") == []

    def test_a_profile_for_a_discharged_number_is_dropped_too(self, app, client):
        """G2-A11 (D3, final review): a profile is not a reading, so no audit row - but it must
        not create engine state for the tombstone nor publish its card."""
        _kabul(app.state.test_identities, "H-1", state="discharged")
        queue = app.state.broadcaster.subscribe("h1")
        r = client.put("/clinical/H-1/profile", json={"comorbidities": ["copd"]}, headers=HEAD)
        assert r.status_code == 200 and r.json() == {"patient_id": "H-1", "dropped": "discharged"}
        assert _rows(app, "profile", "H-1") == [] and _rows(app, "reading_dropped_discharged") == []
        assert queue.empty(), "nothing is published for a dropped profile"
        assert client.get("/alerts/H-1", headers=HEAD).json()["alerts"] == []
        cards = client.get("/patients", headers=HEAD).json()["patients"]
        assert all(c["latest"]["heart_rate"] is None for c in cards if c["patient_id"] == "H-1")

    def test_a_malformed_profile_for_a_discharged_number_is_still_400(self, app, client):
        _kabul(app.state.test_identities, "H-1", state="discharged")
        r = client.put("/clinical/H-1/profile", json={"baselines": {"lactate": {"low": 1, "high": 2}}}, headers=HEAD)
        assert r.status_code == 400
        assert _rows(app, "profile", "H-1") == []

    def test_a_his_discharged_patient_is_still_evaluated(self, app, client):
        client.post("/ingest", json=_his_patient("20239121", active=False), headers=HEAD)
        r = client.post("/ingest", json=_obs("heart_rate", 140, "20239121"), headers=HEAD)
        assert r.status_code == 200 and "alerts" in r.json()
        assert len(_rows(app, "ingest", "20239121")) == 1

    def test_an_admitted_kabul_patient_is_evaluated_as_any_other(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        r = client.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)
        assert r.status_code == 200 and [a["kind"] for a in r.json()["alerts"]] == ["news2"]


class TestIdentityResourcesAndKabul:
    def test_an_identity_resource_whose_source_is_kabul_is_refused(self, app, client):
        r = client.post("/ingest", json=_his_patient("H-3", source="kabul"), headers=HEAD)
        assert r.status_code == 400 and "kabul" in r.json()["detail"]
        assert app.state.test_identities.get("h1", "H-3") is None
        assert _rows(app, "identity") == []

    def test_a_his_resource_for_a_kabul_record_is_refused_and_changes_nothing(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        before = app.state.test_identities.get("h1", "H-2")
        r = client.post("/ingest", json=_his_patient("H-2", active=False), headers=HEAD)
        assert r.status_code == 200
        assert r.json() == {"patient_id": "H-2", "identity": "refused", "reason": "kabul"}
        assert app.state.test_identities.get("h1", "H-2") == before
        assert _rows(app, "identity") == []


class TestTheDischargeRetiresThePatient:
    def test_retire_ends_the_alerts_audits_them_and_publishes_one_removal(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        client.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)     # news2 fires
        queue = app.state.broadcaster.subscribe("h1")
        _kabul(app.state.test_identities, "H-2", state="discharged")                   # Lane B's tombstone write
        cleared = client.portal.call(app.state.retire_patient, "h1", "H-2")
        assert [(c.kind, c.reason) for c in cleared] == [("news2", "discharged")]
        [row] = _rows(app, "alert_cleared", "H-2")
        assert row.subject == "news2" and row.payload["reason"] == "discharged"
        frame = queue.get_nowait()
        assert frame["patient_id"] == "H-2" and frame["removed"] is True
        assert queue.empty(), "exactly one frame"
        assert client.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
        assert all(c["latest"]["heart_rate"] is None
                   for c in client.get("/patients", headers=HEAD).json()["patients"] if c["patient_id"] == "H-2")

    def test_retire_still_publishes_the_removal_when_the_audit_write_fails(self):
        """The in-memory end has happened whatever the audit did (final review): the ward is told
        even when an `alert_cleared` row cannot be written, and the error still reaches the caller."""
        audit, identities = _FailsOnce(), InMemoryIdentityStore()
        application = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit,
                                 identities=identities)
        with TestClient(application) as c:
            _kabul(identities, "H-2")
            c.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)      # news2 fires
            _kabul(identities, "H-2", state="discharged")
            queue = application.state.broadcaster.subscribe("h1")
            audit.fail_on = "alert_cleared"
            with pytest.raises(RuntimeError):
                c.portal.call(application.state.retire_patient, "h1", "H-2")
            frame = queue.get_nowait()
            assert frame["patient_id"] == "H-2" and frame["removed"] is True
            assert queue.empty(), "exactly one frame"
            assert c.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
            assert audit.records(tenant="h1", event_type="alert_cleared", limit=100) == [], (
                "the write failed, so there is no row")

    def test_retire_publishes_the_frame_it_is_given(self, app, client):
        _kabul(app.state.test_identities, "H-2")
        queue = app.state.broadcaster.subscribe("h1")
        client.portal.call(app.state.retire_patient, "h1", "H-2", {"patient_id": "H-2", "removed": True, "identity": {"unit_id": "u-1"}})
        assert queue.get_nowait()["identity"] == {"unit_id": "u-1"}

    def test_the_escalation_cycle_retires_an_alerting_tombstone_instead_of_paging(self, app, client):
        """Final review: both beds carry an IMMEDIATE alert (the only urgency `escalate()` pages),
        so the control proves the cycle would have paged; the tombstone must be retired instead.
        The cycle's instant is wall-clock + 30 min: the first-seen stamp is wall-clock too."""
        for patient in ("H-5", "H-2"):                                    # H-5 is the control
            _kabul(app.state.test_identities, patient)
            for code, value in IMMEDIATE:
                client.post("/ingest", json=_obs(code, value, patient), headers=HEAD)
        alerts = client.get("/alerts/H-2", headers=HEAD).json()["alerts"]
        assert alerts[0]["kind"] == "news2" and alerts[0]["urgency"] == "immediate"
        # Stamped NOW, as a discharge made here is: a tombstone stamped at the fixed WHEN crossed
        # the 24-hour retention (DISCHARGED_TTL) on 2026-10-27 08:30Z and the sweep then sent a
        # second `removed` frame every run after that (a date-dependent test, found 27.10).
        _kabul(app.state.test_identities, "H-2", state="discharged",
               at=datetime.now(timezone.utc))                                # the retire call never came
        queue = app.state.broadcaster.subscribe("h1")
        cycle_at = datetime.now(timezone.utc) + timedelta(minutes=30)     # past the 5-minute delay
        client.portal.call(app.state.escalation_cycle, cycle_at)
        assert len(_rows(app, "escalation", "H-5")) == 1, "the control is paged"
        assert _rows(app, "escalation", "H-2") == []
        # The nurse's "new" notification was written when the alert raised, before the cycle; what the
        # cycle adds for a paged chain is the doctor's "escalation" one - the control's, not the tombstone's.
        def triggers(patient):
            return [r.payload["trigger"] for r in _rows(app, "notification", patient)]
        assert "escalation" in triggers("H-5") and "escalation" not in triggers("H-2")
        [row] = _rows(app, "alert_cleared", "H-2")
        assert row.payload["reason"] == "discharged"
        frames = []
        while not queue.empty():       # the control's escalation republishes its card as well
            frames.append(queue.get_nowait())
        removed = [f for f in frames if f.get("removed") is True]
        assert len(removed) == 1 and removed[0]["patient_id"] == "H-2"
        assert client.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
        # a second cycle finds nothing to retire and writes nothing
        client.portal.call(app.state.escalation_cycle, cycle_at + timedelta(minutes=1))
        assert len(_rows(app, "alert_cleared", "H-2")) == 1

    def test_a_restart_retires_an_engine_patient_whose_identity_is_a_tombstone(self):
        """G2-A11 (D7b): the audit rows of a discharge were never written (a crash between the
        tombstone write and the retire call); the restart still agrees with the identity store."""
        audit, identities = InMemoryAuditLog(), InMemoryIdentityStore()
        first = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
        with TestClient(first) as c:
            _kabul(identities, "H-2")
            c.post("/ingest", json=_obs("heart_rate", 140, "H-2"), headers=HEAD)
            _kabul(identities, "H-2", state="discharged")
        second = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, identities=identities)
        with TestClient(second) as c:
            assert c.get("/alerts/H-2", headers=HEAD).json()["alerts"] == []
            assert all(card["latest"]["heart_rate"] is None
                       for card in c.get("/patients", headers=HEAD).json()["patients"] if card["patient_id"] == "H-2")
            assert audit.records(tenant="h1", event_type="alert_cleared", limit=100) == [], "the replay writes nothing"
