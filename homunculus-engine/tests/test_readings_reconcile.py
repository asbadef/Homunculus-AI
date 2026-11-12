# homunculus-engine/tests/test_readings_reconcile.py
"""G3-05 (spec D7, D12, D19): `reconcile` — the audit trail is the source of truth and the readings table its
projection, so whatever the table lacks can be written again from the trail: a missing row, a missing mark, a
claim left behind. Idempotent. And the backfill script that runs it for the stays open on the deploy day.
Synthetic numbers and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

import importlib.util
import json
import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

import homunculus.api.audit as audit_module
from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.clinical import RETRACT
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import KABUL, IdentityRecord, InMemoryIdentityStore
from homunculus.api.readings import (
    CLAIM_STALE, POLICY_UNMATCHED, READING_ASSIGNED, READING_REJECTED, READING_UNMATCHED, RECONCILE_WINDOW,
    RESOLVE_ALREADY_HELD, STATE_ASSIGNED, STATE_RECORDED, STATE_REJECTED, STATE_UNMATCHED, InMemoryReadingStore,
    _observation_of_row, device_reading, reconcile,
)
from tests.conftest import ENGINE_ROOT
from tests.test_ingest_apply import obs
from tests.test_readings_ingest import _Flaky

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
KEY, TYPO = "202600000001", "202600000010"
ADMISSION = "11111111-1111-4111-8111-111111111111"       # a synthetic admission id
NOW = datetime.now(timezone.utc)
WHEN = NOW - timedelta(minutes=30)
ALL = {"since": NOW - timedelta(days=30), "until": NOW + timedelta(hours=1)}
NOTHING = {"recorded": 0, "unmatched": 0, "voided": 0, "finalized": 0, "rejected": 0, "released": 0, "skipped": 0}
WHY = "manşet yanlış koldaydı, yeniden ölçüldü"

SCRIPT = ENGINE_ROOT / "scripts" / "backfill_vital_readings.py"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _ingest_row(audit, code, value, when=WHEN, key=KEY, device="CONNEX-3A", **extra):
    return audit.append(AuditEvent("h1", "ingest", key, code, {
        "value": float(value), "unit": "u", "obs_ts": when.isoformat(), "device": device, **extra}))


def _chart_row(audit, code, value, when=WHEN, key=KEY, by="hem.ayse"):
    return audit.append(AuditEvent("h1", "chart", key, code, {
        "value": float(value), "unit": "/min", "obs_ts": when.isoformat(), "charted_by": by}))


def _unmatched_row(audit, code, value, when=WHEN, key=TYPO, reason="unknown"):
    return audit.append(AuditEvent("h1", READING_UNMATCHED, key, code, {
        "value": float(value), "unit": "u", "obs_ts": when.isoformat(), "device": "CONNEX-3A", "reason": reason}))


def _withdrawal(audit, entry, code, value, when=WHEN, key=KEY, device="CONNEX-3A", by="hem.ayse"):
    """The `chart_retract` row of a DEVICE reading (what the route writes for an `ingest` entry)."""
    return audit.append(AuditEvent("h1", RETRACT, key, code, {
        "entry": entry, "code": code, "value": float(value), "obs_ts": when.isoformat(), "reason": WHY,
        "retracted_by": by, "origin": "device", "device": device}))


def _obs_of(record):
    """The observation an `ingest` row recorded — what the door held when it filed the row's table row."""
    return _observation_of_row(record)


class _Reads(InMemoryAuditLog):
    """An audit log that remembers the `after_id` of every page `reconcile` asked for."""

    def __init__(self):
        super().__init__()
        self.afters = []

    def records(self, **kw):
        self.afters.append(kw.get("after_id"))
        return super().records(**kw)


class _NoFloor(_Reads):
    """An audit that cannot answer a floor (a fake, an older backend): `reconcile` reads it from the start."""
    first_id_at_or_after = None


def _stamped(monkeypatch, *instants):
    """The audit's clock, set: the next appends are written at these instants, in order."""
    stamps = iter(at.isoformat() for at in instants)
    monkeypatch.setattr(audit_module, "_now_iso", lambda: next(stamps))


def _run(store, audit, **kw):
    return reconcile(store, audit, tenant="h1", now=kw.pop("now", NOW), **kw)


class TestAMissingRow:
    def test_a_device_reading_and_a_bedside_value_are_filed_from_their_audit_rows(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
        device = _ingest_row(audit, "spo2", 97)
        hand = _chart_row(audit, "resp_rate", 16)
        counts = _run(store, audit)
        assert counts == {**NOTHING, "recorded": 2}
        rows = {r.code: r for r in store.for_patient("h1", KEY, **ALL)}
        spo2, resp = rows["spo2"], rows["resp_rate"]
        assert (spo2.origin, spo2.source, spo2.state, spo2.value, spo2.unit) == ("device", "CONNEX-3A", STATE_RECORDED, 97.0, "u")
        assert (spo2.audit_id, spo2.entry_id, spo2.observed_at, spo2.admission_id) == (device.id, device.id, WHEN, ADMISSION)
        assert (spo2.received_key, spo2.patient_key) == (KEY, KEY)
        assert spo2.received_at == datetime.fromisoformat(device.ts)                # when the door wrote the row
        assert (resp.origin, resp.source, resp.recorded_by, resp.entry_id) == ("manual", "clinician", "hem.ayse", hand.id)
        assert resp.admission_id == ADMISSION

    def test_a_number_with_no_open_admission_is_filed_with_none(self):
        """A HIS-fed patient (or a number nobody is admitted under) has no open admission: the stamp is NULL, as at
        the door; another number's admission is never borrowed."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", "H-99"): ADMISSION})
        _ingest_row(audit, "spo2", 97)
        _run(store, audit)
        assert [r.admission_id for r in store.for_patient("h1", KEY, **ALL)] == [None]

    def test_the_widths_are_the_doors(self):
        """The same builders as the doors: a long device name and unit are cut to the columns' widths."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {
            "value": 97.0, "unit": "u" * 40, "obs_ts": WHEN.isoformat(), "device": "D" * 100}))
        assert _run(store, audit) == {**NOTHING, "recorded": 1}
        [row] = store.for_patient("h1", KEY, **ALL)
        assert (row.source, row.unit) == ("D" * 64, "u" * 16)

    def test_what_the_doors_do_not_file_is_not_filed_here_either(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _chart_row(audit, "urine_output_ml", 200)            # the fluid ledger's
        _chart_row(audit, "lactate", 2.1)                    # no bedside vital
        audit.append(AuditEvent("h1", "alert", KEY, "news2", {"severity": "high"}))
        assert _run(store, audit) == NOTHING and store.for_patient("h1", KEY, **ALL) == []

    def test_a_reading_the_door_listed_is_filed_as_unmatched(self):
        """The failed table add of D7 (as amended): the `reading_unmatched` row was written, the 200 was answered, and
        the table row was not — `reconcile` is the only repair."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        row = _unmatched_row(audit, "spo2", 97, reason="discharged")
        assert _run(store, audit) == {**NOTHING, "unmatched": 1}
        [listed] = store.unmatched("h1", since=NOW - timedelta(days=7))
        assert (listed.state, listed.unmatched_reason, listed.received_key, listed.patient_key) == (STATE_UNMATCHED, "discharged", TYPO, None)
        assert (listed.audit_id, listed.entry_id, listed.value) == (row.id, None, 97.0)

    def test_a_failed_add_on_the_unmatched_path_is_made_good(self):
        """The door side of the same amendment: `/ingest` answers 200 when the table cannot take an unmatched
        reading, and the next `reconcile` pass lists it."""
        audit, store = InMemoryAuditLog(), _Flaky()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, readings=store,
                         unknown_readings=POLICY_UNMATCHED)
        with TestClient(app) as client:
            store.fail = {"add"}
            posted = client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE)
            assert posted.status_code == 200 and posted.json() == {"patient_id": TYPO, "dropped": "unmatched"}
            assert store.unmatched("h1", since=NOW - timedelta(days=7)) == []
            store.fail = set()
            client.portal.call(app.state.reconcile_readings)
            [listed] = store.unmatched("h1", since=NOW - timedelta(days=7))
            assert (listed.received_key, listed.code, listed.value, listed.unmatched_reason) == (TYPO, "spo2", 97.0, "unknown")
            client.portal.call(app.state.reconcile_readings)             # … once
            assert len(store.unmatched("h1", since=NOW - timedelta(days=7))) == 1

    def test_a_row_the_table_has_is_left_alone(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
        before = store.for_patient("h1", KEY, **ALL)
        assert _run(store, audit) == NOTHING and store.for_patient("h1", KEY, **ALL) == before

    def test_the_twin_of_a_re_sent_unmatched_reading_is_present_not_a_failure(self):
        """Two `reading_unmatched` rows for one reading (the bridge's retry after a 500): one table row. `add` answers
        None for the second — the table already holds the reading (D14's tuple) — and that is «present», counted
        under `skipped`, never an error."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _unmatched_row(audit, "spo2", 97)
        _unmatched_row(audit, "spo2", 97)
        assert _run(store, audit) == {**NOTHING, "unmatched": 1, "skipped": 1}
        assert len(store.unmatched("h1", since=NOW - timedelta(days=7))) == 1

    def test_the_twin_of_a_device_reading_is_present_and_never_retried_within_a_pass(self):
        """One reading written to the trail twice (a `seen` that failed open): the first is filed, the second is
        the table's already — `skipped`, with one attempt per pass and no raise, run after run."""
        class _Counting(InMemoryReadingStore):
            adds = 0

            def add(self, row):
                self.adds += 1
                return super().add(row)
        audit, store = InMemoryAuditLog(), _Counting()
        _ingest_row(audit, "spo2", 97)
        _ingest_row(audit, "spo2", 97)
        assert _run(store, audit) == {**NOTHING, "recorded": 1, "skipped": 1} and store.adds == 2
        assert _run(store, audit) == {**NOTHING, "skipped": 1} and store.adds == 3        # the twin only
        assert len(store.for_patient("h1", KEY, **ALL)) == 1

    def test_a_row_that_cannot_be_read_is_skipped_and_counted(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": "yok", "unit": "%", "obs_ts": WHEN.isoformat()}))
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": "dün"}))
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": "2026-11-11T09:00:00"}))
        _ingest_row(audit, "heart_rate", 80)
        assert _run(store, audit) == {**NOTHING, "recorded": 1, "skipped": 3}

    def test_a_failed_table_write_at_the_door_is_made_good(self):
        audit, store = InMemoryAuditLog(), _Flaky()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            store.fail = {"add"}
            assert client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE).status_code == 200
            assert store.for_patient("h1", KEY, **ALL) == []
            store.fail = set()
            client.portal.call(app.state.reconcile_readings)
            [row] = store.for_patient("h1", KEY, **ALL)
            assert (row.code, row.value, row.origin) == ("spo2", 97.0, "device")
            again = client.post("/ingest", json=obs("spo2", 97, KEY, WHEN), headers=DEVICE)
            assert again.json() == {"patient_id": KEY, "duplicate": True}        # … and a re-send is known again


class TestAMissingMark:
    def test_a_withdrawal_marks_its_row(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        device = _ingest_row(audit, "sbp", 88)
        gone = audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {
            "entry": device.id, "code": "sbp", "value": 88.0, "obs_ts": WHEN.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        assert _run(store, audit) == {**NOTHING, "recorded": 1, "voided": 1}
        [row] = store.for_patient("h1", KEY, **ALL)
        assert (row.voided_by, row.void_reason, row.voided_at) == ("hem.ayse", WHY, datetime.fromisoformat(gone.ts))

    def test_a_mark_the_route_could_not_write_is_made_good(self):
        class _NoVoidOnce(InMemoryReadingStore):
            broken = True

            def void(self, *args, **kw):
                if self.broken:
                    raise RuntimeError("readings down")
                return super().void(*args, **kw)
        audit, store = InMemoryAuditLog(), _NoVoidOnce()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit, readings=store)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("sbp", 88, KEY, WHEN), headers=DEVICE).status_code == 200
            entry = audit.records(tenant="h1", event_type="ingest", limit=1)[0].id
            assert client.post(f"/clinical/{KEY}/entries/{entry}/retract", json={"reason": WHY}, headers=NURSE).status_code == 200
            assert store.for_patient("h1", KEY, **ALL)[0].voided_at is None
            store.broken = False
            client.portal.call(app.state.reconcile_readings)
            assert store.for_patient("h1", KEY, **ALL)[0].void_reason == WHY

    def test_a_device_withdrawal_marks_the_row_of_the_twin_it_does_not_name(self):
        """One reading written to the trail twice (twins A and B): the table holds ONE row, filed under B. The nurse
        withdrew A — the route marks every copy (D13), and so does `reconcile`: by the reading's key, never only by
        the entry the withdrawal names."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        a = _ingest_row(audit, "sbp", 88)
        b = _ingest_row(audit, "sbp", 88)
        store.add(device_reading("h1", _obs_of(b), received_at=NOW, audit_id=b.id))        # the table's one row: B's
        gone = _withdrawal(audit, a.id, "sbp", 88)
        counts = _run(store, audit)
        assert counts == {**NOTHING, "voided": 1, "skipped": 1}        # A's own add is the table's already
        [row] = store.for_patient("h1", KEY, **ALL)
        assert (row.entry_id, row.voided_by, row.void_reason, row.voided_at) == (
            b.id, "hem.ayse", WHY, datetime.fromisoformat(gone.ts))
        assert _run(store, audit) == {**NOTHING, "skipped": 1}          # marked once

    def test_a_device_withdrawal_marks_the_direct_row_and_the_linked_one_of_one_reading(self):
        """The race the record's read already guards (`patient_readings`): a direct row (filed under its own `ingest`
        row) and a LINKED row (the unmatched row finalized under the link's `ingest` row) of one reading, two entry
        ids. A withdrawal naming either marks both rows."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        direct = _ingest_row(audit, "sbp", 88)
        store.add(device_reading("h1", _obs_of(direct), received_at=NOW, audit_id=direct.id))
        listed = _unmatched_row(audit, "sbp", 88)
        _run(store, audit)
        [waiting] = store.unmatched("h1", since=NOW - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=NOW - timedelta(minutes=1))
        linked = _ingest_row(audit, "sbp", 88, reading=waiting.id, actor="hem.ayse")
        store.finalize("h1", waiting.id, patient_key=KEY, admission_id=None, entry_id=linked.id)
        _withdrawal(audit, direct.id, "sbp", 88)
        counts = _run(store, audit)
        assert counts == {**NOTHING, "voided": 2}
        rows = store.for_patient("h1", KEY, **ALL)
        assert sorted(r.entry_id for r in rows) == sorted([direct.id, linked.id])
        assert all(r.voided_at is not None and r.void_reason == WHY for r in rows)
        assert listed.id == waiting.audit_id

    def test_a_hand_withdrawal_marks_only_the_entry_it_names(self):
        """Two equal hand entries are two entries: the withdrawal of one leaves the other standing."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        first = _chart_row(audit, "resp_rate", 16)
        second = _chart_row(audit, "resp_rate", 16)
        audit.append(AuditEvent("h1", RETRACT, KEY, "resp_rate", {
            "entry": first.id, "code": "resp_rate", "value": 16.0, "obs_ts": WHEN.isoformat(), "reason": WHY,
            "retracted_by": "hem.ayse"}))
        assert _run(store, audit) == {**NOTHING, "recorded": 2, "voided": 1}
        marks = {r.entry_id: r.voided_at is not None for r in store.for_patient("h1", KEY, **ALL)}
        assert marks == {first.id: True, second.id: False}

    def test_a_withdrawal_whose_reading_cannot_be_keyed_still_marks_its_entry(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        device = _ingest_row(audit, "sbp", 88)
        audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {
            "entry": device.id, "code": "sbp", "value": 88.0, "obs_ts": "dün", "reason": WHY,
            "retracted_by": "hem.ayse", "origin": "device", "device": "CONNEX-3A"}))
        assert _run(store, audit) == {**NOTHING, "recorded": 1, "voided": 1}

    def test_a_withdrawal_of_a_row_the_table_never_had_marks_nothing(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _withdrawal(audit, 9999, "sbp", 88)
        assert _run(store, audit) == NOTHING


class TestAClaimLeftBehind:
    def _claimed(self, store, audit, at=NOW - timedelta(hours=1)):
        row = _unmatched_row(audit, "spo2", 97)
        _run(store, audit)
        [waiting] = store.unmatched("h1", since=NOW - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=at)
        return waiting

    def test_a_link_whose_ingest_row_was_written_is_finished(self):
        """The engine took the value (its `ingest` row names the reading) and the table's link failed."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
        waiting = self._claimed(store, audit)
        linked = _ingest_row(audit, "spo2", 97, reading=waiting.id, actor="hem.ayse")
        assert _run(store, audit) == {**NOTHING, "finalized": 1}
        [row] = store.get("h1", [waiting.id])
        assert (row.state, row.patient_key, row.entry_id, row.admission_id) == (STATE_ASSIGNED, KEY, linked.id, ADMISSION)
        assert row.resolved_by == "hem.ayse"                              # the person the `ingest` row names
        assert len(store.for_patient("h1", KEY, **ALL)) == 1             # the linked row, and no second one for the `ingest` row

    def test_a_link_the_app_could_not_finalize_is_finished_from_its_ingest_row(self):
        """The whole chain: a real link whose finalize raised (the route logs it and answers 200), then a pass."""
        class _FinalizeDown(_Flaky):
            def finalize(self, *args, **kw):
                if "finalize" in self.fail:
                    raise RuntimeError("readings down")
                return super().finalize(*args, **kw)
        audit, store, identities = InMemoryAuditLog(), _FinalizeDown(admitted={("h1", KEY): ADMISSION}), InMemoryIdentityStore()
        identities.apply("h1", IdentityRecord(KEY, family="Hasta", given="Test", state="admitted", source=KABUL,
                                              unit_id="u-1", bed_id="b-1", updated_at=WHEN - timedelta(hours=2)))
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, audit=audit,
                         identities=identities, readings=store, unknown_readings=POLICY_UNMATCHED)
        with TestClient(app) as client:
            assert client.post("/ingest", json=obs("spo2", 97, TYPO, WHEN), headers=DEVICE).json()["dropped"] == "unmatched"
            [waiting] = store.unmatched("h1", since=NOW - timedelta(days=7))
            store.fail = {"finalize"}
            linked = client.post("/readings/unmatched/assign", json={"readings": [waiting.id], "patient_id": KEY},
                                 headers=NURSE)
            assert linked.status_code == 200, linked.text
            assert store.get("h1", [waiting.id])[0].patient_key is None and store.claims("h1") != []
            store.fail = set()
            client.portal.call(app.state.reconcile_readings)
            [row] = store.get("h1", [waiting.id])
            [entry] = audit.records(tenant="h1", event_type="ingest", limit=10)
            assert entry.payload["reading"] == waiting.id and entry.payload["actor"] == "hem.ayse"
            assert (row.state, row.patient_key, row.entry_id, row.resolved_by) == (STATE_ASSIGNED, KEY, entry.id, "hem.ayse")
            assert row.admission_id == ADMISSION and store.claims("h1") == []

    def test_a_link_whose_trail_is_older_than_the_window_is_still_finished(self):
        """A claim older than the window pulls the bound back to its own time: its `ingest` row was written after it,
        and a claim released for want of a row the pass did not read would be linked a second time."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit, at=NOW - timedelta(hours=1))
        _ingest_row(audit, "spo2", 97, reading=waiting.id, actor="hem.ayse")
        later = datetime.now(timezone.utc) + timedelta(minutes=1)         # a window that starts after every row
        assert _run(store, audit, since=later) == {**NOTHING, "finalized": 1}
        assert store.get("h1", [waiting.id])[0].patient_key == KEY

    def test_a_rejection_whose_audit_row_was_written_is_finished(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit)
        audit.append(AuditEvent("h1", READING_REJECTED, TYPO, "reading", {
            "readings": [waiting.id], "received_key": TYPO, "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(),
            "reason": "yanlış numara girilmiş", "actor": "hem.ayse"}))
        assert _run(store, audit) == {**NOTHING, "rejected": 1}              # the claim is an hour old: rejected, not released
        [row] = store.get("h1", [waiting.id])
        assert (row.state, row.resolve_reason, row.resolved_by) == (STATE_REJECTED, "yanlış numara girilmiş", "hem.ayse")
        assert store.claims("h1") == []

    def test_a_reading_closed_as_already_held_is_left_closed(self):
        """A reading the target already held was closed (`rejected`, RESOLVE_ALREADY_HELD) and named under
        `already_held` by the link's row: not re-opened, not linked, and the link's row names no claim."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit)
        store.reject("h1", [waiting.id], reason=RESOLVE_ALREADY_HELD)
        audit.append(AuditEvent("h1", READING_ASSIGNED, KEY, "reading", {
            "readings": [waiting.id], "received_key": TYPO, "reason": "unknown", "device": "CONNEX-3A",
            "obs_ts": WHEN.isoformat(), "actor": "hem.ayse", "already_held": [waiting.id]}))
        _ingest_row(audit, "spo2", 97)                                      # the target's own copy of it
        assert _run(store, audit) == {**NOTHING, "recorded": 1}
        [row] = store.get("h1", [waiting.id])
        assert (row.state, row.patient_key, row.entry_id, row.resolve_reason) == (STATE_REJECTED, None, None, RESOLVE_ALREADY_HELD)
        assert _run(store, audit) == NOTHING
        assert store.get("h1", [waiting.id]) == [row] and store.unmatched("h1", since=NOW - timedelta(days=7)) == []

    def test_an_orphaned_claim_goes_back_to_the_list(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit, at=NOW - CLAIM_STALE - timedelta(seconds=1))
        assert _run(store, audit) == {**NOTHING, "released": 1}
        assert store.get("h1", [waiting.id]) == [waiting]

    def test_a_claim_in_work_is_left_alone(self):
        """A link is being made right now: its claim is seconds old."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit, at=NOW - timedelta(seconds=30))
        assert _run(store, audit) == NOTHING
        assert store.get("h1", [waiting.id])[0].state == STATE_ASSIGNED and store.claims("h1") != []

    # B10 review: a row of the trail finishes a claim only if it is that claim's own — its person, written after the
    # claim was made. A reading released and claimed again has an earlier claim's rows in the trail.

    def _listed(self, store, audit):
        _unmatched_row(audit, "spo2", 97)
        _run(store, audit)
        [waiting] = store.unmatched("h1", since=NOW - timedelta(days=7))
        return waiting

    @staticmethod
    def _rejection(audit, waiting, actor="hem.ayse"):
        audit.append(AuditEvent("h1", READING_REJECTED, TYPO, "reading", {
            "readings": [waiting.id], "received_key": TYPO, "device": "CONNEX-3A", "obs_ts": WHEN.isoformat(),
            "reason": "yanlış numara girilmiş", "actor": actor}))

    @staticmethod
    def _link(audit, waiting, actor="hem.ayse"):
        return _ingest_row(audit, "spo2", 97, reading=waiting.id, actor=actor)

    def _still_a_claim(self, store, waiting):
        [row] = store.get("h1", [waiting.id])
        assert (row.state, row.patient_key, row.resolve_reason, row.entry_id) == (STATE_ASSIGNED, None, None, None)
        assert [r.id for r in store.claims("h1")] == [waiting.id]

    @pytest.mark.parametrize("trail", ["rejection", "link"])
    def test_the_rows_of_another_person_leave_a_fresh_claim_alone(self, trail):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._listed(store, audit)
        store.claim("h1", [waiting.id], by="hem.ayse", at=NOW - timedelta(seconds=30))
        (self._rejection if trail == "rejection" else self._link)(audit, waiting, actor="hem.zeynep")
        assert _run(store, audit) == NOTHING
        self._still_a_claim(store, waiting)

    @pytest.mark.parametrize("trail", ["rejection", "link"])
    def test_a_row_written_before_the_claim_belongs_to_an_earlier_claim(self, trail):
        """The same person, but the row is older than the claim: the earlier claim was released and this one made
        after, so the row says nothing of it."""
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._listed(store, audit)
        (self._rejection if trail == "rejection" else self._link)(audit, waiting)
        store.claim("h1", [waiting.id], by="hem.ayse", at=datetime.now(timezone.utc) + timedelta(minutes=1))
        assert _run(store, audit) == NOTHING
        self._still_a_claim(store, waiting)

    @pytest.mark.parametrize("trail", ["rejection", "link"])
    def test_an_old_claim_that_is_not_theirs_is_released_not_finished(self, trail):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._listed(store, audit)
        store.claim("h1", [waiting.id], by="hem.ayse", at=NOW - CLAIM_STALE - timedelta(minutes=1))
        (self._rejection if trail == "rejection" else self._link)(audit, waiting, actor="hem.zeynep")
        assert _run(store, audit) == {**NOTHING, "released": 1}
        assert store.get("h1", [waiting.id]) == [waiting]

    @pytest.mark.parametrize("trail", ["rejection", "link"])
    def test_a_row_with_no_person_finishes_nothing(self, trail):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._listed(store, audit)
        store.claim("h1", [waiting.id], by="hem.ayse", at=NOW - timedelta(seconds=30))
        if trail == "rejection":
            audit.append(AuditEvent("h1", READING_REJECTED, TYPO, "reading", {"readings": [waiting.id], "reason": "yanlış"}))
        else:
            _ingest_row(audit, "spo2", 97, reading=waiting.id)
        assert _run(store, audit) == NOTHING
        self._still_a_claim(store, waiting)

    def test_a_dry_run_counts_what_it_would_finish_and_changes_no_claim(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        waiting = self._claimed(store, audit)
        _ingest_row(audit, "spo2", 97, reading=waiting.id, actor="hem.ayse")
        assert _run(store, audit, dry_run=True) == {**NOTHING, "finalized": 1}
        assert store.get("h1", [waiting.id])[0].patient_key is None


class TestItIsSafeToRepeat:
    def test_a_second_run_does_nothing(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        device = _ingest_row(audit, "sbp", 88)
        _chart_row(audit, "resp_rate", 16)
        _unmatched_row(audit, "spo2", 97)
        audit.append(AuditEvent("h1", RETRACT, KEY, "sbp", {"entry": device.id, "code": "sbp", "value": 88.0,
                                                            "obs_ts": WHEN.isoformat(), "reason": WHY, "retracted_by": "hem.ayse"}))
        assert _run(store, audit) == {**NOTHING, "recorded": 2, "unmatched": 1, "voided": 1}
        snapshot = (store.for_patient("h1", KEY, **ALL), store.unmatched("h1", since=NOW - timedelta(days=7)))
        assert _run(store, audit) == NOTHING
        assert (store.for_patient("h1", KEY, **ALL), store.unmatched("h1", since=NOW - timedelta(days=7))) == snapshot

    def test_another_hospitals_trail_is_not_read(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        audit.append(AuditEvent("h2", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": WHEN.isoformat(), "device": "X"}))
        assert _run(store, audit) == NOTHING

    def test_more_rows_than_a_page_are_all_read(self, monkeypatch):
        from homunculus.api import readings
        monkeypatch.setattr(readings, "RECONCILE_PAGE", 3)
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        for minute in range(8):
            _ingest_row(audit, "spo2", 97, when=WHEN + timedelta(minutes=minute))
        assert _run(store, audit)["recorded"] == 8


class TestTheWindowAndTheStays:
    def test_only_rows_written_in_the_window_are_read(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _ingest_row(audit, "spo2", 97)
        # The bound is taken at the test's own instant (the row was written just now, whenever this module was loaded).
        assert _run(store, audit, since=datetime.now(timezone.utc) + timedelta(minutes=1)) == NOTHING
        assert _run(store, audit, since=datetime.now(timezone.utc) - RECONCILE_WINDOW)["recorded"] == 1
        assert RECONCILE_WINDOW == timedelta(hours=48)

    def test_with_stays_only_those_keys_from_the_start_of_each_stay(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", KEY): ADMISSION})
        began = WHEN - timedelta(hours=2)
        _ingest_row(audit, "spo2", 95, when=began - timedelta(days=3))       # an earlier stay under the same key
        _ingest_row(audit, "spo2", 97, when=WHEN)                            # this stay
        _ingest_row(audit, "spo2", 96, when=WHEN, key="202600000002")        # a key that is not open
        _unmatched_row(audit, "spo2", 94)                                    # nobody's: not a stay's
        counts = _run(store, audit, stays={KEY: began})
        assert counts == {**NOTHING, "recorded": 1}
        assert [(r.value, r.admission_id) for r in store.for_patient("h1", KEY, **ALL)] == [(97.0, ADMISSION)]

    def test_with_stays_a_linked_ingest_row_adds_no_second_row_and_no_claim_is_touched(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _unmatched_row(audit, "spo2", 97)
        _run(store, audit)
        [waiting] = store.unmatched("h1", since=NOW - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=NOW - timedelta(hours=1))
        _ingest_row(audit, "spo2", 97, reading=waiting.id, actor="hem.ayse")
        assert _run(store, audit, stays={KEY: WHEN - timedelta(hours=2)}) == NOTHING
        assert store.for_patient("h1", KEY, **ALL) == [] and len(store.claims("h1")) == 1

    def test_a_dry_run_counts_and_writes_nothing(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        _ingest_row(audit, "spo2", 97)
        _chart_row(audit, "resp_rate", 16)
        _unmatched_row(audit, "heart_rate", 88)
        assert _run(store, audit, dry_run=True) == {**NOTHING, "recorded": 2, "unmatched": 1}
        assert store.for_patient("h1", KEY, **ALL) == [] and store.unmatched("h1", since=NOW - timedelta(days=7)) == []


class TestTheReadStartsAtTheFloor:
    """B10 review: the hourly read must not walk the whole audit table. `records(since=)` casts every row's TEXT `ts`
    and no index serves it, so `reconcile` starts its read after the id floor the audit answers
    (`first_id_at_or_after`: a binary search by point reads)."""

    OLD = 20

    def _log(self, monkeypatch, audit):
        """20 rows written five days ago, then 3 an hour ago. Answers the instant 'now' of the log."""
        now = datetime.now(timezone.utc)
        _stamped(monkeypatch, *[now - timedelta(days=5) + timedelta(minutes=i) for i in range(self.OLD)],
                 *[now - timedelta(hours=1) + timedelta(minutes=i) for i in range(3)])
        for i in range(self.OLD):
            _ingest_row(audit, "spo2", 90.0, when=WHEN - timedelta(days=5) + timedelta(minutes=i))
        for i in range(3):
            _ingest_row(audit, "heart_rate", 80.0 + i, when=WHEN + timedelta(minutes=i))
        return now

    def test_the_first_page_starts_after_the_floor(self, monkeypatch):
        audit, store = _Reads(), InMemoryReadingStore()
        now = self._log(monkeypatch, audit)
        counts = reconcile(store, audit, tenant="h1", now=now, since=now - RECONCILE_WINDOW)
        assert counts == {**NOTHING, "recorded": 3}
        assert audit.afters == [self.OLD]                  # ids 1..20 are older than the window: never read

    def test_an_audit_without_a_floor_is_read_from_the_start_as_before(self, monkeypatch):
        audit, store = _NoFloor(), InMemoryReadingStore()
        now = self._log(monkeypatch, audit)
        counts = reconcile(store, audit, tenant="h1", now=now, since=now - RECONCILE_WINDOW)
        assert counts == {**NOTHING, "recorded": 3} and audit.afters == [None]

    def test_a_run_with_no_bound_has_no_floor(self, monkeypatch):
        audit, store = _Reads(), InMemoryReadingStore()
        now = self._log(monkeypatch, audit)
        assert reconcile(store, audit, tenant="h1", now=now)["recorded"] == self.OLD + 3
        assert audit.afters[0] is None

    def test_the_pulled_back_bound_has_its_own_floor(self, monkeypatch):
        """A claim three days old pulls the bound back to its time; the floor is that bound's, so the `ingest` row
        that finishes the claim is read, and the five-day-old rows still are not."""
        audit, store = _Reads(), InMemoryReadingStore()
        now = datetime.now(timezone.utc)
        three_days = now - timedelta(days=3)
        _stamped(monkeypatch, *[now - timedelta(days=5) + timedelta(minutes=i) for i in range(self.OLD)],
                 three_days - timedelta(minutes=1), three_days + timedelta(minutes=1))
        for i in range(self.OLD):
            _ingest_row(audit, "heart_rate", 80.0, when=WHEN - timedelta(days=5) + timedelta(minutes=i))
        _unmatched_row(audit, "spo2", 97)
        reconcile(store, audit, tenant="h1", now=now)
        [waiting] = store.unmatched("h1", since=now - timedelta(days=7))
        store.claim("h1", [waiting.id], by="hem.ayse", at=three_days)
        _ingest_row(audit, "spo2", 97, reading=waiting.id, actor="hem.ayse")
        audit.afters.clear()
        counts = reconcile(store, audit, tenant="h1", now=now, since=now - RECONCILE_WINDOW)
        assert counts == {**NOTHING, "finalized": 1} and audit.afters == [self.OLD]


class TestTheStayStampsItsOwnReadings:
    """B10 review: `admission_of` answers today's open stay, but a reading measured before that stay began belongs to
    an earlier stay under the same key (a readmission, a transfer) or to no stay — the first pass after the deploy
    files 48 hours of history. It is stamped with none."""

    def test_only_a_reading_measured_since_the_stay_began_is_stamped(self):
        began = WHEN - timedelta(hours=1)
        audit = InMemoryAuditLog()
        store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION}, admitted_at={("h1", KEY): began})
        _ingest_row(audit, "spo2", 95, when=began - timedelta(hours=3))             # an earlier stay under this key
        _ingest_row(audit, "heart_rate", 80, when=began)                            # the very instant it began: in
        _ingest_row(audit, "temperature", 37.2, when=began + timedelta(minutes=10))
        _chart_row(audit, "resp_rate", 16, when=began - timedelta(minutes=1))       # a hand value just before it
        _chart_row(audit, "sbp", 120, when=began + timedelta(minutes=20))
        assert _run(store, audit) == {**NOTHING, "recorded": 5}
        stamps = {r.code: r.admission_id for r in store.for_patient("h1", KEY, **ALL)}
        assert stamps == {"spo2": None, "heart_rate": ADMISSION, "temperature": ADMISSION,
                          "resp_rate": None, "sbp": ADMISSION}

    def test_the_open_stays_are_read_once_a_pass_and_only_when_a_row_is_filed(self):
        class _Counting(InMemoryReadingStore):
            reads = 0

            def open_stays(self, tenant):
                self.reads += 1
                return super().open_stays(tenant)
        audit, store = InMemoryAuditLog(), _Counting(admitted={("h1", KEY): ADMISSION})
        assert _run(store, audit) == NOTHING and store.reads == 0
        for minute in range(4):
            _ingest_row(audit, "spo2", 97, when=WHEN + timedelta(minutes=minute))
        _run(store, audit)
        assert store.reads == 1
        _run(store, audit)
        assert store.reads == 1                                                     # nothing to file: not asked

    def test_a_number_with_no_open_stay_is_stamped_with_none_whatever_the_time(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore(admitted={("h1", "H-99"): ADMISSION})
        _ingest_row(audit, "spo2", 97)
        _run(store, audit)
        assert [r.admission_id for r in store.for_patient("h1", KEY, **ALL)] == [None]


class TestTheAppRunsIt:
    def test_a_failing_pass_is_a_warning_once_per_streak(self, caplog):
        """The pass is the only repair of a row the door could not write: a pass that stops must be seen, and the
        same line must not come every hour while the database is down. Class only, no number, no value."""
        class _Down(InMemoryReadingStore):
            broken = True

            def claims(self, tenant):
                if self.broken:
                    raise RuntimeError("readings down for 202600000001")
                return super().claims(tenant)
        store = _Down()
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=store)
        caplog.set_level(logging.INFO, logger="homunculus.api.app")

        def mine():
            return [r for r in caplog.records if "reconcile" in r.getMessage()]
        with TestClient(app) as client:
            for _ in range(3):
                client.portal.call(app.state.reconcile_readings)
            warned = [r for r in mine() if r.levelno == logging.WARNING]
            assert len(warned) == 1 and "RuntimeError" in warned[0].getMessage()
            assert "202600000001" not in warned[0].getMessage() and warned[0].exc_info is None
            store.broken = False
            client.portal.call(app.state.reconcile_readings)
            assert [r.levelno for r in mine()][-1] == logging.INFO                  # the streak ended, said once
            client.portal.call(app.state.reconcile_readings)
            assert len(mine()) == 2
            store.broken = True
            client.portal.call(app.state.reconcile_readings)
            assert len([r for r in mine() if r.levelno == logging.WARNING]) == 2     # a new streak is a new line

    def test_one_pass_is_on_app_state_and_never_raises(self):
        class _Broken(InMemoryReadingStore):
            def claims(self, tenant):
                raise RuntimeError("readings down")
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=_Broken())
        with TestClient(app) as client:
            client.portal.call(app.state.reconcile_readings)             # logged, swallowed: the next hour tries again

    def test_one_hospital_failing_does_not_stop_the_others(self):
        class _OneDown(InMemoryReadingStore):
            def claims(self, tenant):
                if tenant == "h1":
                    raise RuntimeError("readings down")
                return super().claims(tenant)
        audit, store = InMemoryAuditLog(), _OneDown()
        for hospital in ("h1", "h2"):
            audit.append(AuditEvent(hospital, "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": WHEN.isoformat(), "device": "X"}))
        app = create_app({TOKEN: "h1", "tok2": "h2"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            client.portal.call(app.state.reconcile_readings)
        assert store.for_patient("h1", KEY, **ALL) == [] and len(store.for_patient("h2", KEY, **ALL)) == 1

    def test_the_hourly_pass_is_started_for_a_durable_store_only(self):
        class _Durable(InMemoryReadingStore):
            durable = True
        for store, started in ((InMemoryReadingStore(), False), (_Durable(), True)):
            app = create_app({TOKEN: "h1"}, run_escalation_loop=False, readings=store)
            with TestClient(app):
                assert (app.state.reconcile_task is not None) is started

    def test_a_durable_store_is_reconciled_at_start_and_off_the_event_loop(self):
        """The start-up pass of a durable store runs in a worker thread (the real store's calls are blocking), and
        files what the trail holds without any request having been made."""
        import threading

        class _Durable(InMemoryReadingStore):
            durable = True
            threads: set = set()

            def claims(self, tenant):
                self.threads.add(threading.current_thread())
                return super().claims(tenant)
        audit, store = InMemoryAuditLog(), _Durable()
        audit.append(AuditEvent("h1", "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": WHEN.isoformat(), "device": "X"}))
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit, readings=store)

        async def loop_thread():
            return threading.current_thread()
        with TestClient(app) as client:
            client.portal.call(app.state.reconcile_readings)             # one pass now, so the start-up one is done too
            assert len(store.for_patient("h1", KEY, **ALL)) == 1
            on_the_loop = client.portal.call(loop_thread)
        assert store.threads and on_the_loop not in store.threads

    def test_a_pass_covers_every_hospital_of_the_deployment(self):
        audit, store = InMemoryAuditLog(), InMemoryReadingStore()
        for hospital in ("h1", "h2"):
            audit.append(AuditEvent(hospital, "ingest", KEY, "spo2", {"value": 97.0, "unit": "%", "obs_ts": WHEN.isoformat(), "device": "X"}))
        app = create_app({TOKEN: "h1", "tok2": "h2"}, run_escalation_loop=False, audit=audit, readings=store)
        with TestClient(app) as client:
            client.portal.call(app.state.reconcile_readings)
        assert len(store.for_patient("h1", KEY, **ALL)) == 1 and len(store.for_patient("h2", KEY, **ALL)) == 1


# ----------------------------------------------------------------------------- the backfill script

def _script():
    spec = importlib.util.spec_from_file_location("backfill_vital_readings", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheBackfillScript:
    def _world(self):
        began = WHEN - timedelta(hours=5)
        audit = InMemoryAuditLog()
        store = InMemoryReadingStore(admitted={("h1", KEY): ADMISSION}, admitted_at={("h1", KEY): began})
        _ingest_row(audit, "spo2", 95, when=began - timedelta(days=4))       # before this stay
        _ingest_row(audit, "spo2", 97, when=WHEN - timedelta(hours=3))       # older than nothing: there is no 48 h bound
        _chart_row(audit, "resp_rate", 16, when=WHEN)
        _ingest_row(audit, "spo2", 96, when=WHEN, key="202600000002")        # not an open stay
        return audit, store

    def _line(self, capsys):
        out = capsys.readouterr().out.strip().splitlines()
        assert len(out) == 1 and out[0].startswith("VITAL_READINGS_BACKFILL ")
        return json.loads(out[0].split(" ", 1)[1])

    def test_a_dry_run_says_what_it_would_file_and_writes_nothing(self, capsys):
        audit, store = self._world()
        assert _script().run(["--tenant", "h1", "--open-only", "--dry-run"], audit=audit, store=store) == 0
        assert self._line(capsys) == {"tenant": "h1", "open_only": True, "dry_run": True, "stays": 1, **NOTHING, "recorded": 2}
        assert store.for_patient("h1", KEY, **ALL) == []

    def test_a_run_files_the_open_stays_rows_and_a_second_run_nothing(self, capsys):
        audit, store = self._world()
        script = _script()
        assert script.run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        assert self._line(capsys)["recorded"] == 2
        assert sorted((r.code, r.admission_id) for r in store.for_patient("h1", KEY, **ALL)) == [
            ("resp_rate", ADMISSION), ("spo2", ADMISSION)]
        assert store.for_patient("h1", "202600000002", **ALL) == []
        assert script.run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        assert self._line(capsys) == {"tenant": "h1", "open_only": True, "dry_run": False, "stays": 1, **NOTHING}

    def test_it_prints_counts_only_no_number_and_no_value(self, capsys):
        audit, store = self._world()
        assert _script().run(["--tenant", "h1", "--open-only"], audit=audit, store=store) == 0
        captured = capsys.readouterr()
        assert KEY not in captured.out + captured.err and "97" not in captured.out and "CONNEX" not in captured.out

    def test_it_refuses_without_a_tenant_or_without_open_only(self, capsys):
        audit, store = self._world()
        script = _script()
        assert script.run(["--open-only"], audit=audit, store=store) == 2
        assert script.run(["--tenant", "h1"], audit=audit, store=store) == 2
        captured = capsys.readouterr()
        assert captured.out == "" and captured.err.count("VITAL_READINGS_BACKFILL_RED 2") == 2
        assert store.for_patient("h1", KEY, **ALL) == []

    def test_it_refuses_without_a_database_when_nothing_is_handed_in(self, capsys, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        assert _script().run(["--tenant", "h1", "--open-only"]) == 2
        assert "DATABASE_URL" in capsys.readouterr().err

    def test_a_failure_is_exit_1_with_the_class_and_no_traceback(self, capsys):
        class _Down(InMemoryReadingStore):
            def open_stays(self, tenant):
                raise RuntimeError("secret connection string")
        assert _script().run(["--tenant", "h1", "--open-only"], audit=InMemoryAuditLog(), store=_Down()) == 1
        err = capsys.readouterr().err
        assert "VITAL_READINGS_BACKFILL_RED 1 RuntimeError" in err and "secret" not in err and "Traceback" not in err
