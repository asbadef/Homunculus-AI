"""The medication picture the board publishes — the pharmacist's screen has to read something.

The pharmacist role existed and could reach no screen this system did not also show to everyone
else. The one clinical rule here that is squarely their business is the 1-hour antibiotic window
after sepsis recognition, and it was reachable only as an alert that had already fired — which is
exactly too late to be useful to the person who could have stopped it firing.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
T0 = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


def _chart(client, pid, entries, at=T0):
    return client.post(f"/clinical/{pid}",
                       json={"entries": entries, "recorded_at": at.isoformat()}, headers=AUTH)


def _bed(client, pid):
    rows = client.get("/patients", headers=AUTH).json()["patients"]
    return next(r for r in rows if r["patient_id"] == pid)


def _raise_sepsis(client, pid="bed-1", at=T0):
    return _chart(client, pid, [
        {"code": "suspected_infection", "value": 1},
        {"code": "platelets", "value": 80},
        {"code": "creatinine", "value": 3.5},
    ], at)


class TestInfusions:
    def test_pressor_rates_reach_the_board(self, client):
        _chart(client, "bed-1", [{"code": "norepinephrine_rate", "value": 0.12}])
        meds = _bed(client, "bed-1")["meds"]
        assert meds["pressors"]["norepinephrine"] == 0.12
        assert meds["on_pressor"] is True

    def test_a_bed_on_nothing_says_so_rather_than_showing_zeros_as_doses(self, client):
        _chart(client, "bed-1", [{"code": "lactate", "value": 1.2}])
        meds = _bed(client, "bed-1")["meds"]
        assert meds["on_pressor"] is False
        assert meds["pressors"]["norepinephrine"] is None


class TestTheAntibioticClock:
    def test_no_clock_before_sepsis_is_recognised(self, client):
        _chart(client, "bed-1", [{"code": "lactate", "value": 1.2}])
        assert _bed(client, "bed-1")["meds"]["antibiotic_clock"] is None

    def test_recognition_starts_a_one_hour_clock(self, client):
        _raise_sepsis(client)
        clock = _bed(client, "bed-1")["meds"]["antibiotic_clock"]
        assert clock is not None
        assert clock["recognized_at"] == T0.isoformat()
        assert clock["deadline"] == (T0 + timedelta(hours=1)).isoformat()

    def test_an_administration_inside_the_window_is_recorded_as_met(self, client):
        _raise_sepsis(client)
        _chart(client, "bed-1", [{"code": "antibiotic_administered", "value": 1}],
               at=T0 + timedelta(minutes=35))
        meds = _bed(client, "bed-1")["meds"]
        assert meds["antibiotic_given"] is True
        assert meds["antibiotic_clock"]["met"] is True
        assert meds["antibiotic_clock"]["elapsed_sec"] == 35 * 60

    def test_an_administration_after_the_window_is_recorded_as_missed(self, client):
        _raise_sepsis(client)
        _chart(client, "bed-1", [{"code": "antibiotic_administered", "value": 1}],
               at=T0 + timedelta(minutes=95))
        assert _bed(client, "bed-1")["meds"]["antibiotic_clock"]["met"] is False

    def test_an_uncharted_antibiotic_is_unknown_not_a_missed_dose(self, client):
        """Rendering 'nobody charted it' as 'not given' would accuse a ward of missing a deadline
        it may well have met and simply not recorded here."""
        _raise_sepsis(client)
        meds = _bed(client, "bed-1")["meds"]
        assert meds["antibiotic_given"] is None
        assert meds["antibiotic_clock"]["met"] is None

    def test_charting_explicitly_that_none_was_given_is_not_the_same_as_silence(self, client):
        _raise_sepsis(client)
        _chart(client, "bed-1", [{"code": "antibiotic_administered", "value": 0}],
               at=T0 + timedelta(minutes=10))
        assert _bed(client, "bed-1")["meds"]["antibiotic_given"] is False


class TestContextNotAdvice:
    def test_the_renal_context_a_pharmacist_reads_is_published_as_a_number(self, client):
        """Creatinine and weight travel so the screen can show them. The system states them; it
        does not turn them into a dose — that would be an order, and the register forbids one."""
        _chart(client, "bed-1", [{"code": "creatinine", "value": 2.4},
                                 {"code": "weight_kg", "value": 72}])
        meds = _bed(client, "bed-1")["meds"]
        assert meds["creatinine"] == 2.4 and meds["weight_kg"] == 72
