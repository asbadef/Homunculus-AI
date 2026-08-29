# Mobile M3 Web-Aligned Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile app wears the web cockpit's palette — slate surfaces, teal accent, emerald/amber/red severities — as two runtime-switchable skins (night default, day in Settings), replacing the obsidian/crimson look everywhere.

**Architecture:** `palette.js` becomes `{icu, light}`; Tailwind colour tokens point at CSS variables so **no className changes anywhere**; a root `ThemeProvider` swaps the NativeWind `vars()` set and persists the choice; `useTheme()` supplies concrete colours to SVG/inline/Moti call sites; the static `tokens`/`toneColor` exports are deleted so the compiler finds every migration site.

**Spec:** `docs/superpowers/specs/2026-08-28-mobile-web-theme-m3-design.md` (palette value table lives there — transcribe it exactly). **Conventions:** the M1 plan's "Testing conventions" apply verbatim; three verification commands per task; branch `feat/mobile-app-m1`; stage by name.

---

### Task 1: Dual palette, CSS variables, ThemeProvider

**Files:** rewrite `src/theme/palette.js` (+`icu`/`light` per the spec table, incl. the new `accent` token), `tailwind.config.js` (colours → `var(--color-…)`, add `accent`), `src/theme/tokens.ts` (keep ONLY `type Tone`; delete `tokens`/`toneColor`); create `src/theme/ThemeContext.tsx` (`ThemeProvider`, `useTheme()` → `{key, palette, toneColor, setTheme}`, persisted under `homunculus.theme` via a small addition to `src/store/secureTokens.ts`, `vars()` applied on a root wrapper View), extend `__tests__/contrast.test.ts` (both palettes × all meaning-bearing pairs incl. `accent` on card), create `__tests__/theme.test.tsx` (defaults to icu; setTheme persists; RiskPill — once migrated in Task 2 — is asserted there instead; here assert palette values switch via a probe using useTheme). Expect compile breakage across the app after tokens.ts shrinks — that is Task 2's worklist; run only the theme+contrast test files here, NOT typecheck.

Commit: `feat(mobile): the cockpit's two palettes behind a theme provider`

### Task 2: Migrate every colour consumer to useTheme

**Files:** every module that imported `tokens`/`toneColor` (the compiler lists them): RiskPill, VitalSparkline, VitalTile, PatientCard, AlertCard, GuidelineDrawer, NotificationFeed, AlertToast(+Connected), Skeleton, SettingsPanel (Row/Chip — active chips use `accent`, not `safe`), ServerSection, `app/(tabs)/_layout.tsx` (tab bar: active tint `accent`), `app/_layout.tsx` (mount ThemeProvider outermost inside GestureHandlerRootView; StatusBar `style` from theme key; root background from palette), `app/patient/[id].tsx` if needed. BlurView `tint` from theme. RiskPill's hsl→hsla tint helper becomes hex-aware (palette is hex now — `${color}1A` IS valid for hex; invert the old comment honestly). Zero behavioural changes; every test stays green (assertions are on text/labels, not colours — where a test asserted a colour value, update it consciously and say so).

Verification: full `npm test` + `npm run typecheck` + export.
Commit: `feat(mobile): every surface reads the active theme`

### Task 3: Theme picker in Settings + i18n

**Files:** `src/i18n/tr.ts` (+`theme.title` "Tema", `theme.icu` "Gece / Nöbet", `theme.light` "Gündüz Klinik"), `src/ui/SettingsPanel.tsx` or the settings screen (a theme Row with two Chips above the server section, wired to `useTheme().setTheme`), tests: chip press calls setTheme; charter scan stays green.

Commit: `feat(mobile): night and day, switchable where the clinician stands`

### Task 4: Documents cannot disagree + final verification

**Files:** `.agents/skills/homunculus-mobile-dev/SKILL.md` (palette section → point at the M3 spec's table, note the M1 HSLs are superseded), M1 spec §7 (one superseded-by note), `homunculus-mobile/README.md` (theme paragraph). Final: all three commands + engine pytest + a whole-M3 review (contrast both themes recomputed, no stray obsidian/crimson literals anywhere: grep for `346, 84%`, `hsl(222`, `hsl(142`).

Commit: `docs(mobile): the palette has one home — the M3 spec`

---

## Definition of done

`npm test` green (all suites, contrast over both palettes), `npm run typecheck` zero, `npx expo export --platform web` exit 0; no `hsl(` literal outside git history; the phone shows slate+teal night by default and switches to day from Settings.
