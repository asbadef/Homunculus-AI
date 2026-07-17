# src/homunculus/api/app.py
"""Cloud ingestion API. Each hospital is a tenant identified by a bearer token; its data lives
in its own Engine instance, so one hospital never sees another's patients.

The engine evaluates as of each observation's own timestamp (`now=obs.timestamp`), which is
deterministic for replay and correct for a per-observation stream. Register unchanged:
recommendations, never orders; every alert carries its vault citations.
"""
from __future__ import annotations

from dataclasses import asdict

from fastapi import FastAPI, Header, HTTPException

from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
from homunculus.pipeline import Engine


def create_app(tenants: dict[str, str]) -> FastAPI:
    """Build the app. `tenants` maps bearer token -> hospital id (injected for testability)."""
    app = FastAPI(title="Homunculus Ingest")
    engines: dict[str, Engine] = {}

    def _tenant(authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        hospital = tenants.get(authorization.split(" ", 1)[1])
        if hospital is None:
            raise HTTPException(status_code=401, detail="unknown tenant token")
        return hospital

    def _engine(hospital: str) -> Engine:
        return engines.setdefault(hospital, Engine())

    @app.post("/ingest")
    def ingest(resource: dict, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        alerts = _engine(hospital).ingest(obs, now=obs.timestamp)
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.get("/alerts/{patient_id}")
    def alerts(patient_id: str, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        active = _engine(hospital).active_alerts(patient_id)
        return {"patient_id": patient_id, "alerts": [asdict(a) for a in active]}

    return app
