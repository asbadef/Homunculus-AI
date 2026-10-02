"""The board tells the ward what the sepsis criterion is being judged against.

Two facts decided whether a sepsis alert could exist at all, and neither was visible on any
screen: whether anyone had charted a suspected infection (the gate the whole branch sits behind)
and what baseline SOFA the total was compared against. A physician looking at a quiet bed could
not tell "this patient is fine" from "nobody has charted an infection, so nothing was evaluated".
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
WHEN = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def client():
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
    with TestClient(app) as c:
        yield c


def _chart(client, pid, code, value):
    return client.post(f"/clinical/{pid}",
                       json={"entries": [{"code": code, "value": value}],
                             "recorded_at": WHEN.isoformat()}, headers=AUTH)


def _bed(client, pid):
    rows = client.get("/patients", headers=AUTH).json()["patients"]
    return next(r for r in rows if r["patient_id"] == pid)


def test_uncharted_infection_is_none_not_false(client):
    """Silence must not be published as a clinical statement."""
    _chart(client, "bed-1", "creatinine", 3.5)
    assert _bed(client, "bed-1")["sepsis"]["suspected_infection"] is None


def test_charting_infection_shows_on_the_board(client):
    _chart(client, "bed-1", "creatinine", 3.5)
    _chart(client, "bed-1", "suspected_infection", 1.0)
    sep = _bed(client, "bed-1")["sepsis"]
    assert sep["suspected_infection"] is True
    assert sep["sofa"] == 3


def test_baseline_is_marked_assumed_until_someone_charts_it(client):
    _chart(client, "bed-1", "creatinine", 3.5)
    sep = _bed(client, "bed-1")["sepsis"]
    assert sep["baseline_sofa"] is None and sep["baseline_assumed"] is True
    assert sep["rise"] == 3           # against the assumed zero

    client.put("/clinical/bed-1/profile", json={"baseline_sofa": 3}, headers=AUTH)
    sep = _bed(client, "bed-1")["sepsis"]
    assert sep["baseline_sofa"] == 3 and sep["baseline_assumed"] is False
    assert sep["rise"] == 0           # this is simply who the patient is


def test_a_charted_zero_baseline_is_not_an_assumed_one(client):
    """A physician asserting 'no preexisting organ dysfunction' is information; the card must not
    render it as though nobody had looked."""
    _chart(client, "bed-1", "creatinine", 3.5)
    client.put("/clinical/bed-1/profile", json={"baseline_sofa": 0}, headers=AUTH)
    sep = _bed(client, "bed-1")["sepsis"]
    assert sep["baseline_sofa"] == 0
    assert sep["baseline_assumed"] is False
