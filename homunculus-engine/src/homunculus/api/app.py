# src/homunculus/api/app.py
"""Cloud ingestion + live board API with acknowledge + escalation.

Each hospital is a tenant identified by a bearer token; its data lives in its own Engine and its
own AckStore, so one hospital never sees another's patients. /ingest publishes the affected board;
/stream fans boards out over SSE. /ack records an acknowledgement (and clears escalation). A
background task escalates unacknowledged high-urgency alerts past a wall-clock threshold.
Register unchanged: recommendations never orders; every alert cites the vault.
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog
from homunculus.api.board import board_snapshot, patient_board
from homunculus.api.broadcast import Broadcaster
from homunculus.api.escalation import escalate
from homunculus.api.notify import NotificationHub, Notifier
from homunculus.api.rehydrate import rehydrate
from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
from homunculus.pipeline import Engine


async def sse_board_frames(queue: asyncio.Queue, keepalive: float = 15.0):
    """Yield SSE frames for boards arriving on `queue`; keep-alive comment on idle. Tested directly
    (httpx ASGITransport cannot read an unbounded stream). Cancellation (client disconnect, via
    Starlette) interrupts the wait; the caller's finally unsubscribes. Do NOT read request.receive."""
    while True:
        try:
            board = await asyncio.wait_for(queue.get(), timeout=keepalive)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        yield f"data: {json.dumps(board)}\n\n"


async def sse_notification_frames(queue: asyncio.Queue, keepalive: float = 15.0):
    """Same shape as sse_board_frames, for the /notifications stream. Tested directly."""
    while True:
        try:
            note = await asyncio.wait_for(queue.get(), timeout=keepalive)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        yield f"data: {json.dumps(note)}\n\n"


def create_app(
    tenants: dict[str, str],
    *,
    escalate_after: timedelta = timedelta(minutes=5),
    escalate_interval: float = 20.0,
    run_escalation_loop: bool = True,
    audit: AuditLog | None = None,
) -> FastAPI:
    """`tenants` maps bearer token -> hospital id. Escalation params are injectable for tests;
    run_escalation_loop=False disables the background task so tests are deterministic."""
    engines: dict[str, Engine] = {}
    stores: dict[str, AckStore] = {}
    broadcaster = Broadcaster()
    notifier = Notifier()
    hub = NotificationHub()
    audit = audit or InMemoryAuditLog()

    rehydrated: set[str] = set()

    def _ensure(hospital: str) -> None:
        """Build a tenant's engine + store, rehydrating once from the audit log (event sourcing)."""
        if hospital in rehydrated:
            return
        rehydrated.add(hospital)
        engine = engines.setdefault(hospital, Engine())
        store = stores.setdefault(hospital, AckStore())
        rehydrate(engine, store, audit.records(tenant=hospital, limit=1_000_000))

    def _engine(hospital: str) -> Engine:
        _ensure(hospital)
        return engines.setdefault(hospital, Engine())

    def _store(hospital: str) -> AckStore:
        _ensure(hospital)
        return stores.setdefault(hospital, AckStore())

    def _live_keys(engine: Engine) -> set[tuple[str, str]]:
        return {(pid, a.kind) for pid in engine.patient_ids() for a in engine.active_alerts(pid)}

    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
            store = _store(hospital)
            alerts = [(pid, a) for pid in engine.patient_ids() for a in engine.active_alerts(pid)]
            newly = escalate(alerts, store.acks, store.first_seen, now, escalate_after)
            if newly != store.escalated:
                added = newly - store.escalated
                changed = {pid for (pid, _k) in (newly ^ store.escalated)}
                store.escalated = newly
                for pid in changed:
                    await broadcaster.publish(hospital, patient_board(engine, pid, store))
                if added:
                    alert_by_key = {(pid, a.kind): a for (pid, a) in alerts}
                    for key in added:
                        audit.append(AuditEvent(hospital, "escalation", key[0], key[1],
                                                {"at": now.isoformat()}))
                    for note in notifier.for_escalation(hospital, added, alert_by_key):
                        await hub.publish(hospital, note)
                        audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                                {"audience": note.audience, "trigger": note.trigger}))

    async def _escalation_loop() -> None:
        while True:
            await asyncio.sleep(escalate_interval)
            try:
                await _escalation_cycle(datetime.now(timezone.utc))
            except Exception:  # a bad cycle must never kill the loop
                pass

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(_escalation_loop()) if run_escalation_loop else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()

    app = FastAPI(title="Homunculus", lifespan=lifespan)
    app.state.broadcaster = broadcaster
    app.state.ack_stores = stores
    app.state.escalation_cycle = _escalation_cycle
    app.state.notifier = notifier
    app.state.notification_hub = hub
    app.state.audit = audit

    def _tenant_from_token(token: str | None) -> str:
        hospital = tenants.get(token or "")
        if hospital is None:
            raise HTTPException(status_code=401, detail="unknown tenant token")
        return hospital

    def _tenant(authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        return _tenant_from_token(authorization.split(" ", 1)[1])

    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        engine = _engine(hospital)
        store = _store(hospital)
        alerts = engine.ingest(obs, now=obs.timestamp)
        audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        wall_now = datetime.now(timezone.utc)
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now):
                audit.append(AuditEvent(hospital, "first_seen", obs.patient_id, a.kind,
                                        {"at": wall_now.isoformat()}))
        store.prune(_live_keys(engine))
        await broadcaster.publish(hospital, patient_board(engine, obs.patient_id, store))
        # Push a notification for any newly-appeared immediate alert (nurse audience).
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, _live_keys(engine))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.post("/ack")
    async def ack(authorization: str | None = Header(default=None), body: dict = Body(...)):
        hospital = _tenant(authorization)
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind = body.get("patient_id"), body.get("kind")
        role = body.get("role", "unknown")
        if (patient_id, kind) not in _live_keys(engine):
            raise HTTPException(status_code=404, detail="no such active alert")
        store.acknowledge(patient_id, kind, role, datetime.now(timezone.utc))
        store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        audit.append(AuditEvent(hospital, "ack", patient_id, kind,
                                {"role": role, "at": datetime.now(timezone.utc).isoformat()}))
        board = patient_board(engine, patient_id, store)
        await broadcaster.publish(hospital, board)
        return board

    @app.post("/view")
    def view(authorization: str | None = Header(default=None), body: dict = Body(...)):
        """Record that a clinician opened a patient. Attribution is role-level (no per-user login yet)."""
        hospital = _tenant(authorization)
        patient_id = body.get("patient_id", "")
        audit.append(AuditEvent(hospital, "view", patient_id, "",
                                {"role": body.get("role", "unknown")}))
        return {"ok": True}

    @app.get("/patients")
    def patients(authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        return {"patients": board_snapshot(_engine(hospital), _store(hospital))}

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
            try:
                async for frame in sse_board_frames(queue):
                    yield frame
            finally:
                broadcaster.unsubscribe(hospital, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/notifications")
    async def notifications(token: str | None = None, role: str = "nurse"):
        hospital = _tenant_from_token(token)
        queue = hub.subscribe(hospital, role)

        async def events():
            try:
                async for frame in sse_notification_frames(queue):
                    yield frame
            finally:
                hub.unsubscribe(hospital, role, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/audit")
    def get_audit(patient_id: str | None = None, event_type: str | None = None,
                  limit: int = 200, authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        recs = audit.records(tenant=hospital, patient_id=patient_id,
                             event_type=event_type, limit=limit)
        return {"records": [asdict(r) for r in recs]}

    return app
