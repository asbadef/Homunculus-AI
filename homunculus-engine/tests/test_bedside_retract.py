"""G3-01 (D10–D12, X3, X4, X11): «hatalı giriş» through the API. A withdrawn hand entry leaves every score
as if it had never been charted; the trail keeps both rows; a restart agrees; an alert the withdrawal
uncovers is told; the refusals hold and write nothing. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.clinical import (
    RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_NEEDS_PERSON, RETRACT_REASON_SHORT, RETRACT_UNKNOWN,
)
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
VIEWER = {"Authorization": "Bearer viewer-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart"})),
    "viewer-jwt": Caller(hospital="h1", actor="dr.elif", groups=("physician",), perms=frozenset({"board.view"})),
}
WHY = "yazım hatası — 26 değil 16"
# RR 26, SpO₂ 91, systolic 88: NEWS2 9, the immediate band.
RISKY = [{"code": "resp_rate", "value": 26}, {"code": "spo2", "value": 91}, {"code": "sbp", "value": 88}]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit=None, identities=None) -> TestClient:
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve,
                     audit=audit if audit is not None else InMemoryAuditLog(), identities=identities)
    return TestClient(app)


@pytest.fixture()
def client():
    with _app() as c:
        yield c


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(c, entries, at, pid="bed-3") -> dict[str, int]:
    """Chart as the nurse; the answer's `entries` by code (one value per code per call here)."""
    r = c.post(f"/clinical/{pid}", json={"entries": entries, "recorded_at": at}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _retract(c, entry, reason=WHY, headers=NURSE, pid="bed-3"):
    return c.post(f"/clinical/{pid}/entries/{entry}/retract", json={"reason": reason}, headers=headers)


def _card(c, pid="bed-3"):
    return next(p for p in c.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


def _firing(card):
    """The alerts firing now. Every alert on the card carries `resolved_at`: None while it fires
    (api/board.py `_merge_alert`), the time its rule stopped once latched (`_latched_alerts`)."""
    return sorted(a["kind"] for a in card["alerts"] if a["resolved_at"] is None)


def _latched(card):
    return sorted(a["kind"] for a in card["alerts"] if a["resolved_at"] is not None)


def _news2(card):
    n = card["latest"]["news2"]
    return {k: n[k] for k in ("total", "partial", "missing", "red_param", "breakdown", "stale", "measured_at")}


def _rows(c, kind):
    return c.app.state.audit.records(tenant="h1", event_type=kind, limit=100)


class TestTheWithdrawalScoresAsIfNeverCharted:
    def test_withdrawing_the_value_that_raised_news2(self, client):
        at = _ago(5)
        ids = _chart(client, RISKY, at)
        assert "news2" in _firing(_card(client))
        r = _retract(client, ids["resp_rate"])
        assert r.status_code == 200, r.text
        assert (r.json()["retracted"], r.json()["code"]) == (ids["resp_rate"], "resp_rate")
        with _app() as fresh:
            _chart(fresh, [e for e in RISKY if e["code"] != "resp_rate"], at)
            assert _news2(_card(client)) == _news2(_card(fresh))
            assert _firing(_card(client)) == _firing(_card(fresh))

    def test_withdrawing_a_map_that_turned_sepsis_on_leaves_no_antibiotic_clock(self, client):
        """X4: removing the value alone would not stop the hour the recognition started (pipeline.py)."""
        at = _ago(5)
        base = [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}]
        _chart(client, base, at)
        ids = _chart(client, [{"code": "map", "value": 60}], at)
        assert _card(client)["meds"]["antibiotic_clock"] is not None     # SOFA 2 with the MAP: the hour runs
        assert _retract(client, ids["map"]).status_code == 200
        after = _card(client)
        assert after["meds"]["antibiotic_clock"] is None
        assert all(a["severity"] == "critical" for a in after["alerts"] if a["resolved_at"] is not None)  # only a critical latches
        with _app() as fresh:
            _chart(fresh, base, at)
            assert _firing(after) == _firing(_card(fresh))
            assert after["sepsis"] == _card(fresh)["sepsis"]


class TestTheTrailKeepsBoth:
    def test_the_chart_row_stays_and_the_withdrawal_names_it(self, client):
        at = _ago(5)
        ids = _chart(client, RISKY, at)
        assert _retract(client, ids["resp_rate"], reason=f"  {WHY}  ").status_code == 200
        assert ids["resp_rate"] in [r.id for r in _rows(client, "chart")]
        (row,) = _rows(client, RETRACT)
        assert (row.patient_id, row.subject) == ("bed-3", "resp_rate")
        assert row.payload == {"entry": ids["resp_rate"], "value": 26, "obs_ts": at, "reason": WHY,
                               "retracted_by": "hem.ayse"}


class TestTheRestartAgrees:
    def test_a_restart_skips_the_withdrawn_entry(self):
        """D12: the replay reads the withdrawals first and scores as the live rebuild did."""
        log, at = InMemoryAuditLog(), _ago(5)
        with _app(audit=log) as first:
            ids = _chart(first, RISKY, at)
            assert _retract(first, ids["resp_rate"]).status_code == 200
            live = _card(first)
        with _app(audit=log) as second:
            again = _card(second)
            assert _news2(again) == _news2(live)
            assert _firing(again) == _firing(live)


class TestTheNurseIsToldOfWhatItUncovers:
    def test_a_withdrawal_that_brings_an_immediate_alert_back_tells_the_nurse(self, client):
        """X3: three wrong normal values hid an immediate NEWS2; withdrawn one by one, the last brings it back."""
        _chart(client, RISKY, _ago(10))                                      # NEWS2 9: told once
        ids = _chart(client, [{"code": "resp_rate", "value": 16}, {"code": "spo2", "value": 97},
                              {"code": "sbp", "value": 120}], _ago(5))       # NEWS2 0: the alert ended
        assert "news2" not in _firing(_card(client))
        assert len(_rows(client, "notification")) == 1
        for code in ("resp_rate", "spo2"):
            assert _retract(client, ids[code]).status_code == 200            # NEWS2 6: soon, not immediate
        assert len(_rows(client, "notification")) == 1
        assert _retract(client, ids["sbp"]).status_code == 200               # the 88 again: NEWS2 9
        assert len(_rows(client, "notification")) == 2


class TestTheRefusals:
    def test_a_short_reason_is_refused(self, client):
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], reason="   kısa   ")
        assert (r.status_code, r.json()["detail"]) == (400, RETRACT_REASON_SHORT)

    @pytest.mark.parametrize("entry", ["999999", "abc", "-1"])
    def test_an_unknown_entry_is_404(self, client, entry):
        _chart(client, RISKY, _ago(5))
        r = _retract(client, entry)
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)

    def test_another_patients_entry_is_404(self, client):
        ids = _chart(client, RISKY, _ago(5), pid="bed-4")
        _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["spo2"], pid="bed-3").status_code == 404

    def test_a_row_that_is_not_a_chart_row_is_404(self, client):
        """A device's reading is an `ingest` row, an alert an `alert` row: neither is a hand entry."""
        _chart(client, RISKY, _ago(5))
        alert = _rows(client, "alert")[0]
        assert _retract(client, alert.id).status_code == 404

    def test_a_second_withdrawal_is_409(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = _retract(client, ids["resp_rate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)

    def test_a_device_credential_cannot_withdraw(self, client):
        """X11: a withdrawal names who made it."""
        ids = _chart(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], headers=AUTH)
        assert (r.status_code, r.json()["detail"]) == (403, RETRACT_NEEDS_PERSON)

    def test_it_needs_a_credential_and_the_chart_permission(self, client):
        ids = _chart(client, RISKY, _ago(5))
        assert client.post(f"/clinical/bed-3/entries/{ids['spo2']}/retract", json={"reason": WHY}).status_code == 401
        assert _retract(client, ids["spo2"], headers=VIEWER).status_code == 403

    def test_a_discharged_number_is_409(self):
        store = InMemoryIdentityStore()
        with _app(identities=store) as c:
            ids = _chart(c, RISKY, _ago(5))
            store.apply("h1", IdentityRecord(patient_id="bed-3", state="discharged", source=KABUL,
                                             updated_at=datetime.now(timezone.utc)))
            r = _retract(c, ids["resp_rate"])
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_DISCHARGED)

    def test_no_refusal_writes_a_row(self, client):
        ids = _chart(client, RISKY, _ago(5))
        for entry, reason, headers in ((ids["spo2"], "kısa", NURSE), ("999999", WHY, NURSE),
                                       (ids["spo2"], WHY, AUTH), (ids["spo2"], WHY, VIEWER)):
            assert _retract(client, entry, reason=reason, headers=headers).status_code >= 400
        assert _rows(client, RETRACT) == []

    def test_an_id_that_is_not_plain_ascii_digits_or_too_long_names_no_entry(self, client):
        """Review: `str.isdigit` alone takes «²», which `int` then refuses (a 500), and Arabic-Indic «٢», which
        `int` reads as 2 — another entry's id typed in another script. Past 18 digits an id is no audit row's
        (a 64-bit id has 19 at most), and a padded one would reach a real entry the same way. All three are 404,
        with nothing written and the value still counted."""
        ids = _chart(client, RISKY, _ago(5))
        real = str(ids["spo2"])
        arabic_indic = real.translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))
        for entry in ("²", arabic_indic, real.rjust(19, "0")):
            r = _retract(client, entry)
            assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN), entry
        assert _rows(client, RETRACT) == []
        assert _card(client)["latest"]["spo2"] == 91


# --- the invariants the controller's self-review names, pinned (G3-01 review of Task 5) -----------------------

# Suspected infection, 70 kg, 30 mL/kg of crystalloid, norepinephrine running: with a lactate above 2, septic
# shock — a critical, immediate alert.
SHOCK = [{"code": "suspected_infection", "value": 1}, {"code": "weight_kg", "value": 70},
         {"code": "crystalloid_bolus_ml", "value": 2100}, {"code": "norepinephrine_rate", "value": 0.1}]


class TestTheLatchHolds:
    def test_an_unacknowledged_critical_the_withdrawal_ends_stays_latched(self, client):
        """G2-A1 (D3) through the lifecycle hook the withdrawal runs once: the shock nobody acknowledged is a
        to-do on the board, not gone; and the nurse, told of it once, is not told again."""
        at = _ago(5)
        _chart(client, SHOCK, at)
        ids = _chart(client, [{"code": "lactate", "value": 4}], at)
        assert "septic_shock" in _firing(_card(client))
        told = len(_rows(client, "notification"))
        assert _retract(client, ids["lactate"]).status_code == 200
        after = _card(client)
        assert "septic_shock" not in _firing(after)
        assert _latched(after) == ["septic_shock"]
        assert len(_rows(client, "notification")) == told

    def test_an_acknowledged_critical_simply_ends(self, client):
        at = _ago(5)
        _chart(client, SHOCK, at)
        ids = _chart(client, [{"code": "lactate", "value": 4}], at)
        acked = client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"},
                            headers=AUTH)
        assert acked.status_code == 200, acked.text
        assert _retract(client, ids["lactate"]).status_code == 200
        assert "septic_shock" not in [a["kind"] for a in _card(client)["alerts"]]


class _Faulty(InMemoryAuditLog):
    """A trail that fails on demand — the withdrawal's read of the patient's rows, or its own row: a bounded
    audit that timed out (O6)."""
    fail_read = fail_append = False

    def records(self, **kw):
        if self.fail_read and kw.get("patient_id") is not None:
            raise RuntimeError("the trail read timed out")
        return super().records(**kw)

    def append(self, event):
        if self.fail_append and event.event_type == RETRACT:
            raise RuntimeError("the trail write timed out")
        return super().append(event)


class TestAFailureChangesNothing:
    @pytest.mark.parametrize("fault", ["fail_read", "fail_append"])
    def test_a_read_or_an_append_that_fails_leaves_the_patient_as_it_was(self, fault):
        """X4: the trail row first, then memory — the scratch engine is dropped, and the value still counts."""
        log = _Faulty()
        with _app(audit=log) as c:
            ids = _chart(c, RISKY, _ago(5))
            before = _card(c)
            setattr(log, fault, True)
            with pytest.raises(RuntimeError):
                _retract(c, ids["resp_rate"])
            setattr(log, fault, False)
            after = _card(c)
            assert _rows(c, RETRACT) == []
            assert (_news2(after), _firing(after), after["latest"]["resp_rate"]) == (
                _news2(before), _firing(before), 26)
            assert _retract(c, ids["resp_rate"]).status_code == 200       # once the trail answers, it can be


class TestTheOnlyReading:
    """Never charting a patient's only value leaves the patient unmeasured — the card must not be rebuilt as a
    measured one (`patient_board` creates the patient in the engine, and its NEWS2 0 would read as measured)."""

    def test_an_admitted_patient_goes_back_to_its_identity_card(self):
        store = InMemoryIdentityStore()
        store.apply("h1", IdentityRecord(patient_id="bed-3", state="admitted", source=KABUL,
                                         updated_at=datetime.now(timezone.utc)))
        with _app(identities=store) as c:
            ids = _chart(c, [{"code": "temperature", "value": 38.2}], _ago(5))
            assert _card(c)["latest"]["news2"] is not None
            assert _retract(c, ids["temperature"]).status_code == 200
            card = _card(c)
            assert (card["latest"]["news2"], card["alerts"], card["identity"]["patient_id"]) == (None, [], "bed-3")

    def test_an_id_with_no_identity_leaves_the_board(self, client):
        ids = _chart(client, [{"code": "temperature", "value": 38.2}], _ago(5))
        assert _retract(client, ids["temperature"]).status_code == 200
        assert "bed-3" not in [p["patient_id"] for p in client.get("/patients", headers=AUTH).json()["patients"]]
