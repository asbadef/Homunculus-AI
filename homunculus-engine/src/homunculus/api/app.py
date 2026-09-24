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
import logging
import os
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from homunculus.api.ackstore import AckStore
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import (
    DISCHARGED_TTL, IdentityStore, InMemoryIdentityStore, parse_fhir_encounter,
    parse_fhir_patient,
)
from homunculus.api.broadcast import Broadcaster
from homunculus.api.escalation import escalate
from homunculus.api.identity import Caller
from homunculus.api.notify import NotificationHub, Notifier
from homunculus.api.rehydrate import rehydrate
from homunculus.api.tickets import TicketStore
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
    identities: IdentityStore | None = None,
    resolve_jwt: Callable[[str], Awaitable[Caller | None]] | None = None,
    on_startup_check: Callable[[], Awaitable[None]] | None = None,
) -> FastAPI:
    """`tenants` maps bearer token -> hospital id. Escalation params are injectable for tests;
    run_escalation_loop=False disables the background task so tests are deterministic.
    `resolve_jwt`, if given, resolves a clinician's JWT to a `Caller` (hospital, actor, groups,
    permissions), letting the board routes accept a JWT as well as the tenant token and check
    permissions — injected so it can be tested without Postgres.
    `on_startup_check`, if given, runs once during lifespan startup, before the app begins
    serving — for diagnostics (e.g. TENANTS vs. the database's tenant slugs) that must never
    block boot: a failure is logged and swallowed, because a service that will not start is
    worse than one running with a fault an operator can read in the log."""
    engines: dict[str, Engine] = {}
    stores: dict[str, AckStore] = {}
    broadcaster = Broadcaster()
    notifier = Notifier()
    hub = NotificationHub()
    tickets = TicketStore()
    audit = audit or InMemoryAuditLog()
    identities = identities if identities is not None else InMemoryIdentityStore()

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
                    await broadcaster.publish(hospital, patient_board(
                        engine, pid, store, identity=identities.get(hospital, pid)))
                if added:
                    alert_by_key = {(pid, a.kind): a for (pid, a) in alerts}
                    for key in added:
                        audit.append(AuditEvent(hospital, "escalation", key[0], key[1],
                                                {"at": now.isoformat()}))
                    for note in notifier.for_escalation(hospital, added, alert_by_key):
                        await hub.publish(hospital, note)
                        audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                                {"audience": note.audience, "trigger": note.trigger}))

        # Retention: a card discharged more than DISCHARGED_TTL ago leaves the board (or keeps its
        # readings and loses its name). Every tenant this app serves is swept, engine or not — the
        # identity store is durable and outlives the engine's memory, so a tenant nobody has
        # touched since restart still owes its clients the "removed" frame.
        for hospital in set(tenants.values()) | set(engines):
            for record in identities.expired(hospital, now):
                engine = engines.get(hospital)
                if engine is not None and record.patient_id in set(engine.patient_ids()):
                    board = patient_board(engine, record.patient_id, _store(hospital))
                else:
                    board = {**identity_only_board(record), "identity": None, "removed": True}
                await broadcaster.publish(hospital, board)
        identities.prune(now)

    async def _escalation_loop() -> None:
        while True:
            await asyncio.sleep(escalate_interval)
            try:
                await _escalation_cycle(datetime.now(timezone.utc))
            except Exception:  # a bad cycle must never kill the loop
                pass

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if on_startup_check is not None:
            try:
                await on_startup_check()
            except Exception:      # a diagnostic must never stop the service from starting
                logging.getLogger(__name__).exception("tenant configuration check failed to run")
        task = asyncio.create_task(_escalation_loop()) if run_escalation_loop else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()

    app = FastAPI(title="Homunculus", lifespan=lifespan)

    # CORS: allow the deployed frontend origin(s). Set CORS_ORIGINS (comma-separated) on the host,
    # e.g. "https://homunculus-ai.vercel.app". Empty => no cross-origin access (same-origin only).
    _cors = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    if _cors:
        app.add_middleware(
            CORSMiddleware, allow_origins=_cors, allow_credentials=True,
            allow_methods=["*"], allow_headers=["*"],
        )

    # New auth + tenant subsystems (JWT/TOTP identity, physical hierarchy).
    # These live alongside the existing bearer-token → hospital_id tenancy, which
    # is preserved unchanged for backward compatibility with the ingest/board API.
    from homunculus.auth.router import router as auth_router
    from homunculus.tenant.router import router as tenant_router
    from homunculus.admission.router import (
        router as admission_router,
        sched_router as shift_schedule_router,
        handover_router,
    )
    from homunculus.escalation.router import (
        router as alerts_router,
        break_glass_router,
    )
    app.include_router(auth_router)
    app.include_router(tenant_router)
    app.include_router(admission_router)
    app.include_router(shift_schedule_router)
    app.include_router(handover_router)
    app.include_router(alerts_router)
    app.include_router(break_glass_router)

    app.state.broadcaster = broadcaster
    app.state.ack_stores = stores
    app.state.escalation_cycle = _escalation_cycle
    app.state.notifier = notifier
    app.state.notification_hub = hub
    app.state.audit = audit
    app.state.tickets = tickets

    def _tenant_from_token(token: str | None) -> str:
        hospital = tenants.get(token or "")
        if hospital is None:
            raise HTTPException(status_code=401, detail="unknown tenant token")
        return hospital

    def _stream_hospital(token: str | None, ticket: str | None) -> str:
        if ticket:
            hospital = tickets.consume(ticket, now=time.monotonic())
            if hospital is None:
                raise HTTPException(status_code=401, detail="invalid or expired ticket")
            return hospital
        return _tenant_from_token(token)

    async def _caller(authorization: str | None) -> Caller:
        """Resolve the caller from either credential.

        The static token is tried first: it is the device path, and it must not depend on the
        database being reachable for authentication. Only then is the value treated as a JWT.
        """
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        credential = authorization.split(" ", 1)[1]

        hospital = tenants.get(credential)
        if hospital is not None:
            return Caller(hospital=hospital)

        if resolve_jwt is not None:
            caller = await resolve_jwt(credential)
            if caller is not None:
                return caller

        raise HTTPException(status_code=401, detail="unknown credential")

    def _require(caller: Caller, permission: str) -> None:
        """A device passes; a clinician needs the permission in their token."""
        if not caller.can(permission):
            raise HTTPException(status_code=403, detail=f"permission required: {permission}")

    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
        hospital = (await _caller(authorization)).hospital
        kind = resource.get("resourceType")
        if kind in ("Patient", "Encounter"):
            parse = parse_fhir_patient if kind == "Patient" else parse_fhir_encounter
            try:
                incoming = parse(resource)
            except GatewayError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from None
            except (TypeError, AttributeError, KeyError, IndexError):
                raise HTTPException(status_code=400, detail="malformed identity resource") from None
            record = identities.apply(hospital, incoming)
            if record is None:
                return {"patient_id": incoming.patient_id, "identity": "stale"}
            # Demographics stay in the encrypted store, never in the audit payload.
            audit.append(AuditEvent(hospital, "identity", record.patient_id, "",
                                    {"source": record.source, "state": record.state,
                                     "resource": kind}))
            engine = _engine(hospital)
            board = (patient_board(engine, record.patient_id, _store(hospital), identity=record)
                     if record.patient_id in set(engine.patient_ids())
                     else identity_only_board(record))
            await broadcaster.publish(hospital, board)
            return {"patient_id": record.patient_id, "identity": "ok"}
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
        await broadcaster.publish(hospital, patient_board(
            engine, obs.patient_id, store, identity=identities.get(hospital, obs.patient_id)))
        # Push a notification for any newly-appeared immediate alert (nurse audience).
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, _live_keys(engine))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.post("/ack")
    async def ack(authorization: str | None = Header(default=None), body: dict = Body(...)):
        caller = await _caller(authorization)
        _require(caller, "alerts.ack")
        hospital = caller.hospital
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind = body.get("patient_id"), body.get("kind")
        # A clinician is attributed from the signed token; only the device path may name a role.
        actor = caller.actor or body.get("role", "unknown")
        if (patient_id, kind) not in _live_keys(engine):
            raise HTTPException(status_code=404, detail="no such active alert")
        store.acknowledge(patient_id, kind, actor, datetime.now(timezone.utc))
        store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        audit.append(AuditEvent(hospital, "ack", patient_id, kind,
                                {"role": actor, "groups": list(caller.groups),
                                 "at": datetime.now(timezone.utc).isoformat()}))
        board = patient_board(engine, patient_id, store,
                              identity=identities.get(hospital, patient_id))
        await broadcaster.publish(hospital, board)
        return board

    @app.post("/view")
    async def view(authorization: str | None = Header(default=None), body: dict = Body(...)):
        """Record that a clinician opened a patient — attributed from the token."""
        caller = await _caller(authorization)
        _require(caller, "board.view")
        patient_id = body.get("patient_id", "")
        audit.append(AuditEvent(caller.hospital, "view", patient_id, "",
                                {"role": caller.actor or body.get("role", "unknown"),
                                 "groups": list(caller.groups)}))
        return {"ok": True}

    @app.get("/health")
    async def health():
        """Unauthenticated liveness probe for the host's health check. `async` because it does
        no blocking work: a sync route would wait for a thread-pool worker, and a burst of
        sign-ins (bcrypt runs on worker threads) must not make the service look dead."""
        return {"status": "ok"}

    @app.get("/patients")
    async def patients(authorization: str | None = Header(default=None)):
        caller = await _caller(authorization)
        _require(caller, "board.view")
        hospital = caller.hospital
        return {"patients": board_snapshot(_engine(hospital), _store(hospital),
                                           identities=identities, hospital=hospital)}

    @app.get("/alerts/{patient_id}")
    async def alerts(patient_id: str, authorization: str | None = Header(default=None)):
        caller = await _caller(authorization)
        _require(caller, "board.view")
        hospital = caller.hospital
        active = _engine(hospital).active_alerts(patient_id)
        return {"patient_id": patient_id, "alerts": [asdict(a) for a in active]}

    @app.post("/stream-ticket")
    async def stream_ticket(authorization: str | None = Header(default=None)):
        """Exchange a credential for a short-lived, single-use SSE ticket."""
        caller = await _caller(authorization)
        _require(caller, "board.view")
        hospital = caller.hospital
        return {"ticket": tickets.issue(hospital, now=time.monotonic()), "expires_in": 60}

    @app.get("/stream")
    async def stream(token: str | None = None, ticket: str | None = None):
        hospital = _stream_hospital(token, ticket)
        queue = broadcaster.subscribe(hospital)

        async def events():
            try:
                async for frame in sse_board_frames(queue):
                    yield frame
            finally:
                broadcaster.unsubscribe(hospital, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/notifications")
    async def notifications(token: str | None = None, ticket: str | None = None, role: str = "nurse"):
        hospital = _stream_hospital(token, ticket)
        queue = hub.subscribe(hospital, role)

        async def events():
            try:
                async for frame in sse_notification_frames(queue):
                    yield frame
            finally:
                hub.unsubscribe(hospital, role, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/audit")
    async def get_audit(patient_id: str | None = None, event_type: str | None = None,
                        limit: int = 200, authorization: str | None = Header(default=None)):
        caller = await _caller(authorization)
        _require(caller, "audit.view")
        hospital = caller.hospital
        recs = audit.records(tenant=hospital, patient_id=patient_id,
                             event_type=event_type, limit=limit)
        return {"records": [asdict(r) for r in recs]}

    return app
