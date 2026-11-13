# homunculus-engine/tests/test_saat_api.py
"""G3-06 «Saat geri gitmez» through the API (spec §8.1): a late reading — a device round sent late, a set charted
at its own time, the corrected value «Düzelt» charts at the reading's time, a set linked from the unmatched list —
never turns an overdue antibiotic back into a running hour or ends its episode and acknowledgement; a withdrawal
judges the alerts as of its own instant; and a restart (a second app on the same audit) agrees. Synthetic patients
and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.canonical import SignalCode
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
PID = "bed-3"
WHY = "cihaz yanlış hastaya ölçmüş, yeniden ölçüldü"
#: A Connex round: the four values a ward device sends (no respiration rate, no consciousness).
CONNEX = [("spo2", 97), ("heart_rate", 88), ("temperature", 37.2), ("sbp", 118)]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit) -> TestClient:
    return TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit))


def _chart(c, entries, at) -> dict[str, int]:
    """Chart as the nurse at `at`; the answer's entry ids by code."""
    r = c.post(f"/clinical/{PID}", json={"entries": entries, "recorded_at": at.isoformat()}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _device(c, code, value, at) -> dict:
    r = c.post("/ingest", json=obs(code, value, PID, at), headers=DEVICE)
    assert r.status_code == 200 and "alerts" in r.json(), r.text
    return r.json()


def _card(c) -> dict:
    return next(p for p in c.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == PID)


def _firing(card) -> dict[str, dict]:
    """The alerts firing now, by kind (a latched one carries `resolved_at`)."""
    return {a["kind"]: a for a in card["alerts"] if a["resolved_at"] is None}


def _anchor(card) -> str | None:
    clock = (card.get("meds") or {}).get("antibiotic_clock") or {}
    return clock.get("recognized_at")


def _count(audit, kind) -> int:
    return len(audit.records(tenant="h1", patient_id=PID, event_type=kind, limit=1000))


def _overdue(c, now, *, ack=True) -> tuple[dict, int]:
    """Suspected infection with platelets 120 is SOFA 1; a MAP of 60 measured at -90 min makes it sepsis there and
    starts the antibiotic hour; a temperature measured at -5 min finds the hour gone with no antibiotic given:
    «OVERDUE by 25 min» (tests/test_readings_api.py `_overdue`). Acknowledged unless `ack` is False. Answers the
    overdue as the card shows it, and the temperature's entry."""
    _chart(c, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
           now - timedelta(minutes=90))
    _chart(c, [{"code": "map", "value": 60}], now - timedelta(minutes=90))
    entry = _chart(c, [{"code": "temperature", "value": 37.0}], now - timedelta(minutes=5))["temperature"]
    if ack:
        r = c.post("/ack", json={"patient_id": PID, "kind": "antibiotic_overdue", "role": "nurse"}, headers=DEVICE)
        assert r.status_code == 200, r.text
    overdue = _firing(_card(c))["antibiotic_overdue"]
    assert overdue["summary"] == "Antibiotic OVERDUE by 25 min"
    return overdue, entry


def _same_after_a_restart(audit, live: dict) -> dict:
    """A second app on the same audit — the restart — shows the same firing alerts by kind, severity, urgency and
    acknowledgement, and the same anchor. A summary's minute count may differ by the request's own duration."""
    with _app(audit) as again:
        card = _card(again)
    want = {k: (a["severity"], a["urgency"], a["acknowledged"]) for k, a in _firing(live).items()}
    assert {k: (a["severity"], a["urgency"], a["acknowledged"]) for k, a in _firing(card).items()} == want
    assert _anchor(card) == _anchor(live)
    return card


class TestALateReadingAtTheDoors:
    def test_a_device_round_sent_four_hours_late_leaves_an_acknowledged_overdue_as_it_was(self):
        """A Connex round the device buffered reaches `/ingest` four hours after it was measured. Judged at its
        stamp, the clock read «210 min remaining» and the overdue's episode ended — its acknowledgement and first
        sight pruned, the next reading raising it anew, a new page."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        late = now - timedelta(hours=4)
        with _app(audit) as c:
            before, _ = _overdue(c, now)
            cleared, told = _count(audit, "alert_cleared"), _count(audit, "notification")
            for code, value in CONNEX:
                assert "antibiotic_due" not in [a["kind"] for a in _device(c, code, value, late)["alerts"]]
            live = _card(c)
            after = _firing(live)
            assert "antibiotic_due" not in after
            assert {k: after["antibiotic_overdue"][k] for k in ("summary", "acknowledged", "first_seen_at")} == \
                {k: before[k] for k in ("summary", "acknowledged", "first_seen_at")}
            assert (_count(audit, "alert_cleared"), _count(audit, "notification")) == (cleared, told)
            # The values are kept and audited at their own stamp.
            rows = audit.records(tenant="h1", patient_id=PID, event_type="ingest", limit=10)
            assert sorted(r.subject for r in rows) == sorted(code for code, _ in CONNEX)
            assert {r.payload["obs_ts"] for r in rows} == {late.isoformat()}
            state = c.app.state.board_link._engine("h1").state(PID)
            assert state.latest(SignalCode.SPO2).timestamp == late
        _same_after_a_restart(audit, live)

    def test_a_bedside_set_charted_three_hours_back_leaves_an_acknowledged_overdue_as_it_was(self):
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            before, _ = _overdue(c, now)
            cleared = _count(audit, "alert_cleared")
            _chart(c, [{"code": "resp_rate", "value": 18}, {"code": "spo2", "value": 96},
                       {"code": "sbp", "value": 120}, {"code": "heart_rate", "value": 84}], now - timedelta(hours=3))
            live = _card(c)
            after = _firing(live)
            assert "antibiotic_due" not in after
            assert {k: after["antibiotic_overdue"][k] for k in ("summary", "acknowledged", "first_seen_at")} == \
                {k: before[k] for k in ("summary", "acknowledged", "first_seen_at")}
            assert _count(audit, "alert_cleared") == cleared
        _same_after_a_restart(audit, live)

    def test_duzelt_charts_the_corrected_value_at_the_readings_time_and_the_overdue_stays(self):
        """«Düzelt» (G3-05 D13): a device SpO2 measured at -40 min is withdrawn, then the right value is charted at
        that same time. Judged at -40 min the corrected value read «10 min remaining» and ended the acknowledged
        overdue."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _chart(c, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
                   now - timedelta(minutes=90))
            _chart(c, [{"code": "map", "value": 60}], now - timedelta(minutes=90))
            _device(c, "spo2", 93, now - timedelta(minutes=40))
            [wrong] = audit.records(tenant="h1", patient_id=PID, event_type="ingest", limit=10)
            _chart(c, [{"code": "temperature", "value": 37.0}], now - timedelta(minutes=5))
            r = c.post("/ack", json={"patient_id": PID, "kind": "antibiotic_overdue", "role": "nurse"},
                       headers=DEVICE)
            assert r.status_code == 200, r.text
            before = _firing(_card(c))["antibiotic_overdue"]
            cleared = _count(audit, "alert_cleared")
            r = c.post(f"/clinical/{PID}/entries/{wrong.id}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            _chart(c, [{"code": "spo2", "value": 96}], now - timedelta(minutes=40))
            live = _card(c)
            after = _firing(live)
            assert "antibiotic_due" not in after
            assert (after["antibiotic_overdue"]["acknowledged"], after["antibiotic_overdue"]["first_seen_at"]) == \
                (True, before["first_seen_at"])
            assert _count(audit, "alert_cleared") == cleared
        _same_after_a_restart(audit, live)


class TestAWithdrawal:
    """D3: «hatalı giriş» re-judges the patient at the withdrawal's own instant — the state as if the value had
    never arrived, the alerts as of now."""

    def test_withdrawing_the_reading_that_found_the_hour_gone_leaves_the_overdue(self):
        """The reviewers' scenario: a MAP at -90 min completes sepsis and starts the hour, a temperature at -5 min
        finds it overdue, and the temperature is withdrawn. Rebuilt to the MAP row, the board read «60 min
        remaining» and the overdue latched — an hour that ran out at -30 min."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _, temperature = _overdue(c, now, ack=False)
            r = c.post(f"/clinical/{PID}/entries/{temperature}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            assert "antibiotic_overdue" in r.json()["alerts"] and "antibiotic_due" not in r.json()["alerts"]
            live = _card(c)
            assert "antibiotic_overdue" in _firing(live) and "antibiotic_due" not in _firing(live)
            assert all(a["resolved_at"] is None for a in live["alerts"]), "nothing latched"
            assert c.app.state.board_link._engine("h1").state(PID).latest(SignalCode.TEMPERATURE) is None
        _same_after_a_restart(audit, live)

    @pytest.mark.xfail(strict=True, reason="plan E-6 (F-1): the replay passes over the first sight and the "
                       "acknowledgement given while the withdrawn reading's evaluation had the overdue firing")
    def test_an_acknowledged_overdue_whose_finding_reading_is_withdrawn_keeps_both_after_a_restart(self):
        """Live, the overdue the temperature found stays one episode across its withdrawal (D3), acknowledged and
        first seen at the temperature's request. The restart skips the temperature row, so at the `first_seen` and
        `ack` rows the replay has no overdue firing and passes both over; the `chart_retract` row's rejudge then
        raises it unstamped and unacknowledged. Kept red on purpose: the owner decides (plan E-6)."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _, temperature = _overdue(c, now)
            r = c.post(f"/clinical/{PID}/entries/{temperature}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            live = _firing(_card(c))["antibiotic_overdue"]
            assert live["acknowledged"] and live["first_seen_at"] is not None
        with _app(audit) as again:
            after = _firing(_card(again))["antibiotic_overdue"]
        assert (after["acknowledged"], after["first_seen_at"]) == (True, live["first_seen_at"])

    def test_a_withdrawal_after_the_hour_ran_out_uncovers_the_overdue_and_tells_the_nurse(self):
        """The hour ran out at -30 min with no reading since but a wrong one at -80 min (a respiration rate that
        should have been 16). Withdrawn now, the patient is judged now: «antibiotic_overdue», a new alert — stamped
        and told to the nurse like any alert a withdrawal uncovers (G3-01 X3)."""
        audit, now = InMemoryAuditLog(), datetime.now(timezone.utc)
        with _app(audit) as c:
            _chart(c, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 120}],
                   now - timedelta(minutes=90))
            _chart(c, [{"code": "map", "value": 60}], now - timedelta(minutes=90))
            wrong = _chart(c, [{"code": "resp_rate", "value": 61}], now - timedelta(minutes=80))["resp_rate"]
            assert "antibiotic_due" in _firing(_card(c))
            seen, told = _count(audit, "first_seen"), _count(audit, "notification")
            r = c.post(f"/clinical/{PID}/entries/{wrong}/retract", json={"reason": WHY}, headers=NURSE)
            assert r.status_code == 200, r.text
            assert "antibiotic_overdue" in r.json()["alerts"]
            stamped = audit.records(tenant="h1", patient_id=PID, event_type="first_seen", limit=100)[seen:]
            assert [row.subject for row in stamped] == ["antibiotic_overdue"]
            notes = audit.records(tenant="h1", patient_id=PID, event_type="notification", limit=100)[told:]
            assert [(n.subject, n.payload["audience"]) for n in notes] == [("antibiotic_overdue", "nurse")]
            live = _card(c)
        _same_after_a_restart(audit, live)
