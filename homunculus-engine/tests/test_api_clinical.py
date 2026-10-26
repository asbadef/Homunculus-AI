"""Charting a clinical fact reaches the engine — and revives the sepsis branch.

The finding this closes: the dashboard let a physician enter a noradrenaline dose, a fluid
volume and an ICD-10 diagnosis, wrote all of it to the browser's own store, and lost it on
reload. The engine never saw any of it. `septic_shock.evaluate` returns at its first line
unless `suspected_infection` is set, and nothing anywhere could set it — so on a real ward the
sepsis, septic-shock, under-resuscitation and antibiotic-clock alerts could not fire at all.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.clinical import ClinicalEntryError, build_entries
from homunculus.canonical import SignalCode

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


class _FailsOnce(InMemoryAuditLog):
    """An audit log whose next append of `fail_on` raises once — the database going away
    mid-request."""

    def __init__(self):
        super().__init__()
        self.fail_on = None

    def append(self, event):
        if event.event_type == self.fail_on:
            self.fail_on = None
            raise RuntimeError("audit down")
        return super().append(event)


def _chart(client, patient_id: str, entries: list[dict], at: datetime = WHEN):
    return client.post(f"/clinical/{patient_id}",
                       json={"entries": entries, "recorded_at": at.isoformat()},
                       headers=AUTH)


class TestTheDoorOpens:
    def test_a_charted_fact_is_accepted(self, client):
        r = _chart(client, "bed-3", [{"code": "suspected_infection", "value": 1}])
        assert r.status_code == 200
        assert r.json()["charted"] == 1

    def test_it_reaches_the_board(self, client):
        _chart(client, "bed-3", [{"code": "lactate", "value": 3.4}])
        board = client.get("/patients", headers=AUTH).json()["patients"]
        assert any(b["patient_id"] == "bed-3" for b in board)

    def test_several_facts_chart_in_one_request(self, client):
        r = _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1},
            {"code": "weight_kg", "value": 78},
            {"code": "norepinephrine_rate", "value": 0.08},
        ])
        assert r.json()["charted"] == 3

    def test_the_entry_is_attributed_in_the_audit(self, client):
        _chart(client, "bed-3", [{"code": "gcs", "value": 11}])
        records = client.get("/audit", headers=AUTH).json()["records"]
        charted = [r for r in records if r["event_type"] == "chart"]
        assert charted, "charting must leave an audit record"
        assert charted[0]["subject"] == "gcs"
        # The tenant token is a machine credential shared by the bridge — recorded as exactly
        # that rather than attributed to a person nobody could later be asked about.
        assert charted[0]["payload"]["charted_by"] == "tenant-token"


class TestTheSepsisBranchRevives:
    """The point of the whole endpoint."""

    def test_without_suspected_infection_the_branch_stays_silent(self, client):
        # Organ dysfunction alone: SOFA >= 2 from MAP < 70 and platelets < 100.
        r = _chart(client, "bed-3", [{"code": "platelets", "value": 80}])
        assert "sepsis" not in r.json()["alerts"]

    def test_charting_suspected_infection_lets_sepsis_fire(self, client):
        _chart(client, "bed-3", [{"code": "platelets", "value": 80}])
        r = _chart(client, "bed-3", [{"code": "suspected_infection", "value": 1}])
        assert "sepsis" in r.json()["alerts"]

    def test_a_pressor_charted_by_hand_moves_the_cardiovascular_limb_of_sofa(self, client):
        _chart(client, "bed-3", [{"code": "suspected_infection", "value": 1}])
        before = client.get("/patients", headers=AUTH).json()["patients"][0]["latest"]["sofa"]
        _chart(client, "bed-3", [{"code": "norepinephrine_rate", "value": 0.12}])
        after = client.get("/patients", headers=AUTH).json()["patients"][0]["latest"]["sofa"]
        assert after > before   # 0.12 ug/kg/min > 0.1 -> 4 points

    def test_weight_and_fluid_together_let_shock_be_told_from_under_resuscitation(self, client):
        """Without weight, "30 mL/kg" cannot be evaluated and adequacy is never true — which is
        exactly the distinction between septic shock and a patient who has simply not been
        given fluid yet."""
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1},
            {"code": "lactate", "value": 3.4},
            {"code": "norepinephrine_rate", "value": 0.08},
            {"code": "weight_kg", "value": 50},
        ])
        r = _chart(client, "bed-3", [{"code": "crystalloid_bolus_ml", "value": 1600}])
        assert "septic_shock" in r.json()["alerts"]   # 1600 mL / 50 kg = 32 mL/kg

    def test_an_antibiotic_charted_stops_the_clock_complaining(self, client):
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 80}])
        due = _chart(client, "bed-3", [{"code": "creatinine", "value": 2.4}])
        assert "antibiotic_due" in due.json()["alerts"]

        given = _chart(client, "bed-3", [{"code": "antibiotic_administered", "value": 1}],
                       at=WHEN + timedelta(minutes=20))
        assert "antibiotic_due" not in given.json()["alerts"]


class TestTheEvaluationInstant:
    """G2-A2 (X10): this door evaluates at min(recorded_at, wall clock), as /ingest does — a chart
    stamped in the future cannot age the readings beside it. The audit row keeps the stamp."""

    def test_a_chart_stamped_in_the_future_does_not_age_the_vitals(self, client):
        wall = datetime.now(timezone.utc)
        taken = (wall - timedelta(minutes=45)).isoformat()
        for code, value in (("resp_rate", 26), ("spo2", 91), ("sbp", 88)):     # NEWS2 9: high
            fhir = {"resourceType": "Observation",
                    "code": {"coding": [{"system": "x", "code": code}]},
                    "subject": {"reference": "Patient/bed-3"}, "effectiveDateTime": taken,
                    "valueQuantity": {"value": value, "unit": ""}}
            assert client.post("/ingest", json=fhir, headers=AUTH).status_code == 200
        ahead = wall + timedelta(minutes=30)
        r = _chart(client, "bed-3", [{"code": "weight_kg", "value": 78}], at=ahead)
        assert r.status_code == 200
        (board,) = client.get("/patients", headers=AUTH).json()["patients"]
        assert board["latest"]["news2"]["stale"] == []
        news2 = next(a for a in board["alerts"] if a["kind"] == "news2")
        assert (news2["severity"], news2["stale_inputs"]) == ("high", [])
        assert "Held while inputs are stale" not in news2["clinical_reasoning"]
        (row,) = [r for r in client.get("/audit", headers=AUTH).json()["records"]
                  if r["event_type"] == "chart"]
        assert row["payload"]["obs_ts"] == ahead.isoformat()


class TestWhatMayNotBeCharted:
    def test_a_device_channel_cannot_be_typed_in_by_hand(self, client):
        """A hand-typed heart rate would be indistinguishable from a monitored one."""
        r = _chart(client, "bed-3", [{"code": "heart_rate", "value": 88}])
        assert r.status_code == 400
        assert "cihazdan" in r.json()["detail"]

    def test_an_unknown_field_is_refused_by_name(self, client):
        r = _chart(client, "bed-3", [{"code": "blood_pressure_vibes", "value": 1}])
        assert r.status_code == 400
        assert "bilinmeyen" in r.json()["detail"]

    def test_a_slipped_decimal_point_is_refused(self, client):
        """80 kg typed as 800. The bound exists to catch the keyboard, not to argue with a
        clinician about a plausible value."""
        r = _chart(client, "bed-3", [{"code": "weight_kg", "value": 800}])
        assert r.status_code == 400
        assert "aralığın" in r.json()["detail"]

    def test_a_flag_only_takes_yes_or_no(self, client):
        r = _chart(client, "bed-3", [{"code": "suspected_infection", "value": 3}])
        assert r.status_code == 400

    def test_one_bad_entry_rejects_the_whole_request(self, client):
        """A half-applied chart is worse than a refused one: nobody can tell which half landed."""
        r = _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1},
            {"code": "weight_kg", "value": 9000},
        ])
        assert r.status_code == 400
        board = client.get("/patients", headers=AUTH).json()["patients"]
        assert board == [] or all(b["patient_id"] != "bed-3" for b in board)

    def test_an_empty_request_is_refused(self, client):
        assert _chart(client, "bed-3", []).status_code == 400

    def test_charting_needs_a_credential(self, client):
        r = client.post("/clinical/bed-3", json={"entries": [{"code": "gcs", "value": 11}]})
        assert r.status_code == 401


class TestBuildEntries:
    """The pure layer, where the reasons live."""

    def test_a_timestamp_without_a_zone_is_refused(self):
        """The NCE server's local clock ran an hour off the UTC stamp in its own filenames; a
        zoneless time is the shape of that bug."""
        with pytest.raises(ClinicalEntryError, match="saat dilimi"):
            build_entries("bed-1", [{"code": "gcs", "value": 11}], charted_by="u",
                          recorded_at=datetime(2026, 9, 8, 9, 0))

    def test_the_unit_is_the_engines_not_the_callers(self):
        """The rules read ug/kg/min directly; a caller free to name the unit would be scored on
        the wrong scale without anything looking wrong."""
        [entry] = build_entries("bed-1", [{"code": "norepinephrine_rate", "value": 0.08,
                                           "unit": "mg/h"}], charted_by="u", recorded_at=WHEN)
        assert entry.observation.unit == "ug/kg/min"

    def test_provenance_says_a_person_charted_it(self):
        [entry] = build_entries("bed-1", [{"code": "gcs", "value": 11}],
                                charted_by="dr-elif", recorded_at=WHEN)
        assert entry.observation.source_device == "clinician"
        assert entry.charted_by == "dr-elif"

    def test_the_new_chemistry_fields_are_chartable_while_there_is_no_lab_feed(self):
        codes = [{"code": c, "value": v} for c, v in
                 [("arterial_ph", 7.24), ("bicarbonate", 18), ("sodium", 131),
                  ("potassium", 5.6), ("haematocrit", 28), ("white_cell_count", 18.4)]]
        built = build_entries("bed-1", codes, charted_by="u", recorded_at=WHEN)
        assert {e.observation.code for e in built} == {
            SignalCode.ARTERIAL_PH, SignalCode.BICARBONATE, SignalCode.SODIUM,
            SignalCode.POTASSIUM, SignalCode.HAEMATOCRIT, SignalCode.WHITE_CELL_COUNT}


class TestChartingEndsAnAlert:
    """G2-A1 (O17): charting is often what ends an alert — the antibiotic given, the infection
    ruled out — and this door ends it exactly as /ingest does."""

    def _rows(self, client, kind, event_type):
        rows = client.get("/audit", params={"patient_id": "bed-3", "limit": 10000},
                          headers=AUTH).json()["records"]
        return [r for r in rows if r["subject"] == kind and r["event_type"] == event_type]

    def _alert(self, client, kind):
        board = client.get("/patients", headers=AUTH).json()["patients"]
        return next((a for b in board for a in b["alerts"] if a["kind"] == kind), None)

    def _ingest(self, client, code, value, minute):
        fhir = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": code}]},
                "subject": {"reference": "Patient/bed-3"},
                "effectiveDateTime": (WHEN + timedelta(minutes=minute)).isoformat(),
                "valueQuantity": {"value": value, "unit": ""}}
        assert client.post("/ingest", json=fhir, headers=AUTH).status_code == 200

    def test_charting_the_antibiotic_ends_the_clock_and_its_episode(self, client):
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 80}])
        _chart(client, "bed-3", [{"code": "creatinine", "value": 2.4}])
        assert self._alert(client, "antibiotic_due") is not None
        _chart(client, "bed-3", [{"code": "antibiotic_administered", "value": 1}],
               at=WHEN + timedelta(minutes=20))
        assert self._alert(client, "antibiotic_due") is None
        (closed,) = self._rows(client, "antibiotic_due", "alert_cleared")
        assert (closed["payload"]["reason"], closed["payload"]["severity"]) == ("resolved", "high")

    def test_a_critical_that_charting_ends_latches_until_it_is_acknowledged(self, client):
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
            {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50}])
        _chart(client, "bed-3", [{"code": "crystalloid_bolus_ml", "value": 1600}])
        assert self._alert(client, "septic_shock")["resolved_at"] is None
        _chart(client, "bed-3", [{"code": "suspected_infection", "value": 0}],
               at=WHEN + timedelta(minutes=10))
        shock = self._alert(client, "septic_shock")
        assert shock["resolved_at"] is not None and shock["acknowledged"] is False
        assert self._alert(client, "sepsis") is None, "HIGH does not latch"
        _chart(client, "bed-3", [{"code": "lactate", "value": 3.0}], at=WHEN + timedelta(minutes=15))
        assert len(self._rows(client, "septic_shock", "first_seen")) == 1, \
            "a latched alert keeps its episode's stamp: charting does not open another"

    def test_a_critical_that_fired_and_ended_in_one_request_is_never_stamped(self, client):
        """Charting stamps this patient's FIRING alerts only: a latched one was never seen firing
        here, and a stamp now would open an episode after its end."""
        _chart(client, "bed-3", [
            {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
            {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50},
            {"code": "crystalloid_bolus_ml", "value": 1600},
            {"code": "suspected_infection", "value": 0}])
        assert self._alert(client, "septic_shock")["resolved_at"] is not None, "it latched"
        _chart(client, "bed-3", [{"code": "lactate", "value": 3.0}], at=WHEN + timedelta(minutes=5))
        assert self._rows(client, "septic_shock", "first_seen") == []

    def test_a_kind_charting_ended_tells_the_nurse_again_when_it_returns(self, client):
        """Pins the notifier prune on this door (D5): charting that ends an acknowledged alert takes
        the kind out of the live keys, so a later reading that brings it back is a new episode."""
        for code, value in [("suspected_infection", 1.0), ("weight_kg", 100.0),
                            ("crystalloid_bolus_ml", 3000.0), ("map", 60.0),
                            ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
            self._ingest(client, code, value, minute=0)
        r = client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
                        headers=AUTH)
        assert r.status_code == 200
        _chart(client, "bed-3", [{"code": "suspected_infection", "value": 0}],
               at=WHEN + timedelta(minutes=1))
        assert self._alert(client, "septic_shock") is None, "answered, so it left with its rule"
        self._ingest(client, "suspected_infection", 1.0, minute=2)
        assert [r["payload"]["trigger"] for r in self._rows(client, "septic_shock", "notification")] \
            == ["new", "new"]

    def test_a_shock_ended_and_restarted_in_one_request_tells_the_nurse_again(self, client):
        """Pins the notifier prune after EACH entry (D5): `[norepinephrine 0, dopamine 5]` ends an
        acknowledged shock and starts a new one inside one request. The acknowledgement is lost, as
        a new episode's should be; the nurse's dedup has to be re-armed between the two entries, or
        the end-of-request prune finds the shock live again and the new episode goes untold. This
        door tells nobody itself — the next reading of the bed does."""
        for code, value in [("suspected_infection", 1.0), ("weight_kg", 100.0),
                            ("crystalloid_bolus_ml", 3000.0), ("map", 60.0),
                            ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
            self._ingest(client, code, value, minute=0)
        r = client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
                        headers=AUTH)
        assert r.status_code == 200
        _chart(client, "bed-3", [{"code": "norepinephrine_rate", "value": 0},
                                 {"code": "dopamine_rate", "value": 5}],
               at=WHEN + timedelta(minutes=1))
        shock = self._alert(client, "septic_shock")
        assert shock is not None and shock["acknowledged"] is False, "a new episode: not answered"
        self._ingest(client, "map", 60.0, minute=2)
        assert [r["payload"]["trigger"] for r in self._rows(client, "septic_shock", "notification")] \
            == ["new", "new"]

    def test_a_chart_row_that_fails_to_audit_does_not_take_a_critical_off_the_board(self):
        """The lifecycle hook follows the evaluation directly, before any audit write: an audit
        that fails mid-request cannot leave an unacknowledged critical off the board."""
        audit = _FailsOnce()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit)
        with TestClient(app, raise_server_exceptions=False) as c:
            _chart(c, "bed-3", [
                {"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50},
                {"code": "crystalloid_bolus_ml", "value": 1600}])
            assert self._alert(c, "septic_shock")["resolved_at"] is None
            audit.fail_on = "chart"
            ended = _chart(c, "bed-3", [{"code": "suspected_infection", "value": 0}],
                           at=WHEN + timedelta(minutes=10))
            assert ended.status_code == 500
            shock = self._alert(c, "septic_shock")
            assert shock is not None, "an unacknowledged critical must not vanish (D2)"
            assert shock["resolved_at"] is not None and shock["acknowledged"] is False
