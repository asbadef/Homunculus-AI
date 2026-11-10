"""G3-03 (spec D5–D7): GET /patients/{id}/fluids against the DB-less app — the rights, the sums the server does,
a withdrawal, the weight and the urine rate, the fluid day from Görevlerim's settings, and a bolus withdrawn
re-running the septic-shock rule. Synthetic patients and values only (CLAUDE.md rule 6)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.tasks import InMemoryTaskStore, TaskSettings

TOKEN = "tok"
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
    "viewer-jwt": Caller(hospital="h1", actor="hem.zeynep", groups=("nurse",), perms=frozenset({"tasks.view"})),
}
WHY = "yanlış hastaya girildi"


async def _resolve(credential):
    return PEOPLE.get(credential)


@pytest.fixture()
def store():
    return InMemoryTaskStore(zones={"h1": "UTC"})


@pytest.fixture()
def client(store):
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, tasks=store)) as c:
        yield c


def _chart(client, entries, pid="S-001"):
    r = client.post(f"/clinical/{pid}", json={"entries": entries}, headers=NURSE)
    assert r.status_code == 200, r.text
    return r.json()


def _retract(client, entry, pid="S-001"):
    return client.post(f"/clinical/{pid}/entries/{entry}/retract", json={"reason": WHY}, headers=NURSE)


def _fluids(client, pid="S-001", headers=NURSE):
    return client.get(f"/patients/{pid}/fluids", headers=headers)


def test_it_needs_board_view(client):
    _chart(client, [{"code": "urine_output_ml", "value": 100}])
    assert client.get("/patients/S-001/fluids").status_code == 401
    assert _fluids(client, headers=VIEWER).status_code == 403
    assert _fluids(client).status_code == 200


def test_an_unknown_patient_is_404(client):
    assert _fluids(client, pid="S-404").status_code == 404


def test_the_server_sums_today(client):
    _chart(client, [{"code": "iv_fluid_ml", "value": 500}, {"code": "urine_output_ml", "value": 300}])
    out = _fluids(client).json()
    today = out["totals"]["today"]
    assert (today["in"], today["out"], today["balance"]) == (500, 300, 200)
    assert today["by_code"] == {"iv_fluid_ml": 500, "urine_output_ml": 300}
    assert out["sofa_renal_reference"]["source"] == "sepsis-3-jama-2016"
    assert len(out["hours"]) == 24


def test_a_withdrawn_entry_leaves_the_sum_and_stays_listed(client):
    saved = _chart(client, [{"code": "urine_output_ml", "value": 300}, {"code": "urine_output_ml", "value": 100}])
    wrong = saved["entries"][1]["entry"]
    assert _retract(client, wrong).status_code == 200
    out = _fluids(client).json()
    assert out["totals"]["today"]["out"] == 300
    listed = {e["entry"]: e for e in out["entries"]}
    assert set(listed) == {e["entry"] for e in saved["entries"]}
    assert listed[wrong]["retracted"]["reason"] == WHY
    assert listed[wrong]["retracted"]["by"] == "hem.ayse"
    assert listed[saved["entries"][0]["entry"]]["retracted"] is None


def test_the_weight_is_the_last_charted_and_gives_the_urine_rate(client):
    _chart(client, [{"code": "urine_output_ml", "value": 300}])
    assert (_fluids(client).json()["weight_kg"], _fluids(client).json()["urine_ml_kg_h_last_6h"]) == (None, None)
    _chart(client, [{"code": "weight_kg", "value": 70}])
    out = _fluids(client).json()
    assert out["weight_kg"] == 70
    assert out["urine_ml_kg_h_last_6h"] == round(300 / 6 / 70, 2)


def test_the_fluid_day_starts_at_the_first_shift_start(client, store):
    _chart(client, [{"code": "urine_output_ml", "value": 100}])
    now = datetime.now(timezone.utc)
    start = datetime.fromisoformat(_fluids(client).json()["day"]["start"])
    assert (start.hour, start.minute) == (8, 0) and start <= now < start + timedelta(hours=24)  # the default 08:00
    store.save_settings("h1", TaskSettings(shift_start_a=7, shift_start_b=19), by="admin.lbys", now=now)
    out = _fluids(client).json()
    start = datetime.fromisoformat(out["day"]["start"])
    assert start.utcoffset() == timedelta(0)
    assert (start.hour, start.minute) == (7, 0) and start <= now < start + timedelta(hours=24)
    split = datetime.fromisoformat(out["shifts"][0]["end"])
    assert split == start + timedelta(hours=12) == datetime.fromisoformat(out["shifts"][1]["start"])


def test_withdrawing_a_bolus_reruns_the_septic_shock_rule(client):
    """D4: the bolus is withdrawable; the rebuilt patient is no longer adequately resuscitated (30 mL/kg), so the
    septic-shock rule no longer fires on it — and the ledger no longer counts the bolus."""
    _chart(client, [{"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                    {"code": "norepinephrine_rate", "value": 0.08}, {"code": "weight_kg", "value": 50}])
    given = _chart(client, [{"code": "crystalloid_bolus_ml", "value": 1600}])     # 1600 mL / 50 kg = 32 mL/kg
    assert "septic_shock" in given["alerts"]
    assert _fluids(client).json()["totals"]["today"]["by_code"] == {"crystalloid_bolus_ml": 1600}
    r = _retract(client, given["entries"][0]["entry"])
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["alerts"], list) and "septic_shock" not in r.json()["alerts"]
    assert _fluids(client).json()["totals"]["today"]["in"] == 0
