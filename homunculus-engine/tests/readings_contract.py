# homunculus-engine/tests/readings_contract.py
"""G3-05: what every ReadingStore does, whatever holds the rows (spec §3, §7 «store»). A test class per backend
inherits this and provides the `store` fixture: tests/test_readings_store.py (memory) and
tests/test_readings_postgres.py (the table of migration 0021). Synthetic numbers and values only
(CLAUDE.md rule 6): 202600000001 is no patient's protocol."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.readings import (
    ORIGIN_DEVICE, ORIGIN_MANUAL, REASON_DISCHARGED, REASON_UNKNOWN, STATE_ASSIGNED, STATE_RECORDED,
    STATE_REJECTED, STATE_UNMATCHED, Reading, ReadingNotUnmatched,
)

T0 = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)
KEY = "202600000001"
TYPO = "202600000010"


def device(code="spo2", value=97.0, *, key=KEY, at=T0, audit_id=None, source="CONNEX-3A", tenant="h1",
           state=STATE_RECORDED, reason=None) -> Reading:
    """A device reading as `/ingest` files it: matched (`recorded`, under its own key) or unmatched."""
    matched = state == STATE_RECORDED
    return Reading(tenant=tenant, received_key=key, code=code, value=value, unit="%", observed_at=at,
                   received_at=at + timedelta(seconds=20), origin=ORIGIN_DEVICE, source=source, state=state,
                   patient_key=key if matched else None, unmatched_reason=reason, audit_id=audit_id,
                   entry_id=audit_id if matched else None)


def manual(code="resp_rate", value=16.0, *, key=KEY, at=T0, audit_id=None, by="hem.ayse") -> Reading:
    """A hand entry as `POST /clinical/{id}` files it."""
    return Reading(tenant="h1", received_key=key, code=code, value=value, unit="/min", observed_at=at,
                   received_at=at, origin=ORIGIN_MANUAL, source="clinician", state=STATE_RECORDED,
                   patient_key=key, recorded_by=by, audit_id=audit_id, entry_id=audit_id)


def unmatched(code="spo2", value=97.0, *, key=TYPO, at=T0, audit_id=None, reason=REASON_UNKNOWN,
              source="CONNEX-3A") -> Reading:
    return device(code, value, key=key, at=at, audit_id=audit_id, source=source, state=STATE_UNMATCHED,
                  reason=reason)


def rejected(store, code="heart_rate", value=88.0, *, audit_id) -> Reading:
    """A reading a person rejected: filed as unmatched, claimed, then closed with its reason (tenant h1)."""
    row = store.add(unmatched(code, value, audit_id=audit_id))
    store.claim("h1", [row.id], by="hem.ayse", at=T0)
    store.reject("h1", [row.id], reason="hasta taburcu, ölçüm başkasının")
    return store.get("h1", [row.id])[0]


def linked(store, code="temperature", value=37.1, *, audit_id, entry_id=40) -> Reading:
    """A reading a person linked: filed as unmatched, claimed, then finalized under KEY (tenant h1)."""
    row = store.add(unmatched(code, value, audit_id=audit_id))
    store.claim("h1", [row.id], by="hem.ayse", at=T0)
    store.finalize("h1", row.id, patient_key=KEY, admission_id=None, entry_id=entry_id)
    return store.get("h1", [row.id])[0]


class ReadingStoreContract:
    """Inherit, and provide `store`: an empty ReadingStore."""

    # ------------------------------------------------------------------ add, seen, have
    def test_add_gives_the_row_an_id_and_keeps_every_field(self, store):
        saved = store.add(device(audit_id=11))
        assert saved is not None and saved.id > 0
        assert saved == replace(device(audit_id=11), id=saved.id)
        assert store.get("h1", [saved.id]) == [saved]

    def test_a_second_row_for_one_audit_row_is_not_added(self, store):
        """UNIQUE (tenant, audit_id): `reconcile` adds what is missing and nothing twice (spec D7)."""
        first = store.add(manual(audit_id=7))
        assert store.add(manual(value=18.0, audit_id=7)) is None
        assert store.for_patient("h1", KEY, since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1)) == [first]

    def test_the_same_device_reading_is_not_added_twice(self, store):
        """D14's index: one number, one code, one time, one device, one value — whatever its audit row."""
        assert store.add(device(audit_id=1)) is not None
        assert store.add(device(audit_id=2)) is None
        assert store.add(device(value=96.0, audit_id=3)) is not None        # another value is another reading
        assert store.add(device(source="CONNEX-3B", audit_id=4)) is not None  # another device too

    def test_two_equal_hand_entries_are_both_kept(self, store):
        """The index is the device's alone: a nurse may type the same value at the same minute twice."""
        assert store.add(manual(audit_id=1)) is not None
        assert store.add(manual(audit_id=2)) is not None

    def test_seen_knows_a_device_reading_in_any_state(self, store):
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False
        store.add(device(audit_id=1))
        store.add(unmatched("heart_rate", 88.0, audit_id=2))
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True
        assert store.seen("h1", TYPO, "heart_rate", T0, "CONNEX-3A", 88.0) is True
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 96.0) is False
        assert store.seen("h1", KEY, "spo2", T0 + timedelta(seconds=1), "CONNEX-3A", 97.0) is False
        assert store.seen("h2", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False     # another hospital's is not ours

    def test_seen_also_knows_a_reading_filed_under_a_patient_whatever_number_it_arrived_under(self, store):
        """B6 review: a linked reading keeps the number it arrived under (TYPO) as its `received_key`, and counts
        under the patient it was linked to (KEY): a re-send under KEY is the same measurement."""
        linked(store, "heart_rate", 131.0, audit_id=1)
        assert store.seen("h1", KEY, "heart_rate", T0, "CONNEX-3A", 131.0) is True          # filed under KEY
        assert store.seen("h1", TYPO, "heart_rate", T0, "CONNEX-3A", 131.0) is True         # arrived under TYPO
        assert store.seen("h1", "202600000002", "heart_rate", T0, "CONNEX-3A", 131.0) is False
        assert store.seen("h1", KEY, "heart_rate", T0, "CONNEX-3A", 130.0) is False
        assert store.seen("h1", KEY, "heart_rate", T0, "CONNEX-3B", 131.0) is False
        assert store.seen("h2", KEY, "heart_rate", T0, "CONNEX-3A", 131.0) is False         # another hospital's

    def test_filed_under_asks_only_for_the_patient_the_reading_is_filed_under(self, store):
        """B6 re-review: the link's question. A recorded row counts under its own key; a linked row counts under the
        patient it was linked to and NOT under the number it arrived under."""
        store.add(device("spo2", 97.0, audit_id=1))                                  # recorded under KEY
        linked(store, "heart_rate", 131.0, audit_id=2)                               # arrived TYPO, filed KEY
        assert store.filed_under("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True
        assert store.filed_under("h1", KEY, "heart_rate", T0, "CONNEX-3A", 131.0) is True
        assert store.filed_under("h1", TYPO, "heart_rate", T0, "CONNEX-3A", 131.0) is False   # `seen` says True
        assert store.filed_under("h1", "202600000002", "spo2", T0, "CONNEX-3A", 97.0) is False
        assert store.filed_under("h1", KEY, "spo2", T0, "CONNEX-3A", 96.0) is False
        assert store.filed_under("h1", KEY, "spo2", T0 + timedelta(seconds=1), "CONNEX-3A", 97.0) is False
        assert store.filed_under("h1", KEY, "spo2", T0, "CONNEX-3B", 97.0) is False
        assert store.filed_under("h1", KEY, "resp_rate", T0, "CONNEX-3A", 97.0) is False
        assert store.filed_under("h2", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False             # another hospital's

    def test_filed_under_never_takes_a_waiting_claimed_or_rejected_row_for_its_own_number(self, store):
        """The reading being linked to the number it arrived under would match itself: waiting, claimed and
        rejected rows carry no `patient_key`, so none of them is «filed»."""
        store.add(unmatched("spo2", 97.0, key=KEY, audit_id=1, reason=REASON_DISCHARGED))     # waiting, under KEY
        claim = store.add(unmatched("heart_rate", 88.0, key=KEY, audit_id=2))
        store.claim("h1", [claim.id], by="hem.ayse", at=T0)                                   # claimed, under KEY
        rejected(store, "resp_rate", 16.0, audit_id=3)                                        # closed, under TYPO
        assert store.filed_under("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False
        assert store.filed_under("h1", KEY, "heart_rate", T0, "CONNEX-3A", 88.0) is False
        assert store.filed_under("h1", TYPO, "resp_rate", T0, "CONNEX-3A", 16.0) is False
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True                   # the broader question

    def test_filed_under_never_takes_a_hand_entry_for_a_device_reading(self, store):
        store.add(replace(manual("spo2", 97.0, audit_id=1), source="CONNEX-3A"))
        assert store.filed_under("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False

    def test_seen_does_not_take_a_claim_or_a_rejection_for_a_reading_filed_under_a_patient(self, store):
        claimed = store.add(unmatched("spo2", 97.0, audit_id=1))
        store.claim("h1", [claimed.id], by="hem.ayse", at=T0)
        rejected(store, "heart_rate", 88.0, audit_id=2)
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False                # not filed yet
        assert store.seen("h1", KEY, "heart_rate", T0, "CONNEX-3A", 88.0) is False          # never filed

    def test_seen_never_takes_a_hand_entry_for_a_device_reading(self, store):
        store.add(replace(manual("spo2", 97.0, audit_id=1), source="CONNEX-3A"))
        assert store.seen("h1", KEY, "spo2", T0, "CONNEX-3A", 97.0) is False

    def test_have_names_the_audit_rows_already_filed(self, store):
        store.add(device(audit_id=5))
        store.add(manual(audit_id=6))
        assert store.have("h1", [5, 6, 7]) == {5, 6}
        assert store.have("h2", [5, 6, 7]) == set()
        assert store.have("h1", []) == set()

    # ------------------------------------------------------------------ the two lists
    def test_a_patients_rows_come_oldest_first_within_the_window(self, store):
        early = store.add(device(at=T0 - timedelta(hours=2), audit_id=1))
        late = store.add(manual(at=T0 - timedelta(minutes=5), audit_id=2))
        store.add(device(at=T0 - timedelta(hours=30), audit_id=3))                 # before the window
        store.add(device(key="202600000002", audit_id=4))                           # another patient
        store.add(unmatched(audit_id=5))                                            # filed under nobody
        rows = store.for_patient("h1", KEY, since=T0 - timedelta(hours=24), until=T0)
        assert rows == [early, late]
        assert store.for_patient("h2", KEY, since=T0 - timedelta(hours=24), until=T0) == []

    def test_rows_measured_at_one_instant_come_back_in_id_order(self, store):
        """ORDER BY observed_at, id: one device set (one instant) keeps the order its rows were filed in — even
        after the first row has been rewritten. In Postgres an update moves a row's tuple to the end of the heap
        and, when it changes an indexed column, its index entry too (ties in a btree are in heap order), so a store
        that sorted by `observed_at` alone would now return that row last. A link does that: it files the claimed
        row under the patient (`patient_key`, `entry_id`). A withdrawal would not: its columns are unindexed, the
        update is HOT, and the index still lists the row first."""
        a = store.add(unmatched("spo2", 97.0, audit_id=1))                          # waiting; a person links it below
        b = store.add(device("heart_rate", 88.0, audit_id=2))
        c = store.add(device("temperature", 37.1, audit_id=3))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.finalize("h1", a.id, patient_key=KEY, admission_id=None, entry_id=40)
        rows = store.for_patient("h1", KEY, since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1))
        assert [r.id for r in rows] == [a.id, b.id, c.id]
        assert [r.code for r in rows] == ["spo2", "heart_rate", "temperature"]

    def test_a_patients_window_includes_both_of_its_ends(self, store):
        """`observed_at >= since AND observed_at <= until` (plan B2's SQL): a row on either bound is in."""
        since, until = T0 - timedelta(hours=24), T0
        first = store.add(device("spo2", 97.0, at=since, audit_id=1))
        last = store.add(device("heart_rate", 88.0, at=until, audit_id=2))
        store.add(device("temperature", 37.1, at=since - timedelta(seconds=1), audit_id=3))
        store.add(device("resp_rate", 16.0, at=until + timedelta(seconds=1), audit_id=4))
        assert store.for_patient("h1", KEY, since=since, until=until) == [first, last]

    def test_a_patients_rows_can_be_limited_to_the_newest(self, store):
        """B8 review: a `limit` keeps the NEWEST rows by `observed_at` (cut in the database), still oldest first —
        and rows of one instant keep their id order, the cut falling among them by id."""
        rows = [store.add(device("spo2", 90.0 + i, at=T0 - timedelta(minutes=10 - i), audit_id=i + 1))
                for i in range(5)]
        window = dict(since=T0 - timedelta(hours=1), until=T0)
        assert store.for_patient("h1", KEY, **window) == rows
        assert store.for_patient("h1", KEY, **window, limit=3) == rows[2:]
        assert store.for_patient("h1", KEY, **window, limit=5) == rows
        assert store.for_patient("h1", KEY, **window, limit=50) == rows
        assert store.for_patient("h1", KEY, **window, limit=0) == []
        round_ = [store.add(device(code, 80.0, at=T0, audit_id=10 + i))
                  for i, code in enumerate(("heart_rate", "resp_rate", "temperature"))]
        assert store.for_patient("h1", KEY, **window, limit=2) == round_[1:]

    def test_the_unmatched_list_is_the_waiting_rows_by_arrival(self, store):
        b = store.add(unmatched("heart_rate", 88.0, at=T0, audit_id=2))
        a = store.add(unmatched("spo2", 97.0, at=T0 - timedelta(minutes=1), audit_id=1))
        store.add(unmatched(at=T0 - timedelta(days=8), audit_id=3))                 # older than the list's window
        store.add(device(audit_id=4))                                               # matched: not listed
        assert store.unmatched("h1", since=T0 - timedelta(days=7)) == [a, b]
        assert store.unmatched("h2", since=T0 - timedelta(days=7)) == []

    def test_the_unmatched_list_can_be_limited_to_the_newest_rows(self, store):
        """B6 review: a `limit` keeps the NEWEST rows (cut in the database), still oldest first."""
        rows = [store.add(unmatched("spo2", 90.0 + i, at=T0 + timedelta(seconds=i), audit_id=i + 1)) for i in range(5)]
        since = T0 - timedelta(days=7)
        assert store.unmatched("h1", since=since) == rows
        assert store.unmatched("h1", since=since, limit=3) == rows[2:]
        assert store.unmatched("h1", since=since, limit=5) == rows
        assert store.unmatched("h1", since=since, limit=50) == rows
        assert store.unmatched("h1", since=since, limit=0) == []

    def test_the_unmatched_window_includes_the_instant_it_starts_at(self, store):
        """`received_at >= since` (plan B2's SQL): a row received exactly at `since` is still listed."""
        on = store.add(unmatched("spo2", 97.0, at=T0, audit_id=1))
        before = store.add(unmatched("heart_rate", 88.0, at=T0 - timedelta(seconds=1), audit_id=2))
        assert store.unmatched("h1", since=on.received_at) == [on]
        assert store.unmatched("h1", since=before.received_at) == [before, on]

    def test_a_discharged_reason_travels_with_the_row(self, store):
        row = store.add(unmatched(key=KEY, reason=REASON_DISCHARGED, audit_id=1))
        assert store.unmatched("h1", since=T0 - timedelta(days=7)) == [row]
        assert row.unmatched_reason == REASON_DISCHARGED and row.patient_key is None

    # ------------------------------------------------------------------ claim, release, finalize, reject
    def test_a_claim_takes_every_row_or_none(self, store):
        a = store.add(unmatched("spo2", 97.0, audit_id=1))
        b = store.add(unmatched("heart_rate", 88.0, audit_id=2))
        claimed = store.claim("h1", [a.id, b.id], by="hem.ayse", at=T0)
        assert [r.id for r in claimed] == [a.id, b.id]
        assert all(r.state == STATE_ASSIGNED and r.patient_key is None and r.resolved_by == "hem.ayse"
                   and r.resolved_at == T0 for r in claimed)
        assert store.unmatched("h1", since=T0 - timedelta(days=7)) == []            # in work: off the list
        assert [r.id for r in store.claims("h1")] == [a.id, b.id]
        c = store.add(unmatched("temperature", 37.1, audit_id=3))
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [a.id, c.id], by="hem.zeynep", at=T0)                 # `a` is taken
        assert store.get("h1", [c.id])[0].state == STATE_UNMATCHED                  # … so `c` is not either

    def test_a_claim_of_an_unknown_or_foreign_row_is_refused(self, store):
        a = store.add(unmatched(audit_id=1))
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [a.id, a.id + 999], by="hem.ayse", at=T0)
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h2", [a.id], by="hem.ayse", at=T0)
        with pytest.raises(ReadingNotUnmatched):
            store.claim("h1", [], by="hem.ayse", at=T0)
        assert store.get("h1", [a.id])[0].state == STATE_UNMATCHED

    def test_a_claim_refuses_a_row_that_is_not_waiting(self, store):
        """Only `unmatched` rows are claimable: not a matched row, not a rejected one, not one already linked."""
        waiting = store.add(unmatched("spo2", 97.0, audit_id=1))
        recorded = store.add(device("heart_rate", 88.0, audit_id=2))
        closed = rejected(store, audit_id=3)
        done = linked(store, audit_id=4)
        every = [waiting.id, recorded.id, closed.id, done.id]
        before = store.get("h1", every)
        for row in (recorded, closed, done):
            with pytest.raises(ReadingNotUnmatched):
                store.claim("h1", [row.id], by="hem.zeynep", at=T0)
            with pytest.raises(ReadingNotUnmatched):
                store.claim("h1", [waiting.id, row.id], by="hem.zeynep", at=T0)    # all or none: `waiting` stays
            assert store.get("h1", every) == before
        assert store.claims("h1") == []

    def test_naming_a_row_twice_claims_it_once(self, store):
        a = store.add(unmatched(audit_id=1))
        claimed = store.claim("h1", [a.id, a.id], by="hem.ayse", at=T0)
        assert [r.id for r in claimed] == [a.id]
        assert [r.id for r in store.claims("h1")] == [a.id]

    def test_a_released_claim_is_waiting_again(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.release("h1", [a.id])
        assert store.get("h1", [a.id]) == [a]                                       # as it was: nobody's
        assert store.claims("h1") == []

    def test_release_touches_only_a_claim(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.finalize("h1", a.id, patient_key=KEY, admission_id=None, entry_id=40)
        store.release("h1", [a.id])
        linked = store.get("h1", [a.id])[0]
        assert (linked.state, linked.patient_key, linked.entry_id) == (STATE_ASSIGNED, KEY, 40)

    def test_finalize_files_a_claimed_row_under_the_patient(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.finalize("h1", a.id, patient_key=KEY, admission_id=None, entry_id=40)
        linked = store.get("h1", [a.id])[0]
        assert (linked.state, linked.patient_key, linked.entry_id, linked.audit_id) == (STATE_ASSIGNED, KEY, 40, 1)
        assert linked.received_key == TYPO                                          # the number as typed stays
        assert store.claims("h1") == []
        assert store.for_patient("h1", KEY, since=T0 - timedelta(hours=1), until=T0 + timedelta(hours=1)) == [linked]
        assert store.seen("h1", TYPO, "spo2", T0, "CONNEX-3A", 97.0) is True        # a re-send is still known

    def test_reject_closes_a_claimed_row_with_its_reason(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        store.reject("h1", [a.id], reason="hasta taburcu, ölçüm başkasının")
        closed = store.get("h1", [a.id])[0]
        assert (closed.state, closed.resolved_by, closed.resolved_at) == (STATE_REJECTED, "hem.ayse", T0)
        assert closed.resolve_reason == "hasta taburcu, ölçüm başkasının" and closed.patient_key is None
        assert store.claims("h1") == [] and store.unmatched("h1", since=T0 - timedelta(days=7)) == []
        assert store.seen("h1", TYPO, "spo2", T0, "CONNEX-3A", 97.0) is True        # a re-send does not re-create it

    def test_reject_touches_only_a_claim(self, store):
        a = store.add(unmatched(audit_id=1))
        store.reject("h1", [a.id], reason="on karakterden uzun")                    # never claimed: nothing happens
        assert store.get("h1", [a.id]) == [a]

    def test_reject_leaves_a_linked_row_as_it_is(self, store):
        """A linked row has its patient: a late rejection (a second desk) must not take it back."""
        done = linked(store, audit_id=1)
        store.reject("h1", [done.id], reason="ikinci masadan gelen ret")
        assert store.get("h1", [done.id]) == [done]

    def test_finalize_touches_only_a_claim(self, store):
        waiting = store.add(unmatched("spo2", 97.0, audit_id=1))
        closed = rejected(store, audit_id=2)
        done = linked(store, audit_id=3)
        every = [waiting.id, closed.id, done.id]
        before = store.get("h1", every)
        store.finalize("h1", waiting.id, patient_key=KEY, admission_id=None, entry_id=41)   # never claimed
        store.finalize("h1", closed.id, patient_key=KEY, admission_id=None, entry_id=42)    # rejected: closed
        store.finalize("h1", done.id, patient_key="202600000002", admission_id=None, entry_id=43)  # linked already
        assert store.get("h1", every) == before

    # ------------------------------------------------------------------ another hospital
    def test_another_hospitals_calls_leave_a_claim_alone(self, store):
        a = store.add(unmatched(audit_id=1))
        store.claim("h1", [a.id], by="hem.ayse", at=T0)
        claimed = store.get("h1", [a.id])
        assert store.claims("h2") == []
        store.release("h2", [a.id])
        store.finalize("h2", a.id, patient_key=KEY, admission_id=None, entry_id=40)
        store.reject("h2", [a.id], reason="başka hastanenin kaydı")
        assert store.get("h1", [a.id]) == claimed
        assert store.claims("h1") == claimed

    def test_another_hospital_may_file_the_same_audit_row_and_the_same_reading(self, store):
        """Both unique indexes begin with the tenant: h2's reading is no duplicate of h1's."""
        one = store.add(device(audit_id=5))
        other = store.add(device(audit_id=5, tenant="h2"))
        assert one is not None and other is not None and other.id != one.id
        assert store.get("h1", [one.id, other.id]) == [one]
        assert store.get("h2", [one.id, other.id]) == [other]
        assert store.seen("h2", KEY, "spo2", T0, "CONNEX-3A", 97.0) is True

    # ------------------------------------------------------------------ void
    def test_void_marks_the_row_of_an_entry_once(self, store):
        row = store.add(device(audit_id=31))
        assert store.void("h1", 31, by="hem.ayse", at=T0, reason="yanlış hastadan ölçüldü") is True
        voided = store.get("h1", [row.id])[0]
        assert (voided.voided_by, voided.voided_at, voided.void_reason) == ("hem.ayse", T0, "yanlış hastadan ölçüldü")
        assert voided.state == STATE_RECORDED and voided.value == 97.0              # the value is kept
        assert store.void("h1", 31, by="hem.zeynep", at=T0 + timedelta(minutes=1), reason="ikinci kez") is False
        assert store.get("h1", [row.id])[0] == voided                               # the first word stands

    def test_void_of_an_entry_nobody_filed_is_false(self, store):
        assert store.void("h1", 999, by="hem.ayse", at=T0, reason="yanlış hastadan ölçüldü") is False
        store.add(device(audit_id=31))
        assert store.void("h2", 31, by="hem.ayse", at=T0, reason="yanlış hastadan ölçüldü") is False

    def test_get_keeps_to_the_tenant_and_orders_by_id(self, store):
        a = store.add(device(audit_id=1))
        b = store.add(device("heart_rate", 88.0, audit_id=2))
        assert store.get("h1", [b.id, a.id]) == [a, b]
        assert store.get("h2", [a.id, b.id]) == []
        assert store.get("h1", []) == []
