# Homunculus Live Dashboard (Plan B, slice B1) — Design

**Date:** 2026-07-18
**Status:** Approved (design); implementation not yet begun
**Scope:** B1 — a **read-only live clinical board**. First slice of Plan B (the dashboard
sub-project). Builds on the existing engine and cloud ingest API.

---

## Why this, and why now

The engine (Plan A) and the hospital-integration slice give Homunculus a working brain and a
data path, but it still has **no eyes** — nothing a clinician can look at. B1 is the smallest
slice that makes the system *visible*: a live board showing each patient's risk and, on
selection, the engine's alerts with their full reasoning and vault citations. It turns the
headless engine into something a clinician can actually watch.

## Decisions locked with the user

1. **B1 is read-only.** Acknowledge, escalation, and notification delivery are B2 — not here.
2. **Single unified board.** No doctor/nurse split yet; the role difference only becomes real
   with acknowledge/escalation (B2). Everyone sees the same board in B1.
3. **Master-detail layout.** Patient list on the left; the selected patient's detail on the
   right (active alerts + a small latest-values strip).
4. **Transport: Server-Sent Events (SSE).** B1 is read-only, so a one-way server→client stream
   is the right fit — simpler than WebSocket, browser-native (`EventSource`), auto-reconnecting.
   Client→server actions arrive in B2 as plain POSTs; WebSocket is not needed yet.
5. **Frontend: React + Vite** (as set in the engine spec).

## Non-goals

- No acknowledge / escalation / notification (B2).
- No per-clinician login — B1 authenticates with the existing **tenant bearer token**.
- No Postgres / audit persistence (B4) — board state is the engine's in-memory state.
- No WebSocket, no Redis/Kafka pub-sub — a single-process in-memory broadcaster suffices; the
  multi-process fan-out is B4.
- No new clinical logic — B1 only *displays* what the engine already produces. No orders, no
  diagnosis. No PHI in the repo (synthetic scenarios only).

---

## Architecture

Two units with a clean boundary: the **backend** extends the existing FastAPI app; the
**frontend** is a new React app that consumes it.

### Backend — extend `homunculus-engine/src/homunculus/api/`

- **`GET /patients`** (tenant-scoped) — a board **snapshot**: the tenant's patient list, each
  with an id, a derived risk level (max severity among active alerts; `none` if quiet), and its
  active alerts. Used for the dashboard's initial load.
- **`GET /stream`** (SSE, tenant-scoped) — pushes a board-update event whenever `/ingest` raises
  or changes alerts for that tenant. `EventSource` reconnects automatically.
- **In-process broadcaster** (`api/broadcast.py`) — a tiny per-tenant asyncio pub/sub. `/ingest`
  publishes the affected patient's new board state; each `/stream` subscriber for that tenant
  receives it. No external broker (single-process; multi-process fan-out is B4).
- **Auth** — the tenant bearer token identifies the hospital, as today. Since browsers can't set
  an `Authorization` header on an `EventSource`, `/stream` accepts the token as a query
  parameter; `/patients` keeps the header. (Query-param tokens are logged — acceptable for this
  internal first slice; per-clinician auth and short-lived tokens come later.)

The engine and its alert schema are unchanged. `/ingest` gains one line: after it computes
alerts, it publishes the patient's board state to the broadcaster.

### Frontend — new `dashboard/` (React + Vite)

- **Board (master-detail).** Left: patient list, each row coloured by risk (🔴 critical/high ·
  🟡 moderate · 🟢 none). Right: the selected patient's **active alerts**, each showing severity,
  urgency, summary, **clinical reasoning, supporting evidence (vault citations), recommended
  actions, and GRADE confidence** — plus a small latest-values strip (HR, MAP, lactate, SOFA).
- **Live updates.** On load, fetch `GET /patients` for the initial board; then subscribe to
  `GET /stream` and merge each update into the board. A disconnected stream shows a visible
  "reconnecting" state (never a silently frozen board).
- **Register preserved in the UI.** Recommended actions render verbatim from the engine (they are
  recommendations, never orders); every alert shows its citations. The UI adds no clinical text
  of its own.

### Data flow

```
device → /ingest → engine raises alerts → broadcaster.publish(tenant, patient board)
                                              → /stream (SSE) → dashboard merges → UI updates
dashboard load: GET /patients (snapshot) → render board
```

---

## Error handling

- **Stream drop** — `EventSource` auto-reconnects; the UI shows a "reconnecting" banner and
  refetches `GET /patients` on reconnect to resync. The board is never silently stale.
- **Unknown/again missing token** — 401 on `/patients` and `/stream`; the UI shows an auth error.
- **Unknown patient selected** — detail pane shows "no active alerts," not an error.
- **Tenant isolation** — `/patients` and `/stream` are strictly tenant-scoped; a HOSP1 board
  never receives HOSP2 patients or alerts. This is a tested invariant.

## Testing

- **Backend (pytest + FastAPI TestClient):**
  - `GET /patients` returns the tenant's board snapshot with derived risk levels.
  - `GET /stream` delivers a board-update event when `/ingest` raises an alert (drive the
    septic-shock scenario; assert the stream emits the shock alert).
  - **Tenant isolation:** a HOSP2 stream/snapshot never sees HOSP1's patient (mirrors the
    existing ingest-API isolation test).
- **Frontend (Vitest + React Testing Library):**
  - Board renders the patient list and colours rows by risk.
  - Selecting a patient shows its alerts with reasoning + citations + recommended actions.
  - Recommended actions render as recommendations (no imperative/order phrasing) — a UI-level
    guard mirroring the engine's no-orders register.
  - A stream update adds/updates a patient on the board without a full reload.

## Done when

A clinician can open the dashboard, watch the simulated septic-shock scenario stream in live,
see the patient turn red, click it, and read the septic-shock alert with its reasoning, vault
citations, and recommended actions — with no order and no diagnosis anywhere, and HOSP2's board
unaffected.

## Next slices

- **B2** — acknowledge + escalation (role behaviour, escalation timer). This is where the
  doctor/nurse split becomes real.
- **B3** notification delivery · **B4** Postgres + audit + multi-process pub-sub · **B5** NEWS2
  (needs its spec captured into the vault first) · **B6** staleness-aware SOFA.
