# Polished, Deployable PWA Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shareable, installable, offline-capable PWA demo of the dashboard — real engine output recorded to static JSON and replayed in the browser, with a clinical-grade Tailwind redesign — deployable to Vercel with no backend.

**Architecture:** A Python recorder runs the real engine over each scenario and writes a static timeline JSON. A browser `demoTransport` replays those frames through the dashboard's existing injected-transport seam (Board is untouched). The UI is redesigned in Tailwind (dark clinical theme, severity colour scale, Lucide icons, Figtree font). `vite-plugin-pwa` makes it installable/offline; `vercel.json` ships it as a static SPA.

**Tech Stack:** React 18 + Vite, Tailwind CSS, lucide-react, @fontsource/figtree, vite-plugin-pwa (Workbox), Vitest, Python (engine recorder). No backend at runtime.

Spec: `docs/superpowers/specs/2026-07-26-polished-pwa-demo-design.md`.
Design tokens: `design-system/homunculus/MASTER.md` (from ui-ux-pro-max) — dark clinical, medical teal.

---

## Design system (locked — use these exact tokens)

- **Theme:** dark clinical (OLED-friendly, WCAG AA+). Surfaces on slate; colour is never the sole signal (always icon + label too).
- **Neutrals:** bg `slate-950` (#020617), surface `slate-900` (#0f172a), raised `slate-800`, border `slate-700`, text `slate-100`, muted `slate-400`.
- **Brand:** teal `#0891b2` (header, primary actions, focus ring).
- **Severity scale (the clinical core — one scale everywhere):**
  `info` slate-400 · `low` emerald-500 (#10b981) · `moderate` amber-500 (#f59e0b) · `high` orange-500 (#f97316) · `critical` red-500 (#ef4444).
- **State accents:** escalated = red-600 banner · chronic/downgraded = slate (muted, no alarm) · stale = amber-400.
- **Font:** Figtree (bundled offline via `@fontsource-variable/figtree`), system-ui fallback.
- **Icons:** `lucide-react` only — **no emoji** (replace 🔴/⚠/⏱/›/× with `Circle`/`AlertTriangle`/`Clock`/`ChevronRight`/`X`).
- **Motion:** 150–300ms transitions; respect `prefers-reduced-motion`.

---

## PHASE 1 — Recorded-replay demo (the engine that makes Vercel possible)

### Task 1: `record_demo.py` — capture real engine output to a timeline JSON

**Files:**
- Create: `homunculus-engine/scripts/record_demo.py`
- Test: `homunculus-engine/tests/test_record_demo.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_record_demo.py
import json
from pathlib import Path

import homunculus.scenarios
from scripts_record_demo import record   # imported via the shim below

SCEN = Path(homunculus.scenarios.__file__).parent


def test_records_septic_shock_timeline_ending_in_the_alert(tmp_path):
    out = tmp_path / "septic_shock.json"
    record(SCEN / "septic_shock.yaml", out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["scenario"] == "septic_shock"
    ts = [f["t"] for f in data["frames"]]
    assert ts == sorted(ts)                      # monotonic time
    last_boards = data["frames"][-1]["boards"]
    bed3 = next(b for b in last_boards if b["patient_id"] == "bed-3")
    assert any(a["kind"] == "septic_shock" for a in bed3["alerts"])


def test_stable_scenario_records_no_alerts(tmp_path):
    out = tmp_path / "stable.json"
    record(SCEN / "stable_control.yaml", out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert all(not b["alerts"] for f in data["frames"] for b in f["boards"])
```

Add a tiny import shim so the test can import the script module:
`homunculus-engine/tests/scripts_record_demo.py`:
```python
import importlib.util, pathlib
_spec = importlib.util.spec_from_file_location(
    "record_demo", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "record_demo.py")
record_demo = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(record_demo)
record = record_demo.record
```

- [ ] **Step 2: Run — expect ImportError.** `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_record_demo.py -q`

- [ ] **Step 3: Implement** `scripts/record_demo.py`

```python
# homunculus-engine/scripts/record_demo.py
"""Run the real engine over a scenario and record the exact board frames + notifications it emits,
as a static JSON the browser demo replays. Synthetic data only — never any PHI."""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import homunculus.scenarios
from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot
from homunculus.api.notify import Notifier
from homunculus.pipeline import Engine
from homunculus.scenarios.loader import load_scenario

SCEN = Path(homunculus.scenarios.__file__).parent


def record(scenario_path: str | Path, out_path: str | Path, step_seconds: float = 1.0) -> None:
    scenario_path, out_path = Path(scenario_path), Path(out_path)
    engine, store, notifier = Engine(), AckStore(), Notifier()
    frames, history = [], []
    for i, (_ts, fhir) in enumerate(load_scenario(scenario_path)):
        from homunculus.gateway.fhir import parse_fhir_observation
        obs = parse_fhir_observation(fhir)
        engine.ingest(obs, now=obs.timestamp)
        wall = datetime.now(timezone.utc)
        for a in engine.active_alerts(obs.patient_id):
            store.stamp_first_seen(obs.patient_id, a.kind, wall)
        notes = [asdict(n) for n in notifier.for_new("DEMO", engine.active_alerts(obs.patient_id))]
        history.extend(notes)
        frames.append({"t": round(i * step_seconds, 3),
                       "boards": board_snapshot(engine, store),
                       "notifications": notes})
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "scenario": scenario_path.stem, "step_seconds": step_seconds,
        "frames": frames, "notification_history": history}, indent=2), encoding="utf-8")


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "septic_shock.yaml"
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(
        __file__).resolve().parents[2] / "dashboard" / "public" / "demo" / f"{Path(name).stem}.json"
    record(SCEN / name, out)
    print(f"recorded {name} -> {out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Generate the committed demo data** for all three scenarios:

```bash
cd homunculus-engine
for s in septic_shock stable_control under_resuscitated; do \
  .venv/Scripts/python.exe scripts/record_demo.py $s.yaml; done
```

- [ ] **Step 6: Commit** `feat(demo): record real engine output to static timeline JSON`

---

### Task 2: `demoTransport.js` — replay the timeline through the Board seam

**Files:**
- Create: `dashboard/src/demoTransport.js`
- Test: `dashboard/src/demoTransport.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/demoTransport.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeDemoTransport } from "./demoTransport.js";

const timeline = {
  scenario: "t", step_seconds: 0.01,
  frames: [
    { t: 0, boards: [{ patient_id: "bed-3", risk: "none", latest: { sofa: 0 }, alerts: [] }], notifications: [] },
    { t: 1, boards: [{ patient_id: "bed-3", risk: "critical", latest: { sofa: 8 },
        alerts: [{ kind: "septic_shock", severity: "critical", urgency: "immediate", summary: "Septik şok",
                   clinical_reasoning: "r", supporting_evidence: ["s"], recommended_actions: ["Review."],
                   confidence: "c", acknowledged: false, escalated: false, stale_inputs: [] }] }],
      notifications: [{ patient_id: "bed-3", kind: "septic_shock", audience: "nurse", trigger: "new",
                        title: "Yeni uyarı", body: "bed-3: Septik şok", ts: "t" }] },
  ],
  notification_history: [{ id: 1, ts: "t", patient_id: "bed-3", subject: "septic_shock",
                           payload: { trigger: "new", audience: "nurse" } }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("demoTransport", () => {
  it("fetchBoard returns the first frame's boards", async () => {
    const t = makeDemoTransport(timeline);
    expect(await t.fetchBoard()).toEqual(timeline.frames[0].boards);
  });

  it("openStream emits later frames on the timer", () => {
    const t = makeDemoTransport(timeline);
    const updates = [];
    t.openStream("tok", (b) => updates.push(b), () => {});
    vi.advanceTimersByTime(1000);
    expect(updates.some((b) => b.risk === "critical")).toBe(true);
  });

  it("openNotifications filters by role", () => {
    const t = makeDemoTransport(timeline);
    const nurse = [];
    t.openNotifications("tok", "nurse", (n) => nurse.push(n));
    t.openNotifications("tok", "doctor", () => { throw new Error("doctor should get none here"); });
    vi.advanceTimersByTime(1000);
    expect(nurse).toHaveLength(1);
  });

  it("ackAlert flips acknowledged client-side", async () => {
    const t = makeDemoTransport(timeline);
    await t.fetchBoard();
    t.openStream("tok", () => {}, () => {});
    vi.advanceTimersByTime(1000);
    const board = await t.ackAlert("tok", "bed-3", "septic_shock", "doctor");
    const a = board.alerts.find((x) => x.kind === "septic_shock");
    expect(a.acknowledged).toBe(true) && expect(a.acknowledged_by).toBe("doctor");
  });

  it("fetchAudit returns the notification history", async () => {
    const t = makeDemoTransport(timeline);
    expect(await t.fetchAudit("tok", { eventType: "notification" })).toEqual(timeline.notification_history);
  });
});
```

- [ ] **Step 2: Run — expect failure.** `cd dashboard && npx vitest run src/demoTransport.test.js`

- [ ] **Step 3: Implement**

```js
// src/demoTransport.js — replays a recorded timeline through the Board's transport seam. No network.
export function makeDemoTransport(timeline, { speed = 1 } = {}) {
  const stepMs = Math.max(30, timeline.step_seconds * 1000 / speed);
  let current = new Map(timeline.frames[0].boards.map((b) => [b.patient_id, b]));

  return {
    async fetchBoard() { return timeline.frames[0].boards; },

    openStream(_token, onUpdate, onStatus = () => {}) {
      onStatus("open");
      const timers = timeline.frames.slice(1).map((frame) =>
        setTimeout(() => {
          for (const b of frame.boards) { current.set(b.patient_id, b); onUpdate(b); }
        }, frame.t * stepMs));
      return () => timers.forEach(clearTimeout);
    },

    openNotifications(_token, role, onNotify) {
      const timers = timeline.frames.map((frame) =>
        setTimeout(() => frame.notifications.filter((n) => n.audience === role).forEach(onNotify),
                   frame.t * stepMs));
      return () => timers.forEach(clearTimeout);
    },

    async ackAlert(_token, patientId, kind, role) {
      const board = current.get(patientId);
      const updated = { ...board, alerts: board.alerts.map((a) =>
        a.kind === kind ? { ...a, acknowledged: true, acknowledged_by: role,
                            acknowledged_at: new Date().toISOString(), escalated: false } : a) };
      current.set(patientId, updated);
      return updated;
    },

    async fetchAudit(_token, { eventType } = {}) {
      return eventType === "notification" ? timeline.notification_history : [];
    },

    recordView() {},
  };
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(demo): browser transport that replays a recorded timeline`

---

### Task 3: Demo entry — `?demo=1` renders Board with demo transports

**Files:**
- Create: `dashboard/src/demo.jsx`
- Modify: `dashboard/src/main.jsx`
- Test: `dashboard/src/demo.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// src/demo.test.jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DemoApp } from "./demo.jsx";

const timeline = { scenario: "t", step_seconds: 0.01,
  frames: [{ t: 0, boards: [{ patient_id: "bed-3", risk: "none", latest: { sofa: 0 }, alerts: [] }], notifications: [] }],
  notification_history: [] };

afterEach(() => vi.restoreAllMocks());

describe("DemoApp", () => {
  it("loads the timeline and renders the board with a DEMO banner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => timeline }));
    render(<DemoApp scenario="septic_shock" />);
    await waitFor(() => expect(screen.getByText("bed-3")).toBeInTheDocument());
    expect(screen.getByText(/DEMO/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect failure.**

- [ ] **Step 3: Implement**

```jsx
// src/demo.jsx — self-contained demo: fetch a recorded timeline, replay it through <Board>.
import React, { useEffect, useState } from "react";
import { Board } from "./Board.jsx";
import { makeDemoTransport } from "./demoTransport.js";

export function DemoApp({ scenario = "septic_shock" }) {
  const [t, setT] = useState(null);
  useEffect(() => {
    let ok = true;
    fetch(`${import.meta.env.BASE_URL}demo/${scenario}.json`)
      .then((r) => r.json()).then((tl) => { if (ok) setT(makeDemoTransport(tl)); }).catch(() => {});
    return () => { ok = false; };
  }, [scenario]);
  if (!t) return <div className="p-6 text-slate-400">Demo yükleniyor…</div>;
  return (
    <>
      <div className="fixed bottom-3 left-3 z-[2000] rounded-full bg-teal-600 px-3 py-1 text-xs
                      font-semibold text-white shadow">DEMO · sentetik veri</div>
      <Board token="demo" fetchBoard={t.fetchBoard} openStream={t.openStream}
             openNotifications={t.openNotifications} ackAlert={t.ackAlert}
             fetchAudit={t.fetchAudit} recordView={t.recordView} />
    </>
  );
}
```

Modify `src/main.jsx` to route `?demo=1` (or `#/demo`) to `<DemoApp>`:
```jsx
import { DemoApp } from "./demo.jsx";
// inside the render decision:
const params = new URLSearchParams(window.location.search);
const isDemo = params.get("demo") === "1" || window.location.hash.startsWith("#/demo");
root.render(<React.StrictMode>{isDemo ? <DemoApp scenario={params.get("scenario") || "septic_shock"} /> : <App />}</React.StrictMode>);
```

- [ ] **Step 4: Run — expect PASS**; run full frontend suite — no regression.
- [ ] **Step 5: Commit** `feat(demo): ?demo=1 entry replays a recorded scenario`

---

## PHASE 2 — Tailwind + clinical design system

### Task 4: Install and configure Tailwind + fonts + icons + severity tokens

**Files:**
- Modify: `dashboard/package.json`, `dashboard/vite.config.js`, `dashboard/index.html`
- Create: `dashboard/tailwind.config.js`, `dashboard/postcss.config.js`, `dashboard/src/index.css`, `dashboard/src/theme.js`
- Modify: `dashboard/src/main.jsx` (import `./index.css`, `@fontsource-variable/figtree`)

- [ ] **Step 1: Install**

```bash
cd dashboard
npm install -D tailwindcss postcss autoprefixer
npm install lucide-react @fontsource-variable/figtree
npx tailwindcss init -p
```

- [ ] **Step 2: `tailwind.config.js`** — content globs + severity + brand tokens

```js
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" },
        sev: { info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444" },
      },
      fontFamily: { sans: ["'Figtree Variable'", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
```

- [ ] **Step 3: `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }
html, body, #root { height: 100%; }
body { @apply bg-slate-950 text-slate-100 font-sans antialiased; }

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
```

- [ ] **Step 4: `src/theme.js`** — one severity→token map used by every component

```js
// Single source of truth for severity styling. Colour is never the only signal — callers pair it
// with an icon + label.
export const SEV = {
  info:     { text: "text-sev-info",     ring: "ring-sev-info/40",     dot: "bg-sev-info" },
  low:      { text: "text-sev-low",      ring: "ring-sev-low/40",      dot: "bg-sev-low" },
  moderate: { text: "text-sev-moderate", ring: "ring-sev-moderate/40", dot: "bg-sev-moderate" },
  high:     { text: "text-sev-high",     ring: "ring-sev-high/40",     dot: "bg-sev-high" },
  critical: { text: "text-sev-critical", ring: "ring-sev-critical/50", dot: "bg-sev-critical" },
};
export const sev = (s) => SEV[s] || SEV.info;
export const riskLabel = { none: "Stabil", low: "Düşük", high: "Yüksek", critical: "Kritik" };
```

- [ ] **Step 5:** In `src/main.jsx` add at top: `import "@fontsource-variable/figtree"; import "./index.css";`. Set `<meta name="theme-color" content="#0891b2">` and `<html lang="tr" class="dark">` in `index.html`.

- [ ] **Step 6:** Run the frontend suite (`npx vitest run`) — must stay green (styling only; behaviour unchanged).
- [ ] **Step 7: Commit** `chore(dashboard): Tailwind + Figtree + Lucide + severity tokens`

---

### Task 5: Redesign the Board shell (header, role, escalation strip, history)

**Files:** Modify `dashboard/src/Board.jsx`. Behaviour and all injected props unchanged — only markup/classes and emoji→Lucide.

- [ ] **Step 1:** Replace inline styles with Tailwind: a `grid grid-cols-[320px_1fr] h-screen` shell; a header with the brand mark (`<Activity className="text-brand"/>` from lucide-react), title, and a live `status` pill (green when "live"). Role `<select>` styled `bg-slate-800 border-slate-700 rounded`. The escalation strip uses `bg-sev-critical/10 border-sev-critical/40` with an `<AlertTriangle>` icon (not 🔴). The history toggle becomes a `<button>` with a `<History>` icon.
- [ ] **Step 2:** Ensure every clickable has `cursor-pointer`, a visible `focus:ring-2 focus:ring-brand` state, and `transition-colors`. Escalation rows keep `onClick={() => selectPatient(...)}`.
- [ ] **Step 3:** Run `npx vitest run src/Board.test.jsx` — the tests assert text ("Eskale", "Bildirim geçmişi", "bed-3", "Kritik"): keep those exact strings. Fix only selectors that structurally changed; never weaken an assertion to hide a regression.
- [ ] **Step 4: Commit** `feat(ui): redesign Board shell (Tailwind, Lucide, severity tokens)`

---

### Task 6: Redesign PatientList + risk styling

**Files:** Modify `dashboard/src/PatientList.jsx`, delete/inline `dashboard/src/risk.js` styling into `theme.js` usage.

- [ ] **Step 1:** Each row: a severity dot (`<span className={`h-2.5 w-2.5 rounded-full ${sev(riskFromPatient).dot}`}/>`), the `patient_id` in `font-medium`, a right-aligned risk label using `riskLabel`, and a selected state (`bg-slate-800`). Rows are `min-h-11` (44px touch target), `hover:bg-slate-800/60`, `cursor-pointer`, `focus:outline-none focus:ring-2 focus:ring-brand`.
- [ ] **Step 2:** Keep the `onSelect(patient_id)` contract and the "Kritik/Yüksek" text the Board test relies on (render the risk label text somewhere the existing tests still find it — verify `Board.test.jsx`'s "shows the selected patient's detail" + "merges a stream update" still pass).
- [ ] **Step 3:** Run `npx vitest run src/PatientList.test.jsx src/Board.test.jsx` — green.
- [ ] **Step 4: Commit** `feat(ui): redesign patient list with the severity dot scale`

---

### Task 7: Redesign PatientDetail + AlertCard (the centrepiece)

**Files:** Modify `dashboard/src/PatientDetail.jsx`.

- [ ] **Step 1:** LatestStrip → a row of stat tiles (`grid grid-cols-4 gap-3`), each a `rounded-lg bg-slate-900 ring-1 ring-slate-800 p-3` with a muted label and a large value.
- [ ] **Step 2:** AlertCard → a `rounded-xl bg-slate-900 ring-1` card where the ring colour is `sev(alert.severity).ring`. Header row: an `<AlertTriangle className={sev(...).text}/>` (downgraded → `<Circle>` muted), the summary in `font-semibold`, and the badges:
  - escalated (not downgraded) → `bg-sev-critical text-white` pill "ESKALE EDİLDİ" with `<AlertTriangle>`.
  - downgraded → `bg-slate-700 text-slate-300` pill "Beklenen (kronik)".
  - `stale_inputs.length` → `bg-amber-400/15 text-amber-300` pill with `<Clock>` "Bayat veri: …".
  Keep these exact Turkish strings — the PatientDetail tests assert them.
- [ ] **Step 3:** Body: reasoning (`text-slate-300`), chronic_context (italic muted), a **Kaynak** row rendering citations as monospace chips, **Önerilen** actions as a checklist (`<ChevronRight>` bullets), **Güven** line. Ack area: acknowledged → green `<Check> Onaylandı: {by} · {time}`; else an `<button>` "Onayla" (`bg-brand hover:bg-brand/90 text-white rounded px-3 py-1.5`), hidden when downgraded.
- [ ] **Step 4:** Run `npx vitest run src/PatientDetail.test.jsx` — all existing assertions (summary, reasoning, citations, actions, confidence, "ESKALE EDİLDİ", "Beklenen (kronik)", "Bayat veri", "Onayla", "Onaylandı") stay green.
- [ ] **Step 5: Commit** `feat(ui): redesign patient detail + alert card`

---

### Task 8: Redesign Toasts + NotificationHistory

**Files:** Modify `dashboard/src/Toasts.jsx`, `dashboard/src/NotificationHistory.jsx`.

- [ ] **Step 1:** Toasts → `fixed top-3 right-3` stack; each toast `rounded-lg shadow-lg ring-1`, escalation `bg-sev-critical/95` / new `bg-sev-high/95`, an icon (`<AlertTriangle>`/`<Bell>`), title, body, and an `<X>` close button (`aria-label="kapat"` kept). `cursor-pointer`, 150ms enter transition.
- [ ] **Step 2:** NotificationHistory → a `divide-y divide-slate-800` list; each row a time (`text-slate-500 tabular-nums`), patient, subject, and a trigger chip. Keep "Bildirim geçmişi ({n})" and the click→`onSelect` contract.
- [ ] **Step 3:** Run `npx vitest run src/Toasts.test.jsx src/NotificationHistory.test.jsx` — green (the "kapat" label, "Bildirim geçmişi", subject text, trigger are all asserted).
- [ ] **Step 4: Commit** `feat(ui): redesign toasts + notification history`

---

## PHASE 3 — PWA + Vercel

### Task 9: PWA (installable, offline)

**Files:** Modify `dashboard/vite.config.js`, `dashboard/package.json`; Create `dashboard/public/icon-192.png`, `dashboard/public/icon-512.png` (maskable), `dashboard/public/icon.svg`.

- [ ] **Step 1: Install** `cd dashboard && npm install -D vite-plugin-pwa`.
- [ ] **Step 2:** Add to `vite.config.js` plugins:

```js
import { VitePWA } from "vite-plugin-pwa";
// plugins: [react(), VitePWA({...})]
VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["icon.svg", "demo/*.json"],
  manifest: {
    name: "Homunculus", short_name: "Homunculus",
    description: "ICU/NICU klinik erken-uyarı — demo (sentetik veri)",
    theme_color: "#0891b2", background_color: "#020617", display: "standalone",
    start_url: "/?demo=1", lang: "tr",
    icons: [
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: { globPatterns: ["**/*.{js,css,html,json,woff2,png,svg}"] },
})
```

- [ ] **Step 3:** Create the icons (a simple teal square with a white pulse/activity glyph). If tooling to author PNGs is unavailable, generate them from the SVG at build with a one-off Node/sharp script, or hand-place two exported PNGs; the `icon.svg` is the source of truth. (Do not ship placeholder/empty icons — the manifest must reference real images.)
- [ ] **Step 4:** Build and verify the service worker + manifest are emitted:

```bash
npm run build
# expect dist/sw.js and dist/manifest.webmanifest to exist
ls dist/sw.js dist/manifest.webmanifest
```

- [ ] **Step 5:** Run `npx vitest run` (PWA plugin must not break tests — it is build-time only). Green.
- [ ] **Step 6: Commit** `feat(pwa): installable, offline-capable demo (manifest + service worker)`

---

### Task 10: Vercel config + deploy runbook

**Files:** Create `vercel.json` (repo root), `docs/DEMO-DEPLOY.md`.

- [ ] **Step 1:** `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "cd dashboard && npm install && npm run build",
  "outputDirectory": "dashboard/dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 2:** `docs/DEMO-DEPLOY.md` — the runbook (the deploy itself is the user's action, in their Vercel account):

```markdown
# Deploying the Homunculus demo (Vercel)

The demo is a pure static PWA — no backend. Real engine output is pre-recorded into
`dashboard/public/demo/*.json`; the browser replays it. Synthetic data only.

## One-time
1. Push to GitHub (done).
2. In Vercel: **New Project → import `asbadef/Homunculus-AI`**. Vercel reads `vercel.json`
   (build `dashboard`, output `dashboard/dist`, Vite framework, SPA rewrite). Deploy.
3. Share the URL — open it (auto-lands on `/?demo=1`), pick a role, watch the scenario. Installable
   via the browser's "Add to Home Screen".

## Re-recording the demo data (after engine changes)
```
cd homunculus-engine
for s in septic_shock stable_control under_resuscitated; do \
  .venv/Scripts/python.exe scripts/record_demo.py $s.yaml; done
git add dashboard/public/demo && git commit -m "chore(demo): refresh recorded timelines"
```
Vercel redeploys on push.

## CLI alternative
`npm i -g vercel && vercel` from the repo root (uses `vercel.json`).
```

- [ ] **Step 3:** Local production check: `cd dashboard && npm run build && npm run preview`, open `http://localhost:4173/?demo=1`, confirm the scenario replays and installability prompt appears.
- [ ] **Step 4: Commit** `chore(deploy): vercel static config + demo deploy runbook`

---

## Self-Review

**Spec coverage:** recorded-replay engine→JSON (T1); demo transport over the Board seam (T2); demo entry + DEMO banner (T3); Tailwind + tokens + fonts + Lucide (T4); redesigned shell/list/detail/toasts/history (T5–T8); PWA installable+offline (T9); Vercel static config + runbook (T10). ✓

**Placeholder scan:** No TBD. The icon step (T9.3) gives a concrete source-of-truth SVG + explicit "no empty placeholders" rule rather than hand-waving. The redesign tasks give concrete tokens/classes/icons, not "make it nice." ✓

**Type consistency:** `makeDemoTransport(timeline)` returns exactly the transport names Board injects (`fetchBoard`, `openStream`, `openNotifications`, `ackAlert`, `fetchAudit`, `recordView`) — matches Board's props (T2↔T3↔Board). The recorded JSON shape (frames[].boards/notifications, notification_history) is produced in T1 and consumed identically in T2. `sev()`/`SEV` keys (info/low/moderate/high/critical) match the severity strings the engine emits. ✓

**Charter:** demo ships only synthetic recorded scenarios; no backend, no PHI; DEMO banner explicit (T1/T3/T9). ✓

**Behaviour-preservation:** every redesign task ends by running the existing Vitest assertions and forbids weakening them to mask regressions (T5–T8). The 29 existing tests are the safety net for the visual migration.
```
