"""The audit log's integrity seal (G2).

Append-only was already enforced by database triggers. That protects the log from the application
and not at all from whoever can reach the database directly — which on an on-prem install is the
hospital's own administrator. "Nobody deleted a row" and "nobody rewrote one" are different claims,
and an inspection asks about the second one.

These tests hold the second claim: any edit to any past record must be detectable, and the system
must say WHICH record, not merely that something is wrong.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import (
    GENESIS_HASH, AuditEvent, AuditRecord, InMemoryAuditLog, SqliteAuditLog, chain_hash,
    verify_chain,
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

    def test_a_truncated_verification_says_it_was_truncated(self, client):
        """A partial verification must never be readable as a whole one."""
        for i in range(3):
            client.post(f"/clinical/bed-{i}",
                        json={"entries": [{"code": "lactate", "value": 2.0}]}, headers=AUTH)
        body = client.get("/audit/verify?limit=2", headers=AUTH).json()
        assert body["complete"] is False
