# Dashboard B3 — Notification Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push high-urgency alerts and escalations to clinicians as in-app/browser notifications, role-routed (nurse ← new alerts, doctor ← escalations), over a dedicated SSE stream.

**Architecture:** A `Notifier` (decides which alerts warrant a notification + dedups) and a role-filtered `NotificationHub` (fan-out) in `api/notify.py`. `app.py` hooks `/ingest` (new-immediate → nurse) and the escalation cycle (transition → doctor), and serves `GET /notifications?token&role` as SSE. The dashboard subscribes for its selected role and shows toasts + Web Notification + sound.

**Tech Stack:** FastAPI, asyncio, SSE (module-level frame generator, tested directly — httpx ASGITransport cannot read unbounded streams). React + Vitest, EventSource, Web Notification API + WebAudio (guarded for jsdom).

Spec: `docs/superpowers/specs/2026-07-25-dashboard-b3-notification-delivery-design.md`.

---

### Task 1: `Notification` + `Notifier.for_new` + `prune`

**Files:** Create `homunculus-engine/src/homunculus/api/notify.py`; Test `homunculus-engine/tests/test_notify.py`.

- [ ] **Step 1: Failing test**

```python
# tests/test_notify.py
from homunculus.api.notify import Notifier, Notification
from homunculus.reco.engine import Alert

def _alert(kind, urgency):
    return Alert(patient_id="bed-3", kind=kind, severity="critical", urgency=urgency,
                 summary=f"{kind} summary", clinical_reasoning="r", supporting_evidence=["s"],
                 recommended_actions=["Review."], confidence="c")

def test_for_new_emits_nurse_notification_for_immediate():
    n = Notifier()
    out = n.for_new("HOSP1", [_alert("septic_shock", "immediate")])
    assert len(out) == 1
    assert out[0].audience == "nurse" and out[0].trigger == "new"
    assert out[0].patient_id == "bed-3" and "bed-3" in out[0].body

def test_for_new_ignores_non_immediate():
    n = Notifier()
    assert n.for_new("HOSP1", [_alert("sepsis", "soon")]) == []

def test_for_new_dedups_same_key():
    n = Notifier()
    a = [_alert("septic_shock", "immediate")]
    assert len(n.for_new("HOSP1", a)) == 1
    assert n.for_new("HOSP1", a) == []          # second time: already notified

def test_prune_lets_recurrence_notify_again():
    n = Notifier()
    a = [_alert("septic_shock", "immediate")]
    n.for_new("HOSP1", a)
    n.prune("HOSP1", set())                      # alert no longer live
    assert len(n.for_new("HOSP1", a)) == 1       # recurrence notifies again
```

- [ ] **Step 2: Run — expect ModuleNotFoundError.** `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_notify.py -q`

- [ ] **Step 3: Implement**

```python
# src/homunculus/api/notify.py
"""In-app notification delivery: decide which alerts to push, dedup, and fan out by role.
PHI-minimal: body is "{patient_id}: {summary}" — bed label + the finding already on the board."""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from homunculus.reco.engine import Alert


@dataclass(frozen=True)
class Notification:
    tenant: str
    patient_id: str
    kind: str
    severity: str
    urgency: str
    audience: str      # "nurse" | "doctor"
    trigger: str       # "new" | "escalation"
    title: str
    body: str
    ts: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Notifier:
    def __init__(self) -> None:
        self._notified_new: dict[str, set[tuple[str, str]]] = {}   # tenant -> {(pid, kind)}

    def for_new(self, tenant: str, alerts: list[Alert]) -> list[Notification]:
        seen = self._notified_new.setdefault(tenant, set())
        out: list[Notification] = []
        for a in alerts:
            key = (a.patient_id, a.kind)
            if a.urgency != "immediate" or key in seen:
                continue
            seen.add(key)
            out.append(Notification(
                tenant=tenant, patient_id=a.patient_id, kind=a.kind, severity=a.severity,
                urgency=a.urgency, audience="nurse", trigger="new", title="Yeni uyarı",
                body=f"{a.patient_id}: {a.summary}", ts=_now_iso()))
        return out

    def prune(self, tenant: str, live_keys: set[tuple[str, str]]) -> None:
        seen = self._notified_new.get(tenant)
        if seen is not None:
            self._notified_new[tenant] = seen & live_keys

    def for_escalation(self, tenant: str, newly: set[tuple[str, str]],
                       alert_by_key: dict[tuple[str, str], Alert]) -> list[Notification]:
        out: list[Notification] = []
        for key in newly:
            a = alert_by_key.get(key)
            if a is None:
                continue
            out.append(Notification(
                tenant=tenant, patient_id=a.patient_id, kind=a.kind, severity=a.severity,
                urgency=a.urgency, audience="doctor", trigger="escalation", title="Eskalasyon",
                body=f"{a.patient_id}: {a.summary}", ts=_now_iso()))
        return out
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(api): notification model + Notifier (new-alert dedup + prune)`

---

### Task 2: `Notifier.for_escalation`

Already implemented in Task 1's file (kept together — the Notifier is one unit). Add its test.

**Files:** Test `homunculus-engine/tests/test_notify.py` (append).

- [ ] **Step 1: Failing test**

```python
def test_for_escalation_emits_doctor_notifications():
    from homunculus.api.notify import Notifier
    n = Notifier()
    a = _alert("septic_shock", "immediate")
    out = n.for_escalation("HOSP1", {("bed-3", "septic_shock")}, {("bed-3", "septic_shock"): a})
    assert len(out) == 1
    assert out[0].audience == "doctor" and out[0].trigger == "escalation"
```

- [ ] **Step 2: Run — expect PASS** (method already present). If it fails, implement `for_escalation` as in Task 1.
- [ ] **Step 3: Commit** `test(api): cover Notifier.for_escalation`

---

### Task 3: `NotificationHub` (role-filtered fan-out)

**Files:** Modify `homunculus-engine/src/homunculus/api/notify.py`; Test `homunculus-engine/tests/test_notify_hub.py`.

- [ ] **Step 1: Failing test**

```python
# tests/test_notify_hub.py
import asyncio
import pytest
from homunculus.api.notify import NotificationHub, Notification

def _n(tenant, audience):
    return Notification(tenant, "bed-3", "septic_shock", "critical", "immediate",
                        audience, "new", "t", "b", "2026-07-25T10:00:00+00:00")

@pytest.mark.anyio
async def test_hub_delivers_only_to_matching_role():
    hub = NotificationHub()
    nurse_q = hub.subscribe("HOSP1", "nurse")
    doctor_q = hub.subscribe("HOSP1", "doctor")
    await hub.publish("HOSP1", _n("HOSP1", "nurse"))
    assert nurse_q.qsize() == 1 and doctor_q.qsize() == 0

@pytest.mark.anyio
async def test_hub_isolates_tenants():
    hub = NotificationHub()
    q1 = hub.subscribe("HOSP1", "nurse")
    q2 = hub.subscribe("HOSP2", "nurse")
    await hub.publish("HOSP1", _n("HOSP1", "nurse"))
    assert q1.qsize() == 1 and q2.qsize() == 0
```

(Note: the engine test suite already configures the `anyio_backend` fixture to asyncio — reuse it; if not present in this file's scope, add `@pytest.fixture\ndef anyio_backend(): return "asyncio"`.)

- [ ] **Step 2: Run — expect failure (NotificationHub missing).**
- [ ] **Step 3: Implement** (append to `notify.py`)

```python
class NotificationHub:
    """Per-tenant, role-filtered fan-out of Notifications to SSE subscribers."""
    def __init__(self) -> None:
        self._subs: dict[str, list[tuple[str, asyncio.Queue]]] = {}

    def subscribe(self, tenant: str, role: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(tenant, []).append((role, q))
        return q

    def unsubscribe(self, tenant: str, role: str, queue: asyncio.Queue) -> None:
        subs = self._subs.get(tenant)
        if subs and (role, queue) in subs:
            subs.remove((role, queue))

    async def publish(self, tenant: str, notification: Notification) -> None:
        for role, q in list(self._subs.get(tenant, [])):
            if role == notification.audience:
                await q.put(asdict(notification))
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(api): role-filtered NotificationHub fan-out`

---

### Task 4: `sse_notification_frames` + `/notifications` + app wiring

**Files:** Modify `homunculus-engine/src/homunculus/api/app.py`; Test `homunculus-engine/tests/test_api_notifications.py`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_api_notifications.py
import asyncio
import json
import pytest
from datetime import datetime, timedelta, timezone
import httpx
from httpx import ASGITransport
from homunculus.api.app import create_app, sse_notification_frames

@pytest.fixture
def anyio_backend():
    return "asyncio"

def _fhir(pid, slug, value, when):
    return {"resourceType": "Observation", "code": {"coding": [{"code": slug}]},
            "valueQuantity": {"value": value}, "effectiveDateTime": when.isoformat(),
            "subject": {"reference": f"Patient/{pid}"}}

@pytest.mark.anyio
async def test_sse_notification_frames_emits_data_then_keepalive():
    q = asyncio.Queue()
    await q.put({"body": "bed-3: x"})
    gen = sse_notification_frames(q, keepalive=0.01)
    first = await gen.__anext__()
    assert first.startswith("data:") and "bed-3" in first
    second = await gen.__anext__()
    assert second.startswith(": keep-alive")

@pytest.mark.anyio
async def test_ingest_publishes_nurse_notification():
    app = create_app({"tok": "HOSP1"}, run_escalation_loop=False)
    hub = app.state.notification_hub
    q = hub.subscribe("HOSP1", "nurse")
    t = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        hdr = {"Authorization": "Bearer tok"}
        # drive a septic_shock immediate alert (reuse the shock scenario shape)
        for slug, val in [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
                          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
            await c.post("/ingest", json=_fhir("bed-3", slug, val, t), headers=hdr)
    assert q.qsize() >= 1
    n = q.get_nowait()
    assert n["audience"] == "nurse" and n["patient_id"] == "bed-3"

@pytest.mark.anyio
async def test_escalation_cycle_publishes_doctor_notification():
    app = create_app({"tok": "HOSP1"}, escalate_after=timedelta(seconds=0), run_escalation_loop=False)
    hub = app.state.notification_hub
    q = hub.subscribe("HOSP1", "doctor")
    t = datetime(2026, 7, 14, 10, 0, tzinfo=timezone.utc)
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        hdr = {"Authorization": "Bearer tok"}
        for slug, val in [("suspected_infection", 1.0), ("weight_kg", 100), ("crystalloid_bolus_ml", 3000),
                          ("map", 60), ("norepinephrine_rate", 0.12), ("lactate", 3.1)]:
            await c.post("/ingest", json=_fhir("bed-3", slug, val, t), headers=hdr)
    await app.state.escalation_cycle(datetime.now(timezone.utc))
    assert q.qsize() >= 1
    assert q.get_nowait()["audience"] == "doctor"
```

- [ ] **Step 2: Run — expect failures (`sse_notification_frames`/`notification_hub` missing).**

- [ ] **Step 3: Implement** in `app.py`:
  - Add a module-level generator mirroring `sse_board_frames`:

```python
async def sse_notification_frames(queue: asyncio.Queue, keepalive: float = 15.0):
    while True:
        try:
            note = await asyncio.wait_for(queue.get(), timeout=keepalive)
        except asyncio.TimeoutError:
            yield ": keep-alive\n\n"
            continue
        yield f"data: {json.dumps(note)}\n\n"
```

  - In `create_app`: `from homunculus.api.notify import Notifier, NotificationHub`; build `notifier = Notifier()` and `hub = NotificationHub()`; expose `app.state.notifier = notifier` and `app.state.notification_hub = hub`.
  - In `/ingest`, after `store.prune(...)`:

```python
        for note in notifier.for_new(hospital, engine.active_alerts(obs.patient_id)):
            await hub.publish(hospital, note)
        notifier.prune(hospital, _live_keys(engine))
```

  - In `_escalation_cycle`, where `newly` is computed and differs, before/after publishing boards:

```python
            added = newly - store.escalated if False else (newly - set())  # see below
```

  Replace the cycle body so it captures the transition and notifies the newly-added keys:

```python
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
                    for note in notifier.for_escalation(hospital, added, alert_by_key):
                        await hub.publish(hospital, note)
```

  - Add the endpoint:

```python
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
```

- [ ] **Step 4: Run — expect PASS**; then run the full engine suite (`pytest homunculus-engine -q`) — expect no regression.
- [ ] **Step 5: Commit** `feat(api): /notifications SSE + wire new-alert/escalation notifications`

---

### Task 5: Frontend — `openNotifications` + `notifications.js` helpers

**Files:** Modify `dashboard/src/api.js`; Create `dashboard/src/notifications.js`; Test `dashboard/src/notifications.test.js`.

- [ ] **Step 1: Failing test**

```js
// src/notifications.test.js
import { describe, it, expect, vi } from "vitest";
import { showDesktop, beep, ensurePermission } from "./notifications.js";

describe("notifications helpers", () => {
  it("showDesktop no-ops safely when Notification API is absent", () => {
    const saved = globalThis.Notification;
    delete globalThis.Notification;
    expect(() => showDesktop("t", "b")).not.toThrow();
    globalThis.Notification = saved;
  });
  it("beep no-ops safely when AudioContext is absent", () => {
    const saved = globalThis.AudioContext;
    delete globalThis.AudioContext;
    expect(() => beep()).not.toThrow();
    globalThis.AudioContext = saved;
  });
  it("ensurePermission resolves without throwing when API absent", async () => {
    const saved = globalThis.Notification;
    delete globalThis.Notification;
    await expect(ensurePermission()).resolves.toBeDefined();
    globalThis.Notification = saved;
  });
});
```

- [ ] **Step 2: Run — expect failure.** `cd dashboard && npx vitest run src/notifications.test.js`
- [ ] **Step 3: Implement**

```js
// src/notifications.js
export async function ensurePermission() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return "denied"; }
  }
  return Notification.permission;
}

export function showDesktop(title, body) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try { new Notification(title, { body }); } catch { /* ignore */ }
}

export function beep() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.value = 0.05;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.15);
  } catch { /* ignore */ }
}
```

  Add to `src/api.js`:

```js
export function openNotifications(token, role, onNotify) {
  const es = new EventSource(`/notifications?token=${encodeURIComponent(token)}&role=${encodeURIComponent(role)}`);
  es.onmessage = (e) => { try { onNotify(JSON.parse(e.data)); } catch { /* keep-alive */ } };
  return () => es.close();
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(dashboard): notification stream client + Web Notification/sound helpers`

---

### Task 6: `Toasts.jsx`

**Files:** Create `dashboard/src/Toasts.jsx`; Test `dashboard/src/Toasts.test.jsx`.

- [ ] **Step 1: Failing test**

```jsx
// src/Toasts.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toasts } from "./Toasts.jsx";

const note = { patient_id: "bed-3", body: "bed-3: Septik şok", trigger: "escalation", ts: "t" };

describe("Toasts", () => {
  it("renders a toast for each notification", () => {
    render(<Toasts toasts={[{ id: 1, note }]} onDismiss={() => {}} onSelect={() => {}} />);
    expect(screen.getByText(/Septik şok/)).toBeInTheDocument();
  });
  it("calls onDismiss when closed", () => {
    const onDismiss = vi.fn();
    render(<Toasts toasts={[{ id: 1, note }]} onDismiss={onDismiss} onSelect={() => {}} />);
    fireEvent.click(screen.getByLabelText("kapat"));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3: Implement**

```jsx
// src/Toasts.jsx
import React from "react";

export function Toasts({ toasts, onDismiss, onSelect }) {
  return (
    <div style={{ position: "fixed", top: 12, right: 12, display: "flex", flexDirection: "column",
                  gap: 8, zIndex: 1000, maxWidth: 320 }}>
      {toasts.map(({ id, note }) => {
        const esc = note.trigger === "escalation";
        return (
          <div key={id} onClick={() => onSelect(note.patient_id)}
               style={{ background: esc ? "#c0392b" : "#e67e22", color: "#fff", borderRadius: 6,
                        padding: "10px 12px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{esc ? "Eskalasyon" : "Yeni uyarı"}</strong>
              <button aria-label="kapat" onClick={(e) => { e.stopPropagation(); onDismiss(id); }}
                      style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{note.body}</div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(dashboard): Toasts component`

---

### Task 7: Wire notifications into `Board.jsx`

**Files:** Modify `dashboard/src/Board.jsx`; Test `dashboard/src/Board.test.jsx` (append).

- [ ] **Step 1: Failing test**

```jsx
it("shows a toast when a notification arrives", async () => {
  const fetchBoard = vi.fn().mockResolvedValue([{ patient_id: "bed-3", risk: "none", alerts: [], latest: { sofa: 0 } }]);
  const openStream = vi.fn().mockReturnValue(() => {});
  let push;
  const openNotifications = vi.fn().mockImplementation((_t, _r, onNotify) => { push = onNotify; return () => {}; });
  render(<Board token="t" fetchBoard={fetchBoard} openStream={openStream} openNotifications={openNotifications} />);
  await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
  act(() => push({ patient_id: "bed-3", body: "bed-3: Septik şok", trigger: "escalation", ts: "t" }));
  await waitFor(() => expect(screen.getByText(/Septik şok/)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run — expect failure (Board doesn't accept `openNotifications`).**

- [ ] **Step 3: Implement** — in `Board.jsx`:
  - Import: `import { Toasts } from "./Toasts.jsx";` and `openNotifications as realOpenNotifications` from `./api.js`, and `ensurePermission, showDesktop, beep` from `./notifications.js`.
  - Add prop `openNotifications = realOpenNotifications`.
  - Add `const [toasts, setToasts] = useState([]);` and a ref counter for ids.
  - In an effect keyed on `[token, role, openNotifications]`: `ensurePermission();` then
    `const close = openNotifications(token, role, (note) => { const id = ++idRef.current; setToasts((t) => [...t, { id, note }]); showDesktop(note.title || "Uyarı", note.body); beep(); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000); }); return close;`
  - Render `<Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} onSelect={setSelected} />` inside the root div.

- [ ] **Step 4: Run — expect PASS**; then full frontend suite `npx vitest run` — expect no regression.
- [ ] **Step 5: Commit** `feat(dashboard): wire role-routed notifications + toasts into Board`

---

### Task 8: Dev proxy + guide + memory

**Files:** Modify `dashboard/vite.config.js` (proxy `/notifications`), `docs/homunculus-rehber-TR.md`, memory.

- [ ] **Step 1:** Add `"/notifications": "http://localhost:8000"` to the vite proxy map.
- [ ] **Step 2:** Guide: flip the "Bildirim + eskalasyon" roadmap row to done (in-app slice); add a one-line glossary note that email/SMS is deferred.
- [ ] **Step 3:** Update `project-state` memory: B3 in-app notifications done; email/SMS/webhook + per-patient assignment + notification history deferred.
- [ ] **Step 4: Commit** `docs+config: B3 notifications proxy + guide + memory`

---

## Self-Review

**Spec coverage:** Notification model + PHI-minimal body (T1); Notifier new+dedup+prune (T1); for_escalation (T1–T2); role-filtered hub (T3); sse_notification_frames + /notifications + /ingest & escalation hooks + tenant isolation (T4); Web Notification/sound helpers + stream client (T5); Toasts (T6); Board wiring (T7); proxy/guide/memory (T8). ✓

**Placeholder scan:** No TBD; every code step has complete code. The escalation-cycle "see below" note in T4 is resolved by the full replacement block immediately after it. ✓

**Type consistency:** `Notification` fields identical across T1/T3/T4; `audience`/`trigger` values ("nurse"/"doctor", "new"/"escalation") consistent; `hub.subscribe(tenant, role)` / `publish(tenant, notification)` / `unsubscribe(tenant, role, queue)` consistent T3↔T4; `openNotifications(token, role, onNotify)` consistent T5↔T7. ✓

**SSE gotchas:** `/notifications` uses a module-level frame generator tested directly; no `request.is_disconnected()`; kill stray venv `python.exe` if tests hang. ✓
