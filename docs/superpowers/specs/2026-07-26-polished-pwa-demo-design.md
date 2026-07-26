# Polished, Deployable PWA Demo — Design Spec

**Date:** 2026-07-26
**Status:** approved (decisions locked with the user).
**Goal:** A shareable, always-on, installable demo of the Homunculus dashboard that a clinician can open from a link — no backend, no setup, no PHI — plus a clinical-grade visual redesign.

## Decisions locked with the user

1. **Deploy architecture → recorded-replay static demo.** The real FastAPI backend (SSE + background
   escalation loop + stateful engine) cannot run on Vercel's serverless model. Instead we **run the
   real engine once** over each scenario, **record** the exact board frames + notifications it emits
   into static JSON, and the browser **plays them back** on a timer. Pure static → Vercel + PWA fit
   perfectly, always works, deterministic, nothing can leak. Faithful because the frames are the real
   engine's output.
2. **UI → in-code redesign** with the `ui-ux-pro-max` + `ui-styling` skills: migrate the dashboard
   from inline styles to **Tailwind**, apply a calm, high-contrast, accessible clinical design system.
   One codebase, tests stay green, no port cost.
3. **PWA support** — installable, offline-capable (the static demo caches fully).

## Why the demo transport is a clean seam

`Board` already takes injected transports (`fetchBoard`, `openStream`, `openNotifications`,
`ackAlert`, `recordView`, `fetchAudit`). A **demo mode** simply renders `<Board>` with **demo
transports** that replay a recorded timeline — **zero changes to Board's logic**. This is the whole
reason the demo is cheap: the component contract is already transport-agnostic.

## Architecture

```
homunculus-engine/scripts/record_demo.py   # run engine over a scenario -> timeline JSON (real output)
dashboard/public/demo/<scenario>.json       # committed recorded timelines (SYNTHETIC data only)
dashboard/src/demoTransport.js               # replay: fetchBoard/openStream/openNotifications/ackAlert/fetchAudit/recordView
dashboard/src/demo.jsx                        # demo entry: <Board {...demoTransports}/> + a "DEMO" banner
dashboard/src/main.jsx (or router)            # ?demo=1 or /demo -> demo entry; else the live app
dashboard/ (Tailwind)                         # tailwind.config, index.css, redesigned components
dashboard/public/manifest.webmanifest + icons # PWA
dashboard/vite.config.js                      # vite-plugin-pwa
vercel.json                                    # static build + SPA rewrite
```

### Recorded timeline JSON shape

```json
{
  "scenario": "septic_shock",
  "step_seconds": 1.0,
  "frames": [
    { "t": 0, "boards": [ {patient board...} ], "notifications": [ {notification...} ] },
    { "t": 1, "boards": [ ... ], "notifications": [ ... ] }
  ],
  "notification_history": [ {audit notification record...} ]
}
```

`record_demo.py` drives the engine + `board_snapshot` + `Notifier` per observation (reusing the real
code paths), capturing the board snapshot and any new-alert/escalation notifications at each step.

### Demo transport behaviour (browser, no network)

- `fetchBoard(token)` → the first frame's boards.
- `openStream(token, onUpdate, onStatus)` → `onStatus("open")`, then a timer emits each subsequent
  frame's boards (per-patient) at `t * step_seconds` (accelerated, e.g. 1 real s per step); returns a
  cancel fn that clears the timer.
- `openNotifications(token, role, onNotify)` → emits recorded notifications whose `audience === role`
  at their frame time.
- `ackAlert(token, patientId, kind, role)` → **client-side**: mark that alert acknowledged in local
  state and resolve the updated board (the demo has no server; ack is simulated on the current frame).
- `fetchAudit(token, {eventType})` → the recorded `notification_history`.
- `recordView(...)` → no-op (best-effort in the real app anyway).

All demo transports are unit-tested with Vitest (fake timers).

## Visual redesign (ui-ux-pro-max + ui-styling)

- **Tailwind** replaces inline styles. A small clinical design system: neutral slate background,
  restrained accent, **severity colour scale** (info→low→moderate→high→critical) used consistently on
  the list, cards, and badges; a legible type scale; generous spacing; dark-mode-aware.
- Components redesigned, behaviour unchanged: **PatientList** (risk-dot rows), **PatientDetail /
  AlertCard** (clear hierarchy: summary → reasoning → evidence/citation → actions → ack; escalation,
  chronic, and stale badges), **Board shell** (header, role selector, escalation strip, history
  panel), **Toasts**, **NotificationHistory**.
- Accessibility: sufficient contrast, focus states, `aria` on interactive elements, colour never the
  sole signal (icon/label too — matters for a clinical tool).

## PWA

- `vite-plugin-pwa` (autoUpdate): generates the service worker + manifest, precaches the static app +
  demo JSON so it works offline and is installable ("Add to Home Screen"). App name "Homunculus",
  theme colour, maskable icons (192/512).

## Vercel

- Static build (`npm run build` → `dist`); `vercel.json` sets the framework to Vite and a SPA
  rewrite so `/demo` and deep links resolve to `index.html`. **Deploy itself is the user's action**
  (connect the repo / `vercel` CLI in their account) — this slice prepares everything so it is
  one-click; a runbook is included.

## Charter / PHI

The demo ships only **synthetic** recorded timelines (the existing scenarios), committed as static
JSON. No PHI, no backend, nothing leaves the browser. The DEMO banner makes clear it is a
demonstration, not a live patient.

## Test plan

- `record_demo.py`: over `septic_shock`, the timeline's last frame contains a `septic_shock` alert;
  a stable scenario yields no alerts; output is valid JSON with monotonic `t`.
- `demoTransport`: `fetchBoard` returns frame 0; `openStream` emits later frames on a fake timer;
  `openNotifications` filters by role; `ackAlert` flips acknowledged client-side; `fetchAudit`
  returns history.
- Board renders in demo mode from the transports (one integration test with a tiny inline timeline).
- Redesign: existing 29 tests stay green (they assert text/behaviour); adjust selectors only where a
  redesign genuinely changes structure, never to paper over a regression.
- PWA: build produces a service worker + manifest (smoke check the build output).

## Out of scope (later)

Live backend hosting (option B); a real login/landing; multi-scenario switcher UI beyond a simple
selector; i18n beyond the current Turkish strings; analytics.
