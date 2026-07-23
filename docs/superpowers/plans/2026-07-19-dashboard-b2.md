# Dashboard B2 — Acknowledge + Escalation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live board actionable — a clinician acknowledges an alert, and an unacknowledged high-urgency alert escalates on a server-side timer — all streamed to the React board over the existing SSE.

**Architecture:** A per-tenant `AckStore` holds acknowledgements and each alert's first-seen wall-clock time *outside* the (frozen) `Alert`. A pure `escalate(...)` function decides which high-urgency, unacknowledged, past-threshold alerts are escalated; a background asyncio task calls it periodically and republishes changed boards. `POST /ack` records an acknowledgement, clears escalation, and republishes. The board JSON gains ack/escalation fields; the React dashboard adds a role selector, an Onayla button, and an escalated banner + section.

**Tech Stack:** Python 3.14 · FastAPI · anyio (tests) · httpx ASGITransport · React 18 + Vite · Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-19-dashboard-b2-ack-escalation-design.md`

**Working dir:** repo root. venv python: `homunculus-engine/.venv/Scripts/python.exe`. Backend tests: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine -q -p no:cacheprovider`. Frontend: run inside `dashboard/`.

**Two clocks — do not confuse them.** The engine evaluates clinical rules at each **observation timestamp** (`now=obs.timestamp`). Escalation is a **workflow timer** measuring real elapsed time an alert has sat unacknowledged in front of clinicians, so first-seen and the escalation clock use **wall-clock `datetime.now(timezone.utc)`**. This is why the replay demo escalates 5 real minutes after an alert appears, not instantly despite the scenario's 2026-07-14 timestamps.

**SSE gotchas carried from B1:** do NOT call `request.is_disconnected()` in the stream endpoint; httpx `ASGITransport` cannot read an unbounded stream incrementally (test frame generators / the broadcaster directly); if a test run hangs, kill stray venv `python.exe` (`Get-Process python | Where Path -like '*homunculus-engine*' | Stop-Process -Force`).

**Charter (unchanged):** recommendations never orders; no diagnosis; every alert cites the vault; no PHI.

---

## File structure

Backend (`homunculus-engine/`):
- `src/homunculus/api/ackstore.py` — **new.** Per-tenant `AckStore`: acks, first_seen, escalated.
- `src/homunculus/api/escalation.py` — **new.** Pure `escalate(...)`.
- `src/homunculus/api/board.py` — **modify.** `patient_board`/`board_snapshot` take an `AckStore` and merge ack/escalation fields.
- `src/homunculus/api/app.py` — **modify.** Per-tenant stores; `/ingest` stamps first-seen + prunes; `/patients` uses the store; `POST /ack`; background escalation loop via lifespan; expose `escalation_cycle` + `ack_stores` on `app.state` for tests.
- Tests: `tests/test_escalation.py`, `tests/test_api_ack.py`, and additions to `tests/test_board.py`.

Frontend (`dashboard/`):
- `src/api.js` — **modify.** Add `ackAlert(token, patientId, kind, role)`.
- `src/PatientDetail.jsx` (+ test) — Onayla button, acknowledged rendering, escalated banner.
- `src/Board.jsx` (+ test) — role selector, Eskale section, pass ack callback down.

---

## Task 1: `escalate()` pure function

**Files:** Create `homunculus-engine/src/homunculus/api/escalation.py`; Test `homunculus-engine/tests/test_escalation.py`.

- [ ] **Step 1: Write the failing test** (`tests/test_escalation.py`)

```python
# tests/test_escalation.py
from datetime import datetime, timedelta, timezone

from homunculus.api.escalation import escalate
from homunculus.reco.engine import Alert

T0 = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
THRESH = timedelta(minutes=5)


def _alert(kind, urgency):
    return Alert(patient_id="bed-3", kind=kind, severity="critical", urgency=urgency,
                 summary="", clinical_reasoning="", supporting_evidence=[],
                 recommended_actions=[], confidence="")


def test_unacked_immediate_alert_past_threshold_escalates():
    alerts = [("bed-3", _alert("septic_shock", "immediate"))]
    first_seen = {("bed-3", "septic_shock"): T0}
    now = T0 + timedelta(minutes=6)
    assert escalate(alerts, acks={}, first_seen=first_seen, now=now, threshold=THRESH) == {("bed-3", "septic_shock")}


def test_acknowledged_alert_does_not_escalate():
    alerts = [("bed-3", _alert("septic_shock", "immediate"))]
    first_seen = {("bed-3", "septic_shock"): T0}
    acks = {("bed-3", "septic_shock"): {"by": "nurse", "at": T0}}
    now = T0 + timedelta(minutes=6)
    assert escalate(alerts, acks=acks, first_seen=first_seen, now=now, threshold=THRESH) == set()


def test_non_immediate_alert_does_not_escalate():
    alerts = [("bed-3", _alert("sepsis", "soon"))]
    first_seen = {("bed-3", "sepsis"): T0}
    now = T0 + timedelta(minutes=60)
    assert escalate(alerts, acks={}, first_seen=first_seen, now=now, threshold=THRESH) == set()


def test_before_threshold_does_not_escalate():
    alerts = [("bed-3", _alert("septic_shock", "immediate"))]
    first_seen = {("bed-3", "septic_shock"): T0}
    now = T0 + timedelta(minutes=4, seconds=59)
    assert escalate(alerts, acks={}, first_seen=first_seen, now=now, threshold=THRESH) == set()
```

- [ ] **Step 2: Run it, verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_escalation.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.escalation'`.

- [ ] **Step 3: Implement** (`src/homunculus/api/escalation.py`)

```python
# src/homunculus/api/escalation.py
"""Pure escalation logic: which high-urgency, unacknowledged, past-threshold alerts are escalated.
Clock-injected so it is unit-tested without waiting on a real timer."""
from __future__ import annotations

from datetime import datetime, timedelta

from homunculus.reco.engine import Alert


def escalate(
    alerts: list[tuple[str, Alert]],
    acks: dict[tuple[str, str], dict],
    first_seen: dict[tuple[str, str], datetime],
    now: datetime,
    threshold: timedelta,
) -> set[tuple[str, str]]:
    escalated: set[tuple[str, str]] = set()
    for patient_id, alert in alerts:
        if alert.urgency != "immediate":
            continue
        key = (patient_id, alert.kind)
        if key in acks:
            continue
        seen = first_seen.get(key)
        if seen is not None and now - seen >= threshold:
            escalated.add(key)
    return escalated
```

- [ ] **Step 4: Run it, verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_escalation.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/escalation.py homunculus-engine/tests/test_escalation.py
git commit -m "feat(engine): pure escalate() — unacked immediate alerts past threshold"
```

---

## Task 2: `AckStore`

**Files:** Create `homunculus-engine/src/homunculus/api/ackstore.py`; Test `homunculus-engine/tests/test_ackstore.py`.

- [ ] **Step 1: Write the failing test** (`tests/test_ackstore.py`)

```python
# tests/test_ackstore.py
from datetime import datetime, timezone

from homunculus.api.ackstore import AckStore

T0 = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)


def test_first_seen_is_stamped_once():
    s = AckStore()
    s.stamp_first_seen("bed-3", "septic_shock", T0)
    s.stamp_first_seen("bed-3", "septic_shock", T0.replace(minute=5))  # ignored
    assert s.first_seen[("bed-3", "septic_shock")] == T0


def test_acknowledge_records_role_and_time():
    s = AckStore()
    s.acknowledge("bed-3", "septic_shock", "nurse", T0)
    assert s.acks[("bed-3", "septic_shock")] == {"by": "nurse", "at": T0}


def test_prune_drops_entries_no_longer_live():
    s = AckStore()
    s.stamp_first_seen("bed-3", "septic_shock", T0)
    s.acknowledge("bed-3", "septic_shock", "nurse", T0)
    s.escalated.add(("bed-3", "septic_shock"))
    s.prune(live_keys=set())  # nothing live anymore
    assert s.first_seen == {} and s.acks == {} and s.escalated == set()
```

- [ ] **Step 2: Run it, verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_ackstore.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.ackstore'`.

- [ ] **Step 3: Implement** (`src/homunculus/api/ackstore.py`)

```python
# src/homunculus/api/ackstore.py
"""Per-tenant acknowledgement + escalation state, kept OUTSIDE the frozen Alert (which the engine
regenerates on every ingest). Keyed by (patient_id, kind)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class AckStore:
    acks: dict[tuple[str, str], dict] = field(default_factory=dict)
    first_seen: dict[tuple[str, str], datetime] = field(default_factory=dict)
    escalated: set[tuple[str, str]] = field(default_factory=set)

    def stamp_first_seen(self, patient_id: str, kind: str, now: datetime) -> None:
        self.first_seen.setdefault((patient_id, kind), now)

    def acknowledge(self, patient_id: str, kind: str, role: str, now: datetime) -> None:
        self.acks[(patient_id, kind)] = {"by": role, "at": now}

    def prune(self, live_keys: set[tuple[str, str]]) -> None:
        """Drop state for alert kinds that are no longer active, so a re-raised alert starts fresh."""
        for mapping in (self.acks, self.first_seen):
            for key in [k for k in mapping if k not in live_keys]:
                del mapping[key]
        self.escalated &= live_keys
```

- [ ] **Step 4: Run it, verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_ackstore.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/ackstore.py homunculus-engine/tests/test_ackstore.py
git commit -m "feat(engine): per-tenant AckStore (acks + first-seen + escalated)"
```

---

## Task 3: board.py merges ack + escalation fields

**Files:** Modify `homunculus-engine/src/homunculus/api/board.py`; Test: append to `homunculus-engine/tests/test_board.py`.

Current `patient_board(engine, patient_id)` and `board_snapshot(engine)` gain a required `store: AckStore` argument and merge ack/escalation fields into each alert dict.

- [ ] **Step 1: Write the failing test** (append to `tests/test_board.py`)

```python
def test_patient_board_merges_ack_and_escalation_fields():
    from datetime import timezone
    from homunculus.api.ackstore import AckStore
    from homunculus.canonical import Observation, SignalCode
    eng = Engine()
    ts = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    # Drive a septic_shock alert the simplest way: reuse the scenario loader path is heavy here,
    # so assert on the *shape* using a low-acuity ingest that raises no alert, plus a manual store.
    eng.ingest(Observation("bed-3", SignalCode.HEART_RATE, 90.0, "bpm", ts, "mon"), now=ts)
    store = AckStore()
    board = patient_board(eng, "bed-3", store)
    assert board["alerts"] == []           # no alert, but the call signature now takes a store
    # With an alert present the per-alert dict must carry the new keys; check the merge helper:
    from homunculus.api.board import _merge_alert
    from homunculus.reco.engine import Alert
    a = Alert(patient_id="bed-3", kind="septic_shock", severity="critical", urgency="immediate",
              summary="s", clinical_reasoning="r", supporting_evidence=["sepsis-3-jama-2016"],
              recommended_actions=["Consider repeat lactate."], confidence="c")
    store.stamp_first_seen("bed-3", "septic_shock", ts)
    store.acknowledge("bed-3", "septic_shock", "nurse", ts)
    store.escalated.add(("bed-3", "septic_shock"))
    d = _merge_alert("bed-3", a, store)
    assert d["acknowledged"] is True
    assert d["acknowledged_by"] == "nurse"
    assert d["escalated"] is True
    assert d["first_seen_at"] == ts.isoformat()
    assert d["kind"] == "septic_shock" and d["supporting_evidence"] == ["sepsis-3-jama-2016"]
```

- [ ] **Step 2: Run it, verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_board.py -q`
Expected: FAIL — `patient_board()` missing the `store` argument / `_merge_alert` not defined.

- [ ] **Step 3: Implement** — replace the body of `src/homunculus/api/board.py` with:

```python
# src/homunculus/api/board.py
"""Pure builders that turn an Engine's state (+ ack/escalation store) into the dashboard's board JSON."""
from __future__ import annotations

from dataclasses import asdict

from homunculus.api.ackstore import AckStore
from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.sofa import total_sofa

_SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]


def _risk(alerts: list[Alert]) -> str:
    if not alerts:
        return "none"
    return max((a.severity for a in alerts), key=_SEVERITY_ORDER.index)


def _latest(state, code: SignalCode):
    obs = state.latest(code)
    return None if obs is None else obs.value


def _merge_alert(patient_id: str, alert: Alert, store: AckStore) -> dict:
    key = (patient_id, alert.kind)
    ack = store.acks.get(key)
    seen = store.first_seen.get(key)
    return {
        **asdict(alert),
        "acknowledged": ack is not None,
        "acknowledged_by": ack["by"] if ack else None,
        "acknowledged_at": ack["at"].isoformat() if ack else None,
        "first_seen_at": seen.isoformat() if seen is not None else None,
        "escalated": key in store.escalated,
    }


def patient_board(engine: Engine, patient_id: str, store: AckStore) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
        "patient_id": patient_id,
        "risk": _risk(alerts),
        "alerts": [_merge_alert(patient_id, a, store) for a in alerts],
        "latest": {
            "heart_rate": _latest(state, SignalCode.HEART_RATE),
            "map": _latest(state, SignalCode.MAP),
            "lactate": _latest(state, SignalCode.LACTATE),
            "sofa": total_sofa(state),
        },
    }


def board_snapshot(engine: Engine, store: AckStore) -> list[dict]:
    return [patient_board(engine, pid, store) for pid in engine.patient_ids()]
```

- [ ] **Step 4: Run it, verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_board.py -q`
Expected: FAIL — the pre-existing board tests from B1 call `patient_board(eng, "bed-3")` and `board_snapshot(eng)` without a store. Update those three call sites to pass `AckStore()`:
- In `test_patient_board_carries_risk_alerts_and_latest_values`: `patient_board(eng, "bed-3", AckStore())`.
- In `test_board_snapshot_lists_every_patient`: `board_snapshot(eng, AckStore())`.
- Add `from homunculus.api.ackstore import AckStore` to the test imports.
Then re-run: PASS (all board tests).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_board.py
git commit -m "feat(engine): board merges ack + escalation fields per alert"
```

---

## Task 4: Wire the API — stores, first-seen, POST /ack, escalation loop

**Files:** Modify `homunculus-engine/src/homunculus/api/app.py`; Test `homunculus-engine/tests/test_api_ack.py`; the existing `tests/test_api_stream.py` and `tests/test_api_ingest.py` call `patient_board`/`board_snapshot` only through the app, so they keep working once the app passes stores internally.

- [ ] **Step 1: Write the failing tests** (`tests/test_api_ack.py`)

```python
# tests/test_api_ack.py
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _client():
    return TestClient(create_app({"tok": "HOSP1", "tok2": "HOSP2"}, run_escalation_loop=False))


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def _drive_shock(client, token="tok"):
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr(token))
    return "bed-3"


def test_ack_marks_the_alert_acknowledged_in_the_board():
    c = _client()
    p = _drive_shock(c)
    r = c.post("/ack", json={"patient_id": p, "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 200
    board = c.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == p for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["acknowledged"] is True
    assert shock["acknowledged_by"] == "nurse"


def test_ack_of_unknown_alert_is_404():
    c = _client()
    _drive_shock(c)
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "no_such_kind", "role": "nurse"}, headers=_hdr("tok"))
    assert r.status_code == 404


def test_ack_requires_a_tenant_token():
    c = _client()
    assert c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}).status_code == 401


def test_ack_is_tenant_isolated():
    c = _client()
    _drive_shock(c, "tok")  # HOSP1 has bed-3 shock
    r = c.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "nurse"}, headers=_hdr("tok2"))
    assert r.status_code == 404  # HOSP2 has no such alert


@pytest.mark.anyio
async def test_escalation_cycle_flips_unacked_immediate_alert():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    store.first_seen[key] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)  # force it into the past
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert key in store.escalated
    board = client.get("/patients", headers=_hdr("tok")).json()["patients"]
    shock = next(a for b in board if b["patient_id"] == "bed-3" for a in b["alerts"] if a["kind"] == "septic_shock")
    assert shock["escalated"] is True


@pytest.mark.anyio
async def test_ack_clears_escalation():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(minutes=5), run_escalation_loop=False)
    client = TestClient(app)
    for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
        client.post("/ingest", json=fhir, headers=_hdr("tok"))
    store = app.state.ack_stores["HOSP1"]
    key = ("bed-3", "septic_shock")
    store.first_seen[key] = datetime(2026, 7, 19, 10, 0, tzinfo=timezone.utc)
    await app.state.escalation_cycle(datetime(2026, 7, 19, 10, 6, tzinfo=timezone.utc))
    assert key in store.escalated
    client.post("/ack", json={"patient_id": "bed-3", "kind": "septic_shock", "role": "doctor"}, headers=_hdr("tok"))
    assert key not in store.escalated  # ack immediately clears escalation
```

- [ ] **Step 2: Run them, verify they fail**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_api_ack.py -q`
Expected: FAIL — `create_app()` has no `run_escalation_loop` kwarg / no `/ack` route / no `app.state.ack_stores`.

- [ ] **Step 3: Implement** — replace `src/homunculus/api/app.py` with:

```python
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
from homunculus.api.board import board_snapshot, patient_board
from homunculus.api.broadcast import Broadcaster
from homunculus.api.escalation import escalate
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


def create_app(
    tenants: dict[str, str],
    *,
    escalate_after: timedelta = timedelta(minutes=5),
    escalate_interval: float = 20.0,
    run_escalation_loop: bool = True,
) -> FastAPI:
    """`tenants` maps bearer token -> hospital id. Escalation params are injectable for tests;
    run_escalation_loop=False disables the background task so tests are deterministic."""
    engines: dict[str, Engine] = {}
    stores: dict[str, AckStore] = {}
    broadcaster = Broadcaster()

    def _engine(hospital: str) -> Engine:
        return engines.setdefault(hospital, Engine())

    def _store(hospital: str) -> AckStore:
        return stores.setdefault(hospital, AckStore())

    def _live_keys(engine: Engine) -> set[tuple[str, str]]:
        return {(pid, a.kind) for pid in engine.patient_ids() for a in engine.active_alerts(pid)}

    async def _escalation_cycle(now: datetime) -> None:
        for hospital, engine in list(engines.items()):
            store = _store(hospital)
            alerts = [(pid, a) for pid in engine.patient_ids() for a in engine.active_alerts(pid)]
            newly = escalate(alerts, store.acks, store.first_seen, now, escalate_after)
            if newly != store.escalated:
                changed = {pid for (pid, _k) in (newly ^ store.escalated)}
                store.escalated = newly
                for pid in changed:
                    await broadcaster.publish(hospital, patient_board(engine, pid, store))

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
        # First-seen uses WALL-CLOCK time (escalation measures real elapsed time, not observation time).
        wall_now = datetime.now(timezone.utc)
        for a in engine.active_alerts(obs.patient_id):
            store.stamp_first_seen(obs.patient_id, a.kind, wall_now)
        store.prune(_live_keys(engine))
        await broadcaster.publish(hospital, patient_board(engine, obs.patient_id, store))
        return {"patient_id": obs.patient_id, "alerts": [asdict(a) for a in alerts]}

    @app.post("/ack")
    async def ack(authorization: str | None = Header(default=None), body: dict = Body(...)):
        hospital = _tenant(authorization)
        engine = _engine(hospital)
        store = _store(hospital)
        patient_id, kind, role = body.get("patient_id"), body.get("kind"), body.get("role", "unknown")
        if (patient_id, kind) not in _live_keys(engine):
            raise HTTPException(status_code=404, detail="no such active alert")
        store.acknowledge(patient_id, kind, role, datetime.now(timezone.utc))
        store.escalated.discard((patient_id, kind))  # ack immediately stops escalation
        board = patient_board(engine, patient_id, store)
        await broadcaster.publish(hospital, board)
        return board

    @app.get("/patients")
    def patients(authorization: str | None = Header(default=None)):
        hospital = _tenant(authorization)
        return {"patients": board_snapshot(_engine(hospital), _store(hospital))}

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

    return app
```

Note: the `GET /alerts/{patient_id}` route from B1 is dropped — the board (`/patients` + `/stream`) is the single source of truth and nothing consumes `/alerts`. If any test references it, delete that test.

- [ ] **Step 4: Run the whole backend suite, verify green**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine -q -p no:cacheprovider`
Expected: PASS. If a stream test hangs, kill stray venv python (see header) — it is contention from a previous run, not this code. If `test_api_ingest.py` referenced `GET /alerts/...`, remove those assertions.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_ack.py
git commit -m "feat(engine): POST /ack + server-side escalation loop; /ingest stamps first-seen"
```

---

## Task 5: Frontend — ackAlert transport

**Files:** Modify `dashboard/src/api.js`.

- [ ] **Step 1: Implement** — append to `dashboard/src/api.js`:

```javascript
// Acknowledge an alert. Returns the updated patient board.
export async function ackAlert(token, patientId, kind, role) {
  const res = await fetch("/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ patient_id: patientId, kind, role }),
  });
  if (!res.ok) throw new Error(`POST /ack failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Add the /ack proxy** — in `dashboard/vite.config.js`, add `"/ack": "http://localhost:8000",` to the `server.proxy` object (next to `/patients`, `/stream`, `/ingest`).

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/api.js dashboard/vite.config.js
git commit -m "feat(dashboard): ackAlert transport + /ack dev proxy"
```

---

## Task 6: Frontend — PatientDetail acknowledge + escalated

**Files:** Modify `dashboard/src/PatientDetail.jsx`; Modify `dashboard/src/PatientDetail.test.jsx`.

`PatientDetail` gains an `onAck(kind)` prop. Each alert card: if `alert.escalated`, show a red "ESKALE EDİLDİ" banner; if `alert.acknowledged`, show "✓ Onaylandı: {by} · {time}"; else an "Onayla" button calling `onAck(alert.kind)`.

- [ ] **Step 1: Write the failing test** (append to `dashboard/src/PatientDetail.test.jsx`; add `vi`, `fireEvent` to the imports at the top: `import { describe, it, expect, vi } from "vitest";` and `import { render, screen, fireEvent } from "@testing-library/react";`)

```javascript
describe("PatientDetail acknowledge/escalation", () => {
  const escalated = {
    patient_id: "bed-3", risk: "critical", latest: { sofa: 8 },
    alerts: [{
      kind: "septic_shock", severity: "critical", urgency: "immediate",
      summary: "Septik şok", clinical_reasoning: "r", supporting_evidence: ["sepsis-3-jama-2016"],
      recommended_actions: ["Consider repeat lactate."], confidence: "c",
      acknowledged: false, acknowledged_by: null, acknowledged_at: null,
      first_seen_at: "2026-07-19T10:00:00+00:00", escalated: true,
    }],
  };

  it("shows the escalation banner and an Onayla button, and calls onAck", () => {
    const onAck = vi.fn();
    render(<PatientDetail patient={escalated} onAck={onAck} />);
    expect(screen.getByText("ESKALE EDİLDİ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Onayla/ }));
    expect(onAck).toHaveBeenCalledWith("septic_shock");
  });

  it("shows acknowledged text and no Onayla button once acknowledged", () => {
    const acked = { ...escalated, alerts: [{
      ...escalated.alerts[0], escalated: false,
      acknowledged: true, acknowledged_by: "hemşire", acknowledged_at: "2026-07-19T10:06:00+00:00",
    }] };
    render(<PatientDetail patient={acked} onAck={() => {}} />);
    expect(screen.getByText(/Onaylandı: hemşire/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Onayla/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `dashboard/`): `npm test -- PatientDetail`
Expected: FAIL — no escalation banner / no Onayla button.

- [ ] **Step 3: Implement** — replace `dashboard/src/PatientDetail.jsx`'s `AlertCard` and `PatientDetail` with:

```javascript
import React from "react";
import { riskColor } from "./risk.js";

function LatestStrip({ latest }) {
  const items = [["HR", latest.heart_rate], ["MAP", latest.map], ["Laktat", latest.lactate], ["SOFA", latest.sofa]];
  return (
    <div style={{ display: "flex", gap: 16, margin: "8px 0 16px", color: "#333" }}>
      {items.map(([k, v]) => (<span key={k}><strong>{k}</strong> {v ?? "—"}</span>))}
    </div>
  );
}

function AlertCard({ patientId, alert, onAck }) {
  const at = alert.acknowledged_at ? new Date(alert.acknowledged_at).toLocaleTimeString() : "";
  return (
    <div style={{ border: `1px solid ${riskColor(alert.severity)}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
      {alert.escalated && (
        <div style={{ background: "#c0392b", color: "#fff", fontWeight: 700, padding: "4px 8px", borderRadius: 4, marginBottom: 8 }}>
          ESKALE EDİLDİ
        </div>
      )}
      <div style={{ color: riskColor(alert.severity), fontWeight: 700 }}>⚠ {alert.summary}</div>
      <p style={{ margin: "8px 0" }}><strong>Gerekçe:</strong> {alert.clinical_reasoning}</p>
      <div style={{ margin: "8px 0" }}>
        <strong>Önerilen:</strong>
        <ul>{alert.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </div>
      <div style={{ fontSize: 13, color: "#555" }}><strong>Kaynak:</strong> {alert.supporting_evidence.join(", ")}</div>
      <div style={{ fontSize: 13, color: "#555" }}><strong>Güven:</strong> {alert.confidence}</div>
      <div style={{ marginTop: 10 }}>
        {alert.acknowledged
          ? <span style={{ color: "#2e7d32", fontWeight: 600 }}>✓ Onaylandı: {alert.acknowledged_by} · {at}</span>
          : <button onClick={() => onAck(alert.kind)}>Onayla</button>}
      </div>
    </div>
  );
}

export function PatientDetail({ patient, onAck = () => {} }) {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0 }}>{patient.patient_id}</h2>
      <LatestStrip latest={patient.latest} />
      {patient.alerts.length === 0
        ? <p style={{ color: "#2e7d32" }}>Aktif uyarı yok.</p>
        : patient.alerts.map((a) => <AlertCard key={a.kind} patientId={patient.patient_id} alert={a} onAck={onAck} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run (from `dashboard/`): `npm test -- PatientDetail`
Expected: PASS (existing B1 PatientDetail tests + the two new ones). The B1 tests pass `patient` without ack fields; `alert.acknowledged` is `undefined` → falsy → the Onayla button renders, which the B1 tests do not assert against, so they still pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/PatientDetail.jsx dashboard/src/PatientDetail.test.jsx
git commit -m "feat(dashboard): acknowledge button + escalation banner on alerts"
```

---

## Task 7: Frontend — Board role selector, ack wiring, Eskale section

**Files:** Modify `dashboard/src/Board.jsx`; Modify `dashboard/src/Board.test.jsx`.

`Board` adds a role selector (doctor/nurse), passes `onAck` to `PatientDetail` (calling `ackAlert`), and renders an "Eskale" section listing every escalated alert across patients.

- [ ] **Step 1: Write the failing test** (append to `dashboard/src/Board.test.jsx`)

```javascript
it("lists escalated alerts in the Eskale section", async () => {
  const escalatedPatient = {
    patient_id: "bed-3", risk: "critical", latest: { sofa: 8 },
    alerts: [{ kind: "septic_shock", severity: "critical", urgency: "immediate", summary: "Septik şok",
      clinical_reasoning: "r", supporting_evidence: ["sepsis-3-jama-2016"], recommended_actions: ["x"],
      confidence: "c", acknowledged: false, escalated: true, first_seen_at: "2026-07-19T10:00:00+00:00" }],
  };
  const fetchBoard = vi.fn().mockResolvedValue([escalatedPatient]);
  const openStream = vi.fn().mockReturnValue(() => {});
  render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
  await waitFor(() => expect(screen.getByText(/Eskale/)).toBeInTheDocument());
  // the escalated patient id appears in the Eskale section
  expect(screen.getAllByText("bed-3").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `dashboard/`): `npm test -- Board`
Expected: FAIL — no "Eskale" section.

- [ ] **Step 3: Implement** — replace `dashboard/src/Board.jsx` with:

```javascript
import React, { useEffect, useState } from "react";
import { PatientList } from "./PatientList.jsx";
import { PatientDetail } from "./PatientDetail.jsx";
import { fetchBoard as realFetchBoard, openStream as realOpenStream, ackAlert as realAckAlert } from "./api.js";

export function Board({ token, fetchBoard = realFetchBoard, openStream = realOpenStream, ackAlert = realAckAlert }) {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [role, setRole] = useState("nurse");

  const mergeBoard = (board) => setPatients((prev) => {
    const rest = prev.filter((p) => p.patient_id !== board.patient_id);
    return [...rest, board].sort((a, b) => a.patient_id.localeCompare(b.patient_id));
  });

  useEffect(() => {
    let closed = false;
    fetchBoard(token).then((list) => { if (!closed) setPatients(list); }).catch(() => {});
    const close = openStream(token, mergeBoard, (s) => setStatus(s === "open" ? "live" : "reconnecting"));
    return () => { closed = true; close(); };
  }, [token, fetchBoard, openStream]);

  const onAck = (patientId, kind) => { ackAlert(token, patientId, kind, role).then(mergeBoard).catch(() => {}); };

  const current = patients.find((p) => p.patient_id === selected) ?? null;
  const escalated = patients.flatMap((p) => p.alerts.filter((a) => a.escalated).map((a) => ({ p, a })));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100vh", fontFamily: "system-ui" }}>
      <aside style={{ borderRight: "1px solid #ddd", overflowY: "auto" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
          <span>Homunculus</span>
          <span style={{ fontSize: 12, color: "#888" }}>{status}</span>
        </div>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 13 }}>
          Rol:{" "}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="nurse">hemşire</option>
            <option value="doctor">doktor</option>
          </select>
        </div>
        {escalated.length > 0 && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", background: "#fdecea" }}>
            <div style={{ color: "#c0392b", fontWeight: 700, fontSize: 13 }}>Eskale ({escalated.length})</div>
            {escalated.map(({ p, a }) => (
              <div key={p.patient_id + a.kind} style={{ cursor: "pointer", fontSize: 13, padding: "2px 0" }}
                   onClick={() => setSelected(p.patient_id)}>
                🔴 {p.patient_id} — {a.summary}
              </div>
            ))}
          </div>
        )}
        <PatientList patients={patients} selected={selected} onSelect={setSelected} />
      </aside>
      <main style={{ overflowY: "auto" }}>
        {current
          ? <PatientDetail patient={current} onAck={(kind) => onAck(current.patient_id, kind)} />
          : <p style={{ padding: 16, color: "#888" }}>Bir hasta seçin.</p>}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the whole frontend suite**

Run (from `dashboard/`): `npm test`
Expected: PASS — all B1 tests plus the new PatientDetail and Board tests. (B1 Board tests pass `fetchBoard`/`openStream`; `ackAlert` defaults to the real one but is never called in those tests.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/Board.jsx dashboard/src/Board.test.jsx
git commit -m "feat(dashboard): role selector, ack wiring, Eskale section"
```

---

## Task 8: Manual end-to-end verification

No new tests — the human-visible proof.

- [ ] **Step 1: Start the backend with a SHORT escalation threshold** (terminal 1, repo root)

The devserver uses the 5-minute default. For a quick demo, run a one-off server with a short threshold:

```bash
homunculus-engine/.venv/Scripts/python.exe -c "import uvicorn; from datetime import timedelta; from homunculus.api.app import create_app; uvicorn.run(create_app({'dev-token':'HOSP1'}, escalate_after=timedelta(seconds=20), escalate_interval=5.0), port=8000)"
```

- [ ] **Step 2: Start the dashboard** (terminal 2, from `dashboard/`)

Run: `npm run dev` — open the printed URL.

- [ ] **Step 3: Replay the scenario** (terminal 3, repo root)

Run: `homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/replay.py`

- [ ] **Step 4 (observe):** bed-3 turns red and a septic-shock alert appears. **Wait ~20 s without acknowledging** → the alert shows "ESKALE EDİLDİ" on its own and appears in the Eskale section (server-driven). Pick a role, click **Onayla** → it shows "✓ Onaylandı: {role} · {time}", the banner clears, and it leaves the Eskale section. No order, no diagnosis anywhere; HOSP2 (if a second token were added) unaffected.

---

## Self-Review (completed during planning)

- **Spec coverage:** ack registry outside the frozen Alert → Task 2 + Task 3. Pure `escalate()` → Task 1. Server-side background loop → Task 4. `POST /ack` marks + clears escalation + publishes → Task 4. Board gains ack/escalation fields → Task 3. First-seen = wall-clock → Task 4 (`/ingest`). Threshold 5 min, high-urgency only, configurable → Tasks 1 + 4. Role via request field → Tasks 4 (`/ack`) + 7 (selector). Frontend Onayla + acknowledged rendering → Task 6. Escalation banner + Eskale section → Tasks 6 + 7. Tenant isolation tested → Task 4. Prune on cleared kind → Tasks 2 + 4. Manual e2e → Task 8.
- **Placeholder scan:** none — every step has complete code.
- **Type consistency:** `AckStore` fields (`acks`, `first_seen`, `escalated`) defined in Task 2 are used identically in Tasks 3 and 4; `escalate(alerts, acks, first_seen, now, threshold)` signature is identical in Task 1 and its call in Task 4; board JSON keys (`acknowledged`, `acknowledged_by`, `acknowledged_at`, `first_seen_at`, `escalated`) are identical across Tasks 3, 6, 7; `ackAlert(token, patientId, kind, role)` (Task 5) matches `Board`'s call (Task 7) and the `/ack` body (Task 4). `Alert.urgency` is the string `"immediate"` (from `reco/engine.py`), which Task 1 keys on.
- **B1 impact:** `patient_board`/`board_snapshot` gained a required `store` argument — the three B1 board-test call sites are updated in Task 3 Step 4; all app call sites are updated in Task 4. The `GET /alerts/{patient_id}` route is removed (nothing consumes it); any test asserting it is deleted in Task 4.
