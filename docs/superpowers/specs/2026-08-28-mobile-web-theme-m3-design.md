# Mobile M3 — one family: the phone wears the cockpit's palette

**Date:** 2026-08-28
**Status:** design approved (user direction, 2026-08-28: drop the near-black look; the mobile app
adopts the web cockpit's design language and palettes, night mode default, day mode switchable in
Settings)

## Context

The dashboard's clinical cockpit (`dashboard/src/clinicalTheme.js`) established the product's
visual identity: slate surfaces, teal brand (`#0891b2`), an emerald/amber/red severity scale, and
four runtime-selectable skins with "Gece / Nöbet" (dark slate) as the default. The mobile app
shipped M1/M2 on the blueprint's obsidian-plus-crimson palette instead — on a phone it reads as
"the black screen", visually unrelated to the web. The user's call: one family. This supersedes
the M1 spec's "obsidian dark only" decision and the project skill's exact HSL values.

## Decisions

| Question | Decision |
| --- | --- |
| Palette source | The cockpit's `icu` and `light` skins, translated to concrete colours. |
| Default | Night ("Gece / Nöbet", slate) — the web's own default. Day switchable in Settings. |
| Mechanism | NativeWind v4 CSS variables: Tailwind colour tokens point at `var(--color-…)`; a `ThemeProvider` swaps the variable set at the root. **Class names do not change** — `bg-background`, `bg-card`, `border-clinical-border`, `text-clinical-*` all survive, so no screen markup is touched for classes. |
| Inline/SVG colours | `useTheme()` returns the active concrete palette + a theme-aware `toneColor`. Components that pass colours to SVG strokes, shadows, Moti styles or the tab bar migrate from the static `tokens` import to the hook. Pure domain modules stay colour-free (they already are — they speak `Tone`). |
| Persistence | Theme choice stored under `homunculus.theme` (same store module as the server URL). |
| Contrast | The AA contrast test extends to BOTH palettes × every meaning-bearing pair. Text-severity hues use darkened/lightened variants where the raw web chip colours fail as text (e.g. red-400 on dark cards, amber-700/red-600 on white). Arithmetic decides, not taste. |

## The two palettes (concrete values, translated from the cockpit's Tailwind classes)

| Token | Night (`icu`, default) | Day (`light`) |
| --- | --- | --- |
| `background` | `#020617` (slate-950) | `#f1f5f9` (slate-100) |
| `card` | `#0f172a` (slate-900) | `#ffffff` |
| `foreground` | `#f1f5f9` (slate-100) | `#0f172a` (slate-900) |
| `clinical.border` | `#1e293b` (slate-800) | `#e2e8f0` (slate-200) |
| `clinical.safe` | `#10b981` (emerald-500) | `#047857` (emerald-700) |
| `clinical.warning` | `#f59e0b` (amber-500) | `#b45309` (amber-700) |
| `clinical.critical` | `#f87171` (red-400 — red-500 measures 4.3:1 on slate-900, under AA) | `#dc2626` (red-600) |
| `clinical.stale` | `#94a3b8` (slate-400) | `#64748b` (slate-500) |
| `accent` (new) | `#0891b2` (brand teal) | `#0891b2` |

The accent token is new: the tab bar's active tint, chips' active state and other "brand" moments
move from `clinical.safe` (green — a severity, wrongly borrowed for branding in M1) to the teal the
web uses. Severity colours go back to meaning severity only.

## What changes, what does not

- `src/theme/palette.js` → `{ icu: {...}, light: {...} }`, same shape each; still the single source.
- `tailwind.config.js` colours → `var(--color-…)` references; a shared `themeVars(palette)` helper
  builds the NativeWind `vars()` object.
- New `src/theme/ThemeContext.tsx`: `ThemeProvider` (root-mounted, persists the choice, defaults
  `icu`), `useTheme()` → `{ key, palette, toneColor, setTheme }`.
- `src/theme/tokens.ts` keeps exporting the type `Tone`; the static `tokens`/`toneColor` exports are
  REMOVED so no component can silently keep a single-theme colour. Every consumer migrates to
  `useTheme()` (compiler enforces the sweep).
- Components migrating: RiskPill, VitalSparkline, VitalTile, PatientCard (glow/shadow), AlertCard,
  GuidelineDrawer surfaces, NotificationFeed, AlertToast(+Connected), Skeleton, SettingsPanel
  chips, ServerSection, tab layout, root layout, StatusBar style (light-content on night, dark on
  day), BlurView tint by theme.
- Settings gains a theme Row ("Gece / Nöbet" / "Gündüz Klinik") above the server section.
- The demo banner, charter tests, i18n mechanics, transports, store: untouched.
- The project skill's palette section and the M1 spec's design-system table are updated to point
  here — three documents must not disagree.

## Testing

Contrast: both palettes, arithmetically, in the existing `contrast.test.ts` (extended). Theme
switch: a provider test proves the default is night, the setter persists, and a component (RiskPill)
renders the day colour after switching. All 226+ existing tests stay green — class names and
component behaviour are unchanged by design.

## Out of scope

Retiring the dashboard's old `?mode=replay` board (dashboard-side, owned by the live-board work);
the cockpit's `contrast` and `wall` skins on mobile; per-theme illustrations.
