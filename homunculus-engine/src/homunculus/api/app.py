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
from homunculus.api.alarm_quality import alarm_quality
from homunculus.api.audit import AuditEvent, AuditLog, InMemoryAuditLog, verify_chain
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import (
    DISCHARGED_TTL, IdentityStore, InMemoryIdentityStore, parse_fhir_encounter,
    parse_fhir_patient,
)
from homunculus.api.broadcast import Broadcaster
from homunculus.api.clinical import (
    ClinicalEntryError, build_entries, profile_from_payload, profile_to_payload,
)
from homunculus.api.escalation import escalate
from homunculus.api.notify import NotificationHub, Notifier
from homunculus.api.rehydrate import rehydrate
from homunculus.api.tickets import TicketStore
from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scoring import sofa_form
from homunculus.scoring.signing import (
    ScoreSigningError, parse_overrides, sign as sign_score,
)
from homunculus.scope import Scope, ScopeReason, apply_scope, scope_report, sees_patient
from homunculus.tenant.bedmap import BedMap

logger = logging.getLogger(__name__)


async def sse_board_frames(queue: asyncio.Queue, keepalive: float = 15.0,
                           allow: Callable[[dict], bool] | None = None):
    """Yield SSE frames for boards arriving on `queue`; keep-alive comment on idle. Tested directly
    (httpx ASGITransport cannot read an unbounded stream). Cancellation (client disconnect, via
    Starlette) interrupts the wait; the caller's finally unsubscribes. Do NOT read request.receive.

    `allow` is the subscriber's scope. The broadcaster publishes one board per tenant to every
    subscriber of that tenant, so without a per-subscriber filter here the live feed would carry
    every patient in the hospital to a nurse whose `/patients` response was filtered a second
    earlier. A board that does not pass is dropped silently rather than replaced by a placeholder:
    the fact that a patient exists elsewhere in the ward is itself the thing being withheld.
    """
    while True:
        try:
            board = await asyncio.wait_for(queue.get(), timeout=keepalive)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        if allow is not None and not allow(board):
            continue
        yield f"data: {json.dumps(board)}\n\n"


async def sse_notification_frames(queue: asyncio.Queue, keepalive: float = 15.0,
                                  allow: Callable[[dict], bool] | None = None):
    """Same shape as sse_board_frames, for the /notifications stream. Tested directly."""
    while True:
        try:
            note = await asyncio.wait_for(queue.get(), timeout=keepalive)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        if allow is not None and not allow(note):
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
    bedmap: BedMap | None = None,
    resolve_jwt_hospital: Callable[[str], Awaitable[str | None]] | None = None,
    resolve_scope: Callable[[str], Awaitable[Scope]] | None = None,
    on_startup_check: Callable[[], Awaitable[None]] | None = None,
) -> FastAPI:
    """`tenants` maps bearer token -> hospital id. Escalation params are injectable for tests;
    run_escalation_loop=False disables the background task so tests are deterministic.
    `resolve_jwt_hospital`, if given, resolves a clinician's JWT to a hospital id (decode ->
    load user -> membership -> tenant slug), letting the board routes accept a JWT as well as
    the tenant token — injected so it can be tested without Postgres.
    `resolve_scope`, if given, turns a caller's credential into the set of beds they may see
    (`homunculus.scope`). Injected for the same reason as the hospital resolver: the decision is
    testable without Postgres, and a deployment that has not wired it keeps today's behaviour —
    every authenticated caller sees the whole hospital. That default is the honest one for a
    pilot with no assignments in the database, and the route says which of the two it is doing
    rather than leaving a screen to guess.
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
    # No table is a working state, not an error: every location comes back unmatched and counted,
    # every patient still gets a card, and the discovery report is what tells the operator the
    # table has yet to be written.
    bedmap = bedmap if bedmap is not None else BedMap()

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
                        engine, pid, store, identity=identities.get(hospital, pid),
                        bedmap=bedmap))
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
                    board = patient_board(engine, record.patient_id, _store(hospital),
                                          bedmap=bedmap)
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
    from homunculus.scope.router import router as scope_router
    # The device-research window: same origin, role-gated, credential held server-side.
    # Off unless INFINITY_HUB_URL / _VIEWER_TOKEN / _HUB_CA_FILE are all set.
    from homunculus.api.infinity_research import router as infinity_research_router
    app.include_router(auth_router)
    app.include_router(tenant_router)
    app.include_router(admission_router)
    app.include_router(shift_schedule_router)
    app.include_router(handover_router)
    app.include_router(alerts_router)
    app.include_router(break_glass_router)
    app.include_router(scope_router)
    app.include_router(infinity_research_router)

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

    def _stream_hospital(token: str | None, ticket: str | None) -> tuple[str, Scope]:
        """The hospital and the scope a stream is opened under.

        The `token` branch is the machine one — a static tenant token in the query string, used
        by the wall board — and carries no user, so it streams the hospital unscoped, exactly as
        `_scope` treats the same credential on every other route.
        """
        if ticket:
            entry = tickets.consume(ticket, now=time.monotonic())
            if entry is None:
                raise HTTPException(status_code=401, detail="invalid or expired ticket")
            return entry
        return _tenant_from_token(token), _UNSCOPED

    async def _hospital(authorization: str | None) -> str:
        """Resolve the caller's hospital from either credential.

        The static token is tried first: it is the device path, and it must not depend on the
        database being reachable for authentication. Only then is the value treated as a JWT.
        """
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        credential = authorization.split(" ", 1)[1]

        hospital = tenants.get(credential)
        if hospital is not None:
            return hospital

        if resolve_jwt_hospital is not None:
            hospital = await resolve_jwt_hospital(credential)
            if hospital is not None:
                return hospital

        raise HTTPException(status_code=401, detail="unknown credential")

    _UNSCOPED = Scope(True, ScopeReason.TENANT_TOKEN)

    async def _scope(authorization: str | None) -> Scope:
        """What the caller may see.

        The static tenant token is unscoped by design and not by omission: it is a machine's
        credential — the bridge, the wall board in the corridor — and there is no user behind it
        whose assignment could be looked up. Narrowing it would blank the wall board and stop the
        bridge, and it would narrow nothing that a person holds.

        With no resolver wired, every caller is unscoped. That is today's behaviour, kept
        deliberately: the pilot's database has no assignments in it, so enforcing scope the day
        this ships would empty every clinical screen in the hospital at once.
        """
        if resolve_scope is None:
            return _UNSCOPED
        credential = (authorization or "").removeprefix("Bearer ")
        if credential in tenants:
            return _UNSCOPED
        return await resolve_scope(credential)

    async def _require_patient(authorization: str | None, hospital: str, patient_id: str) -> None:
        """Refuse a single-patient route the caller's scope does not reach.

        Every route that names a patient in its path or body goes through here. Filtering only
        the board would be theatre: the board is a list of ids, and a caller who has one — from
        yesterday's shift, from a screenshot, by trying — reaches the patient through
        `/alerts`, `/clinical` or the score routes with the list never involved.

        404 rather than 403. A 403 confirms that this patient exists and is under care here,
        which is precisely the fact being withheld; answering the way an unknown id answers
        tells the caller nothing they did not already supply.

        The refusal is audited. An attempt to read outside one's own scope is exactly the event
        an inspection asks for, and a log holding only the successful reads cannot produce it.
        """
        scope = await _scope(authorization)
        if scope.unrestricted:
            return
        board = patient_board(_engine(hospital), patient_id, _store(hospital),
                              identity=identities.get(hospital, patient_id), bedmap=bedmap)
        if sees_patient(board, scope):
            return
        audit.append(AuditEvent(hospital, "scope_denied", patient_id, scope.reason,
                                {"units": sorted(scope.unit_ids), "beds": sorted(scope.bed_ids)}))
        raise HTTPException(status_code=404, detail="hasta bulunamadı")

    def _charted_by(authorization: str | None) -> str:
        """Who charted this, for the audit record.

        A clinician's JWT names them; the static tenant token does not (it is the bridge's
        credential, shared by a machine). Rather than invent an author, the token path is
        recorded as exactly what it is — an entry nobody can be asked about later.
        """
        credential = (authorization or "").removeprefix("Bearer ")
        if credential in tenants:
            return "tenant-token"
        try:
            from homunculus.auth.jwt import decode_token
            return str(decode_token(credential).get("sub") or "unknown")
        except Exception:
            # _hospital has already authenticated the caller by this point; failing to name
            # them must not lose the clinical fact they charted.
            return "unknown"

    @app.post("/clinical/{patient_id}")
    async def chart(patient_id: str, body: dict = Body(...),
                    authorization: str | None = Header(default=None)):
        """Record what a clinician observed — the inputs no device produces.

        This is the door `suspected_infection` comes through, and with it the whole sepsis
        branch: until something charts it, `septic_shock.evaluate` returns at its first line.
        """
        hospital = await _hospital(authorization)
        await _require_patient(authorization, hospital, patient_id)
        stamp = body.get("recorded_at")
        try:
            recorded_at = datetime.fromisoformat(stamp) if stamp else None
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="geçersiz recorded_at") from None

        try:
            charted = build_entries(patient_id, body.get("entries") or [],
                                    charted_by=_charted_by(authorization),
                                    recorded_at=recorded_at)
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        engine = _engine(hospital)
        store = _store(hospital)
        alerts: list = []
        for item in charted:
            obs = item.observation
            alerts = engine.ingest(obs, now=obs.timestamp)
            audit.append(AuditEvent(hospital, "chart", obs.patient_id, obs.code.value,
                                    {"value": obs.value, "unit": obs.unit,
                                     "obs_ts": obs.timestamp.isoformat(),
                                     "charted_by": item.charted_by}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency,
                                     "summary": a.summary, "source": a.source,
                                     "evidence": a.supporting_evidence}))
        # First-seen uses WALL-CLOCK time, and is AUDITED — the /ingest path already does both and
        # this one only did the first half. Two things were quietly lost by that: an alert raised
        # from a clinician's charting was invisible to the alarm-quality report (no episode to
        # count), and, worse, `rehydrate` had no row to replay, so a restart handed such an alert a
        # fresh escalation clock. An alarm that had gone unanswered for four minutes started its
        # five-minute grace over again after a deploy, and nothing looked broken.
        now = datetime.now(timezone.utc)
        for pid, kind in _live_keys(engine):
            if store.stamp_first_seen(pid, kind, now):
                audit.append(AuditEvent(hospital, "first_seen", pid, kind,
                                        {"at": now.isoformat()}))

        board = patient_board(engine, patient_id, store,
                              identity=identities.get(hospital, patient_id), bedmap=bedmap)
        await broadcaster.publish(hospital, board)
        return {"patient_id": patient_id, "charted": len(charted),
                "alerts": [a.kind for a in alerts]}

    @app.put("/clinical/{patient_id}/profile")
    async def set_patient_profile(patient_id: str, body: dict = Body(...),
                                  authorization: str | None = Header(default=None)):
        """The patient's own normal: charted comorbidities and baseline vital ranges.

        This is the input the patient-relative layer has been waiting for since it was written.
        Without it every patient is scored against the population threshold, so a chronic-AF
        patient living at 105 bpm alarms on every measurement — the alarm fatigue the layer
        exists to prevent. The boundary is always the clinician's; we never mint one.
        """
        hospital = await _hospital(authorization)
        await _require_patient(authorization, hospital, patient_id)
        engine = _engine(hospital)
        try:
            # Merged over what is already charted, not replacing it: the admission form and the
            # sepsis panel write to this same door with different halves of the profile.
            profile = profile_from_payload(patient_id, body, engine.profile(patient_id))
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        engine.set_profile(profile)
        # Audited so a restart can replay it. A profile a deploy forgot would restart the
        # alarms it was written to quieten, without anything looking broken.
        audit.append(AuditEvent(hospital, "profile", profile.patient_id, "",
                                {**profile_to_payload(profile),
                                 "charted_by": _charted_by(authorization)}))

        board = patient_board(engine, patient_id, _store(hospital),
                              identity=identities.get(hospital, patient_id), bedmap=bedmap)
        await broadcaster.publish(hospital, board)
        return {"patient_id": profile.patient_id, **profile_to_payload(profile)}

    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
        hospital = await _hospital(authorization)
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
            board = (patient_board(engine, record.patient_id, _store(hospital), identity=record,
                                   bedmap=bedmap)
                     if record.patient_id in set(engine.patient_ids())
                     else identity_only_board(record, bedmap))
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
            engine, obs.patient_id, store, identity=identities.get(hospital, obs.patient_id),
            bedmap=bedmap))
        # Push a notification for any newly-appeared immediate alert (nurse audience).
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, _live_keys(engine))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.post("/ack")
    async def ack(authorization: str | None = Header(default=None), body: dict = Body(...)):
        hospital = await _hospital(authorization)
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind = body.get("patient_id"), body.get("kind")
        role = body.get("role", "unknown")
        await _require_patient(authorization, hospital, str(patient_id or ""))
        if (patient_id, kind) not in _live_keys(engine):
            raise HTTPException(status_code=404, detail="no such active alert")
        store.acknowledge(patient_id, kind, role, datetime.now(timezone.utc))
        store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        audit.append(AuditEvent(hospital, "ack", patient_id, kind,
                                {"role": role, "at": datetime.now(timezone.utc).isoformat()}))
        board = patient_board(engine, patient_id, store,
                              identity=identities.get(hospital, patient_id), bedmap=bedmap)
        await broadcaster.publish(hospital, board)
        return board

    @app.post("/view")
    async def view(authorization: str | None = Header(default=None), body: dict = Body(...)):
        """Record that a clinician opened a patient. Attribution is role-level (no per-user login yet)."""
        hospital = await _hospital(authorization)
        patient_id = body.get("patient_id", "")
        # Guarded too, though it only writes a log line. A caller who can record "I opened this
        # patient" for a patient they may not open puts a false entry in the one record an
        # inspection trusts — and this route's whole purpose is that record.
        await _require_patient(authorization, hospital, str(patient_id or ""))
        audit.append(AuditEvent(hospital, "view", patient_id, "",
                                {"role": body.get("role", "unknown")}))
        return {"ok": True}

    @app.get("/health")
    def health():
        """Unauthenticated liveness probe for the host's health check."""
        return {"status": "ok"}

    @app.get("/patients")
    async def patients(authorization: str | None = Header(default=None)):
        """The ward, narrowed to what this caller may see — and told why it is that size.

        `scope` travels with the patients rather than being left for the screen to infer. An
        empty board and a quiet ward are the same picture; only this block can tell them apart,
        and a nurse who cannot tell them apart is the failure this whole change exists to
        prevent.
        """
        hospital = await _hospital(authorization)
        scope = await _scope(authorization)
        result = apply_scope(
            board_snapshot(_engine(hospital), _store(hospital), identities=identities,
                           hospital=hospital, bedmap=bedmap),
            scope,
        )
        if result.blind:
            # Not a 403 and not an error: the caller is authenticated and the request is valid.
            # It goes in the log because an administrator hunting "the nurses see nothing" should
            # find it on the server, not only in a screenshot from the ward.
            logger.warning("scope yielded an empty board for a %s caller in %s (grants: %s)",
                           scope.reason, hospital, ", ".join(result.unmatched_grants) or "none")
        return {"patients": result.boards,
                "scope": result.as_dict(),
                "scope_note": scope_report(result)}

    @app.get("/alerts/{patient_id}")
    async def alerts(patient_id: str, authorization: str | None = Header(default=None)):
        hospital = await _hospital(authorization)
        await _require_patient(authorization, hospital, patient_id)
        active = _engine(hospital).active_alerts(patient_id)
        return {"patient_id": patient_id, "alerts": [asdict(a) for a in active]}

    @app.post("/stream-ticket")
    async def stream_ticket(authorization: str | None = Header(default=None)):
        """Exchange a credential for a short-lived, single-use SSE ticket.

        The scope is resolved **here**, while the caller is still presenting a credential, and
        bound to the ticket. It cannot be resolved at `/stream` time: `EventSource` sends no
        headers, so by then the only thing identifying the caller is the ticket itself. Without
        this binding the board would be filtered on request and unfiltered on the live feed —
        a filter that any patient's next observation walks straight past.
        """
        hospital = await _hospital(authorization)
        scope = await _scope(authorization)
        return {"ticket": tickets.issue(hospital, now=time.monotonic(), scope=scope),
                "expires_in": 60}

    @app.get("/stream")
    async def stream(token: str | None = None, ticket: str | None = None):
        hospital, scope = _stream_hospital(token, ticket)
        queue = broadcaster.subscribe(hospital)

        async def events():
            try:
                async for frame in sse_board_frames(queue, allow=lambda b: sees_patient(b, scope)):
                    yield frame
            finally:
                broadcaster.unsubscribe(hospital, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/notifications")
    async def notifications(token: str | None = None, ticket: str | None = None, role: str = "nurse"):
        hospital, scope = _stream_hospital(token, ticket)
        queue = hub.subscribe(hospital, role)

        def allow(note: dict) -> bool:
            """A notification names a patient, so it is scoped like anything else that does.

            Its body is `"{patient_id}: {summary}"`, which means letting an out-of-scope
            notification through would hand over the identifier *and* the finding — more than
            the board itself would have shown.
            """
            if scope.unrestricted:
                return True
            pid = str(note.get("patient_id") or "")
            return sees_patient(
                patient_board(_engine(hospital), pid, _store(hospital),
                              identity=identities.get(hospital, pid), bedmap=bedmap),
                scope,
            )

        async def events():
            try:
                async for frame in sse_notification_frames(queue, allow=allow):
                    yield frame
            finally:
                hub.unsubscribe(hospital, role, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.get("/audit")
    async def get_audit(patient_id: str | None = None, event_type: str | None = None,
                        limit: int = 200, authorization: str | None = Header(default=None)):
        hospital = await _hospital(authorization)
        if patient_id:
            # Asking the audit log about one patient is asking about that patient. The trail
            # carries no PHI, but it does carry who was alerted about whom and when, which is
            # the same question the board answers and must get the same answer.
            await _require_patient(authorization, hospital, patient_id)
        elif not (await _scope(authorization)).unrestricted:
            # The unfiltered trail spans every bed in the hospital. It is an administrator's and
            # an auditor's view, and narrowing it per bed would produce a partial record that
            # reads like a whole one — worse than refusing.
            raise HTTPException(status_code=403,
                                detail="denetim kaydının tamamı kapsam dışı; bir patient_id verin")
        recs = audit.records(tenant=hospital, patient_id=patient_id,
                             event_type=event_type, limit=limit)
        return {"records": [asdict(r) for r in recs]}

    @app.get("/scores/sofa/{patient_id}")
    async def sofa_severity_form(patient_id: str, hours: float = 24,
                                 authorization: str | None = Header(default=None)):
        """The SOFA severity form, filled from the record.

        Not the SOFA the alerting rules use. That one reads the latest values and asks whether the
        patient is deteriorating now; this one reads the WORST values of the window and asks how
        sick they were over it — which is what the hospital's paper form is scored on, and what a
        physician currently reconstructs by reading back through a chart.

        It comes back unsigned and it raises nothing. A prognostic score used as an alarm source
        is a documented clinical failure, and a severity score entering quality reporting with no
        clinician behind it is the other one.
        """
        hospital = await _hospital(authorization)
        await _require_patient(authorization, hospital, patient_id)
        engine = _engine(hospital)
        record = identities.get(hospital, patient_id)
        form = sofa_form.build(
            engine.state(patient_id), datetime.now(timezone.utc),
            window=timedelta(hours=max(1.0, min(float(hours), 168.0))),
            admitted_at=getattr(record, "admitted_at", None),
        )
        audit.append(AuditEvent(hospital, "score", patient_id, "SOFA",
                                {"total": form.total, "window_hours": form.window_hours,
                                 "unmeasured": form.unmeasured_organs,
                                 "read_by": _charted_by(authorization)}))
        return form.as_dict()

    @app.post("/scores/sofa/{patient_id}")
    async def sign_sofa_form(patient_id: str, body: dict = Body(...), hours: float = 24,
                             authorization: str | None = Header(default=None)):
        """Sign a SOFA severity form, with the clinician's corrections.

        The form arrives pre-filled, which is the product's value and also its risk: a number that
        appeared on its own is a number nobody checked. This is where a person takes responsibility
        for it.

        A correction replaces the VALUE and the row is re-scored from the table — a clinician says
        "the platelet count was 38", never "this row scores 2". Both numbers are kept, because a
        pattern of corrections on one parameter is exactly the signal that a feed is wrong, and an
        override that erased the original would destroy the only evidence of it.

        The signature goes into the append-only audit and is sealed into its hash chain, so the
        record of who signed what cannot later be edited quietly.
        """
        hospital = await _hospital(authorization)
        await _require_patient(authorization, hospital, patient_id)
        engine = _engine(hospital)
        signed_by = _charted_by(authorization)
        now = datetime.now(timezone.utc)
        window = timedelta(hours=max(1.0, min(float(hours), 168.0)))
        record = identities.get(hospital, patient_id)
        admitted = getattr(record, "admitted_at", None)
        state = engine.state(patient_id)

        # Built twice on purpose: `auto` is what the record alone produced, `rebuilt` is what the
        # clinician is signing. The difference is the audit trail of the correction.
        auto = sofa_form.build(state, now, window=window, admitted_at=admitted)
        try:
            overrides = parse_overrides(body.get("overrides"), auto)
        except ScoreSigningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        rebuilt = sofa_form.build(state, now, window=window, admitted_at=admitted,
                                  overrides={o.code: o.value for o in overrides})
        try:
            signed = sign_score(auto, rebuilt, signed_by=signed_by, overrides=overrides, now=now)
        except ScoreSigningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        audit.append(AuditEvent(hospital, "score_signed", patient_id, "SOFA", {
            "total": signed.total,
            "auto_total": auto.total,
            "window_hours": rebuilt.window_hours,
            "unmeasured": rebuilt.unmeasured_organs,
            "overrides": [o.as_dict() for o in overrides],
            "signed_by": signed_by,
            "at": now.isoformat(),
        }))
        return signed.as_dict()

    @app.get("/alarm-quality")
    async def get_alarm_quality(days: int = 7, limit: int = 20000,
                                authorization: str | None = Header(default=None)):
        """Of the alarms this system raised, how many did a human answer, and how fast?

        The number the product's whole premise rests on, and nothing computed it. Read from the
        audit log rather than from `AckStore` because the store is live state that a restart
        empties — a quality figure quoted to a hospital has to come from the durable record.
        """
        hospital = await _hospital(authorization)
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=max(1, days))
        recs = [r for r in audit.records(tenant=hospital, limit=limit)
                if (r.ts or "") >= since.isoformat()]
        report = alarm_quality(recs, now)
        return {**report.as_dict(), "days": days}

    @app.get("/audit/verify")
    async def verify_audit(limit: int = 10000, authorization: str | None = Header(default=None)):
        """Has this hospital's audit log been altered?

        Recomputes every seal from the genesis hash forward and names the first record that fails.
        Deliberately unfiltered: a chain can only be verified as the complete run for one tenant,
        because a filtered slice is missing its own predecessors by construction and would report a
        break that is not there. `limit` bounds the work, and the response says how far it got so a
        partial verification is never mistaken for a whole one.
        """
        hospital = await _hospital(authorization)
        recs = audit.records(tenant=hospital, limit=limit)
        report = verify_chain(recs)
        return {**report.as_dict(), "records": len(recs), "complete": len(recs) < limit}

    return app
