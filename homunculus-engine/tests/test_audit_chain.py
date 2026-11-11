"""The audit log's integrity seal (G2).

Append-only was already enforced by database triggers. That protects the log from the application
and not at all from whoever can reach the database directly — which on an on-prem install is the
hospital's own administrator. "Nobody deleted a row" and "nobody rewrote one" are different claims,
and an inspection asks about the second one.

These tests hold the second claim: any edit to any past record must be detectable, and the system
must say WHICH record, not merely that something is wrong.
"""
from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, ChainVerifier, InMemoryAuditLog, SqliteAuditLog,
    chain_hash, verify_chain,
)

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(params=[InMemoryAuditLog, SqliteAuditLog])
def log(request):
    """Both backends carry the same contract; a seal that only one of them keeps is not a seal."""
    return request.param()


def _fill(log, tenant="h1", n=4):
    return [log.append(AuditEvent(tenant, "ingest", f"bed-{i}", "heart_rate", {"value": 80 + i}))
            for i in range(n)]


class TestTheChainIsBuilt:
    def test_the_first_record_links_to_the_genesis_hash(self, log):
        rec = log.append(AuditEvent("h1", "ingest", "bed-1", "heart_rate", {"value": 80}))
        assert rec.prev_hash == GENESIS_HASH
        assert len(rec.hash) == 64

    def test_each_record_links_to_the_one_before_it(self, log):
        recs = _fill(log)
        for earlier, later in zip(recs, recs[1:]):
            assert later.prev_hash == earlier.hash

    def test_a_clean_log_verifies(self, log):
        _fill(log)
        report = verify_chain(log.records(tenant="h1"))
        assert report.ok is True and report.broken_at is None and report.checked == 4

    def test_each_tenant_has_its_own_chain(self, log):
        """A shared chain would mean a hospital could not verify its own log without being handed
        another hospital's records — a coupling and a leak at once."""
        log.append(AuditEvent("h1", "ingest", "bed-1", "hr", {"v": 1}))
        b = log.append(AuditEvent("h2", "ingest", "bed-9", "hr", {"v": 9}))
        assert b.prev_hash == GENESIS_HASH
        assert verify_chain(log.records(tenant="h1")).ok
        assert verify_chain(log.records(tenant="h2")).ok


class TestTamperingIsDetected:
    def test_rewriting_a_payload_breaks_the_chain_at_that_record(self, log):
        recs = _fill(log)
        # The edit a database administrator could make directly, bypassing the triggers entirely.
        forged = [r if r.id != recs[1].id
                  else AuditRecord(**{**r.__dict__, "payload": {"value": 999}})
                  for r in log.records(tenant="h1")]
        report = verify_chain(forged)
        assert report.ok is False
        assert report.broken_at == recs[1].id
        assert "değiştirilmiş" in report.reason

    def test_removing_a_record_from_the_middle_is_detected(self, log):
        recs = _fill(log)
        remaining = [r for r in log.records(tenant="h1") if r.id != recs[1].id]
        report = verify_chain(remaining)
        assert report.ok is False
        assert report.broken_at == recs[2].id     # the first record whose predecessor is gone
        assert "silinmiş" in report.reason

    def test_reordering_two_records_is_detected(self, log):
        recs = _fill(log)
        rows = log.records(tenant="h1")
        swapped = [rows[0], rows[2], rows[1], rows[3]]
        assert verify_chain(swapped).ok is False

    def test_appending_a_forged_record_at_the_end_is_detected(self, log):
        _fill(log)
        rows = log.records(tenant="h1")
        # A hash that is internally consistent but does not follow from the real head.
        bogus_prev = "f" * 64
        forged = AuditRecord(
            id=999, ts="2026-09-08T10:00:00+00:00", tenant="h1", event_type="ack",
            patient_id="bed-1", subject="sepsis", payload={"by": "nobody"},
            prev_hash=bogus_prev,
            hash=chain_hash(bogus_prev, ts="2026-09-08T10:00:00+00:00", tenant="h1",
                            event_type="ack", patient_id="bed-1", subject="sepsis",
                            payload={"by": "nobody"}),
        )
        assert verify_chain(rows + [forged]).ok is False


class TestHonestyAboutWhatIsSealed:
    def test_records_written_before_the_chain_existed_are_unsealed_not_tampered(self):
        """Calling a row that predates the seal 'tampered' would be a false accusation in the one
        place where accusations matter."""
        legacy = AuditRecord(id=1, ts="2026-09-01T00:00:00+00:00", tenant="h1",
                             event_type="ingest", patient_id="bed-1", subject="hr",
                             payload={"value": 80})
        log = InMemoryAuditLog()
        sealed = log.append(AuditEvent("h1", "ingest", "bed-2", "hr", {"value": 90}))
        report = verify_chain([legacy, sealed])
        assert report.ok is True
        assert report.unsealed == 1 and report.checked == 1

    def test_an_empty_log_verifies_as_ok_with_nothing_checked(self):
        report = verify_chain([])
        assert report.ok is True and report.checked == 0


class TestTheEndpoint:
    @pytest.fixture()
    def client(self):
        app = create_app({TOKEN: "h1"}, run_escalation_loop=False)
        with TestClient(app) as c:
            yield c

    def test_a_live_system_verifies_its_own_log(self, client):
        client.post("/clinical/bed-1",
                    json={"entries": [{"code": "lactate", "value": 3.2}]}, headers=AUTH)
        body = client.get("/audit/verify", headers=AUTH).json()
        assert body["ok"] is True
        assert body["records"] >= 1 and body["checked"] >= 1

    def test_the_records_endpoint_carries_the_seal(self, client):
        client.post("/clinical/bed-1",
                    json={"entries": [{"code": "lactate", "value": 3.2}]}, headers=AUTH)
        rows = client.get("/audit", headers=AUTH).json()["records"]
        assert rows and len(rows[0]["hash"]) == 64
        assert rows[0]["prev_hash"] == GENESIS_HASH

    def test_an_old_clients_limit_is_accepted_and_ignored(self, client):
        """G2 borç 3: the whole chain is the answer, whatever `limit` an older client still sends."""
        for i in range(3):
            client.post(f"/clinical/bed-{i}",
                        json={"entries": [{"code": "lactate", "value": 2.0}]}, headers=AUTH)
        whole = client.get("/audit/verify", headers=AUTH).json()
        for limit in ("2", "abc"):
            body = client.get(f"/audit/verify?limit={limit}", headers=AUTH)
            assert body.status_code == 200
            assert body.json()["records"] == whole["records"] >= 3
            assert body.json()["complete"] is True


# --- G2 borç 3 (owner decision 2026-11-10, «Tamamını doğrula») ---------------------------------------
# The verification read the OLDEST rows, at most 50 000, and so on a long trail never checked the
# newest — the rows an inspection would ask about first. It now walks the whole chain, a page at a
# time, each page read and re-hashed on a worker thread, one verification per hospital at a time.

class TestTheChainIsVerifiedInPieces:
    def test_pieces_give_the_answer_the_whole_gives(self, log):
        rows = _fill(log, n=7)
        verifier = ChainVerifier()
        for piece in (rows[:3], rows[3:6], rows[6:], []):
            assert verifier.feed(piece) is True
        assert verifier.report() == verify_chain(rows)
        assert verifier.records == 7 and verifier.report().checked == 7

    def test_it_stops_at_the_first_break_and_walks_nothing_after_it(self):
        log = InMemoryAuditLog()
        rows = _fill(log, n=6)
        forged = replace(rows[4], payload={"value": 999})
        verifier = ChainVerifier()
        assert verifier.feed(rows[:3]) is True
        assert verifier.feed([rows[3], forged, rows[5]]) is False
        assert verifier.feed(rows) is False                       # nothing after the break is walked
        report = verifier.report()
        assert (report.ok, report.broken_at, report.checked) == (False, forged.id, 4)
        assert "mührüyle uyuşmuyor" in report.reason
        assert verifier.records == 5


def test_the_sqlite_log_serialises_its_one_connection_between_threads():
    """`/audit/verify` reads its pages on a worker thread while the event loop goes on appending.
    SqliteAuditLog has ONE connection (`check_same_thread=False`), whose transaction is shared: a read
    run between an append's INSERT and its COMMIT would read the uncommitted row, and a COMMIT among a
    read's steps is not a state either was written for. So both hold the log's lock for their time
    on the connection: a read waits for an append in progress, and an append for a read."""
    import threading

    log = SqliteAuditLog()
    _fill(log, n=2)
    got: list[int] = []
    for call in (lambda: got.append(len(log.records(tenant="h1", limit=10, after_id=0))),
                 lambda: got.append(log.append(AuditEvent("h1", "view", "bed-9", "", {})).id)):
        with log._lock:                                            # noqa: SLF001 — the other side, mid-use
            worker = threading.Thread(target=call)
            worker.start()
            worker.join(0.2)
            assert worker.is_alive(), "the connection was used while the other side held it"
        worker.join(5)
    assert got == [2, 3]
    assert verify_chain(log.records(tenant="h1", limit=10)).checked == 3


class _Paged(InMemoryAuditLog):
    """Records each read's `limit` and `after_id`, and the thread it ran on."""

    def __init__(self):
        super().__init__()
        self.reads: list[tuple[int, int | None]] = []
        self.threads: set[int] = set()

    def records(self, **kwargs):
        import threading
        self.reads.append((kwargs.get("limit"), kwargs.get("after_id")))
        self.threads.add(threading.get_ident())
        return super().records(**kwargs)


def _verify_paged(audit, monkeypatch, page=2):
    import homunculus.api.app as app_module
    monkeypatch.setattr(app_module, "AUDIT_VERIFY_PAGE", page)
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit)) as c:
        audit.reads.clear()
        return c.get("/audit/verify", headers=AUTH).json()


def test_a_chain_longer_than_one_page_is_verified_whole(monkeypatch):
    import homunculus.api.app as app_module
    assert app_module.AUDIT_VERIFY_PAGE == 5000
    assert not hasattr(app_module, "AUDIT_VERIFY_LIMIT_MAX")
    audit = _Paged()
    _fill(audit, n=7)
    _fill(audit, tenant="h2", n=3)                                 # another hospital's rows: not walked
    body = _verify_paged(audit, monkeypatch)
    assert body == {"ok": True, "checked": 7, "unsealed": 0, "broken_at": None, "reason": "",
                    "records": 7, "complete": True}
    # Every read a page of its own, by id, oldest first: 2 + 2 + 2 + 1.
    assert [limit for limit, _ in audit.reads] == [2, 2, 2, 2]
    assert audit.reads[0][1] is None and all(after is not None for _, after in audit.reads[1:])


def test_a_tampered_row_on_a_later_page_is_named_and_the_walk_stops_there(monkeypatch):
    audit = _Paged()
    rows = _fill(audit, n=9)
    target = rows[6]                                               # on the fourth page of two
    audit._rows[target.id - 1] = replace(target, subject="forged")  # noqa: SLF001
    body = _verify_paged(audit, monkeypatch)
    assert (body["ok"], body["broken_at"], body["checked"]) == (False, target.id, 6)
    assert "mührüyle uyuşmuyor" in body["reason"]
    assert body["records"] == 7 and body["complete"] is True
    assert len(audit.reads) == 4                                   # the fifth page is never read


def test_a_deleted_row_on_a_later_page_is_named_by_the_one_after_it(monkeypatch):
    audit = _Paged()
    rows = _fill(audit, n=6)
    del audit._rows[4]                                             # noqa: SLF001 — row 5 is gone
    body = _verify_paged(audit, monkeypatch)
    assert (body["ok"], body["broken_at"]) == (False, rows[5].id)
    assert "önceki kayda bağlanmıyor" in body["reason"]


def test_unsealed_rows_are_counted_across_pages(monkeypatch):
    audit = _Paged()
    for i in range(3):                                             # written before the chain existed
        audit._rows.append(AuditRecord(id=i + 1, ts="2026-09-01T00:00:00+00:00", tenant="h1",  # noqa: SLF001
                                       event_type="ingest", patient_id=f"bed-{i}", subject="hr",
                                       payload={"value": 80}))
    _fill(audit, n=4)
    body = _verify_paged(audit, monkeypatch)
    assert (body["ok"], body["unsealed"], body["checked"], body["records"]) == (True, 3, 4, 7)


async def test_the_walk_runs_off_the_event_loop_and_one_hospital_verifies_once_at_a_time(monkeypatch):
    """Every page is read and re-hashed on a worker thread: while one is held, the loop still
    answers — a second verification of the same hospital with its coded refusal, another
    hospital's verification at once. Released, the first completes and the hospital is free again."""
    import threading

    import httpx
    from httpx import ASGITransport

    import homunculus.api.app as app_module
    import homunculus.api.audit as audit_module
    monkeypatch.setattr(app_module, "AUDIT_VERIFY_PAGE", 2)
    loop_thread = threading.get_ident()
    hashed_on: set[int] = set()
    real_feed = audit_module.ChainVerifier.feed

    def spy_feed(self, records):
        hashed_on.add(threading.get_ident())
        return real_feed(self, records)

    started, release = threading.Event(), threading.Event()

    class _Held(_Paged):
        def records(self, **kwargs):
            if kwargs.get("tenant") == "h1" and kwargs.get("after_id") is not None:
                started.set()
                assert release.wait(5), "the walk held the event loop"
            return super().records(**kwargs)

    audit = _Held()
    _fill(audit, n=5)
    _fill(audit, tenant="h2", n=3)
    monkeypatch.setattr(audit_module.ChainVerifier, "feed", spy_feed)
    app = create_app({TOKEN: "h1", "tok2": "h2"}, run_escalation_loop=False, audit=audit)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        first = asyncio.create_task(c.get("/audit/verify", headers=AUTH))
        assert await asyncio.to_thread(started.wait, 5)
        second = await asyncio.wait_for(c.get("/audit/verify", headers=AUTH), timeout=5)
        other = await asyncio.wait_for(
            c.get("/audit/verify", headers={"Authorization": "Bearer tok2"}), timeout=5)
        release.set()
        done = await asyncio.wait_for(first, timeout=5)
        again = await asyncio.wait_for(c.get("/audit/verify", headers=AUTH), timeout=5)
    assert second.status_code == 409
    assert second.json()["detail"] == "denetim doğrulaması zaten sürüyor"
    assert other.status_code == 200 and other.json()["checked"] == 3
    assert done.status_code == 200 and done.json()["checked"] == 5
    assert again.status_code == 200 and again.json()["checked"] == 5
    assert loop_thread not in audit.threads                       # no read on the loop
    assert hashed_on and loop_thread not in hashed_on             # no seal re-hashed on the loop


def test_a_verification_that_fails_frees_its_hospital(monkeypatch):
    class _Broken(_Paged):
        fail = True

        def records(self, **kwargs):
            if self.fail:
                raise RuntimeError("database gone")
            return super().records(**kwargs)

    audit = _Broken()
    _fill(audit, n=2)
    with TestClient(create_app({TOKEN: "h1"}, run_escalation_loop=False, audit=audit),
                    raise_server_exceptions=False) as c:
        assert c.get("/audit/verify", headers=AUTH).status_code == 500
        audit.fail = False
        assert c.get("/audit/verify", headers=AUTH).json()["checked"] == 2
