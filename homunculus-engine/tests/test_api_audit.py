# tests/test_api_audit.py
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog

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
