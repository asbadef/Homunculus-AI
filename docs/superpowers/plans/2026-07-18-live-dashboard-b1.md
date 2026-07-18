# Live Dashboard B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only live clinical board — the FastAPI app streams engine alerts over SSE to a React master-detail dashboard that shows each patient's risk and, on selection, the alert's reasoning, vault citations, and recommended actions.

**Architecture:** Extend the existing `homunculus-engine` FastAPI app with a tenant board snapshot (`GET /patients`), an SSE stream (`GET /stream`), and an in-process per-tenant asyncio broadcaster that `/ingest` publishes to. A new `dashboard/` React+Vite app loads the snapshot, subscribes to the stream, and renders a master-detail board. Tenant bearer token throughout (query param for SSE). No ack/escalation/notification, no per-clinician auth, no PHI.

**Tech Stack:** Python 3.14 · FastAPI · anyio (tests) · httpx (ASGI test client) · uvicorn (dev) · React 18 + Vite · Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-18-live-dashboard-b1-design.md`

**Working dir:** repo root `c:\Users\User\Desktop\Project\Homunculus AI`. venv python: `homunculus-engine/.venv/Scripts/python.exe`. Run backend tests from repo root: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine -q`. Frontend commands run inside `dashboard/`.

**Charter (unchanged):** recommendations never orders; no diagnosis; every alert cites the vault; no PHI (synthetic scenarios only).

---

## File structure

Backend (in `homunculus-engine/`):
- `src/homunculus/api/broadcast.py` — **new.** In-process per-tenant async pub/sub.
- `src/homunculus/api/board.py` — **new.** Pure builders: `patient_board`, `board_snapshot`, `_risk`.
- `src/homunculus/pipeline.py` — **modify.** Add `patient_ids()` and `state()` accessors to `Engine`.
- `src/homunculus/api/app.py` — **modify.** Add broadcaster; make `/ingest` async + publish; add `/patients` and `/stream`.
- `src/homunculus/api/devserver.py` — **new.** `app = create_app({"dev-token": "HOSP1"})` for uvicorn.
- `pyproject.toml` — **modify.** Add `uvicorn` (dev).
- Tests: `tests/test_broadcast.py`, `tests/test_board.py`, `tests/test_api_stream.py`, and additions to `tests/test_api_ingest.py`.

Frontend (new top-level `dashboard/`):
- `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`
- `src/risk.js` (+ `src/risk.test.js`) — risk → label/color.
- `src/api.js` — `fetchBoard(token)`, `openStream(token, onUpdate)`.
- `src/PatientList.jsx` (+ test) — list, colored rows, selection.
- `src/PatientDetail.jsx` (+ test) — alerts (reasoning, citations, actions, confidence) + latest strip.
- `src/Board.jsx` (+ test) — master-detail container; loads snapshot, merges stream updates.

---

## Task 1: Engine board accessors

**Files:** Modify `homunculus-engine/src/homunculus/pipeline.py`; Test `homunculus-engine/tests/test_pipeline.py` (append).

- [ ] **Step 1: Write the failing test** (append to `tests/test_pipeline.py`)

```python
def test_engine_exposes_patient_ids_and_state():
    from datetime import datetime, timezone
    from homunculus.canonical import Observation, SignalCode
    eng = Engine()
    ts = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)
    eng.ingest(Observation("bed-3", SignalCode.HEART_RATE, 118.0, "bpm", ts, "mon"), now=ts)
    assert eng.patient_ids() == ["bed-3"]
    assert eng.state("bed-3").latest(SignalCode.HEART_RATE).value == 118.0
```

(If `test_pipeline.py` does not already import `Engine`, add `from homunculus.pipeline import Engine` at the top.)

- [ ] **Step 2: Run it, verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_pipeline.py -q`
Expected: FAIL — `AttributeError: 'Engine' object has no attribute 'patient_ids'`.

- [ ] **Step 3: Implement** — add these two methods to the `Engine` class in `pipeline.py` (after `active_alerts`), and add the import near the top:

```python
# add to the imports at the top of pipeline.py:
from homunculus.state.timeline import PatientState
```

```python
    def patient_ids(self) -> list[str]:
        return self._repo.patient_ids()

    def state(self, patient_id: str) -> PatientState:
        return self._repo.get_or_create(patient_id)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_pipeline.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/pipeline.py homunculus-engine/tests/test_pipeline.py
git commit -m "feat(engine): expose Engine.patient_ids() and state() for the board"
```

---

## Task 2: Broadcaster (in-process per-tenant pub/sub)

**Files:** Create `homunculus-engine/src/homunculus/api/broadcast.py`; Test `homunculus-engine/tests/test_broadcast.py`.

- [ ] **Step 1: Write the failing test** (`tests/test_broadcast.py`)

```python
# tests/test_broadcast.py
import pytest

from homunculus.api.broadcast import Broadcaster


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_subscriber_receives_published_message():
    b = Broadcaster()
    q = b.subscribe("HOSP1")
    await b.publish("HOSP1", {"x": 1})
    assert await q.get() == {"x": 1}


@pytest.mark.anyio
async def test_publish_is_tenant_isolated():
    b = Broadcaster()
    q1 = b.subscribe("HOSP1")
    q2 = b.subscribe("HOSP2")
    await b.publish("HOSP1", {"x": 1})
    assert q1.qsize() == 1
    assert q2.qsize() == 0


@pytest.mark.anyio
async def test_unsubscribe_stops_delivery():
    b = Broadcaster()
    q = b.subscribe("HOSP1")
    b.unsubscribe("HOSP1", q)
    await b.publish("HOSP1", {"x": 1})
    assert q.qsize() == 0
```

- [ ] **Step 2: Run it, verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_broadcast.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.broadcast'`. (The `@pytest.mark.anyio` marker is provided by the already-installed `anyio` pytest plugin.)

- [ ] **Step 3: Implement** (`src/homunculus/api/broadcast.py`)

```python
# src/homunculus/api/broadcast.py
"""In-process per-tenant pub/sub for live board updates. One process only; the multi-process
fan-out (Redis/Postgres) is Plan B slice B4."""
from __future__ import annotations

import asyncio


class Broadcaster:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, tenant: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(tenant, set()).add(queue)
        return queue

    def unsubscribe(self, tenant: str, queue: asyncio.Queue) -> None:
        subs = self._subs.get(tenant)
        if subs:
            subs.discard(queue)
            if not subs:
                self._subs.pop(tenant, None)

    async def publish(self, tenant: str, message: dict) -> None:
        for queue in list(self._subs.get(tenant, ())):
            await queue.put(message)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_broadcast.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/broadcast.py homunculus-engine/tests/test_broadcast.py
git commit -m "feat(engine): in-process per-tenant Broadcaster for live board updates"
```

---

## Task 3: Board builders (pure)

**Files:** Create `homunculus-engine/src/homunculus/api/board.py`; Test `homunculus-engine/tests/test_board.py`.

- [ ] **Step 1: Write the failing test** (`tests/test_board.py`)

```python
# tests/test_board.py
from datetime import datetime, timezone

from homunculus.api.board import _risk, board_snapshot, patient_board
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert

T0 = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)


def _alert(severity):
    return Alert(
        patient_id="p", kind="k", severity=severity, urgency="soon",
        summary="", clinical_reasoning="", supporting_evidence=[],
        recommended_actions=[], confidence="",
    )


def test_risk_is_none_when_no_alerts_else_max_severity():
    assert _risk([]) == "none"
    assert _risk([_alert("moderate"), _alert("critical")]) == "critical"
    assert _risk([_alert("low")]) == "low"


def test_patient_board_carries_risk_alerts_and_latest_values():
    eng = Engine()
    eng.ingest(Observation("bed-3", SignalCode.HEART_RATE, 118.0, "bpm", T0, "mon"), now=T0)
    board = patient_board(eng, "bed-3")
    assert board["patient_id"] == "bed-3"
    assert board["risk"] == "none"          # a lone heart rate raises no alert
    assert board["latest"]["heart_rate"] == 118.0
    assert board["latest"]["sofa"] == 0
    assert board["alerts"] == []


def test_board_snapshot_lists_every_patient():
    eng = Engine()
    for pid in ("bed-3", "bed-5"):
        eng.ingest(Observation(pid, SignalCode.HEART_RATE, 90.0, "bpm", T0, "mon"), now=T0)
    ids = {b["patient_id"] for b in board_snapshot(eng)}
    assert ids == {"bed-3", "bed-5"}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_board.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'homunculus.api.board'`.

- [ ] **Step 3: Implement** (`src/homunculus/api/board.py`)

```python
# src/homunculus/api/board.py
"""Pure builders that turn an Engine's state into the dashboard's board JSON."""
from __future__ import annotations

from dataclasses import asdict

from homunculus.canonical import SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.sofa import total_sofa

# Ascending severity; risk is the max present, or "none" when the patient is quiet.
_SEVERITY_ORDER = ["info", "low", "moderate", "high", "critical"]


def _risk(alerts: list[Alert]) -> str:
    if not alerts:
        return "none"
    return max((a.severity for a in alerts), key=_SEVERITY_ORDER.index)


def _latest(state, code: SignalCode):
    obs = state.latest(code)
    return None if obs is None else obs.value


def patient_board(engine: Engine, patient_id: str) -> dict:
    alerts = engine.active_alerts(patient_id)
    state = engine.state(patient_id)
    return {
        "patient_id": patient_id,
        "risk": _risk(alerts),
        "alerts": [asdict(a) for a in alerts],
        "latest": {
            "heart_rate": _latest(state, SignalCode.HEART_RATE),
            "map": _latest(state, SignalCode.MAP),
            "lactate": _latest(state, SignalCode.LACTATE),
            "sofa": total_sofa(state),
        },
    }


def board_snapshot(engine: Engine) -> list[dict]:
    return [patient_board(engine, pid) for pid in engine.patient_ids()]
```

- [ ] **Step 4: Run it, verify it passes**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_board.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_board.py
git commit -m "feat(engine): board builders (risk + alerts + latest values)"
```

---

## Task 4: Wire the API — /patients, /stream, and /ingest publish

**Files:** Modify `homunculus-engine/src/homunculus/api/app.py`; append to `tests/test_api_ingest.py`; create `tests/test_api_stream.py`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api_ingest.py`:

```python
def test_patients_snapshot_lists_patients_with_risk_and_latest():
    c = _client()
    events = load_scenario(SCEN / "septic_shock.yaml")
    for _ts, fhir in events:
        c.post("/ingest", json=fhir, headers=_hdr("tok-hosp1"))
    r = c.get("/patients", headers=_hdr("tok-hosp1"))
    assert r.status_code == 200
    boards = {b["patient_id"]: b for b in r.json()["patients"]}
    assert "bed-3" in boards
    assert boards["bed-3"]["risk"] in ("high", "critical")
    assert boards["bed-3"]["latest"]["sofa"] >= 2


def test_patients_requires_a_tenant_token():
    c = _client()
    assert c.get("/patients").status_code == 401
```

Create `tests/test_api_stream.py`:

```python
# tests/test_api_stream.py
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

import homunculus.scenarios
from homunculus.api.app import create_app
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _fhir(code, value, unit="", patient="bed-3", when="2026-07-14T10:00:00+00:00"):
    return {
        "resourceType": "Observation",
        "code": {"coding": [{"system": "x", "code": code}]},
        "subject": {"reference": f"Patient/{patient}"},
        "effectiveDateTime": when,
        "valueQuantity": {"value": value, "unit": unit},
    }


@pytest.mark.anyio
async def test_ingest_publishes_patient_board_to_subscribers():
    app = create_app({"tok": "HOSP1"})
    q = app.state.broadcaster.subscribe("HOSP1")
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
            await client.post("/ingest", json=fhir, headers={"Authorization": "Bearer tok"})
    boards = []
    while not q.empty():
        boards.append(q.get_nowait())
    assert boards, "ingest published nothing"
    assert any(a["kind"] == "septic_shock" for b in boards for a in b["alerts"])


@pytest.mark.anyio
async def test_publish_is_tenant_isolated():
    app = create_app({"t1": "HOSP1", "t2": "HOSP2"})
    q2 = app.state.broadcaster.subscribe("HOSP2")
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        await client.post("/ingest", json=_fhir("heart_rate", 100),
                          headers={"Authorization": "Bearer t1"})
    assert q2.empty()


@pytest.mark.anyio
async def test_stream_endpoint_serves_event_stream():
    app = create_app({"tok": "HOSP1"})
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        async with client.stream("GET", "/stream?token=tok") as r:
            assert r.status_code == 200
            assert r.headers["content-type"].startswith("text/event-stream")


@pytest.mark.anyio
async def test_stream_rejects_unknown_token():
    app = create_app({"tok": "HOSP1"})
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        r = await client.get("/stream?token=nope")
        assert r.status_code == 401
```

- [ ] **Step 2: Run them, verify they fail**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_api_stream.py homunculus-engine/tests/test_api_ingest.py -q`
Expected: FAIL — `/patients` and `/stream` return 404 / `AttributeError: app.state.broadcaster`.

- [ ] **Step 3: Implement** — replace the whole body of `src/homunculus/api/app.py` with:

```python
# src/homunculus/api/app.py
"""Cloud ingestion + live board API. Each hospital is a tenant identified by a bearer token;
its data lives in its own Engine, so one hospital never sees another's patients. /ingest also
publishes the affected patient's board to a per-tenant broadcaster that /stream fans out over
Server-Sent Events. Register unchanged: recommendations never orders; every alert cites the vault.
"""
from __future__ import annotations

import json
from dataclasses import asdict

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from homunculus.api.board import board_snapshot, patient_board
from homunculus.api.broadcast import Broadcaster
from homunculus.gateway.fhir import GatewayError, parse_fhir_observation
from homunculus.pipeline import Engine


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
            try:
                while True:
                    board = await queue.get()
                    yield f"data: {json.dumps(board)}\n\n"
            finally:
                broadcaster.unsubscribe(hospital, queue)

        return StreamingResponse(events(), media_type="text/event-stream")

    return app
```

- [ ] **Step 4: Run the whole backend suite, verify green**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine -q`
Expected: PASS — all prior tests plus the new `/patients` and `/stream` tests.

- [ ] **Step 5: Commit**

```bash
git add homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_api_ingest.py homunculus-engine/tests/test_api_stream.py
git commit -m "feat(engine): /patients snapshot + /stream SSE; /ingest publishes board updates"
```

---

## Task 5: Dev server entrypoint + uvicorn dep

**Files:** Create `homunculus-engine/src/homunculus/api/devserver.py`; modify `homunculus-engine/pyproject.toml`.

- [ ] **Step 1: Add `uvicorn` to dev deps** — in `pyproject.toml`, change the dev extras line to:

```toml
dev = ["pytest>=8.0", "httpx>=0.27", "uvicorn>=0.30"]
```

- [ ] **Step 2: Create the dev entrypoint** (`src/homunculus/api/devserver.py`)

```python
# src/homunculus/api/devserver.py
"""Local dev server: one tenant, token 'dev-token'. NEVER use these credentials in production.
Run: homunculus-engine/.venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 8000
"""
from homunculus.api.app import create_app

app = create_app({"dev-token": "HOSP1"})
```

- [ ] **Step 3: Install and smoke-test the server boots**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pip install -e "homunculus-engine[dev]" -q`
Then: `homunculus-engine/.venv/Scripts/python.exe -c "from homunculus.api.devserver import app; print('routes', [r.path for r in app.routes])"`
Expected: prints a list including `/ingest`, `/patients`, `/stream`.

- [ ] **Step 4: Commit**

```bash
git add homunculus-engine/pyproject.toml homunculus-engine/src/homunculus/api/devserver.py
git commit -m "chore(engine): uvicorn dev server entrypoint (dev-token tenant)"
```

---

## Task 6: Frontend scaffold (Vite + Vitest)

**Files:** Create `dashboard/package.json`, `dashboard/vite.config.js`, `dashboard/index.html`, `dashboard/src/main.jsx`, `dashboard/.gitignore`.

- [ ] **Step 1: Create `dashboard/package.json`**

```json
{
  "name": "homunculus-dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `dashboard/vite.config.js`** (React plugin, Vitest jsdom env, dev proxy so the browser hits the backend without CORS)

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/patients": "http://localhost:8000",
      "/stream": "http://localhost:8000",
      "/ingest": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.js",
  },
});
```

- [ ] **Step 3: Create `dashboard/src/setupTests.js`**

```javascript
import "@testing-library/jest-dom";
```

- [ ] **Step 4: Create `dashboard/index.html`**

```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Homunculus — Canlı Pano</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `dashboard/src/main.jsx`**

```javascript
import React from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board.jsx";

createRoot(document.getElementById("root")).render(<Board token="dev-token" />);
```

- [ ] **Step 6: Create `dashboard/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 7: Install deps**

Run (from `dashboard/`): `npm install`
Expected: dependencies install without error; `node_modules/` created.

- [ ] **Step 8: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/vite.config.js dashboard/index.html dashboard/src/main.jsx dashboard/src/setupTests.js dashboard/.gitignore
git commit -m "chore(dashboard): scaffold React + Vite + Vitest"
```

---

## Task 7: risk.js — risk level → label + color

**Files:** Create `dashboard/src/risk.js`, `dashboard/src/risk.test.js`.

- [ ] **Step 1: Write the failing test** (`dashboard/src/risk.test.js`)

```javascript
import { describe, it, expect } from "vitest";
import { riskLabel, riskColor } from "./risk.js";

describe("risk", () => {
  it("maps each risk level to a Turkish label", () => {
    expect(riskLabel("critical")).toBe("Kritik");
    expect(riskLabel("high")).toBe("Yüksek");
    expect(riskLabel("moderate")).toBe("Orta");
    expect(riskLabel("none")).toBe("Stabil");
  });
  it("maps high and critical to red, moderate to amber, none to green", () => {
    expect(riskColor("critical")).toBe("#c0392b");
    expect(riskColor("high")).toBe("#c0392b");
    expect(riskColor("moderate")).toBe("#e0a800");
    expect(riskColor("none")).toBe("#2e7d32");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `dashboard/`): `npm test -- risk`
Expected: FAIL — cannot resolve `./risk.js`.

- [ ] **Step 3: Implement** (`dashboard/src/risk.js`)

```javascript
const LABELS = { critical: "Kritik", high: "Yüksek", moderate: "Orta", low: "Düşük", none: "Stabil" };
const COLORS = { critical: "#c0392b", high: "#c0392b", moderate: "#e0a800", low: "#e0a800", none: "#2e7d32" };

export function riskLabel(risk) {
  return LABELS[risk] ?? risk;
}

export function riskColor(risk) {
  return COLORS[risk] ?? "#777";
}
```

- [ ] **Step 4: Run it, verify it passes**

Run (from `dashboard/`): `npm test -- risk`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/risk.js dashboard/src/risk.test.js
git commit -m "feat(dashboard): risk level -> Turkish label + color"
```

---

## Task 8: api.js — fetchBoard + openStream

**Files:** Create `dashboard/src/api.js`.

No unit test (thin I/O wrapper over `fetch` and `EventSource`; it is exercised via Board's injected fakes in Task 11). Keep it tiny.

- [ ] **Step 1: Implement** (`dashboard/src/api.js`)

```javascript
// Thin transport wrapper. Tenant bearer token: header for the snapshot, query param for SSE
// (browsers cannot set headers on EventSource).
export async function fetchBoard(token) {
  const res = await fetch("/patients", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /patients failed: ${res.status}`);
  const body = await res.json();
  return body.patients;
}

// Opens the SSE stream. Calls onUpdate(patientBoard) for each event and onStatus("open"|"error").
// Returns a close() function.
export function openStream(token, onUpdate, onStatus = () => {}) {
  const source = new EventSource(`/stream?token=${encodeURIComponent(token)}`);
  source.onopen = () => onStatus("open");
  source.onerror = () => onStatus("error"); // EventSource auto-reconnects
  source.onmessage = (e) => onUpdate(JSON.parse(e.data));
  return () => source.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api.js
git commit -m "feat(dashboard): fetchBoard + openStream transport"
```

---

## Task 9: PatientList — colored rows + selection

**Files:** Create `dashboard/src/PatientList.jsx`, `dashboard/src/PatientList.test.jsx`.

- [ ] **Step 1: Write the failing test** (`dashboard/src/PatientList.test.jsx`)

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PatientList } from "./PatientList.jsx";

const patients = [
  { patient_id: "bed-3", risk: "critical", alerts: [], latest: {} },
  { patient_id: "bed-5", risk: "none", alerts: [], latest: {} },
];

describe("PatientList", () => {
  it("renders a row per patient with its risk label", () => {
    render(<PatientList patients={patients} selected={null} onSelect={() => {}} />);
    expect(screen.getByText("bed-3")).toBeInTheDocument();
    expect(screen.getByText("Kritik")).toBeInTheDocument();
    expect(screen.getByText("Stabil")).toBeInTheDocument();
  });

  it("calls onSelect with the patient id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<PatientList patients={patients} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("bed-3"));
    expect(onSelect).toHaveBeenCalledWith("bed-3");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `dashboard/`): `npm test -- PatientList`
Expected: FAIL — cannot resolve `./PatientList.jsx`.

- [ ] **Step 3: Implement** (`dashboard/src/PatientList.jsx`)

```javascript
import React from "react";
import { riskLabel, riskColor } from "./risk.js";

export function PatientList({ patients, selected, onSelect }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {patients.map((p) => (
        <li
          key={p.patient_id}
          onClick={() => onSelect(p.patient_id)}
          style={{
            cursor: "pointer",
            padding: "10px 12px",
            borderLeft: `5px solid ${riskColor(p.risk)}`,
            background: p.patient_id === selected ? "#eef" : "transparent",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{p.patient_id}</span>
          <span style={{ color: riskColor(p.risk), fontWeight: 600 }}>{riskLabel(p.risk)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run (from `dashboard/`): `npm test -- PatientList`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/PatientList.jsx dashboard/src/PatientList.test.jsx
git commit -m "feat(dashboard): PatientList with risk-colored rows + selection"
```

---

## Task 10: PatientDetail — alerts with reasoning, citations, actions

**Files:** Create `dashboard/src/PatientDetail.jsx`, `dashboard/src/PatientDetail.test.jsx`.

- [ ] **Step 1: Write the failing test** (`dashboard/src/PatientDetail.test.jsx`)

```javascript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PatientDetail } from "./PatientDetail.jsx";

const patient = {
  patient_id: "bed-3",
  risk: "critical",
  latest: { heart_rate: 118, map: 58, lactate: 3.1, sofa: 8 },
  alerts: [
    {
      kind: "septic_shock",
      severity: "critical",
      urgency: "immediate",
      summary: "Septik şok kriterleri karşılanıyor",
      clinical_reasoning: "Vazopresör + laktat 3.1 sonrası 30 mL/kg sıvı.",
      supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2026"],
      recommended_actions: ["Consider repeat lactate to confirm the trend."],
      confidence: "strong recommendation, very low certainty (SSC 2026)",
    },
  ],
};

describe("PatientDetail", () => {
  it("shows the alert summary, reasoning, citations, actions and confidence", () => {
    render(<PatientDetail patient={patient} />);
    expect(screen.getByText(/Septik şok kriterleri/)).toBeInTheDocument();
    expect(screen.getByText(/Vazopresör \+ laktat/)).toBeInTheDocument();
    expect(screen.getByText("sepsis-3-jama-2016")).toBeInTheDocument();
    expect(screen.getByText(/Consider repeat lactate/)).toBeInTheDocument();
    expect(screen.getByText(/very low certainty/)).toBeInTheDocument();
  });

  it("shows the latest-values strip", () => {
    render(<PatientDetail patient={patient} />);
    expect(screen.getByText(/SOFA/)).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("renders recommended actions as recommendations, never orders", () => {
    render(<PatientDetail patient={patient} />);
    const action = screen.getByText(/Consider repeat lactate/).textContent.toLowerCase();
    expect(action).not.toMatch(/^(give |administer |start |order |prescribe )/);
  });

  it("shows a calm message when there are no active alerts", () => {
    render(<PatientDetail patient={{ ...patient, alerts: [] }} />);
    expect(screen.getByText(/aktif uyar/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `dashboard/`): `npm test -- PatientDetail`
Expected: FAIL — cannot resolve `./PatientDetail.jsx`.

- [ ] **Step 3: Implement** (`dashboard/src/PatientDetail.jsx`)

```javascript
import React from "react";
import { riskColor } from "./risk.js";

function LatestStrip({ latest }) {
  const items = [
    ["HR", latest.heart_rate],
    ["MAP", latest.map],
    ["Laktat", latest.lactate],
    ["SOFA", latest.sofa],
  ];
  return (
    <div style={{ display: "flex", gap: 16, margin: "8px 0 16px", color: "#333" }}>
      {items.map(([k, v]) => (
        <span key={k}><strong>{k}</strong> {v ?? "—"}</span>
      ))}
    </div>
  );
}

function AlertCard({ alert }) {
  return (
    <div style={{ border: `1px solid ${riskColor(alert.severity)}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
      <div style={{ color: riskColor(alert.severity), fontWeight: 700 }}>
        ⚠ {alert.summary}
      </div>
      <p style={{ margin: "8px 0" }}><strong>Gerekçe:</strong> {alert.clinical_reasoning}</p>
      <div style={{ margin: "8px 0" }}>
        <strong>Önerilen:</strong>
        <ul>{alert.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </div>
      <div style={{ fontSize: 13, color: "#555" }}>
        <strong>Kaynak:</strong> {alert.supporting_evidence.join(", ")}
      </div>
      <div style={{ fontSize: 13, color: "#555" }}>
        <strong>Güven:</strong> {alert.confidence}
      </div>
    </div>
  );
}

export function PatientDetail({ patient }) {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0 }}>{patient.patient_id}</h2>
      <LatestStrip latest={patient.latest} />
      {patient.alerts.length === 0
        ? <p style={{ color: "#2e7d32" }}>Aktif uyarı yok.</p>
        : patient.alerts.map((a) => <AlertCard key={a.kind} alert={a} />)}
    </div>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run (from `dashboard/`): `npm test -- PatientDetail`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/PatientDetail.jsx dashboard/src/PatientDetail.test.jsx
git commit -m "feat(dashboard): PatientDetail — alerts with reasoning, citations, actions"
```

---

## Task 11: Board — master-detail container that loads + merges the live stream

**Files:** Create `dashboard/src/Board.jsx`, `dashboard/src/Board.test.jsx`.

Board takes injected `fetchBoard`/`openStream` (defaulting to the real ones) so tests drive it with fakes.

- [ ] **Step 1: Write the failing test** (`dashboard/src/Board.test.jsx`)

```javascript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Board } from "./Board.jsx";

const p3 = { patient_id: "bed-3", risk: "none", alerts: [], latest: { sofa: 0 } };

describe("Board", () => {
  it("loads the snapshot and lists patients", async () => {
    const fetchBoard = vi.fn().mockResolvedValue([p3]);
    const openStream = vi.fn().mockReturnValue(() => {});
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
  });

  it("merges a stream update into the board", async () => {
    const fetchBoard = vi.fn().mockResolvedValue([p3]);
    let push;
    const openStream = vi.fn().mockImplementation((_t, onUpdate) => { push = onUpdate; return () => {}; });
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
    act(() => push({ patient_id: "bed-3", risk: "critical", alerts: [], latest: { sofa: 8 } }));
    await waitFor(() => expect(screen.getByText("Kritik")).toBeInTheDocument());
  });

  it("shows the selected patient's detail", async () => {
    const withAlert = {
      patient_id: "bed-7", risk: "high", latest: { sofa: 3 },
      alerts: [{
        kind: "sepsis", severity: "high", urgency: "soon",
        summary: "Sepsis kriterleri karşılanıyor", clinical_reasoning: "SOFA 3.",
        supporting_evidence: ["sepsis-3-jama-2016"], recommended_actions: ["Monitor lactate."],
        confidence: "consensus definition",
      }],
    };
    const fetchBoard = vi.fn().mockResolvedValue([withAlert]);
    const openStream = vi.fn().mockReturnValue(() => {});
    render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} />);
    await waitFor(() => expect(screen.getByText("bed-7")).toBeInTheDocument());
    fireEvent.click(screen.getByText("bed-7"));
    expect(screen.getByText(/Sepsis kriterleri/)).toBeInTheDocument();
    expect(screen.getByText("sepsis-3-jama-2016")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run (from `dashboard/`): `npm test -- Board`
Expected: FAIL — cannot resolve `./Board.jsx`.

- [ ] **Step 3: Implement** (`dashboard/src/Board.jsx`)

```javascript
import React, { useEffect, useState } from "react";
import { PatientList } from "./PatientList.jsx";
import { PatientDetail } from "./PatientDetail.jsx";
import { fetchBoard as realFetchBoard, openStream as realOpenStream } from "./api.js";

export function Board({ token, fetchBoard = realFetchBoard, openStream = realOpenStream }) {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let closed = false;
    fetchBoard(token).then((list) => { if (!closed) setPatients(list); }).catch(() => {});
    const close = openStream(
      token,
      (board) => setPatients((prev) => {
        const rest = prev.filter((p) => p.patient_id !== board.patient_id);
        return [...rest, board].sort((a, b) => a.patient_id.localeCompare(b.patient_id));
      }),
      (s) => setStatus(s === "open" ? "live" : "reconnecting"),
    );
    return () => { closed = true; close(); };
  }, [token, fetchBoard, openStream]);

  const current = patients.find((p) => p.patient_id === selected) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100vh", fontFamily: "system-ui" }}>
      <aside style={{ borderRight: "1px solid #ddd", overflowY: "auto" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700 }}>
          Homunculus <span style={{ float: "right", fontSize: 12, color: "#888" }}>{status}</span>
        </div>
        <PatientList patients={patients} selected={selected} onSelect={setSelected} />
      </aside>
      <main style={{ overflowY: "auto" }}>
        {current ? <PatientDetail patient={current} /> : <p style={{ padding: 16, color: "#888" }}>Bir hasta seçin.</p>}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run it, verify it passes**

Run (from `dashboard/`): `npm test -- Board`
Expected: PASS (3 passed).

- [ ] **Step 5: Run the whole frontend suite**

Run (from `dashboard/`): `npm test`
Expected: all suites pass (risk, PatientList, PatientDetail, Board).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/Board.jsx dashboard/src/Board.test.jsx
git commit -m "feat(dashboard): master-detail Board that loads snapshot + merges live stream"
```

---

## Task 12: Manual end-to-end run (verification)

No new tests — this is the human-visible proof.

- [ ] **Step 1: Start the backend** (terminal 1, from repo root)

Run: `homunculus-engine/.venv/Scripts/python.exe -m uvicorn homunculus.api.devserver:app --port 8000`

- [ ] **Step 2: Start the dashboard** (terminal 2, from `dashboard/`)

Run: `npm run dev`
Open the printed URL (default `http://localhost:5173`). The board shows "Bir hasta seçin." with an empty list.

- [ ] **Step 3: Replay the septic-shock scenario into the API** (terminal 3, from repo root)

Create `homunculus-engine/scripts/replay.py`:

```python
# homunculus-engine/scripts/replay.py
"""Replay a scenario into a running dev server, one observation a second, so the dashboard
shows a patient sliding into septic shock live. Synthetic data only."""
import sys, time
from pathlib import Path
import urllib.request, json

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent
name = sys.argv[1] if len(sys.argv) > 1 else "septic_shock.yaml"

for _ts, fhir in load_scenario(SCEN / name):
    req = urllib.request.Request(
        "http://localhost:8000/ingest",
        data=json.dumps(fhir).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer dev-token"},
    )
    urllib.request.urlopen(req).read()
    print("sent", fhir["code"]["coding"][0]["code"], fhir["valueQuantity"]["value"])
    time.sleep(1)
```

Run: `homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/replay.py`

- [ ] **Step 2 (observe):** In the browser, `bed-3` appears and turns red as the scenario progresses. Click it: the septic-shock alert shows its summary, reasoning, `sepsis-3-jama-2016` citation, the "Consider repeat lactate" recommendation, and the GRADE confidence. No order, no diagnosis anywhere.

- [ ] **Step 3: Commit the replay helper**

```bash
git add homunculus-engine/scripts/replay.py
git commit -m "chore(engine): scenario replay helper for the live dashboard demo"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** `GET /patients` → Task 4. `GET /stream` SSE → Task 4. In-process broadcaster → Task 2. `/ingest` publishes → Task 4. Tenant token (query param for SSE) → Task 4. Master-detail board → Tasks 9–11. Risk coloring → Tasks 7, 9. Alert reasoning + citations + actions + confidence → Task 10. Latest-values strip (HR/MAP/lactate/SOFA) → Tasks 3, 10. Reconnect status → Task 11 (`status`). Tenant isolation tested → Tasks 2, 4. No-orders UI guard → Task 10. Manual e2e → Task 12.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `patient_board`/`board_snapshot` (Task 3) are consumed by `/patients` and `/ingest` publish (Task 4); `app.state.broadcaster` set in Task 4 is read by tests in Task 4; `fetchBoard`/`openStream` signatures (Task 8) match Board's injected props and defaults (Task 11); board JSON keys (`patient_id`, `risk`, `alerts`, `latest`) are identical across Tasks 3, 9, 10, 11.
- **Note:** `Alert.severity` is a string ("info"/"low"/"moderate"/"high"/"critical") from `reco/engine.py`, which is what `_risk` (Task 3) and `riskColor` (Task 7) key on — consistent.
