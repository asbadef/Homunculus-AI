# homunculus-engine/tests/test_device_retract.py
"""G3-05 (spec D3, D13; O2): «hatalı giriş» for a device reading. A withdrawn `ingest` row leaves every score as
if the value had never arrived; the trail keeps both rows; the record's row is marked and a re-sent copy does not
bring it back; the restart and the one-patient rebuild skip it; every other reader of withdrawals answers as
before; and a restart after one does not hand an old acknowledgement to an alert it did not answer. Where the
trail holds TWO `ingest` rows for one device reading (a `seen` that failed open, older data), the withdrawal takes
both: the copy is the value the nurse saw struck through. Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import fluids, pharmacy, tasks
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import (
    RETRACT, RETRACT_ALREADY, RETRACT_NEEDS_PERSON, RETRACT_NOT_BEDSIDE, RETRACT_UNKNOWN,
)
from homunculus.api.identity import Caller
from homunculus.api.readings import ORIGIN_DEVICE, InMemoryReadingStore, Reading
from homunculus.api.rehydrate import (
    device_key_of, observation_of, rebuild_patient, rehydrate, retracted_device_readings, retracted_entries,
)
from homunculus.api.ackstore import AckStore
from homunculus.canonical import Observation, SignalCode
from homunculus.gateway.fhir import parse_fhir_observation
from homunculus.pipeline import Engine
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart", "alerts.ack"}))}
KEY = "202600000001"
WHY = "manşet yanlış koldaydı, yeniden ölçüldü"
# Respiration 26, SpO₂ 91, systolic 88: NEWS2 9, the immediate band (tests/test_bedside_retract.py RISKY).
RISKY = [("resp_rate", 26), ("spo2", 91), ("sbp", 88)]


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(audit=None, store=None):
    audit = audit if audit is not None else InMemoryAuditLog()
    store = store if store is not None else InMemoryReadingStore()
    app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit, readings=store)
    return app, audit, store


@pytest.fixture()
def world():
    app, audit, store = _app()
    with TestClient(app) as client:
        yield client, audit, store


def _ago(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


def _send(client, pairs, when, key=KEY, device="CONNEX-3A") -> dict[str, int]:
    """Device readings through `/ingest`; each code's `ingest` row id — the entry a withdrawal names."""
    audit, ids = client.app.state.audit, {}
    for code, value in pairs:
        r = client.post("/ingest", json=obs(code, value, key, when, device=device), headers=DEVICE)
        assert r.status_code == 200 and "alerts" in r.json(), r.text
        ids[code] = audit.records(tenant="h1", patient_id=key, event_type="ingest", limit=1, newest=True)[-1].id
    return ids


def _retract(client, entry, reason=WHY, headers=NURSE, key=KEY):
    return client.post(f"/clinical/{key}/entries/{entry}/retract", json={"reason": reason}, headers=headers)


def _card(client, key=KEY):
    return next(p for p in client.get("/patients", headers=DEVICE).json()["patients"] if p["patient_id"] == key)


def _news2(card):
    n = card["latest"]["news2"]
    return {k: n[k] for k in ("total", "partial", "missing", "red_param", "breakdown")}


def _alerts(card):
    """(kind, firing?, acknowledged?) of every alert on the card."""
    return sorted((a["kind"], a["resolved_at"] is None, bool(a["acknowledged"])) for a in card["alerts"])


def _rows(audit, kind, key=KEY):
    return audit.records(tenant="h1", patient_id=key, event_type=kind, limit=1000)


class TestADeviceValueIsWithdrawn:
    def test_the_scores_are_as_if_it_had_never_arrived(self, world):
        client, _, _ = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _card(client)["latest"]["news2"]["total"] == 9
        r = _retract(client, ids["resp_rate"])
        assert r.status_code == 200, r.text
        assert (r.json()["retracted"], r.json()["code"]) == (ids["resp_rate"], "resp_rate")
        fresh_app, _, _ = _app()
        with TestClient(fresh_app) as fresh:
            _send(fresh, [pair for pair in RISKY if pair[0] != "resp_rate"], when)
            assert _news2(_card(client)) == _news2(_card(fresh))
            assert _alerts(_card(client)) == _alerts(_card(fresh))
        assert _card(client)["latest"]["resp_rate"] is None

    def test_the_alert_it_raised_ends(self, world):
        client, audit, _ = world
        ids = _send(client, [("heart_rate", 140)], _ago(5))            # one red parameter: a news2 alert
        assert [a["kind"] for a in _card(client)["alerts"]] == ["news2"]
        assert _retract(client, ids["heart_rate"]).status_code == 200
        # It was the patient's only reading: no card is left for an alert to sit on, and nothing fires.
        assert KEY not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
        assert client.get(f"/alerts/{KEY}", headers=DEVICE).json()["alerts"] == []

    def test_the_trail_keeps_both_rows_and_the_withdrawal_names_the_device(self, world):
        client, audit, _ = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["spo2"], reason=f"  {WHY}  ").status_code == 200
        assert ids["spo2"] in [r.id for r in _rows(audit, "ingest")]             # the reading's row stays
        [row] = _rows(audit, RETRACT)
        assert (row.patient_id, row.subject) == (KEY, "spo2")
        assert row.payload == {"entry": ids["spo2"], "code": "spo2", "value": 91.0, "obs_ts": when.isoformat(),
                               "reason": WHY, "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}

    def test_a_hand_entrys_withdrawal_row_is_what_it_was(self, world):
        """The two new keys are the device's alone: G3-01's payload for a `chart` row is unchanged."""
        client, audit, _ = world
        when = _ago(5)
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 26}],
                                                  "recorded_at": when.isoformat()}, headers=NURSE)
        entry = r.json()["entries"][0]["entry"]
        assert _retract(client, entry).status_code == 200
        [row] = _rows(audit, RETRACT)
        assert sorted(row.payload) == ["code", "entry", "obs_ts", "reason", "retracted_by", "value"]

    def test_the_records_row_is_marked_and_the_value_kept(self, world):
        client, _, store = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["sbp"]).status_code == 200
        rows = {r.code: r for r in store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))}
        assert (rows["sbp"].voided_by, rows["sbp"].void_reason, rows["sbp"].value) == ("hem.ayse", WHY, 88.0)
        assert rows["sbp"].voided_at is not None and rows["spo2"].voided_at is None

    def test_a_hand_entrys_row_is_marked_too(self, world):
        client, _, store = world
        when = _ago(5)
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 26}],
                                                  "recorded_at": when.isoformat()}, headers=NURSE)
        assert _retract(client, r.json()["entries"][0]["entry"]).status_code == 200
        [row] = store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
        assert (row.origin, row.voided_by, row.void_reason) == ("manual", "hem.ayse", WHY)

    def test_a_re_sent_copy_does_not_bring_the_value_back(self, world):
        client, audit, _ = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["resp_rate"]).status_code == 200
        again = client.post("/ingest", json=obs("resp_rate", 26, KEY, when), headers=DEVICE)
        assert again.json() == {"patient_id": KEY, "duplicate": True}
        assert _card(client)["latest"]["resp_rate"] is None and len(_rows(audit, "ingest")) == 3

    def test_the_corrected_value_is_a_hand_entry_at_the_readings_own_time(self, world):
        """D13, Q3: the wrong value stays in the trail, withdrawn; the right one is typed, «elle», at that time."""
        client, _, store = world
        when = _ago(5)
        ids = _send(client, RISKY, when)
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = client.post(f"/clinical/{KEY}", json={"entries": [{"code": "resp_rate", "value": 16}],
                                                  "recorded_at": when.isoformat()}, headers=NURSE)
        assert r.status_code == 200, r.text
        assert _card(client)["latest"]["resp_rate"] == 16
        rows = [r for r in store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
                if r.code == "resp_rate"]
        assert sorted((r.origin, r.value, r.voided_at is not None) for r in rows) == [
            ("device", 26.0, True), ("manual", 16.0, False)]

    def test_a_failed_table_mark_does_not_fail_the_withdrawal(self):
        class _NoVoid(InMemoryReadingStore):
            def void(self, *args, **kw):
                raise RuntimeError("readings down")
        app, audit, _ = _app(store=_NoVoid())
        with TestClient(app) as client:
            ids = _send(client, RISKY, _ago(5))
            assert _retract(client, ids["resp_rate"]).status_code == 200
            assert _card(client)["latest"]["resp_rate"] is None and len(_rows(audit, RETRACT)) == 1


class TestTheRefusals:
    def test_a_second_withdrawal_is_409(self, world):
        client, _, _ = world
        ids = _send(client, RISKY, _ago(5))
        assert _retract(client, ids["resp_rate"]).status_code == 200
        r = _retract(client, ids["resp_rate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)

    def test_a_device_credential_still_cannot_withdraw(self, world):
        client, _, _ = world
        ids = _send(client, RISKY, _ago(5))
        r = _retract(client, ids["resp_rate"], headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (403, RETRACT_NEEDS_PERSON)

    def test_another_patients_reading_is_404(self, world):
        client, _, _ = world
        other = _send(client, RISKY, _ago(5), key="202600000002")
        _send(client, RISKY, _ago(5))
        r = _retract(client, other["spo2"])
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)

    def test_a_device_value_the_bedside_form_does_not_chart_is_refused(self, world):
        """X22 holds for the device too: a lactate is corrected by a new entry, not withdrawn."""
        client, audit, _ = world
        ids = _send(client, [("lactate", 4.2)], _ago(5))
        r = _retract(client, ids["lactate"])
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_NOT_BEDSIDE)
        assert _rows(audit, RETRACT) == []

    def test_the_unknown_entry_sentence_no_longer_says_hand_entered(self, world):
        client, _, _ = world
        _send(client, RISKY, _ago(5))
        r = _retract(client, "999999")
        assert (r.status_code, r.json()["detail"]) == (404, RETRACT_UNKNOWN)
        assert RETRACT_UNKNOWN == "bu hastada böyle bir ölçüm değeri yok"          # the dashboard maps it so
        assert "elle" not in RETRACT_UNKNOWN


class TestTheReplayAndTheRebuildSkipIt:
    def _trail(self, when):
        log = InMemoryAuditLog()
        kept = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 80.0, "unit": "/min", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
        wrong = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 180.0, "unit": "/min", "obs_ts": (when + timedelta(minutes=1)).isoformat(), "device": "CONNEX-3A"}))
        log.append(AuditEvent("h1", RETRACT, KEY, "heart_rate", {
            "entry": wrong.id, "code": "heart_rate", "value": 180.0, "obs_ts": (when + timedelta(minutes=1)).isoformat(),
            "reason": WHY, "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        return log, kept, wrong

    def test_rehydrate_skips_a_withdrawn_ingest_row(self):
        log, kept, wrong = self._trail(_ago(10))
        rows = log.records(tenant="h1", limit=100)
        engine, store = Engine(), AckStore()
        rehydrate(engine, store, rows, skip=retracted_entries(rows))
        assert [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)] == [80.0]
        assert engine.active_alerts(KEY) == []

    def test_rehydrate_without_the_skip_still_replays_it(self):
        log, _, _ = self._trail(_ago(10))
        engine = Engine()
        rehydrate(engine, AckStore(), log.records(tenant="h1", limit=100))
        assert [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)] == [80.0, 180.0]

    def test_rebuild_patient_skips_a_withdrawn_ingest_row(self):
        log, kept, wrong = self._trail(_ago(10))
        rows = log.records(tenant="h1", limit=100)
        engine = Engine()
        rebuild_patient(engine, KEY, rows, skip=frozenset({wrong.id}))
        assert [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)] == [80.0]

    def test_a_restart_scores_as_the_live_withdrawal_did(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        first, _, _ = _app(audit=audit, store=store)
        with TestClient(first) as client:
            ids = _send(client, RISKY, _ago(5))
            assert _retract(client, ids["resp_rate"]).status_code == 200
            live = _card(client)
        second, _, _ = _app(audit=audit, store=store)
        with TestClient(second) as client:
            again = _card(client)
            assert _news2(again) == _news2(live) and _alerts(again) == _alerts(live)


class TestTheSourceIsReplayedAsSent:
    """O2: a device that names itself with an empty string. The door stamps the reading with "" and writes
    `"device": ""`; the replay used to read that as "replay", so the rebuilt reading was not EQUAL to the live one
    — and the shadow lane's removal and the «already» repair, which compare readings, could miss it."""

    def test_the_row_of_a_nameless_device_replays_as_the_door_stamped_it(self):
        when = _ago(5)
        resource = obs("heart_rate", 140, KEY, when, device="")
        live = parse_fhir_observation(resource)
        assert live.source_device == ""
        log = InMemoryAuditLog()
        row = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": live.value, "unit": live.unit, "obs_ts": live.timestamp.isoformat(), "device": live.source_device}))
        assert observation_of(row) == live

    def test_a_row_with_no_device_key_still_replays_as_replay_and_a_chart_row_as_clinician(self):
        when = _ago(5).isoformat()
        log = InMemoryAuditLog()
        old = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {"value": 80.0, "unit": "/min", "obs_ts": when}))
        hand = log.append(AuditEvent("h1", "chart", KEY, "heart_rate", {"value": 80.0, "unit": "/min", "obs_ts": when,
                                                                        "charted_by": "hem.ayse"}))
        assert observation_of(old).source_device == "replay"
        assert observation_of(hand).source_device == "clinician"

    def test_a_nameless_devices_value_is_withdrawn_like_any_other(self, world):
        client, _, store = world
        when = _ago(5)
        ids = _send(client, [("heart_rate", 140)], when, device="")
        assert _retract(client, ids["heart_rate"]).status_code == 200
        engine = client.app.state.board_link._engine("h1")
        assert KEY not in engine.patient_ids()                            # it was the only reading
        [row] = store.for_patient("h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
        assert (row.source, row.voided_by) == ("", "hem.ayse")


class TestTheOtherReadersOfWithdrawals:
    """Lane A, 2026-11-11 (spec §7): the fluid ledger, Eczane and the task anchor each pair a `chart_retract`
    with its (patient, entry). A withdrawal of a DEVICE row of a non-fluid code must change none of their answers."""

    def _trail(self):
        when = _ago(30)
        log = InMemoryAuditLog()
        urine = log.append(AuditEvent("h1", "chart", KEY, "urine_output_ml", {
            "value": 200.0, "unit": "mL", "obs_ts": when.isoformat(), "charted_by": "hem.ayse"}))
        hand = log.append(AuditEvent("h1", "chart", KEY, "resp_rate", {
            "value": 16.0, "unit": "/min", "obs_ts": when.isoformat(), "charted_by": "hem.ayse"}))
        device = log.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 140.0, "unit": "/min", "obs_ts": when.isoformat(), "device": "CONNEX-3A"}))
        return log, when, urine, hand, device

    def _answers(self, log, when):
        since, until = when - timedelta(hours=1), when + timedelta(hours=1)
        rows = log.records(tenant="h1", event_types={"chart", RETRACT}, limit=1000)
        return (fluids._entries_by_patient(rows, since=since, until=until),
                pharmacy.read_entries_by_patient(log, "h1", since=since, until=until),
                fluids.read_entries(log, "h1", KEY, since=since, until=until),
                tasks._stamps_by_patient(rows, since=since, until=until))

    def test_a_device_withdrawal_changes_none_of_their_answers(self):
        log, when, urine, hand, device = self._trail()
        before = self._answers(log, when)
        log.append(AuditEvent("h1", RETRACT, KEY, "heart_rate", {
            "entry": device.id, "code": "heart_rate", "value": 140.0, "obs_ts": when.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        assert self._answers(log, when) == before
        ledger, _ = fluids.read_entries(log, "h1", KEY, since=when - timedelta(hours=1), until=when + timedelta(hours=1))
        assert [(e.entry, e.retracted) for e in ledger] == [(urine.id, None)]

    def test_each_still_pairs_a_withdrawal_with_its_own_patients_entry(self):
        """A withdrawal names an entry of ITS patient: one written for another patient with the same id touches
        nothing — whatever kind of row the id is."""
        log, when, urine, hand, device = self._trail()
        before = self._answers(log, when)
        for entry in (urine.id, hand.id, device.id):
            log.append(AuditEvent("h1", RETRACT, "202600000002", "heart_rate", {
                "entry": entry, "code": "heart_rate", "value": 1.0, "obs_ts": when.isoformat(), "reason": WHY,
                "retracted_by": "hem.ayse"}))
        assert self._answers(log, when) == before


class TestARestartAfterADeviceWithdrawal:
    """Lane A, 2026-11-11 (spec §7): the replay never prunes what the live door pruned, so an acknowledgement
    given to an episode that the withdrawal ended must not come back on an alert the replay raises differently.
    Each case holds the restarted app's alerts — kind, firing, acknowledged — equal to the live rebuild's."""

    def _ack(self, client, kind="news2"):
        r = client.post("/ack", json={"patient_id": KEY, "kind": kind}, headers=NURSE)
        assert r.status_code == 200, r.text

    def _restarted(self, audit, store):
        app, _, _ = _app(audit=audit, store=store)
        return app

    def test_an_acknowledged_alert_the_withdrawal_ended_and_a_later_one_of_its_kind(self):
        """The wrong value raised the alert, a nurse acknowledged it, the value was withdrawn (the episode ends),
        and later readings raise the kind again: a new episode nobody has acknowledged — live and after a restart."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            ids = _send(client, [("heart_rate", 140)], _ago(20))
            self._ack(client)
            assert _retract(client, ids["heart_rate"]).status_code == 200
            _send(client, RISKY, _ago(5))                                # a real deterioration, later
            live = _alerts(_card(client))
            assert live == [("news2", True, False)]                      # firing, not acknowledged
        with TestClient(self._restarted(audit, store)) as client:
            assert _alerts(_card(client)) == live

    def test_an_acknowledged_alert_that_still_fires_without_the_withdrawn_value(self):
        """The alert stands on other values too: the withdrawal changes its score, not its being there, and the
        acknowledgement stays — live and after a restart."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            ids = _send(client, RISKY, _ago(10))
            self._ack(client)
            assert _retract(client, ids["sbp"]).status_code == 200       # NEWS2 9 → 6: still an alert
            live = _alerts(_card(client))
            assert live == [("news2", True, True)]
        with TestClient(self._restarted(audit, store)) as client:
            assert _alerts(_card(client)) == live

    def test_a_withdrawal_that_empties_the_patient(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            ids = _send(client, [("heart_rate", 140)], _ago(20))
            self._ack(client)
            assert _retract(client, ids["heart_rate"]).status_code == 200
            live = [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]
            assert KEY not in live
        with TestClient(self._restarted(audit, store)) as client:
            assert [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]] == live


def _row(log, kind, when, value, *, code="heart_rate", key=KEY, device="CONNEX-3A"):
    """One audit row as the doors write it: an `ingest` row names its device, a `chart` row its charter."""
    payload = {"value": value, "unit": "/min", "obs_ts": when.isoformat()}
    payload |= {"device": device} if kind == "ingest" else {"charted_by": "hem.ayse"}
    return log.append(AuditEvent("h1", kind, key, code, payload))


def _held(client, key=KEY, code=SignalCode.HEART_RATE) -> list[float]:
    """The values the engine holds for one patient's signal, ascending."""
    engine = client.app.state.board_link._engine("h1")
    if key not in engine.patient_ids():
        return []
    return sorted(o.value for o in engine.state(key).history(code))


class TestTwoAuditRowsForOneReading:
    """B4 review: a rare path (a `seen` that failed open, data from before it existed) leaves TWO `ingest` rows for
    one device reading of a patient. A withdrawal names one entry; the other copy is the value the nurse saw
    struck through, so the live rebuild AND the restart's replay skip every `ingest` row of that patient with the
    same code, time, device and value. One `chart_retract` row is written, naming the entry the nurse chose; the
    rest is derived. A hand entry keeps its exact-id rule."""

    def _trail(self):
        audit, when = InMemoryAuditLog(), _ago(10)
        _row(audit, "ingest", when - timedelta(minutes=2), 80.0)
        first = _row(audit, "ingest", when, 140.0)
        second = _row(audit, "ingest", when, 140.0)                  # the same reading, written twice
        other = _row(audit, "ingest", when, 150.0)                   # the same time, another value: another reading
        return audit, first, second, other

    def _restarted(self, audit):
        app, _, _ = _app(audit=audit)
        return app

    @pytest.mark.parametrize("chosen", ["first", "second"])
    def test_withdrawing_one_of_two_identical_rows_takes_both_live_and_after_a_restart(self, chosen):
        audit, first, second, other = self._trail()
        entry = {"first": first, "second": second}[chosen]
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            assert _held(client) == [80.0, 140.0, 140.0, 150.0]
            r = _retract(client, entry.id)
            assert r.status_code == 200, r.text
            assert r.json()["retracted"] == entry.id
            assert _held(client) == [80.0, 150.0]                    # neither copy; the other value stays
            [row] = _rows(audit, RETRACT)                            # one row, naming the entry the nurse chose
            assert row.payload["entry"] == entry.id and row.payload["origin"] == "device"
        with TestClient(self._restarted(audit)) as client:
            assert _held(client) == [80.0, 150.0]

    def test_the_other_copy_is_already_withdrawn(self):
        audit, first, second, _ = self._trail()
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            assert _retract(client, first.id).status_code == 200
            r = _retract(client, second.id)
            assert (r.status_code, r.json()["detail"]) == (409, RETRACT_ALREADY)
            assert len(_rows(audit, RETRACT)) == 1                   # a refusal writes no row
            assert _held(client) == [80.0, 150.0]

    def test_a_different_value_at_the_same_time_is_not_skipped(self):
        audit, first, _, other = self._trail()
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            assert _retract(client, other.id).status_code == 200
            assert _held(client) == [80.0, 140.0, 140.0]             # both 140s stay: only 150 was withdrawn
        with TestClient(self._restarted(audit)) as client:
            assert _held(client) == [80.0, 140.0, 140.0]

    def test_another_device_or_another_patient_with_the_same_value_is_not_skipped(self):
        audit, when = InMemoryAuditLog(), _ago(10)
        mine = _row(audit, "ingest", when, 140.0)
        _row(audit, "ingest", when, 140.0, device="CONNEX-3B")       # another device
        _row(audit, "ingest", when, 140.0, key="202600000002")       # another patient
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            assert _retract(client, mine.id).status_code == 200
            assert _held(client) == [140.0] and _held(client, key="202600000002") == [140.0]
        with TestClient(self._restarted(audit)) as client:
            assert _held(client) == [140.0] and _held(client, key="202600000002") == [140.0]

    def test_a_hand_entrys_copy_is_not_skipped(self):
        """Today's rule, kept: a `chart` row is withdrawn by its own id. Two identical hand entries are two
        entries; and a device row that equals a hand entry in code, time and value leaves the hand entry alone."""
        audit, when = InMemoryAuditLog(), _ago(10)
        one = _row(audit, "chart", when, 16.0, code="resp_rate")
        _row(audit, "chart", when, 16.0, code="resp_rate")
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            assert _retract(client, one.id).status_code == 200
            assert _held(client, code=SignalCode.RESP_RATE) == [16.0]
        with TestClient(self._restarted(audit)) as client:
            assert _held(client, code=SignalCode.RESP_RATE) == [16.0]

        audit = InMemoryAuditLog()
        _row(audit, "chart", when, 16.0, code="resp_rate")
        device = _row(audit, "ingest", when, 16.0, code="resp_rate")
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            assert _retract(client, device.id).status_code == 200
            assert _held(client, code=SignalCode.RESP_RATE) == [16.0]    # the hand entry's
        with TestClient(self._restarted(audit)) as client:
            assert _held(client, code=SignalCode.RESP_RATE) == [16.0]

    def _filed(self, store, *entries):
        """One `vital_readings` row per audit row given, filed under KEY with `entry_id` = that row's id. The table
        holds one row per number as received (D14), so each copy is filed as it arrived: the first under KEY, the
        next as a reading linked from another number."""
        for n, entry in enumerate(entries):
            store.add(Reading(tenant="h1", received_key=KEY if n == 0 else f"20260000009{n}", code=entry.subject,
                              value=float(entry.payload["value"]), unit="/min",
                              observed_at=datetime.fromisoformat(entry.payload["obs_ts"]),
                              received_at=datetime.fromisoformat(entry.payload["obs_ts"]), origin=ORIGIN_DEVICE,
                              source=entry.payload["device"], patient_key=KEY, audit_id=entry.id, entry_id=entry.id))

    def _voided(self, store, *entries) -> list[bool]:
        held = {r.entry_id: r for r in store.for_patient("h1", KEY, since=datetime.min.replace(tzinfo=timezone.utc),
                                                         until=datetime.max.replace(tzinfo=timezone.utc))}
        return [held[e.id].voided_at is not None for e in entries]

    @pytest.mark.parametrize("chosen", ["first", "second"])
    def test_the_record_row_of_every_copy_is_marked(self, chosen):
        """The one table row may be filed under either copy's id, so a withdrawal marks each — whichever the nurse
        named. The other value at that time keeps its row unmarked."""
        audit, first, second, other = self._trail()
        store = InMemoryReadingStore()
        self._filed(store, first, second)
        self._filed(store, other)
        app, _, _ = _app(audit=audit, store=store)
        with TestClient(app) as client:
            assert _retract(client, {"first": first, "second": second}[chosen].id).status_code == 200
        assert self._voided(store, first, second, other) == [True, True, False]
        rows = {r.entry_id: r for r in store.for_patient("h1", KEY, since=datetime.min.replace(tzinfo=timezone.utc),
                                                         until=datetime.max.replace(tzinfo=timezone.utc))}
        assert (rows[first.id].voided_by, rows[first.id].void_reason) == ("hem.ayse", WHY)
        assert (rows[second.id].voided_by, rows[second.id].void_reason) == ("hem.ayse", WHY)

    def test_one_failing_mark_does_not_skip_the_other_copies(self, caplog):
        audit, first, second, _ = self._trail()
        tried: list[int] = []

        class _FirstMarkFails(InMemoryReadingStore):
            def void(self, tenant, entry_id, **kw):
                tried.append(entry_id)
                if entry_id == first.id:
                    raise RuntimeError(f"readings down for {KEY}")           # a message that carries a number
                return super().void(tenant, entry_id, **kw)

        store = _FirstMarkFails()
        self._filed(store, first, second)
        app, _, _ = _app(audit=audit, store=store)
        with caplog.at_level("ERROR"), TestClient(app) as client:
            assert _retract(client, first.id).status_code == 200
            assert _held(client) == [80.0, 150.0]                    # the withdrawal stands
            assert len(_rows(audit, RETRACT)) == 1
        assert tried == [first.id, second.id]                        # the second was still marked
        assert self._voided(store, first, second) == [False, True]
        failed = [r for r in caplog.records if "vital_readings" in r.getMessage()]
        assert len(failed) == 1 and "RuntimeError" in failed[0].getMessage()
        assert KEY not in failed[0].getMessage() and failed[0].exc_info is None      # the class, never the text

    def test_the_shadow_lane_forgets_every_copy_too(self, monkeypatch):
        """The lane keeps one reading per `/ingest` and a removal drops ONE equal reading: the route must make one
        call per skipped copy, or the shadow engine keeps the value the real one no longer holds."""
        audit, first, _, _ = self._trail()
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            removed = []
            monkeypatch.setattr(client.app.state.shadow_lane, "retract_observation",
                                lambda hospital, observation: removed.append(observation))
            assert _retract(client, first.id).status_code == 200
            assert [o.value for o in removed] == [140.0, 140.0]

    def test_a_hand_entrys_withdrawal_mirrors_one_reading(self, monkeypatch):
        audit, when = InMemoryAuditLog(), _ago(10)
        one = _row(audit, "chart", when, 16.0, code="resp_rate")
        _row(audit, "chart", when, 16.0, code="resp_rate")
        app, _, _ = _app(audit=audit)
        with TestClient(app) as client:
            removed = []
            monkeypatch.setattr(client.app.state.shadow_lane, "retract_observation",
                                lambda hospital, observation: removed.append(observation))
            assert _retract(client, one.id).status_code == 200
            assert len(removed) == 1

    def test_the_helpers_name_the_copies_and_ignore_a_hand_withdrawal(self):
        audit, when = InMemoryAuditLog(), _ago(10)
        a = _row(audit, "ingest", when, 140.0)
        b = _row(audit, "ingest", when, 140.0)
        c = _row(audit, "ingest", when, 150.0)
        hand = _row(audit, "chart", when, 16.0, code="resp_rate")
        audit.append(AuditEvent("h1", RETRACT, KEY, "resp_rate", {
            "entry": hand.id, "code": "resp_rate", "value": 16.0, "obs_ts": when.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse"}))
        assert retracted_device_readings(audit.records(tenant="h1", limit=100)) == frozenset()   # a hand entry's
        audit.append(AuditEvent("h1", RETRACT, KEY, "heart_rate", {
            "entry": a.id, "code": "heart_rate", "value": 140.0, "obs_ts": when.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        rows = audit.records(tenant="h1", limit=100)
        keys = retracted_device_readings(rows)
        assert device_key_of(a) in keys and device_key_of(b) in keys and device_key_of(c) not in keys
        assert retracted_entries(rows) == {hand.id, a.id}                # the ids are the nurse's choice alone
        for replayed in (self._rehydrated, self._rebuilt):
            assert replayed(rows, keys) == [150.0]                       # neither copy of the 140
            assert replayed(rows, frozenset()) == [140.0, 150.0]         # by id alone, the other copy is replayed

    def _rehydrated(self, rows, keys):
        engine = Engine()
        rehydrate(engine, AckStore(), rows, skip=retracted_entries(rows), skip_device=keys)
        return [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)]

    def _rebuilt(self, rows, keys):
        engine = Engine()
        rebuild_patient(engine, KEY, rows, skip=retracted_entries(rows), skip_device=keys)
        return [o.value for o in engine.state(KEY).history(SignalCode.HEART_RATE)]

    def test_the_key_reads_a_spelling_of_the_time_and_value_as_the_reading_it_is(self):
        """The copy of an older row may spell its time or number differently: the same instant, the same number."""
        audit = InMemoryAuditLog()
        a = audit.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 140, "unit": "/min", "obs_ts": "2026-11-12T10:00:00+00:00", "device": "CONNEX-3A"}))
        b = audit.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": 140.0, "unit": "/min", "obs_ts": "2026-11-12T14:00:00+04:00", "device": "CONNEX-3A"}))
        assert device_key_of(a) == device_key_of(b)
        junk = audit.append(AuditEvent("h1", "ingest", KEY, "heart_rate", {
            "value": {"x": [1]}, "unit": "/min", "obs_ts": ["not", "a", "time"], "device": ["d"]}))
        hash(device_key_of(junk))                                         # a row nobody could have written: no crash
