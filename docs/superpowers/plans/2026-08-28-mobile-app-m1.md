# Homunculus Mobile M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `homunculus-mobile/` — an Expo/React Native companion app that replays the engine's own recorded ward (three ICU beds) as a premium dark clinical surface: risk-ordered patient list, patient detail with vitals, sparklines and cited alerts, a notification stream with haptics, and a settings screen driving the replay.

**Architecture:** A `Transport` interface separates where the board comes from (M1: a bundled recording; M2: SSE) from what it looks like. A pure reducer store holds the ward; all clinical logic (risk ordering, escalation, staleness, sparkline geometry, the no-orders vocabulary) lives in `src/domain/` as pure functions tested without a device. Screens are Expo Router files that only read the store.

**Tech Stack:** Expo, Expo Router, TypeScript (strict), NativeWind v4 + Tailwind 3, React Native Reanimated 3, Moti 2 (`MotiPressable`), react-native-gesture-handler, react-native-svg, expo-haptics, expo-blur, lucide-react-native, jest-expo + @testing-library/react-native. Backend touch: one function in `homunculus-engine/scripts/record_demo.py`.

**Normative documents:** the spec `docs/superpowers/specs/2026-08-27-mobile-app-m1-design.md` and the project skill `.agents/skills/homunculus-mobile-dev/SKILL.md`. Where the skill names an exact Tailwind class, spring constant or interaction primitive, that name is a requirement.

**Repo root in every command:** `c:/Users/User/Desktop/Project/Homunculus AI`. Branch: `feat/mobile-app-m1`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `homunculus-mobile/src/theme/palette.js` | The HSL palette, CommonJS so `tailwind.config.js` can require it. No hand-written `.d.ts`: `allowJs` infers the shape, and a second declaration could only drift |
| `homunculus-mobile/src/theme/tokens.ts` | Typed re-export + `Tone` → colour |
| `homunculus-mobile/src/theme/motion.ts` | The one spring config; no other curve is allowed |
| `homunculus-mobile/src/i18n/tr.ts` | Every user-visible string |
| `homunculus-mobile/src/i18n/index.ts` | `t()` with `{var}` interpolation |
| `homunculus-mobile/src/transport/types.ts` | Board/alert/notification/recording types + `Transport` |
| `homunculus-mobile/src/transport/replayTransport.ts` | Plays a recording; injectable timer |
| `homunculus-mobile/src/domain/keys.ts` | `alertKey` — shared by risk and escalation so neither imports the other |
| `homunculus-mobile/src/domain/risk.ts` | Risk rank, tone, top alert, ward ordering |
| `homunculus-mobile/src/domain/escalation.ts` | The ported server escalation rule |
| `homunculus-mobile/src/domain/staleness.ts` | Stale-input localisation and badge text |
| `homunculus-mobile/src/domain/sparkline.ts` | Series → SVG path geometry |
| `homunculus-mobile/src/domain/noOrders.ts` | Leading-verb allow-list + forbidden-token scan |
| `homunculus-mobile/src/domain/citations.ts` | Vault source-note catalogue |
| `homunculus-mobile/src/store/boardStore.ts` | Pure reducer + selectors |
| `homunculus-mobile/src/store/BoardProvider.tsx` | Context, transport wiring, settings, clock tick |
| `homunculus-mobile/src/ui/*.tsx` | Presentational components, no clinical logic |
| `homunculus-mobile/app/*` | Expo Router screens |
| `homunculus-mobile/assets/demo/icu-ward.json` | The recorded three-bed ward |
| `homunculus-engine/scripts/record_demo.py` | Gains `record_ward` |

---

### Task 1: Scaffold the Expo app

**Files:**
- Create: `homunculus-mobile/` (whole project via CLI)
- Modify: `.gitignore`

- [ ] **Step 1: Create the project**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
npx create-expo-app@latest homunculus-mobile
```

Accept the default template (it ships Expo Router + TypeScript). Do not pass `--template blank`; the router template saves an hour of wiring.

- [ ] **Step 2: Strip the template's example content**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI/homunculus-mobile"
rm -rf app components constants hooks scripts app-example
mkdir -p "app/(tabs)" app/patient src/theme src/i18n src/transport src/domain src/store src/ui assets/demo __tests__
```

- [ ] **Step 3: Write a minimal root layout so the project still boots**

Create `homunculus-mobile/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

Create `homunculus-mobile/app/index.tsx`:

```tsx
import { Text, View } from "react-native";

export default function Placeholder() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Homunculus</Text>
    </View>
  );
}
```

- [ ] **Step 4: Verify it bundles**

Run: `npx expo export --platform web`
Expected: finishes with `Exported: dist` (or similar) and exit code 0. This is the non-interactive bundle check used throughout this plan — it fails on any import or syntax error without needing a device.

- [ ] **Step 5: Ignore build output**

Append to `c:/Users/User/Desktop/Project/Homunculus AI/.gitignore`:

```gitignore
# Mobile app build + dependency output
homunculus-mobile/node_modules/
homunculus-mobile/.expo/
homunculus-mobile/dist/
homunculus-mobile/web-build/
```

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
git add .gitignore homunculus-mobile
git commit -m "feat(mobile): scaffold the Expo companion app"
```

---

### Task 2: Palette, motion and NativeWind

**Files:**
- Create: `homunculus-mobile/src/theme/palette.js`, `tokens.ts`, `motion.ts`
- Create: `homunculus-mobile/tailwind.config.js`, `global.css`, `metro.config.js`, `nativewind-env.d.ts`
- Modify: `homunculus-mobile/babel.config.js`, `homunculus-mobile/tsconfig.json`, `homunculus-mobile/app/_layout.tsx`

- [ ] **Step 1: Install**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI/homunculus-mobile"
npx expo install nativewind react-native-reanimated react-native-safe-area-context react-native-gesture-handler react-native-svg expo-haptics expo-blur
npm install moti lucide-react-native
npm install --save-dev tailwindcss@^3.4.17
```

NativeWind v4 requires Tailwind 3 — do not install Tailwind 4.

- [ ] **Step 2: Write the palette (single source of colour)**

Create `homunculus-mobile/src/theme/palette.js`:

```js
// The Homunculus clinical palette. CommonJS because tailwind.config.js requires it, and the
// palette must not exist twice — a colour that drifts between config and code is a bug that
// only shows up on a ward at night.
module.exports = {
  background: "hsl(222, 47%, 8%)",
  card: "hsl(222, 40%, 12%)",
  foreground: "hsl(210, 30%, 96%)",
  clinical: {
    border: "hsl(217, 30%, 20%)",
    safe: "hsl(142, 60%, 45%)",
    warning: "hsl(38, 92%, 50%)",
    critical: "hsl(346, 84%, 55%)",
    stale: "hsl(215, 15%, 60%)",
  },
};
```

Do **not** write a `palette.d.ts`. With `allowJs: true` TypeScript infers the shape from the CommonJS
module itself, and inference is not weaker — a reference to `palette.clinical.nosuchcolour` still
fails with `TS2339`. A hand-written declaration would add no safety and would give a colour a second
place to be declared, which is exactly what the comment above warns against.

- [ ] **Step 3: Write the typed tokens and tone mapping**

Create `homunculus-mobile/src/theme/tokens.ts`:

```ts
import palette from "./palette";

export const tokens = palette;

/** Every severity in the app collapses to one of four visual tones. */
export type Tone = "safe" | "warning" | "critical" | "muted";

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "critical":
      return tokens.clinical.critical;
    case "warning":
      return tokens.clinical.warning;
    case "safe":
      return tokens.clinical.safe;
    case "muted":
      return tokens.clinical.stale;
  }
}
```

- [ ] **Step 4: Write the motion constants**

Create `homunculus-mobile/src/theme/motion.ts`:

```ts
// The project skill (.agents/skills/homunculus-mobile-dev/SKILL.md) fixes one spring for the whole
// app. Linear transitions are not used anywhere: a ward screen that eases linearly reads as a
// spreadsheet, and the physical feel is the point.
export const SPRING = { damping: 15, mass: 0.8, stiffness: 120 } as const;

export const SPRING_TRANSITION = { type: "spring", ...SPRING } as const;

/** Pressed scale for cards and touchables. */
export const PRESS_SCALE = 0.97;

/** Critical-state glow: slow enough to read as breathing, not as a strobe. */
export const GLOW_DURATION_MS = 1400;
```

- [ ] **Step 5: Configure Tailwind with the exact class names the skill requires**

Create `homunculus-mobile/tailwind.config.js`:

```js
const palette = require("./src/theme/palette");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: palette.background,
        card: palette.card,
        foreground: palette.foreground,
        clinical: palette.clinical,
      },
    },
  },
  plugins: [],
};
```

This yields exactly `bg-background`, `bg-card`, `text-foreground`, `border-clinical-border`, `text-clinical-safe`, `text-clinical-warning`, `text-clinical-critical`, `text-clinical-stale`.

- [ ] **Step 6: Wire NativeWind into Metro, Babel and TypeScript**

Create `homunculus-mobile/global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Create `homunculus-mobile/metro.config.js`:

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
```

Replace `homunculus-mobile/babel.config.js` with:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

Do **not** add `react-native-reanimated/plugin` by hand: `babel-preset-expo` adds it automatically, and a duplicate entry throws at build time.

Create `homunculus-mobile/nativewind-env.d.ts`:

```ts
/// <reference types="nativewind/types" />

declare module "*.css";
```

The `declare module "*.css"` line is not optional. Without it, `import "../global.css"` fails
typechecking with `TS2882`, and because neither `expo export` nor jest typechecks, that error would
sit invisible and mask every genuine type error in the tasks that follow.

In `homunculus-mobile/tsconfig.json`, ensure `compilerOptions` contains `"strict": true` and `"allowJs": true` (the palette is a `.js` module).

- [ ] **Step 7: Import the stylesheet and prove a token renders**

Replace `homunculus-mobile/app/_layout.tsx`:

```tsx
import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { tokens } from "../src/theme/tokens";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.background },
        }}
      />
    </SafeAreaProvider>
  );
}
```

Replace `homunculus-mobile/app/index.tsx`:

```tsx
import { Text, View } from "react-native";

export default function Placeholder() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-clinical-safe text-lg">Homunculus</Text>
    </View>
  );
}
```

- [ ] **Step 8: Verify the bundle builds and the types are clean**

Add a `"typecheck": "tsc --noEmit"` script to `homunculus-mobile/package.json`, then run both:

```bash
npx tsc --noEmit
npx expo export --platform web
```

Expected: zero TypeScript errors, and exit code 0 from the export. Run `npm run typecheck` at the end
of every later task too — Metro strips types without checking them, so the export alone proves
nothing about type safety.

- [ ] **Step 9: Commit**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
git add homunculus-mobile
git commit -m "feat(mobile): clinical palette, spring constants and NativeWind"
```

---

### Task 3: Test harness

**Files:**
- Create: `homunculus-mobile/jest.setup.js`, `homunculus-mobile/__tests__/harness.test.tsx`
- Modify: `homunculus-mobile/package.json`

- [ ] **Step 1: Install the test dependencies**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI/homunculus-mobile"
npx expo install -- --save-dev jest-expo jest @testing-library/react-native @types/jest react-test-renderer
```

- [ ] **Step 2: Configure jest in `package.json`**

Add to `homunculus-mobile/package.json` (merge with the existing `scripts`):

```json
  "scripts": {
    "start": "expo start",
    "web:export": "expo export --platform web",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "jest": {
    "preset": "jest-expo",
    "setupFilesAfterEnv": ["<rootDir>/jest.setup.js"],
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|native-base|react-native-svg|react-native-gesture-handler|nativewind|react-native-css-interop|moti|@motify/.*|react-native-reanimated))"
    ]
  }
```

- [ ] **Step 3: Write the jest setup**

Create `homunculus-mobile/jest.setup.js`:

```js
require("react-native-gesture-handler/jestSetup");

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});
```

- [ ] **Step 4: Write the harness smoke test**

Create `homunculus-mobile/__tests__/harness.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { MotiView } from "moti";

import { SPRING_TRANSITION } from "../src/theme/motion";

describe("test harness", () => {
  it("renders a Reanimated view with an entering animation", () => {
    render(
      <Animated.View entering={FadeIn} accessibilityLabel="reanimated-probe">
        <Text>ok</Text>
      </Animated.View>,
    );
    expect(screen.getByLabelText("reanimated-probe")).toBeTruthy();
  });

  it("renders a Moti view with the shared spring transition", () => {
    render(
      <MotiView
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={SPRING_TRANSITION}
        accessibilityLabel="moti-probe"
      >
        <Text>ok</Text>
      </MotiView>,
    );
    expect(screen.getByLabelText("moti-probe")).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: 2 passing tests.

If either test fails with a worklet or Reanimated plugin error, append this line to `jest.setup.js` and re-run — Reanimated's own mock renders components without running worklets, which is what these tests need:

```js
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));
```

- [ ] **Step 6: Commit**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
git add homunculus-mobile
git commit -m "test(mobile): jest-expo harness proving Reanimated and Moti render"
```

---

### Task 4: Record the three-bed ward

**Files:**
- Modify: `homunculus-engine/scripts/record_demo.py`
- Modify: `homunculus-engine/tests/scripts_record_demo.py`
- Create: `homunculus-engine/tests/test_record_ward.py`
- Create: `homunculus-mobile/assets/demo/icu-ward.json` (generated)

The engine venv is `homunculus-engine/.venv/Scripts/python.exe` (Python 3.14), run from the repo root.

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_record_ward.py`:

```python
# tests/test_record_ward.py
import json
from pathlib import Path

import homunculus.scenarios
from homunculus.scenarios.loader import load_scenario
from scripts_record_demo import record_ward

SCEN = Path(homunculus.scenarios.__file__).parent
WARD = [SCEN / "septic_shock.yaml", SCEN / "under_resuscitated.yaml", SCEN / "stable_control.yaml"]


def test_ward_ends_with_all_three_beds_on_the_board(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["scenario"] == "icu-ward"
    assert {b["patient_id"] for b in data["frames"][-1]["boards"]} == {"bed-3", "bed-5", "bed-7"}


def test_ward_has_one_time_ordered_frame_per_merged_event(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert len(data["frames"]) == sum(len(load_scenario(s)) for s in WARD)
    ts = [f["t"] for f in data["frames"]]
    assert ts == sorted(ts)


def test_ward_preserves_each_bed_s_own_finding(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    boards = {b["patient_id"]: b for b in data["frames"][-1]["boards"]}
    assert any(a["kind"] == "septic_shock" for a in boards["bed-3"]["alerts"])
    assert any(a["kind"] == "under_resuscitated_sepsis" for a in boards["bed-7"]["alerts"])
    assert boards["bed-5"]["alerts"] == []


def test_ward_keeps_the_notifications_the_single_scenarios_produced(tmp_path):
    out = tmp_path / "icu-ward.json"
    record_ward(WARD, out)
    data = json.loads(out.read_text(encoding="utf-8"))
    kinds = {n["kind"] for n in data["notification_history"]}
    assert {"septic_shock", "under_resuscitated_sepsis"} <= kinds
```

- [ ] **Step 2: Export `record_ward` from the test shim**

Replace `homunculus-engine/tests/scripts_record_demo.py`:

```python
import importlib.util, pathlib
_spec = importlib.util.spec_from_file_location(
    "record_demo", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "record_demo.py")
record_demo = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(record_demo)
record = record_demo.record
record_ward = record_demo.record_ward
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_record_ward.py -q`
Expected: FAIL — `AttributeError: module 'record_demo' has no attribute 'record_ward'`.

- [ ] **Step 4: Implement `record_ward` and make `record` a special case of it**

In `homunculus-engine/scripts/record_demo.py`, replace the `record` function and `main` with:

```python
def record_ward(scenario_paths: list[str | Path], out_path: str | Path,
                step_seconds: float = 1.0, name: str = "icu-ward") -> None:
    """Merge several scenarios into one ward and record what a SINGLE engine emits.

    The engine is already multi-patient (board_snapshot iterates patient_ids), so a ward needs no
    engine or loader change — only the event streams merged in absolute time before ingest."""
    out_path = Path(out_path)
    engine, store, notifier = Engine(), AckStore(), Notifier()
    events: list[tuple[datetime, dict]] = []
    for path in scenario_paths:
        events.extend(load_scenario(Path(path)))
    events.sort(key=lambda pair: pair[0])

    frames, history = [], []
    for i, (_ts, fhir) in enumerate(events):
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
        "scenario": name, "step_seconds": step_seconds,
        "frames": frames, "notification_history": history}, indent=2), encoding="utf-8")


def record(scenario_path: str | Path, out_path: str | Path, step_seconds: float = 1.0) -> None:
    """One scenario is a ward of one."""
    record_ward([scenario_path], out_path, step_seconds, name=Path(scenario_path).stem)


REPO = Path(__file__).resolve().parents[2]
WARD_SCENARIOS = ["septic_shock.yaml", "under_resuscitated.yaml", "stable_control.yaml"]


def main() -> None:
    args = sys.argv[1:]
    if args and args[0] == "ward":
        out = Path(args[1]) if len(args) > 1 else REPO / "homunculus-mobile" / "assets" / "demo" / "icu-ward.json"
        record_ward([SCEN / s for s in WARD_SCENARIOS], out)
        print(f"recorded ward -> {out}")
        return
    name = args[0] if args else "septic_shock.yaml"
    out = Path(args[1]) if len(args) > 1 else REPO / "dashboard" / "public" / "demo" / f"{Path(name).stem}.json"
    record(SCEN / name, out)
    print(f"recorded {name} -> {out}")
```

- [ ] **Step 5: Run the new and the existing recorder tests**

Run: `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine/tests/test_record_ward.py homunculus-engine/tests/test_record_demo.py -q`
Expected: 6 passed (4 new + 2 existing — `record` must still behave identically).

- [ ] **Step 6: Generate the ward the app will ship**

Run:

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/record_demo.py ward
```

Expected: `recorded ward -> ...\homunculus-mobile\assets\demo\icu-ward.json`, with 28 frames.

- [ ] **Step 7: Commit**

```bash
git add homunculus-engine/scripts/record_demo.py homunculus-engine/tests homunculus-mobile/assets/demo/icu-ward.json
git commit -m "feat(engine): record a three-bed ward from one engine for the mobile app"
```

---

### Task 5: Board types and the recording contract test

**Files:**
- Create: `homunculus-mobile/src/transport/types.ts`
- Create: `homunculus-mobile/__tests__/recording.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/recording.test.ts`:

```ts
import recording from "../assets/demo/icu-ward.json";
import type { Recording } from "../src/transport/types";

const ward = recording as Recording;

describe("the committed recording", () => {
  it("declares its scenario and a step interval", () => {
    expect(ward.scenario).toBe("icu-ward");
    expect(ward.step_seconds).toBeGreaterThan(0);
  });

  it("carries every field the screens read", () => {
    const board = ward.frames.at(-1)!.boards.find((b) => b.patient_id === "bed-3")!;
    expect(board.risk).toBe("critical");
    expect(Object.keys(board.latest).sort()).toEqual(["heart_rate", "lactate", "map", "sofa"]);
    const alert = board.alerts[0];
    for (const key of [
      "kind", "severity", "urgency", "summary", "clinical_reasoning", "supporting_evidence",
      "recommended_actions", "confidence", "source", "downgraded", "chronic_context",
      "stale_inputs", "acknowledged", "first_seen_at", "escalated",
    ]) {
      expect(alert).toHaveProperty(key);
    }
  });

  it("holds all three beds", () => {
    const ids = new Set(ward.frames.at(-1)!.boards.map((b) => b.patient_id));
    expect(ids).toEqual(new Set(["bed-3", "bed-5", "bed-7"]));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- recording`
Expected: FAIL — cannot resolve `../src/transport/types`.

- [ ] **Step 3: Write the types**

Create `homunculus-mobile/src/transport/types.ts`:

```ts
// Hand-written from the payload api/board.py produces. The contract test in
// __tests__/recording.test.ts asserts the committed recording still matches, so a backend shape
// change fails a test here instead of silently blanking a screen.

export type Severity = "info" | "low" | "moderate" | "high" | "critical";
export type Risk = Severity | "none";
export type Urgency = "routine" | "soon" | "immediate";
export type Role = "nurse" | "doctor";

export interface BoardAlert {
  patient_id: string;
  kind: string;
  severity: Severity;
  urgency: Urgency;
  summary: string;
  clinical_reasoning: string;
  supporting_evidence: string[];
  recommended_actions: string[];
  confidence: string;
  source: "rule" | "model";
  downgraded: boolean;
  chronic_context: string;
  stale_inputs: string[];
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  first_seen_at: string | null;
  escalated: boolean;
}

export interface LatestVitals {
  heart_rate: number | null;
  map: number | null;
  lactate: number | null;
  sofa: number | null;
}

export interface PatientBoard {
  patient_id: string;
  risk: Risk;
  alerts: BoardAlert[];
  latest: LatestVitals;
}

export interface BoardNotification {
  tenant: string;
  patient_id: string;
  kind: string;
  severity: Severity;
  urgency: Urgency;
  audience: Role;
  trigger: "new" | "escalation";
  title: string;
  body: string;
  ts: string;
}

export interface RecordedFrame {
  t: number;
  boards: PatientBoard[];
  notifications: BoardNotification[];
}

export interface Recording {
  scenario: string;
  step_seconds: number;
  frames: RecordedFrame[];
  notification_history?: BoardNotification[];
}

export interface TransportListener {
  onBoard(board: PatientBoard): void;
  onNotification(note: BoardNotification): void;
  onLoop?(): void;
}

/** The seam: M1 replays a recording, M2 will read SSE. Screens never know which. */
export interface Transport {
  start(): void;
  stop(): void;
  subscribe(listener: TransportListener): () => void;
  ack(patientId: string, kind: string, role: Role): Promise<void>;
}
```

- [ ] **Step 4: Allow JSON imports and run the test**

Ensure `homunculus-mobile/tsconfig.json` `compilerOptions` includes `"resolveJsonModule": true`.

Run: `npm test -- recording`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): board types pinned to the recording by a contract test"
```

---

### Task 6: Risk ordering and tone

**Files:**
- Create: `homunculus-mobile/src/domain/keys.ts`
- Create: `homunculus-mobile/src/domain/risk.ts`
- Create: `homunculus-mobile/__tests__/risk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/risk.test.ts`:

```ts
import { riskRank, riskTone, topAlert, sortWard } from "../src/domain/risk";
import type { BoardAlert, PatientBoard, Risk, Severity, Urgency } from "../src/transport/types";

function alert(kind: string, severity: Severity, urgency: Urgency = "soon"): BoardAlert {
  return {
    patient_id: "bed-1", kind, severity, urgency, summary: kind, clinical_reasoning: "",
    supporting_evidence: [], recommended_actions: [], confidence: "", source: "rule",
    downgraded: false, chronic_context: "", stale_inputs: [], acknowledged: false,
    acknowledged_by: null, acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function board(id: string, risk: Risk, alerts: BoardAlert[] = []): PatientBoard {
  return { patient_id: id, risk, alerts, latest: { heart_rate: null, map: null, lactate: null, sofa: null } };
}

describe("riskRank", () => {
  it("orders none below every severity and critical above all", () => {
    expect(riskRank("none")).toBeLessThan(riskRank("low"));
    expect(riskRank("critical")).toBeGreaterThan(riskRank("high"));
  });
});

describe("riskTone", () => {
  it("collapses six risks onto four tones", () => {
    expect(riskTone("critical")).toBe("critical");
    expect(riskTone("high")).toBe("warning");
    expect(riskTone("moderate")).toBe("warning");
    expect(riskTone("low")).toBe("safe");
    expect(riskTone("none")).toBe("muted");
  });
});

describe("topAlert", () => {
  it("returns null when there are no alerts", () => {
    expect(topAlert(board("bed-5", "none"))).toBeNull();
  });

  it("picks the most severe, breaking ties on urgency", () => {
    const b = board("bed-3", "critical", [
      alert("sepsis", "high", "soon"),
      alert("septic_shock", "critical", "immediate"),
    ]);
    expect(topAlert(b)!.kind).toBe("septic_shock");
  });
});

describe("sortWard", () => {
  it("orders by risk, then unacknowledged first, then bed", () => {
    const stable = board("bed-5", "none");
    const highAcked = board("bed-9", "high", [{ ...alert("sepsis", "high"), acknowledged: true }]);
    const highOpen = board("bed-7", "high", [alert("sepsis", "high")]);
    const critical = board("bed-3", "critical", [alert("septic_shock", "critical", "immediate")]);

    const order = sortWard([stable, highAcked, highOpen, critical], new Set()).map((b) => b.patient_id);
    expect(order).toEqual(["bed-3", "bed-7", "bed-9", "bed-5"]);
  });

  it("treats a locally acknowledged key as acknowledged", () => {
    const a = board("bed-7", "high", [alert("sepsis", "high")]);
    const b = board("bed-9", "high", [alert("sepsis", "high")]);
    const order = sortWard([a, b], new Set(["bed-7|sepsis"])).map((x) => x.patient_id);
    expect(order).toEqual(["bed-9", "bed-7"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- risk`
Expected: FAIL — cannot resolve `../src/domain/risk`.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/domain/keys.ts` first — both `risk.ts` and `escalation.ts` need it, and giving it its own module keeps the two from depending on each other:

```ts
/** The composite key the server uses for an alert: (patient_id, kind). */
export function alertKey(patientId: string, kind: string): string {
  return `${patientId}|${kind}`;
}
```

Create `homunculus-mobile/src/domain/risk.ts`:

```ts
import type { BoardAlert, PatientBoard, Risk, Severity, Urgency } from "../transport/types";
import type { Tone } from "../theme/tokens";
import { alertKey } from "./keys";

const RISK_ORDER: Risk[] = ["none", "info", "low", "moderate", "high", "critical"];
const SEVERITY_ORDER: Severity[] = ["info", "low", "moderate", "high", "critical"];
const URGENCY_ORDER: Urgency[] = ["routine", "soon", "immediate"];

export function riskRank(risk: Risk): number {
  const index = RISK_ORDER.indexOf(risk);
  return index < 0 ? 0 : index;
}

export function riskTone(risk: Risk): Tone {
  if (risk === "critical") return "critical";
  if (risk === "high" || risk === "moderate") return "warning";
  if (risk === "none") return "muted";
  return "safe";
}

export function severityTone(severity: Severity): Tone {
  return riskTone(severity);
}

export function topAlert(board: PatientBoard): BoardAlert | null {
  let best: BoardAlert | null = null;
  for (const candidate of board.alerts) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const bySeverity =
      SEVERITY_ORDER.indexOf(candidate.severity) - SEVERITY_ORDER.indexOf(best.severity);
    const byUrgency =
      URGENCY_ORDER.indexOf(candidate.urgency) - URGENCY_ORDER.indexOf(best.urgency);
    if (bySeverity > 0 || (bySeverity === 0 && byUrgency > 0)) best = candidate;
  }
  return best;
}

export function isAcknowledged(
  board: PatientBoard,
  alert: BoardAlert,
  locallyAcked: ReadonlySet<string>,
): boolean {
  return alert.acknowledged || locallyAcked.has(alertKey(board.patient_id, alert.kind));
}

export function hasUnacknowledged(board: PatientBoard, locallyAcked: ReadonlySet<string>): boolean {
  return board.alerts.some((a) => !isAcknowledged(board, a, locallyAcked));
}

/** Risk descending, then unacknowledged first, then bed id — the order a nurse triages in. */
export function sortWard(
  boards: readonly PatientBoard[],
  locallyAcked: ReadonlySet<string>,
): PatientBoard[] {
  return [...boards].sort((a, b) => {
    const byRisk = riskRank(b.risk) - riskRank(a.risk);
    if (byRisk !== 0) return byRisk;
    const openA = hasUnacknowledged(a, locallyAcked) ? 0 : 1;
    const openB = hasUnacknowledged(b, locallyAcked) ? 0 : 1;
    if (openA !== openB) return openA - openB;
    return a.patient_id.localeCompare(b.patient_id);
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- risk`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): risk ranking, tone mapping and ward ordering"
```

---

### Task 7: The ported escalation rule

**Files:**
- Create: `homunculus-mobile/src/domain/escalation.ts`
- Create: `homunculus-mobile/__tests__/escalation.test.ts`

The four cases below are a direct port of `homunculus-engine/tests/test_escalation.py`. Keep them in the same order and with the same intent so the two files can be diffed by eye.

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/escalation.test.ts`:

```ts
import { alertKey, escalatedKeys } from "../src/domain/escalation";
import type { BoardAlert, PatientBoard, Urgency } from "../src/transport/types";

const T0 = 1_000_000;
const THRESHOLD = 5 * 60 * 1000;

function alert(kind: string, urgency: Urgency, acknowledged = false): BoardAlert {
  return {
    patient_id: "bed-3", kind, severity: "critical", urgency, summary: "", clinical_reasoning: "",
    supporting_evidence: [], recommended_actions: [], confidence: "", source: "rule",
    downgraded: false, chronic_context: "", stale_inputs: [], acknowledged,
    acknowledged_by: null, acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function ward(...alerts: BoardAlert[]): PatientBoard[] {
  return [{
    patient_id: "bed-3", risk: "critical", alerts,
    latest: { heart_rate: null, map: null, lactate: null, sofa: null },
  }];
}

describe("escalatedKeys — port of api/escalation.py", () => {
  it("escalates an unacknowledged immediate alert past the threshold", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + 6 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys).toEqual(new Set(["bed-3|septic_shock"]));
  });

  it("does not escalate an acknowledged alert", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(["bed-3|septic_shock"]),
      now: T0 + 6 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("does not escalate a non-immediate alert, however old", () => {
    const keys = escalatedKeys({
      boards: ward(alert("sepsis", "soon")),
      firstSeen: { "bed-3|sepsis": T0 },
      acknowledged: new Set(),
      now: T0 + 60 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("does not escalate before the threshold", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + (4 * 60 + 59) * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("honours an acknowledgement that came from the server payload", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate", true)),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + 6 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("does not escalate an alert it has never stamped a first-seen for", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: {},
      acknowledged: new Set(),
      now: T0 + 60 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });
});

describe("alertKey", () => {
  it("joins bed and kind into one stable key", () => {
    expect(alertKey("bed-3", "septic_shock")).toBe("bed-3|septic_shock");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- escalation`
Expected: FAIL — cannot resolve `../src/domain/escalation`.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/domain/escalation.ts`:

```ts
import type { PatientBoard } from "../transport/types";
import { alertKey } from "./keys";

export { alertKey };

export interface EscalationArgs {
  boards: readonly PatientBoard[];
  /** Key -> the app's own first-seen stamp, in epoch ms. */
  firstSeen: Readonly<Record<string, number>>;
  acknowledged: ReadonlySet<string>;
  now: number;
  thresholdMs: number;
}

/**
 * Port of homunculus-engine/src/homunculus/api/escalation.py: an alert escalates when its urgency
 * is immediate, nobody has acknowledged it, and it has been visible for at least the threshold.
 *
 * The clock is the app's own. The recorded `first_seen_at` belongs to the recording session weeks
 * ago, so measuring against it would escalate the whole ward on launch. The store stamps its own
 * first-seen the moment an alert appears — which is exactly what the server does on /ingest, where
 * the stamp is deliberately wall-clock and not observation time.
 */
export function escalatedKeys(args: EscalationArgs): Set<string> {
  const escalated = new Set<string>();
  for (const board of args.boards) {
    for (const alert of board.alerts) {
      if (alert.urgency !== "immediate") continue;
      const key = alertKey(board.patient_id, alert.kind);
      if (alert.acknowledged || args.acknowledged.has(key)) continue;
      const seen = args.firstSeen[key];
      if (seen !== undefined && args.now - seen >= args.thresholdMs) escalated.add(key);
    }
  }
  return escalated;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- escalation risk`
Expected: 13 passing across both files.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): port the server escalation rule, clocked by the app"
```

---

### Task 8: Staleness labels

**Files:**
- Create: `homunculus-mobile/src/domain/staleness.ts`
- Create: `homunculus-mobile/__tests__/staleness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/staleness.test.ts`:

```ts
import { localizeStaleInput, staleLabel, ageLabel } from "../src/domain/staleness";

describe("localizeStaleInput", () => {
  it("translates the engine's labels", () => {
    expect(localizeStaleInput("creatinine")).toBe("kreatinin");
    expect(localizeStaleInput("MAP")).toBe("OAB");
  });

  it("passes an unknown label through untouched rather than guessing", () => {
    expect(localizeStaleInput("procalcitonin")).toBe("procalcitonin");
  });
});

describe("ageLabel", () => {
  it("reads in minutes below an hour and hours above it", () => {
    expect(ageLabel(45 * 60 * 1000)).toBe("45 dk");
    expect(ageLabel(4 * 60 * 60 * 1000)).toBe("4 sa");
    expect(ageLabel(90 * 60 * 1000)).toBe("1 sa");
  });
});

describe("staleLabel", () => {
  it("is null when nothing is stale, so the badge never renders empty", () => {
    expect(staleLabel([])).toBeNull();
  });

  it("joins the localized names in the order the engine gave them (oldest first)", () => {
    expect(staleLabel(["creatinine", "MAP"])).toBe("kreatinin, OAB");
  });

  it("appends an age only where one is supplied", () => {
    expect(staleLabel(["creatinine"], { creatinine: 14 * 60 * 60 * 1000 })).toBe("kreatinin · 14 sa");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- staleness`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/domain/staleness.ts`:

```ts
// The engine's stale_inputs carries labels only (rules/sofa.py _INPUT_LABEL). The project skill
// asks the badge to state elapsed time; where the payload supplies an age we print it, and where it
// does not we print the name alone. A guessed age on a clinical badge is worse than no age.

const LABELS_TR: Record<string, string> = {
  MAP: "OAB",
  norepinephrine: "noradrenalin",
  epinephrine: "adrenalin",
  dopamine: "dopamin",
  dobutamine: "dobutamin",
  "PaO2/FiO2": "PaO2/FiO2",
  GCS: "GKS",
  creatinine: "kreatinin",
  bilirubin: "bilirubin",
  platelets: "trombosit",
};

export function localizeStaleInput(label: string): string {
  return LABELS_TR[label] ?? label;
}

export function ageLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa`;
}

/** Badge text for a finding's stale inputs, or null when there is nothing to say. */
export function staleLabel(
  staleInputs: readonly string[],
  agesMs: Readonly<Record<string, number>> = {},
): string | null {
  if (staleInputs.length === 0) return null;
  return staleInputs
    .map((input) => {
      const name = localizeStaleInput(input);
      const age = agesMs[input];
      return age === undefined ? name : `${name} · ${ageLabel(age)}`;
    })
    .join(", ");
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- staleness`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): staleness labels that state an age only when they have one"
```

---

### Task 9: Sparkline geometry

**Files:**
- Create: `homunculus-mobile/src/domain/sparkline.ts`
- Create: `homunculus-mobile/__tests__/sparkline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/sparkline.test.ts`:

```ts
import { sparklinePath } from "../src/domain/sparkline";

const box = { width: 100, height: 10 };

describe("sparklinePath", () => {
  it("draws nothing for fewer than two points", () => {
    expect(sparklinePath([], box)).toBe("");
    expect(sparklinePath([5], box)).toBe("");
  });

  it("maps the range onto the box with y inverted", () => {
    expect(sparklinePath([0, 1], box)).toBe("M0,10 L100,0");
  });

  it("draws a flat series down the middle instead of dividing by zero", () => {
    expect(sparklinePath([3, 3, 3], box)).toBe("M0,5 L50,5 L100,5");
  });

  it("insets the drawing by the padding on both axes", () => {
    expect(sparklinePath([0, 1], { width: 100, height: 10, padding: 2 })).toBe("M2,8 L98,2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- sparkline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/domain/sparkline.ts`:

```ts
export interface SparklineBox {
  width: number;
  height: number;
  padding?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Series -> SVG path. Pure geometry: no component, no colour, no units. */
export function sparklinePath(values: readonly number[], box: SparklineBox): string {
  if (values.length < 2) return "";
  const pad = box.padding ?? 0;
  const width = box.width - pad * 2;
  const height = box.height - pad * 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const x = (i: number) => pad + (width * i) / (values.length - 1);
  const y = (v: number) => (span === 0 ? pad + height / 2 : pad + height - ((v - min) / span) * height);

  return values.map((v, i) => `${i === 0 ? "M" : "L"}${round(x(i))},${round(y(v))}`).join(" ");
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- sparkline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): sparkline path geometry as a pure function"
```

---

### Task 10: The Turkish string catalogue

**Files:**
- Create: `homunculus-mobile/src/i18n/tr.ts`, `homunculus-mobile/src/i18n/index.ts`
- Create: `homunculus-mobile/__tests__/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/i18n.test.ts`:

```ts
import { t } from "../src/i18n";
import { tr } from "../src/i18n/tr";

describe("t", () => {
  it("returns the catalogued string", () => {
    expect(t("tabs.patients")).toBe("Hastalar");
  });

  it("interpolates named variables", () => {
    expect(t("bed.label", { bed: "3" })).toBe("YB Yatak 3");
  });

  it("leaves an unsupplied placeholder visible rather than printing undefined", () => {
    expect(t("bed.label")).toBe("YB Yatak {bed}");
  });

  it("falls back to the key itself when a string is missing", () => {
    expect(t("nope.not.here" as never)).toBe("nope.not.here");
  });
});

describe("the catalogue", () => {
  it("has no empty strings", () => {
    for (const [key, value] of Object.entries(tr)) {
      expect(value.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- i18n`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the catalogue**

Create `homunculus-mobile/src/i18n/tr.ts`:

```ts
// Every user-visible string in the app. A second locale is a sibling file, not a refactor.
// These strings are also scanned by the no-orders charter test — see src/domain/noOrders.ts.
export const tr = {
  "app.name": "Homunculus",
  "app.demoBanner": "GÖSTERİM VERİSİ — kayıtlı sentetik senaryo",

  "tabs.patients": "Hastalar",
  "tabs.alerts": "Uyarılar",
  "tabs.settings": "Ayarlar",

  "ward.title": "Yoğun Bakım Koğuşu",
  "ward.subtitle": "Riske göre sıralı",
  "ward.empty": "Koğuşta gösterilecek yatak yok.",
  "ward.loading": "Koğuş yükleniyor…",

  "bed.label": "YB Yatak {bed}",

  "risk.none": "Sakin",
  "risk.info": "Bilgi",
  "risk.low": "Düşük",
  "risk.moderate": "Orta",
  "risk.high": "Yüksek",
  "risk.critical": "Kritik",

  "alert.unacknowledged": "Onaylanmadı",
  "alert.acknowledged": "Onaylandı",
  "alert.escalated": "ESKALE EDİLDİ",
  "alert.acknowledge": "Onayla",
  "alert.reasoning": "Klinik gerekçe",
  "alert.actions": "Önerilen adımlar",
  "alert.confidence": "Kanıt gücü",
  "alert.sources": "Kaynaklar",
  "alert.chronicContext": "Kronik bağlam",
  "alert.downgraded": "Hastanın kendi bazaline göre indirgendi",

  "stale.badge": "Bayat veri: {inputs}",

  "vital.heartRate": "Kalp hızı",
  "vital.map": "OAB",
  "vital.lactate": "Laktat",
  "vital.sofa": "SOFA",
  "vital.noData": "veri yok",
  "vital.trend": "Senaryo zamanı eğilimi",

  "detail.vitals": "Vital bulgular",
  "detail.alerts": "Aktif uyarılar",
  "detail.noAlerts": "Aktif uyarı yok.",
  "detail.back": "Geri",
  "detail.missing": "Bu yatak koğuşta bulunamadı.",

  "drawer.title": "Kılavuz kaynağı",
  "drawer.authority": "Otorite",
  "drawer.authority.high": "yüksek",
  "drawer.authority.moderate": "orta",
  "drawer.authority.low": "düşük",
  "drawer.superseded": "Bu kaynak daha yeni bir baskıyla değiştirildi.",
  "drawer.unknown": "Kaynak notu bulunamadı: {id}",
  "drawer.note": "Kaynak başlığı Homunculus kasasından alınmıştır; kanıt gücü ifadesi uyarının kendi alanından gelir.",
  "drawer.close": "Kapat",

  "alerts.title": "Uyarı akışı",
  "alerts.escalatedSection": "Eskale edilenler",
  "alerts.newSection": "Yeni uyarılar",
  "alerts.empty": "Henüz uyarı yok.",

  "settings.title": "Ayarlar",
  "settings.playback": "Oynatma",
  "settings.play": "Oynat",
  "settings.pause": "Duraklat",
  "settings.restart": "Başa sar",
  "settings.speed": "Hız",
  "settings.role": "Rol",
  "settings.role.nurse": "Hemşire",
  "settings.role.doctor": "Hekim",
  "settings.haptics": "Titreşimli geri bildirim",
  "settings.threshold": "Eskalasyon eşiği",
  "settings.thresholdNote": "Sunucudaki gerçek eşik 5 dakikadır. Buradaki kısa süre yalnızca gösterim hızlandırmasıdır.",
  "settings.dataSource": "Veri kaynağı",
  "settings.dataSourceValue": "Kayıtlı senaryo — icu-ward.json",
  "settings.version": "Sürüm",
} as const;
```

Create `homunculus-mobile/src/i18n/index.ts`:

```ts
import { tr } from "./tr";

export type MessageKey = keyof typeof tr;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template: string = tr[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): Turkish string catalogue behind one t()"
```

---

### Task 11: The no-orders guard

**Files:**
- Create: `homunculus-mobile/src/domain/noOrders.ts`
- Create: `homunculus-mobile/__tests__/charter.test.ts`

Two different checks, because the two bodies of text fail differently. The engine's register (`reco/engine.py`) states its own rule — *"Every verb is one of: Consider / Review / Assess / Evaluate / Monitor"* — so engine text is checked by its **leading verb**. One approved recommendation reads "Review whether antibiotics can be **given** within the 1-hour window", which a naive scan for "given" would wrongly condemn. Our own Turkish strings get the forbidden-token scan instead.

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/charter.test.ts`:

```ts
import recording from "../assets/demo/icu-ward.json";
import { findForbiddenTokens, isRecommendation, tokenize } from "../src/domain/noOrders";
import { tr } from "../src/i18n/tr";
import type { Recording } from "../src/transport/types";

const ward = recording as Recording;

describe("tokenize", () => {
  it("splits on non-letters and lowercases with Turkish rules", () => {
    expect(tokenize("İzleyin: laktat, 30 mL/kg")).toEqual(["izleyin", "laktat", "30", "ml", "kg"]);
  });
});

describe("isRecommendation", () => {
  it("accepts the register's approved openers", () => {
    expect(isRecommendation("Consider repeat lactate to confirm the trend.")).toBe(true);
    expect(isRecommendation("Monitor lactate and MAP after the next fluid bolus.")).toBe(true);
  });

  it("accepts a recommendation that merely mentions an administered drug", () => {
    expect(isRecommendation("Review whether antibiotics can be given within the 1-hour window.")).toBe(true);
  });

  it("rejects an order however politely it is phrased", () => {
    expect(isRecommendation("Give 500 mL crystalloid now.")).toBe(false);
    expect(isRecommendation("Order a lactate.")).toBe(false);
  });
});

describe("findForbiddenTokens", () => {
  it("finds an imperative order", () => {
    expect(findForbiddenTokens("Hastaya 500 mL sıvı verin.")).toEqual(["verin"]);
  });

  it("does not fire on a word that merely contains a forbidden one", () => {
    expect(findForbiddenTokens("Bayat veri: kreatinin")).toEqual([]);
  });
});

describe("charter: no orders", () => {
  it("every recommended action in the recording opens with an approved verb", () => {
    const actions = ward.frames.flatMap((f) => f.boards.flatMap((b) => b.alerts.flatMap((a) => a.recommended_actions)));
    expect(actions.length).toBeGreaterThan(0);
    const offenders = actions.filter((a) => !isRecommendation(a));
    expect(offenders).toEqual([]);
  });

  it("no string in the Turkish catalogue reads as an order", () => {
    const offenders = Object.entries(tr).filter(([, value]) => findForbiddenTokens(value).length > 0);
    expect(offenders).toEqual([]);
  });
});

describe("charter: no PHI", () => {
  it("identifies patients only by bed", () => {
    for (const frame of ward.frames) {
      for (const board of frame.boards) {
        expect(board.patient_id).toMatch(/^bed-\d+$/);
        expect(Object.keys(board)).toEqual(["patient_id", "risk", "alerts", "latest"]);
      }
    }
  });

  it("carries no demographic or identifying field anywhere in an alert", () => {
    const forbidden = /name|surname|mrn|tckn|ssn|birth|dob|address|phone/i;
    for (const frame of ward.frames) {
      for (const board of frame.boards) {
        for (const alert of board.alerts) {
          expect(Object.keys(alert).filter((k) => forbidden.test(k))).toEqual([]);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- charter`
Expected: FAIL — cannot resolve `../src/domain/noOrders`.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/domain/noOrders.ts`:

```ts
// Homunculus recommends; it never orders. The charter rule is enforced here as a test rather than
// as a comment, because a comment survives review and a failing test does not.

/**
 * The verbs reco/engine.py permits at the head of a recommendation. What makes a sentence an order
 * is the verb that governs the clinician, and that verb is the first word — "Review whether
 * antibiotics can be given" recommends, while "Give antibiotics" orders, though both contain the
 * same stem.
 */
const APPROVED_OPENERS = new Set([
  "consider", "review", "assess", "evaluate", "monitor",
  "değerlendirin", "inceleyin", "izleyin", "gözden",
]);

/** Whole tokens we never write in our own Turkish or English UI copy. */
const FORBIDDEN_TOKENS = new Set([
  "verin", "veriniz", "uygulayın", "uygulayınız", "başlayın", "başlatın",
  "enjekte", "reçete", "order", "orders", "administer", "prescribe", "inject", "give",
]);

/** Split on anything that is not a letter or digit, lowercased with Turkish casing rules. */
export function tokenize(text: string): string[] {
  return text
    .toLocaleLowerCase("tr")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export function isRecommendation(text: string): boolean {
  const [first] = tokenize(text);
  return first !== undefined && APPROVED_OPENERS.has(first);
}

/** Whole-token matching, so "veri" never trips the rule meant for "verin". */
export function findForbiddenTokens(text: string): string[] {
  return tokenize(text).filter((token) => FORBIDDEN_TOKENS.has(token));
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- charter`
Expected: PASS, including the two charter assertions over the real recording.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "test(mobile): make the no-orders and no-PHI rules fail a test run"
```

---

### Task 12: The vault citation catalogue

**Files:**
- Create: `homunculus-mobile/src/domain/citations.ts`
- Create: `homunculus-mobile/__tests__/citations.test.ts`

Titles and authority values below are transcribed from `Homunculus/wiki/sources/*.md`. Nothing here is minted: no DOI, no author list, no recommendation grade.

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/citations.test.ts`:

```ts
import recording from "../assets/demo/icu-ward.json";
import { lookupSource } from "../src/domain/citations";
import type { Recording } from "../src/transport/types";

const ward = recording as Recording;

describe("lookupSource", () => {
  it("resolves a vault source note to its title and authority", () => {
    expect(lookupSource("sepsis-3-jama-2016")).toEqual({
      id: "sepsis-3-jama-2016",
      title: "Sepsis-3 (JAMA 2016)",
      authority: "high",
      superseded: false,
    });
  });

  it("marks a superseded edition as superseded", () => {
    expect(lookupSource("surviving-sepsis-campaign-2021")!.superseded).toBe(true);
  });

  it("returns null for an unknown id instead of inventing a source", () => {
    expect(lookupSource("made-up-guideline-2030")).toBeNull();
  });

  it("covers every citation the recording actually uses", () => {
    const cited = new Set(
      ward.frames.flatMap((f) => f.boards.flatMap((b) => b.alerts.flatMap((a) => a.supporting_evidence))),
    );
    expect(cited.size).toBeGreaterThan(0);
    for (const id of cited) expect(lookupSource(id)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- citations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/domain/citations.ts`:

```ts
// Transcribed from Homunculus/wiki/sources/*.md — the H1 title and the frontmatter `authority`.
// Nothing is minted here. If a citation is not in this table, the drawer says so; it never invents
// a plausible-looking reference, which in a clinical knowledge base is the one failure that
// survives review.

export type Authority = "high" | "moderate" | "low";

export interface SourceNote {
  id: string;
  title: string;
  authority: Authority;
  superseded: boolean;
}

const SOURCE_NOTES: Record<string, SourceNote> = {
  "sepsis-3-jama-2016": {
    id: "sepsis-3-jama-2016",
    title: "Sepsis-3 (JAMA 2016)",
    authority: "high",
    superseded: false,
  },
  "surviving-sepsis-campaign-2026": {
    id: "surviving-sepsis-campaign-2026",
    title: "Surviving Sepsis Campaign 2026",
    authority: "high",
    superseded: false,
  },
  "surviving-sepsis-campaign-2021": {
    id: "surviving-sepsis-campaign-2021",
    title: "Surviving Sepsis Campaign 2021 (SUPERSEDED)",
    authority: "high",
    superseded: true,
  },
  "news2-rcp-2017": {
    id: "news2-rcp-2017",
    title: "NEWS2 (RCP, 2017)",
    authority: "high",
    superseded: false,
  },
  "phoenix-criteria-jama-2024": {
    id: "phoenix-criteria-jama-2024",
    title: "Phoenix Criteria (JAMA 2024)",
    authority: "high",
    superseded: false,
  },
  "neonatal-sepsis-review-2024": {
    id: "neonatal-sepsis-review-2024",
    title: "Neonatal Sepsis: A Comprehensive Review (Antibiotics 2024)",
    authority: "moderate",
    superseded: false,
  },
  "nsofa-systematic-review-2026": {
    id: "nsofa-systematic-review-2026",
    title: "nSOFA in the NICU — Systematic Review (Diagnostics 2026)",
    authority: "moderate",
    superseded: false,
  },
  "physionet-cinc-2019": {
    id: "physionet-cinc-2019",
    title: "PhysioNet/CinC Challenge 2019 (Early Sepsis Prediction)",
    authority: "moderate",
    superseded: false,
  },
};

export function lookupSource(id: string): SourceNote | null {
  return SOURCE_NOTES[id] ?? null;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- citations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): vault citation catalogue, transcribed not invented"
```

---

### Task 13: The replay transport

**Files:**
- Create: `homunculus-mobile/src/transport/replayTransport.ts`
- Create: `homunculus-mobile/__tests__/replayTransport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/replayTransport.test.ts`:

```ts
import { createReplayTransport } from "../src/transport/replayTransport";
import type { PatientBoard, Recording } from "../src/transport/types";

function board(id: string, sofa: number): PatientBoard {
  return {
    patient_id: id, risk: "none", alerts: [],
    latest: { heart_rate: null, map: null, lactate: null, sofa },
  };
}

const recording: Recording = {
  scenario: "test",
  step_seconds: 1,
  frames: [
    { t: 0, boards: [board("bed-3", 0), board("bed-5", 0)], notifications: [] },
    { t: 1, boards: [board("bed-3", 2)], notifications: [] },
    {
      t: 2,
      boards: [board("bed-3", 6)],
      notifications: [{
        tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
        urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
        body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
      }],
    },
  ],
};

/** Deterministic scheduler: no real timers, no waiting. */
function fakeClock() {
  let time = 0;
  let nextId = 1;
  let queue: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      queue.push({ id, at: time + ms, fn });
      return id;
    },
    clearTimer: (id: number) => {
      queue = queue.filter((entry) => entry.id !== id);
    },
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        time = next.at;
        next.fn();
      }
      time = target;
    },
  };
}

function harness(speed = 1) {
  const clock = fakeClock();
  const boards: PatientBoard[] = [];
  const notes: string[] = [];
  let loops = 0;
  const transport = createReplayTransport({
    recording, speed,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  const unsubscribe = transport.subscribe({
    onBoard: (b) => boards.push(b),
    onNotification: (n) => notes.push(n.kind),
    onLoop: () => { loops += 1; },
  });
  return { clock, transport, boards, notes, unsubscribe, loops: () => loops };
}

describe("createReplayTransport", () => {
  it("emits every board of the first frame as soon as it starts", () => {
    const h = harness();
    h.transport.start();
    expect(h.boards.map((b) => b.patient_id)).toEqual(["bed-3", "bed-5"]);
  });

  it("emits the next frame one step later", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(1000);
    expect(h.boards.at(-1)!.latest.sofa).toBe(2);
  });

  it("emits the frame's notifications with it", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(2000);
    expect(h.notes).toEqual(["septic_shock"]);
  });

  it("halves the interval at double speed", () => {
    const h = harness(2);
    h.transport.start();
    h.clock.advance(500);
    expect(h.boards.at(-1)!.latest.sofa).toBe(2);
  });

  it("loops back to the first frame after the last", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(3000);
    expect(h.loops()).toBe(1);
    expect(h.boards.at(-1)!.latest.sofa).toBe(0);
  });

  it("stops emitting while paused and resumes on play", () => {
    const h = harness();
    h.transport.start();
    h.transport.pause();
    const count = h.boards.length;
    h.clock.advance(5000);
    expect(h.boards.length).toBe(count);
    h.transport.play();
    h.clock.advance(1000);
    expect(h.boards.length).toBeGreaterThan(count);
  });

  it("restarts from the first frame and reports the loop", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(1000);
    h.transport.restart();
    expect(h.loops()).toBe(1);
    expect(h.boards.at(-1)!.latest.sofa).toBe(0);
  });

  it("delivers nothing after unsubscribe", () => {
    const h = harness();
    h.transport.start();
    h.unsubscribe();
    const count = h.boards.length;
    h.clock.advance(1000);
    expect(h.boards.length).toBe(count);
  });

  it("resolves ack without a server", async () => {
    const h = harness();
    await expect(h.transport.ack("bed-3", "septic_shock", "nurse")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- replayTransport`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/transport/replayTransport.ts`:

```ts
import type { Recording, Role, Transport, TransportListener } from "./types";

export interface ReplayControls {
  play(): void;
  pause(): void;
  restart(): void;
  setSpeed(speed: number): void;
  isPlaying(): boolean;
  speed(): number;
  frameIndex(): number;
  frameCount(): number;
}

export type ReplayTransport = Transport & ReplayControls;

export interface ReplayOptions {
  recording: Recording;
  speed?: number;
  /** Injected so tests drive the replay with a fake clock instead of waiting on real time. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

export function createReplayTransport(options: ReplayOptions): ReplayTransport {
  const { recording } = options;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as unknown as NodeJS.Timeout));

  const listeners = new Set<TransportListener>();
  let index = 0;
  let speed = options.speed ?? 1;
  let playing = false;
  let timer: number | null = null;

  const intervalMs = () => (recording.step_seconds * 1000) / speed;

  function cancel(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function emitCurrentFrame(): void {
    const frame = recording.frames[index];
    if (!frame) return;
    for (const listener of listeners) {
      for (const board of frame.boards) listener.onBoard(board);
      for (const note of frame.notifications) listener.onNotification(note);
    }
  }

  function announceLoop(): void {
    for (const listener of listeners) listener.onLoop?.();
  }

  function scheduleNext(): void {
    cancel();
    if (!playing) return;
    timer = setTimer(() => {
      index += 1;
      if (index >= recording.frames.length) {
        index = 0;
        announceLoop();
      }
      emitCurrentFrame();
      scheduleNext();
    }, intervalMs());
  }

  return {
    start() {
      playing = true;
      emitCurrentFrame();
      scheduleNext();
    },
    stop() {
      playing = false;
      cancel();
    },
    play() {
      if (playing) return;
      playing = true;
      scheduleNext();
    },
    pause() {
      playing = false;
      cancel();
    },
    restart() {
      index = 0;
      announceLoop();
      emitCurrentFrame();
      scheduleNext();
    },
    setSpeed(next: number) {
      speed = next <= 0 ? 1 : next;
      scheduleNext();
    },
    isPlaying: () => playing,
    speed: () => speed,
    frameIndex: () => index,
    frameCount: () => recording.frames.length,
    subscribe(listener: TransportListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async ack(_patientId: string, _kind: string, _role: Role) {
      // Replay has no server. The store owns the acknowledgement; this resolves so the caller's
      // code path is identical to the one the live transport will take.
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- replayTransport`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): replay transport with an injectable clock"
```

---

### Task 14: The board store

**Files:**
- Create: `homunculus-mobile/src/store/boardStore.ts`
- Create: `homunculus-mobile/__tests__/boardStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/boardStore.test.ts`:

```ts
import { boardReducer, initialBoardState, selectPatient, selectWard } from "../src/store/boardStore";
import type { BoardAlert, BoardNotification, PatientBoard } from "../src/transport/types";

function alert(kind: string, overrides: Partial<BoardAlert> = {}): BoardAlert {
  return {
    patient_id: "bed-3", kind, severity: "critical", urgency: "immediate", summary: kind,
    clinical_reasoning: "", supporting_evidence: [], recommended_actions: [], confidence: "",
    source: "rule", downgraded: false, chronic_context: "", stale_inputs: [], acknowledged: false,
    acknowledged_by: null, acknowledged_at: null, first_seen_at: null, escalated: false,
    ...overrides,
  };
}

function board(id: string, sofa: number | null, alerts: BoardAlert[] = []): PatientBoard {
  return {
    patient_id: id, risk: alerts.length ? "critical" : "none", alerts,
    latest: { heart_rate: null, map: 70, lactate: null, sofa },
  };
}

const note: BoardNotification = {
  tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
  urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
  body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
};

describe("boardReducer", () => {
  it("upserts a patient board", () => {
    const state = boardReducer(initialBoardState, { type: "board", board: board("bed-3", 2), now: 100 });
    expect(state.patients["bed-3"].latest.sofa).toBe(2);
  });

  it("stamps first-seen once, on the app's own clock", () => {
    let state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 2, [alert("septic_shock")]), now: 100,
    });
    state = boardReducer(state, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock")]), now: 5000,
    });
    expect(state.firstSeen["bed-3|septic_shock"]).toBe(100);
  });

  it("accumulates a series per vital, skipping nulls", () => {
    let state = boardReducer(initialBoardState, { type: "board", board: board("bed-3", 2), now: 100 });
    state = boardReducer(state, { type: "board", board: board("bed-3", null), now: 200 });
    state = boardReducer(state, { type: "board", board: board("bed-3", 6), now: 300 });
    expect(state.series["bed-3"].sofa).toEqual([2, 6]);
    expect(state.series["bed-3"].map).toEqual([70, 70, 70]);
    expect(state.series["bed-3"].heart_rate).toEqual([]);
  });

  it("keeps the newest notification first", () => {
    let state = boardReducer(initialBoardState, { type: "notification", note });
    state = boardReducer(state, { type: "notification", note: { ...note, kind: "sepsis" } });
    expect(state.notifications[0].kind).toBe("sepsis");
  });

  it("records a local acknowledgement", () => {
    const state = boardReducer(initialBoardState, {
      type: "ack", patientId: "bed-3", kind: "septic_shock", role: "nurse", now: 400,
    });
    expect(state.acknowledged).toContain("bed-3|septic_shock");
  });

  it("clears everything on a loop, because the scenario starts over", () => {
    let state = boardReducer(initialBoardState, { type: "board", board: board("bed-3", 2), now: 100 });
    state = boardReducer(state, { type: "ack", patientId: "bed-3", kind: "x", role: "nurse", now: 200 });
    expect(boardReducer(state, { type: "loop" })).toEqual(initialBoardState);
  });
});

describe("selectWard", () => {
  it("orders by risk and derives escalation from the app's clock", () => {
    let state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock")]), now: 0,
    });
    state = boardReducer(state, { type: "board", board: board("bed-5", 0), now: 0 });

    const calm = selectWard(state, { now: 1000, thresholdMs: 20_000 });
    expect(calm.map((v) => v.board.patient_id)).toEqual(["bed-3", "bed-5"]);
    expect(calm[0].escalated).toBe(false);

    const late = selectWard(state, { now: 30_000, thresholdMs: 20_000 });
    expect(late[0].escalated).toBe(true);
    expect(late[0].tone).toBe("critical");
  });

  it("stops escalating once acknowledged", () => {
    let state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock")]), now: 0,
    });
    state = boardReducer(state, {
      type: "ack", patientId: "bed-3", kind: "septic_shock", role: "nurse", now: 100,
    });
    expect(selectWard(state, { now: 30_000, thresholdMs: 20_000 })[0].escalated).toBe(false);
  });
});

describe("selectPatient", () => {
  it("returns undefined for a bed that is not on the board", () => {
    expect(selectPatient(initialBoardState, "bed-99", { now: 0, thresholdMs: 20_000 })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- boardStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/store/boardStore.ts`:

```ts
import { escalatedKeys } from "../domain/escalation";
import { alertKey } from "../domain/keys";
import { hasUnacknowledged, riskTone, sortWard, topAlert } from "../domain/risk";
import type { Tone } from "../theme/tokens";
import type { BoardAlert, BoardNotification, PatientBoard, Role } from "../transport/types";

const SERIES_CAP = 120;
const NOTIFICATION_CAP = 50;

export interface VitalSeries {
  heart_rate: number[];
  map: number[];
  lactate: number[];
  sofa: number[];
}

export interface BoardState {
  patients: Record<string, PatientBoard>;
  series: Record<string, VitalSeries>;
  /** Key -> the app's own first-seen stamp. See src/domain/escalation.ts for why. */
  firstSeen: Record<string, number>;
  acknowledged: string[];
  notifications: BoardNotification[];
}

export const initialBoardState: BoardState = {
  patients: {},
  series: {},
  firstSeen: {},
  acknowledged: [],
  notifications: [],
};

export type BoardAction =
  | { type: "board"; board: PatientBoard; now: number }
  | { type: "notification"; note: BoardNotification }
  | { type: "ack"; patientId: string; kind: string; role: Role; now: number }
  | { type: "loop" };

const emptySeries = (): VitalSeries => ({ heart_rate: [], map: [], lactate: [], sofa: [] });

const push = (series: number[], value: number | null): number[] =>
  value === null ? series : [...series, value].slice(-SERIES_CAP);

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "board": {
      const { board, now } = action;
      const firstSeen = { ...state.firstSeen };
      for (const alert of board.alerts) {
        const key = alertKey(board.patient_id, alert.kind);
        if (firstSeen[key] === undefined) firstSeen[key] = now;
      }
      const previous = state.series[board.patient_id] ?? emptySeries();
      return {
        ...state,
        patients: { ...state.patients, [board.patient_id]: board },
        firstSeen,
        series: {
          ...state.series,
          [board.patient_id]: {
            heart_rate: push(previous.heart_rate, board.latest.heart_rate),
            map: push(previous.map, board.latest.map),
            lactate: push(previous.lactate, board.latest.lactate),
            sofa: push(previous.sofa, board.latest.sofa),
          },
        },
      };
    }
    case "notification":
      return {
        ...state,
        notifications: [action.note, ...state.notifications].slice(0, NOTIFICATION_CAP),
      };
    case "ack": {
      const key = alertKey(action.patientId, action.kind);
      if (state.acknowledged.includes(key)) return state;
      return { ...state, acknowledged: [...state.acknowledged, key] };
    }
    case "loop":
      return initialBoardState;
  }
}

export interface PatientView {
  board: PatientBoard;
  top: BoardAlert | null;
  tone: Tone;
  escalated: boolean;
  unacknowledged: boolean;
  escalatedKeys: ReadonlySet<string>;
  acknowledgedKeys: ReadonlySet<string>;
  series: VitalSeries;
}

export interface SelectOptions {
  now: number;
  thresholdMs: number;
}

function viewFor(
  board: PatientBoard,
  state: BoardState,
  acked: ReadonlySet<string>,
  escalated: ReadonlySet<string>,
): PatientView {
  const isEscalated = board.alerts.some((a) => escalated.has(alertKey(board.patient_id, a.kind)));
  return {
    board,
    top: topAlert(board),
    tone: isEscalated ? "critical" : riskTone(board.risk),
    escalated: isEscalated,
    unacknowledged: hasUnacknowledged(board, acked),
    escalatedKeys: escalated,
    acknowledgedKeys: acked,
    series: state.series[board.patient_id] ?? emptySeries(),
  };
}

export function selectWard(state: BoardState, options: SelectOptions): PatientView[] {
  const boards = Object.values(state.patients);
  const acked = new Set(state.acknowledged);
  const escalated = escalatedKeys({
    boards,
    firstSeen: state.firstSeen,
    acknowledged: acked,
    now: options.now,
    thresholdMs: options.thresholdMs,
  });
  // Ordering lives in the domain layer; the store only supplies the acknowledgement set.
  return sortWard(boards, acked).map((board) => viewFor(board, state, acked, escalated));
}

export function selectPatient(
  state: BoardState,
  patientId: string,
  options: SelectOptions,
): PatientView | undefined {
  const board = state.patients[patientId];
  if (!board) return undefined;
  return selectWard(state, options).find((view) => view.board.patient_id === patientId);
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- boardStore`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): board store reducer and ward selectors"
```

---

### Task 15: The board provider

**Files:**
- Create: `homunculus-mobile/src/store/BoardProvider.tsx`
- Create: `homunculus-mobile/__tests__/BoardProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/BoardProvider.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { BoardProvider, useBoard } from "../src/store/BoardProvider";

jest.useFakeTimers();

function Probe() {
  const { ward, settings, setRole } = useBoard();
  return (
    <View>
      <Text accessibilityLabel="count">{String(ward.length)}</Text>
      <Text accessibilityLabel="top">{ward[0]?.board.patient_id ?? "-"}</Text>
      <Text accessibilityLabel="role">{settings.role}</Text>
      <Text accessibilityLabel="setter" onPress={() => setRole("doctor")}>
        set
      </Text>
    </View>
  );
}

describe("BoardProvider", () => {
  it("fills the ward from the bundled recording", () => {
    render(
      <BoardProvider>
        <Probe />
      </BoardProvider>,
    );
    expect(Number(screen.getByLabelText("count").props.children)).toBeGreaterThan(0);
  });

  it("advances the replay over time and keeps the worst bed first", () => {
    render(
      <BoardProvider>
        <Probe />
      </BoardProvider>,
    );
    // The merged ward is 28 frames at one second each. Stop at 24 — bed-3 is in septic shock by
    // then, and we have not yet looped back to the empty first frame.
    act(() => {
      jest.advanceTimersByTime(24_000);
    });
    expect(screen.getByLabelText("top").props.children).toBe("bed-3");
  });

  it("exposes settings and lets a screen change the role", () => {
    render(
      <BoardProvider>
        <Probe />
      </BoardProvider>,
    );
    expect(screen.getByLabelText("role").props.children).toBe("nurse");
    act(() => {
      screen.getByLabelText("setter").props.onPress();
    });
    expect(screen.getByLabelText("role").props.children).toBe("doctor");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- BoardProvider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/store/BoardProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";

import recording from "../../assets/demo/icu-ward.json";
import { createReplayTransport } from "../transport/replayTransport";
import type { ReplayControls } from "../transport/replayTransport";
import type { BoardNotification, Recording, Role } from "../transport/types";
import { boardReducer, initialBoardState, selectPatient, selectWard } from "./boardStore";
import type { PatientView } from "./boardStore";

/** Demo acceleration. The server escalates at five minutes; a 28-second replay never would. */
export const DEFAULT_THRESHOLD_MS = 20_000;
const TICK_MS = 1000;

export interface Settings {
  role: Role;
  haptics: boolean;
  thresholdMs: number;
  speed: number;
}

export interface BoardContextValue {
  ward: PatientView[];
  patient(id: string): PatientView | undefined;
  notifications: BoardNotification[];
  latestNotification: BoardNotification | null;
  acknowledge(patientId: string, kind: string): void;
  controls: ReplayControls;
  settings: Settings;
  setRole(role: Role): void;
  setHaptics(enabled: boolean): void;
  setThresholdMs(ms: number): void;
  setSpeed(speed: number): void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, initialBoardState);
  const [now, setNow] = useState(() => Date.now());
  const [settings, setSettings] = useState<Settings>({
    role: "nurse",
    haptics: true,
    thresholdMs: DEFAULT_THRESHOLD_MS,
    speed: 1,
  });

  const transport = useRef(createReplayTransport({ recording: recording as Recording })).current;

  useEffect(() => {
    const unsubscribe = transport.subscribe({
      onBoard: (board) => dispatch({ type: "board", board, now: Date.now() }),
      onNotification: (note) => dispatch({ type: "notification", note }),
      onLoop: () => dispatch({ type: "loop" }),
    });
    transport.start();
    return () => {
      transport.stop();
      unsubscribe();
    };
  }, [transport]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const options = { now, thresholdMs: settings.thresholdMs };

  const value = useMemo<BoardContextValue>(
    () => ({
      ward: selectWard(state, options),
      patient: (id: string) => selectPatient(state, id, options),
      notifications: state.notifications,
      latestNotification: state.notifications[0] ?? null,
      acknowledge: (patientId: string, kind: string) => {
        void transport.ack(patientId, kind, settings.role);
        dispatch({ type: "ack", patientId, kind, role: settings.role, now: Date.now() });
      },
      controls: transport,
      settings,
      setRole: (role: Role) => setSettings((s) => ({ ...s, role })),
      setHaptics: (haptics: boolean) => setSettings((s) => ({ ...s, haptics })),
      setThresholdMs: (thresholdMs: number) => setSettings((s) => ({ ...s, thresholdMs })),
      setSpeed: (speed: number) => {
        transport.setSpeed(speed);
        setSettings((s) => ({ ...s, speed }));
      },
    }),
    [state, now, settings, transport],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardContextValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoard must be used inside a BoardProvider");
  return value;
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- BoardProvider`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): board provider wiring the replay to the store"
```

---

### Task 16: Small UI primitives

**Files:**
- Create: `homunculus-mobile/src/ui/RiskPill.tsx`, `StalenessBadge.tsx`, `Skeleton.tsx`, `DemoBanner.tsx`
- Create: `homunculus-mobile/__tests__/uiPrimitives.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/uiPrimitives.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { DemoBanner } from "../src/ui/DemoBanner";
import { RiskPill } from "../src/ui/RiskPill";
import { Skeleton } from "../src/ui/Skeleton";
import { StalenessBadge } from "../src/ui/StalenessBadge";

describe("RiskPill", () => {
  it("names the risk in Turkish", () => {
    render(<RiskPill risk="critical" />);
    expect(screen.getByText("Kritik")).toBeTruthy();
  });

  it("labels a calm bed rather than showing an empty pill", () => {
    render(<RiskPill risk="none" />);
    expect(screen.getByText("Sakin")).toBeTruthy();
  });
});

describe("StalenessBadge", () => {
  it("renders nothing when no input is stale", () => {
    render(<StalenessBadge inputs={[]} />);
    expect(screen.queryByLabelText("staleness-badge")).toBeNull();
  });

  it("names the stale inputs", () => {
    render(<StalenessBadge inputs={["creatinine"]} />);
    expect(screen.getByText("Bayat veri: kreatinin")).toBeTruthy();
  });

  it("states the age when one is supplied", () => {
    render(<StalenessBadge inputs={["creatinine"]} agesMs={{ creatinine: 14 * 3600 * 1000 }} />);
    expect(screen.getByText("Bayat veri: kreatinin · 14 sa")).toBeTruthy();
  });
});

describe("Skeleton", () => {
  it("is present while data has not arrived", () => {
    render(<Skeleton height={64} />);
    expect(screen.getByLabelText("skeleton")).toBeTruthy();
  });
});

describe("DemoBanner", () => {
  it("says out loud that the data is a recording", () => {
    render(<DemoBanner />);
    expect(screen.getByText("GÖSTERİM VERİSİ — kayıtlı sentetik senaryo")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- uiPrimitives`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four components**

Create `homunculus-mobile/src/ui/RiskPill.tsx`:

```tsx
import { Text, View } from "react-native";

import { riskTone } from "../domain/risk";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { toneColor } from "../theme/tokens";
import type { Risk } from "../transport/types";

export function RiskPill({ risk }: { risk: Risk }) {
  const color = toneColor(riskTone(risk));
  return (
    <View
      accessibilityLabel={`risk-pill-${risk}`}
      className="rounded-full border px-2.5 py-0.5"
      style={{ borderColor: color, backgroundColor: `${color}1A` }}
    >
      <Text className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
        {t(`risk.${risk}` as MessageKey)}
      </Text>
    </View>
  );
}
```

Create `homunculus-mobile/src/ui/StalenessBadge.tsx`:

```tsx
import { Clock } from "lucide-react-native";
import { Text, View } from "react-native";

import { staleLabel } from "../domain/staleness";
import { t } from "../i18n";
import { tokens } from "../theme/tokens";

export function StalenessBadge({
  inputs,
  agesMs = {},
}: {
  inputs: readonly string[];
  agesMs?: Record<string, number>;
}) {
  const label = staleLabel(inputs, agesMs);
  if (label === null) return null;
  return (
    <View
      accessibilityLabel="staleness-badge"
      className="flex-row items-center gap-1 rounded-md border border-clinical-border px-2 py-0.5"
    >
      <Clock size={12} color={tokens.clinical.stale} />
      <Text className="text-clinical-stale text-xs">{t("stale.badge", { inputs: label })}</Text>
    </View>
  );
}
```

Create `homunculus-mobile/src/ui/Skeleton.tsx`:

```tsx
import { MotiView } from "moti";

import { tokens } from "../theme/tokens";

export function Skeleton({ height, radius = 12 }: { height: number; radius?: number }) {
  return (
    <MotiView
      accessibilityLabel="skeleton"
      from={{ opacity: 0.35 }}
      animate={{ opacity: 0.7 }}
      transition={{ type: "timing", duration: 900, loop: true }}
      style={{ height, borderRadius: radius, backgroundColor: tokens.card }}
    />
  );
}
```

The shimmer is the one place a timing curve is right — a spring would make a loading placeholder bounce, which reads as a bug.

Create `homunculus-mobile/src/ui/DemoBanner.tsx`:

```tsx
import { Text, View } from "react-native";

import { t } from "../i18n";

export function DemoBanner() {
  return (
    <View
      accessibilityLabel="demo-banner"
      className="border-b border-clinical-border bg-card px-4 py-1.5"
    >
      <Text className="text-clinical-stale text-center text-[11px] font-semibold tracking-wide">
        {t("app.demoBanner")}
      </Text>
    </View>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- uiPrimitives`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): risk pill, staleness badge, skeleton and demo banner"
```

---

### Task 17: Sparkline and vital tile

**Files:**
- Create: `homunculus-mobile/src/ui/VitalSparkline.tsx`, `homunculus-mobile/src/ui/VitalTile.tsx`
- Create: `homunculus-mobile/__tests__/vitals.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/vitals.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { VitalSparkline } from "../src/ui/VitalSparkline";
import { VitalTile } from "../src/ui/VitalTile";

describe("VitalSparkline", () => {
  it("renders nothing for a series too short to draw", () => {
    render(<VitalSparkline values={[1]} width={100} height={10} tone="safe" />);
    expect(screen.queryByLabelText("sparkline")).toBeNull();
  });

  it("draws the path the geometry function produced", () => {
    render(<VitalSparkline values={[0, 1]} width={100} height={10} tone="safe" />);
    expect(screen.getByLabelText("sparkline")).toBeTruthy();
  });
});

describe("VitalTile", () => {
  it("shows the value and unit", () => {
    render(<VitalTile label="OAB" value={62} unit="mmHg" values={[]} tone="warning" />);
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("mmHg")).toBeTruthy();
  });

  it("says there is no data rather than printing a dash with no explanation", () => {
    render(<VitalTile label="Kalp hızı" value={null} unit="/dk" values={[]} tone="muted" />);
    expect(screen.getByText("veri yok")).toBeTruthy();
  });

  it("carries a staleness badge when the finding named stale inputs", () => {
    render(
      <VitalTile label="OAB" value={62} unit="mmHg" values={[]} tone="warning" staleInputs={["MAP"]} />,
    );
    expect(screen.getByLabelText("staleness-badge")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- vitals`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/ui/VitalSparkline.tsx`:

```tsx
import Svg, { Path } from "react-native-svg";

import { sparklinePath } from "../domain/sparkline";
import { toneColor } from "../theme/tokens";
import type { Tone } from "../theme/tokens";

export function VitalSparkline({
  values,
  width,
  height,
  tone,
}: {
  values: readonly number[];
  width: number;
  height: number;
  tone: Tone;
}) {
  const path = sparklinePath(values, { width, height, padding: 1.5 });
  if (path === "") return null;
  return (
    <Svg accessibilityLabel="sparkline" width={width} height={height}>
      <Path d={path} stroke={toneColor(tone)} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}
```

Create `homunculus-mobile/src/ui/VitalTile.tsx`:

```tsx
import { Text, View } from "react-native";

import { t } from "../i18n";
import { tokens } from "../theme/tokens";
import type { Tone } from "../theme/tokens";
import { StalenessBadge } from "./StalenessBadge";
import { VitalSparkline } from "./VitalSparkline";

export function VitalTile({
  label,
  value,
  unit,
  values,
  tone,
  staleInputs = [],
}: {
  label: string;
  value: number | null;
  unit: string;
  values: readonly number[];
  tone: Tone;
  staleInputs?: readonly string[];
}) {
  return (
    <View
      accessibilityLabel={`vital-${label}`}
      className="flex-1 rounded-xl border border-clinical-border bg-card p-3"
    >
      <Text className="text-clinical-stale text-xs">{label}</Text>
      {value === null ? (
        <Text className="text-clinical-stale mt-1 text-base">{t("vital.noData")}</Text>
      ) : (
        <View className="mt-1 flex-row items-baseline gap-1">
          <Text className="text-foreground text-2xl font-semibold" style={{ color: tokens.foreground }}>
            {value}
          </Text>
          <Text className="text-clinical-stale text-xs">{unit}</Text>
        </View>
      )}
      <View className="mt-2">
        <VitalSparkline values={values} width={96} height={24} tone={tone} />
      </View>
      <View className="mt-2">
        <StalenessBadge inputs={staleInputs} />
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- vitals`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): SVG sparkline and vital tile"
```

---

### Task 18: The patient card

**Files:**
- Create: `homunculus-mobile/src/ui/PatientCard.tsx`
- Create: `homunculus-mobile/__tests__/PatientCard.test.tsx`

The project skill fixes this interaction: `MotiPressable` from `moti/interactions`, scaling to `0.97` while pressed, with the shared spring. Do not substitute `Pressable` + a hand-rolled animation.

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/PatientCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { PatientCard } from "../src/ui/PatientCard";
import type { PatientView } from "../src/store/boardStore";
import type { BoardAlert, PatientBoard } from "../src/transport/types";

function alert(): BoardAlert {
  return {
    patient_id: "bed-3", kind: "septic_shock", severity: "critical", urgency: "immediate",
    summary: "Septic shock criteria met", clinical_reasoning: "", supporting_evidence: [],
    recommended_actions: [], confidence: "", source: "rule", downgraded: false,
    chronic_context: "", stale_inputs: [], acknowledged: false, acknowledged_by: null,
    acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function view(overrides: Partial<PatientView> = {}): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "critical", alerts: [alert()],
    latest: { heart_rate: null, map: 62, lactate: 3.4, sofa: 6 },
  };
  return {
    board, top: alert(), tone: "critical", escalated: false, unacknowledged: true,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [70, 66, 62], lactate: [], sofa: [] },
    ...overrides,
  };
}

describe("PatientCard", () => {
  it("identifies the patient only by bed", () => {
    render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("YB Yatak 3")).toBeTruthy();
  });

  it("shows the most severe finding's summary", () => {
    render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("Septic shock criteria met")).toBeTruthy();
  });

  it("marks an unacknowledged finding", () => {
    render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("Onaylanmadı")).toBeTruthy();
  });

  it("shouts when the alert has escalated", () => {
    render(<PatientCard view={view({ escalated: true })} onPress={() => {}} />);
    expect(screen.getByText("ESKALE EDİLDİ")).toBeTruthy();
  });

  it("shows the SOFA total and a MAP trend", () => {
    render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByText("SOFA 6")).toBeTruthy();
    expect(screen.getByLabelText("sparkline")).toBeTruthy();
  });

  it("exposes one accessible label describing the whole card", () => {
    render(<PatientCard view={view()} onPress={() => {}} />);
    expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();
  });

  it("says a calm bed is calm", () => {
    const calm = view({
      board: {
        patient_id: "bed-5", risk: "none", alerts: [],
        latest: { heart_rate: null, map: 80, lactate: 1.1, sofa: 0 },
      },
      top: null, tone: "muted", unacknowledged: false,
    });
    render(<PatientCard view={calm} onPress={() => {}} />);
    expect(screen.getByText("Sakin")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- PatientCard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/ui/PatientCard.tsx`:

```tsx
import { MotiPressable } from "moti/interactions";
import { useMemo } from "react";
import { Text, View } from "react-native";

import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { GLOW_DURATION_MS, PRESS_SCALE, SPRING } from "../theme/motion";
import { toneColor } from "../theme/tokens";
import { MotiView } from "moti";
import { RiskPill } from "./RiskPill";
import { VitalSparkline } from "./VitalSparkline";

function bedNumber(patientId: string): string {
  return patientId.replace(/^bed-/, "");
}

export function PatientCard({ view, onPress }: { view: PatientView; onPress: () => void }) {
  const color = toneColor(view.tone);
  const bed = t("bed.label", { bed: bedNumber(view.board.patient_id) });

  const animate = useMemo(
    () =>
      ({ pressed }: { pressed: boolean }) => {
        "worklet";
        return { scale: pressed ? PRESS_SCALE : 1 };
      },
    [],
  );

  return (
    <MotiPressable
      accessibilityLabel={`patient-card-${view.board.patient_id}`}
      onPress={onPress}
      animate={animate}
      transition={{ type: "spring", ...SPRING }}
    >
      <MotiView
        from={{ opacity: view.escalated ? 0.55 : 1 }}
        animate={{ opacity: 1 }}
        transition={
          view.escalated
            ? { type: "timing", duration: GLOW_DURATION_MS, loop: true }
            : { type: "spring", ...SPRING }
        }
        style={{
          borderColor: color,
          shadowColor: color,
          shadowOpacity: view.tone === "critical" ? 0.45 : 0,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
        }}
        className="mb-3 rounded-2xl border bg-card p-4"
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground text-base font-semibold">{bed}</Text>
          <RiskPill risk={view.board.risk} />
        </View>

        <Text className="text-clinical-stale mt-2 text-sm" numberOfLines={2}>
          {view.top?.summary ?? t("risk.none")}
        </Text>

        <View className="mt-3 flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <Text className="text-clinical-stale text-xs">
              {`${t("vital.sofa")} ${view.board.latest.sofa ?? "—"}`}
            </Text>
            <VitalSparkline values={view.series.map} width={72} height={20} tone={view.tone} />
          </View>

          {view.escalated ? (
            <Text className="text-xs font-bold" style={{ color: toneColor("critical") }}>
              {t("alert.escalated")}
            </Text>
          ) : view.unacknowledged ? (
            <Text className="text-clinical-warning text-xs font-semibold">
              {t("alert.unacknowledged")}
            </Text>
          ) : null}
        </View>
      </MotiView>
    </MotiPressable>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- PatientCard`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): patient card with MotiPressable spring and critical glow"
```

---

### Task 19: The patients tab

**Files:**
- Create: `homunculus-mobile/app/(tabs)/index.tsx`
- Create: `homunculus-mobile/src/ui/WardList.tsx`
- Create: `homunculus-mobile/__tests__/WardList.test.tsx`

The screen file stays thin so the list can be tested without the router.

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/WardList.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { WardList } from "../src/ui/WardList";
import type { PatientView } from "../src/store/boardStore";
import type { PatientBoard } from "../src/transport/types";

function view(id: string, risk: PatientBoard["risk"]): PatientView {
  const board: PatientBoard = {
    patient_id: id, risk, alerts: [],
    latest: { heart_rate: null, map: 70, lactate: null, sofa: 0 },
  };
  return {
    board, top: null, tone: "muted", escalated: false, unacknowledged: false,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [], lactate: [], sofa: [] },
  };
}

describe("WardList", () => {
  it("shows skeletons while the first frame has not arrived", () => {
    render(<WardList ward={[]} loading onSelect={() => {}} />);
    expect(screen.getAllByLabelText("skeleton").length).toBeGreaterThan(0);
  });

  it("says the ward is empty once loading is done and nothing arrived", () => {
    render(<WardList ward={[]} loading={false} onSelect={() => {}} />);
    expect(screen.getByText("Koğuşta gösterilecek yatak yok.")).toBeTruthy();
  });

  it("renders one card per bed in the order it was given", () => {
    render(
      <WardList
        ward={[view("bed-3", "critical"), view("bed-5", "none")]}
        loading={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();
    expect(screen.getByLabelText("patient-card-bed-5")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- WardList`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the list**

Create `homunculus-mobile/src/ui/WardList.tsx`:

```tsx
import { Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";

import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { SPRING } from "../theme/motion";
import { PatientCard } from "./PatientCard";
import { Skeleton } from "./Skeleton";

export function WardList({
  ward,
  loading,
  onSelect,
}: {
  ward: PatientView[];
  loading: boolean;
  onSelect: (patientId: string) => void;
}) {
  if (loading && ward.length === 0) {
    return (
      <View className="gap-3 p-4">
        <Skeleton height={104} />
        <Skeleton height={104} />
        <Skeleton height={104} />
      </View>
    );
  }

  if (ward.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <Text className="text-clinical-stale text-center">{t("ward.empty")}</Text>
      </View>
    );
  }

  // Animated.FlatList, not createAnimatedComponent(FlatList): only the former honours
  // itemLayoutAnimation, which is what makes a reordering ward spring instead of jump.
  return (
    <Animated.FlatList
      data={ward}
      itemLayoutAnimation={LinearTransition.springify()
        .damping(SPRING.damping)
        .mass(SPRING.mass)
        .stiffness(SPRING.stiffness)}
      keyExtractor={(item: PatientView) => item.board.patient_id}
      contentContainerClassName="p-4"
      renderItem={({ item }: { item: PatientView }) => (
        <PatientCard view={item} onPress={() => onSelect(item.board.patient_id)} />
      )}
    />
  );
}
```

- [ ] **Step 4: Write the screen**

Create `homunculus-mobile/app/(tabs)/index.tsx`:

```tsx
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { WardList } from "../../src/ui/WardList";

export default function PatientsScreen() {
  const { ward } = useBoard();
  const router = useRouter();

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <DemoBanner />
      <View className="px-4 pb-2 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("ward.title")}</Text>
        <Text className="text-clinical-stale text-xs">{t("ward.subtitle")}</Text>
      </View>
      <WardList
        ward={ward}
        loading={ward.length === 0}
        onSelect={(patientId) => router.push(`/patient/${patientId}`)}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- WardList`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): patients tab with spring layout transitions"
```

---

### Task 20: Alert card and guideline drawer

**Files:**
- Create: `homunculus-mobile/src/ui/AlertCard.tsx`, `homunculus-mobile/src/ui/GuidelineDrawer.tsx`
- Create: `homunculus-mobile/__tests__/AlertCard.test.tsx`, `homunculus-mobile/__tests__/GuidelineDrawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-mobile/__tests__/AlertCard.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { AlertCard } from "../src/ui/AlertCard";
import type { BoardAlert } from "../src/transport/types";

function alert(overrides: Partial<BoardAlert> = {}): BoardAlert {
  return {
    patient_id: "bed-7", kind: "under_resuscitated_sepsis", severity: "high", urgency: "immediate",
    summary: "Hypoperfusion before adequate fluid",
    clinical_reasoning: "Lactate 3.5 mmol/L with MAP 61.0 mmHg.",
    supporting_evidence: ["sepsis-3-jama-2016"],
    recommended_actions: ["Assess fluid responsiveness before escalating vasopressors."],
    confidence: "Fluid target: conditional recommendation, low certainty (SSC 2026).",
    source: "rule", downgraded: false, chronic_context: "", stale_inputs: [],
    acknowledged: false, acknowledged_by: null, acknowledged_at: null,
    first_seen_at: null, escalated: false,
    ...overrides,
  };
}

describe("AlertCard", () => {
  it("shows the summary, the reasoning and the confidence wording verbatim", () => {
    render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />);
    expect(screen.getByText("Hypoperfusion before adequate fluid")).toBeTruthy();
    expect(screen.getByText("Lactate 3.5 mmol/L with MAP 61.0 mmHg.")).toBeTruthy();
    expect(
      screen.getByText("Fluid target: conditional recommendation, low certainty (SSC 2026)."),
    ).toBeTruthy();
  });

  it("lists the recommended actions as the engine phrased them", () => {
    render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />);
    expect(
      screen.getByText("Assess fluid responsiveness before escalating vasopressors."),
    ).toBeTruthy();
  });

  it("acknowledges on press", () => {
    const onAcknowledge = jest.fn();
    render(<AlertCard alert={alert()} escalated={false} onAcknowledge={onAcknowledge} onCite={() => {}} />);
    fireEvent.press(screen.getByText("Onayla"));
    expect(onAcknowledge).toHaveBeenCalled();
  });

  it("opens the drawer for the citation that was tapped", () => {
    const onCite = jest.fn();
    render(<AlertCard alert={alert()} escalated={false} onAcknowledge={() => {}} onCite={onCite} />);
    fireEvent.press(screen.getByText("Sepsis-3 (JAMA 2016)"));
    expect(onCite).toHaveBeenCalledWith("sepsis-3-jama-2016");
  });

  it("shows the acknowledged state instead of the button once acknowledged", () => {
    render(
      <AlertCard alert={alert({ acknowledged: true })} escalated={false} onAcknowledge={() => {}} onCite={() => {}} />,
    );
    expect(screen.getByText("Onaylandı")).toBeTruthy();
    expect(screen.queryByText("Onayla")).toBeNull();
  });

  it("surfaces the chronic context when the finding was downgraded", () => {
    render(
      <AlertCard
        alert={alert({ downgraded: true, chronic_context: "Kronik AF; HR 100-110 bu hasta için normal." })}
        escalated={false}
        onAcknowledge={() => {}}
        onCite={() => {}}
      />,
    );
    expect(screen.getByText("Kronik AF; HR 100-110 bu hasta için normal.")).toBeTruthy();
    expect(screen.getByText("Hastanın kendi bazaline göre indirgendi")).toBeTruthy();
  });
});
```

Create `homunculus-mobile/__tests__/GuidelineDrawer.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { GuidelineDrawer } from "../src/ui/GuidelineDrawer";

describe("GuidelineDrawer", () => {
  it("renders nothing when it has no citation", () => {
    render(<GuidelineDrawer citationId={null} confidence="" onClose={() => {}} />);
    expect(screen.queryByLabelText("guideline-drawer")).toBeNull();
  });

  it("shows the vault title and authority", () => {
    render(<GuidelineDrawer citationId="sepsis-3-jama-2016" confidence="" onClose={() => {}} />);
    expect(screen.getByText("Sepsis-3 (JAMA 2016)")).toBeTruthy();
    expect(screen.getByText("Otorite: yüksek")).toBeTruthy();
  });

  it("warns that a superseded edition has been replaced", () => {
    render(<GuidelineDrawer citationId="surviving-sepsis-campaign-2021" confidence="" onClose={() => {}} />);
    expect(screen.getByText("Bu kaynak daha yeni bir baskıyla değiştirildi.")).toBeTruthy();
  });

  it("shows the alert's own confidence wording and nothing invented", () => {
    render(
      <GuidelineDrawer
        citationId="sepsis-3-jama-2016"
        confidence="Sepsis-3 organ-dysfunction criterion (consensus definition)."
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText("Sepsis-3 organ-dysfunction criterion (consensus definition)."),
    ).toBeTruthy();
  });

  it("admits when a citation is not in the catalogue", () => {
    render(<GuidelineDrawer citationId="made-up-2030" confidence="" onClose={() => {}} />);
    expect(screen.getByText("Kaynak notu bulunamadı: made-up-2030")).toBeTruthy();
  });

  it("closes", () => {
    const onClose = jest.fn();
    render(<GuidelineDrawer citationId="sepsis-3-jama-2016" confidence="" onClose={onClose} />);
    fireEvent.press(screen.getByText("Kapat"));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- AlertCard GuidelineDrawer`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the alert card**

Create `homunculus-mobile/src/ui/AlertCard.tsx`:

```tsx
import { BlurView } from "expo-blur";
import { Pressable, Text, View } from "react-native";

import { lookupSource } from "../domain/citations";
import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import { toneColor } from "../theme/tokens";
import type { BoardAlert } from "../transport/types";
import { StalenessBadge } from "./StalenessBadge";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-3">
      <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
        {title}
      </Text>
      {children}
    </View>
  );
}

export function AlertCard({
  alert,
  escalated,
  onAcknowledge,
  onCite,
}: {
  alert: BoardAlert;
  escalated: boolean;
  onAcknowledge: () => void;
  onCite: (citationId: string) => void;
}) {
  const color = escalated ? toneColor("critical") : toneColor(severityTone(alert.severity));

  return (
    <View
      accessibilityLabel={`alert-${alert.kind}`}
      className="mb-3 overflow-hidden rounded-2xl border"
      style={{ borderColor: color }}
    >
      <BlurView intensity={24} tint="dark" className="p-4">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="text-foreground flex-1 text-base font-semibold">{alert.summary}</Text>
          {escalated ? (
            <Text className="text-xs font-bold" style={{ color }}>
              {t("alert.escalated")}
            </Text>
          ) : null}
        </View>

        <StalenessBadge inputs={alert.stale_inputs} />

        {alert.downgraded ? (
          <Section title={t("alert.chronicContext")}>
            <Text className="text-clinical-stale mt-1 text-sm">{t("alert.downgraded")}</Text>
            <Text className="text-clinical-stale mt-1 text-sm">{alert.chronic_context}</Text>
          </Section>
        ) : null}

        <Section title={t("alert.reasoning")}>
          <Text className="text-clinical-stale mt-1 text-sm">{alert.clinical_reasoning}</Text>
        </Section>

        <Section title={t("alert.actions")}>
          {alert.recommended_actions.map((action) => (
            <Text key={action} className="text-foreground mt-1 text-sm">
              • {action}
            </Text>
          ))}
        </Section>

        <Section title={t("alert.confidence")}>
          <Text className="text-clinical-stale mt-1 text-sm">{alert.confidence}</Text>
        </Section>

        <Section title={t("alert.sources")}>
          <View className="mt-1 flex-row flex-wrap gap-2">
            {alert.supporting_evidence.map((id) => (
              <Pressable
                key={id}
                accessibilityLabel={`citation-${id}`}
                onPress={() => onCite(id)}
                className="rounded-lg border border-clinical-border px-2 py-1"
              >
                <Text className="text-clinical-safe text-xs">{lookupSource(id)?.title ?? id}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <View className="mt-4">
          {alert.acknowledged ? (
            <Text className="text-clinical-safe text-sm font-semibold">{t("alert.acknowledged")}</Text>
          ) : (
            <Pressable
              accessibilityLabel={`acknowledge-${alert.kind}`}
              onPress={onAcknowledge}
              className="items-center rounded-xl border px-4 py-2"
              style={{ borderColor: color }}
            >
              <Text className="text-sm font-semibold" style={{ color }}>
                {t("alert.acknowledge")}
              </Text>
            </Pressable>
          )}
        </View>
      </BlurView>
    </View>
  );
}
```

- [ ] **Step 4: Implement the drawer**

Create `homunculus-mobile/src/ui/GuidelineDrawer.tsx`:

```tsx
import { Modal, Pressable, Text, View } from "react-native";

import { lookupSource } from "../domain/citations";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";

export function GuidelineDrawer({
  citationId,
  confidence,
  onClose,
}: {
  citationId: string | null;
  confidence: string;
  onClose: () => void;
}) {
  if (citationId === null) return null;
  const note = lookupSource(citationId);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View
          accessibilityLabel="guideline-drawer"
          className="rounded-t-3xl border-t border-clinical-border bg-card p-5"
        >
          <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
            {t("drawer.title")}
          </Text>

          {note === null ? (
            <Text className="text-clinical-warning mt-2 text-base">
              {t("drawer.unknown", { id: citationId })}
            </Text>
          ) : (
            <>
              <Text className="text-foreground mt-2 text-lg font-semibold">{note.title}</Text>
              <Text className="text-clinical-stale mt-1 text-sm">
                {`${t("drawer.authority")}: ${t(`drawer.authority.${note.authority}` as MessageKey)}`}
              </Text>
              {note.superseded ? (
                <Text className="text-clinical-warning mt-2 text-sm">{t("drawer.superseded")}</Text>
              ) : null}
            </>
          )}

          {confidence.length > 0 ? (
            <Text className="text-clinical-stale mt-3 text-sm">{confidence}</Text>
          ) : null}

          <Text className="text-clinical-stale mt-3 text-[11px]">{t("drawer.note")}</Text>

          <Pressable
            onPress={onClose}
            className="mt-5 items-center rounded-xl border border-clinical-border py-2"
          >
            <Text className="text-foreground text-sm font-semibold">{t("drawer.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- AlertCard GuidelineDrawer`
Expected: 12 passing.

- [ ] **Step 6: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): glass alert card and the vault-backed guideline drawer"
```

---

### Task 21: The patient detail screen

**Files:**
- Create: `homunculus-mobile/src/ui/PatientDetail.tsx`
- Create: `homunculus-mobile/app/patient/[id].tsx`
- Create: `homunculus-mobile/__tests__/PatientDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/PatientDetail.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { PatientDetail } from "../src/ui/PatientDetail";
import type { PatientView } from "../src/store/boardStore";
import type { BoardAlert, PatientBoard } from "../src/transport/types";

function alert(): BoardAlert {
  return {
    patient_id: "bed-3", kind: "septic_shock", severity: "critical", urgency: "immediate",
    summary: "Septic shock criteria met", clinical_reasoning: "Vasopressor plus lactate.",
    supporting_evidence: ["sepsis-3-jama-2016"],
    recommended_actions: ["Review vasopressor titration against a MAP target of 65 mmHg."],
    confidence: "Criteria are deterministic (Sepsis-3).", source: "rule", downgraded: false,
    chronic_context: "", stale_inputs: [], acknowledged: false, acknowledged_by: null,
    acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function view(): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "critical", alerts: [alert()],
    latest: { heart_rate: null, map: 62, lactate: 3.4, sofa: 6 },
  };
  return {
    board, top: alert(), tone: "critical", escalated: false, unacknowledged: true,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [72, 66, 62], lactate: [1.8, 2.6, 3.4], sofa: [0, 4, 6] },
  };
}

describe("PatientDetail", () => {
  it("titles the screen with the bed and nothing else identifying", () => {
    render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByText("YB Yatak 3")).toBeTruthy();
  });

  it("renders the four vital tiles", () => {
    render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    for (const label of ["Kalp hızı", "OAB", "Laktat", "SOFA"]) {
      expect(screen.getByLabelText(`vital-${label}`)).toBeTruthy();
    }
  });

  it("says heart rate has no data instead of drawing an empty trend", () => {
    render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByText("veri yok")).toBeTruthy();
  });

  it("labels the trend as scenario time, not as a twelve-hour window", () => {
    render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByText("Senaryo zamanı eğilimi")).toBeTruthy();
  });

  it("renders the active alerts", () => {
    render(<PatientDetail view={view()} onAcknowledge={() => {}} />);
    expect(screen.getByLabelText("alert-septic_shock")).toBeTruthy();
  });

  it("says so when a bed has no active alert", () => {
    const calm = {
      ...view(),
      board: {
        patient_id: "bed-5", risk: "none" as const, alerts: [],
        latest: { heart_rate: null, map: 80, lactate: 1.1, sofa: 0 },
      },
      top: null,
    };
    render(<PatientDetail view={calm} onAcknowledge={() => {}} />);
    expect(screen.getByText("Aktif uyarı yok.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- PatientDetail`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the presentational screen**

Create `homunculus-mobile/src/ui/PatientDetail.tsx`:

```tsx
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { alertKey } from "../domain/keys";
import { t } from "../i18n";
import type { PatientView } from "../store/boardStore";
import { AlertCard } from "./AlertCard";
import { GuidelineDrawer } from "./GuidelineDrawer";
import { RiskPill } from "./RiskPill";
import { VitalTile } from "./VitalTile";

function bedNumber(patientId: string): string {
  return patientId.replace(/^bed-/, "");
}

export function PatientDetail({
  view,
  onAcknowledge,
}: {
  view: PatientView;
  onAcknowledge: (kind: string) => void;
}) {
  const [citation, setCitation] = useState<{ id: string; confidence: string } | null>(null);
  const { board, series } = view;

  return (
    <>
      <ScrollView className="flex-1 bg-background" contentContainerClassName="p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground text-2xl font-semibold">
            {t("bed.label", { bed: bedNumber(board.patient_id) })}
          </Text>
          <RiskPill risk={board.risk} />
        </View>

        <Text className="text-clinical-stale mt-4 text-[11px] font-semibold uppercase tracking-wide">
          {t("detail.vitals")}
        </Text>
        <Text className="text-clinical-stale mt-0.5 text-[11px]">{t("vital.trend")}</Text>

        <View className="mt-2 flex-row gap-3">
          <VitalTile
            label={t("vital.heartRate")}
            value={board.latest.heart_rate}
            unit="/dk"
            values={series.heart_rate}
            tone={view.tone}
          />
          <VitalTile
            label={t("vital.map")}
            value={board.latest.map}
            unit="mmHg"
            values={series.map}
            tone={view.tone}
          />
        </View>
        <View className="mt-3 flex-row gap-3">
          <VitalTile
            label={t("vital.lactate")}
            value={board.latest.lactate}
            unit="mmol/L"
            values={series.lactate}
            tone={view.tone}
          />
          <VitalTile
            label={t("vital.sofa")}
            value={board.latest.sofa}
            unit=""
            values={series.sofa}
            tone={view.tone}
          />
        </View>

        <Text className="text-clinical-stale mt-6 text-[11px] font-semibold uppercase tracking-wide">
          {t("detail.alerts")}
        </Text>

        {board.alerts.length === 0 ? (
          <Text className="text-clinical-stale mt-2 text-sm">{t("detail.noAlerts")}</Text>
        ) : (
          <View className="mt-2">
            {board.alerts.map((alert) => (
              <AlertCard
                key={alert.kind}
                alert={{
                  ...alert,
                  acknowledged:
                    alert.acknowledged ||
                    view.acknowledgedKeys.has(alertKey(board.patient_id, alert.kind)),
                }}
                escalated={view.escalatedKeys.has(alertKey(board.patient_id, alert.kind))}
                onAcknowledge={() => onAcknowledge(alert.kind)}
                onCite={(id) => setCitation({ id, confidence: alert.confidence })}
              />
            ))}
          </View>
        )}
        <View className="h-8" />
      </ScrollView>

      <GuidelineDrawer
        citationId={citation?.id ?? null}
        confidence={citation?.confidence ?? ""}
        onClose={() => setCitation(null)}
      />
    </>
  );
}
```

- [ ] **Step 4: Write the route**

Create `homunculus-mobile/app/patient/[id].tsx`:

```tsx
import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { PatientDetail } from "../../src/ui/PatientDetail";

export default function PatientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { patient, acknowledge } = useBoard();
  const view = patient(id);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: "", headerTransparent: true }} />
      {view ? (
        <PatientDetail view={view} onAcknowledge={(kind) => acknowledge(id, kind)} />
      ) : (
        <View className="flex-1 items-center justify-center p-8">
          <Text className="text-clinical-stale">{t("detail.missing")}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- PatientDetail`
Expected: 6 passing.

- [ ] **Step 6: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): patient detail with vitals, trends and cited alerts"
```

---

### Task 22: The alerts tab with haptics

**Files:**
- Create: `homunculus-mobile/src/ui/NotificationFeed.tsx`, `homunculus-mobile/src/ui/useAlertHaptics.ts`
- Create: `homunculus-mobile/app/(tabs)/alerts.tsx`
- Create: `homunculus-mobile/__tests__/NotificationFeed.test.tsx`, `homunculus-mobile/__tests__/useAlertHaptics.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `homunculus-mobile/__tests__/NotificationFeed.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { NotificationFeed } from "../src/ui/NotificationFeed";
import type { BoardNotification } from "../src/transport/types";

function note(overrides: Partial<BoardNotification> = {}): BoardNotification {
  return {
    tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
    urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
    body: "bed-3: Septic shock criteria met", ts: "2026-07-26T17:23:25.878950+00:00",
    ...overrides,
  };
}

describe("NotificationFeed", () => {
  it("says the feed is empty rather than showing a blank screen", () => {
    render(<NotificationFeed notifications={[]} onSelect={() => {}} />);
    expect(screen.getByText("Henüz uyarı yok.")).toBeTruthy();
  });

  it("separates escalations from new alerts", () => {
    render(
      <NotificationFeed
        notifications={[note(), note({ trigger: "escalation", kind: "sepsis" })]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Eskale edilenler")).toBeTruthy();
    expect(screen.getByText("Yeni uyarılar")).toBeTruthy();
  });

  it("shows the PHI-minimal body the server composed", () => {
    render(<NotificationFeed notifications={[note()]} onSelect={() => {}} />);
    expect(screen.getByText("bed-3: Septic shock criteria met")).toBeTruthy();
  });
});
```

Create `homunculus-mobile/__tests__/useAlertHaptics.test.tsx`:

```tsx
import { render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Text } from "react-native";

import { useAlertHaptics } from "../src/ui/useAlertHaptics";
import type { BoardNotification } from "../src/transport/types";

function note(overrides: Partial<BoardNotification> = {}): BoardNotification {
  return {
    tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
    urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
    body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
    ...overrides,
  };
}

function Probe({ latest, enabled }: { latest: BoardNotification | null; enabled: boolean }) {
  useAlertHaptics(latest, enabled);
  return <Text>probe</Text>;
}

beforeEach(() => jest.clearAllMocks());

describe("useAlertHaptics", () => {
  it("fires a warning pattern for a new immediate alert", () => {
    render(<Probe latest={note()} enabled />);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
  });

  it("fires the heavier error pattern for an escalation", () => {
    render(<Probe latest={note({ trigger: "escalation" })} enabled />);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Error);
  });

  it("stays silent when the clinician turned haptics off", () => {
    render(<Probe latest={note()} enabled={false} />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it("stays silent when there is nothing new", () => {
    render(<Probe latest={null} enabled />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- NotificationFeed useAlertHaptics`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/ui/useAlertHaptics.ts`:

```ts
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";

import type { BoardNotification } from "../transport/types";

/**
 * Urgency should be felt, not only read. An escalation gets the heavier pattern than a new alert,
 * so a pocket buzz alone distinguishes "something new" from "nobody answered".
 */
export function useAlertHaptics(latest: BoardNotification | null, enabled: boolean): void {
  const lastTs = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || latest === null) return;
    if (latest.ts === lastTs.current) return;
    lastTs.current = latest.ts;
    if (latest.trigger === "escalation") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (latest.urgency === "immediate") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [latest, enabled]);
}
```

Create `homunculus-mobile/src/ui/NotificationFeed.tsx`:

```tsx
import { Pressable, ScrollView, Text, View } from "react-native";

import { severityTone } from "../domain/risk";
import { t } from "../i18n";
import { toneColor } from "../theme/tokens";
import type { BoardNotification } from "../transport/types";

function Row({ note, onSelect }: { note: BoardNotification; onSelect: (id: string) => void }) {
  const color = toneColor(severityTone(note.severity));
  return (
    <Pressable
      accessibilityLabel={`notification-${note.patient_id}-${note.kind}-${note.ts}`}
      onPress={() => onSelect(note.patient_id)}
      className="mb-2 rounded-xl border border-clinical-border bg-card p-3"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold" style={{ color }}>
          {note.title}
        </Text>
        <Text className="text-clinical-stale text-[11px]">{note.ts.slice(11, 16)}</Text>
      </View>
      <Text className="text-foreground mt-1 text-sm">{note.body}</Text>
    </Pressable>
  );
}

export function NotificationFeed({
  notifications,
  onSelect,
}: {
  notifications: BoardNotification[];
  onSelect: (patientId: string) => void;
}) {
  if (notifications.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <Text className="text-clinical-stale">{t("alerts.empty")}</Text>
      </View>
    );
  }

  const escalations = notifications.filter((n) => n.trigger === "escalation");
  const fresh = notifications.filter((n) => n.trigger !== "escalation");

  return (
    <ScrollView contentContainerClassName="p-4">
      {escalations.length > 0 ? (
        <>
          <Text className="text-clinical-critical mb-2 text-[11px] font-semibold uppercase tracking-wide">
            {t("alerts.escalatedSection")}
          </Text>
          {escalations.map((note) => (
            <Row key={`${note.patient_id}-${note.kind}-${note.ts}`} note={note} onSelect={onSelect} />
          ))}
        </>
      ) : null}

      {fresh.length > 0 ? (
        <>
          <Text className="text-clinical-stale mb-2 mt-2 text-[11px] font-semibold uppercase tracking-wide">
            {t("alerts.newSection")}
          </Text>
          {fresh.map((note) => (
            <Row key={`${note.patient_id}-${note.kind}-${note.ts}`} note={note} onSelect={onSelect} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
```

Create `homunculus-mobile/app/(tabs)/alerts.tsx`:

```tsx
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { NotificationFeed } from "../../src/ui/NotificationFeed";
import { useAlertHaptics } from "../../src/ui/useAlertHaptics";

export default function AlertsScreen() {
  const { notifications, latestNotification, settings } = useBoard();
  const router = useRouter();
  useAlertHaptics(latestNotification, settings.haptics);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <DemoBanner />
      <View className="px-4 pb-1 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("alerts.title")}</Text>
      </View>
      <NotificationFeed
        notifications={notifications}
        onSelect={(patientId) => router.push(`/patient/${patientId}`)}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- NotificationFeed useAlertHaptics`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): alerts tab with escalation-aware haptics"
```

---

### Task 23: The settings tab

**Files:**
- Create: `homunculus-mobile/src/ui/SettingsPanel.tsx`
- Create: `homunculus-mobile/app/(tabs)/settings.tsx`
- Create: `homunculus-mobile/__tests__/SettingsPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `homunculus-mobile/__tests__/SettingsPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SettingsPanel } from "../src/ui/SettingsPanel";

function panel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const props = {
    settings: { role: "nurse" as const, haptics: true, thresholdMs: 20_000, speed: 1 },
    playing: true,
    onPlay: jest.fn(),
    onPause: jest.fn(),
    onRestart: jest.fn(),
    onSpeed: jest.fn(),
    onRole: jest.fn(),
    onHaptics: jest.fn(),
    onThreshold: jest.fn(),
    version: "1.0.0",
    ...overrides,
  };
  render(<SettingsPanel {...props} />);
  return props;
}

describe("SettingsPanel", () => {
  it("names the data source out loud", () => {
    panel();
    expect(screen.getByText("Kayıtlı senaryo — icu-ward.json")).toBeTruthy();
  });

  it("calls pause while playing", () => {
    const props = panel();
    fireEvent.press(screen.getByText("Duraklat"));
    expect(props.onPause).toHaveBeenCalled();
  });

  it("offers play when paused", () => {
    const props = panel({ playing: false });
    fireEvent.press(screen.getByText("Oynat"));
    expect(props.onPlay).toHaveBeenCalled();
  });

  it("restarts the scenario", () => {
    const props = panel();
    fireEvent.press(screen.getByText("Başa sar"));
    expect(props.onRestart).toHaveBeenCalled();
  });

  it("switches role", () => {
    const props = panel();
    fireEvent.press(screen.getByText("Hekim"));
    expect(props.onRole).toHaveBeenCalledWith("doctor");
  });

  it("changes the replay speed", () => {
    const props = panel();
    fireEvent.press(screen.getByText("2x"));
    expect(props.onSpeed).toHaveBeenCalledWith(2);
  });

  it("admits the escalation threshold is a demo acceleration", () => {
    panel();
    expect(
      screen.getByText(
        "Sunucudaki gerçek eşik 5 dakikadır. Buradaki kısa süre yalnızca gösterim hızlandırmasıdır.",
      ),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- SettingsPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `homunculus-mobile/src/ui/SettingsPanel.tsx`:

```tsx
import { Pressable, ScrollView, Switch, Text, View } from "react-native";

import { t } from "../i18n";
import type { Settings } from "../store/BoardProvider";
import { tokens } from "../theme/tokens";
import type { Role } from "../transport/types";

const SPEEDS = [1, 2, 4];
const THRESHOLDS_MS = [10_000, 20_000, 60_000];

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-4 rounded-xl border border-clinical-border bg-card p-4">
      <Text className="text-clinical-stale text-[11px] font-semibold uppercase tracking-wide">
        {title}
      </Text>
      <View className="mt-2">{children}</View>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-lg border px-3 py-1.5"
      style={{ borderColor: active ? tokens.clinical.safe : tokens.clinical.border }}
    >
      <Text
        className="text-sm"
        style={{ color: active ? tokens.clinical.safe : tokens.clinical.stale }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SettingsPanel({
  settings,
  playing,
  onPlay,
  onPause,
  onRestart,
  onSpeed,
  onRole,
  onHaptics,
  onThreshold,
  version,
}: {
  settings: Settings;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onSpeed: (speed: number) => void;
  onRole: (role: Role) => void;
  onHaptics: (enabled: boolean) => void;
  onThreshold: (ms: number) => void;
  version: string;
}) {
  return (
    <ScrollView contentContainerClassName="p-4">
      <Row title={t("settings.playback")}>
        <View className="flex-row gap-2">
          <Chip
            label={playing ? t("settings.pause") : t("settings.play")}
            active
            onPress={playing ? onPause : onPlay}
          />
          <Chip label={t("settings.restart")} active={false} onPress={onRestart} />
        </View>
        <View className="mt-3 flex-row items-center gap-2">
          <Text className="text-clinical-stale text-sm">{t("settings.speed")}</Text>
          {SPEEDS.map((speed) => (
            <Chip
              key={speed}
              label={`${speed}x`}
              active={settings.speed === speed}
              onPress={() => onSpeed(speed)}
            />
          ))}
        </View>
      </Row>

      <Row title={t("settings.role")}>
        <View className="flex-row gap-2">
          <Chip
            label={t("settings.role.nurse")}
            active={settings.role === "nurse"}
            onPress={() => onRole("nurse")}
          />
          <Chip
            label={t("settings.role.doctor")}
            active={settings.role === "doctor"}
            onPress={() => onRole("doctor")}
          />
        </View>
      </Row>

      <Row title={t("settings.haptics")}>
        <Switch value={settings.haptics} onValueChange={onHaptics} />
      </Row>

      <Row title={t("settings.threshold")}>
        <View className="flex-row gap-2">
          {THRESHOLDS_MS.map((ms) => (
            <Chip
              key={ms}
              label={`${ms / 1000}s`}
              active={settings.thresholdMs === ms}
              onPress={() => onThreshold(ms)}
            />
          ))}
        </View>
        <Text className="text-clinical-stale mt-2 text-[11px]">{t("settings.thresholdNote")}</Text>
      </Row>

      <Row title={t("settings.dataSource")}>
        <Text className="text-foreground text-sm">{t("settings.dataSourceValue")}</Text>
      </Row>

      <Row title={t("settings.version")}>
        <Text className="text-clinical-stale text-sm">{version}</Text>
      </Row>
    </ScrollView>
  );
}
```

Create `homunculus-mobile/app/(tabs)/settings.tsx`:

```tsx
import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { t } from "../../src/i18n";
import { useBoard } from "../../src/store/BoardProvider";
import { DemoBanner } from "../../src/ui/DemoBanner";
import { SettingsPanel } from "../../src/ui/SettingsPanel";

export default function SettingsScreen() {
  const { controls, settings, setRole, setHaptics, setThresholdMs, setSpeed } = useBoard();
  const [playing, setPlaying] = useState(() => controls.isPlaying());

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <DemoBanner />
      <View className="px-4 pb-1 pt-3">
        <Text className="text-foreground text-2xl font-semibold">{t("settings.title")}</Text>
      </View>
      <SettingsPanel
        settings={settings}
        playing={playing}
        onPlay={() => {
          controls.play();
          setPlaying(true);
        }}
        onPause={() => {
          controls.pause();
          setPlaying(false);
        }}
        onRestart={() => controls.restart()}
        onSpeed={setSpeed}
        onRole={setRole}
        onHaptics={setHaptics}
        onThreshold={setThresholdMs}
        version="1.0.0"
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- SettingsPanel`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add homunculus-mobile
git commit -m "feat(mobile): settings tab driving the replay"
```

---

### Task 24: Shell, tabs and final verification

**Files:**
- Modify: `homunculus-mobile/app/_layout.tsx`
- Create: `homunculus-mobile/app/(tabs)/_layout.tsx`
- Delete: `homunculus-mobile/app/index.tsx`
- Create: `homunculus-mobile/README.md`
- Modify: `docs/homunculus-rehber-TR.md`

- [ ] **Step 1: Write the tab layout**

Create `homunculus-mobile/app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";
import { Activity, BellRing, Settings2 } from "lucide-react-native";

import { t } from "../../src/i18n";
import { tokens } from "../../src/theme/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tokens.clinical.safe,
        tabBarInactiveTintColor: tokens.clinical.stale,
        tabBarStyle: {
          backgroundColor: tokens.card,
          borderTopColor: tokens.clinical.border,
        },
        sceneStyle: { backgroundColor: tokens.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.patients"),
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: t("tabs.alerts"),
          tabBarIcon: ({ color, size }) => <BellRing color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size }) => <Settings2 color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
```

If `sceneStyle` is rejected by the installed Expo Router version, use `sceneContainerStyle` instead — the two names cover the same option across versions.

- [ ] **Step 2: Wrap the app in the provider**

Replace `homunculus-mobile/app/_layout.tsx`:

```tsx
import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BoardProvider } from "../src/store/BoardProvider";
import { tokens } from "../src/theme/tokens";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: tokens.background }}>
      <SafeAreaProvider>
        <BoardProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: tokens.background },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="patient/[id]" options={{ presentation: "card" }} />
          </Stack>
        </BoardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

`GestureHandlerRootView` is required at the root for `MotiPressable` to receive touches.

- [ ] **Step 3: Remove the placeholder route**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI/homunculus-mobile"
rm app/index.tsx
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: every test file passes. Record the total count in the commit message.

- [ ] **Step 5: Verify the bundle**

Run: `npx expo export --platform web`
Expected: exit code 0.

- [ ] **Step 6: Verify on the web preview**

Run: `npx expo start --web` in a second terminal, open the printed URL, and check by eye:
- the ward lists three beds, `bed-3` first with a critical pill and glow;
- tapping a card opens the detail screen with four vital tiles, MAP/lactate/SOFA trends drawn and heart rate reading *veri yok*;
- tapping a source chip opens the drawer showing "Sepsis-3 (JAMA 2016)" and "Otorite: yüksek";
- the Alerts tab fills as the replay advances, and Settings pauses and restarts it.

Blur renders flat and haptics are silent on web; both are expected there.

Then check contrast with the browser devtools colour picker on the three combinations that carry
meaning — `text-clinical-stale` on `bg-card`, `text-clinical-warning` on `bg-card`, and
`text-foreground` on `bg-background`. Each must reach WCAG AA (4.5:1 for body text, 3:1 for the
large card headings). If one falls short, lighten the token's lightness in `src/theme/palette.js`
rather than patching a single component — the palette is the single source and the class names are
fixed by the project skill.

- [ ] **Step 7: Write the app README**

Create `homunculus-mobile/README.md`:

```markdown
# Homunculus Mobile (M1)

The mobile companion to the Homunculus ward board. M1 runs entirely from a recording: the ward,
its vitals and its alerts are frames the real engine emitted over three synthetic scenarios, merged
into one three-bed ICU by `homunculus-engine/scripts/record_demo.py ward`. There is no backend
connection and no login — the live slice (M2) waits on the auth bridge.

## Run it

```bash
npm install
npx expo start          # scan the QR code with Expo Go
npx expo start --web    # browser preview; blur is flat and haptics are silent there
npm test                # jest-expo suite
```

## Regenerate the ward

```bash
cd ..
homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/record_demo.py ward
```

## What is deliberately absent

- No patient names, identifiers, ages or sexes. Beds only — the recording carries nothing else, and
  nothing is invented for a demo.
- No login screen. One that authenticates against nothing would be worse than none.
- Staleness badges and chronic-context rendering are built and tested, but the current recordings
  produce no stale inputs, so they stay dormant.
- Sparklines cover scenario time, not twelve hours, and are labelled that way.
- The escalation threshold in Settings is a demo acceleration of the server's five minutes.
```

- [ ] **Step 8: Add the mobile app to the Turkish guide**

In `docs/homunculus-rehber-TR.md`, in the parenthetical progress note at the end of section 5, append a sentence in the same voice as the surrounding text:

```markdown
**Mobil eşlikçi uygulama (M1) da kuruldu** — Expo/React Native, kayıtlı üç yataklı koğuşu
oynatan bir aktarım katmanı üzerinde: riske göre sıralı hasta listesi, vital kartları ve senaryo
zamanı eğilimleri, kasadaki kaynak notlarına bağlanan kılavuz çekmecesi, eskalasyon farkındalıklı
titreşim. Canlı veri M2'de, auth-bridge dilimi kodlandığında gelecek.
```

- [ ] **Step 9: Commit**

```bash
cd "c:/Users/User/Desktop/Project/Homunculus AI"
git add homunculus-mobile docs/homunculus-rehber-TR.md
git commit -m "feat(mobile): tab shell, provider wiring and the M1 runbook"
```

---

## Definition of done

- `npm test` passes in `homunculus-mobile/`, including the charter tests over the real recording.
- `npm run typecheck` reports zero errors.
- `homunculus-engine/.venv/Scripts/python.exe -m pytest homunculus-engine -q` still passes, with the four new `record_ward` cases.
- `npx expo export --platform web` exits 0.
- The web preview shows the three beds, the detail screen, the guideline drawer and working replay controls.
- `docs/homunculus-rehber-TR.md` mentions the mobile app.
