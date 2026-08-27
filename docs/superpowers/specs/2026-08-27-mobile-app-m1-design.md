# Homunculus mobile — M1: the recorded-ward companion app

**Date:** 2026-08-27
**Status:** design approved

## Context

The clinical core, the board API and the web dashboard exist. What does not exist is anything a
clinician can carry: the ward board only lives on a browser tab on a workstation. This slice builds
the mobile companion — an Expo/React Native app whose job is triage at a glance and the reasoning
behind an alert, in a clinician's hand.

Two facts about the current system shape the whole design.

**The live API is not reachable by a logged-in user yet.** The board routes (`/patients`,
`/alerts/{id}`, `/ack`, `/stream`) authenticate with a static per-hospital tenant token; `/auth/*`
authenticates with a JWT; the two schemes do not know about each other. Bridging them is a separate,
already-designed slice (`2026-08-27-live-board-auth-bridge-design.md`, approved, not yet built).
Until it ships there is no credential a mobile client can hold that reads the live board — and the
tenant token cannot be shipped to a phone, because it also authorises `/ingest`.

**There is already a faithful offline data source.** `scripts/record_demo.py` runs the real engine
over a scenario and records the exact board frames and notifications it emits, as static JSON. Three
recordings are committed under `dashboard/public/demo/`. This is genuine engine output over
synthetic patients — not fabricated screens.

So M1 targets the recording, and M2 (later, after the auth bridge) swaps the data source behind an
interface that the screens never see.

## Decisions locked with the user

| Question | Decision |
| --- | --- |
| Data source for M1 | Recorded-scenario replay. No backend dependency. |
| Screens | Three tabs — Patients, Alerts, Settings — plus a patient detail screen. An Audit tab is deferred to M2 rather than shown with invented records. |
| Language | Turkish UI, with every string in one typed catalogue (`src/i18n/tr.ts`) read through `t()`, so a second locale is a file rather than a refactor. |
| Ward richness | Three beds from the three existing recordings, merged into one ward. No new scenarios authored. |
| Theme | Obsidian dark only, taken to full polish. |
| Verification | Expo Go on the user's phone is the primary target; `expo start --web` is kept working so the design can also be inspected in a browser. |

The ward decision has a cost, taken deliberately and recorded here rather than discovered later:
the existing recordings emit `stale_inputs: []`, `downgraded: false` and `chronic_context: ""` for
every alert. The staleness badge and the chronic-context treatment are therefore built and unit
tested against fixtures, but render nothing on M1's data. They are ready for the first scenario or
live feed that produces them.

## Architecture

### 1. Where it lives and what it is built from

A new top-level package `homunculus-mobile/`, with its own `package.json`, independent of
`dashboard/`. TypeScript in `strict` mode.

Stack: Expo + Expo Router (file-system routing), NativeWind v4 (Tailwind for React Native),
React Native Reanimated + Moti (animation), `react-native-svg` (sparklines), `expo-haptics`,
`expo-blur` (glass cards), `lucide-react-native` (icons — no emoji, matching the dashboard's rule).

Versions are deliberately **not** pinned in this spec. The project is created with
`create-expo-app@latest` and every dependency is added with `npx expo install`, which resolves the
version matching that SDK. Writing SDK numbers into a design document is how a project acquires a
dependency graph that no longer installs.

### 2. Layers, and the rule that keeps them apart

```
homunculus-mobile/
├── app/                        # Expo Router only: layout, tabs, patient/[id]
├── src/
│   ├── transport/              # types.ts, replayTransport.ts     (M2: sseTransport.ts)
│   ├── store/                  # boardStore.ts — pure reducer + hook
│   ├── domain/                 # risk.ts, escalation.ts, staleness.ts, sparkline.ts,
│   │                           # noOrders.ts, citations.ts
│   ├── ui/                     # PatientCard, VitalTile, VitalSparkline, AlertCard,
│   │                           # GuidelineDrawer, StalenessBadge, RiskPill, Skeleton
│   ├── theme/                  # tokens.ts + tailwind preset
│   └── i18n/                   # tr.ts, t()
├── assets/demo/icu-ward.json   # the recorded ward, bundled
└── __tests__/
```

The rule: **no clinical or ordering logic in `app/` or `src/ui/`.** Risk ordering, the escalation
threshold, staleness labels, sparkline geometry and the no-orders vocabulary all live in
`src/domain/` as pure functions over plain data. They are tested without mounting a component or
opening a phone, and a component's test then only has to prove it renders what the function
returned.

### 3. The transport seam

One interface separates "where the board comes from" from "what the board looks like":

```ts
export type Role = "nurse" | "doctor";

export interface Transport {
  start(): void;
  stop(): void;
  subscribe(listener: {
    onBoard(board: PatientBoard): void;
    onNotification(note: Notification): void;
  }): () => void;
  ack(patientId: string, kind: string, role: Role): Promise<void>;
}
```

`PatientBoard` mirrors `api/board.py` exactly — `patient_id`, `risk`, `alerts[]`, and `latest`
with `heart_rate`, `map`, `lactate`, `sofa`. Each alert carries the fields `_merge_alert` produces:
`kind`, `severity`, `urgency`, `summary`, `clinical_reasoning`, `recommended_actions`,
`supporting_evidence`, `confidence`, `source`, `downgraded`, `chronic_context`, `stale_inputs`,
`acknowledged`, `acknowledged_by`, `acknowledged_at`, `first_seen_at`, `escalated`. The types are
hand-written from that payload and asserted against the committed recording in a test, so a backend
shape change fails a test here rather than blanking a screen.

`replayTransport` walks the recorded frames at `step_seconds`, emits each board and notification,
and loops back to the start when it reaches the end. It exposes play/pause/seek/speed for the
Settings screen. It takes its clock as an injected parameter so tests drive it with fake timers
instead of waiting.

`boardStore` is a pure reducer over those events — a patient map keyed by `patient_id`, a
notification list, and locally acknowledged keys — behind a React hook. `ack` in replay mode is
local: it marks the alert, stops its escalation timer, and is cleared when the scenario loops.

### 4. The recorded ward (the one backend change)

`record_demo.py` gains `record_ward(scenario_paths, out_path, step_seconds)`: it merges the events
of several scenarios into one absolute-time-ordered stream and feeds them through a **single**
`Engine`, `AckStore` and `Notifier`. The engine is already multi-patient — `board_snapshot` iterates
`engine.patient_ids()` — so no change to the scenario loader or the engine is needed.

The output, `homunculus-mobile/assets/demo/icu-ward.json`, is a three-bed ICU: `bed-3` deteriorating
into septic shock (critical), `bed-7` hypoperfused before adequate fluid (high), `bed-5` stable
(none). Same file shape as the existing recordings, so `replayTransport` reads either.

A pytest case covers it: all three beds appear in the merged board, events stay in timestamp order,
and the notifications the individual recordings produced are still produced.

### 5. Escalation is a ported rule, not invented state

`api/escalation.py` is a pure function — an alert escalates when its urgency is `immediate`, it is
unacknowledged, and `now - first_seen >= threshold`. The recorded frames carry `first_seen_at`, and
the app owns the acknowledgements in replay mode, so `src/domain/escalation.ts` reimplements that
rule verbatim and is tested against the same cases as the Python original. This is a port of a real
rule, not a screen pretending to have data behind it.

One honest adjustment: a fifteen-second replay never crosses a five-minute threshold. The app uses a
compressed demo threshold (default 20 seconds), adjustable in Settings and labelled there as a demo
acceleration, not a clinical parameter.

### 6. Screens

**Patients (tab).** The ward ordered by risk (critical → none), unacknowledged before acknowledged
within a band. Each card: bed identifier (`ICU Yatak 3`), a risk pill, the most severe alert's
summary, a miniature heart-rate sparkline, the SOFA total, and markers for unacknowledged and
escalated. Pressing scales the card to `0.97` and springs back; a critical card carries a slow
pulsing outer glow; list changes animate with `Layout.springify()`; the first load shows shimmering
skeletons rather than an empty screen.

**Patient detail.** A vitals grid — heart rate, MAP, lactate, SOFA — as `VitalTile`s that can carry
a staleness badge. Sparklines are drawn from the values accumulated as the replay advances, and are
labelled with scenario elapsed time; they are **not** described as a 12-hour trend, because the
recording is not twelve hours. Then the alert cards: severity-coloured, showing `summary`,
`clinical_reasoning`, `recommended_actions`, `confidence`, with `supporting_evidence` opening the
guideline drawer, and an acknowledge button.

**Guideline drawer.** A bottom sheet that resolves a citation id (e.g. `sepsis-3-jama-2016`) to the
title and `authority` of the matching note in `Homunculus/wiki/sources/`, through a hand-compiled
static catalogue in `src/domain/citations.ts`. The catalogue is transcribed from the vault. No DOI,
author list or recommendation grade is minted: the strength wording shown is the alert's own
`confidence` string and nothing else. A citation with no catalogue entry renders as the raw id plus
"kaynak notu bulunamadı" rather than a plausible-looking invention.

**Alerts (tab).** The notification stream, newest first, with escalated items in their own section.
An arriving `immediate` notification fires a haptic (`Haptics.notificationAsync`) and a toast;
escalation uses a heavier pattern than a new alert, so urgency is felt and not only read.

**Settings (tab).** Replay controls (play, pause, restart, speed), role (nurse/doctor), haptics on
or off, the demo escalation threshold, the app version, and a permanent "GÖSTERİM VERİSİ" banner
stating that everything on screen is recorded synthetic data.

### 7. Design system

`src/theme/tokens.ts` holds the palette from the blueprint as the single source of colour, consumed
by both the NativeWind preset and any inline animated style:

| Token | Value | Use |
| --- | --- | --- |
| `background` | `hsl(222, 47%, 8%)` | screen ground |
| `card` | `hsl(222, 40%, 12%)` | surfaces |
| `border` | `hsl(217, 30%, 20%)` | hairlines |
| `clinical.safe` | `hsl(142, 60%, 45%)` | no active alert |
| `clinical.warning` | `hsl(38, 92%, 50%)` | moderate/high |
| `clinical.critical` | `hsl(346, 84%, 55%)` | critical / escalated |
| `clinical.stale` | `hsl(215, 15%, 60%)` | staleness badges, muted text |

Severity maps onto those three clinical hues through one function in `src/domain/risk.ts`; no
component picks a colour by hand. Alert cards are glass (`expo-blur` over a translucent surface)
with a thin coloured border rather than a solid severity block, so a ward of cards reads as texture
with one thing shouting. Contrast for text on every surface is checked against WCAG AA during
implementation.

### 8. Charter rules become tests

The two rules most easily lost in UI work are enforced mechanically:

- **No orders.** `src/domain/noOrders.ts` holds a forbidden-verb vocabulary (Turkish and English:
  ver, uygula, başla, enjekte, order, give, administer, …). A test runs every
  `recommended_actions` string in the committed recordings, and every string in `src/i18n/tr.ts`,
  through it. The charter rule fails a test run instead of surviving review.
- **No PHI.** A test asserts the board payload type has no name, identifier or date-of-birth field,
  and that the patient screens render only the bed identifier. Age and sex are not displayed at all
  in M1 — the recording does not carry them, and they will not be invented for a demo.

## Testing

`jest-expo` with `@testing-library/react-native`, test-first in this order:

1. **Domain** — risk ordering and colour mapping; the escalation port against the Python cases;
   staleness label formatting; sparkline path geometry (fixed input points → expected path); the
   no-orders vocabulary.
2. **Transport** — replay emits frames in order at the configured step, loops, and honours
   pause/seek/speed, driven by fake timers; the committed recording parses into the declared types.
3. **Store** — reducer: board upsert, notification append, local ack, reset on loop.
4. **Screens** — the patient list orders and labels correctly; detail renders reasoning, actions and
   citations; the drawer resolves a known citation and degrades honestly on an unknown one; the
   settings banner is present. State is asserted through accessibility labels, never by waiting on
   an animation.
5. **Backend** — the `record_ward` pytest case described in §4.

`npx expo start --web` must render the app without a crash; blur and haptics degrade to a flat
surface and a no-op there, and that degradation is explicit in the components rather than accidental.

## Known limits, stated rather than designed around

- Staleness and chronic-context rendering has no data in M1 (§ Decisions). Built, tested, dormant.
- Sparklines cover scenario time, not twelve hours, and say so.
- Acknowledgements are local and vanish when the replay loops. Nothing is persisted; there is no
  backend to persist to in this slice.
- The escalation threshold shown is a demo acceleration, not the server's five minutes.
- Web preview is a verification aid, not a supported target.
- No authentication screen. Adding a login that authenticates against nothing would be worse than
  having none; it arrives in M2 with the real one.

## Out of scope (M2 and later)

- The live SSE transport, JWT + TOTP login, secure token storage (`expo-secure-store`), and the
  stream-ticket exchange — all blocked on the auth-bridge slice.
- The Audit tab, which needs the real `/audit` route.
- Push notifications (they need a backend push service and a PHI review of what a lock screen may
  show), background delivery, and offline persistence.
- Richer scenarios that would exercise staleness, chronic-context downgrade and NEWS2 bands.
- A light theme.
- App-store builds and signing; M1 runs in Expo Go.
