# homunculus-engine/tests/test_readings_patient.py
"""G3-05 (spec D16, §4): one patient's measurement record — GET /patients/{id}/readings — and the `device` list
of the trends answer. Read-only: what the two doors filed, as sets, with the source of each value and the mark
of a withdrawn one. Synthetic numbers and values only (CLAUDE.md rule 6).

A device reading the trail holds TWICE (a `seen` that failed open) is one reading: a withdrawal names one `ingest`
row and the engine skips every copy (`rehydrate.device_key`). Both readers follow — the trends list pairs a device
row with its withdrawal by that key, the record shows every copy of a withdrawn reading withdrawn — and a hand
entry is paired by its own id alone (`TestTheTwinOfAWithdrawnReading`)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api import app as app_module
from homunculus.api import trends
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    READING_HOURS, READINGS_HOURS, RECEIVED_LATE, STATE_ASSIGNED, STATE_UNMATCHED, WORDS, InMemoryReadingStore,
    Reading, device_identity, patient_readings,
)
from homunculus.api.rehydrate import device_key_of
from homunculus.scope import Scope, ScopeReason
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
WARD2 = {"Authorization": "Bearer ward2-jwt"}
NOBODY = {"Authorization": "Bearer none-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",), perms=frozenset({"board.view", "clinical.chart"})),
    "ward2-jwt": Caller(hospital="h1", actor="hem.zeynep", groups=("nurse",), perms=frozenset({"board.view"})),
    "none-jwt": Caller(hospital="h1", actor="synth-none"),
}
KEY = "202600000001"
WHY = "manşet yanlış koldaydı, yeniden ölçüldü"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


async def _resolve_scope(credential: str) -> Scope:
    if credential == "ward2-jwt":
        return Scope(False, ScopeReason.ASSIGNED, unit_ids=frozenset({"u-2"}))
    return Scope(True, ScopeReason.UNRESTRICTED_ROLE)


class _FailsOpen(InMemoryReadingStore):
    """`seen` raises: D14's check fails open and a re-sent reading is ingested again — the rare path that leaves
    TWO `ingest` audit rows for one device reading (the table's unique index keeps one row of them)."""

    def seen(self, *args, **kw):
        raise RuntimeError("readings down")


def _app(store):
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(KEY, family="Hasta", given="Test", state="admitted", source=KABUL,
                                          unit_id="u-1", bed_id="b-1", updated_at=datetime.now(timezone.utc)))
    return create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, resolve_scope=_resolve_scope,
                      audit=InMemoryAuditLog(), identities=identities, readings=store)


@pytest.fixture()
def client():
    with TestClient(_app(InMemoryReadingStore())) as c:
        yield c


@pytest.fixture()
def twin_client():
    with TestClient(_app(_FailsOpen())) as c:
        yield c


def _ago(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


def _send(client, pairs, when, device="CONNEX-3A"):
    for code, value in pairs:
        assert client.post("/ingest", json=obs(code, value, KEY, when, device=device), headers=DEVICE).status_code == 200


def _chart(client, entries, when):
    r = client.post(f"/clinical/{KEY}", json={"entries": entries, "recorded_at": when.isoformat()}, headers=NURSE)
    assert r.status_code == 200, r.text
    return {e["code"]: e["entry"] for e in r.json()["entries"]}


def _read(client, hours=None, headers=NURSE, key=KEY):
    return client.get(f"/patients/{key}/readings", params={} if hours is None else {"hours": hours}, headers=headers)


def _twin(client, when, code="sbp", value=88):
    """One device reading sent twice with the readings store failing open: two `ingest` rows, the ids returned."""
    _send(client, [(code, value), (code, value)], when)
    ids = [r.id for r in client.app.state.audit.records(tenant="h1", patient_id=KEY, event_type="ingest", limit=50)
           if r.subject == code]
    assert len(ids) == 2
    return ids


def _retract(client, entry):
    r = client.post(f"/clinical/{KEY}/entries/{entry}/retract", json={"reason": WHY}, headers=NURSE)
    assert r.status_code == 200, r.text


class TestTheRecord:
    def test_the_sets_come_newest_first_each_value_with_its_source(self, client):
        early, late = _ago(120), _ago(10)
        _send(client, [("spo2", 97), ("heart_rate", 88)], early)
        entries = _chart(client, [{"code": "resp_rate", "value": 16}], late)
        r = _read(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert (body["patient_id"], body["hours"]) == (KEY, 24)
        assert datetime.fromisoformat(body["until"]) - datetime.fromisoformat(body["since"]) == timedelta(hours=24)
        hand, device = body["sets"]
        assert (hand["origin"], hand["source"], hand["recorded_by"], hand["observed_at"]) == ("manual", "clinician", "hem.ayse", late.isoformat())
        assert hand["readings"] == [{"id": hand["readings"][0]["id"], "code": "resp_rate", "value": 16.0, "unit": "/min",
                                     "origin": "manual", "source": "clinician", "recorded_by": "hem.ayse",
                                     "entry": entries["resp_rate"], "voided": None}]
        assert (device["origin"], device["source"], device["recorded_by"], device["observed_at"]) == ("device", "CONNEX-3A", None, early.isoformat())
        assert [(v["code"], v["value"]) for v in device["readings"]] == [("heart_rate", 88.0), ("spo2", 97.0)]
        assert all(isinstance(v["entry"], int) and v["voided"] is None for v in device["readings"])
        assert sorted(device) == ["observed_at", "origin", "readings", "received_at", "received_late", "recorded_by", "source"]

    def test_a_withdrawn_value_stays_with_its_reason_who_and_when(self, client):
        when = _ago(10)
        _send(client, [("sbp", 88)], when)
        [value] = _read(client).json()["sets"][0]["readings"]
        r = client.post(f"/clinical/{KEY}/entries/{value['entry']}/retract", json={"reason": WHY}, headers=NURSE)
        assert r.status_code == 200, r.text
        [after] = _read(client).json()["sets"][0]["readings"]
        assert (after["value"], after["voided"]["reason"], after["voided"]["by"]) == (88.0, WHY, "hem.ayse")
        assert datetime.fromisoformat(after["voided"]["at"]).utcoffset() == timedelta(0)

    def test_a_reading_that_arrived_long_after_it_was_measured_says_so(self, client):
        """D16: «alındı» is shown when arrival and measurement differ by more than five minutes — decided here."""
        _send(client, [("spo2", 97)], _ago(30))                          # a buffered reading, sent half an hour on
        _send(client, [("spo2", 96)], _ago(1))
        fresh, buffered = _read(client).json()["sets"]
        assert (fresh["received_late"], buffered["received_late"]) == (False, True)
        assert RECEIVED_LATE == timedelta(minutes=5)

    @pytest.mark.parametrize("hours,shown", [("24", 1), ("72", 2), ("168", 3)])
    def test_the_three_windows(self, client, hours, shown):
        store = client.app.state.readings
        for n, age in enumerate((timedelta(hours=2), timedelta(hours=40), timedelta(hours=100), timedelta(hours=200))):
            at = datetime.now(timezone.utc) - age
            store.add(Reading(tenant="h1", received_key=KEY, patient_key=KEY, code="spo2", value=97.0, unit="%",
                              observed_at=at, received_at=at, origin="device", source="CONNEX-3A", audit_id=1000 + n,
                              entry_id=1000 + n))
        client.post("/ingest", json=obs("heart_rate", 80, KEY, _ago(500 * 60)), headers=DEVICE)   # the engine knows the patient
        body = _read(client, hours).json()
        assert body["hours"] == int(hours)
        assert len([s for s in body["sets"] if s["readings"][0]["code"] == "spo2"]) == shown

    def test_the_windows_are_exactly_these(self):
        assert READINGS_HOURS == (24, 72, 168)

    @pytest.mark.parametrize("hours", ["6", "0", "abc", "24.0", ""])
    def test_any_other_window_is_400_with_its_code(self, client, hours):
        r = _read(client, hours)
        assert (r.status_code, r.json()["detail"]) == (400, {"code": READING_HOURS, "message": WORDS[READING_HOURS]})
        assert READING_HOURS == "reading_hours"

    def test_an_admitted_patient_nobody_measured_has_an_empty_record(self, client):
        assert _read(client).json()["sets"] == []

    def test_a_reading_linked_from_the_list_is_in_the_record(self):
        """A linked reading is filed under the patient with its own time and the device as its source."""
        from tests.test_readings_api import KEY as TARGET, TYPO, _app as unmatched_app
        app, _, _ = unmatched_app()
        with TestClient(app) as c:
            when = _ago(20)
            c.post("/ingest", json=obs("spo2", 97, TYPO, when), headers=DEVICE)
            [waiting] = c.get("/readings/unmatched", headers=NURSE).json()["sets"]
            ids = [v["id"] for v in waiting["readings"]]
            assert c.post("/readings/unmatched/assign", json={"readings": ids, "patient_id": TARGET}, headers=NURSE).status_code == 200
            [linked] = c.get(f"/patients/{TARGET}/readings", headers=NURSE).json()["sets"]
            assert (linked["origin"], linked["source"], linked["observed_at"]) == ("device", "CONNEX-3A", when.isoformat())
            assert linked["readings"][0]["id"] == ids[0] and isinstance(linked["readings"][0]["entry"], int)


class TestWhoMayRead:
    def test_it_needs_a_credential_and_board_view(self, client):
        assert client.get(f"/patients/{KEY}/readings").status_code == 401
        r = _read(client, headers=NOBODY)
        assert (r.status_code, r.json()["detail"]) == (403, "permission required: board.view")

    def test_out_of_scope_and_unknown_are_one_404(self, client):
        r = _read(client, headers=WARD2)                                 # KEY lies in u-1
        assert (r.status_code, r.json()["detail"]) == (404, "hasta bulunamadı")
        assert _read(client, key="202600000099").status_code == 404
        assert "202600000099" not in [p["patient_id"] for p in client.get("/patients", headers=DEVICE).json()["patients"]]

    def test_a_read_writes_no_audit_row(self, client):
        _send(client, [("spo2", 97)], _ago(5))
        audit = client.app.state.audit
        before = len(audit.records(tenant="h1", limit=1000))
        assert _read(client).status_code == 200
        assert len(audit.records(tenant="h1", limit=1000)) == before

    def test_the_device_token_reads_too(self, client):
        assert _read(client, headers=DEVICE).status_code == 200


class TestThePureAnswer:
    T0 = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)

    def _row(self, n, **over):
        base = dict(tenant="h1", received_key=KEY, patient_key=KEY, code="spo2", value=97.0, unit="%",
                    observed_at=self.T0, received_at=self.T0 + timedelta(seconds=30), origin="device",
                    source="CONNEX-3A", id=n, audit_id=n, entry_id=n)
        return Reading(**{**base, **over})

    def test_one_set_per_time_origin_source_and_person(self):
        rows = [
            self._row(1), self._row(2, code="heart_rate", value=88.0, unit="/min"),
            self._row(3, source="CONNEX-3B", value=96.0),
            self._row(4, origin="manual", source="clinician", recorded_by="hem.ayse", code="resp_rate", value=16.0),
            self._row(5, origin="manual", source="clinician", recorded_by="hem.leyla", code="resp_rate", value=18.0),
            self._row(6, observed_at=self.T0 + timedelta(minutes=1)),
        ]
        body = patient_readings(rows, patient_id=KEY, hours=24, now=self.T0 + timedelta(hours=1))
        assert [(s["observed_at"], s["origin"], s["source"], s["recorded_by"], len(s["readings"])) for s in body["sets"]] == [
            ((self.T0 + timedelta(minutes=1)).isoformat(), "device", "CONNEX-3A", None, 1),
            (self.T0.isoformat(), "device", "CONNEX-3A", None, 2),
            (self.T0.isoformat(), "device", "CONNEX-3B", None, 1),
            (self.T0.isoformat(), "manual", "clinician", "hem.ayse", 1),
            (self.T0.isoformat(), "manual", "clinician", "hem.leyla", 1),
        ]
        assert (body["since"], body["until"]) == ((self.T0 - timedelta(hours=23)).isoformat(), (self.T0 + timedelta(hours=1)).isoformat())

    def test_a_row_with_no_entry_has_none(self):
        body = patient_readings([self._row(1, entry_id=None)], patient_id=KEY, hours=24, now=self.T0)
        assert body["sets"][0]["readings"][0]["entry"] is None

    def test_a_copy_of_a_withdrawn_device_reading_shows_the_same_withdrawal(self):
        """The table keeps one row of a reading the trail holds twice, but a race (a direct row and a linked one)
        can leave two. Withdrawing one withdraws the reading: the copy whose own mark is missing carries the other's."""
        mark = dict(voided_at=self.T0 + timedelta(minutes=2), voided_by="hem.ayse", void_reason=WHY)
        rows = [self._row(1, received_key="202600000010", entry_id=11, **mark), self._row(2, entry_id=12),
                self._row(3, value=96.0, entry_id=13)]                 # another value of the set: untouched
        voided = {v["id"]: v["voided"] for v in patient_readings(rows, patient_id=KEY, hours=24, now=self.T0
                                                                 )["sets"][0]["readings"]}
        assert voided[1] == voided[2] == {"reason": WHY, "by": "hem.ayse",
                                          "at": (self.T0 + timedelta(minutes=2)).isoformat()}
        assert voided[3] is None

    def test_the_earliest_withdrawal_stands_when_two_copies_were_marked_apart(self):
        first = dict(voided_at=self.T0 + timedelta(minutes=2), voided_by="hem.ayse", void_reason=WHY)
        later = dict(voided_at=self.T0 + timedelta(minutes=9), voided_by="hem.leyla", void_reason="başka bir neden yazıldı")
        rows = [self._row(1, entry_id=11, **later), self._row(2, entry_id=12, **first), self._row(3, entry_id=13)]
        by = {v["id"]: v["voided"]["by"] for v in patient_readings(rows, patient_id=KEY, hours=24, now=self.T0
                                                                   )["sets"][0]["readings"]}
        assert by == {1: "hem.leyla", 2: "hem.ayse", 3: "hem.ayse"}      # a mark already there is never overwritten

    def test_a_hand_entry_is_paired_by_its_own_row_alone(self):
        """Two equal hand entries are two entries (G3-01: «an equal value charted twice at one time may rightly
        stay once»): withdrawing one withdraws that one."""
        hand = dict(origin="manual", source="clinician", recorded_by="hem.ayse")
        rows = [self._row(1, entry_id=11, voided_at=self.T0, voided_by="hem.ayse", void_reason=WHY, **hand),
                self._row(2, entry_id=12, **hand)]
        voided = {v["id"]: v["voided"] for v in patient_readings(rows, patient_id=KEY, hours=24, now=self.T0
                                                                 )["sets"][0]["readings"]}
        assert voided[1] is not None and voided[2] is None

    def test_a_device_reading_and_a_hand_entry_of_one_value_are_not_one_reading(self):
        rows = [self._row(1, entry_id=11, voided_at=self.T0, voided_by="hem.ayse", void_reason=WHY),
                self._row(2, origin="manual", source="clinician", recorded_by="hem.ayse", entry_id=12)]
        body = patient_readings(rows, patient_id=KEY, hours=24, now=self.T0)
        assert {v["origin"]: v["voided"] is not None for s in body["sets"] for v in s["readings"]} == {
            "device": True, "manual": False}

    def test_a_linked_reading_entered_the_record_when_it_was_linked(self):
        """B8 review: measured 07:00, arrived 07:00 under a mistyped number, linked at 10:00 — missing from the
        patient's scores for three hours, so the record says «alındı» with the link's time. Linking never changes
        the row's own `received_at` (the list's arrival), so the record reads `resolved_at` for an `assigned` row."""
        seven, ten = self.T0 - timedelta(hours=2), self.T0 + timedelta(hours=1)
        linked = self._row(1, observed_at=seven, received_at=seven + timedelta(seconds=20), state=STATE_ASSIGNED,
                           resolved_at=ten, resolved_by="hem.ayse", received_key="202600000010")
        [one] = patient_readings([linked], patient_id=KEY, hours=24, now=ten + timedelta(minutes=5))["sets"]
        assert (one["received_late"], one["received_at"]) == (True, ten.isoformat())
        direct = self._row(2, observed_at=seven, received_at=seven + timedelta(seconds=20))     # the control
        [two] = patient_readings([direct], patient_id=KEY, hours=24, now=ten)["sets"]
        assert (two["received_late"], two["received_at"]) == (False, (seven + timedelta(seconds=20)).isoformat())

    def test_a_set_is_as_late_as_its_latest_value(self):
        seven, ten = self.T0 - timedelta(hours=2), self.T0 + timedelta(hours=1)
        rows = [self._row(1, observed_at=seven, received_at=seven + timedelta(seconds=20)),
                self._row(2, code="heart_rate", value=88.0, observed_at=seven, received_at=seven,
                          state=STATE_ASSIGNED, resolved_at=ten)]
        [one] = patient_readings(rows, patient_id=KEY, hours=24, now=ten)["sets"]
        assert (one["received_late"], one["received_at"], len(one["readings"])) == (True, ten.isoformat(), 2)

    def test_the_answer_says_truncated_only_when_the_read_was_cut(self):
        assert "truncated" not in patient_readings([self._row(1)], patient_id=KEY, hours=24, now=self.T0)
        cut = patient_readings([self._row(1)], patient_id=KEY, hours=24, now=self.T0, truncated=True)
        assert cut["truncated"] is True


def _channel(client, key, hours=24):
    r = client.get(f"/patients/{KEY}/trends", params={"hours": hours}, headers=NURSE)
    assert r.status_code == 200, r.text
    return next(c for c in r.json()["channels"] if c["key"] == key)


class TestTheTrendsDeviceList:
    def test_each_channel_lists_its_device_readings_beside_the_hand_ones(self, client):
        when = _ago(10)
        _send(client, [("sbp", 118), ("heart_rate", 88)], when)
        entries = _chart(client, [{"code": "sbp", "value": 121}], _ago(5))
        sbp = _channel(client, "sbp")
        [device] = sbp["device"]
        assert sorted(device) == ["at", "entry", "retracted", "source", "value"]
        assert (device["at"], device["value"], device["source"], device["retracted"]) == (when.isoformat(), 118.0, "CONNEX-3A", None)
        assert [m["entry"] for m in sbp["manual"]] == [entries["sbp"]]   # `manual` is what it was
        assert _channel(client, "resp_rate")["device"] == []

    def test_a_withdrawn_device_reading_is_marked_and_off_the_line(self, client):
        when = _ago(10)
        _send(client, [("sbp", 88)], when)
        entry = _channel(client, "sbp")["device"][0]["entry"]
        assert client.post(f"/clinical/{KEY}/entries/{entry}/retract", json={"reason": WHY}, headers=NURSE).status_code == 200
        sbp = _channel(client, "sbp")
        [device] = sbp["device"]
        assert (device["entry"], device["retracted"]["reason"], device["retracted"]["by"]) == (entry, WHY, "hem.ayse")
        assert sbp["points"] == []                                        # the engine dropped it: nothing is drawn

    def test_a_device_reading_outside_the_window_is_not_listed(self, client):
        _send(client, [("sbp", 118)], _ago(7 * 60))
        assert _channel(client, "sbp", hours=6)["device"] == []
        assert len(_channel(client, "sbp", hours=24)["device"]) == 1


class TestTheTwinOfAWithdrawnReading:
    """B7 review: two `ingest` rows of one device reading, one withdrawal naming either. The engine skips both, so
    both readers show the reading withdrawn: the trends list pairs by `device_key` (every copy is listed, every
    copy marked — never collapsed), the record shows every copy of a withdrawn reading withdrawn."""

    @pytest.mark.parametrize("named", [0, 1])
    def test_the_trends_list_marks_both_copies_whichever_one_the_nurse_named(self, twin_client, named):
        ids = _twin(twin_client, _ago(10))
        before = _channel(twin_client, "sbp")["device"]
        assert [d["entry"] for d in before] == ids and [d["retracted"] for d in before] == [None, None]
        _retract(twin_client, ids[named])
        sbp = _channel(twin_client, "sbp")
        first, second = sbp["device"]
        assert (first["entry"], second["entry"]) == tuple(ids)
        assert first["retracted"] is not None and first["retracted"] == second["retracted"]
        assert (first["retracted"]["reason"], first["retracted"]["by"]) == (WHY, "hem.ayse")
        assert first["retracted"] is not second["retracted"]              # two answers, not one shared object
        assert sbp["points"] == []                                        # the engine dropped both: nothing is drawn

    @pytest.mark.parametrize("named", [0, 1])
    def test_the_record_shows_its_one_row_withdrawn_whichever_copy_was_named(self, twin_client, named):
        ids = _twin(twin_client, _ago(10))
        [before] = _read(twin_client).json()["sets"][0]["readings"]      # the unique index kept one row of the two
        assert before["entry"] == ids[0] and before["voided"] is None
        _retract(twin_client, ids[named])
        [after] = _read(twin_client).json()["sets"][0]["readings"]
        assert (after["voided"]["reason"], after["voided"]["by"]) == (WHY, "hem.ayse")

    def test_the_readers_agree_on_which_values_are_withdrawn(self, twin_client):
        when = _ago(10)
        ids = _twin(twin_client, when)
        _send(twin_client, [("heart_rate", 88)], when)                  # another value of the same round
        _retract(twin_client, ids[1])
        channels = twin_client.get(f"/patients/{KEY}/trends", params={"hours": 24}, headers=NURSE).json()["channels"]
        trends_struck = {c["key"] for c in channels if c["device"] and all(d["retracted"] for d in c["device"])}
        [round_] = _read(twin_client).json()["sets"]
        record_struck = {v["code"] for v in round_["readings"] if v["voided"]}      # the channel keys are the codes
        assert trends_struck == record_struck == {"sbp"}

    def test_a_twin_row_of_the_table_is_withdrawn_with_the_row_that_was(self, client):
        """The race of a direct row and a linked one: two table rows of one reading, one marked."""
        store = client.app.state.readings
        at = _ago(30)
        for n, received in enumerate((KEY, "202600000010")):
            store.add(Reading(tenant="h1", received_key=received, patient_key=KEY, code="sbp", value=88.0, unit="mmHg",
                              observed_at=at, received_at=at, origin="device", source="CONNEX-3A",
                              audit_id=2000 + n, entry_id=2000 + n))
        client.post("/ingest", json=obs("heart_rate", 80, KEY, _ago(20)), headers=DEVICE)   # the engine knows the patient
        assert store.void("h1", 2000, by="hem.ayse", at=_ago(1), reason=WHY)
        [round_] = [s for s in _read(client).json()["sets"] if s["readings"][0]["code"] == "sbp"]
        assert [v["entry"] for v in round_["readings"]] == [2000, 2001]
        assert [(v["voided"]["reason"], v["voided"]["by"]) for v in round_["readings"]] == [(WHY, "hem.ayse")] * 2

    def test_the_records_key_is_the_trails_key(self, client):
        """`device_identity` (the table's form, `api/readings.py`, which cannot import the trail's `rehydrate`) is
        `rehydrate.device_key_of` of the row the reading came from: one reading, one key, in both readers."""
        _send(client, [("sbp", 118), ("spo2", 97)], _ago(10))
        trail = {r.subject: device_key_of(r) for r in client.app.state.audit.records(
            tenant="h1", patient_id=KEY, event_type="ingest", limit=50)}
        rows = client.app.state.readings.for_patient("h1", KEY, since=_ago(60), until=_ago(0))
        assert {r.code: device_identity(r) for r in rows} == trail and len(trail) == 2


def _trends(client, hours=24):
    r = client.get(f"/patients/{KEY}/trends", params={"hours": hours}, headers=NURSE)
    assert r.status_code == 200, r.text
    return r.json()


def _flood(client, n, code="spo2"):
    """`n` device `ingest` rows of one channel written straight into the trail, one second apart and all inside
    the window — a continuous monitor. The times, oldest first."""
    audit = client.app.state.audit
    first = datetime.now(timezone.utc) - timedelta(minutes=1) - timedelta(seconds=n)
    times = [(first + timedelta(seconds=i)).isoformat() for i in range(n)]
    for at in times:
        audit.append(AuditEvent("h1", "ingest", KEY, code, {"value": 97.0, "unit": "%", "obs_ts": at,
                                                            "device": "CONNEX-3A"}))
    return times


class TestTheDeviceBudget:
    """B8 review: the device `ingest` rows have a read of their own (`TRENDS_DEVICE_LIMIT`), so a monitor writing a
    row a minute never pushes a hand entry or a withdrawal out of the hand read (`TRENDS_MANUAL_LIMIT`)."""

    def test_a_flood_of_device_rows_cuts_no_hand_entry_and_no_withdrawal(self, client):
        entries = _chart(client, [{"code": "sbp", "value": 121}, {"code": "heart_rate", "value": 82}], _ago(120))
        _retract(client, entries["sbp"])
        times = _flood(client, trends.TRENDS_DEVICE_LIMIT + 1)
        assert trends.TRENDS_DEVICE_LIMIT == 5000 == trends.TRENDS_MANUAL_LIMIT
        body = _trends(client)
        assert (body["manual_truncated"], body["device_truncated"]) == (False, True)
        [hand] = _channel(client, "sbp")["manual"]
        assert (hand["entry"], hand["retracted"]["reason"]) == (entries["sbp"], WHY)
        assert [m["entry"] for m in _channel(client, "heart_rate")["manual"]] == [entries["heart_rate"]]
        listed = next(c for c in body["channels"] if c["key"] == "spo2")["device"]
        assert [d["at"] for d in listed] == times[1:]                    # the NEWEST rows are kept, oldest first

    def test_both_flags_are_in_every_answer_and_false_when_nothing_was_cut(self, client):
        _send(client, [("sbp", 118)], _ago(10))
        body = _trends(client)
        assert (body["manual_truncated"], body["device_truncated"]) == (False, False)

    def test_the_device_flag_says_when_the_oldest_readings_were_left_out(self, client, monkeypatch):
        monkeypatch.setattr(trends, "TRENDS_DEVICE_LIMIT", 2)
        _send(client, [("sbp", 118)], _ago(30))
        _send(client, [("sbp", 119)], _ago(20))
        body = _trends(client)
        assert (body["device_truncated"], len(_channel(client, "sbp")["device"])) == (False, 2)    # it just fits
        _send(client, [("sbp", 120)], _ago(10))
        body = _trends(client)
        assert (body["device_truncated"], body["manual_truncated"]) == (True, False)
        assert [d["value"] for d in _channel(client, "sbp")["device"]] == [119.0, 120.0]

    def test_a_kept_device_reading_still_carries_its_withdrawal_when_the_device_read_is_cut(self, client, monkeypatch):
        """The withdrawal is a `chart_retract` row, read with the hand entries: the device cut cannot lose it."""
        monkeypatch.setattr(trends, "TRENDS_DEVICE_LIMIT", 2)
        _send(client, [("spo2", 97)], _ago(30))                          # the oldest: cut
        _send(client, [("sbp", 88)], _ago(20))
        _send(client, [("spo2", 96)], _ago(10))
        _retract(client, _channel(client, "sbp")["device"][0]["entry"])
        body = _trends(client)
        assert body["device_truncated"] is True
        [sbp] = _channel(client, "sbp")["device"]
        assert (sbp["value"], sbp["retracted"]["reason"], sbp["retracted"]["by"]) == (88.0, WHY, "hem.ayse")
        assert [d["value"] for d in _channel(client, "spo2")["device"]] == [96.0]

    def test_the_hand_budget_is_exactly_what_it_was(self, client, monkeypatch):
        """Hand rows alone fill `TRENDS_MANUAL_LIMIT`: device rows add nothing to it, a hand cut still says so."""
        monkeypatch.setattr(trends, "TRENDS_MANUAL_LIMIT", 2)
        _send(client, [("sbp", 118), ("spo2", 97)], _ago(40))
        _chart(client, [{"code": "heart_rate", "value": 82}], _ago(30))
        _chart(client, [{"code": "heart_rate", "value": 84}], _ago(20))
        body = _trends(client)
        assert (body["manual_truncated"], body["device_truncated"]) == (False, False)
        _chart(client, [{"code": "heart_rate", "value": 86}], _ago(10))
        assert _trends(client)["manual_truncated"] is True


class TestTheRecordRead:
    def test_a_linked_reading_is_late_by_its_link_in_the_answer(self, client):
        store = client.app.state.readings
        observed, linked_at = _ago(180), _ago(2)
        waiting = store.add(Reading(tenant="h1", received_key="202600000010", code="spo2", value=97.0, unit="%",
                                    observed_at=observed, received_at=observed + timedelta(seconds=20),
                                    origin="device", source="CONNEX-3A", state=STATE_UNMATCHED,
                                    unmatched_reason="unknown", audit_id=3001))
        store.claim("h1", [waiting.id], by="hem.ayse", at=linked_at)
        store.finalize("h1", waiting.id, patient_key=KEY, admission_id=None, entry_id=3002)
        client.post("/ingest", json=obs("heart_rate", 80, KEY, _ago(500 * 60)), headers=DEVICE)   # the engine knows the patient
        [one] = _read(client).json()["sets"]
        assert (one["received_late"], one["received_at"]) == (True, linked_at.isoformat())

    def _fill(self, client, n):
        store = client.app.state.readings
        client.post("/ingest", json=obs("heart_rate", 80, KEY, _ago(500 * 60)), headers=DEVICE)   # outside every window
        for i in range(n):
            at = _ago(60 - i)
            store.add(Reading(tenant="h1", received_key=KEY, patient_key=KEY, code="spo2", value=90.0 + i, unit="%",
                              observed_at=at, received_at=at, origin="device", source="CONNEX-3A",
                              audit_id=4000 + i, entry_id=4000 + i))

    def test_the_read_is_bounded_to_the_newest_rows_and_says_when_it_cut(self, client, monkeypatch):
        monkeypatch.setattr(app_module, "RECORD_ROWS_MAX", 3)
        self._fill(client, 4)
        body = _read(client).json()
        assert body["truncated"] is True
        assert [v["value"] for s in body["sets"] for v in s["readings"]] == [93.0, 92.0, 91.0]   # the oldest went

    def test_a_read_that_just_fits_does_not_say_it_cut(self, client, monkeypatch):
        monkeypatch.setattr(app_module, "RECORD_ROWS_MAX", 4)
        self._fill(client, 4)
        body = _read(client).json()
        assert "truncated" not in body and len(body["sets"]) == 4

    def test_a_value_stamped_ahead_is_in_neither_the_record_nor_the_trends_list(self, client):
        """Both read to the answer's own `until`: a value a clock that runs fast stamped a minute from now is in no
        list yet — and the two lists never disagree about it."""
        _send(client, [("sbp", 118)], _ago(10))
        _send(client, [("sbp", 150)], _ago(-1))
        record = _read(client).json()
        assert [v["value"] for s in record["sets"] for v in s["readings"]] == [118.0]
        assert [d["value"] for d in _channel(client, "sbp")["device"]] == [118.0]
        assert datetime.fromisoformat(record["until"]) < datetime.now(timezone.utc) + timedelta(seconds=1)

    def test_a_durable_stores_record_is_read_in_a_worker_thread(self):
        """Final review (minor 8): up to RECORD_ROWS_MAX rows, polled every minute per open patient screen — a durable
        store's read runs in a thread, not on the event loop (as the hourly reconcile does); one in memory reads
        inline."""
        import threading

        class _Durable(InMemoryReadingStore):
            durable = True
            threads: list = []

            def for_patient(self, tenant, patient_key, **kw):
                self.threads.append(threading.current_thread())
                return super().for_patient(tenant, patient_key, **kw)

        async def loop_thread():
            return threading.current_thread()
        for store, off_the_loop in ((_Durable(), True), (type("_Inline", (_Durable,), {"durable": False})(), False)):
            store.threads = []
            with TestClient(_app(store)) as c:
                _send(c, [("spo2", 97)], _ago(10))
                r = _read(c)
                assert r.status_code == 200 and len(r.json()["sets"]) == 1
                on_the_loop = c.portal.call(loop_thread)
            assert store.threads and (on_the_loop not in store.threads) is off_the_loop
