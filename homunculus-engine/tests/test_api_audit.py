# tests/test_api_audit.py
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog

TENANTS = {"tok": "HOSP1"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _fhir(code, value, patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {"resourceType": "Observation", "code": {"coding": [{"code": code}]},
            "subject": {"reference": f"Patient/{patient}"}, "effectiveDateTime": when,
            "valueQuantity": {"value": value, "unit": ""}}


_SHOCK = [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]


def test_ingest_writes_ingest_and_alert_audit_records():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    hdr = {"Authorization": "Bearer tok"}
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers=hdr)
    ingests = audit.records(tenant="HOSP1", event_type="ingest")
    alerts = audit.records(tenant="HOSP1", event_type="alert")
    assert len(ingests) == len(_SHOCK)
    assert any(r.subject == "septic_shock" for r in alerts)


def test_ack_writes_ack_audit_record():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    hdr = {"Authorization": "Bearer tok"}
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers=hdr)
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=hdr)
    acks = audit.records(tenant="HOSP1", event_type="ack")
    assert len(acks) == 1 and acks[0].payload["role"] == "doctor"


@pytest.mark.anyio
async def test_escalation_and_notification_are_audited():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, escalate_after=timedelta(seconds=0), run_escalation_loop=False, audit=audit)
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = {"Authorization": "Bearer tok"}
        for code, val in _SHOCK:
            await c.post("/ingest", json=_fhir(code, val), headers=hdr)
    assert len(audit.records(tenant="HOSP1", event_type="notification")) >= 1
    await app.state.escalation_cycle(datetime.now(timezone.utc))
    assert any(r.subject == "septic_shock" for r in audit.records(event_type="escalation"))


def test_audit_endpoint_is_tenant_scoped_and_filterable():
    audit = InMemoryAuditLog()
    app = create_app({"tok1": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    for code, val in _SHOCK:
        client.post("/ingest", json=_fhir(code, val), headers={"Authorization": "Bearer tok1"})
    r2 = client.get("/audit", headers={"Authorization": "Bearer tok2"})
    assert r2.status_code == 200 and r2.json()["records"] == []
    r1 = client.get("/audit?event_type=ingest", headers={"Authorization": "Bearer tok1"})
    body = r1.json()["records"]
    assert len(body) == len(_SHOCK) and all(rec["event_type"] == "ingest" for rec in body)


def test_view_writes_view_audit_record():
    audit = InMemoryAuditLog()
    app = create_app(TENANTS, run_escalation_loop=False, audit=audit)
    client = TestClient(app)
    client.post("/view", json={"patient_id": "bed-3", "role": "doctor"},
                headers={"Authorization": "Bearer tok"})
    views = audit.records(tenant="HOSP1", event_type="view")
    assert len(views) == 1
    assert views[0].patient_id == "bed-3" and views[0].payload["role"] == "doctor"


# --- G2-A2 (D12): the newest rows, at most AUDIT_LIMIT_MAX; the alarm report reads its window ----

HDR = {"Authorization": "Bearer tok"}


def _views(audit, count):
    for n in range(count):
        audit.append(AuditEvent("HOSP1", "view", f"bed-{n}", "", {"n": n}))


def test_the_trail_is_the_newest_rows_oldest_first():
    audit = InMemoryAuditLog()
    _views(audit, 250)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    body = client.get("/audit", headers=HDR).json()["records"]
    assert [r["payload"]["n"] for r in body] == list(range(50, 250))


def test_the_trail_is_capped_and_a_request_cannot_empty_it():
    from homunculus.api.app import AUDIT_LIMIT_MAX
    audit = InMemoryAuditLog()
    _views(audit, AUDIT_LIMIT_MAX + 5)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    capped = client.get("/audit", params={"limit": 100000}, headers=HDR).json()["records"]
    assert len(capped) == AUDIT_LIMIT_MAX
    assert capped[-1]["payload"]["n"] == AUDIT_LIMIT_MAX + 4
    one = client.get("/audit", params={"limit": 0}, headers=HDR).json()["records"]
    assert [r["payload"]["n"] for r in one] == [AUDIT_LIMIT_MAX + 4]


class _Spy(InMemoryAuditLog):
    def __init__(self):
        super().__init__()
        self.reads: list[dict] = []

    def records(self, **kw):
        self.reads.append(kw)
        return super().records(**kw)


def _first_seens(audit, count):
    """One alarm episode per bed, bed-0 the oldest row and bed-(count-1) the newest."""
    for n in range(count):
        audit.append(AuditEvent("HOSP1", "first_seen", f"bed-{n}", "news2",
                                {"at": datetime.now(timezone.utc).isoformat()}))


def test_the_alarm_report_asks_the_backend_for_its_window_and_says_when_it_was_cut():
    audit = _Spy()
    _first_seens(audit, 5)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    body = client.get("/alarm-quality", params={"limit": 3}, headers=HDR).json()
    [read] = [r for r in audit.reads if "since" in r]
    assert (read["newest"], read["limit"]) == (True, 4)       # the cap, and one more to know
    assert read["since"].tzinfo is not None
    assert (body["truncated"], body["episodes"]) == (True, 3)
    assert {b["patient_id"] for b in body["noisiest_beds"]} == {"bed-2", "bed-3", "bed-4"},         "the cut keeps the newest rows: the oldest one — the extra row read to know — is dropped"
    body = client.get("/alarm-quality", params={"limit": 5}, headers=HDR).json()
    assert (body["truncated"], body["episodes"]) == (False, 5)


def test_the_alarm_reports_read_is_capped():
    from homunculus.api.app import ALARM_QUALITY_LIMIT_MAX
    audit = _Spy()
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    client.get("/alarm-quality", params={"limit": 10**9}, headers=HDR)
    [read] = [r for r in audit.reads if "since" in r]
    assert read["limit"] == ALARM_QUALITY_LIMIT_MAX + 1


def test_the_alarm_reports_limit_is_clamped_up_to_one_row():
    """`limit=0` or a negative one is one row — the newest — like /audit's, not an empty read and not
    a slice from the wrong end."""
    audit = _Spy()
    _first_seens(audit, 3)
    client = TestClient(create_app(TENANTS, run_escalation_loop=False, audit=audit))
    for limit in (0, -5):
        audit.reads.clear()
        body = client.get("/alarm-quality", params={"limit": limit}, headers=HDR).json()
        [read] = [r for r in audit.reads if "since" in r]
        assert (read["newest"], read["limit"]) == (True, 2), limit      # a cap of 1, and one more
        assert (body["truncated"], body["episodes"]) == (True, 1), limit
        assert [b["patient_id"] for b in body["noisiest_beds"]] == ["bed-2"], limit
