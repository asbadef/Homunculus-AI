# Dashboard B3 — Notification Delivery Design Spec

**Date:** 2026-07-25
**Status:** approved (design decisions locked with the user)
**Depends on:** B1 (live board + `Broadcaster` + SSE), B2 (acknowledge + `AckStore` + server-side escalation loop in `api/app.py`).

## Purpose

Today an alert only exists on the board — a clinician has to be *looking* to see it. B3 **pushes**
the alert to the clinician: a browser/in-app notification (toast + desktop Web Notification + sound)
when a high-urgency alert first appears, and again to the next tier when it escalates unacknowledged.
It is the difference between "the board knows" and "a human is told".

## Decisions locked with the user

1. **Channel (slice 1):** **in-app / browser only.** A toast on the dashboard + the browser
   **Web Notification API** (desktop notification + short sound), delivered over a dedicated
   `/notifications` SSE stream. **No external provider** — nothing leaves the system, so no PHI
   egress. Email/SMS (external providers + PHI governance) and webhooks are deferred.
2. **Triggers:** **new-immediate + escalation.** A notification fires when an `urgency == "immediate"`
   alert first appears, and again when an alert crosses into the escalated set. Both are deduplicated
   so the same event notifies once.
3. **Routing:** **role-based.** A new-alert notification targets the **nurse** audience; an
   escalation targets the **doctor** audience. The dashboard's existing role selector subscribes to
   the matching audience — no per-patient assignment model in this slice.

## Charter / PHI

The notification body is **PHI-minimal**: `"{patient_id}: {summary}"`, where `patient_id` is a bed
label (e.g. `bed-3`) and `summary` is the clinical finding already shown on the board (e.g. "Septic
shock criteria met"). No names, no MRN. Nothing beyond what the board already displays, and nothing
leaves the system. Recommendations-not-orders register is unchanged (notifications carry the alert's
own summary).

## Components

```
homunculus-engine/src/homunculus/api/
  notify.py     # Notification dataclass, Notifier (decide + dedup), NotificationHub (role-filtered fan-out)
  app.py        # (modify) build a Notifier + NotificationHub per app; hook /ingest + escalation; add /notifications
dashboard/src/
  api.js            # (modify) openNotifications(token, role, onNotify)
  notifications.js  # (new) Web Notification API + sound helper (permission, show, beep)
  Toasts.jsx        # (new) toast stack component
  Board.jsx         # (modify) subscribe to notifications for the selected role; render <Toasts>
```

### `Notification` (dataclass, frozen)

```
tenant: str
patient_id: str
kind: str
severity: str
urgency: str
audience: str          # "nurse" | "doctor"
trigger: str           # "new" | "escalation"
title: str             # e.g. "Yeni uyarı" / "Eskalasyon"
body: str              # PHI-minimal: f"{patient_id}: {summary}"
ts: str                # ISO-8601 UTC
```

### `Notifier`

Owns dedup state per tenant and turns alert/escalation events into `Notification`s:

- `for_new(tenant, alerts) -> list[Notification]`: for each alert with `urgency == "immediate"` whose
  `(patient_id, kind)` is **not** already in the tenant's `notified_new` set, emit a `new`/`nurse`
  notification and record the key.
- `prune(tenant, live_keys)`: drop `notified_new` keys no longer live, so a *recurrence* of the same
  alert after it clears will notify again (mirrors `AckStore.prune`).
- `for_escalation(tenant, newly_escalated, alert_by_key) -> list[Notification]`: for each key in the
  **transition** set (the escalation cycle already computes "newly escalated"), emit an
  `escalation`/`doctor` notification. The transition *is* the dedup — no separate set needed.

### `NotificationHub`

Like `Broadcaster` but fan-out is **role-filtered**:

- `subscribe(tenant, role) -> asyncio.Queue`
- `unsubscribe(tenant, role, queue)`
- `async publish(tenant, notification)`: enqueue only to subscribers whose `role == notification.audience`.

## Wiring in `app.py`

- Build one `Notifier` and one `NotificationHub` per app; expose on `app.state` for tests.
- **`/ingest`**: after `engine.ingest(...)` + first-seen stamping, call
  `notifier.for_new(hospital, engine.active_alerts(patient_id))`, `notifier.prune(...)`, and
  `await hub.publish(hospital, n)` for each. (Board publish unchanged.)
- **`_escalation_cycle`**: it already computes `newly` and the transition. For the newly-added keys,
  build an `alert_by_key` map and `await hub.publish(...)` each escalation notification.
- **`GET /notifications?token=…&role=nurse|doctor`**: authenticate the tenant, `hub.subscribe`, stream
  frames via a module-level `sse_notification_frames(queue, keepalive)` (same shape/lesson as
  `sse_board_frames`: do not read `request.receive`; unit-test the generator directly).

## Frontend

- `notifications.js`: `ensurePermission()` (calls `Notification.requestPermission()` if available),
  `showDesktop(title, body)` (guarded `new Notification(...)`), `beep()` (a short WebAudio tone).
  All guarded so a browser without the API (or jsdom) degrades to no-op.
- `openNotifications(token, role, onNotify)`: `EventSource` to
  `/notifications?token=…&role=…`; parse each frame and call `onNotify(notification)`.
- `Toasts.jsx`: a fixed-corner stack; each toast auto-dismisses after ~8 s; escalation toasts styled
  red, new-alert toasts amber; clicking a toast selects that patient.
- `Board.jsx`: on mount and whenever `role` changes, (re)open the notification stream for that role;
  on each notification push a toast, call `showDesktop` + `beep`, and keep the board stream as-is.

## Test plan (TDD)

**Backend (pytest):**
- `Notifier.for_new`: emits one `new`/`nurse` notification for an immediate alert; **not** for a
  `soon`/`routine` alert; **not** twice for the same key; again after `prune` drops the key.
- `Notifier.for_escalation`: emits `escalation`/`doctor` for each newly-escalated key.
- `NotificationHub`: a nurse subscriber receives a `nurse` notification and **not** a `doctor` one;
  role-filtered fan-out; unsubscribe removes the queue.
- `sse_notification_frames`: yields a `data:` frame for a queued notification and a keep-alive on idle.
- `/ingest` integration: posting a shock scenario publishes a nurse notification onto the hub.
- Escalation integration: driving `app.state.escalation_cycle` past threshold publishes a doctor
  notification (reuse B2's injectable cycle + `run_escalation_loop=False`).
- Tenant isolation: HOSP1 notifications never reach a HOSP2 subscriber.

**Frontend (Vitest + RTL):**
- `Toasts` renders a toast for a pushed notification and removes it on dismiss.
- `Board` shows a toast when the injected `openNotifications` fires a notification.
- `notifications.js` helpers no-op safely when the Web Notification API is absent (jsdom).

## Out of scope (later slices)

Email / SMS / webhook channels (external providers + PHI governance); per-patient assignment routing;
a persistent **notification history / audit** (arrives with B4 Postgres + audit); user-level
notification preferences; mobile push.
