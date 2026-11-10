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
import math
import os
import re
import secrets
import time
from collections.abc import Awaitable, Callable, Iterable
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from homunculus.api.ackstore import AckStore
from homunculus.api.alarm_quality import EPISODE_KINDS, alarm_quality
from homunculus.api.alert_lifecycle import (
    Cleared, DISCHARGED, READING_DROPPED, acknowledge_latched, entered_in_error_latches, is_tombstone,
    live_keys, retire_patient, retire_state, sync_alerts,
)
from homunculus.api.audit import (
    AuditEvent, AuditLog, InMemoryAuditLog, iter_records, iter_records_of, verify_chain,
)
from homunculus.api.board import (
    _news2, board_snapshot, freshness_turned, identity_only_board, patient_board, tombstone_board,
)
from homunculus.api.patient_identity import (
    DISCHARGED_TTL, KABUL, IdentityStore, InMemoryIdentityStore, parse_fhir_encounter,
    parse_fhir_patient,
)
from homunculus.api.broadcast import Broadcaster
from homunculus.api.clinical import (
    GCS_NOT_WHOLE, PLAUSIBLE, RETRACT, RETRACT_ALREADY, RETRACT_DISCHARGED, RETRACT_MAX_REASON_CHARS,
    RETRACT_MIN_REASON_CHARS, RETRACT_NEEDS_PERSON, RETRACT_NOT_BEDSIDE, RETRACT_REASON_LONG, RETRACT_REASON_SHORT,
    RETRACT_UNKNOWN, RETRACTABLE_CODES, ClinicalEntryError, build_entries,
    chart_observations, profile_from_payload, profile_to_payload,
)
from homunculus.api.escalation import escalate
from homunculus.api.identity import Caller, bounded_role
from homunculus.api.infinity_device_beds import DeviceBedSource, TableFile
from homunculus.api.infinity_rules import ShadowLane
from homunculus.api.infinity_shadow import (
    MAX_BODY as SHADOW_MAX_BODY, MIN_TOKEN as SHADOW_MIN_TOKEN, ShadowRejected, ShadowSettings, ShadowStore,
    TooSoon, board_view,
)
from homunculus.api.monitor_samples import InMemorySamples, SampleStore, is_missing_table, retention_bound
from homunculus.api.notify import NotificationHub, Notifier
from homunculus.api.rehydrate import (
    REBUILD_EVENTS, observation_of, rebuild_patient, rehydrate, retracted_entries,
)
from homunculus.api.fluids import patient_fluids                  # G3-03
from homunculus.api.tasks import DEFAULT_SETTINGS as DEFAULT_TASK_SETTINGS
from homunculus.api.tasks import InMemoryTaskStore, TaskStore, tasks_router, zone_of
from homunculus.api.tickets import TicketStore
from homunculus.api.trends import TRENDS_HOURS, patient_trends
from homunculus.admission.boardlink import BoardLink    # G2-B1a
from homunculus.auth.permissions import validate_permissions
from homunculus.canonical import SignalCode
from homunculus.gateway.fhir import PATIENT_ID_MAX, GatewayError, parse_fhir_observation
from homunculus.pipeline import Engine
from homunculus.scoring import sofa_form
from homunculus.scoring.signing import (
    MIN_REASON_CHARS, Override, ScoreSigningError, SignedScore, form_digest, parse_overrides,
    sign as sign_score,
)
from homunculus.scope import (
    Scope, ScopeReason, ScopeResult, apply_scope, normalise_id, scope_report, sees_patient,
)
from homunculus.scope.resolver import UNKNOWN as UNKNOWN_SCOPE
from homunculus.state.timeline import PatientState
from homunculus.tenant.bedmap import BedMap

if TYPE_CHECKING:
    from homunculus.auth.ldap import LdapRuntime

log = logging.getLogger(__name__)

# The board's permission keys, checked against the catalogue when this module is imported. A
# typo here would otherwise refuse every clinician on that route with a 403, and nothing else
# would complain.
BOARD_VIEW, ALERTS_ACK, AUDIT_VIEW, CLINICAL_CHART, SCORES_SIGN, DEVICES_MANAGE = validate_permissions(
    ("board.view", "alerts.ack", "audit.view", "clinical.chart", "scores.sign", "devices.manage"))
(ALERTS_ESCALATE,) = validate_permissions(("alerts.escalate",))   # G2-B5: «RRT çağır»

#: Aşama A: a patient's admitted beds are re-read for the monitor strip at most this often.
SHADOW_OCCUPANCY_CACHE_S = 10.0

DEVICE_ROLE_MAX = 64
#: G2-B5 (D3): a call's reason, trimmed — enough to say why, short enough for a card.
RRT_REASON_MIN, RRT_REASON_MAX = 3, 500
# PATIENT_ID_MAX is the gateway's since G2-A2 (D14): a body's id and an ingested one are capped alike (bodies are not stripped).

#: The windows GET /patients/{id}/trends accepts, as the text the query string carries. The route
#: reads `hours` as text so that any other value is its own 400 rather than FastAPI's 422.
TREND_WINDOWS_TEXT = frozenset(str(h) for h in TRENDS_HOURS)
#: The windows GET /infinity-shadow/findings accepts (`days`, 1–7), as text for the same reason.
SHADOW_FINDINGS_DAYS_TEXT = frozenset(str(d) for d in range(1, 8))

#: G2-A2 (D12): the most rows one `/audit` answer carries — the newest; the most `/alarm-quality`
#: reads for its window (it says `truncated` when the window held more); and the rows a restart
#: replays per read — every row is replayed, a page at a time.
AUDIT_LIMIT_MAX = 1000
ALARM_QUALITY_LIMIT_MAX = 20000
REHYDRATE_PAGE = 5000
#: Spec 2026-11-01: the most records one `/audit/verify` reads — one read under the audit's read
#: bound, re-hashed on the event loop. A larger `limit` is clamped, and the answer says
#: `complete: false` when the tenant's trail held more, as for any partial run.
AUDIT_VERIFY_LIMIT_MAX = 50000

#: G2-A4 review: the slip bounds a SOFA correction is held to — the charting door's PLAUSIBLE. G3-01 (X7): MAP,
#: once an extra bound here (the door did not take it), is in PLAUSIBLE now with the same 0–300 mmHg. An
#: engineering slip bound against a slipped digit (9000 for 90) or a unit, never a clinical threshold — the
#: SOFA table stays the only judge of a value.
CORRECTION_BOUNDS = PLAUSIBLE

#: G2-A4 (D12, X20): the shape of a preview's fingerprint (`scoring/signing.py` `form_digest`) — SHA-256 as
#: 64 lowercase hex digits. A signature without one is refused before any fingerprint is compared.
FORM_DIGEST_SHAPE = re.compile(r"[0-9a-f]{64}")


def _recorded_at(body: dict) -> datetime | None:
    """A charting request's measurement time, or None for the server's clock (G3-01: the door and its
    preview read it alike)."""
    stamp = body.get("recorded_at")
    try:
        return datetime.fromisoformat(stamp) if stamp else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="geçersiz recorded_at") from None


@dataclass(frozen=True)
class _SofaToSign:
    """What the SOFA preview and the signature share (G2-A4, X19): who asks, when, the form the record
    alone fills (`auto`), the form with the clinician's corrections (`rebuilt`), the corrections, and the
    signature `sign_score` would seal. Built by one helper, so the two routes cannot drift."""
    hospital: str
    signed_by: str
    now: datetime
    auto: sofa_form.SofaForm
    rebuilt: sofa_form.SofaForm
    overrides: list[Override]
    signed: SignedScore


def _refuse_fractional_gcs(payload: object) -> None:
    """G2-A4 review: a GCS correction is a whole number, as a charted GCS is (api/clinical.py `_value`),
    refused 400 in the door's sentence. Only a finite number that is not whole is refused here; any other
    shape or value is left to `parse_overrides`, which refuses it in its own words."""
    if not isinstance(payload, (list, tuple)):
        return
    for entry in payload:
        if not isinstance(entry, dict) or str(entry.get("code") or "").strip() != SignalCode.GCS.value:
            continue
        try:
            value = float(entry.get("value"))
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and not value.is_integer():
            raise HTTPException(status_code=400, detail=GCS_NOT_WHOLE)


def _device_role(value: object) -> str:
    """The device path's self-declared `role`: `bounded_role` with the tighter DEVICE_ROLE_MAX,
    since no signed-in name stands behind it. It lands in the audit row and, through `rehydrate`,
    in the board's `acknowledged_by`."""
    return bounded_role(value, DEVICE_ROLE_MAX)


#: The board stream's heartbeat: a NAMED event, sent with the keep-alive comment. EventSource never
#: hands a comment to the page, so without an event the client cannot tell a quiet ward from a
#: half-open connection that will never deliver again (and would read LIVE for ever). Named, so a
#: reader of unnamed `message` events only — the old workspace, the mobile app — never sees it.
HEARTBEAT_FRAME = "event: heartbeat\ndata: {}\n\n"


class ScopedBoardView:
    """What one scoped subscriber of the board stream is sent for each board (G2 borç 1): the board
    when it is in the scope, a removal when it is not and its patient is one this subscriber holds a
    card for, otherwise nothing.

    Dropping every board outside the scope left a card on a scoped screen for good once its patient
    left the scope — a HIS transfer to another unit, a HIS discharge (which frees the bed), a removal
    that knows no last place: the patient's next board lies outside the scope, and no frame ever
    told the screen the card was gone, though a reload no longer showed it.

    So the view remembers whom this subscriber holds a card for: `shown`, the patients in scope when
    the stream opened (the dashboard reloads the board on every open), and every patient sent since.
    One who leaves the scope is sent ONCE as a removal carrying the id alone — the id the screen
    already holds, never where the patient went. A patient this subscriber never held stays
    withheld, as before: that a patient exists elsewhere in the ward is itself the thing withheld.
    """

    def __init__(self, scope: Scope, shown: Iterable[str] = ()) -> None:
        self._scope = scope
        self._shown = set(shown)

    def __call__(self, board: dict) -> dict | None:
        patient_id = str(board.get("patient_id") or "")
        if sees_patient(board, self._scope):
            if board.get("removed"):
                self._shown.discard(patient_id)
            else:
                self._shown.add(patient_id)
            return board
        if patient_id in self._shown:
            self._shown.discard(patient_id)
            return {"patient_id": patient_id, "removed": True, "identity": None}
        return None


async def sse_board_frames(queue: asyncio.Queue, keepalive: float = 15.0,
                           allow: Callable[[dict], bool] | None = None,
                           view: Callable[[dict], dict | None] | None = None):
    """Yield SSE frames for boards arriving on `queue`; on idle, a keep-alive comment and then
    HEARTBEAT_FRAME. Tested directly (httpx ASGITransport cannot read an unbounded stream).
    Cancellation (client disconnect, via Starlette) interrupts the wait; the caller's finally
    unsubscribes. Do NOT read request.receive.

    `allow` is a scope as a plain filter. The broadcaster publishes one board per tenant to every
    subscriber of that tenant, so without a per-subscriber filter here the live feed would carry
    every patient in the hospital to a nurse whose `/patients` response was filtered a second
    earlier. A board that does not pass is dropped silently rather than replaced by a placeholder:
    the fact that a patient exists elsewhere in the ward is itself the thing being withheld.
    `view` is what `/stream` passes a scoped subscriber (`ScopedBoardView`): the frame this
    subscriber is sent for the board, or None — the filter, and the removal of a card whose patient
    left the scope (G2 borç 1).

    Idle means nothing SENT to this subscriber for `keepalive` seconds — not an empty queue: a
    nurse scoped to a quiet unit of a busy hospital is sent none of the boards the queue keeps
    bringing, and still gets her heartbeat (the dashboard drops a stream silent for three of them).
    """
    loop = asyncio.get_running_loop()
    last_sent = loop.time()
    while True:
        wait = keepalive - (loop.time() - last_sent)
        if wait <= 0:
            yield ": keep-alive\n\n"
            yield HEARTBEAT_FRAME
            last_sent = loop.time()
            continue
        try:
            board = await asyncio.wait_for(queue.get(), timeout=wait)
        except asyncio.TimeoutError:
            continue
        if allow is not None and not allow(board):
            continue
        frame = board if view is None else view(board)
        if frame is None:
            continue
        yield f"data: {json.dumps(frame)}\n\n"
        last_sent = loop.time()


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


async def _check_directory_at_startup(runtime: LdapRuntime) -> None:
    """Spec §9: one service-account bind at start-up, logged; never raises."""
    from homunculus.auth.ldap import check_directory_at_startup

    try:
        await check_directory_at_startup(runtime)
    except Exception:          # a diagnostic must never take anything down
        log.exception("the directory start-up check failed to run")


def create_app(
    tenants: dict[str, str],
    *,
    escalate_after: timedelta = timedelta(minutes=5),
    escalate_interval: float = 20.0,
    run_escalation_loop: bool = True,
    audit: AuditLog | None = None,
    identities: IdentityStore | None = None,
    resolve_jwt: Callable[[str], Awaitable[Caller | None]] | None = None,
    bedmap: BedMap | None = None,
    resolve_scope: Callable[[str], Awaitable[Scope]] | None = None,
    on_startup_check: Callable[[], Awaitable[None]] | None = None,
    ldap: LdapRuntime | None = None,
    shadow: ShadowSettings | None = None,
    shadow_clock: Callable[[], float] = time.time,
    shadow_monotonic: Callable[[], float] | None = None,
    samples: SampleStore | None = None,
    device_beds: DeviceBedSource | None = None,
    tasks: TaskStore | None = None,
) -> FastAPI:
    """`tenants` maps bearer token -> hospital id. Escalation params are injectable for tests;
    run_escalation_loop=False disables the background task so tests are deterministic.
    `resolve_jwt`, if given, resolves a clinician's JWT to a `Caller` (hospital, actor, groups,
    permissions), letting the board routes accept a JWT as well as the tenant token and check
    permissions — injected so it can be tested without Postgres.
    `resolve_scope`, if given, turns a caller's credential into the set of beds they may see
    (`homunculus.scope`). Injected for the same reason as the JWT resolver: the decision is
    testable without Postgres, and a deployment that has not wired it keeps today's behaviour —
    every authenticated caller sees the whole hospital. That default is the honest one for a
    pilot with no assignments in the database, and the route says which of the two it is doing
    rather than leaving a screen to guess.
    `on_startup_check`, if given, runs once during lifespan startup, before the app begins
    serving — for diagnostics (e.g. TENANTS vs. the database's tenant slugs) that must never
    block boot: a failure is logged and swallowed, because a service that will not start is
    worse than one running with a fault an operator can read in the log.
    `ldap`, if given, is the directory (LDAP / Active Directory, spec §7) and becomes
    `app.state.ldap`; None leaves AD sign-in off — AD accounts get 503, /admin/ldap/* 409.
    `shadow` is Aşama A's monitor strip (`api/infinity_shadow.py`); None is the stage `off`, so
    every existing caller is unchanged. `shadow_clock` is the lane's wall clock (epoch seconds) and
    `shadow_monotonic` its own spacing-and-silence clock (ShadowStore), both injected by the tests;
    the engine never reads either.
    `device_beds` is the device→bed table the strip reads (G2-ESLEME, spec D6): `PostgresDeviceBeds`
    in production; None reads the file at `shadow.table_path` (the lab).
    `samples` is Aşama B's monitor-sample table
    (`api/monitor_samples.py`, migration 0013); None keeps them in memory, which is all a stage
    below `rules` ever needs (it writes none). A durable store is pruned at every stage, so the
    rows of a `rules` run still expire after a rollback below it.
    At shutdown the lifespan releases `audit`, `identities`, `samples` and `device_beds`
    (`dispose`, `close`): an engine's pool reopens on its next use, but SQLite's identity file
    stays closed."""
    # A device token is a non-empty string. A missing token reads as "" further down, so an empty
    # key in this map would let a request with no credential at all in as that hospital's device.
    empty = [hospital for token, hospital in tenants.items()
             if not isinstance(token, str) or not token.strip()]
    if empty:
        log.warning("ignoring an empty device token configured for hospital(s) %s",
                    ", ".join(sorted(map(str, empty))))
    tenants = {token: hospital for token, hospital in tenants.items()
               if isinstance(token, str) and token.strip()}
    # A device is a `Caller`, and a `Caller` needs a hospital: a token naming none is dropped here,
    # once, rather than answering 500 on every request it makes. The warning names no token.
    nowhere = [token for token, hospital in tenants.items()
               if not isinstance(hospital, str) or not hospital.strip()]
    if nowhere:
        log.warning("ignoring %d device token(s) configured with no hospital", len(nowhere))
    tenants = {token: hospital for token, hospital in tenants.items() if token not in nowhere}

    engines: dict[str, Engine] = {}
    stores: dict[str, AckStore] = {}
    broadcaster = Broadcaster()
    notifier = Notifier()
    hub = NotificationHub()
    tickets = TicketStore()
    audit = audit or InMemoryAuditLog()
    identities = identities if identities is not None else InMemoryIdentityStore()
    tasks = tasks if tasks is not None else InMemoryTaskStore()      # G3-02: the task queue's rows
    # No table is a working state, not an error: every location comes back unmatched and counted,
    # every patient still gets a card, and the discovery report is what tells the operator the
    # table has yet to be written.
    bedmap = bedmap if bedmap is not None else BedMap()

    # Aşama A — the unvalidated monitor strip. Its own memory and its own table; it holds no
    # reference to the engine, the audit, the broadcaster, the notification hub or the identity
    # store's writes (tests/test_infinity_shadow_isolation.py). With the stage on, the table is
    # read right here, so its version and sha256 (or why it failed) are in the start-up log.
    shadow = shadow if shadow is not None else ShadowSettings()
    shadow_store = ShadowStore(clock=shadow_clock, monotonic=shadow_monotonic)
    shadow_table = device_beds if device_beds is not None else TableFile(shadow.table_path, clock=time.monotonic)
    shadow_occupancy: dict[str, tuple[float, dict[str, list[str]]]] = {}

    def _occupancy_reset(hospital: str) -> None:
        """Drops the strip's cached occupants (`_occupants`, SHADOW_OCCUPANCY_CACHE_S): called after
        every identity write that can move a patient on or off a bed — here a discharge
        (`retire_and_publish`) and the feed's Patient/Encounter at `/ingest`; Lane B's admission
        through `app.state.shadow_occupancy_reset`."""
        shadow_occupancy.pop(hospital, None)

    if shadow.on:
        log.info("Aşama A gölge şeridi açık (doğrulanmamış; klinik girdi değil): hastane %s", shadow.hospital)
        shadow_table.current()

    # Aşama B — the shadow engine (api/infinity_rules.py). Below the stage `rules` the lane is
    # disabled: `engines` stays empty and every method but `close_open` is a no-op, so Aşama A is
    # unchanged. The lane is handed engines and observations, never the notifier, the hub, the ack
    # store or the broadcaster: the frames its pictures go out in are published here.
    samples = samples if samples is not None else InMemorySamples()
    # The lane keeps time on the strip's clock (`shadow_clock`): its install retries, error window and
    # retired-number hold are compared with the sampler's `now`, which is that clock.
    lane = ShadowLane(allowed=shadow.parameters, samples=samples, audit=audit, enabled=shadow.rules,
                      clock=shadow_clock)
    if shadow.rules:
        log.info("Aşama B gölge motor açık (alarm kapalı): hastane %s, parametreler %s",
                 shadow.hospital, ",".join(shadow.parameters))

    def _lane_now() -> datetime:
        """The lane's clock as a datetime: the instant `sample` is given, so a discharge's hold and
        a restart's provisional links are measured on the clock the passes run on."""
        return datetime.fromtimestamp(shadow_clock(), timezone.utc)

    def _admitted(hospital: str) -> Callable[[str], bool]:
        """`admitted(pid)` for the lane's install: the hospital's admitted numbers, read once per
        install attempt rather than once per replayed sample (a database read in production) and
        cached SHADOW_OCCUPANCY_CACHE_S (10 s) — an install that failed is retried later with this
        same callable, at least INSTALL_RETRY_S on, so each retry reads them afresh."""
        ids: frozenset[str] = frozenset()
        read_at: float | None = None

        def admitted(patient_id: str) -> bool:
            nonlocal ids, read_at
            if read_at is None or time.monotonic() - read_at > SHADOW_OCCUPANCY_CACHE_S:
                ids, read_at = frozenset(identities.admitted_ids(hospital)), time.monotonic()
            return patient_id in ids

        return admitted

    rehydrated: set[str] = set()

    def _ensure(hospital: str) -> None:
        """Build a tenant's engine + store, rehydrating once from the audit log (event sourcing).

        The replay runs into an engine and a store nothing else can see yet, and they are installed
        — the tenant marked rehydrated — only when every page has been read (G2-A2, Task 4 review).
        A page read that fails midway installs nothing and the error goes up; the next request
        replays again, instead of serving the half-replayed board of a replay that never finished."""
        if hospital in rehydrated:
            return
        engine = Engine()
        store = AckStore()
        # G3-01 (D12): the withdrawn hand entries first — one read of the `chart_retract` rows — so the replay
        # below scores each patient as the live withdrawal's rebuild did.
        withdrawn = retracted_entries(iter_records_of(audit, tenant=hospital, event_types={RETRACT},
                                                      page=REHYDRATE_PAGE))
        # Every row, oldest first, a page at a time (G2-A2, D12) — never the newest N, and no cap.
        rehydrate(engine, store, iter_records(audit, tenant=hospital, page=REHYDRATE_PAGE), skip=withdrawn)
        # G2-A11 (D7b): the restart agrees with the identity store. A patient whose admission here
        # was discharged is retired, whether or not the discharge's rows were written (a crash
        # between the tombstone write and the retire call; an audit that failed after the
        # in-memory retire). The replay writes nothing, so neither does this.
        for pid in engine.patient_ids():
            if is_tombstone(identities.get(hospital, pid)):
                retire_state(engine, store, pid)
        engines[hospital] = engine
        stores[hospital] = store
        rehydrated.add(hospital)
        # Aşama B (D9, D10), after the real engine is installed and never in its way (guarded):
        # with the stage `rules`, the shadow engine is the real one's copy plus the last 24 h of
        # samples — replayed here, on the loop, as `rehydrate` is (≈5 s for 13 beds at start-up); a
        # failed install is retried by the lane on its next pass. Below `rules`, the findings a
        # `rules` run left open are closed, once (nothing is written when there is none).
        if shadow.rules and hospital == shadow.hospital:
            lane.guard("install", lambda: lane.install(hospital, engine, now=_lane_now(),
                                                       admitted=_admitted(hospital)))
        else:
            lane.guard("close_open", lambda: lane.close_open(hospital, now=_lane_now()))

    def _engine(hospital: str) -> Engine:
        _ensure(hospital)
        return engines.setdefault(hospital, Engine())

    def _store(hospital: str) -> AckStore:
        _ensure(hospital)
        return stores.setdefault(hospital, AckStore())

    # --- the cards: every board this app publishes or answers is built here (Aşama B, D6) ---------
    _READ = object()     # `_card`'s default identity: read it from the store

    def _shadow_for(hospital: str, patient_id: str, now: datetime | None = None) -> dict | None:
        """The card's `shadow` key: the shadow engine's picture of a monitor-linked patient; None
        for any other patient and below the stage `rules`. Reads the real engine, never creates a
        patient in it."""
        if not shadow.rules or hospital != shadow.hospital:
            return None
        return lane.guard("findings", lambda: lane.findings(hospital, patient_id, _engine(hospital),
                                                            now=now or datetime.now(timezone.utc)))

    # The bed map as the sampler's republishes read it (final review): the same table, its misses
    # not counted — at a link's end the patient may lie on a location the table does not cover,
    # and a shadow pass must move no discovery counter (the equivalence gate compares them).
    uncounted_bedmap = bedmap.uncounted()

    def _card(hospital: str, patient_id: str, identity=_READ, now: datetime | None = None,
              *, counted: bool = True) -> dict:
        """`patient_board` with the shadow key. `identity` is the record the caller already holds
        (None: the card carries no identity); left out, it is read here. `counted` False: the
        card's bed is resolved without counting a miss (the sampler's republish). A `kabul`
        tombstone's card is its removal (G2-B1a, as `patient_board` answers it), with no shadow key."""
        record = identities.get(hospital, patient_id) if identity is _READ else identity
        if is_tombstone(record):
            return tombstone_board(record)
        return patient_board(_engine(hospital), patient_id, _store(hospital), identity=record,
                             bedmap=bedmap if counted else uncounted_bedmap, now=now,
                             shadow=_shadow_for(hospital, patient_id, now))

    def _identity_card(hospital: str, record, now: datetime | None = None, *, counted: bool = True) -> dict:
        """The card of an admitted patient the real engine has never measured, with the shadow key:
        built without creating the patient in the real engine — `patient_board` would, and its
        `news2: null` would read as a NEWS2 0 nobody measured (D1). `counted` as for `_card`.
        A `kabul` tombstone's is its removal, as `_card`'s (merge with G2-B1a): the tombstone keeps
        the name (A-16), and a republish the lane asks for after a discharge here — a settle it
        retries on a later pass — must never bring the discharged patient back on a screen (A-29)."""
        if is_tombstone(record):
            return tombstone_board(record)
        return {**identity_only_board(record, bedmap if counted else uncounted_bedmap),
                "shadow": _shadow_for(hospital, record.patient_id, now)}

    def _audit_cleared(hospital: str, cleared: list[Cleared], at: datetime) -> None:
        """G2-A1, D6: an episode's end is audited as its start (`first_seen`) is — the alarm-quality
        report reads both. A restart does not replay these: they follow from the rows it does."""
        for item in cleared:
            audit.append(AuditEvent(hospital, "alert_cleared", item.patient_id, item.kind,
                                    item.payload(at)))

    async def retire_and_publish(hospital: str, patient_id: str, frame: dict | None = None,
                                 now: datetime | None = None) -> list[Cleared]:
        """G2-A11 (D1, D2): a discharge made here retires the patient from the alert world — every
        episode ended with an `alert_cleared` row (reason `discharged`), the store and the engine
        forget the patient, the nurse's dedup is re-armed — and the ward is told once, with
        `frame` (Lane B's tombstone board) or the minimal removal the retention sweep sends.
        Lane B's discharge path calls it through `app.state.retire_patient`, after the identity
        store's tombstone write; the escalation cycle calls it for a tombstone whose call never
        came (D6)."""
        engine, store = _engine(hospital), _store(hospital)
        try:
            cleared = retire_patient(engine, store, audit, hospital, patient_id,
                                     now or datetime.now(timezone.utc))
        finally:
            # Aşama B (D1, A-11): the shadow engine forgets as the real one did — here, since the
            # real engine's end has happened whatever the audit did — guarded, on the lane's clock;
            # and the strip's occupants are re-read, so the retired number is no bed's occupant for
            # the 10 s they are cached.
            lane.guard("forget", lambda: lane.forget(hospital, patient_id, now=_lane_now()))
            _occupancy_reset(hospital)
            # The in-memory end has happened whatever the audit did (final review): the ward is
            # told and the nurse's dedup re-armed even when a row write raises, and the error
            # still goes up to the caller.
            notifier.prune(hospital, live_keys(engine, store))
            await broadcaster.publish(hospital, frame if frame is not None else
                                      {"patient_id": patient_id, "removed": True, "identity": None})
        return cleared

    # G2-A2 (D5): each hospital's previous escalation-cycle `now`, advanced after that hospital's
    # republish, so a tenant failing in its own does not hold the others' back (Task 2 review).
    # A hospital no cycle has reached yet counts from the app's start, seeded by the lifespan: the
    # first cycle covers [start, first cycle), at worst one frame a fresh `/patients` already had.
    # Lane B's retention sweep right after the republish may send a second frame per cycle for a
    # patient (A2's O14).
    freshness_since: dict[str, datetime] = {}
    freshness_started: list[datetime | None] = [None]

    async def _republish_turned(hospital: str, engine: Engine, store: AckStore, now: datetime,
                                published: set[str]) -> None:
        """G2-A2 (D5): republish, judged at `now`, each measured patient one of whose NEWS2 inputs
        stopped counting since this hospital's previous cycle (`board.freshness_turned`). A
        reading's window closes with no frame to say so — a feed that stops is exactly when no
        further frame arrives — and without this the card would read fresh until a reload. Its
        first cycle counts from the app's start; without a lifespan there is nothing to count from
        and it republishes nothing. `published` are the patients this cycle has already sent."""
        since = freshness_since.get(hospital, freshness_started[0])
        if since is None:
            return
        for pid in engine.patient_ids():
            if pid not in published and freshness_turned(engine.state(pid), since, now):
                await broadcaster.publish(hospital, _card(hospital, pid, now=now))

    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
            store = _store(hospital)
            # The firing alerts only (G2-A1, D8): a latched one is a to-do, not an unanswered
            # active finding, and does not escalate.
            alerts = [(pid, a) for pid in engine.patient_ids() for a in engine.active_alerts(pid)]
            # G2-A11 (D6): an alerting patient whose admission here was discharged is retired,
            # not escalated — the guard for a discharge whose retire call never came. Read only
            # for patients with a firing alert: one identity read per alerting patient, not per bed.
            gone = {pid: record for pid in {p for p, _a in alerts}
                    if is_tombstone(record := identities.get(hospital, pid))}
            for pid in sorted(gone):
                # G2-B1a (A-25): the removal is the tombstone's board, built from the record read
                # above — its last bed and unit, so a screen scoped to that unit is told too.
                await retire_and_publish(hospital, pid, frame=tombstone_board(gone[pid]), now=now)
            alerts = [(pid, a) for pid, a in alerts if pid not in gone]
            # The chain's clock, not the episode's first sight (X13): an alert that clears
            # unanswered and returns within `escalate_after` is still unanswered on the clock it
            # started.
            newly = escalate(alerts, store.acks, store.clock_from, now, escalate_after)
            changed: set[str] = set()
            if newly != store.escalated:
                changed = {pid for (pid, _k) in (newly ^ store.escalated)}
                store.escalated = newly
                for pid in changed:
                    # Judged at the cycle's instant, as the freshness republish below (G2-A2, X2).
                    await broadcaster.publish(hospital, _card(hospital, pid, now=now))
            # One page per chain (G2-A1 final review, X13): `escalated` follows the clock, so a
            # critical that latches and returns, or an alert that clears and returns within the
            # delay, is escalated again — but the doctor was told about this chain already (`paged`).
            # A new chain pages anew.
            # At least once, never lost (spec 2026-11-01, D3): a key joins `paged` only after its
            # `escalation` row is written and its note published, with that note's row. An append
            # that fails — a bounded audit times out in seconds now, where it used to wait — stops
            # the cycle with this key and every one after it still unpaged, and the next cycle pages
            # them: what is escalated and not yet paged, not only what this cycle escalated, which a
            # failed cycle has already recorded. The cost after a failure is a second row or page,
            # never a lost one.
            to_page = newly - store.paged
            if to_page:
                alert_by_key = {(pid, a.kind): a for (pid, a) in alerts}
                for key in sorted(to_page):
                    audit.append(AuditEvent(hospital, "escalation", key[0], key[1],
                                            {"at": now.isoformat()}))
                    for note in notifier.for_escalation(hospital, {key}, alert_by_key):
                        await hub.publish(hospital, note)
                        audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                                {"audience": note.audience, "trigger": note.trigger}))
                    store.paged.add(key)
            await _republish_turned(hospital, engine, store, now, changed)   # G2-A2 (D5)
            freshness_since[hospital] = now                                  # G2-A2 (D5)

        # Retention: a card discharged more than DISCHARGED_TTL ago leaves the board (or keeps its
        # readings and loses its name). Every tenant this app serves is swept, engine or not — the
        # identity store is durable and outlives the engine's memory, so a tenant nobody has
        # touched since restart still owes its clients the "removed" frame.
        for hospital in set(tenants.values()) | set(engines):
            for record in identities.expired(hospital, now):
                engine = engines.get(hospital)
                if engine is not None and record.patient_id in set(engine.patient_ids()):
                    board = _card(hospital, record.patient_id, identity=None)
                else:
                    # G2-B1a: a record with its own bed sends its last bed and unit with the
                    # removal, so a screen scoped to that unit is told too (`sees_patient` reads
                    # them). A HIS-fed one has none to send (`_merge` cleared its location).
                    board = {**identity_only_board(record), "removed": True,
                             "identity": ({"bed_id": record.bed_id,
                                           "unit_id": record.unit_id or None}
                                          if record.bed_id else None)}
                await broadcaster.publish(hospital, board)
        identities.prune(now)

    async def _escalation_loop() -> None:
        while True:
            await asyncio.sleep(escalate_interval)
            try:
                await _escalation_cycle(datetime.now(timezone.utc))
            except Exception:  # a bad cycle must never kill the loop
                log.exception("escalation cycle failed; the next one runs in %ss", escalate_interval)

    async def _prune_once() -> None:
        """Aşama B (D8): one pass of the samples' retention, measured on the lane's clock — the one
        the rows are received on. The table (`durable`) keeps RETENTION_DAYS and is pruned off the
        loop; a store in memory keeps MEMORY_RETENTION_HOURS — all an install replays — and is
        pruned ON the loop, where the lane appends (a worker thread would race it). A missing table
        (migration 0013 not applied) is one WARNING per pass; any other failure is logged with its
        traceback. Never raises: the next hour tries again."""
        durable = samples.durable
        before = retention_bound(_lane_now(), durable=durable)
        try:
            dropped = (await asyncio.to_thread(samples.prune, before=before) if durable
                       else samples.prune(before=before))
        except Exception as error:
            if is_missing_table(error):
                log.warning("monitor_samples tablosu yok (göç 0013 uygulanmamış); temizlik atlandı, "
                            "bir saat sonra yeniden")
            else:
                log.exception("monitor_samples temizliği başarısız; bir saat sonra yeniden")
            return
        if dropped:
            log.info("monitor_samples: %d satır silindi (%s öncesi alınanlar)", dropped, before.isoformat())

    async def _prune_loop() -> None:
        """`_prune_once` at start-up, then hourly. Started for a durable store at EVERY stage — a
        rollback below `rules` keeps deleting what a `rules` run wrote (T6 review) — and for a store
        in memory at `rules` only: below it nothing is written there."""
        while True:
            await _prune_once()
            await asyncio.sleep(3600)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        freshness_started[0] = datetime.now(timezone.utc)   # G2-A2 (D5): the first cycle's `since`
        if on_startup_check is not None:
            try:
                await on_startup_check()
            except Exception:      # a diagnostic must never stop the service from starting
                logging.getLogger(__name__).exception("tenant configuration check failed to run")
        # The directory's start-up bind (spec §9) runs in the background: a domain controller
        # that hangs must not delay serving local sign-ins. Kept on app.state for the tests.
        ldap_check = (asyncio.create_task(_check_directory_at_startup(ldap))
                      if ldap is not None else None)
        app.state.ldap_startup_check = ldap_check
        task = asyncio.create_task(_escalation_loop()) if run_escalation_loop else None
        prune = (asyncio.create_task(_prune_loop())                           # Aşama B (D8)
                 if samples.durable or shadow.rules else None)
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
            if prune is not None:
                prune.cancel()
            if ldap_check is not None and not ldap_check.done():
                ldap_check.cancel()
            # The stores' connection pools go back now rather than at the server's idle timeout
            # (spec 2026-11-01, D4) — Postgres's `dispose`, the identity store's `close`; a store
            # with neither holds nothing to return. Each on its own: one that fails is logged and
            # keeps no other's connections open.
            for name, store, release in (("audit", audit, "dispose"),
                                         ("identities", identities, "close"),
                                         ("samples", samples, "dispose"),
                                         ("device_beds", device_beds, "dispose"),
                                         ("tasks", tasks, "close")):           # G3-02
                method = getattr(store, release, None)
                if callable(method):
                    try:
                        method()
                    except Exception:
                        log.exception("the %s store failed to release its connections at shutdown",
                                      name)
            if ldap is not None:
                ldap.close()                 # the directory's own worker threads
            feed = getattr(app.state, "wave_feed", None)      # Lane C (dalga): the hub client
            if feed is not None:
                await feed.aclose()

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
    from homunculus.admin.router import router as admin_router
    from homunculus.admin.ldap_router import router as ldap_admin_router
    from homunculus.scope.router import router as scope_router
    # The device-research window: same origin, permission-gated (`devices.manage`), credential
    # held server-side. Off unless INFINITY_HUB_URL / _VIEWER_TOKEN / _HUB_CA_FILE are all set.
    from homunculus.api.infinity_research import router as infinity_research_router
    from homunculus.devicebeds.router import router as device_beds_router   # G2-ESLEME
    app.include_router(auth_router)
    app.include_router(tenant_router)
    app.include_router(admission_router)
    app.include_router(shift_schedule_router)
    app.include_router(handover_router)
    app.include_router(alerts_router)
    app.include_router(break_glass_router)
    app.include_router(admin_router)
    app.include_router(ldap_admin_router)
    app.include_router(scope_router)
    app.include_router(infinity_research_router)
    # Lane C (dalga): the live waveform panel's GET, behind the strip board's own gates — it calls
    # `shadow_board` (defined below; looked up when a request comes). Off unless INFINITY_WAVES=on.
    from homunculus.api.infinity_waves import register as register_waves
    register_waves(app, board=lambda authorization: shadow_board(authorization))
    app.include_router(device_beds_router)          # G2-ESLEME: the monitor→bed editor (spec §4.1)
    # G2-B1d: Yönetim › Protokol ve etiket (`structure.manage`, the caller's tenant).
    from homunculus.protocol.router import router as protocol_router
    app.include_router(protocol_router)
    # G2-B1d (spec §5, D12): the bridge's patient query — the device token only, never proxied by
    # nginx. `_caller` is defined below; the lambda reads it when a request arrives (E2).
    from homunculus.api.edge_query import edge_query_router
    app.include_router(edge_query_router(caller=lambda authorization: _caller(authorization),
                                         identities=identities))
    # G3-02: Görevlerim — the task queue, bound to the caller resolver and the scoped board (`_board_for`
    # is defined below; the lambdas read it when a request arrives, as the edge query does).
    async def _tasks_board(authorization: str | None, permission: str):
        who, _, result = await _board_for(authorization, permission)
        return who, result.boards
    app.include_router(tasks_router(caller=lambda authorization: _caller(authorization),
                                    board=_tasks_board, audit=audit, store=tasks))

    app.state.broadcaster = broadcaster
    app.state.ack_stores = stores
    app.state.escalation_cycle = _escalation_cycle
    app.state.retire_patient = retire_and_publish   # G2-A11 (D1, D2): Lane B's discharge path calls it
    app.state.notifier = notifier
    app.state.notification_hub = hub
    app.state.audit = audit
    app.state.tickets = tickets
    app.state.tasks = tasks                         # G3-02
    app.state.ldap = ldap
    app.state.shadow_store = shadow_store
    app.state.shadow_lane = lane
    # G2-ESLEME (the monitor→bed editor, devicebeds/router.py): the lane's settings and clock, so the
    # editor answers only while this strip runs for its hospital (spec D15), and the table's
    # invalidate, so the next read after a change re-reads (§4.4 step 11).
    app.state.shadow_settings = shadow
    app.state.shadow_clock = shadow_clock
    app.state.shadow_table_reset = shadow_table.invalidate
    # Aşama B (T6 review): Lane B's admission (`kabul`) calls this right after its identity write,
    # as its discharge calls `retire_patient` — the strip's occupants are cached for 10 s, and the
    # next readings body must link the bed's new occupant, not the one the cache still holds.
    app.state.shadow_occupancy_reset = _occupancy_reset
    app.state.prune_samples = _prune_once           # one pass of the hourly prune (the tests call it)
    # Aşama B (D1): every door that charts through `chart_observations` hands it this, so each
    # charted entry reaches the shadow engine right after the real one — guarded (Lane B's
    # admission form passes it too).
    app.state.shadow_mirror = lambda hospital, obs, now: lane.guard(
        "mirror", lambda: lane.mirror_observation(hospital, obs, now=now, real=_engine(hospital)))
    # Aşama B (D1, final review): a charted profile reaches the shadow engine after the real one's
    # `set_profile` — guarded, as `PUT /clinical/{pid}/profile` does it.
    app.state.shadow_profile = lambda hospital, profile: lane.guard(
        "mirror", lambda: lane.mirror_profile(hospital, profile))
    # G2-B1a: the admission routes' one way into the board world (admission/boardlink.py). Lane A's
    # doors go in by reference, never copied (A-25, condition 5): the charting loop `/clinical`
    # runs, the retirement the escalation cycle runs, and the broadcaster's publish. Aşama B's
    # hooks go in the same way (the merge of B1a): the admission's weight reaches the shadow engine
    # through `shadow_mirror` (handed to its chart), its profile through `shadow_profile` after its
    # `set_profile`, the strip's occupants are dropped after its identity write
    # (`shadow_occupancy_reset`), and its cards are built by `_card` / `_identity_card`, so they
    # carry the `shadow` key (tests/test_kabul_boardlink.py pins each).
    app.state.board_link = BoardLink(
        identities=identities, engine=_engine, store=_store, audit=audit,
        publish=broadcaster.publish, notifier=notifier, escalate_after=escalate_after,
        chart=chart_observations, retire_patient=app.state.retire_patient, bedmap=bedmap,
        mirror=app.state.shadow_mirror, mirror_profile=app.state.shadow_profile,
        occupancy_reset=app.state.shadow_occupancy_reset,
        card=_card, identity_card=_identity_card)

    def _device_hospital(credential: str | None) -> str | None:
        """The hospital a static device token names, or None. An empty value is never a token."""
        if not credential or not credential.strip():
            return None
        return tenants.get(credential)

    def _tenant_from_token(token: str | None) -> str:
        hospital = _device_hospital(token)
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

    async def _caller(authorization: str | None) -> Caller:
        """Resolve the caller from either credential.

        The static token is tried first: it is the device path, and it must not depend on the
        database being reachable for authentication. Only then is the value treated as a JWT.
        The resolver returns None for what a refresh can repair (401 here); it raises its own
        403 for what a refresh cannot (a pending MFA step, a token naming no tenant, an inactive
        tenant or membership), and that passes through.
        """
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="missing bearer token")
        credential = authorization.split(" ", 1)[1]
        if not credential.strip():
            raise HTTPException(status_code=401, detail="missing bearer token")

        hospital = _device_hospital(credential)
        if hospital is not None:
            return Caller(hospital=hospital, device=True)

        if resolve_jwt is not None:
            caller = await resolve_jwt(credential)
            if caller is not None:
                # A JWT is a person: never a device, never anonymous. Anything else is a resolver
                # fault, and it is refused rather than trusted with a device's exemption.
                if (not isinstance(caller, Caller) or caller.is_device
                        or not isinstance(caller.actor, str) or not caller.actor.strip()):
                    log.warning("refused a JWT that resolved to a device or to no actor")
                    raise HTTPException(status_code=401, detail="unknown credential")
                return caller

        raise HTTPException(status_code=401, detail="unknown credential")

    def _require(caller: Caller, permission: str) -> None:
        """A device passes; a clinician needs the permission in their token."""
        validate_permissions((permission,))   # a typo fails loudly, not as a 403 for everyone
        if not caller.can(permission):
            raise HTTPException(status_code=403, detail=f"permission required: {permission}")

    def _attribution(caller: Caller, body: dict) -> dict:
        """Who acted, for the ack store and the audit row of /ack and /view.

        `role` is what `rehydrate` replays as `acknowledged_by`: the body's self-declared role on
        the device path, the signed-in username otherwise. `via` and `actor` record which of the
        two it was, so a device naming a user never reads as that user's own action.
        """
        if caller.is_device:
            return {"role": _device_role(body.get("role")), "via": "device", "actor": None,
                    "groups": []}
        return {"role": caller.actor, "via": "user", "actor": caller.actor,
                "groups": list(caller.groups)}

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

    def _readable(scope: Scope) -> Scope:   # G2-A2 (D13)
        """Refuse a scope that could not be read, before anything takes it for an answer: 503, the
        stream ticket's own answer (G2-A2, D13). A look-up that failed — a database blip, no
        membership the resolver could find — is not "out of scope": a 404 would tell a ward its
        patient is gone, a `scope_denied` row would record an access violation nobody committed,
        and an empty board would read as a quiet ward. The dashboard maps the detail
        (`apiErrors.js`), and a failed `/patients` load already shows UNAVAILABLE."""
        if scope.reason == UNKNOWN_SCOPE.reason:
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        return scope

    def _scope_card(hospital: str, patient_id: str, record=_READ, *, counted: bool = True) -> dict:
        """The card every scope check reads (`_require_patient`, the notification stream): only
        what `sees_patient` reads — the id, and the bed and unit the board publishes for that
        patient (same identity, same bed map). `record` is the identity the caller already holds;
        left out, it is read here. `counted` False: the bed is resolved without counting a miss.

        It is NOT built with `patient_board`: that reads `engine.state()`, which creates the
        patient, so a refused probe for a made-up id would put that id on every board in the
        hospital — and it scores a whole card to read two ids (G2 borç 5).
        """
        record = identities.get(hospital, patient_id) if record is _READ else record
        if is_tombstone(record):
            # G2-B1a (A-25, Lane A's note 5): a discharged admission sits on no bed, so it is
            # read at its last bed and unit — its removal frame's. That unit's clinicians reach
            # the route, whose discharged-number drop answers; another unit's still get the 404.
            identity = tombstone_board(record)["identity"]
        elif record is not None:
            identity = identity_only_board(record, bedmap if counted else uncounted_bedmap)["identity"]
        else:
            identity = None
        return {"patient_id": patient_id, "identity": identity}

    async def _require_patient(caller: Caller, authorization: str | None,
                               patient_id: str, *, scope: Scope | None = None) -> None:
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

        It runs after the route's permission check: a permission says what a caller may do, the
        scope says to whom, and both must hold.

        A scope that cannot be read is 503 here, right after it is resolved and before the check
        and the audit row (`_readable`, G2-A2, D13): "we could not find out" is not "not yours".

        `scope` is the caller's scope when the route has already resolved it (the trends route,
        which polls every minute). Passing it spares a second look-up, and a second chance for a
        blip to turn a readable scope into an unreadable one. Every other route leaves it out and
        the scope is resolved here.

        The card it checks is `_scope_card`'s, never `patient_board`'s.
        """
        hospital = caller.hospital
        scope = _readable(scope if scope is not None else await _scope(authorization))
        if scope.unrestricted:
            return
        if sees_patient(_scope_card(hospital, patient_id), scope):
            return
        audit.append(AuditEvent(hospital, "scope_denied", patient_id, scope.reason,
                                {"units": sorted(scope.unit_ids), "beds": sorted(scope.bed_ids),
                                 "actor": caller.actor,
                                 "via": "device" if caller.is_device else "user"}))
        raise HTTPException(status_code=404, detail="hasta bulunamadı")

    def _score_state(hospital: str, patient_id: str) -> PatientState:
        """The patient's record for a score form, read without creating a patient.

        A patient the engine has measured is read as is. One admitted with no reading yet gets an
        empty form from a throwaway state — scoring it must not turn its identity-only card into
        a measured one. An id that is neither is answered the way `_require_patient` answers a
        patient out of scope: 404, and nothing created.
        """
        engine = _engine(hospital)
        if patient_id in set(engine.patient_ids()):
            return engine.state(patient_id)
        if identities.get(hospital, patient_id) is not None:
            return PatientState(patient_id)
        raise HTTPException(status_code=404, detail="hasta bulunamadı")

    def _last_signed(hospital: str, patient_id: str) -> dict | None:
        """The patient's newest `score_signed` row as the SOFA box prints it (G2-A4, D7), or None.

        This patient's signing rows and nothing else of the trail: the box needs who, when and what
        total, and a ward doctor reading it holds `board.view`, not `audit.view`. `corrections` is the
        COUNT of the cells corrected — the reasons stay in the trail, for whoever may read it. Every
        signing row today is a SOFA form's; when another score signs, this read names the score (O7).
        """
        rows = audit.records(tenant=hospital, patient_id=patient_id, event_type="score_signed",
                             limit=1, newest=True)
        if not rows:
            return None
        signed = rows[-1].payload
        return {"total": signed.get("total"), "auto_total": signed.get("auto_total"),
                "signed_by": signed.get("signed_by"), "at": signed.get("at"),
                "corrections": len(signed.get("overrides") or [])}

    def _body_patient_id(body: dict) -> str:
        """The `patient_id` a request body names: a non-blank string of at most PATIENT_ID_MAX
        characters. Anything else is the caller's error (400); a dict used to reach a set
        lookup and answer 500."""
        value = body.get("patient_id")
        if not isinstance(value, str) or not value.strip() or len(value) > PATIENT_ID_MAX:
            raise HTTPException(status_code=400, detail="geçersiz patient_id")
        return value

    def _charted_by(caller: Caller) -> str:
        """Who charted this, for the audit record.

        A clinician's JWT names them — the signed-in username, the same name `/ack` records;
        the static tenant token does not (it is the bridge's credential, shared by a machine).
        Rather than invent an author, the token path is recorded as exactly what it is — an
        entry nobody can be asked about later.
        """
        return "tenant-token" if caller.is_device else caller.actor

    @app.post("/clinical/{patient_id}")
    async def chart(patient_id: str, body: dict = Body(...),
                    authorization: str | None = Header(default=None)):
        """Record what a clinician observed — the inputs no device produces.

        This is the door `suspected_infection` comes through, and with it the whole sepsis
        branch: until something charts it, `septic_shock.evaluate` returns at its first line.
        """
        caller = await _caller(authorization)
        _require(caller, CLINICAL_CHART)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        recorded_at = _recorded_at(body)
        # One wall-clock instant per request, as in /ingest (G2-A2, X10) — taken before the entries are
        # built, because the bedside set's time bound is judged at it (G3-01, D7); the loop below runs at it.
        now = datetime.now(timezone.utc)
        try:
            charted = build_entries(patient_id, body.get("entries") or [],
                                    charted_by=_charted_by(caller),
                                    recorded_at=recorded_at, now=now)
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        # G2-A11 (D3): as at /ingest — a discharged admission's number takes no chart either.
        record = identities.get(hospital, patient_id)
        if is_tombstone(record):
            for item in charted:
                code = item.observation.code.value
                audit.append(AuditEvent(hospital, READING_DROPPED, patient_id, code,
                                        {"patient_id": patient_id, "code": code}))
            return {"patient_id": patient_id, "dropped": DISCHARGED}

        engine = _engine(hospital)
        store = _store(hospital)
        # The loop itself is `chart_observations` (G2-A11, D8 — X62), shared with the admission form, run at
        # the request's one instant (`now`, above).
        written: list[tuple[str, int]] = []
        alerts = chart_observations(engine, store, audit, notifier, hospital, patient_id, charted,
                                    now, escalate_after,
                                    mirror=lambda o: app.state.shadow_mirror(hospital, o, now),
                                    entry_ids=written)
        # A kind charting ended has left the live keys: a nurse is told again if it returns (D5).
        notifier.prune(hospital, live_keys(engine, store))

        board = _card(hospital, patient_id, record)
        await broadcaster.publish(hospital, board)
        # G3-01 (X2): a newly immediate alert from a charted value tells the nurse, as /ingest's reading does —
        # the hand-entered NEWS2 was designed to alert like a device's (D9). The notifier's dedup sends nothing
        # for an alert already told.
        for note in notifier.for_new(hospital, engine.active_alerts(patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return {"patient_id": patient_id, "charted": len(charted),
                "alerts": [a.kind for a in alerts],
                # G3-01 (D10): each value's `chart` row, the id a «hatalı giriş» names.
                "entries": [{"code": code, "entry": entry} for code, entry in written]}

    @app.post("/clinical/{patient_id}/preview")
    async def chart_preview(patient_id: str, body: dict = Body(...),
                            authorization: str | None = Header(default=None)):
        """G3-01 (D8, X10): what the chart door would score for these entries — the card's own NEWS2
        (`api/board.py` `_news2`) of a COPY of the patient's state with the entries added, judged at the
        request's instant. Parsed by the door's own `_recorded_at` and `build_entries`: the same refusals and
        the same time bound. Nothing is charted: no chart row, no engine change, no frame, no notification.
        A discharged number answers as the door drops it (`dropped`), with nothing scored."""
        caller = await _caller(authorization)
        _require(caller, CLINICAL_CHART)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        recorded_at = _recorded_at(body)
        now = datetime.now(timezone.utc)
        try:
            charted = build_entries(patient_id, body.get("entries") or [],
                                    charted_by=_charted_by(caller),
                                    recorded_at=recorded_at, now=now)
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        if is_tombstone(identities.get(hospital, patient_id)):
            return {"patient_id": patient_id, "preview": True, "dropped": DISCHARGED}
        engine = _engine(hospital)
        # `engine.state()` creates the id it is asked about: a patient the engine has not measured is read from
        # an empty state, as the trends route reads one — a preview must not put a number on every board.
        state = (engine.state(patient_id).copy() if patient_id in set(engine.patient_ids())
                 else PatientState(patient_id))
        for item in charted:
            state.ingest(item.observation)
        return {"patient_id": patient_id, "preview": True, "at": now.isoformat(), "news2": _news2(state, now)}

    def _readings_equal(engine: Engine, patient_id: str, observation) -> int:
        """How many of the patient's readings in `engine` equal `observation` (G3-01, review of Task 5) — read
        without creating the patient; 0 for no observation (a signal this build does not know)."""
        if observation is None or patient_id not in set(engine.patient_ids()):
            return 0
        return engine.state(patient_id).history(observation.code).count(observation)

    async def _publish_current(hospital: str, patient_id: str, record, engine: Engine, store: AckStore,
                               now: datetime) -> None:
        """The patient's card after a «hatalı giriş», as a restart would build it (G3-01, review of Task 5): sent by
        a withdrawal, and by every «already» answer (final review, X21) — a withdrawal whose row committed and
        whose later step raised sent none, and a frame is idempotent.

        `adopt` forgets a patient the scratch engine never measured — the withdrawn value was the only one — and
        `_card` (`patient_board`) would create it again, a NEWS2 0 nobody measured (D1). As /ingest's identity
        branch chooses: the measured card, the identity card of an admission, or the removal of an id the board
        knows only from that value."""
        if patient_id in set(engine.patient_ids()):
            # Some reading is left: a latch the withdrawal made stays on this card until acknowledged (D10).
            frame = _card(hospital, patient_id, record)
        else:
            # No reading is left: every value the patient's alerts stood on was withdrawn, and there is no card for
            # a latch to sit on — kept, it would wait in the store, unseen and unacknowledgeable, for the next real
            # reading to bring it back as «resolved, unacknowledged». A restart never builds it (O4), so the latches
            # end here with the reason `entered_in_error` (never replayed), and the store forgets the patient. The
            # rows first, then memory (X4; final review, X19): an append that fails leaves the latch in the store,
            # and the retry's «already» answer, which comes through here, ends it.
            _audit_cleared(hospital, entered_in_error_latches(store, patient_id), now)
            store.forget_patient(patient_id)
            frame = (_identity_card(hospital, record) if record is not None
                     else {"patient_id": patient_id, "removed": True, "identity": None})
        await broadcaster.publish(hospital, frame)

    async def _adopt_rebuilt(hospital: str, patient_id: str, record, engine: Engine, store: AckStore,
                             scratch: Engine, observation, now: datetime) -> None:
        """«Hatalı giriş»'s memory half (G3-01, D10, X3, X4, X5), after its trail row: the scratch patient handed
        to the real engine, the lifecycle hook once at `now`, the shadow lane, the card, the nurse. Shared by a
        withdrawal and by the repair of one whose row committed while its append raised (review of Task 5)."""
        engine.adopt(scratch, patient_id)
        cleared = sync_alerts(engine, store, patient_id, now)
        # Review of Task 5, unlike X13 on purpose: an episode the withdrawal ended stood on a value that was never
        # real, so its escalation chain is not remembered — a real alert of the kind within `escalate_after` gets
        # its own clock and its own page to the doctor. A restart forgets every chain anyway (rehydrate).
        for item in cleared:
            store.recent.pop((item.patient_id, item.kind), None)
        _audit_cleared(hospital, cleared, now)
        _stamp_uncovered(hospital, patient_id, engine, store, now)
        if observation is not None:
            lane.guard("mirror", lambda: lane.retract_observation(hospital, observation))
        await _publish_current(hospital, patient_id, record, engine, store, now)
        await _tell_uncovered(hospital, patient_id, engine)
        notifier.prune(hospital, live_keys(engine, store))

    def _stamp_uncovered(hospital: str, patient_id: str, engine: Engine, store: AckStore, now: datetime) -> None:
        """X3: an alert a withdrawal uncovered is a new one — its first sight is `now`, with its `first_seen` row.
        The row first, then the stamp (X4; final review): an append that fails leaves the alert unstamped, and the
        «already» retry stamps it, row and all. Idempotent: a stamped alert is passed over, as
        `AckStore.stamp_first_seen` itself passes it over."""
        for a in engine.active_alerts(patient_id):
            if (patient_id, a.kind) in store.first_seen:
                continue
            audit.append(AuditEvent(hospital, "first_seen", patient_id, a.kind, {"at": now.isoformat()}))
            store.stamp_first_seen(patient_id, a.kind, now, chain_gap=escalate_after)

    async def _tell_uncovered(hospital: str, patient_id: str, engine: Engine) -> None:
        """X3: an immediate alert a withdrawal uncovered is told to the nurse, as /ingest tells one. Idempotent: the
        notifier's dedup tells nothing already told."""
        for note in notifier.for_new(hospital, engine.active_alerts(patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))

    @app.post("/clinical/{patient_id}/entries/{entry}/retract")
    async def retract_entry(patient_id: str, entry: str, body: dict = Body(...),
                            authorization: str | None = Header(default=None)):
        """G3-01 (D10, D11, X3, X4, X11): «hatalı giriş» — a hand entry withdrawn from every score.

        `entry` is the value's `chart` row (the door answered it). The patient's rows are read from the trail,
        then replayed without every withdrawn entry into a SCRATCH engine, with the restart's own helpers
        (`rebuild_patient`). Only then is the `chart_retract` row appended, and the scratch patient handed to the
        real engine (`Engine.adopt`). The trail row comes first, then memory, and a read or an append that fails
        changes nothing (X4).

        Then the lifecycle hook runs once, at the request's instant. An alert that no longer fires ends — or,
        critical and unacknowledged, latches (G2-A1, D3). An alert the withdrawal uncovers is a new one, so it
        is stamped and, if immediate, told to the nurse (X3). The notifier's dedup tells nothing already told.
        An episode the withdrawal ended leaves no escalation chain. The shadow lane drops the reading, guarded
        (X5), and the card is republished — as never measured when the withdrawn value was the patient's only
        one: `_card` would create the patient in the engine again, and the patient's latches end
        (`entered_in_error`), for there is no card left to show them (`_publish_current`).

        Refusals:
        - 403 for a device credential (X11): a withdrawal names a person;
        - 400 for a reason shorter than 10 or longer than 200 characters after trim;
        - 409 for a discharged number, before anything is read;
        - 404 for an id that is not this patient's `chart` row (a device's reading is an `ingest` row);
        - 409 for a chart row of a code neither the bedside form nor the fluid ledger charts (X22, G3-03 D4:
          RETRACTABLE_CODES);
        - 409 for an entry already withdrawn — after memory is repaired, if a row that committed while its
          append raised left the engine still counting the value, and with the current card sent again either
          way (a withdrawal whose later step raised sent none).
        A refusal writes no row — except an «already» answer finishing what a failed withdrawal left: the rows
        its tail would have written. The chart row itself is never changed: the trail keeps both."""
        caller = await _caller(authorization)
        _require(caller, CLINICAL_CHART)
        if caller.is_device:
            raise HTTPException(status_code=403, detail=RETRACT_NEEDS_PERSON)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        raw_reason = body.get("reason")
        reason = raw_reason.strip() if isinstance(raw_reason, str) else ""
        if len(reason) < RETRACT_MIN_REASON_CHARS:
            raise HTTPException(status_code=400, detail=RETRACT_REASON_SHORT)
        if len(reason) > RETRACT_MAX_REASON_CHARS:
            raise HTTPException(status_code=400, detail=RETRACT_REASON_LONG)
        # Before any read or rebuild (review of Task 5): REBUILD_EVENTS does not carry the discharge's
        # `alert_cleared` row, so a rebuild and `adopt` for a retired number would bring the discharged patient
        # back into the engine. A `kabul` tombstone is never pruned, so this check holds for good.
        record = identities.get(hospital, patient_id)
        if is_tombstone(record):
            raise HTTPException(status_code=409, detail=RETRACT_DISCHARGED)
        # An audit id in plain ASCII digits (review of Task 5): `str.isdigit` alone takes «²», which `int` then
        # refuses (a 500), and Arabic-Indic «١٢», which `int` reads as 12 — another entry, typed in another
        # script. Eighteen digits reach past any trail and keep the id inside a 64-bit integer.
        if not (entry.isascii() and entry.isdigit() and len(entry) <= 18):
            raise HTTPException(status_code=404, detail=RETRACT_UNKNOWN)
        wanted = int(entry)
        engine = _engine(hospital)             # rehydrated before anything is read or written
        store = _store(hospital)
        rows = list(iter_records_of(audit, tenant=hospital, patient_id=patient_id,
                                    event_types=REBUILD_EVENTS | {RETRACT}, page=REHYDRATE_PAGE))
        target = next((r for r in rows if r.id == wanted and r.event_type == "chart"), None)
        if target is None:
            raise HTTPException(status_code=404, detail=RETRACT_UNKNOWN)
        # X22 (the local walk): only the bedside form's values — and, since G3-03 (D4), the fluid ledger's volumes,
        # the meds chart's bolus among them. A physician's suspected-infection mark, the SOFA
        # form's labs and the meds chart are chart rows too, but they are corrected by a new entry, not withdrawn —
        # the sepsis panel tells the user its mark «geri alınmaz». Before the «already» check: no rule of this
        # route reaches such a row.
        if target.subject not in RETRACTABLE_CODES:
            raise HTTPException(status_code=409, detail=RETRACT_NOT_BEDSIDE)
        withdrawn = retracted_entries(rows)
        already = target.id in withdrawn
        scratch = Engine()
        rebuild_patient(scratch, patient_id, rows, skip=withdrawn | {target.id})
        observation = observation_of(target)
        now = datetime.now(timezone.utc)
        if already:
            # Review of Task 5: an append whose row committed and which still raised (a bounded write that timed
            # out after its commit) answered 500 and left memory counting the value; the retry finds the row and
            # is refused here. If the engine holds the reading more often than the trail without it does, memory
            # is repaired from the scratch engine — the same tail as a withdrawal, with no second row — and the
            # answer is still «already» (the dashboard tells it by RETRACT_ALREADY's sentence). Counted, not
            # merely found: an equal value charted twice at one time may rightly stay once.
            if _readings_equal(engine, patient_id, observation) > _readings_equal(scratch, patient_id, observation):
                await _adopt_rebuilt(hospital, patient_id, record, engine, store, scratch, observation, now)
            else:
                # Final review (X21): memory is right, but a withdrawal whose row committed and whose later step
                # raised (an `alert_cleared` or `first_seen` append after `adopt`) left its tail undone — the card
                # stale until the next frame, an uncovered alert unstamped and untold (X3). The tail's idempotent
                # steps run again, in its order; with no reading left, this is where a latch a failed append kept
                # is ended (`_publish_current`).
                _stamp_uncovered(hospital, patient_id, engine, store, now)
                await _publish_current(hospital, patient_id, record, engine, store, now)
                await _tell_uncovered(hospital, patient_id, engine)
                notifier.prune(hospital, live_keys(engine, store))
            raise HTTPException(status_code=409, detail=RETRACT_ALREADY)
        audit.append(AuditEvent(hospital, RETRACT, patient_id, target.subject, {
            "entry": target.id, "code": target.subject, "value": target.payload.get("value"),
            "obs_ts": target.payload.get("obs_ts"), "reason": reason, "retracted_by": caller.actor}))
        await _adopt_rebuilt(hospital, patient_id, record, engine, store, scratch, observation, now)
        return {"retracted": target.id, "code": target.subject,
                "alerts": [a.kind for a in engine.active_alerts(patient_id)]}

    @app.put("/clinical/{patient_id}/profile")
    async def set_patient_profile(patient_id: str, body: dict = Body(...),
                                  authorization: str | None = Header(default=None)):
        """The patient's own normal: charted comorbidities and baseline vital ranges.

        This is the input the patient-relative layer has been waiting for since it was written.
        Without it every patient is scored against the population threshold, so a chronic-AF
        patient living at 105 bpm alarms on every measurement — the alarm fatigue the layer
        exists to prevent. The boundary is always the clinician's; we never mint one.
        """
        caller = await _caller(authorization)
        _require(caller, CLINICAL_CHART)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        engine = _engine(hospital)
        try:
            # Merged over what is already charted, not replacing it: the admission form and the
            # sepsis panel write to this same door with different halves of the profile.
            profile = profile_from_payload(patient_id, body, engine.profile(patient_id))
        except ClinicalEntryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        # G2-A11 (D3, final review): a discharged admission's number takes no profile either —
        # without this the route set the profile, wrote its row, created engine state for the
        # tombstone and published its card. After the validation, as at /clinical: a malformed
        # body is 400 whatever the number's state. (`engine.profile` creates no state.)
        record = identities.get(hospital, patient_id)
        if is_tombstone(record):
            return {"patient_id": patient_id, "dropped": DISCHARGED}

        # Audited so a restart can replay it. A profile a deploy forgot would restart the
        # alarms it was written to quieten, without anything looking broken. The row first (spec
        # 2026-11-01, as /ack): an append that fails — a bounded audit times out — answers 500 and
        # leaves the engine without the profile, rather than quietening alarms on one the trail
        # does not hold and the clinician was told was not saved.
        audit.append(AuditEvent(hospital, "profile", profile.patient_id, "",
                                {**profile_to_payload(profile),
                                 "charted_by": _charted_by(caller)}))
        engine.set_profile(profile)
        # Aşama B (D1): the shadow engine judges against the same profile — guarded, and AFTER the
        # audit row (Lane B's review of 457a2bd, M-1): whatever the lane does, the engine's
        # profile has the row a restart replays behind it. BoardLink orders its own the same way.
        lane.guard("mirror", lambda: lane.mirror_profile(hospital, profile))

        board = _card(hospital, patient_id, record)
        await broadcaster.publish(hospital, board)
        return {"patient_id": profile.patient_id, **profile_to_payload(profile)}

    @app.post("/ingest")
    async def ingest(resource: dict, authorization: str | None = Header(default=None)):
        caller = await _caller(authorization)
        if not caller.is_device:
            # Observations raise alerts and Patient/Encounter resources overwrite demographics.
            # Both come from the bridge; no clinician client posts here.
            raise HTTPException(status_code=403, detail="ingest requires a device token")
        hospital = caller.hospital
        kind = resource.get("resourceType")
        if kind in ("Patient", "Encounter"):
            parse = parse_fhir_patient if kind == "Patient" else parse_fhir_encounter
            try:
                incoming = parse(resource)
            except GatewayError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from None
            except (TypeError, AttributeError, KeyError, IndexError):
                raise HTTPException(status_code=400, detail="malformed identity resource") from None
            # G2-A11 (D5): only the admission writes a `kabul` record. A feed naming that source
            # is refused outright; a feed writing onto a `kabul` record is refused before `apply`,
            # so `_merge`'s None keeps meaning "older" here, and the card below is never built
            # for a discharged admission.
            if incoming.source == KABUL:
                raise HTTPException(status_code=400,
                                    detail="identity source 'kabul' is reserved for the admission")
            existing = identities.get(hospital, incoming.patient_id)
            if existing is not None and existing.source == KABUL:
                return {"patient_id": incoming.patient_id, "identity": "refused", "reason": "kabul"}
            record = identities.apply(hospital, incoming)
            if record is None:
                return {"patient_id": incoming.patient_id, "identity": "stale"}
            # Aşama B (T6 review): an admission, a transfer or a discharge from the feed moves who
            # lies on a bed — the strip's occupants are re-read on the next body, not up to 10 s
            # later, so a monitor never feeds the patient who left its bed.
            _occupancy_reset(hospital)
            # Demographics stay in the encrypted store, never in the audit payload.
            audit.append(AuditEvent(hospital, "identity", record.patient_id, "",
                                    {"source": record.source, "state": record.state,
                                     "resource": kind}))
            engine = _engine(hospital)
            board = (_card(hospital, record.patient_id, record)
                     if record.patient_id in set(engine.patient_ids())
                     else _identity_card(hospital, record))
            await broadcaster.publish(hospital, board)
            return {"patient_id": record.patient_id, "identity": "ok"}
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        # G2-A11 (D3): a reading for a number whose admission here was discharged is dropped
        # before the engine — one audit row, no evaluation, no hook, no stamp, no frame, no
        # notification. The owner's decision (2026-10-26): no alert and no page may come of it.
        # 200, not 4xx: the input is well-formed and the server chose not to apply it, and a
        # per-reading 4xx on a monitor that keeps the old number would read as rejections in the
        # hub's counters. The one identity read a reading costs is reused for the frame below.
        record = identities.get(hospital, obs.patient_id)
        if is_tombstone(record):
            audit.append(AuditEvent(hospital, READING_DROPPED, obs.patient_id, obs.code.value,
                                    {"patient_id": obs.patient_id, "code": obs.code.value}))
            return {"patient_id": obs.patient_id, "dropped": DISCHARGED}
        engine = _engine(hospital)
        store = _store(hospital)
        # One wall-clock instant per request. The rules judge at the reading's own time but never
        # past the wall clock (G2-A2, X10): judged at a stamp in the future, every other input
        # would be aged to it. The audit row keeps the stamp; the replay judges at min(the stamp,
        # the row's write time) (rehydrate, X10b).
        wall_now = datetime.now(timezone.utc)
        alerts = engine.ingest(obs, now=min(obs.timestamp, wall_now))
        # G2-A1: what stopped firing ends its episode or — a critical nobody acknowledged —
        # latches (api/alert_lifecycle.py). Right after the evaluation and before any audit write:
        # if the audit fails from here on, an unacknowledged critical is still on the board.
        # Before the stamps too: a kind that came back after clearing has had its old stamp pruned,
        # so it is stamped anew, a new episode (D5).
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        cleared = sync_alerts(engine, store, obs.patient_id, wall_now)
        # Aşama B (D1): the same observation into the shadow engine, after the real evaluation and
        # its lifecycle hook — guarded, so nothing the lane does can fail this request.
        lane.guard("mirror", lambda: lane.mirror_observation(hospital, obs, now=wall_now, real=engine))
        audit.append(AuditEvent(hospital, "ingest", obs.patient_id, obs.code.value,
                                {"value": obs.value, "unit": obs.unit,
                                 "obs_ts": obs.timestamp.isoformat(), "device": obs.source_device}))
        for a in alerts:
            audit.append(AuditEvent(hospital, "alert", a.patient_id, a.kind,
                                    {"severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                                     "source": a.source, "evidence": a.supporting_evidence}))
        _audit_cleared(hospital, cleared, wall_now)
        # A return within `escalate_after` of an unanswered clear continues its escalation chain
        # (X13); a return after an acknowledgement starts a new one.
        for a in engine.active_alerts(obs.patient_id):
            if store.stamp_first_seen(obs.patient_id, a.kind, wall_now, chain_gap=escalate_after):
                audit.append(AuditEvent(hospital, "first_seen", obs.patient_id, a.kind,
                                        {"at": wall_now.isoformat()}))
        await broadcaster.publish(hospital, _card(hospital, obs.patient_id, record))
        # Push a notification for any newly-appeared immediate alert (nurse audience).
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
            audit.append(AuditEvent(hospital, "notification", note.patient_id, note.kind,
                                    {"audience": note.audience, "trigger": note.trigger}))
        notifier.prune(hospital, live_keys(engine, store))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.post("/ack")
    async def ack(authorization: str | None = Header(default=None), body: dict = Body(...)):
        caller = await _caller(authorization)
        _require(caller, ALERTS_ACK)
        hospital = caller.hospital
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind = _body_patient_id(body), body.get("kind")
        if not isinstance(kind, str):
            # Same failure as a non-string patient_id: an unhashable value in the lookup below.
            raise HTTPException(status_code=400, detail="geçersiz kind")
        # A clinician is attributed from the signed token; only the device path may name a role.
        who = _attribution(caller, body)
        await _require_patient(caller, authorization, patient_id)
        now = datetime.now(timezone.utc)
        # G2-A1, D8: a latched alert — a critical whose rule stopped while nobody had acknowledged
        # it — is removed by the acknowledgement: there is nothing left to answer, only to close.
        latched = (patient_id, kind) in store.resolved          # what `acknowledge_latched` takes
        if not latched and (patient_id, kind) not in live_keys(engine, store):
            raise HTTPException(status_code=404, detail="no such active alert")
        # The trail before memory (spec 2026-11-01, D3): an append that fails — a bounded audit
        # times out in seconds — answers 500 with the alert still unacknowledged here as well, so
        # it still escalates and the screen, the trail and the escalation agree. Applied first, a
        # failed ack silenced an escalation the ward was told had not been answered, and that a
        # restart, replaying the trail, would re-arm. Nothing is awaited in between.
        audit.append(AuditEvent(hospital, "ack", patient_id, kind, {**who, "at": now.isoformat()}))
        if latched:
            closed = acknowledge_latched(store, patient_id, kind)
            _audit_cleared(hospital, [closed], now)
            notifier.prune(hospital, live_keys(engine, store))   # a return is told again (D5)
        else:
            store.acknowledge(patient_id, kind, who["role"], now)
            store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        board = _card(hospital, patient_id)
        await broadcaster.publish(hospital, board)
        return board

    @app.post("/alerts/rrt-call")
    async def call_rrt(authorization: str | None = Header(default=None), body: dict = Body(...)):
        """A person calls the rapid-response team to one active alarm (G2-B5, spec 2026-11-09, owner D1: the RRT
        comes only when called by hand).

        Keyed like `/ack` — patient and kind in the body, never in the path the access log writes. A device is
        refused (a device is exempt from permission checks, so the refusal is explicit): the call is a person's,
        named in the trail. An acknowledged alarm is refused (409): nobody is waiting for help on it. A second
        call answers the card and writes nothing: the first call stands. The trail before memory, as `/ack`
        (spec 2026-11-01, D3).
        """
        caller = await _caller(authorization)
        if caller.is_device:
            raise HTTPException(status_code=403, detail="RRT'yi bir kişi çağırır")
        _require(caller, ALERTS_ESCALATE)
        hospital = caller.hospital
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind = _body_patient_id(body), body.get("kind")
        if not isinstance(kind, str):
            raise HTTPException(status_code=400, detail="geçersiz kind")
        raw = body.get("reason")
        reason = raw.strip() if isinstance(raw, str) else ""
        if not RRT_REASON_MIN <= len(reason) <= RRT_REASON_MAX:
            raise HTTPException(status_code=400, detail="RRT çağrısının gerekçesi 3–500 karakter olmalı")
        who = _attribution(caller, body)
        await _require_patient(caller, authorization, patient_id)
        key = (patient_id, kind)
        if key not in live_keys(engine, store):
            raise HTTPException(status_code=404, detail="no such active alert")
        if key in store.acks:
            raise HTTPException(status_code=409, detail="alarm zaten yanıtlandı; RRT çağrısı açılmaz")
        if key not in store.rrt_calls:
            now = datetime.now(timezone.utc)
            audit.append(AuditEvent(hospital, "rrt_call", patient_id, kind,
                                    {**who, "reason": reason, "at": now.isoformat()}))
            store.call_rrt(patient_id, kind, who["actor"], reason, now)
        board = _card(hospital, patient_id)
        await broadcaster.publish(hospital, board)
        return board

    @app.post("/view")
    async def view(authorization: str | None = Header(default=None), body: dict = Body(...)):
        """Record that a clinician opened a patient — attributed from the token."""
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        patient_id = _body_patient_id(body)
        # Guarded too, though it only writes a log line. A caller who can record "I opened this
        # patient" for a patient they may not open puts a false entry in the one record an
        # inspection trusts — and this route's whole purpose is that record.
        await _require_patient(caller, authorization, patient_id)
        audit.append(AuditEvent(caller.hospital, "view", patient_id, "",
                                _attribution(caller, body)))
        return {"ok": True}

    @app.get("/health")
    async def health():
        """Unauthenticated liveness probe for the host's health check. `async` because it does
        no blocking work: a sync route would wait for a thread-pool worker, and a burst of
        sign-ins (bcrypt runs on worker threads) must not make the service look dead."""
        return {"status": "ok"}

    async def _board_for(authorization: str | None, permission: str) -> tuple[Caller, Scope, ScopeResult]:
        """The ward narrowed to this caller — what `/patients` answers and `/tasks` reads (G3-02).

        `scope` travels with the patients rather than being left for the screen to infer. An
        empty board and a quiet ward are the same picture; only this block can tell them apart,
        and a nurse who cannot tell them apart is the failure this whole change exists to
        prevent.
        """
        caller = await _caller(authorization)
        _require(caller, permission)
        hospital = caller.hospital
        # 503 before the board is narrowed (G2-A2, D13): an unreadable scope is not an empty one.
        scope = _readable(await _scope(authorization))
        now = datetime.now(timezone.utc)          # every card, and its shadow, judged at one instant
        cards = board_snapshot(_engine(hospital), _store(hospital), identities=identities,
                               hospital=hospital, bedmap=bedmap, now=now,
                               shadow_for=lambda pid: _shadow_for(hospital, pid, now))
        # The identity-only cards (an admitted patient the real engine has never measured) carry
        # the shadow key too, read without creating the patient in the real engine (D1, D6).
        for card in cards:
            if "shadow" not in card:
                card["shadow"] = _shadow_for(hospital, card["patient_id"], now)
        result = apply_scope(cards, scope)
        if result.blind:
            # Not a 403 and not an error: the caller is authenticated and the request is valid.
            # It goes in the log because an administrator hunting "the nurses see nothing" should
            # find it on the server, not only in a screenshot from the ward.
            log.warning("scope yielded an empty board for a %s caller in %s (grants: %s)",
                        scope.reason, hospital, ", ".join(result.unmatched_grants) or "none")
        return caller, scope, result

    @app.get("/patients")
    async def patients(authorization: str | None = Header(default=None)):
        """The ward, narrowed to what this caller may see — and told why it is that size."""
        _, _, result = await _board_for(authorization, BOARD_VIEW)
        return {"patients": result.boards,
                "scope": result.as_dict(),
                "scope_note": scope_report(result)}

    @app.get("/patients/{patient_id}/trends")
    async def trends(patient_id: str, hours: str = "24",
                     authorization: str | None = Header(default=None)):
        """One patient's vital history for the trend charts (`api/trends.py`): the series, the
        NEWS2 rows as bands, the latest value's movement and points, and the alarm and antibiotic
        moments — everything a chart draws, decided here. Read-only, and not audited: opening the
        patient already wrote `view`, and a chart read every minute would bury that record.

        `hours` is read as text so that anything but 6, 24 or 72 is this route's 400, in the
        reader's words, rather than FastAPI's 422. A scope that cannot be read is 503, as the stream
        ticket answers it — `_require_patient` answers so for every single-patient route since
        G2-A2 (D13). Out of scope and unknown stay one 404.

        The scope is resolved once, here, and handed to `_require_patient`: the chart polls every
        minute, and a second look-up would double that work and give a blip between the two a way
        to turn a scope that was readable into a 503.
        """
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        if hours not in TREND_WINDOWS_TEXT:
            raise HTTPException(status_code=400, detail="geçersiz hours: 6, 24 veya 72 olmalı")
        scope = await _scope(authorization)
        await _require_patient(caller, authorization, patient_id, scope=scope)
        _score_state(caller.hospital, patient_id)     # 404 for an id neither measured nor admitted
        return patient_trends(_engine(caller.hospital), audit, hospital=caller.hospital,
                              patient_id=patient_id, hours=int(hours),
                              now=datetime.now(timezone.utc))

    @app.get("/patients/{patient_id}/fluids")
    async def fluids(patient_id: str, authorization: str | None = Header(default=None)):
        """G3-03: the patient's fluid ledger, summed here (`api/fluids.py`) — the browser adds nothing (D6).
        Read-only and not audited, as the trends read. The fluid day starts at Görevlerim's first shift start in
        the tenant's zone (D5), the defaults when the tenant saved no settings; the weight is the last charted
        one (the board's `meds.weight_kg`). Out of scope and unknown are one 404, as at /trends."""
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        scope = await _scope(authorization)
        await _require_patient(caller, authorization, patient_id, scope=scope)
        state = _score_state(caller.hospital, patient_id)     # 404 for an id neither measured nor admitted
        settings = tasks.settings(caller.hospital) or DEFAULT_TASK_SETTINGS
        weight = state.latest(SignalCode.WEIGHT_KG)
        return patient_fluids(audit, hospital=caller.hospital, patient_id=patient_id,
                              now=datetime.now(timezone.utc), zone=zone_of(tasks.timezone(caller.hospital)),
                              start_a=settings.shift_start_a, start_b=settings.shift_start_b,
                              weight_kg=None if weight is None else weight.value)

    # ------------------------------------------------------------------ Aşama A: the shadow lane
    def _occupants_now(hospital: str) -> dict[str, list[str]]:
        """Admitted patients per bed, read now (uncached): a `kabul` record (an admission made here,
        G2-B1a) by its own `bed_id`, the tenant's bed UUID; every other record through the site's bed
        map — read-only and counting nothing (`BedMap.lookup`). The ONLY bridge between a monitor and
        a patient in Aşama A: an explicit binding the hospital already made (an admission here,
        ADT or set_identity), never a guess from a name (design K3, K5). Discharged identities
        are not admitted, so never here. The strip reads it through `_occupants` (cached 10 s); the
        monitor→bed editor through `app.state.bed_occupants` (fresh: G2-ESLEME §4.4 step 8b)."""
        beds: dict[str, list[str]] = {}
        for patient_id in identities.admitted_ids(hospital):
            record = identities.get(hospital, patient_id)
            if record is None:
                continue
            # G2-B1a: an admission made here names its own bed — the tenant's UUID, which the
            # device→bed table carries from now on. A HIS-fed record goes through the bed map.
            if record.bed_id:
                bed_id = record.bed_id
            else:
                ref = bedmap.lookup(record.unit, record.room, record.bed)
                bed_id = ref.bed_id if ref is not None else ""
            if normalise_id(bed_id):
                beds.setdefault(normalise_id(bed_id), []).append(patient_id)
        return beds

    def _occupants(hospital: str, now: float) -> dict[str, list[str]]:
        """`_occupants_now`, cached SHADOW_OCCUPANCY_CACHE_S per hospital (`_occupancy_reset` drops it)."""
        cached = shadow_occupancy.get(hospital)
        if cached is not None and 0 <= now - cached[0] < SHADOW_OCCUPANCY_CACHE_S:
            return cached[1]
        beds = _occupants_now(hospital)
        shadow_occupancy[hospital] = (now, beds)
        return beds

    app.state.bed_occupants = _occupants_now          # G2-ESLEME: the editor's fresh read (§4.9)

    @app.post("/infinity-shadow/readings")
    async def shadow_readings(request: Request, authorization: str | None = Header(default=None)):
        """The hub forwarder's display values (Aşama A). NOT clinical ingest: nothing here reaches
        the engine, the audit, the board stream, a notification or an identity.

        The one route not reached through `_caller`, on purpose: its credential is the lane's own
        token, and `_caller` would accept a TENANTS token as a device — which passes every
        permission check and can write /ingest. A TENANTS token gets 401 here."""
        if not shadow.on:
            raise HTTPException(status_code=409, detail={"reason": "stage_off"})
        provided = (authorization or "").removeprefix("Bearer ")
        # Twice over: ShadowSettings refuses an "on" stage without a strong token, and this refuses a
        # short one again — compare_digest(b"", b"") is True, so an empty token would open the lane
        # to a request with no credential at all.
        if (len(shadow.token) < SHADOW_MIN_TOKEN
                or not secrets.compare_digest(provided.encode(), shadow.token.encode())):
            raise HTTPException(status_code=401, detail="unknown credential")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > SHADOW_MAX_BODY:
            raise HTTPException(status_code=413, detail={"reason": "too_large"})
        # Counted as it arrives, not read whole first: a body with no Content-Length (chunked) is
        # refused at the limit. The API holds its own limit whatever the proxy in front of it does
        # (nginx's location for this route has the same 64 KiB), as the hub's receiver does.
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > SHADOW_MAX_BODY:
                raise HTTPException(status_code=413, detail={"reason": "too_large"})
            raw.extend(chunk)
        try:
            result = shadow_store.ingest(json.loads(raw))
        except TooSoon:
            raise HTTPException(status_code=429, detail={"reason": "too_soon"}) from None
        except (ShadowRejected, ValueError, RecursionError):
            raise HTTPException(status_code=400, detail={"reason": "rejected"}) from None
        if shadow.rules:
            await _sample_and_publish()
        return result

    async def _sample_and_publish() -> None:
        """Aşama B (D4, D5): one sampling pass per accepted body, then a frame per patient whose
        shadow picture changed. The bed cards come from `board_view` with the hospital's own
        occupants — the link the strip shows — so a sample goes only where a card says `link: one`;
        with no valid table the pass is skipped (`cards` None), never read as every link ending.
        Guarded throughout: the body is already accepted, and nothing here may answer otherwise."""
        hospital = shadow.hospital
        now = shadow_clock()

        def _pass() -> list[str]:
            engine = _engine(hospital)
            devices = shadow_store.devices(now)
            table = shadow_table.current()
            cards = None
            if table.status == "ok":
                cards = board_view(devices, shadow_store.feed(now), table, occupants=_occupants(hospital, now),
                                   visible=lambda card: True, patient_visible=lambda card: True,
                                   show_unassigned=False, now=now)["beds"]
            return lane.sample(hospital, devices, cards, engine, now=now)

        changed = lane.guard("sample", _pass) or []
        if not changed:
            return

        def _frame(patient_id: str) -> dict | None:
            # A measured patient's card as every door builds it; an admitted, never-measured one's
            # identity-only card (D1: the real engine is not made to hold them); nothing for a
            # number with neither. Its bed is resolved uncounted: a republish is not the board's
            # own traffic, and the discovery counters stay the real path's alone.
            if patient_id in set(_engine(hospital).patient_ids()):
                return _card(hospital, patient_id, counted=False)
            record = identities.get(hospital, patient_id)
            return _identity_card(hospital, record, counted=False) if record is not None else None

        for patient_id in changed:
            frame = lane.guard("publish", lambda: _frame(patient_id))
            if frame is not None:
                await broadcaster.publish(hospital, frame)

    @app.get("/infinity-shadow/board")
    async def shadow_board(authorization: str | None = Header(default=None)):
        """The monitor strip, for `board.view` or `devices.manage` (and the device token).

        Unvalidated values, labelled so on every screen; a monitor sits on a bed only through the
        approved table, and on a patient only through an explicit binding. A `devices.manage`
        caller without `board.view` never sees a patient id."""
        caller = await _caller(authorization)
        viewer, manager = caller.can(BOARD_VIEW), caller.can(DEVICES_MANAGE)
        if not (viewer or manager):
            raise HTTPException(status_code=403, detail="permission required: board.view or devices.manage")
        if not shadow.on:
            body: dict = {"stage": "off"}
            if shadow.configured != "off":
                body.update(configured_stage=shadow.configured, problem=shadow.problem)
            return body
        if caller.hospital != shadow.hospital:
            return {"stage": "off"}
        scope = await _scope(authorization)
        if viewer:
            # G2 borç 4 (G2-A2, D13): a scope that could not be read is 503, not an empty strip — a
            # quiet ward on the screen of a nurse whose look-up failed. `devices.manage` alone sees
            # every monitor and no patient whatever the scope, so for it there is nothing to refuse.
            # `/infinity-waves` asks this handler for its board, and so answers the same 503.
            scope = _readable(scope)
        now = shadow_clock()

        def _at(card: dict, patient_id: str) -> bool:
            return sees_patient({"patient_id": patient_id,
                                 "identity": {"bed_id": card["bed_id"], "unit_id": card["unit_id"]}}, scope)

        body = board_view(
            shadow_store.devices(now), shadow_store.feed(now), shadow_table.current(),
            occupants=_occupants(caller.hospital, now) if viewer else None,
            # A scoped clinician sees a bed's monitor when that bed or its unit is theirs; a row
            # with neither id is the board's unresolved bed, visible only unrestricted.
            visible=lambda card: manager or _at(card, ""),
            patient_visible=lambda card: _at(card, "") and _at(card, card["patient_id"]),
            show_unassigned=scope.unrestricted or manager, now=now)
        if shadow.rules:
            # Aşama B: the running stage (`board_view` answers "shadow", the strip it builds), and
            # the shadow engine's word for the device screen — «gölge motor: hata» while failing.
            body["stage"] = "rules"
            body["feed"]["rules_state"] = lane.state
        return body

    @app.get("/infinity-shadow/findings")
    async def shadow_findings(days: str = "7", authorization: str | None = Header(default=None)):
        """Aşama B's «uyarsaydı» list (D7): every shadow finding opened in the last `days` (1–7),
        newest first, with when it cleared. For `board.view`, scoped like the board: a row is listed
        when its patient's card would be (`sees_patient` on the identity's bed and unit, as
        `/patients` and `_require_patient` read them). 409 below the stage `rules` and for another
        hospital; 400 for `days` anything but 1–7 — read as text, as the trends route reads `hours`,
        so that "abc" is this route's 400 rather than FastAPI's 422."""
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        if not shadow.rules or caller.hospital != shadow.hospital:
            raise HTTPException(status_code=409, detail={"reason": "stage_not_rules"})
        if days not in SHADOW_FINDINGS_DAYS_TEXT:
            raise HTTPException(status_code=400, detail="geçersiz days: 1–7 olmalı")
        window = int(days)
        scope = _readable(await _scope(authorization))
        since = datetime.now(timezone.utc) - timedelta(days=window)
        # Two backward walks of the audit's two shadow kinds: off the loop.
        rows = await asyncio.to_thread(lane.recent_findings, caller.hospital, since=since)
        if not scope.unrestricted:
            seen: dict[str, bool] = {}          # one identity read per patient, not per row

            def visible(patient_id: str) -> bool:
                # The bed read uncounted: this list is the shadow lane's, and moves no discovery counter.
                if patient_id not in seen:
                    record = identities.get(caller.hospital, patient_id)
                    seen[patient_id] = sees_patient(
                        {"patient_id": patient_id,
                         "identity": (identity_only_board(record, uncounted_bedmap)["identity"]
                                      if record is not None else None)}, scope)
                return seen[patient_id]

            rows = [row for row in rows if visible(row["patient_id"])]
        return {"days": window, "findings": rows}

    @app.get("/alerts/{patient_id}")
    async def alerts(patient_id: str, authorization: str | None = Header(default=None)):
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
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
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        scope = await _scope(authorization)
        if scope.reason == UNKNOWN_SCOPE.reason:
            # The look-up failed (a database blip, a token the scope resolver cannot read). A
            # ticket bound to that would stream an empty ward for the life of the connection, with
            # nothing on screen saying why; refusing lets the client retry and say so.
            raise HTTPException(status_code=503, detail="kapsam şu anda okunamıyor")
        return {"ticket": tickets.issue(caller.hospital, now=time.monotonic(), scope=scope),
                "expires_in": 60}

    def _shown_to(hospital: str, scope: Scope) -> set[str]:
        """The patients whose card a subscriber under `scope` holds as its stream opens — the ones
        `/patients` shows it (G2 borç 1): the board's patients, a discharged admission's tombstone
        not among them, each read as `_scope_card` reads it — no card built, no patient created,
        no miss counted (this is not the board's own read)."""
        engine = engines.get(hospital)
        ids = set(identities.patient_ids(hospital))
        if engine is not None:
            ids.update(engine.patient_ids())
        shown = set()
        for patient_id in ids:
            record = identities.get(hospital, patient_id)
            if is_tombstone(record):
                continue
            if sees_patient(_scope_card(hospital, patient_id, record, counted=False), scope):
                shown.add(patient_id)
        return shown

    @app.get("/stream")
    async def stream(token: str | None = None, ticket: str | None = None):
        hospital, scope = _stream_hospital(token, ticket)
        # An unrestricted subscriber is sent every board as it is. A scoped one is sent what its
        # `ScopedBoardView` makes of each (G2 borç 1): read before subscribing, with no await
        # between the two, so no board is published in the gap and a failed read leaves no queue.
        view = None if scope.unrestricted else ScopedBoardView(scope, _shown_to(hospital, scope))
        queue = broadcaster.subscribe(hospital)

        async def events():
            try:
                async for frame in sse_board_frames(queue, view=view):
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
            the board itself would have shown. Judged on `_scope_card`, as every patient route is
            (G2 borç 5).
            """
            if scope.unrestricted:
                return True
            pid = str(note.get("patient_id") or "")
            return sees_patient(_scope_card(hospital, pid), scope)

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
        caller = await _caller(authorization)
        _require(caller, AUDIT_VIEW)
        hospital = caller.hospital
        if patient_id:
            # Asking the audit log about one patient is asking about that patient. The trail
            # carries no demographics — an `rrt_call` row (G2-B5) carries the caller's free-text
            # reason, which the dialog asks not to name anyone — but it does carry who was alerted
            # about whom and when, which is the same question the board answers and must get the
            # same answer.
            await _require_patient(caller, authorization, patient_id)
        elif not _readable(await _scope(authorization)).unrestricted:   # G2-A2 (D13b): 503 first
            # The unfiltered trail spans every bed in the hospital. It is an administrator's and
            # an auditor's view, and narrowing it per bed would produce a partial record that
            # reads like a whole one — worse than refusing.
            raise HTTPException(status_code=403,
                                detail="denetim kaydının tamamı kapsam dışı; bir patient_id verin")
        # The NEWEST rows, oldest first, at most AUDIT_LIMIT_MAX (G2-A2, D12): an auditor asking
        # about recent activity gets recent rows, not the first ones ever written.
        recs = audit.records(tenant=hospital, patient_id=patient_id, event_type=event_type,
                             limit=max(1, min(limit, AUDIT_LIMIT_MAX)), newest=True)
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
        caller = await _caller(authorization)
        _require(caller, BOARD_VIEW)
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        state = _score_state(hospital, patient_id)
        record = identities.get(hospital, patient_id)
        form = sofa_form.build(
            state, datetime.now(timezone.utc),
            window=timedelta(hours=max(1.0, min(float(hours), 168.0))),
            admitted_at=getattr(record, "admitted_at", None),
        )
        audit.append(AuditEvent(hospital, "score", patient_id, "SOFA",
                                {"total": form.total, "window_hours": form.window_hours,
                                 "unmeasured": form.unmeasured_organs,
                                 "read_by": _charted_by(caller)}))
        # G2-A4 (D7): the patient's newest signature and the engine's own reason length travel with the
        # form, under this route's permission — `board.view` and the patient's scope — so the SOFA box can
        # say «signed by whom, when, to what total» without a ward doctor holding `audit.view`, and the
        # correction's counter counts against the number the engine enforces, not a copy of it.
        return {**form.as_dict(), "last_signed": _last_signed(hospital, patient_id),
                "min_reason_chars": MIN_REASON_CHARS}

    async def _sofa_to_sign(patient_id: str, body: dict, hours: float,
                            authorization: str | None) -> _SofaToSign:
        """The steps the SOFA preview and the signature share (G2-A4, D12, X19), in one place so the two
        routes cannot drift: the permission and the device refusal, the patient's scope, the corrections
        parsed against the record and held to the slip bounds, the form re-scored with them, and
        `sign_score` — whose refusal of an unnamed signer therefore holds for a preview too (X3). Nothing
        here writes to the audit, but for the `scope_denied` row `_require_patient` writes on every route
        for a patient out of scope.

        A signature names a person, so a device is refused outright: it passes every permission check,
        and without this the bridge's token could sign a form as "tenant-token".
        """
        caller = await _caller(authorization)
        _require(caller, SCORES_SIGN)
        if caller.is_device:
            raise HTTPException(status_code=403,
                                detail="skor formunu yalnız bir kişi imzalayabilir")
        hospital = caller.hospital
        await _require_patient(caller, authorization, patient_id)
        state = _score_state(hospital, patient_id)
        now = datetime.now(timezone.utc)
        window = timedelta(hours=max(1.0, min(float(hours), 168.0)))
        record = identities.get(hospital, patient_id)
        admitted = getattr(record, "admitted_at", None)

        # Built twice on purpose: `auto` is what the record alone produced, `rebuilt` is what the
        # clinician is signing. The difference is the audit trail of the correction.
        auto = sofa_form.build(state, now, window=window, admitted_at=admitted)
        _refuse_fractional_gcs(body.get("overrides"))   # G2-A4 review: before the corrections are parsed
        try:
            # G2-A4 (O6): a correction is held to the door's slip bounds, as a charted value is — for a
            # preview and a signature alike, both parsed here (CORRECTION_BOUNDS, which is PLAUSIBLE since
            # G3-01, X7). The dashboard mirrors them (X7); this is the guard.
            overrides = parse_overrides(body.get("overrides"), auto, bounds=CORRECTION_BOUNDS)
        except ScoreSigningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

        rebuilt = sofa_form.build(state, now, window=window, admitted_at=admitted,
                                  overrides={o.code: o.value for o in overrides})
        try:
            signed = sign_score(auto, rebuilt, signed_by=caller.actor, overrides=overrides, now=now)
        except ScoreSigningError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
        return _SofaToSign(hospital=hospital, signed_by=caller.actor, now=now, auto=auto,
                           rebuilt=rebuilt, overrides=overrides, signed=signed)

    @app.post("/scores/sofa/{patient_id}/preview")
    async def preview_sofa_form(patient_id: str, body: dict = Body(...), hours: float = 24,
                                authorization: str | None = Header(default=None)):
        """What a signature of this SOFA form WOULD seal, and nothing signed (G2-A4, D6, D12, X19).

        The same helper as the signature — the same permission, device refusal, scope, parsing,
        re-scoring and refusals — and NO audit row of any kind, because nothing was signed. The screen
        shows this number; the signature then sends the same corrections with `expect`, this form's
        fingerprint, and the engine signs only if the form it would seal still has it (X20). The engine
        stays the only scorer.
        """
        s = await _sofa_to_sign(patient_id, body, hours, authorization)
        return {"preview": True, "signed": False, "total": s.rebuilt.total,
                "auto_total": s.auto.total, "overrides": [o.as_dict() for o in s.overrides],
                "form": {**s.rebuilt.as_dict(), "auto_total": s.auto.total},
                "expect": form_digest(s.rebuilt, s.overrides)}

    @app.post("/scores/sofa/{patient_id}")
    async def sign_sofa_form(patient_id: str, body: dict = Body(...), hours: float = 24,
                             authorization: str | None = Header(default=None)):
        """Sign a SOFA severity form, with the clinician's corrections — exactly the form she previewed.

        The form arrives pre-filled, which is the product's value and also its risk: a number that
        appeared on its own is a number nobody checked. This is where a person takes responsibility
        for it.

        A correction replaces the VALUE and the row is re-scored from the table — a clinician says
        "the platelet count was 38", never "this row scores 2". Both numbers are kept, because a
        pattern of corrections on one parameter is exactly the signal that a feed is wrong, and an
        override that erased the original would destroy the only evidence of it.

        G2-A4 (D12, X20): the body is `{overrides, expect}`, `expect` being the fingerprint the preview
        answered. The engine rebuilds the form it would seal from the same corrections; if its
        fingerprint is not the previewed one — another desk charted, the window moved past a reading,
        other corrections were sent — the answer is 409 and nothing is written: she re-previews and
        signs what she then sees.

        The signature goes into the append-only audit and is sealed into its hash chain, so the
        record of who signed what cannot later be edited quietly.
        """
        s = await _sofa_to_sign(patient_id, body, hours, authorization)
        if "preview" in body:
            # G2-A4 (X19): this route previewed once, on `preview: true`; the preview has its own route
            # now. A body that still asks for one — any value — is refused, so an older screen asking
            # this route for a preview can never sign.
            raise HTTPException(status_code=400,
                                detail="önizleme imza yolundan istenemez — önizleme yolunu kullanın")
        expect = body.get("expect")
        if not isinstance(expect, str) or not FORM_DIGEST_SHAPE.fullmatch(expect):
            raise HTTPException(status_code=400,
                                detail="imza bir önizlemenin parmak izini ister — önce önizleyin")
        if form_digest(s.rebuilt, s.overrides) != expect:
            # G2-A4 (X20): the form moved since the preview (X11's case, now refused rather than signed) — a
            # new reading, the window sliding past one, or another window, correction or reason sent (review 3,
            # M-1, M-5: the sentence says more than "the record changed").
            raise HTTPException(
                status_code=409,
                detail="form önizlemeden sonra değişti (yeni kayıt ya da pencere kayması) — formu yeniden önizleyin")

        audit.append(AuditEvent(s.hospital, "score_signed", patient_id, "SOFA", {
            "total": s.signed.total,
            "auto_total": s.auto.total,
            "window_hours": s.rebuilt.window_hours,
            "unmeasured": s.rebuilt.unmeasured_organs,
            "overrides": [o.as_dict() for o in s.overrides],
            "signed_by": s.signed_by,
            "at": s.now.isoformat(),
            # G2-A4 review 3 (M-9): the fingerprint the signature was checked against, sealed with it, so a
            # signature can later be checked against what its preview showed.
            "expect": expect,
        }))
        return s.signed.as_dict()

    @app.get("/alarm-quality")
    async def get_alarm_quality(days: int = 7, limit: int = 20000,
                                authorization: str | None = Header(default=None)):
        """Of the alarms this system raised, how many did a human answer, and how fast?

        The number the product's whole premise rests on, and nothing computed it. Read from the
        audit log rather than from `AckStore` because the store is live state that a restart
        empties — a quality figure quoted to a hospital has to come from the durable record.
        """
        caller = await _caller(authorization)
        _require(caller, AUDIT_VIEW)
        if not _readable(await _scope(authorization)).unrestricted:   # G2-A2 (D13b): 503 first
            # The report spans every bed in the hospital — its noisiest beds are patient ids —
            # so it follows the whole-trail rule of /audit rather than leaking past a scope.
            raise HTTPException(status_code=403,
                                detail="alarm kalitesi raporunun tamamı kapsam dışı")
        hospital = caller.hospital
        now = datetime.now(timezone.utc)
        since = now - timedelta(days=max(1, days))
        # The window is the backend's to read (G2-A2, D12): its newest rows, at most `cap`, and one
        # more to know whether it held more — then the report says `truncated` rather than reading
        # as the whole window (the trends pattern, api/trends.py `_markers`). Only the kinds the
        # report counts (Aşama B, T6 review): a row of any other kind — an `ingest`, the shadow
        # lane's `shadow_alert` — would take a place under the cap and move every counter.
        cap = max(1, min(limit, ALARM_QUALITY_LIMIT_MAX))
        recs = audit.records(tenant=hospital, since=since, limit=cap + 1, newest=True,
                             event_types=EPISODE_KINDS)
        truncated = len(recs) > cap
        report = alarm_quality(recs[1:] if truncated else recs, now)
        return {**report.as_dict(), "days": days, "truncated": truncated}

    @app.get("/audit/verify")
    async def verify_audit(limit: int = 10000, authorization: str | None = Header(default=None)):
        """Has this hospital's audit log been altered?

        Recomputes every seal from the genesis hash forward and names the first record that fails.
        Deliberately unfiltered: a chain can only be verified as the complete run for one tenant,
        because a filtered slice is missing its own predecessors by construction and would report a
        break that is not there. `limit` bounds the work, and the response says how far it got so a
        partial verification is never mistaken for a whole one.
        """
        caller = await _caller(authorization)
        _require(caller, AUDIT_VIEW)
        hospital = caller.hospital
        cap = min(limit, AUDIT_VERIFY_LIMIT_MAX)
        recs = audit.records(tenant=hospital, limit=cap)
        report = verify_chain(recs)
        return {**report.as_dict(), "records": len(recs), "complete": len(recs) < cap}

    return app
