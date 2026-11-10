"""G3-03 (spec D2–D4): the fluid codes at /clinical — accepted, bounded, time-ruled, withdrawable.

The door answers a refusal with 400 (tests/test_bedside_door.py, test_bedside_preview.py), not 422.
Synthetic patients and values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.clinical import AT_FUTURE, AT_TOO_OLD, FLUID_CODES, RETRACTABLE_CODES
from homunculus.api.identity import Caller

TOKEN = "tok"
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
NEW = ["iv_fluid_ml", "enteral_ml", "blood_product_ml", "other_intake_ml", "drain_output_ml", "other_output_ml"]


async def _resolve(credential):
    return PEOPLE.get(credential)


@pytest.fixture()
def client():
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve)) as c:
        yield c


def _chart(client, entries, at=None):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at.isoformat()
    return client.post("/clinical/S-001", json=body, headers=NURSE)


def test_the_eight_fluid_codes_and_their_withdrawal():
    assert FLUID_CODES == frozenset(NEW + ["crystalloid_bolus_ml", "urine_output_ml"])
    assert FLUID_CODES <= RETRACTABLE_CODES


@pytest.mark.parametrize("code", NEW)
def test_a_new_code_is_accepted_and_bounded(client, code):
    assert _chart(client, [{"code": code, "value": 250}]).status_code == 200
    assert _chart(client, [{"code": code, "value": 5000}]).status_code == 200
    assert _chart(client, [{"code": code, "value": 5001}]).status_code == 400
    assert _chart(client, [{"code": code, "value": -1}]).status_code == 400


def test_the_bolus_keeps_its_own_bound(client):
    assert _chart(client, [{"code": "crystalloid_bolus_ml", "value": 10000}]).status_code == 200


def test_the_time_rule_covers_fluids(client):
    now = datetime.now(timezone.utc)
    old = _chart(client, [{"code": "urine_output_ml", "value": 100}], now - timedelta(hours=25))
    assert (old.status_code, old.json()["detail"]) == (400, AT_TOO_OLD)
    ahead = _chart(client, [{"code": "urine_output_ml", "value": 100}], now + timedelta(minutes=10))
    assert (ahead.status_code, ahead.json()["detail"]) == (400, AT_FUTURE)
    assert _chart(client, [{"code": "urine_output_ml", "value": 100}], now - timedelta(hours=23)).status_code == 200


@pytest.mark.parametrize("code", ["crystalloid_bolus_ml", *NEW])
def test_the_time_rule_covers_every_fluid_code(client, code):
    now = datetime.now(timezone.utc)
    assert _chart(client, [{"code": code, "value": 100}], now - timedelta(hours=25)).status_code == 400


def test_a_fluid_entry_and_a_bolus_can_be_withdrawn(client):
    saved = _chart(client, [{"code": "drain_output_ml", "value": 80}, {"code": "crystalloid_bolus_ml", "value": 500}])
    assert saved.status_code == 200, saved.text
    for item in saved.json()["entries"]:
        r = client.post(f"/clinical/S-001/entries/{item['entry']}/retract", json={"reason": "yanlış hastaya girildi"},
                        headers=NURSE)
        assert r.status_code == 200, r.text
        assert r.json()["code"] == item["code"]
