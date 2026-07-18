# src/homunculus/api/app.py
"""Cloud ingestion + live board API. Each hospital is a tenant identified by a bearer token;
its data lives in its own Engine, so one hospital never sees another's patients. /ingest also
publishes the affected patient's board to a per-tenant broadcaster that /stream fans out over
Server-Sent Events. Register unchanged: recommendations never orders; every alert cites the vault.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import asdict

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from homunculus.api.board import board_snapshot, patient_board
from homunculus.api.broadcast import Broadcaster
from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
from homunculus.pipeline import Engine


async def sse_board_frames(queue: asyncio.Queue, keepalive: float = 15.0):
    """Yield Server-Sent-Events frames for boards arriving on `queue`. On an idle timeout, emit a
    keep-alive comment so proxies keep the connection open. Extracted from the endpoint so it can
    be unit-tested directly — httpx's ASGITransport cannot read an unbounded stream incrementally.
    Cancellation (client disconnect, via Starlette) simply interrupts the wait; the caller's finally
    unsubscribes."""
    while True:
        try:
            board = await asyncio.wait_for(queue.get(), timeout=keepalive)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        yield f"data: {json.dumps(board)}\n\n"


def create_app(tenants: dict[str, str]) -> FastAPI:
    """Build the app. `tenants` maps bearer token -> hospital id (injected for testability)."""
    app = FastAPI(title="Homunculus")
    engines: dict[str, Engine] = {}
    broadcaster = Broadcaster()
    app.state.broadcaster = broadcaster

    def _tenant_from_token(token: str | None) -> str:
        hospital = tenants.get(token or "")
        if hospital is None:
            raise HTTPException(status_code=401, detail="unknown tenant token")
        return hospital

    def _tenant(authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        return _tenant_from_token(authorization.split(" ", 1)[1])

    def _engine(hospital: str) -> Engine:
        return engines.setdefault(hospital, Engine())

    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        engine = _engine(hospital)
        alerts = engine.ingest(obs, now=obs.timestamp)
        await broadcaster.publish(hospital, patient_board(engine, obs.patient_id))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.get("/patients")
    def patients(authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        return {"patients": board_snapshot(_engine(hospital))}

    @app.get("/alerts/{patient_id}")
    def alerts(patient_id: str, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        active = _engine(hospital).active_alerts(patient_id)
        return {"patient_id": patient_id, "alerts": [asdict(a) for a in active]}

    @app.get("/stream")
    async def stream(token: str | None = None):
        hospital = _tenant_from_token(token)
        queue = broadcaster.subscribe(hospital)

        async def events():
            # Starlette cancels this generator when the client disconnects, running the finally.
            # Do NOT read the request's receive channel here — that races Starlette's own disconnect
            # listener for the same channel and can strand the connection.
            try:
                async for frame in sse_board_frames(queue):
                    yield frame
            finally:
                broadcaster.unsubscribe(hospital, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    return app
