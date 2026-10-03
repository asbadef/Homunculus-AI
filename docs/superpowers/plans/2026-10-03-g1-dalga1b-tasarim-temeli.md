# Group 1 · Wave 1B — design foundation for the new live UI (G1-05, G1-06) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation the new live shell (G1-07) and the Group-1 screens will stand on, under `dashboard/src/live/`: the prototype's Gece/Gün design tokens as CSS variables that Tailwind classes point at (contrast-tested), self-hosted fonts, the prototype's icon set, the base components, the risk/severity mapping, a four-language keyed i18n framework with Azerbaijani as the default — and a design gallery at `?tasarim=1` for comparing the result with the prototype now. The old `ClinicalDemo` is not touched.

**Architecture:** One stylesheet (`live/theme/tokens.css`) holds every colour of both themes plus the text-size factor and the font stacks; `tailwind.config.js` turns each variable into a class from a name list in `live/theme/tokens.js`. Two small React contexts hold the display state — `ThemeProvider` (theme, text size) and `I18nProvider` (language) — persisted in `localStorage` through a try/catch wrapper and written onto `<html>`. Base components are small files in `live/ui/` styled only with token classes; strings come only from keyed dictionaries (`live/i18n/strings/<namespace>.js`). A lazily loaded gallery page renders all of it.

**Tech Stack:** React 18.3, Vite 5.4, Tailwind 3.4.19, Vitest 2.1.9 + Testing Library (React 16, jest-dom 6) on jsdom 24; `@fontsource-variable/figtree` (present) plus two new packages, `@fontsource-variable/space-grotesk` and `@fontsource-variable/jetbrains-mono` 5.3.0.

**Design source:** the clickable prototype, `origin/tasarim/prototip` (`8bebc67`) `tasarim-taslaklari/app/` — this session read it at `C:/Users/User/AppData/Local/Temp/claude/c--Users-User-Desktop-Project-Homunculus-AI/81e7acdd-607b-4711-95c1-cb8303209f3e/scratchpad/tasarim/tasarim-taslaklari/app/` (`app.css` tokens and component rules, `ek.css`, `core.js` `H.icon` / `H.t` / `H.state`, `ceviri-sozluk.js`); screenshots `tasarim-taslaklari/anasayfa/gorsel/*-{TR,AZ,RU,EN}-{gece,gun}.webp`. **Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — G1-05, G1-06; D1 (the new shell lives beside `ClinicalDemo.jsx` until G1-16), D2 (Azerbaijani default, TR/RU/EN selectable, choice kept in the browser); "Grup 1 kabul ölçütleri" (G1-09 risk mapping, built here as a pure function); "Main'den gelen…" (`simulationGating` language line → G1-06); "Dalga 0'dan açık kalanlar" (NEWS2 partial hint Turkish-only → G1-06).

**Size:** 21 tasks (0–20). 309 new tests (306 in 20 new files under `src/live/`, 3 in `routing.test.js`): the dashboard suite goes from 43 files / 810 tests to 63 files / 1119 tests. Roughly 10–12 hours of subagent execution including review (roadmap: 5 + 3 points ≈ 1.5 days). Every code block below was run while writing this plan, in a scratch copy of `dashboard/` at `fd15f04`: the full `src/live/` suite (306 tests), `routing.test.js` and `npx vite build` passed, and the gallery was looked at in headless Chrome in both themes, in Azerbaijani and Russian, at 1440 px and 390 px.

**Not in this plan:** the shell itself — sidebar, top bar, routing the live mode into it (G1-07); any screen (G1-08…G1-14); removing the demo (G1-16).

---

## Decisions

1. **Tokens are CSS custom properties; Tailwind classes point at them.** `src/live/theme/tokens.css` is the only place a colour value lives: both themes (`:root, [data-theme="gece"]` — Gece is the default — and `[data-theme="gun"], :root[data-theme="gun"]`), the text-size factor `--fs` (`[data-size="buyuk"]` → 1.12) and the three font stacks. Names are the prototype's (`--card`, `--priSoft`, `--v-hr`), so a prototype rule reading `var(--card)` means the same thing here. `src/live/theme/tokens.js` lists the colour names; `tailwind.config.js` imports it and adds one colour per variable, kebab-cased (`--critInk` → `text-crit-ink`), the prototype's type sizes as `text-10 … text-23` (that many px × `--fs`), `rounded-ctl/box/dlg` (10/14/18 px), `shadow-pop` and `font-text/display/data`. Components never write a hex value or a Tailwind palette colour. A variable cannot take Tailwind's opacity modifier (`bg-pri/20` is never generated): tints are tokens of their own or a static `color-mix()` arbitrary value. The old app's `brand`, `sev` and `sans` stay exactly as they are, and no new key shadows a Tailwind default the old app uses (`mono`, `xs`, `sm`…) — tested.
2. **Severity has a fill and an ink.** `--crit --high --mid --low --ok` paint stripes, bars, dots and solid buttons (≥ 3:1 against a card); the new `--critInk … --okInk` are for text (≥ 4.5:1, also on the pill's own 14 % tint); `--oncrit` / `--onmid` name the text-on-fill colours the prototype hard-coded (`#fff`, `#1b1400`). In Gün every prototype severity pill failed 4.5:1; this split is the smallest change that keeps the fills' look (see "Contrast" below). The engine's `risk` → tone + label key is a pure function, `ui/riskStyle.js`: moderate amber, none/info neutral, nothing ever green, `measured: false` → "not measured", an unknown value shown with its raw text.
3. **Folder layout.** `dashboard/src/live/` — `prefs.js` (browser storage); `theme/` (tokens, fonts, `ThemeProvider`); `i18n/` (`langs`, `translate`, `catalog`, `strings/<namespace>.js`, `I18nProvider`); `ui/` (`Icon` and one small file per base component, `index.js` barrel); `gallery/` (`DesignGallery`). G1-07 adds `shell/` beside them. Nothing under `live/` imports the old app; the old app reaches `live/` only through `main.jsx`'s lazy gallery route.
4. **Icons are data.** `ui/icons.js` holds the prototype's `H.icon` set as `[element, attributes]` pairs — converted mechanically from `core.js`'s `P` (all 53 names) plus the top bar's `fullscreen` and `keyboard` (`shell.js` `FS_IC`, `KB_IC`). `<Icon name size label>` renders them with `createElement` (no `dangerouslySetInnerHTML`), stroked in `currentColor`, `aria-hidden` unless it is given a `label`. `lucide-react` stays, for the old app only.
5. **i18n API.** `useI18n()` → `{ t, lang, setLang, langs }`. `t("namespace.key", vars)` replaces `{name}` placeholders; fallback: the language → Turkish (the source language) → the key itself, each fallback reported once per key with `console.warn` in development. Codes `az | tr | ru | en` (BCP 47, = `<html lang>`); default `az` (roadmap D2); no browser-locale detection. Dictionaries: one module per namespace (`strings/common.js`, `risk.js`, `prefs.js`, `news2.js`, `gallery.js`), each `{ tr, az, ru, en }` with the same keys — a screen adds a file and one import line instead of editing a shared dictionary (Wave 3 runs three branches in parallel). Only keys are translated; variables (a patient's name, a bed, an engine value) are inserted verbatim and never looked up. The prototype's DOM-rewriting `ceviri.js` layer is not ported.
6. **Theme, size and language state.** Two contexts: `ThemeProvider` (theme `gece | gun`, size `normal | buyuk`) and `I18nProvider` (lang). Each reads its value once from `localStorage` — keys `hmc.theme`, `hmc.size`, `hmc.lang`, the prototype's names; a stored value outside the allowed list (such as the prototype's `"AZ"`) is ignored — through `live/prefs.js`, which wraps every read and write in try/catch: a private window, blocked or full storage renders the defaults and switching still works for that page. The providers write `data-theme`, `data-size` and `lang` on `<html>` in a layout effect (the first paint is already right), because the modal and the toasts render in a portal under `<body>`. They do not share the old app's keys (`homunculus-clang`), so an old Turkish choice on a pilot PC does not override D2. Without a provider the hooks answer the defaults (Gece, normal, Azerbaijani).
7. **"Otomatik" theme: deferred.** The web prototype's settings offer only Gece and Gün ("Gün ışığı"); the 20:00–08:00 automatic switch exists only in the mobile prototype (`mobil.js` `autoTheme`). `setTheme("auto")` is ignored (tested). It can come later as a third value without touching a token.
8. **Fonts are self-hosted, and the stacks replace the prototype's patch.** Figtree, Space Grotesk and JetBrains Mono come from `@fontsource-variable/*` packages (Vite bundles the woff2 files; the app serves them itself — prototype decision #125), imported by `theme/assets.js`, which only the gallery (and later the shell) loads. Measured from the font files' `cmap` (`fonts.test.js`): Figtree draws no `ə`/`Ə` and no Cyrillic, Space Grotesk no Cyrillic, JetBrains Mono both. The prototype aliased the Cyrillic range to local system fonts with `@font-face` rules (`app.css` 284–296) because its `font: 600 13px Figtree` shorthands named no fallback and missing letters fell to the browser's serif (its first attempt also broke every bold Latin text through a weight-range mismatch). Here every stack names `"Segoe UI", Roboto, Arial` before `sans-serif`, which does the same per character and picks the matching weight — and also covers `ə`, which the prototype's patch did not. A fallback letter inside a Figtree word looks slightly different: the accepted cost of keeping these faces (prototype decision #303).
9. **Gallery route.** `?tasarim=1`, checked after `?board=1` in `chooseMode` (so `?live=1` and every existing mode keep priority), loaded with `React.lazy` (its own chunk; its fonts and CSS load only there), no demo banner, not linked from the app, not the PWA start URL. It shows no data and calls no API.

---

## Contrast: where the prototype palette fails, and what changed

Measured with WCAG 2 relative luminance; translucent tokens composited over the surface they sit on. Every text pair is held to 4.5:1 (the pills and badges that carry severity are 10–12 px); focus outline and severity fills to 3:1. `tokens.test.js` enforces all of it.

| Theme | Pair (where it renders) | Prototype | Change | Now |
|---|---|---|---|---|
| Gece | white on `--crit` (danger button: "Eskale") | 3.76 | `--crit` `#ef4444` → `#dc2626` | 4.83 |
| Gece | crit text on its 14 % tint (critical pill) / on `--critSoft` (critical tag) | 4.05 / 4.14 | new `--critInk` `#f87171` | 5.77 / 5.63 (on card2: 5.26 / 5.10) |
| Gün | pill text on its 14 % tint over a card: crit / high / mid / low / ok | 3.88 / 3.00 / 2.56 / 3.43 / 2.82 | new inks `#b91c1c` / `#9a3412` / `#854d0e` / `#075985` / `#166534` | 5.20 / 6.15 / 5.93 / 6.33 / 6.10 |
| Gün | severity as text on a card (alarm timer, bed number): high / mid / low / ok | 3.56 / 2.94 / 4.10 / 3.30 | the same inks | 7.31 / 6.85 / 7.56 / 7.13 |
| Gün | the same on the page background: crit / high / mid / low / ok | 4.23 / 3.12 / 2.57 / 3.59 / 2.89 | the same inks | ≥ 5.67 |
| Gün | crit text on `--critSoft` (critical tag) | 4.23 | `--critInk` | 5.66 |
| Gün | `--mid` stripe against a card (UI, 3:1) | 2.94 | `--mid` `#ca8a04` → `#c28406` | 3.18 |
| Gün | a neutral pill drawn the `.sv` way (mute on a mute tint) | 4.53 card / 4.14 card2 | neutral pills use the `.pill` look (mute on card2) | 4.94 |
| both | `--line2` input border against card / card2 (UI, 3:1) | Gece 1.63 / 1.47 · Gün 1.51 / 1.37 | **not changed** — a heavier border everywhere is a design call; open question for the user. Focused inputs turn `--pri` (≥ 4.6:1). | — |
| Gün | vital colours on `--monbg` (the dark monitor panel) | 1.15–3.82 | not ported: the monitor is Group 2, which must fix this when it ports `--monbg` | — |

Passing, but close to the bar (Gün): `attInk` on `att` 4.54, info note `pri` on `priSoft` 4.65, `pri` on the page 4.69, `mute` on the page 4.77. Everything else in Gece and Gün clears with margin.

---

## Left out on purpose (YAGNI)

- **Tokens not ported:** `--monbg`, `--band-al`, `--band-n`, `--grid` (monitor and charts — Group 2), `--body-fill/-line/-detail/-sel` (body map — Group 3).
- **Shell pieces → G1-07:** `.rail/.ri`, `.fly`, `.menu`, `.top`, `.chip`, `.search`, `.shift/.today`, `.ib` icon button, `.av`, `.ncenter`, `.toTop`, the page header `.ph`, section heading `.sec`, grids `.g2/.g3/.g4`, the language flags (`H.flag`).
- **Screen pieces → their screen:** `.opts` touch multi-choice and the checkbox (user form — G1-12); `.att/.ac` attention cards, `.beds/.bed`, `.vit`, `.flags`, `.spark` (G1-09); `.vitalBar`, `.mon` (G1-11 / Group 2); login and lock-screen styles (G1-08); `.step`, `.formbar`, `.scoreBadge`, `.bodyWrap` (Group 3 forms); the side drawer `.adm-drw` (only the Group 4 Y1–Y7 admin pages use it).
- **Not needed at all:** `.tag.ok` (the users table's "AKTİF" is an `.sv` with `--ok`, which `StatusPill tone="ok"` covers); clickable table rows `tr.row` (a mouse-only affordance — rows get a button or link instead); `Textarea` (no Group-1 screen has one).
- **Behaviour deferred:** the automatic theme (Decision 7); the prototype's Azerbaijani ordinal suffixes (`azSira`) and any plural rules — the first screen that prints a counted noun adds them.

**Strings that are not from the prototype's dictionary** (written for this plan; AZ/RU/EN need a native speaker's review before the pilot): `risk.none`, `risk.unmeasured`, `risk.unknown`; `news2.*` (except `noEngine`'s first sentence, which is `clinicalI18n`'s `pr6.news2NoEngine`); in `gallery.*`, everything except `seen`, `snooze`, `escalate`, `edit`, `open`, `criticalOnly`, `myPatients`, `users`, `roles`, `username`, `status`, `lastLogin`, `mfaRequired`, `allUnits`, `on`, `active`, `warning`.

---

## Ground rules for every task

- Work only in the worktree `/c/tmp/homunculus-g1` (branch `feat/canli-tasarim`). Never touch `/c/Users/User/Desktop/Project/Homunculus AI`, the user's main checkout. Its uncommitted edits to `main.jsx`, `routing.test.js` and `vite.config.js` (the `?infinityTest=1` view) are why Task 19 changes `main.jsx` in three small, separate places away from where those edits sit (after the `board` check, after the `replay` branch, above the `#/demo` line) and appends to `routing.test.js` instead of editing its top; the user's `main.jsx` patch was checked to apply cleanly on top of Task 19's `main.jsx`.
- Shell: Git Bash. Dashboard commands run from `/c/tmp/homunculus-g1/dashboard`.
- Filter tests by **folder with a trailing slash**: `npx vitest run src/live/`. Vitest filters by substring, so `src/live` alone also runs `src/liveStore.test.js`, `src/liveAuth.test.js` and the other old `live*` files.
- The gate at the end of every task is the whole suite plus a production build:

  ```bash
  cd /c/tmp/homunculus-g1/dashboard
  npx vitest run 2>&1 | tail -5
  npx vite build 2>&1 | grep -E "built in|error"
  ```
  The build writes `dashboard/dist/` (git-ignored). Its output always includes the warning `(!) Some chunks are larger than 500 kB` — the old workspace's main chunk, present before this plan; not a failure.
- Wave 1A (LDAP backend) may run in the same worktree at the same time. Stage exactly the paths a task lists — never `git add -A` or `git add .`.
- No hex colour and no Tailwind palette colour (`slate-*`, `red-*`…) inside `src/live/` components: token classes only. Class names are written out whole (`text-crit-ink`), never assembled (`text-${tone}-ink`): Tailwind generates only class names it can see in the source.
- No user-visible text inside a component: it comes from `t()` or from the caller. Source files are UTF-8; the AZ/RU strings must survive as typed (`ə`, `ı`, `İ`, Cyrillic).
- Commit after each task. Every commit message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```

---

## File map

**Create** (all under `dashboard/src/live/`)

| File | Responsibility |
|---|---|
| `prefs.js` | `readPref(name, allowed, fallback)`, `writePref(name, value)`: `hmc.*` in `localStorage`, every access in try/catch. |
| `theme/tokens.css` | All colour tokens for Gece and Gün, `--fs`, the three font stacks. |
| `theme/tokens.js` | `COLOR_TOKENS`, `kebab`, `tailwindColors()`, `TYPE_SIZES`, `tailwindFontSizes()` — read by `tailwind.config.js`. |
| `theme/tokensCss.testutil.js` | Test-only reader of `tokens.css` rules (`rule`, `THEMES`). |
| `theme/assets.js` | Side-effect module: the three font packages and `tokens.css`. |
| `theme/ThemeProvider.jsx` | `ThemeProvider`, `useTheme`, `THEMES`, `SIZES`. |
| `i18n/langs.js` | `LANGS`, `LANG_CODES`, `DEFAULT_LANG` (`az`), `SOURCE_LANG` (`tr`). |
| `i18n/translate.js` | Pure `createTranslator(lang, dictionaries, onMissing)`, `interpolate`. |
| `i18n/catalog.js` | `NAMESPACES`, `buildDictionaries`, `DICTIONARIES` (flattened `ns.key`). |
| `i18n/strings/{common,risk,prefs,news2,gallery}.js` | One namespace each, `{ tr, az, ru, en }`. |
| `i18n/I18nProvider.jsx` | `I18nProvider`, `useI18n`. |
| `ui/icons.js`, `ui/Icon.jsx` | The prototype's icon set as data; `<Icon>`. |
| `ui/focus.js` | `FOCUS_RING` class string. |
| `ui/Button.jsx` | `.btn` (default/primary/danger/ghost × sm/md/lg). |
| `ui/Box.jsx`, `ui/Note.jsx`, `ui/Empty.jsx`, `ui/KV.jsx` | `.box/.card`, `.note(.i)`, `.empty`, `.kv`. |
| `ui/Tag.jsx` | `Tag` (`.tag`, `.w`, `.c`), `Pill` (`.pill`), `StatusPill` (`.sv`), `STATUS_TONES`. |
| `ui/riskStyle.js`, `ui/RiskPill.jsx` | Engine risk → tone/icon/label key; the pill. |
| `ui/Seg.jsx`, `ui/Tabs.jsx` | `.seg` (toggle-button group); `.tabs` (ARIA tab list) + `TabPanel`. |
| `ui/Field.jsx` | `Field` (`.fld`), `Input`, `Select`. |
| `ui/Table.jsx` | `table.t` in its scroller. |
| `ui/Modal.jsx` | Dialog with focus trap, Escape, focus return, `busy`. |
| `ui/Toast.jsx` | `ToastProvider`, `useToast`, `TOAST_MS`. |
| `ui/index.js` | Barrel. |
| `gallery/DesignGallery.jsx` | The `?tasarim=1` review page (default export, lazy-loaded). |
| Tests | `prefs.test.js`, `theme/{tokens,tailwind,fonts}.test.js`, `theme/ThemeProvider.test.jsx`, `i18n/{translate,strings}.test.js`, `i18n/I18nProvider.test.jsx`, `ui/{Icon,Button,surfaces,Tag,RiskPill,choice,Field,Table,Modal,Toast}.test.jsx`, `ui/riskStyle.test.js`, `gallery/DesignGallery.test.jsx`. |

**Modify** (line numbers at `fd15f04`)

| File | Change |
|---|---|
| `dashboard/tailwind.config.js` (whole file, 14 lines) | Live tokens, type sizes, radii, shadow, faces — old keys kept (Task 3). |
| `dashboard/package.json`, `dashboard/package-lock.json` | Two `@fontsource-variable` packages (Task 4). |
| `dashboard/src/i18n.rbac.test.js:402-405` | Comment only: the D2 cases now live in `src/live/i18n/I18nProvider.test.jsx` (Task 7). |
| `dashboard/src/main.jsx:28`, `:48`, `:54` | `?tasarim=1` mode, its lazy route, the `React.lazy` line (Task 19). |
| `dashboard/src/routing.test.js` (end) | Three gallery-route tests (Task 19). |
| `docs/homunculus-rehber-TR.md:305` (after) | Glossary: design token, contrast ratio, design gallery (Task 20). |
| `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md:81-82,217,239` | G1-05/G1-06 status and the two G1-06 items (Task 20). |

Read and left alone: `ClinicalDemo.jsx`, `ui.jsx`, `clinicalTheme.js`, `theme.js`, `risk.js`, `i18n.js`, `clinicalI18n.js`, `index.css`, `index.html`, `vite.config.js` (its `test` block already gives jsdom, globals and `setupTests.js`; its PWA `start_url` stays `/?demo=1` until G1-16).

---

### Task 0: Baseline and plan commit

**Files:** none changed (this plan file is committed).

- [ ] **Step 1: Confirm the worktree, branch and head**

```bash
cd /c/tmp/homunculus-g1
git status --short --branch | head -3
git log --oneline -1
```
Expected: `## feat/canli-tasarim`; untracked at most this plan (and Wave 1A's files if it runs alongside); head `fd15f04 docs(plan): Wave 0 closed — …` or a later commit.

- [ ] **Step 2: Record the dashboard baseline**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  43 passed (43)`, `Tests  810 passed (810)`, then `✓ built in …`. If the counts differ (a later commit on the branch), use the real numbers as the base: every later "expected" count in this plan is the base plus the tests this plan adds.

- [ ] **Step 3: Commit the plan**

```bash
cd /c/tmp/homunculus-g1
git add docs/superpowers/plans/2026-10-03-g1-dalga1b-tasarim-temeli.md
git commit -m "docs(plan): G1 Wave 1B — design foundation for the live UI (G1-05, G1-06)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Preferences that survive a browser refusing storage

**Files:**
- Create: `dashboard/src/live/prefs.js`
- Test: `dashboard/src/live/prefs.test.js`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/prefs.test.js`:

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { readPref, writePref } from "./prefs.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("live UI preferences", () => {
  it("reads back what was written, under the hmc. prefix", () => {
    writePref("theme", "gun");
    expect(localStorage.getItem("hmc.theme")).toBe("gun");
    expect(readPref("theme", ["gece", "gun"], "gece")).toBe("gun");
  });

  it("falls back to the default when nothing is stored", () => {
    expect(readPref("theme", ["gece", "gun"], "gece")).toBe("gece");
  });

  it("ignores a stored value it does not recognise", () => {
    localStorage.setItem("hmc.lang", "TR"); // the prototype's spelling, not ours
    expect(readPref("lang", ["az", "tr", "ru", "en"], "az")).toBe("az");
    localStorage.setItem("hmc.lang", "de");
    expect(readPref("lang", ["az", "tr", "ru", "en"], "az")).toBe("az");
  });

  it("falls back to the default when storage refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readPref("theme", ["gece", "gun"], "gece")).toBe("gece");
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writePref("theme", "gun")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/prefs.test.js
```
Expected: FAIL — `Failed to resolve import "./prefs.js" from "src/live/prefs.test.js". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/prefs.js`:

```js
// src/live/prefs.js — the live UI's per-browser preferences: language, theme, text size.
//
// A preference is a convenience, never state the system depends on. A private window, a browser
// with site data blocked or a full quota must still render the UI — on the default. So every
// read and write is wrapped, and a stored value outside the allowed list is ignored rather than
// trusted (an older build, or the prototype, which spells languages "AZ"/"TR", may have left one).
const PREFIX = "hmc.";

export function readPref(name, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(PREFIX + name);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name, value) {
  try {
    window.localStorage.setItem(PREFIX + name, value);
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/prefs.test.js
```
Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  44 passed (44)`, `Tests  815 passed (815)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/prefs.js dashboard/src/live/prefs.test.js
git commit -m "feat(dashboard): live UI preferences survive a browser that refuses storage

hmc.lang / hmc.theme / hmc.size, every read and write wrapped; a stored
value outside the allowed list (the prototype's \"AZ\") is ignored.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Design tokens for Gece and Gün, held to WCAG AA

**Files:**
- Create: `dashboard/src/live/theme/tokens.css`, `dashboard/src/live/theme/tokens.js`
- Create (test helper): `dashboard/src/live/theme/tokensCss.testutil.js`
- Test: `dashboard/src/live/theme/tokens.test.js`

- [ ] **Step 1: Write the test helper and the failing test.**

`dashboard/src/live/theme/tokensCss.testutil.js` (a `*.testutil.js` file is not picked up as a test — Vitest only runs `*.test.*` / `*.spec.*` — and nothing in the app imports it):

```js
// src/live/theme/tokensCss.testutil.js — reads tokens.css as text, for the tests (never shipped).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node:path, not new URL(): under jsdom the global URL is jsdom's, which fileURLToPath refuses.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.trim().replace(/\s+/g, " "),
  props: Object.fromEntries(
    [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  ),
}));

/** The custom properties of the rule whose selector list is exactly `selector`, by name without "--". */
export function rule(selector) {
  const found = RULES.find((r) => r.selector === selector);
  if (!found) throw new Error(`tokens.css has no rule "${selector}"`);
  return found.props;
}

export const THEMES = {
  gece: rule(':root, [data-theme="gece"]'),
  gun: rule('[data-theme="gun"], :root[data-theme="gun"]'),
};
```

`dashboard/src/live/theme/tokens.test.js`:

```js
// WCAG AA for the live UI's palette, enforced as arithmetic rather than a review note (the mobile
// app's precedent: homunculus-mobile/__tests__/contrast.test.ts). Each pair below is one that
// actually renders as text — or, at 3:1, a focus outline or severity stripe — and says where.
// Body text needs 4.5:1. Every text pair is held to 4.5:1, large or not: the pills and badges
// that carry severity are 10–12 px.
//
// Not measured on purpose: --line/--line2 (borders; the input border is 1.5:1 in both themes —
// recorded in the plan as an open design question), --attLine, the shadows.
import { describe, it, expect } from "vitest";
import { COLOR_TOKENS } from "./tokens.js";
import { rule, THEMES } from "./tokensCss.testutil.js";

function parse(value) {
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (m) return { rgb: [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255), a: 1 };
  m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (m) return { rgb: [m[1], m[2], m[3]].map((n) => Number(n) / 255), a: Number(m[4]) };
  throw new Error(`not a colour this test reads: ${value}`);
}

/** An opaque token. A translucent one must say what it sits on (over/tint). */
function solid(theme, name) {
  const c = parse(THEMES[theme][name]);
  if (c.a !== 1) throw new Error(`--${name} is translucent in ${theme}: measure it over a surface`);
  return c.rgb;
}

/** A token as it renders over an opaque surface token (alpha compositing). */
function over(theme, name, ground) {
  const c = parse(THEMES[theme][name]);
  const g = solid(theme, ground);
  return c.rgb.map((v, i) => v * c.a + g[i] * (1 - c.a));
}

/** color-mix(in srgb, var(--name) <share>, transparent) — the pill tint — over a surface. */
function tint(theme, name, share, ground) {
  const c = solid(theme, name);
  const g = solid(theme, ground);
  return c.map((v, i) => v * share + g[i] * (1 - share));
}

const luminance = (rgb) => {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const BODY = 4.5;
const UI = 3;
const SURFACES = ["page", "app", "rail", "card", "card2"];
const SEVERITY = ["crit", "high", "mid", "low", "ok"];

describe.each(["gece", "gun"])("%s theme: contrast", (theme) => {
  const s = (name) => solid(theme, name);

  it.each(SURFACES)("ink and mute text clear 4.5:1 on %s", (bg) => {
    expect(ratio(s("ink"), s(bg))).toBeGreaterThanOrEqual(BODY);
    expect(ratio(s("mute"), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["page", "app", "card", "card2"])("primary text (links, info notes) clears 4.5:1 on %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it("info note: pri text on priSoft over a card clears 4.5:1", () => {
    expect(ratio(s("pri"), over(theme, "priSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each([
    ["onpri", "pri", "primary button, chosen segment"],
    ["oncrit", "crit", "danger button"],
    ["onmid", "mid", "tab count badge"],
  ])("%s on %s (%s) clears 4.5:1", (fg, bg) => {
    expect(ratio(s(fg), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["card", "page"])("warning note and tag: attInk on att over %s clears 4.5:1", (ground) => {
    expect(ratio(s("attInk"), over(theme, "att", ground))).toBeGreaterThanOrEqual(BODY);
  });

  it("critical tag: critInk on critSoft over a card clears 4.5:1", () => {
    expect(ratio(s("critInk"), over(theme, "critSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(SEVERITY.flatMap((sev) => ["page", "app", "card", "card2"].map((bg) => [sev, bg])))(
    "%s ink (timers, bed numbers) clears 4.5:1 on %s",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), s(bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  it.each(SEVERITY.flatMap((sev) => ["card", "card2"].map((bg) => [sev, bg])))(
    "%s status pill: ink on its 14%% tint over %s clears 4.5:1",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), tint(theme, sev, 0.14, bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  it.each(["v-hr", "v-map", "v-spo", "v-rr", "v-t"])("vital %s clears 4.5:1 on a card", (v) => {
    expect(ratio(s(v), s("card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["page", "card", "card2"])("focus outline (pri) clears 3:1 against %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(UI);
  });

  it.each(SEVERITY)("%s fill (stripe, bar, dot) clears 3:1 against a card", (sev) => {
    expect(ratio(s(sev), s("card"))).toBeGreaterThanOrEqual(UI);
  });
});

describe("token registry", () => {
  it.each(["gece", "gun"])("%s declares every named colour, and only those", (theme) => {
    const declared = Object.keys(THEMES[theme]).filter((name) => name !== "shadow").sort();
    expect(declared).toEqual([...COLOR_TOKENS].sort());
    for (const name of COLOR_TOKENS) expect(() => parse(THEMES[theme][name]), name).not.toThrow();
  });

  it("text size: --fs is 1, and 1.12 under data-size=buyuk", () => {
    expect(rule(":root").fs).toBe("1");
    expect(rule('[data-size="buyuk"]').fs).toBe("1.12");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/tokens.test.js
```
Expected: FAIL — `Failed to resolve import "./tokens.js" from "src/live/theme/tokens.test.js". Does the file exist?`

- [ ] **Step 3: Write the tokens.** `dashboard/src/live/theme/tokens.css`:

```css
/* Homunculus live UI · design tokens.
 *
 * Source: the clickable prototype's app.css (:root / [data-theme]), origin/tasarim/prototip 8bebc67.
 * Names are the prototype's, so a prototype rule reading var(--card) means the same here.
 * Tailwind reaches every colour as a class: tailwind.config.js, src/live/theme/tokens.js.
 *
 * Where this file departs from the prototype (WCAG AA, measured by tokens.test.js):
 *   Gece  --crit      ef4444 -> dc2626   white danger-button text was 3.76:1
 *   Gece  --critInk   new, f87171        critical pill/tag text on its tint was 4.05:1
 *   Gun   --mid       ca8a04 -> c28406   amber stripe against a white card was 2.94:1 (UI needs 3:1)
 *   Gun   --*Ink      new, 700/800 steps every severity pill on its tint was 2.56-3.88:1
 *   --oncrit / --onmid  name the text colours the prototype hard-coded (#fff, #1b1400)
 * Fills (--crit --high --mid --low --ok) paint stripes, bars, dots and solid buttons; the *Ink
 * tokens are for text. Not ported yet (YAGNI): --monbg (Group 2 monitor; its Gun vital colours
 * fail on it), --band-*, --grid (charts), --body-* (body map).
 */

:root {
  --fs: 1;
  --font-text: "Figtree Variable", "Segoe UI", Roboto, Arial, system-ui, sans-serif;
  --font-display: "Space Grotesk Variable", "Segoe UI", Roboto, Arial, system-ui, sans-serif;
  --font-data: "JetBrains Mono Variable", Consolas, "Courier New", ui-monospace, monospace;
}

[data-size="buyuk"] {
  --fs: 1.12;
}

:root, [data-theme="gece"] {
  color-scheme: dark;
  --page: #07101f;
  --app: #07101f;
  --rail: #0a1628;
  --card: #0f1b2e;
  --card2: #15243b;
  --ink: #e8eef7;
  --mute: #8fa1ba;
  --line: #1c2c45;
  --line2: #2a3f60;
  --pri: #22b8d6;
  --onpri: #03141c;
  --priSoft: rgba(34, 184, 214, .13);
  --att: rgba(202, 138, 4, .07);
  --attLine: rgba(202, 138, 4, .38);
  --attIco: rgba(202, 138, 4, .16);
  --attInk: #f5c451;
  --crit: #dc2626;
  --critInk: #f87171;
  --critSoft: rgba(239, 68, 68, .12);
  --oncrit: #ffffff;
  --high: #f97316;
  --highInk: #f97316;
  --mid: #eab308;
  --midInk: #eab308;
  --onmid: #1b1400;
  --low: #38bdf8;
  --lowInk: #38bdf8;
  --ok: #22c55e;
  --okInk: #22c55e;
  --v-hr: #22e05a;
  --v-map: #ff5c5c;
  --v-spo: #ffe14a;
  --v-rr: #3fd8ff;
  --v-t: #e8eef7;
  --shadow: 0 12px 30px rgba(0, 0, 0, .45);
}

/* The second selector outranks index.css's ":root { color-scheme: dark }" whatever the order. */
[data-theme="gun"], :root[data-theme="gun"] {
  color-scheme: light;
  --page: #eef0f3;
  --app: #f4f6f9;
  --rail: #ffffff;
  --card: #ffffff;
  --card2: #f1f4f8;
  --ink: #152231;
  --mute: #5c6b7d;
  --line: #e1e6ee;
  --line2: #cbd3de;
  --pri: #0e7490;
  --onpri: #ffffff;
  --priSoft: #e0f2f7;
  --att: #fffaeb;
  --attLine: #f3dc9a;
  --attIco: #fdf0c8;
  --attInk: #9a6a00;
  --crit: #dc2626;
  --critInk: #b91c1c;
  --critSoft: #fdecec;
  --oncrit: #ffffff;
  --high: #ea580c;
  --highInk: #9a3412;
  --mid: #c28406;
  --midInk: #854d0e;
  --onmid: #1b1400;
  --low: #0284c7;
  --lowInk: #075985;
  --ok: #16a34a;
  --okInk: #166534;
  --v-hr: #15803d;
  --v-map: #dc2626;
  --v-spo: #a16207;
  --v-rr: #0369a1;
  --v-t: #152231;
  --shadow: 0 12px 30px rgba(20, 30, 50, .12);
}
```

`dashboard/src/live/theme/tokens.js`:

```js
// src/live/theme/tokens.js — the names of the live UI's design tokens.
//
// Values live in tokens.css (one block per theme). This file only names them, so that
// tailwind.config.js, the design gallery and the tests work from one list: a colour named here
// and missing from a theme — or declared in a theme and not named here — fails tokens.test.js.
//
// Tailwind class = the CSS variable's name in kebab case: --critInk -> text-crit-ink,
// --priSoft -> bg-pri-soft, --v-hr -> text-v-hr, --card2 -> bg-card2. A CSS variable cannot take
// Tailwind's opacity modifier (bg-pri/20 is never generated): tints are tokens of their own
// (priSoft, critSoft, att) or a color-mix() written in the component.
export const COLOR_TOKENS = [
  // surfaces, text, lines
  "page", "app", "rail", "card", "card2", "ink", "mute", "line", "line2",
  // primary action
  "pri", "onpri", "priSoft",
  // attention: amber notes and warning tags
  "att", "attLine", "attIco", "attInk",
  // severity: the fill paints stripes, bars, dots and solid buttons; *Ink is for text
  "crit", "critInk", "critSoft", "oncrit",
  "high", "highInk",
  "mid", "midInk", "onmid",
  "low", "lowInk",
  "ok", "okInk",
  // vital-sign channels
  "v-hr", "v-map", "v-spo", "v-rr", "v-t",
];

export const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function tailwindColors() {
  return Object.fromEntries(COLOR_TOKENS.map((name) => [kebab(name), `var(--${name})`]));
}

// The prototype's type sizes in px. Class text-<px> (text-13, text-14.5) is that size times --fs,
// so data-size="buyuk" enlarges every text at once. No line-height here: like the prototype,
// text inherits the page's 1.5; components whose prototype rule used the `font` shorthand (which
// resets it) set leading-[normal] themselves.
export const TYPE_SIZES = ["10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "17", "23"];

export function tailwindFontSizes() {
  return Object.fromEntries(TYPE_SIZES.map((px) => [px, `calc(${px}px * var(--fs))`]));
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/tokens.test.js
```
Expected: `Tests  121 passed (121)` (59 pairs per theme × 2, plus 3 registry tests). To see the test bite, set Gün `--mid` back to the prototype's `#ca8a04` and rerun: `gun theme: contrast > mid fill (stripe, bar, dot) clears 3:1 against a card` fails (2.94); restore `#c28406`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  45 passed (45)`, `Tests  936 passed (936)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/theme/tokens.css dashboard/src/live/theme/tokens.js dashboard/src/live/theme/tokensCss.testutil.js dashboard/src/live/theme/tokens.test.js
git commit -m "feat(dashboard): Gece/Gün design tokens from the prototype, held to WCAG AA

One stylesheet, the prototype's names. The contrast test measures every
pair that renders as text (4.5:1) and the focus outline and severity
fills (3:1). Changed from the prototype: Gece --crit dc2626 (white on the
danger button was 3.76), new --*Ink text colours (every Gün severity pill
was 2.56-3.88 on its tint; the Gece critical pill 4.05), Gün --mid c28406
(the amber stripe was 2.94 against a card).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tailwind classes that point at the tokens

**Files:**
- Modify: `dashboard/tailwind.config.js` (whole file)
- Test: `dashboard/src/live/theme/tailwind.test.js`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/theme/tailwind.test.js`:

```js
// tailwind.config.js must reach every live token by class, and must not change a class the old
// app (ClinicalDemo and friends, removed in G1-16) already uses.
import { describe, it, expect } from "vitest";
import defaultColors from "tailwindcss/colors";
import config from "../../../tailwind.config.js";
import { COLOR_TOKENS, TYPE_SIZES, kebab } from "./tokens.js";

const extend = config.theme.extend;

describe("tailwind.config.js and the live tokens", () => {
  it("maps every colour token to its CSS variable", () => {
    for (const name of COLOR_TOKENS) expect(extend.colors[kebab(name)], name).toBe(`var(--${name})`);
  });

  it("keeps the old app's brand, sev and sans exactly as they were", () => {
    expect(extend.colors.brand).toEqual({ DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" });
    expect(extend.colors.sev).toEqual({
      info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444",
    });
    expect(extend.fontFamily.sans).toEqual(["'Figtree Variable'", "system-ui", "sans-serif"]);
  });

  it("adds no key that would shadow a Tailwind default the old app relies on", () => {
    const palette = Object.keys(defaultColors);
    for (const key of Object.keys(extend.colors)) expect(palette, key).not.toContain(key);
    expect(extend.fontFamily).not.toHaveProperty("mono");
    for (const key of ["xs", "sm", "base", "lg", "xl", "2xl"]) expect(extend.fontSize).not.toHaveProperty(key);
  });

  it("makes every type size the prototype's pixel size times --fs", () => {
    expect(Object.keys(extend.fontSize).sort()).toEqual([...TYPE_SIZES].sort());
    for (const px of TYPE_SIZES) expect(extend.fontSize[px]).toBe(`calc(${px}px * var(--fs))`);
  });

  it("points the three faces at the token stacks", () => {
    expect(extend.fontFamily.text).toBe("var(--font-text)");
    expect(extend.fontFamily.display).toBe("var(--font-display)");
    expect(extend.fontFamily.data).toBe("var(--font-data)");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/tailwind.test.js
```
Expected: `Tests  4 failed | 1 passed (5)` — only "keeps the old app's brand, sev and sans exactly as they were" passes.

- [ ] **Step 3: Replace `dashboard/tailwind.config.js`** with:

```js
import { tailwindColors, tailwindFontSizes } from "./src/live/theme/tokens.js";

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" },
        sev: { info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444" },
        // The live UI (src/live): one class per CSS variable in src/live/theme/tokens.css.
        ...tailwindColors(),
      },
      fontFamily: {
        sans: ["'Figtree Variable'", "system-ui", "sans-serif"],
        // The live UI's three faces; the stacks themselves are in tokens.css.
        text: "var(--font-text)",
        display: "var(--font-display)",
        data: "var(--font-data)",
      },
      fontSize: tailwindFontSizes(),
      borderRadius: { ctl: "10px", box: "14px", dlg: "18px" },
      boxShadow: { pop: "var(--shadow)" },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/tailwind.test.js
```
Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  46 passed (46)`, `Tests  941 passed (941)`, `✓ built in …` (Tailwind loads the config, and with it `src/live/theme/tokens.js`, at build time; a syntax error there fails the build here).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/tailwind.config.js dashboard/src/live/theme/tailwind.test.js
git commit -m "feat(dashboard): Tailwind classes for the live tokens

One colour per CSS variable (--critInk -> text-crit-ink), the prototype's
type sizes times --fs (text-10 ... text-23), rounded-ctl/box/dlg,
shadow-pop, font-text/display/data. The old app's brand, sev and sans are
unchanged and no new key shadows a default it uses.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Self-hosted fonts, and what each one draws

**Files:**
- Modify: `dashboard/package.json`, `dashboard/package-lock.json` (via npm)
- Create: `dashboard/src/live/theme/assets.js`
- Test: `dashboard/src/live/theme/fonts.test.js`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/theme/fonts.test.js`:

```js
// Which characters each self-hosted face actually draws — read from the font files' cmap — and
// why the stacks in tokens.css end the way they do.
//
// The prototype measured it in the browser (istekler #279, 27-yazi-tipleri.html): Figtree has no
// "ə" and no Cyrillic, Space Grotesk no Cyrillic. Its app.css patched Cyrillic with @font-face
// aliases to local system fonts, because its `font: 600 13px Figtree` shorthands named no
// fallback and the missing letters fell to the browser's serif. Here every stack names a system
// sans that draws both (Segoe UI on Windows, Roboto on Android, Arial elsewhere), so a missing
// letter falls back per character to a matching-weight sans, never to serif — including the
// "ə" the prototype's patch did not cover. The mismatch of a fallback letter inside a Figtree
// word is the accepted cost of keeping these faces (decision #303).
//
// If a font update starts drawing a letter, the matching assertion fails: update this note.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { rule } from "./tokensCss.testutil.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.resolve(HERE, "../../../node_modules");

// WOFF2 (W3C): a 48-byte header, a table directory, then every table Brotli-compressed as one
// stream, in directory order. cmap is never transformed, so its bytes come out as the plain table.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
  "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC",
  "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat",
  "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf",
  "Silf", "Glat", "Gloc", "Feat", "Sill"];

function readBase128(buf, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[cursor.at];
    cursor.at += 1;
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value >>> 0;
  }
  throw new Error("bad UIntBase128");
}

function cmapTable(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${file}: not WOFF2`);
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  const cursor = { at: 48 };
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[cursor.at];
    cursor.at += 1;
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString("latin1", cursor.at, cursor.at + 4);
      cursor.at += 4;
    }
    const version = flags >> 6;
    let length = readBase128(buf, cursor);
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    if (transformed) length = readBase128(buf, cursor);
    tables.push({ tag, length });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(cursor.at, cursor.at + compressedLength));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === "cmap") return data.subarray(offset, offset + table.length);
    offset += table.length;
  }
  throw new Error(`${file}: no cmap table`);
}

/** Every code point the cmap maps to a real glyph (formats 4 and 12). */
function codepoints(cmap) {
  const found = new Set();
  const subtables = cmap.readUInt16BE(2);
  for (let i = 0; i < subtables; i += 1) {
    const at = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(at);
    if (format === 4) {
      const segments = cmap.readUInt16BE(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s += 1) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c += 1) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            glyph = cmap.readUInt16BE(ranges + s * 2 + rangeOffset + (c - start) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) found.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g += 1) {
        const first = cmap.readUInt32BE(at + 16 + g * 12);
        const last = cmap.readUInt32BE(at + 20 + g * 12);
        for (let c = first; c <= last; c += 1) found.add(c);
      }
    }
  }
  return found;
}

/** Everything the package's upright (non-italic) files draw, all subsets together. */
function coverage(pkg) {
  const dir = path.join(MODULES, pkg, "files");
  const all = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".woff2") && !f.includes("italic"))) {
    for (const c of codepoints(cmapTable(path.join(dir, file)))) all.add(c);
  }
  return all;
}

const AZ_LETTERS = [..."əƏıİğĞşŞçÇöÖüÜ"];
const RUSSIAN = [..."АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя"];
const missing = (drawn, chars) => chars.filter((ch) => !drawn.has(ch.codePointAt(0))).join("");

const FACES = {
  text: { pkg: "@fontsource-variable/figtree", family: "Figtree Variable" },
  display: { pkg: "@fontsource-variable/space-grotesk", family: "Space Grotesk Variable" },
  data: { pkg: "@fontsource-variable/jetbrains-mono", family: "JetBrains Mono Variable" },
};
const ROOT = rule(":root");
const stack = (name) => ROOT[name].split(",").map((f) => f.trim().replace(/^"|"$/g, ""));

describe("what each self-hosted face draws", () => {
  it("JetBrains Mono (data) draws Azerbaijani and Russian itself", () => {
    const drawn = coverage(FACES.data.pkg);
    expect(missing(drawn, AZ_LETTERS)).toBe("");
    expect(missing(drawn, RUSSIAN)).toBe("");
  });

  it("Space Grotesk (display) draws Azerbaijani, but no Cyrillic", () => {
    const drawn = coverage(FACES.display.pkg);
    expect(missing(drawn, AZ_LETTERS)).toBe("");
    expect(missing(drawn, RUSSIAN)).toBe(RUSSIAN.join(""));
  });

  it("Figtree (text) draws neither ə/Ə nor Cyrillic", () => {
    const drawn = coverage(FACES.text.pkg);
    expect(missing(drawn, AZ_LETTERS)).toBe("əƏ");
    expect(missing(drawn, RUSSIAN)).toBe(RUSSIAN.join(""));
  });
});

describe("the stacks in tokens.css", () => {
  it.each(["text", "display", "data"])("--font-%s starts with the family its package registers", (name) => {
    const css = fs.readFileSync(path.join(MODULES, FACES[name].pkg, "index.css"), "utf8");
    expect(css).toContain(`font-family: '${FACES[name].family}'`);
    expect(stack(`font-${name}`)[0]).toBe(FACES[name].family);
  });

  it.each(["text", "display"])("--font-%s falls back to a system sans that draws ə and Cyrillic, never to serif", (name) => {
    const fonts = stack(`font-${name}`);
    expect(fonts.slice(1, 4)).toEqual(["Segoe UI", "Roboto", "Arial"]);
    expect(fonts.at(-1)).toBe("sans-serif");
    expect(fonts).not.toContain("serif");
  });

  it("--font-data ends in a monospace face", () => {
    expect(stack("font-data").at(-1)).toBe("monospace");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/fonts.test.js
```
Expected: `Tests  4 failed | 5 passed (9)` — the JetBrains Mono, Space Grotesk, `--font-display` and `--font-data` cases fail with `ENOENT: no such file or directory … node_modules\@fontsource-variable\space-grotesk…` (or `…jetbrains-mono…`); the Figtree cases pass.

- [ ] **Step 3: Install the two packages** (needs the network)

```bash
cd /c/tmp/homunculus-g1/dashboard
npm install --save @fontsource-variable/space-grotesk@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
git diff --stat package.json
```
Expected: `added 2 packages`, and `package.json` gains `"@fontsource-variable/jetbrains-mono": "^5.3.0"` and `"@fontsource-variable/space-grotesk": "^5.3.0"` under `dependencies` (both SIL OFL 1.1, like Figtree).

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/fonts.test.js
```
Expected: `Tests  9 passed (9)`.

- [ ] **Step 5: Add the live UI's asset module** — `dashboard/src/live/theme/assets.js`:

```js
// src/live/theme/assets.js — the live UI's stylesheet and fonts. Import once, at the live root.
//
// The fonts are npm packages that Vite bundles and the app serves itself: a hospital network may
// not reach Google, and the product must not depend on it (prototype decision #125). What each
// face draws, and why the stacks in tokens.css fall back the way they do: fonts.test.js.
import "@fontsource-variable/figtree";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./tokens.css";
```

Nothing imports it yet (the gallery does in Task 18). Check that the three imports resolve:

```bash
cd /c/tmp/homunculus-g1/dashboard
node -e "for (const p of ['figtree','space-grotesk','jetbrains-mono']) console.log(require.resolve('@fontsource-variable/' + p + '/index.css'))"
```
Expected: three paths ending in `\index.css`.

- [ ] **Step 6: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  47 passed (47)`, `Tests  950 passed (950)`, `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/package.json dashboard/package-lock.json dashboard/src/live/theme/assets.js dashboard/src/live/theme/fonts.test.js
git commit -m "feat(dashboard): self-hosted Space Grotesk and JetBrains Mono for the live UI

The hospital network may not reach Google (prototype decision #125). The
test reads each font's cmap: Figtree draws no ə/Ə and no Cyrillic, Space
Grotesk no Cyrillic, JetBrains Mono both — so every stack names a system
sans (Segoe UI, Roboto, Arial) before sans-serif, never falling to serif.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Theme and text size, on `<html>`

**Files:**
- Create: `dashboard/src/live/theme/ThemeProvider.jsx`
- Test: `dashboard/src/live/theme/ThemeProvider.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/theme/ThemeProvider.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider.jsx";

function Probe() {
  const { theme, size, setTheme, setSize } = useTheme();
  return (
    <div>
      <p data-testid="theme">{theme}</p>
      <p data-testid="size">{size}</p>
      <button type="button" onClick={() => setTheme("gun")}>gun</button>
      <button type="button" onClick={() => setTheme("auto")}>auto</button>
      <button type="button" onClick={() => setSize("buyuk")}>buyuk</button>
    </div>
  );
}

const html = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete html.dataset.theme;
  delete html.dataset.size;
});

describe("ThemeProvider", () => {
  it("opens in Gece at normal size, and says so on <html>", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme")).toHaveTextContent("gece");
    expect(screen.getByTestId("size")).toHaveTextContent("normal");
    expect(html.dataset.theme).toBe("gece");
    expect(html.dataset.size).toBe("normal");
  });

  it("restores the stored choice", () => {
    localStorage.setItem("hmc.theme", "gun");
    localStorage.setItem("hmc.size", "buyuk");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
  });

  it("switches, stores the choice and updates <html>", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("gun"));
    fireEvent.click(screen.getByText("buyuk"));
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
    expect(localStorage.getItem("hmc.theme")).toBe("gun");
    expect(localStorage.getItem("hmc.size")).toBe("buyuk");
  });

  it("ignores a theme it does not have (there is no automatic theme yet)", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("auto"));
    expect(html.dataset.theme).toBe("gece");
    expect(localStorage.getItem("hmc.theme")).toBeNull();
  });

  it("renders in Gece when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(html.dataset.theme).toBe("gece");
  });

  it("without a provider, reports Gece at normal size", () => {
    render(<Probe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("gece");
    expect(screen.getByTestId("size")).toHaveTextContent("normal");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/ThemeProvider.test.jsx
```
Expected: FAIL — `Failed to resolve import "./ThemeProvider.jsx" from "src/live/theme/ThemeProvider.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/theme/ThemeProvider.jsx`:

```jsx
// src/live/theme/ThemeProvider.jsx — the live UI's colour theme and text size.
//
// Two themes, as in the prototype: "gece" (dark, the default — an ICU at night) and "gun"
// (daylight). The prototype's mobile "automatic" theme (20:00–08:00 dark) is not built: the web
// prototype's own settings offer only these two. Size "buyuk" scales all text by 1.12 (--fs).
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { readPref, writePref } from "../prefs.js";

export const THEMES = ["gece", "gun"];
export const SIZES = ["normal", "buyuk"];
export const DEFAULT_THEME = "gece";
export const DEFAULT_SIZE = "normal";

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  size: DEFAULT_SIZE,
  setTheme: () => {},
  setSize: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readPref("theme", THEMES, DEFAULT_THEME));
  const [size, setSizeState] = useState(() => readPref("size", SIZES, DEFAULT_SIZE));

  // On <html>, not on a wrapper: dialogs and toasts render in a portal under <body> and must take
  // the same theme. A layout effect, so the first paint already has the right colours.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.size = size;
  }, [size]);

  const setTheme = useCallback((value) => {
    if (!THEMES.includes(value)) return;
    setThemeState(value);
    writePref("theme", value);
  }, []);
  const setSize = useCallback((value) => {
    if (!SIZES.includes(value)) return;
    setSizeState(value);
    writePref("size", value);
  }, []);

  const value = useMemo(() => ({ theme, size, setTheme, setSize }), [theme, size, setTheme, setSize]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/theme/ThemeProvider.test.jsx
```
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  48 passed (48)`, `Tests  956 passed (956)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/theme/ThemeProvider.jsx dashboard/src/live/theme/ThemeProvider.test.jsx
git commit -m "feat(dashboard): live UI theme (Gece/Gün) and text size, kept per browser

Written on <html> so dialogs and toasts in a portal follow it. No
automatic theme yet: the web prototype offers only the two.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Keyed dictionaries in four languages, and the translator

**Files:**
- Create: `dashboard/src/live/i18n/langs.js`, `dashboard/src/live/i18n/translate.js`, `dashboard/src/live/i18n/catalog.js`
- Create: `dashboard/src/live/i18n/strings/common.js`, `…/strings/risk.js`, `…/strings/prefs.js`, `…/strings/news2.js`
- Test: `dashboard/src/live/i18n/translate.test.js`, `dashboard/src/live/i18n/strings.test.js`

The seeded namespaces are what the foundation needs (`common`: the modal's and toasts' words; `risk`: `riskStyle`'s labels; `prefs`: theme/size/language switches) plus `news2`, which the roadmap assigns to G1-06 ("Kısmi NEWS2 ipucu ve `NEWS2_MISSING_LABEL` yalnız Türkçe") and G1-09's bed card will use. Screens add their own namespaces later.

- [ ] **Step 1: Write the failing tests.** `dashboard/src/live/i18n/translate.test.js`:

```js
import { describe, it, expect, vi } from "vitest";
import { createTranslator, interpolate } from "./translate.js";

const DICTS = {
  az: { "a.hello": "Salam, {name}" },
  tr: { "a.hello": "Merhaba, {name}", "a.trOnly": "yalnız Türkçe" },
  ru: {},
  en: {},
};

describe("createTranslator", () => {
  it("returns the language's own text, with its variables", () => {
    expect(createTranslator("az", DICTS)("a.hello", { name: "Leyla" })).toBe("Salam, Leyla");
  });

  it("falls back to the Turkish source text, and reports it", () => {
    const onMissing = vi.fn();
    const t = createTranslator("ru", DICTS, onMissing);
    expect(t("a.trOnly")).toBe("yalnız Türkçe");
    expect(onMissing).toHaveBeenCalledWith({ key: "a.trOnly", lang: "ru", found: "tr" });
  });

  it("shows the key itself when no language has it, and reports it", () => {
    const onMissing = vi.fn();
    expect(createTranslator("tr", DICTS, onMissing)("a.nowhere")).toBe("a.nowhere");
    expect(onMissing).toHaveBeenCalledWith({ key: "a.nowhere", lang: "tr", found: null });
  });

  it("speaks Azerbaijani for a language it does not have (roadmap D2)", () => {
    expect(createTranslator("de", DICTS)("a.hello", { name: "X" })).toBe("Salam, X");
  });

  it("inserts variables verbatim and never translates them", () => {
    const t = createTranslator("az", DICTS);
    expect(t("a.hello", { name: "a.trOnly" })).toBe("Salam, a.trOnly");
    expect(t("a.hello", { name: "$& {name}" })).toBe("Salam, $& {name}");
  });

  it("leaves a placeholder it was not given visible", () => {
    expect(createTranslator("az", DICTS)("a.hello")).toBe("Salam, {name}");
  });
});

describe("interpolate", () => {
  it("writes numbers as text", () => {
    expect(interpolate("{n} yatak", { n: 3 })).toBe("3 yatak");
  });
});
```

`dashboard/src/live/i18n/strings.test.js`:

```js
// Every key in all four languages, non-empty, with the Turkish source's placeholders — the same
// guarantee i18n.rbac.test.js gives the old workspace's rbac block.
import { describe, it, expect } from "vitest";
import { NAMESPACES, DICTIONARIES, buildDictionaries } from "./catalog.js";
import { LANG_CODES, SOURCE_LANG } from "./langs.js";

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// Language-neutral texts: clinical abbreviations written the same in every script.
const NEUTRAL = new Set(["news2.missing.spo2"]);

describe("live UI dictionaries", () => {
  it("every namespace has the four languages, each with the Turkish source's keys", () => {
    for (const [ns, dict] of Object.entries(NAMESPACES)) {
      expect(Object.keys(dict).sort(), ns).toEqual([...LANG_CODES].sort());
      const flat = buildDictionaries({ [ns]: dict });
      const source = Object.keys(flat[SOURCE_LANG]).sort();
      expect(source.length, ns).toBeGreaterThan(0);
      for (const lang of LANG_CODES) expect(Object.keys(flat[lang]).sort(), `${ns} ${lang}`).toEqual(source);
    }
  });

  it("no text is empty, and each keeps the Turkish source's placeholders", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
        expect(typeof value === "string" && value.trim() !== "", `${lang} ${key}`).toBe(true);
        expect(placeholders(value), `${lang} ${key}`).toEqual(placeholders(DICTIONARIES[SOURCE_LANG][key]));
      }
    }
  });

  it("writes Azerbaijani in Latin script and Russian in Cyrillic", () => {
    const az = Object.values(DICTIONARIES.az).join(" ");
    expect(az).not.toMatch(/[Ѐ-ӿ]/);
    expect(az).toMatch(/ə/);
    for (const [key, value] of Object.entries(DICTIONARIES.ru)) {
      if (!NEUTRAL.has(key)) expect(value, `ru ${key}`).toMatch(/[Ѐ-ӿ]/);
    }
  });

  it("names keys <namespace>.<key>, nested keys joined with dots", () => {
    expect(DICTIONARIES.az["common.close"]).toBe("Bağla");
    expect(DICTIONARIES.tr["news2.missing.respiration_rate"]).toBe("solunum hızı");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/i18n/
```
Expected: `Test Files  2 failed (2)` — `Failed to resolve import "./translate.js"` and `Failed to resolve import "./catalog.js"`.

- [ ] **Step 3: Languages and the translator.** `dashboard/src/live/i18n/langs.js`:

```js
// src/live/i18n/langs.js — the live UI's four languages.
//
// Roadmap D2: Azerbaijani is the default; the user can pick Turkish, Russian or English and the
// choice is kept in the browser. There is no locale detection: the pilot's ward PCs run an
// English-locale browser, and the default is a product decision, not the browser's.
// Turkish is the source language: dictionaries are written in Turkish first, and a key missing
// from another language shows its Turkish text.
export const LANGS = [
  { code: "az", native: "Azərbaycan" },
  { code: "tr", native: "Türkçe" },
  { code: "ru", native: "Русский" },
  { code: "en", native: "English" },
];
export const LANG_CODES = LANGS.map((l) => l.code);
export const DEFAULT_LANG = "az";
export const SOURCE_LANG = "tr";
```

`dashboard/src/live/i18n/translate.js`:

```js
// src/live/i18n/translate.js — key -> text, for one language. Pure; the React side is I18nProvider.
//
// t(key, vars): the language's own text; else the Turkish source text; else the key itself —
// and each fallback is reported through onMissing, so a gap is visible in development instead
// of silently shipping Turkish to an Azerbaijani ward.
//
// Only keys are translated. Variables are inserted exactly as given and never looked up: a
// patient's name, a bed, a unit name or a value from the engine is data, and data is never
// translated (the prototype's rule; its DOM-rewriting ceviri.js layer is not ported).
import { DEFAULT_LANG, LANG_CODES, SOURCE_LANG } from "./langs.js";

export function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

export function createTranslator(lang, dictionaries, onMissing) {
  const code = LANG_CODES.includes(lang) ? lang : DEFAULT_LANG;
  const own = dictionaries[code] || {};
  const source = dictionaries[SOURCE_LANG] || {};
  return function t(key, vars) {
    let template = own[key];
    if (template === undefined) {
      template = code === SOURCE_LANG ? undefined : source[key];
      if (onMissing) onMissing({ key, lang: code, found: template === undefined ? null : SOURCE_LANG });
      if (template === undefined) return key;
    }
    return interpolate(template, vars);
  };
}
```

- [ ] **Step 4: The four namespaces.** `dashboard/src/live/i18n/strings/common.js`:

```js
// Words every screen uses. TR is the source; AZ/RU/EN are the prototype's own
// (core.js: save, cancel, close, notifs).
export default {
  tr: { save: "Kaydet", cancel: "Vazgeç", close: "Kapat", notifications: "Bildirimler" },
  az: { save: "Yadda saxla", cancel: "İmtina", close: "Bağla", notifications: "Bildirişlər" },
  ru: { save: "Сохранить", cancel: "Отмена", close: "Закрыть", notifications: "Уведомления" },
  en: { save: "Save", cancel: "Cancel", close: "Close", notifications: "Notifications" },
};
```

`dashboard/src/live/i18n/strings/risk.js`:

```js
// Engine risk levels, as riskStyle.js labels them.
// critical/high/moderate/low/info: the prototype's dictionary (grafik.js gd_k_crit/gd_k_high,
// devices.js dev_pri_dusuk, ceviri-sozluk "ORTA", mobil.js mt_info).
// none/unmeasured/unknown are new (roadmap G1-09: "bulgu yok / ölçülmedi"); their AZ/RU/EN
// await review by a native-speaking clinician.
export default {
  tr: {
    critical: "Kritik", high: "Yüksek", moderate: "Orta", low: "Düşük", info: "Bilgi",
    none: "Bulgu yok", unmeasured: "Ölçülmedi", unknown: "Tanımsız risk: {value}",
  },
  az: {
    critical: "Kritik", high: "Yüksək", moderate: "Orta", low: "Aşağı", info: "Məlumat",
    none: "Tapıntı yoxdur", unmeasured: "Ölçülməyib", unknown: "Naməlum risk: {value}",
  },
  ru: {
    critical: "Критический", high: "Высокий", moderate: "Средний", low: "Низкий", info: "Инфо",
    none: "Нет находок", unmeasured: "Не измерено", unknown: "Неизвестный риск: {value}",
  },
  en: {
    critical: "Critical", high: "High", moderate: "Moderate", low: "Low", info: "Info",
    none: "No finding", unmeasured: "Not measured", unknown: "Unknown risk: {value}",
  },
};
```

`dashboard/src/live/i18n/strings/prefs.js`:

```js
// Display preferences. The prototype's dictionary: ceviri-sozluk ("Tema", "Gece", "Gün ışığı"),
// mobil.js fs_t/fs_1/fs_2 (text size), legal.js lgl_lang ("Dil").
export default {
  tr: {
    theme: "Tema", themeGece: "Gece", themeGun: "Gün ışığı",
    size: "Yazı boyu", sizeNormal: "Normal", sizeBuyuk: "Büyük", lang: "Dil",
  },
  az: {
    theme: "Tema", themeGece: "Gecə", themeGun: "Gün işığı",
    size: "Yazı ölçüsü", sizeNormal: "Normal", sizeBuyuk: "Böyük", lang: "Dil",
  },
  ru: {
    theme: "Тема", themeGece: "Ночь", themeGun: "Дневной свет",
    size: "Размер текста", sizeNormal: "Обычный", sizeBuyuk: "Крупный", lang: "Язык",
  },
  en: {
    theme: "Theme", themeGece: "Night", themeGun: "Daylight",
    size: "Text size", sizeNormal: "Normal", sizeBuyuk: "Large", lang: "Language",
  },
};
```

`dashboard/src/live/i18n/strings/news2.js`:

```js
// NEWS2 on the bed card (used from G1-09). TR is the old ClinicalDemo's wording (News2Pill and
// NEWS2_MISSING_LABEL), which existed in Turkish only — roadmap "Dalga 0'dan açık kalanlar" -> G1-06.
// noEngine's AZ/RU/EN extend clinicalI18n's pr6.news2NoEngine with the sentence they lacked; the
// rest is new and awaits review by a native-speaking clinician. missing.* keys are the engine's
// parameter names (news2.missing[]).
export default {
  tr: {
    noEngine: "Motor bu hasta için NEWS2 göndermiyor — ekran kendi hesabını yapmaz. Ölçülmeyen parametreyi 0 sayan bir skor, hastayı olduğundan iyi gösterir.",
    partialHint: "Kısmi skor — {missing} ölçülmedi; gerçek toplam daha yüksek olabilir.",
    partialMark: "kısmi skor",
    missing: { respiration_rate: "solunum hızı", spo2: "SpO2", systolic_bp: "sistolik TA", pulse: "nabız", temperature: "ateş" },
  },
  az: {
    noEngine: "Mühərrik bu xəstə üçün NEWS2 göndərmir — ekran öz hesabını aparmır. Ölçülməyən parametri 0 sayan bal xəstəni olduğundan yaxşı göstərir.",
    partialHint: "Qismən bal — {missing} ölçülməyib; həqiqi cəm daha yüksək ola bilər.",
    partialMark: "qismən bal",
    missing: { respiration_rate: "tənəffüs tezliyi", spo2: "SpO2", systolic_bp: "sistolik AT", pulse: "nəbz", temperature: "temperatur" },
  },
  ru: {
    noEngine: "Движок не передаёт NEWS2 для этого пациента — экран не считает его сам. Балл, в котором неизмеренный параметр считается нулём, показывает пациента лучше, чем он есть.",
    partialHint: "Неполный балл — не измерено: {missing}; истинная сумма может быть выше.",
    partialMark: "неполный балл",
    missing: { respiration_rate: "частота дыхания", spo2: "SpO2", systolic_bp: "систолическое АД", pulse: "пульс", temperature: "температура" },
  },
  en: {
    noEngine: "The engine sends no NEWS2 for this patient — the screen does not score it itself. A score that counts an unmeasured parameter as 0 shows the patient better than they are.",
    partialHint: "Partial score — {missing} not measured; the true total may be higher.",
    partialMark: "partial score",
    missing: { respiration_rate: "respiratory rate", spo2: "SpO2", systolic_bp: "systolic BP", pulse: "pulse", temperature: "temperature" },
  },
};
```

- [ ] **Step 5: The catalog** — `dashboard/src/live/i18n/catalog.js` (Task 18 adds the `gallery` namespace to it):

```js
// src/live/i18n/catalog.js — every namespace's dictionaries, flattened per language.
//
// One file per namespace under strings/, each { tr, az, ru, en } with the same keys. A screen
// adds its own namespace file and one import line below, so parallel branches touch different
// files. Keys are "<namespace>.<key>", nested objects joined with dots: "news2.missing.spo2".
import { LANG_CODES } from "./langs.js";
import common from "./strings/common.js";
import risk from "./strings/risk.js";
import prefs from "./strings/prefs.js";
import news2 from "./strings/news2.js";

export const NAMESPACES = { common, risk, prefs, news2 };

function flattenInto(out, prefix, entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (value && typeof value === "object") flattenInto(out, `${prefix}${key}.`, value);
    else out[`${prefix}${key}`] = value;
  }
  return out;
}

export function buildDictionaries(namespaces) {
  return Object.fromEntries(LANG_CODES.map((lang) => [
    lang,
    Object.entries(namespaces).reduce((out, [ns, dict]) => flattenInto(out, `${ns}.`, dict[lang] || {}), {}),
  ]));
}

export const DICTIONARIES = buildDictionaries(NAMESPACES);
```

- [ ] **Step 6: Run them to see them pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/i18n/
```
Expected: `Test Files  2 passed (2)`, `Tests  11 passed (11)` (translate 7, strings 4).

- [ ] **Step 7: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  50 passed (50)`, `Tests  967 passed (967)`, `✓ built in …`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/i18n/langs.js dashboard/src/live/i18n/translate.js dashboard/src/live/i18n/translate.test.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/common.js dashboard/src/live/i18n/strings/risk.js dashboard/src/live/i18n/strings/prefs.js dashboard/src/live/i18n/strings/news2.js
git commit -m "feat(dashboard): keyed dictionaries in AZ/TR/RU/EN for the live UI

t(key, vars): the language, else the Turkish source, else the key — each
fallback reported. Variables are inserted verbatim, never translated.
Seeded: common, risk, prefs and news2 (the partial-NEWS2 hint and missing-
parameter names were Turkish only; roadmap open item for G1-06). Every key
in all four languages, non-empty, same placeholders: tested.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The language provider — Azerbaijani by default (roadmap D2)

**Files:**
- Create: `dashboard/src/live/i18n/I18nProvider.jsx`
- Test: `dashboard/src/live/i18n/I18nProvider.test.jsx`
- Modify: `dashboard/src/i18n.rbac.test.js:402-405` (comment only)

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/i18n/I18nProvider.test.jsx`:

```jsx
// The D2 versions of the language cases that i18n.rbac.test.js pins for the old workspace
// ("the UI language a ward opens in"): those stay as they are until the old workspace is removed
// (G1-16); the new shell opens in Azerbaijani.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider, useI18n } from "./I18nProvider.jsx";

function Probe() {
  const { lang, setLang, t } = useI18n();
  return (
    <div>
      <p data-testid="lang">{lang}</p>
      <p>{t("common.close")}</p>
      <button type="button" onClick={() => setLang("ru")}>ru</button>
      <button type="button" onClick={() => setLang("de")}>de</button>
    </div>
  );
}

const locale = (languages) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0]);
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("lang");
});

describe("the language the live UI opens in (roadmap D2)", () => {
  it("is Azerbaijani with nothing stored, even on an English-locale browser", () => {
    locale(["en-US", "en"]);
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });

  it("is Azerbaijani on a Turkish- or Russian-locale device too: there is no detection", () => {
    locale(["tr-TR", "ru-RU"]);
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
  });

  it("is the language the user chose, when one is stored", () => {
    locale(["az-AZ", "az"]);
    localStorage.setItem("hmc.lang", "en");
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it("is Azerbaijani when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });
});

describe("switching language", () => {
  it("re-renders, stores the choice and sets <html lang>", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(document.documentElement.lang).toBe("az");
    fireEvent.click(screen.getByText("ru"));
    expect(screen.getByText("Закрыть")).toBeInTheDocument();
    expect(localStorage.getItem("hmc.lang")).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  it("ignores a language it does not have", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByText("de"));
    expect(screen.getByTestId("lang")).toHaveTextContent("az");
    expect(localStorage.getItem("hmc.lang")).toBeNull();
  });

  it("still switches when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByText("ru"));
    expect(screen.getByText("Закрыть")).toBeInTheDocument();
  });
});

describe("without a provider", () => {
  it("speaks Azerbaijani", () => {
    render(<Probe />);
    expect(screen.getByText("Bağla")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/i18n/I18nProvider.test.jsx
```
Expected: FAIL — `Failed to resolve import "./I18nProvider.jsx" from "src/live/i18n/I18nProvider.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/i18n/I18nProvider.jsx`:

```jsx
// src/live/i18n/I18nProvider.jsx — the live UI's language: provider and hook.
//
// const { t, lang, setLang, langs } = useI18n();  t("common.close"), t("risk.unknown", { value })
// The language opens as stored in this browser, else Azerbaijani (roadmap D2). Switching stores
// the choice (prefs.js: storage may be refused, the UI still switches) and sets <html lang>, which
// screen readers use to pick a voice and CSS text-transform uses for İ/ı when upper-casing.
// Outside a provider useI18n() speaks Azerbaijani and cannot switch.
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { readPref, writePref } from "../prefs.js";
import { DEFAULT_LANG, LANGS, LANG_CODES } from "./langs.js";
import { DICTIONARIES } from "./catalog.js";
import { createTranslator } from "./translate.js";

const warned = new Set();
function warnMissing({ key, lang, found }) {
  if (!import.meta.env.DEV) return;
  const id = `${lang}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] "${key}" has no ${lang} text — showing ${found ? `the ${found} text` : "the key"}.`);
}

const I18nContext = createContext({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: createTranslator(DEFAULT_LANG, DICTIONARIES, warnMissing),
  langs: LANGS,
});

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => readPref("lang", LANG_CODES, DEFAULT_LANG));

  useLayoutEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANG_CODES.includes(code)) return;
    setLangState(code);
    writePref("lang", code);
  }, []);

  const t = useMemo(() => createTranslator(lang, DICTIONARIES, warnMissing), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, langs: LANGS }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/i18n/I18nProvider.test.jsx
```
Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Point the old detection tests at the new ones.** The old workspace's cases stay as they are (they pin `ClinicalDemo`, which stays until G1-16); only their comment changes. In `dashboard/src/i18n.rbac.test.js`, replace:

```js
  // Current behaviour, pinned as shipped: auto-detection knows only TR and AZ and falls back to
  // TR. The pilot's ward PCs run an English-locale Chrome over Turkish patient data, and detecting
  // EN landed every clinician on an English UI. (Roadmap D2 makes AZ the default in the new shell,
  // G1-06; these change with it, not before.)
```

with:

```js
  // Current behaviour, pinned as shipped: auto-detection knows only TR and AZ and falls back to
  // TR. The pilot's ward PCs run an English-locale Chrome over Turkish patient data, and detecting
  // EN landed every clinician on an English UI. This is the OLD workspace (ClinicalDemo, removed in
  // G1-16). The new shell follows roadmap D2 — Azerbaijani by default, no locale detection, the
  // stored choice wins — pinned in src/live/i18n/I18nProvider.test.jsx.
```

- [ ] **Step 6: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  51 passed (51)`, `Tests  975 passed (975)`, `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/i18n/I18nProvider.jsx dashboard/src/live/i18n/I18nProvider.test.jsx dashboard/src/i18n.rbac.test.js
git commit -m "feat(dashboard): the live UI opens in Azerbaijani; the user's choice is kept

Roadmap D2: no locale detection (the pilot's PCs run an English-locale
browser), a stored choice wins, an unreadable storage still renders AZ.
<html lang> follows the language. The old workspace's detection tests
stay, pointing at the new ones.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The prototype's icon set

**Files:**
- Create: `dashboard/src/live/ui/icons.js`, `dashboard/src/live/ui/Icon.jsx`
- Test: `dashboard/src/live/ui/Icon.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Icon.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon.jsx";
import { ICONS, ICON_NAMES } from "./icons.js";

afterEach(() => vi.restoreAllMocks());

describe("Icon", () => {
  it("has the prototype's 53 icons plus the top bar's two", () => {
    expect(ICON_NAMES).toHaveLength(55);
    for (const name of ["grid", "bell", "alert", "clock", "ok", "x", "moon", "sun", "fullscreen", "keyboard"]) {
      expect(ICON_NAMES).toContain(name);
    }
  });

  it.each(ICON_NAMES)("draws %s as a 24x24 currentColor stroke drawing", (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.children).toHaveLength(ICONS[name].length);
  });

  it("is hidden from assistive technology unless it is given a label", () => {
    const { container } = render(<Icon name="bell" />);
    expect(container.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
    render(<Icon name="bell" label="Bildirişlər" />);
    expect(screen.getByRole("img", { name: "Bildirişlər" })).toBeInTheDocument();
  });

  it("takes a size in px", () => {
    const { container } = render(<Icon name="bell" size={22} />);
    expect(container.querySelector("svg").getAttribute("width")).toBe("22");
  });

  it("draws the fallback for an unknown name, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Icon name="nope" />);
    expect(container.querySelectorAll("svg rect")).toHaveLength(4); // grid
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Icon.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Icon.jsx" from "src/live/ui/Icon.test.jsx". Does the file exist?`

- [ ] **Step 3: The icon data.** The prototype's `core.js` `P` strings (lines 8–43), converted element by element — `<path d="…"/>` → `["path", { d: "…" }]`, `<rect …/>` and `<circle …/>` likewise, attribute values unchanged — into `dashboard/src/live/ui/icons.js`:

```js
// src/live/ui/icons.js — the prototype's icon set (core.js H.icon), shape for shape.
//
// Each icon is a 24x24 stroke drawing (fill none, stroke currentColor, width 2, round caps and
// joins), listed as [element, attributes] pairs that Icon.jsx renders. The names are the
// prototype's, so a prototype screen's H.icon("bell") is <Icon name="bell" /> here.
// fullscreen and keyboard are the top bar's two inline SVGs (shell.js FS_IC, KB_IC), which the
// prototype drew outside H.icon.
export const ICONS = {
  grid: [["rect", { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }], ["rect", { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }], ["rect", { x: "14", y: "14", width: "7", height: "7", rx: "1.5" }], ["rect", { x: "3", y: "14", width: "7", height: "7", rx: "1.5" }]],
  bell: [["path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }], ["path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }]],
  clip: [["rect", { x: "8", y: "2", width: "8", height: "4", rx: "1" }], ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }], ["path", { d: "m9 14 2 2 4-4" }]],
  list: [["path", { d: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" }]],
  user: [["circle", { cx: "12", cy: "8", r: "4" }], ["path", { d: "M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" }]],
  userPlus: [["circle", { cx: "9", cy: "7", r: "4" }], ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }], ["path", { d: "M19 8v6M22 11h-6" }]],
  users: [["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }], ["circle", { cx: "9", cy: "7", r: "4" }], ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" }]],
  pill: [["path", { d: "m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" }], ["path", { d: "m8.5 8.5 7 7" }]],
  cpu: [["rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }], ["rect", { x: "9", y: "9", width: "6", height: "6" }], ["path", { d: "M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" }]],
  chart: [["path", { d: "M3 3v18h18" }], ["path", { d: "M7 16V9M12 16V5M17 16v-4" }]],
  shield: [["path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }]],
  tv: [["rect", { x: "2", y: "3", width: "20", height: "14", rx: "2" }], ["path", { d: "M8 21h8M12 17v4" }]],
  gear: [["circle", { cx: "12", cy: "12", r: "3.5" }], ["path", { d: "M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" }]],
  out: [["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }], ["path", { d: "m16 17 5-5-5-5M21 12H9" }]],
  alert: [["path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" }], ["path", { d: "M12 9v4M12 17h.01" }]],
  flask: [["path", { d: "M9 3h6M10 3v6L4 20h16L14 9V3" }]],
  plug: [["path", { d: "M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" }]],
  bed: [["path", { d: "M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9" }]],
  clock: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 6v6l4 2" }]],
  ok: [["path", { d: "M20 6 9 17l-5-5" }]],
  x: [["path", { d: "M18 6 6 18M6 6l12 12" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  minus: [["path", { d: "M5 12h14" }]],
  search: [["circle", { cx: "11", cy: "11", r: "7" }], ["path", { d: "m21 21-4.3-4.3" }]],
  moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }]],
  sun: [["circle", { cx: "12", cy: "12", r: "4" }], ["path", { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }]],
  lock: [["rect", { x: "3", y: "11", width: "18", height: "11", rx: "2" }], ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }]],
  key: [["circle", { cx: "7.5", cy: "15.5", r: "5.5" }], ["path", { d: "m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" }]],
  building: [["rect", { x: "4", y: "2", width: "16", height: "20", rx: "2" }], ["path", { d: "M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" }]],
  tree: [["rect", { x: "9", y: "2", width: "6", height: "5", rx: "1" }], ["rect", { x: "2", y: "17", width: "6", height: "5", rx: "1" }], ["rect", { x: "16", y: "17", width: "6", height: "5", rx: "1" }], ["path", { d: "M12 7v5M5 17v-3h14v3" }]],
  heart: [["path", { d: "M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" }]],
  activity: [["path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" }]],
  drop: [["path", { d: "M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0Z" }]],
  thermo: [["path", { d: "M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z" }]],
  syringe: [["path", { d: "m18 2 4 4M17 7l3-3M19 9 8.7 19.3a2.4 2.4 0 0 1-3.4 0l-.6-.6a2.4 2.4 0 0 1 0-3.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6" }]],
  food: [["path", { d: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" }]],
  body: [["circle", { cx: "12", cy: "4", r: "2" }], ["path", { d: "M12 6v8M8 9h8M9 22l3-8 3 8" }]],
  qr: [["rect", { x: "3", y: "3", width: "7", height: "7" }], ["rect", { x: "14", y: "3", width: "7", height: "7" }], ["rect", { x: "3", y: "14", width: "7", height: "7" }], ["path", { d: "M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" }]],
  tablet: [["rect", { x: "4", y: "2", width: "16", height: "20", rx: "2" }], ["path", { d: "M12 18h.01" }]],
  wifi: [["path", { d: "M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01" }]],
  edit: [["path", { d: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" }]],
  trash: [["path", { d: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" }]],
  print: [["path", { d: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" }], ["rect", { x: "6", y: "14", width: "12", height: "8" }]],
  chevR: [["path", { d: "m9 18 6-6-6-6" }]],
  chevL: [["path", { d: "m15 18-6-6 6-6" }]],
  chevD: [["path", { d: "m6 9 6 6 6-6" }]],
  globe: [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" }]],
  zap: [["path", { d: "M13 2 3 14h9l-1 8 10-12h-9l1-8z" }]],
  eye: [["path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
  file: [["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" }], ["path", { d: "M14 2v6h6" }]],
  swap: [["path", { d: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" }]],
  star: [["path", { d: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z" }]],
  link: [["path", { d: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" }]],
  fullscreen: [["path", { d: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" }]],
  keyboard: [["rect", { x: "2", y: "6", width: "20", height: "12", rx: "2" }], ["path", { d: "M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" }]],
};

export const ICON_NAMES = Object.keys(ICONS);
```

- [ ] **Step 4: The component** — `dashboard/src/live/ui/Icon.jsx`:

```jsx
// src/live/ui/Icon.jsx — one of the prototype's line icons, by its prototype name.
import React from "react";
import { ICONS } from "./icons.js";

/** Decorative by default (aria-hidden): the button or text beside it carries the meaning. Pass
 *  `label` when the icon alone carries meaning; it then becomes an image with that name.
 *  An unknown name draws the prototype's fallback (grid) and warns in development. */
export function Icon({ name, size = 16, label, className = "" }) {
  const shapes = ICONS[name];
  if (!shapes && import.meta.env.DEV) console.warn(`Icon: no icon named "${name}"`);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      data-icon={name}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {(shapes || ICONS.grid).map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
```

- [ ] **Step 5: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Icon.test.jsx
```
Expected: `Tests  59 passed (59)` (one per icon, plus four).

- [ ] **Step 6: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  52 passed (52)`, `Tests  1034 passed (1034)`, `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/icons.js dashboard/src/live/ui/Icon.jsx dashboard/src/live/ui/Icon.test.jsx
git commit -m "feat(dashboard): the prototype's icon set as an Icon component

All 53 H.icon names plus the top bar's fullscreen and keyboard, ported as
data (no innerHTML), drawn in currentColor, hidden from assistive
technology unless labelled.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Focus outline and Button

**Files:**
- Create: `dashboard/src/live/ui/focus.js`, `dashboard/src/live/ui/Button.jsx`
- Test: `dashboard/src/live/ui/Button.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Button.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button.jsx";
import { FOCUS_RING } from "./focus.js";

const classes = (el) => el.className.split(/\s+/);

describe("Button", () => {
  it("is type=button unless told otherwise", () => {
    render(<><Button>Yadda saxla</Button><Button type="submit">Göndər</Button></>);
    expect(screen.getByRole("button", { name: "Yadda saxla" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Göndər" })).toHaveAttribute("type", "submit");
  });

  it.each([
    ["default", ["bg-card", "text-ink", "border-line2"]],
    ["primary", ["bg-pri", "text-onpri"]],
    ["danger", ["bg-crit", "text-oncrit"]],
    ["ghost", ["bg-transparent", "text-mute"]],
  ])("paints the %s variant from the tokens", (variant, expected) => {
    render(<Button variant={variant}>x</Button>);
    expect(classes(screen.getByRole("button"))).toEqual(expect.arrayContaining(expected));
  });

  it.each([["sm", "text-12"], ["md", "text-13"], ["lg", "text-14.5"]])("size %s uses %s", (size, cls) => {
    render(<Button size={size}>x</Button>);
    expect(classes(screen.getByRole("button"))).toContain(cls);
  });

  it("shows a keyboard focus outline", () => {
    render(<Button>x</Button>);
    expect(classes(screen.getByRole("button"))).toEqual(expect.arrayContaining(FOCUS_RING.split(" ")));
  });

  it("names an icon-only button by its label, and hides the icon itself", () => {
    render(<Button variant="ghost" size="sm" icon="edit" label="Düzəliş et" />);
    const button = screen.getByRole("button", { name: "Düzəliş et" });
    expect(button).toHaveAttribute("title", "Düzəliş et");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("does not click while disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards its ref to the <button>", () => {
    const ref = createRef();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current.tagName).toBe("BUTTON");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Button.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Button.jsx" from "src/live/ui/Button.test.jsx". Does the file exist?`

- [ ] **Step 3: The focus outline** — `dashboard/src/live/ui/focus.js`:

```js
// src/live/ui/focus.js — the keyboard focus mark every interactive control in the live UI uses.
//
// The prototype has none (it styles :focus only on inputs). A 2 px primary outline, 2 px away from
// the control: an outline needs no "offset colour", so it reads on any surface, and it survives
// forced-colours (Windows high-contrast) mode, which drops box-shadows. --pri clears 3:1 against
// page, card and card2 in both themes (tokens.test.js). :focus-visible, so a mouse click on a
// button does not leave a ring behind.
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pri";
```

- [ ] **Step 4: The button** — `dashboard/src/live/ui/Button.jsx`:

```jsx
// src/live/ui/Button.jsx — the prototype's .btn.
import React, { forwardRef } from "react";
import { Icon } from "./Icon.jsx";
import { FOCUS_RING } from "./focus.js";

const VARIANT = {
  default: "border-line2 bg-card text-ink hover:border-pri", //  .btn
  primary: "border-transparent bg-pri text-onpri", //           .btn.p
  danger: "border-transparent bg-crit text-oncrit", //          .btn.d
  ghost: "border-transparent bg-transparent text-mute hover:bg-card2 hover:text-ink", // .btn.g
};
const SIZE = {
  sm: "px-[9px] py-[5px] text-12", //   .btn.sm
  md: "px-[13px] py-2 text-13", //      .btn
  lg: "px-[18px] py-[11px] text-14.5", // .btn.lg
};
const BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-ctl border font-text font-semibold leading-[normal] "
  + `cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS_RING}`;

/** variant: default | primary | danger | ghost; size: sm | md | lg; icon: an icon name.
 *  type="button" unless told otherwise — a button inside a form must not submit it by accident.
 *  An icon-only button needs `label`: it becomes the accessible name and the tooltip. */
export const Button = forwardRef(function Button(
  { variant = "default", size = "md", icon, label, type = "button", className = "", children, ...rest },
  ref,
) {
  const iconOnly = !children;
  if (iconOnly && !label && import.meta.env.DEV) console.warn("Button: an icon-only button needs a label");
  return (
    <button
      ref={ref}
      type={type}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={`${BASE} ${VARIANT[variant] || VARIANT.default} ${SIZE[size] || SIZE.md} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
});
```

- [ ] **Step 5: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Button.test.jsx
```
Expected: `Tests  12 passed (12)`.

- [ ] **Step 6: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  53 passed (53)`, `Tests  1046 passed (1046)`, `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/focus.js dashboard/src/live/ui/Button.jsx dashboard/src/live/ui/Button.test.jsx
git commit -m "feat(dashboard): live UI Button and keyboard focus outline

The prototype's .btn (default, primary, danger, ghost; sm, md, lg) from
token classes. type=button unless asked; an icon-only button is named by
its label; a 2 px primary outline on :focus-visible.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Box, Note, Empty and label–value rows

**Files:**
- Create: `dashboard/src/live/ui/Box.jsx`, `dashboard/src/live/ui/Note.jsx`, `dashboard/src/live/ui/Empty.jsx`, `dashboard/src/live/ui/KV.jsx`
- Test: `dashboard/src/live/ui/surfaces.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/surfaces.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Box } from "./Box.jsx";
import { Note } from "./Note.jsx";
import { Empty } from "./Empty.jsx";
import { KV, KVList } from "./KV.jsx";

describe("Box", () => {
  it("names its section with a real heading, h3 by default", () => {
    render(<Box title="Alarm keyfiyyəti" icon="chart" right="7 gün"><p>içində</p></Box>);
    expect(screen.getByRole("heading", { level: 3, name: "Alarm keyfiyyəti" })).toBeInTheDocument();
    expect(screen.getByText("7 gün")).toBeInTheDocument();
    expect(screen.getByText("içində")).toBeInTheDocument();
  });

  it("takes another heading level", () => {
    render(<Box title="Başlıq" level={2}>x</Box>);
    expect(screen.getByRole("heading", { level: 2, name: "Başlıq" })).toBeInTheDocument();
  });

  it("draws no header without a title", () => {
    const { container } = render(<Box>yalnız məzmun</Box>);
    expect(container.querySelector("h2, h3, h4, h5, h6")).toBeNull();
  });
});

describe("Note", () => {
  it.each([["warn", "bg-att"], ["info", "bg-pri-soft"]])("%s tone paints %s", (tone, cls) => {
    render(<Note tone={tone}>Bağlantı yavaşdır.</Note>);
    const note = screen.getByRole("note");
    expect(note).toHaveAttribute("data-tone", tone);
    expect(note.className).toContain(cls);
    expect(note).toHaveTextContent("Bağlantı yavaşdır.");
  });
});

describe("Empty", () => {
  it("says what is missing", () => {
    render(<Empty icon="search">Uyğun qeyd yoxdur.</Empty>);
    expect(screen.getByText("Uyğun qeyd yoxdur.")).toBeInTheDocument();
  });
});

describe("KV", () => {
  it("writes label–value rows as a description list, values in the data face", () => {
    render(<KVList><KV label="Son giriş">23.09 19:58</KV><KV label="Vəziyyət" mono={false}>Aktiv</KV></KVList>);
    expect(screen.getByText("Son giriş").tagName).toBe("DT");
    expect(screen.getByText("23.09 19:58").tagName).toBe("DD");
    expect(screen.getByText("23.09 19:58").className).toContain("font-data");
    expect(screen.getByText("Aktiv").className).not.toContain("font-data");
    expect(screen.getByText("Son giriş").closest("dl")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/surfaces.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Box.jsx" from "src/live/ui/surfaces.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement.** `dashboard/src/live/ui/Box.jsx`:

```jsx
// src/live/ui/Box.jsx — the prototype's .box / .card (the two are the same rule).
import React from "react";
import { Icon } from "./Icon.jsx";

/** A bordered surface, optionally with the prototype's small upper-case header (its h5). The
 *  header is a real heading — h3 unless `level` says otherwise — so screen-reader users can jump
 *  between boxes. `right` fills the header's right-hand side (the prototype's h5 .r). */
export function Box({ title, icon, right, level = 3, className = "", children }) {
  const Heading = `h${Math.min(6, Math.max(2, level))}`;
  return (
    <div className={`rounded-box border border-line bg-card px-[14px] py-3 ${className}`}>
      {title ? (
        <div className="mb-2.5 flex items-center gap-2">
          <Heading className="m-0 flex items-center gap-2 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute">
            {icon ? <Icon name={icon} size={15} /> : null}
            {title}
          </Heading>
          {right ? <div className="ml-auto font-text text-11 font-semibold text-mute">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
```

`dashboard/src/live/ui/Note.jsx`:

```jsx
// src/live/ui/Note.jsx — the prototype's .note (amber) and .note.i (information, primary blue).
import React from "react";
import { Icon } from "./Icon.jsx";

const TONE = {
  warn: "border-att-line bg-att text-att-ink",
  info: "border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft text-pri",
};

/** A short aside next to the content it qualifies. Static: it does not announce itself; a message
 *  that appears in response to an action belongs in a toast. tone: warn (default) | info. */
export function Note({ tone = "warn", icon, className = "", children }) {
  return (
    <div
      role="note"
      data-tone={TONE[tone] ? tone : "warn"}
      className={`flex items-start gap-2 rounded-ctl border px-2.5 py-2 font-text text-12.5 font-semibold leading-[normal] ${TONE[tone] || TONE.warn} ${className}`}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <div>{children}</div>
    </div>
  );
}
```

`dashboard/src/live/ui/Empty.jsx`:

```jsx
// src/live/ui/Empty.jsx — the prototype's .empty: what a list says when it has nothing to show.
import React from "react";
import { Icon } from "./Icon.jsx";

/** Say why the list is empty in the words of the screen ("no open alarms"), never a bare "—":
 *  on a clinical screen an empty area must not read as "all quiet" by accident. */
export function Empty({ icon, className = "", children }) {
  return (
    <div className={`rounded-box border-[1.5px] border-dashed border-line2 px-2.5 py-[26px] text-center font-text text-14 text-mute ${className}`}>
      {icon ? <Icon name={icon} size={20} className="mx-auto mb-1.5" /> : null}
      {children}
    </div>
  );
}
```

`dashboard/src/live/ui/KV.jsx`:

```jsx
// src/live/ui/KV.jsx — the prototype's .kv rows (label left, value right), as a description list.
import React from "react";

export function KVList({ className = "", children }) {
  return <dl className={`m-0 ${className}`}>{children}</dl>;
}

/** One label–value row; put it inside <KVList>. The value is set in the data face (JetBrains
 *  Mono, bold) like the prototype's <b>; mono={false} for a value that is prose. */
export function KV({ label, mono = true, children }) {
  return (
    <div className="flex justify-between gap-2.5 border-b border-dashed border-line py-1.5 font-text text-13 last:border-b-0">
      <dt>{label}</dt>
      <dd className={`m-0 text-right font-bold ${mono ? "font-data" : ""}`}>{children}</dd>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/surfaces.test.jsx
```
Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  54 passed (54)`, `Tests  1053 passed (1053)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Box.jsx dashboard/src/live/ui/Note.jsx dashboard/src/live/ui/Empty.jsx dashboard/src/live/ui/KV.jsx dashboard/src/live/ui/surfaces.test.jsx
git commit -m "feat(dashboard): live UI Box, Note, Empty and label-value rows

The prototype's .box/.card with a real heading, .note and .note.i
(role=note), .empty, and .kv as a description list.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Tag, Pill and StatusPill

**Files:**
- Create: `dashboard/src/live/ui/Tag.jsx`
- Test: `dashboard/src/live/ui/Tag.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Tag.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tag, Pill, StatusPill, STATUS_TONES } from "./Tag.jsx";

describe("Tag", () => {
  it.each([
    ["neutral", "border-line2"],
    ["warn", "text-att-ink"],
    ["crit", "text-crit-ink"],
  ])("%s tone uses %s", (tone, cls) => {
    render(<Tag tone={tone}>Məcburi · qurulmayıb</Tag>);
    const tag = screen.getByText("Məcburi · qurulmayıb");
    expect(tag).toHaveAttribute("data-tone", tone);
    expect(tag.className).toContain(cls);
  });

  it("falls back to neutral for a tone it does not have", () => {
    render(<Tag tone="loud">x</Tag>);
    expect(screen.getByText("x")).toHaveAttribute("data-tone", "neutral");
  });
});

describe("Pill", () => {
  it("is a soft label with an optional icon", () => {
    render(<Pill icon="ok">Açıq</Pill>);
    const pill = screen.getByText("Açıq");
    expect(pill.className).toContain("bg-card2");
    expect(pill.querySelector("svg")).not.toBeNull();
  });
});

describe("StatusPill", () => {
  it("knows the five severity tones and neutral", () => {
    expect(STATUS_TONES).toEqual(["crit", "high", "mid", "low", "ok", "neutral"]);
  });

  it.each(["crit", "high", "mid", "low", "ok"])("%s writes its label in the tone's ink", (tone) => {
    render(<StatusPill tone={tone}>etiket</StatusPill>);
    const pill = screen.getByText("etiket");
    expect(pill).toHaveAttribute("data-tone", tone);
    expect(pill.className).toContain(`text-${tone}-ink`);
  });

  it("falls back to neutral, never to a colour, for a tone it does not have", () => {
    render(<StatusPill tone="green">x</StatusPill>);
    expect(screen.getByText("x")).toHaveAttribute("data-tone", "neutral");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Tag.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Tag.jsx" from "src/live/ui/Tag.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/ui/Tag.jsx`:

```jsx
// src/live/ui/Tag.jsx — the prototype's small labels: .tag (outlined), .pill (soft), .sv (status).
import React from "react";
import { Icon } from "./Icon.jsx";

const TAG = {
  neutral: "border-line2 text-mute", //                                                    .tag
  warn: "border-att-line bg-att text-att-ink", //                                          .tag.w
  crit: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft text-crit-ink", // .tag.c
};

/** An outlined label: a unit name, "first sign-in", "2FA required". tone: neutral | warn | crit. */
export function Tag({ tone = "neutral", icon, className = "", children }) {
  const t = TAG[tone] ? tone : "neutral";
  return (
    <span data-tone={t} className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-lg border px-2 py-[3px] font-text text-11.5 font-semibold leading-[normal] ${TAG[t]} ${className}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

/** A soft, borderless label on card2 (the prototype's .pill): "2FA on", a count, a source. */
export function Pill({ icon, className = "", children }) {
  return (
    <span className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-card2 px-2 py-[3px] font-text text-11.5 font-semibold leading-[normal] text-mute ${className}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

// Severity text sits on its own fill's 14 % tint (the prototype's .sv). Ink, not fill, for the
// text: in daylight the fills are too light to read on their tint (tokens.test.js). Neutral uses
// the .pill look, because mute on a mute tint is under 4.5:1 in daylight.
const STATUS = {
  crit: "text-crit-ink bg-[color:color-mix(in_srgb,var(--crit)_14%,transparent)]",
  high: "text-high-ink bg-[color:color-mix(in_srgb,var(--high)_14%,transparent)]",
  mid: "text-mid-ink bg-[color:color-mix(in_srgb,var(--mid)_14%,transparent)]",
  low: "text-low-ink bg-[color:color-mix(in_srgb,var(--low)_14%,transparent)]",
  ok: "text-ok-ink bg-[color:color-mix(in_srgb,var(--ok)_14%,transparent)]",
  neutral: "text-mute bg-card2",
};
export const STATUS_TONES = Object.keys(STATUS);

/** A coloured status pill, upper-cased by CSS (so <html lang> gets "İ" right in AZ/TR).
 *  tone: crit | high | mid | low | ok | neutral. Colour is never the only signal: the label is
 *  the children, and risk pills add an icon (RiskPill). ok is for states like "Active" — an
 *  engine risk never maps to it (riskStyle.js). */
export function StatusPill({ tone = "neutral", icon, className = "", children }) {
  const t = STATUS[tone] ? tone : "neutral";
  return (
    <span data-tone={t} className={`inline-flex h-fit items-center gap-[5px] whitespace-nowrap rounded-full px-2 py-1 font-text text-10.5 font-bold uppercase leading-[normal] tracking-[.04em] ${STATUS[t]} ${className}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Tag.test.jsx
```
Expected: `Tests  12 passed (12)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  55 passed (55)`, `Tests  1065 passed (1065)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Tag.jsx dashboard/src/live/ui/Tag.test.jsx
git commit -m "feat(dashboard): live UI Tag, Pill and StatusPill

.tag (neutral, warn, crit), .pill and the .sv status pill. Severity text
uses the ink tokens on the fill's 14% tint; an unknown tone is neutral,
never a colour.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The engine's risk on screen — never green

**Files:**
- Create: `dashboard/src/live/ui/riskStyle.js`, `dashboard/src/live/ui/RiskPill.jsx`
- Test: `dashboard/src/live/ui/riskStyle.test.js`, `dashboard/src/live/ui/RiskPill.test.jsx`

This is the roadmap's G1-09 acceptance criterion ("`moderate` amber; `none`/`info` nötr — bulgu yok / ölçülmedi; hiçbiri yeşil stabil'e düşmez") as a pure function, so the bed cards (G1-09), the patient header (G1-11) and any list share one mapping. The old `risk.js` / `theme.js` keep painting the old workspace until G1-16.

- [ ] **Step 1: Write the failing tests.** `dashboard/src/live/ui/riskStyle.test.js`:

```js
// Roadmap G1-09 acceptance: the engine's risk values are mapped explicitly — moderate amber,
// none/info neutral ("no finding / not measured") — and none of them falls back to green.
import { describe, it, expect } from "vitest";
import { riskStyle, ENGINE_RISKS } from "./riskStyle.js";
import { DICTIONARIES } from "../i18n/catalog.js";
import { LANG_CODES } from "../i18n/langs.js";

describe("riskStyle", () => {
  it.each([
    ["critical", "crit", "risk.critical"],
    ["high", "high", "risk.high"],
    ["moderate", "mid", "risk.moderate"],
    ["low", "low", "risk.low"],
    ["info", "neutral", "risk.info"],
    ["none", "neutral", "risk.none"],
  ])("maps %s to the %s tone", (risk, tone, labelKey) => {
    expect(riskStyle(risk)).toMatchObject({ tone, labelKey });
  });

  it("knows exactly the engine's six levels", () => {
    expect([...ENGINE_RISKS].sort()).toEqual(["critical", "high", "info", "low", "moderate", "none"]);
  });

  it("never falls back to green", () => {
    const anything = [...ENGINE_RISKS, "stable", "ok", "", null, undefined, "CRITICAL", 3];
    for (const risk of anything) {
      expect(riskStyle(risk).tone, String(risk)).not.toBe("ok");
      expect(riskStyle(risk, { measured: false }).tone, String(risk)).not.toBe("ok");
    }
  });

  it("says 'not measured' instead of 'no finding' when nothing was measured", () => {
    expect(riskStyle("none", { measured: false })).toMatchObject({ tone: "neutral", labelKey: "risk.unmeasured" });
    expect(riskStyle("info", { measured: false })).toMatchObject({ labelKey: "risk.unmeasured" });
  });

  it("never lets 'not measured' hide a real finding", () => {
    expect(riskStyle("high", { measured: false })).toMatchObject({ tone: "high", labelKey: "risk.high" });
  });

  it("keeps an unrecognised value visible, with its raw text", () => {
    expect(riskStyle("stable")).toEqual({
      tone: "neutral", icon: "alert", labelKey: "risk.unknown", labelVars: { value: "stable" },
    });
  });

  it("names every label in all four languages", () => {
    const keys = [...ENGINE_RISKS.map((r) => riskStyle(r).labelKey), "risk.unmeasured", "risk.unknown"];
    for (const lang of LANG_CODES) for (const key of keys) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
  });
});
```

`dashboard/src/live/ui/RiskPill.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskPill } from "./RiskPill.jsx";
import { I18nProvider } from "../i18n/I18nProvider.jsx";

afterEach(() => localStorage.clear());

describe("RiskPill", () => {
  it("labels the risk in Azerbaijani by default, in its tone, with an icon", () => {
    render(<><RiskPill risk="moderate" /><RiskPill risk="high" /></>);
    expect(screen.getByText("Orta")).toHaveAttribute("data-tone", "mid");
    expect(screen.getByText("Yüksək")).toHaveAttribute("data-tone", "high");
    expect(screen.getByText("Orta").querySelector("svg")).not.toBeNull();
  });

  it("follows the chosen language", () => {
    localStorage.setItem("hmc.lang", "ru");
    render(<I18nProvider><RiskPill risk="moderate" /></I18nProvider>);
    expect(screen.getByText("Средний")).toBeInTheDocument();
  });

  it("says when nothing was measured", () => {
    render(<RiskPill risk="none" measured={false} />);
    expect(screen.getByText("Ölçülməyib")).toHaveAttribute("data-tone", "neutral");
  });

  it("shows an unrecognised value as it came, neutral", () => {
    render(<RiskPill risk="stable" />);
    expect(screen.getByText("Naməlum risk: stable")).toHaveAttribute("data-tone", "neutral");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/riskStyle.test.js src/live/ui/RiskPill.test.jsx
```
Expected: `Test Files  2 failed (2)` — `Failed to resolve import "./riskStyle.js"` and `Failed to resolve import "./RiskPill.jsx"`.

- [ ] **Step 3: The mapping** — `dashboard/src/live/ui/riskStyle.js`:

```js
// src/live/ui/riskStyle.js — how an engine `risk` value looks on screen. Pure.
//
// The engine sends risk ∈ none | info | low | moderate | high | critical: the highest severity
// among the patient's active alerts, "none" when there is none (homunculus-engine api/board.py
// _risk) — which includes a patient admitted but never measured (identity_only_board).
// Roadmap G1-09: moderate is amber; none and info are neutral; nothing falls back to a green
// "stable". An absent finding is not evidence of stability — the old mapping (risk.js, theme.js)
// painted none, and on the VM moderate too, green.
//
// riskStyle(risk, { measured }) -> { tone, icon, labelKey, labelVars? }
//   tone: a StatusPill tone; labelKey: an i18n key (strings/risk.js).
//   measured: false — the card has no observation at all — turns none/info into "not measured";
//   the caller (G1-09) decides it from the card's timestamps. It never hides a real finding.
//   An unrecognised value stays neutral but shows its raw value, so a level the engine adds later
//   is visible on the card instead of silently calm.
const RISK = {
  critical: { tone: "crit", icon: "alert", labelKey: "risk.critical" },
  high: { tone: "high", icon: "alert", labelKey: "risk.high" },
  moderate: { tone: "mid", icon: "clock", labelKey: "risk.moderate" },
  low: { tone: "low", icon: "clock", labelKey: "risk.low" },
  info: { tone: "neutral", icon: "eye", labelKey: "risk.info" },
  none: { tone: "neutral", icon: "minus", labelKey: "risk.none" },
};
const NO_FINDING = ["none", "info"];

export const ENGINE_RISKS = Object.keys(RISK);

export function riskStyle(risk, { measured = true } = {}) {
  if (!measured && NO_FINDING.includes(risk)) {
    return { tone: "neutral", icon: "minus", labelKey: "risk.unmeasured" };
  }
  if (Object.prototype.hasOwnProperty.call(RISK, risk)) return { ...RISK[risk] };
  return { tone: "neutral", icon: "alert", labelKey: "risk.unknown", labelVars: { value: String(risk) } };
}
```

- [ ] **Step 4: The pill** — `dashboard/src/live/ui/RiskPill.jsx`:

```jsx
// src/live/ui/RiskPill.jsx — an engine risk value as a status pill: tone, icon and a label in the
// current language. Never green (riskStyle.js).
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { riskStyle } from "./riskStyle.js";
import { StatusPill } from "./Tag.jsx";

export function RiskPill({ risk, measured = true, className = "" }) {
  const { t } = useI18n();
  const style = riskStyle(risk, { measured });
  return (
    <StatusPill tone={style.tone} icon={style.icon} className={className}>
      {t(style.labelKey, style.labelVars)}
    </StatusPill>
  );
}
```

- [ ] **Step 5: Run them to see them pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/riskStyle.test.js src/live/ui/RiskPill.test.jsx
```
Expected: `Tests  16 passed (16)` (riskStyle 12, RiskPill 4).

- [ ] **Step 6: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  57 passed (57)`, `Tests  1081 passed (1081)`, `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/riskStyle.js dashboard/src/live/ui/riskStyle.test.js dashboard/src/live/ui/RiskPill.jsx dashboard/src/live/ui/RiskPill.test.jsx
git commit -m "feat(dashboard): engine risk mapped explicitly for the live UI, never green

critical red, high orange, moderate amber, low blue; none and info
neutral (\"no finding\"), \"not measured\" when nothing was measured, and
an unknown level shown with its raw value. Roadmap G1-09 criterion.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: Seg and Tabs

**Files:**
- Create: `dashboard/src/live/ui/Seg.jsx`, `dashboard/src/live/ui/Tabs.jsx`
- Test: `dashboard/src/live/ui/choice.test.jsx`

`Seg` is the alarms filter ("Açık · 3 / Yalnız kritik / Benim hastalarım"), the summary range and the theme/size/language switches: toggle buttons in a named group. `Tabs` is the admin and patient tab strip, which swaps a panel: the ARIA tab pattern, with arrow-key navigation.

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/choice.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Seg } from "./Seg.jsx";
import { Tabs, TabPanel } from "./Tabs.jsx";

const FILTERS = [
  { value: "open", label: "Açıq · 3" },
  { value: "crit", label: "Yalnız kritik" },
  { value: "mine", label: "Mənim xəstələrim" },
];

describe("Seg", () => {
  it("is a named group of toggle buttons, the chosen one pressed", () => {
    render(<Seg label="Süzgəc" options={FILTERS} value="crit" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Süzgəc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yalnız kritik" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Açıq · 3" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports a new choice, and stays quiet on the current one", () => {
    const onChange = vi.fn();
    render(<Seg label="Süzgəc" options={FILTERS} value="open" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Açıq · 3" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mənim xəstələrim" }));
    expect(onChange).toHaveBeenCalledWith("mine");
  });

  it("marks an option written in another language", () => {
    render(<Seg label="Dil" options={[{ value: "ru", label: "Русский", lang: "ru" }]} value="az" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Русский" })).toHaveAttribute("lang", "ru");
  });
});

const TABS = [
  { value: "users", label: "İstifadəçilər" },
  { value: "roles", label: "Rollar və səlahiyyətlər", count: 2 },
  { value: "audit", label: "Audit jurnalı" },
];

function Harness() {
  const [tab, setTab] = useState("users");
  return (
    <>
      <Tabs id="adm" label="İdarə" tabs={TABS} value={tab} onChange={setTab} />
      <TabPanel id="adm" value={tab}>{`panel:${tab}`}</TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("is a named tab list; the selected tab labels its panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "İdarə" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "İstifadəçilər" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "İstifadəçilər" })).toHaveTextContent("panel:users");
  });

  it("keeps only the selected tab in the Tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "İstifadəçilər" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Rollar/ })).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Audit jurnalı" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel:audit");
  });

  it("moves with the arrow keys, wrapping, and jumps with Home/End", () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "İstifadəçilər" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Rollar/ })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Rollar/ }));
    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Audit jurnalı" }));
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel:audit");
    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel:users");
  });

  it("shows a count badge", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: /Rollar/ })).toHaveTextContent("2");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/choice.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Seg.jsx" from "src/live/ui/choice.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement.** `dashboard/src/live/ui/Seg.jsx`:

```jsx
// src/live/ui/Seg.jsx — the prototype's .seg: one choice out of a few, as joined buttons.
import React from "react";
import { Icon } from "./Icon.jsx";
import { FOCUS_RING } from "./focus.js";

/** A labelled group of toggle buttons (aria-pressed); the chosen one is filled.
 *  options: [{ value, label, icon?, lang? }] — `lang` marks a label in another language (a
 *  language picker's "Русский"), so a screen reader pronounces it in that language. */
export function Seg({ label, options, value, onChange, className = "" }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-ctl border border-line bg-card p-[3px] ${className}`}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            lang={option.lang}
            aria-pressed={on}
            onClick={() => {
              if (!on) onChange(option.value);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-[11px] py-1.5 font-text text-13 font-semibold leading-[normal] ${on ? "bg-pri text-onpri" : "bg-transparent text-mute hover:text-ink"} ${FOCUS_RING}`}
          >
            {option.icon ? <Icon name={option.icon} size={15} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

`dashboard/src/live/ui/Tabs.jsx`:

```jsx
// src/live/ui/Tabs.jsx — the prototype's .tabs, as an ARIA tab list.
import React, { useRef } from "react";
import { FOCUS_RING } from "./focus.js";

const tabId = (id, value) => `${id}-tab-${value}`;
const panelId = (id, value) => `${id}-panel-${value}`;

/** tabs: [{ value, label, count? }]. `id` is the base of the tab and panel ids: give the same
 *  `id` to <TabPanel>. Left/Right move between tabs and select (automatic activation), Home/End
 *  jump to the ends, and only the selected tab is in the Tab order. `count` shows the prototype's
 *  amber badge (its <em>). The caller renders only the selected panel. */
export function Tabs({ id, label, tabs, value, onChange, className = "" }) {
  const refs = useRef({});
  const index = tabs.findIndex((tab) => tab.value === value);

  const onKeyDown = (event) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length];
    onChange(next.value);
    refs.current[next.value]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`my-3 flex gap-0.5 overflow-x-auto border-b border-line ${className}`}>
      {tabs.map((tab) => {
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[tab.value] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, tab.value)}
            aria-controls={panelId(id, tab.value)}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`inline-flex items-center gap-[5px] whitespace-nowrap border-b-2 bg-transparent px-3 py-[9px] font-text text-13 font-semibold leading-[normal] ${on ? "border-pri text-ink" : "border-transparent text-mute hover:text-ink"} ${FOCUS_RING}`}
          >
            {tab.label}
            {tab.count ? (
              <span className="rounded-full bg-mid px-1.5 py-px font-text text-10 font-bold text-onmid">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, value, className = "", children }) {
  return (
    <div role="tabpanel" id={panelId(id, value)} aria-labelledby={tabId(id, value)} tabIndex={0} className={`${FOCUS_RING} ${className}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/choice.test.jsx
```
Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  58 passed (58)`, `Tests  1089 passed (1089)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Seg.jsx dashboard/src/live/ui/Tabs.jsx dashboard/src/live/ui/choice.test.jsx
git commit -m "feat(dashboard): live UI segmented choice and tab list

.seg as a named group of aria-pressed buttons; .tabs as an ARIA tab list
with arrow, Home and End keys, one tab in the Tab order, the amber count
badge, and TabPanel labelled by its tab.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Form field, input and select

**Files:**
- Create: `dashboard/src/live/ui/Field.jsx`
- Test: `dashboard/src/live/ui/Field.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Field.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { Field, Input, Select } from "./Field.jsx";

describe("Field", () => {
  it("ties its label to the control", () => {
    render(<Field label="İstifadəçi adı"><Input /></Field>);
    expect(screen.getByLabelText("İstifadəçi adı").tagName).toBe("INPUT");
  });

  it("reads the hint with the control", () => {
    render(<Field label="İstifadəçi adı" hint="Kiçik hərf, rəqəm, nöqtə"><Input /></Field>);
    expect(screen.getByLabelText("İstifadəçi adı")).toHaveAccessibleDescription("Kiçik hərf, rəqəm, nöqtə");
  });

  it("marks a required field on the label and on the control", () => {
    const { container } = render(<Field label="Rol" required><Select><option>Hekim</option></Select></Field>);
    expect(screen.getByRole("combobox")).toBeRequired();
    expect(container.querySelector("label [aria-hidden='true']")).toHaveTextContent("*");
  });

  it("keeps the control's own id and description", () => {
    render(
      <Field label="E-poçt" hint="korporativ ünvan">
        <Input id="email" aria-describedby="elsewhere" />
      </Field>,
    );
    const input = screen.getByLabelText("E-poçt");
    expect(input).toHaveAttribute("id", "email");
    expect(input.getAttribute("aria-describedby")).toBe("elsewhere email-hint");
  });

  it("puts the label above the control in the col layout", () => {
    const { container } = render(<Field label="Ad" layout="col"><Input /></Field>);
    expect(container.firstChild.className).toContain("grid-cols-1");
    expect(container.firstChild.className).not.toContain("grid-cols-[150px_1fr]");
  });
});

describe("Input and Select", () => {
  it("forward their refs and props", () => {
    const input = createRef();
    const select = createRef();
    render(<><Input ref={input} placeholder="ör. hs.aygun" /><Select ref={select} defaultValue="b"><option value="a">A</option><option value="b">B</option></Select></>);
    expect(input.current).toHaveAttribute("placeholder", "ör. hs.aygun");
    expect(select.current.value).toBe("b");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Field.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Field.jsx" from "src/live/ui/Field.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/ui/Field.jsx`:

```jsx
// src/live/ui/Field.jsx — the prototype's .fld (label + control) and its global input/select look.
import React, { forwardRef, useId } from "react";

// The prototype's `input, select { … }` and `:focus` rules. On focus the border turns primary
// (pri on card2: >= 3:1 in both themes) — the visible focus mark for a text field.
const CONTROL =
  "w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none "
  + "placeholder:text-mute focus:border-pri focus:shadow-[0_0_0_3px_var(--priSoft)] disabled:cursor-not-allowed disabled:opacity-45";

export const Input = forwardRef(function Input({ className = "", ...rest }, ref) {
  return <input ref={ref} className={`${CONTROL} ${className}`} {...rest} />;
});

export const Select = forwardRef(function Select({ className = "", children, ...rest }, ref) {
  return (
    <select ref={ref} className={`${CONTROL} ${className}`} {...rest}>
      {children}
    </select>
  );
});

/** One labelled control. The label is tied to it (htmlFor/id: the child's own id, else a
 *  generated one); `hint` is read with it (aria-describedby); `required` marks the label with a
 *  "*" and sets the control's required. layout: "row" — label beside the control above 860 px,
 *  as the prototype — or "col", label above. */
export function Field({ label, hint, required = false, layout = "row", className = "", children }) {
  const generated = useId();
  const child = React.Children.only(children);
  const id = child.props.id || generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [child.props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined;
  const control = React.cloneElement(child, {
    id,
    required: required || child.props.required,
    "aria-describedby": describedBy,
  });
  const grid = layout === "col" ? "grid-cols-1" : "grid-cols-1 min-[861px]:grid-cols-[150px_1fr]";
  return (
    <div className={`mb-2.5 grid items-center gap-x-3 gap-y-1.5 font-text text-13.5 ${grid} ${className}`}>
      <label htmlFor={id} className="font-semibold text-mute">
        {label}
        {required ? <span aria-hidden="true" className="text-crit-ink"> *</span> : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className={`m-0 text-12 text-mute ${layout === "col" ? "" : "min-[861px]:col-start-2"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Field.test.jsx
```
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  59 passed (59)`, `Tests  1095 passed (1095)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Field.jsx dashboard/src/live/ui/Field.test.jsx
git commit -m "feat(dashboard): live UI form field, input and select

The prototype's .fld: label tied to its control, hint read with it,
required marked on both; label beside the control above 860 px.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Table

**Files:**
- Create: `dashboard/src/live/ui/Table.jsx`
- Test: `dashboard/src/live/ui/Table.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Table.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table } from "./Table.jsx";

const rows = (
  <>
    <thead><tr><th>İstifadəçi adı</th><th>Son giriş</th></tr></thead>
    <tbody><tr><td className="font-data font-bold">dr.ornek</td><td>23.09 19:58</td></tr></tbody>
  </>
);

describe("Table", () => {
  it("is named by its caption, inside a focusable scroll region of the same name", () => {
    render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("table", { name: "İstifadəçilər" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "İstifadəçilər" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
  });

  it("renders the caller's rows and headers", () => {
    render(<Table caption="İstifadəçilər">{rows}</Table>);
    expect(screen.getByRole("columnheader", { name: "Son giriş" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "dr.ornek" })).toBeInTheDocument();
  });

  it("without a caption is no region and takes no focus", () => {
    const { container } = render(<Table>{rows}</Table>);
    expect(container.firstChild).not.toHaveAttribute("role");
    expect(container.firstChild).not.toHaveAttribute("tabindex");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Table.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Table.jsx" from "src/live/ui/Table.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/ui/Table.jsx`:

```jsx
// src/live/ui/Table.jsx — the prototype's table.t inside its .tw horizontal scroller.
import React from "react";
import { FOCUS_RING } from "./focus.js";

const TABLE = [
  "w-full border-collapse font-text text-13",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-card2 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left",
  "[&_th]:text-10.5 [&_th]:font-bold [&_th]:uppercase [&_th]:leading-[normal] [&_th]:tracking-[.08em] [&_th]:text-mute",
  "[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-[9px] [&_td]:align-middle",
  "[&_tr:last-child_td]:border-b-0",
].join(" ");

/** Callers write plain <thead>/<tbody>/<tr>/<th>/<td>; numeric cells take className="font-data
 *  font-bold" (the prototype's td.n). `caption` names the table (visually hidden) and makes the
 *  scroller a named, keyboard-focusable region, so a table wider than a 390 px phone can be
 *  scrolled without a mouse. Rows are not clickable: put a button or link in the row instead. */
export function Table({ caption, className = "", children }) {
  const region = caption ? { role: "region", "aria-label": caption, tabIndex: 0 } : {};
  return (
    <div {...region} className={`overflow-x-auto rounded-box border border-line bg-card ${FOCUS_RING} ${className}`}>
      <table className={TABLE}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Table.test.jsx
```
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  60 passed (60)`, `Tests  1098 passed (1098)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Table.jsx dashboard/src/live/ui/Table.test.jsx
git commit -m "feat(dashboard): live UI table in a keyboard-scrollable frame

The prototype's table.t and .tw: plain thead/tbody from the caller, a
visually hidden caption that also names the scroll region.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Modal dialog

**Files:**
- Create: `dashboard/src/live/ui/Modal.jsx`
- Test: `dashboard/src/live/ui/Modal.test.jsx`

The old workspace's `ActionOverlay` (`src/ui.jsx:33-84`) has the same focus-in / focus-back / Escape / `busy` rules but no focus trap; this one adds the trap and the prototype's look (`.modal`, `.mh`, `.mb`, `.mf`).

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Modal.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal.jsx";

function Harness({ busy = false, onClose = () => {}, empty = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Aç</button>
      <Modal
        open={open}
        title="Nümunə pəncərə"
        busy={busy}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        actions={empty ? null : <button type="button">Son</button>}
      >
        {empty ? <p>yalnız mətn</p> : <input aria-label="Birinci" />}
      </Modal>
    </>
  );
}

function openIt() {
  const opener = screen.getByRole("button", { name: "Aç" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its title, with a close button in the current language", () => {
    render(<Harness />);
    openIt();
    const dialog = screen.getByRole("dialog", { name: "Nümunə pəncərə" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Bağla" })).toBeInTheDocument();
  });

  it("moves focus to the body's first control", () => {
    render(<Harness />);
    openIt();
    expect(document.activeElement).toBe(screen.getByLabelText("Birinci"));
  });

  it("focuses the dialog itself when the body has no control", () => {
    render(<Harness empty />);
    openIt();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("keeps Tab and Shift+Tab inside", () => {
    render(<Harness />);
    openIt();
    const close = screen.getByRole("button", { name: "Bağla" });
    const last = screen.getByRole("button", { name: "Son" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape and gives focus back to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = openIt();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on the ✕ and on a press on the backdrop, not on one inside", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openIt();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Bağla" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stays open while busy", () => {
    const onClose = vi.fn();
    render(<Harness busy onClose={onClose} />);
    openIt();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("button", { name: "Bağla" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Modal.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Modal.jsx" from "src/live/ui/Modal.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/ui/Modal.jsx`:

```jsx
// src/live/ui/Modal.jsx — the prototype's H.modal as a React dialog.
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Button } from "./Button.jsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal dialog (role="dialog", aria-modal), named by its title.
 *  - Opening moves focus into it: the body's first control, else the dialog itself. Closing
 *    returns focus to whatever had it before.
 *  - Tab and Shift+Tab stay inside (focus trap). Escape, the ✕ and a press on the backdrop call
 *    onClose — except while `busy`: a request is in flight and its answer must land in an open
 *    dialog (the old workspace's ActionOverlay rule).
 *  - Rendered in a portal under <body>, so it takes <html data-theme> like everything else.
 *  `actions` is the footer (the prototype's .mf), `wide` its 1180 px variant. */
export function Modal({ open, ...props }) {
  if (!open) return null;
  return createPortal(<Dialog {...props} />, document.body);
}

function Dialog({ title, onClose, actions, wide = false, busy = false, children }) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  // Read during the first render, before the effect below moves focus into the dialog.
  const [opener] = useState(() => document.activeElement);
  const close = () => {
    if (!busy && onClose) onClose();
  };

  useEffect(() => {
    (bodyRef.current?.querySelector(FOCUSABLE) || dialogRef.current)?.focus();
    return () => {
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, [opener]);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      data-testid="modal-backdrop"
      className="fixed inset-0 z-[100] grid place-items-center bg-[rgba(2,6,14,.55)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-[calc(100vh-32px)] overflow-auto rounded-dlg border border-line2 bg-app font-text text-14.5 text-ink shadow-pop outline-none ${wide ? "w-[min(1180px,100%)]" : "w-[min(760px,100%)]"}`}
      >
        <div className="sticky top-0 z-[2] flex items-center gap-2.5 border-b border-line bg-app px-[18px] py-3.5">
          <h2 id={titleId} className="m-0 font-display text-17 font-bold leading-[normal]">{title}</h2>
          <Button variant="ghost" size="sm" icon="x" label={t("common.close")} onClick={close} disabled={busy} className="ml-auto" />
        </div>
        <div ref={bodyRef} className="px-[18px] py-4">{children}</div>
        {actions ? (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-app px-[18px] py-3">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Modal.test.jsx
```
Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  61 passed (61)`, `Tests  1106 passed (1106)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Modal.jsx dashboard/src/live/ui/Modal.test.jsx
git commit -m "feat(dashboard): live UI modal with a focus trap

Named by its title; focus moves in and comes back; Tab and Shift+Tab stay
inside; Escape, the close button and the backdrop close it, except while
busy. In a portal, so it follows the theme on <html>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Toasts

**Files:**
- Create: `dashboard/src/live/ui/Toast.jsx`
- Test: `dashboard/src/live/ui/Toast.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/ui/Toast.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ToastProvider, useToast, TOAST_MS } from "./Toast.jsx";

function Fire({ message, tone }) {
  const toast = useToast();
  return <button type="button" onClick={() => toast(message, tone)}>{`fire ${message}`}</button>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const region = () => screen.getByRole("region", { name: "Bildirişlər" });

describe("toasts", () => {
  it("have a named live region before the first toast", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    expect(region().firstChild).toHaveAttribute("aria-live", "polite");
    expect(region().firstChild).toBeEmptyDOMElement();
  });

  it("show the message, and disappear after 3.6 s", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire Yadda saxlanıldı"));
    expect(within(region()).getByText("Yadda saxlanıldı")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(within(region()).getByText("Yadda saxlanıldı")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(within(region()).queryByText("Yadda saxlanıldı")).toBeNull();
  });

  it("close at once from their close button", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire Yadda saxlanıldı"));
    fireEvent.click(within(region()).getByRole("button", { name: "Bağla" }));
    expect(within(region()).queryByText("Yadda saxlanıldı")).toBeNull();
  });

  it("carry their tone, ok for one they do not know", () => {
    render(
      <ToastProvider>
        <Fire message="xəta" tone="error" />
        <Fire message="nə" tone="loud" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire xəta"));
    fireEvent.click(screen.getByText("fire nə"));
    expect(within(region()).getByText("xəta").parentElement).toHaveAttribute("data-tone", "error");
    expect(within(region()).getByText("nə").parentElement).toHaveAttribute("data-tone", "ok");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Toast.test.jsx
```
Expected: FAIL — `Failed to resolve import "./Toast.jsx" from "src/live/ui/Toast.test.jsx". Does the file exist?`

- [ ] **Step 3: Implement** — `dashboard/src/live/ui/Toast.jsx`:

```jsx
// src/live/ui/Toast.jsx — the prototype's H.toast: short confirmations, bottom right.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Button } from "./Button.jsx";

export const TOAST_MS = 3600; // the prototype's lifetime

const TONE = { ok: "border-l-ok", warn: "border-l-mid", error: "border-l-crit" };

const ToastContext = createContext(() => {
  if (import.meta.env.DEV) console.warn("useToast: no <ToastProvider> above this component");
});

/** const toast = useToast(); toast("Yadda saxlanıldı"); toast("…", "warn" | "error").
 *  One polite live region announces every toast; it exists before the first one, so a screen
 *  reader hears that one too. Each toast has a close button for whoever cannot read it in 3.6 s.
 *  Not for alarms: a clinical alarm never disappears on a timer. */
export function ToastProvider({ children }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((message, tone = "ok") => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list, { id, message, tone: TONE[tone] ? tone : "ok" }]);
    timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS));
    return id;
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const handle of pending.values()) clearTimeout(handle);
    };
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div role="region" aria-label={t("common.notifications")} className="pointer-events-none fixed bottom-4 right-4 z-[120]">
          <div aria-live="polite" className="flex flex-col gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                data-tone={item.tone}
                className={`pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-xl border border-l-4 border-line2 bg-card py-2.5 pl-3.5 pr-2 font-text text-13.5 font-semibold text-ink shadow-pop ${TONE[item.tone]}`}
              >
                <span className="flex-1">{item.message}</span>
                <Button variant="ghost" size="sm" icon="x" label={t("common.close")} onClick={() => dismiss(item.id)} />
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
```

- [ ] **Step 4: Run it to see it pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/ui/Toast.test.jsx
```
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  62 passed (62)`, `Tests  1110 passed (1110)`, `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/ui/Toast.jsx dashboard/src/live/ui/Toast.test.jsx
git commit -m "feat(dashboard): live UI toasts in a polite live region

The prototype's H.toast: ok, warn, error; gone after 3.6 s, or at once
from its close button. The region exists before the first toast, so a
screen reader hears that one too.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: The design gallery

**Files:**
- Create: `dashboard/src/live/i18n/strings/gallery.js`, `dashboard/src/live/ui/index.js`, `dashboard/src/live/gallery/DesignGallery.jsx`
- Modify: `dashboard/src/live/i18n/catalog.js` (two lines)
- Test: `dashboard/src/live/gallery/DesignGallery.test.jsx`

- [ ] **Step 1: Write the failing test** — `dashboard/src/live/gallery/DesignGallery.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DesignGallery from "./DesignGallery.jsx";
import { ICON_NAMES } from "../ui/icons.js";
import { COLOR_TOKENS } from "../theme/tokens.js";

const html = document.documentElement;

afterEach(() => {
  localStorage.clear();
  delete html.dataset.theme;
  delete html.dataset.size;
  html.removeAttribute("lang");
});

describe("design gallery", () => {
  it("opens in Azerbaijani and Gece, and switches language", () => {
    render(<DesignGallery />);
    expect(screen.getByRole("heading", { level: 1, name: "Dizayn qalereyası" })).toBeInTheDocument();
    expect(html.lang).toBe("az");
    expect(html.dataset.theme).toBe("gece");
    fireEvent.click(screen.getByRole("button", { name: "Türkçe" }));
    expect(screen.getByRole("heading", { level: 1, name: "Tasarım galerisi" })).toBeInTheDocument();
    expect(html.lang).toBe("tr");
  });

  it("switches theme and text size", () => {
    render(<DesignGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Gün işığı" }));
    fireEvent.click(screen.getByRole("button", { name: "Böyük" }));
    expect(html.dataset.theme).toBe("gun");
    expect(html.dataset.size).toBe("buyuk");
  });

  it("shows every colour token in both themes", () => {
    render(<DesignGallery />);
    const table = screen.getByRole("table", { name: "Rənglər" });
    expect(within(table).getAllByRole("row")).toHaveLength(COLOR_TOKENS.length + 1);
    expect(table.querySelectorAll('[data-theme="gece"]')).toHaveLength(COLOR_TOKENS.length);
    expect(table.querySelectorAll('[data-theme="gun"]')).toHaveLength(COLOR_TOKENS.length);
  });

  it("shows every icon by name", () => {
    render(<DesignGallery />);
    const icons = screen.getByRole("region", { name: "İkonlar" });
    for (const name of ICON_NAMES) expect(within(icons).getByText(name)).toBeInTheDocument();
    expect(icons.querySelectorAll("svg")).toHaveLength(ICON_NAMES.length);
  });

  it("shows every engine risk, none of them green", () => {
    render(<DesignGallery />);
    const components = screen.getByRole("region", { name: "Komponentlər" });
    for (const label of ["Kritik", "Yüksək", "Orta", "Aşağı", "Məlumat", "Tapıntı yoxdur", "Ölçülməyib", "Naməlum risk: stable"]) {
      const pill = within(components).getAllByText(label).find((el) => el.hasAttribute("data-tone"));
      expect(pill, label).toBeDefined();
      expect(pill.getAttribute("data-tone"), label).not.toBe("ok");
    }
  });

  it("opens and closes the sample dialog, and shows a toast", () => {
    render(<DesignGallery />);
    fireEvent.click(screen.getByRole("button", { name: "Pəncərəni aç" }));
    expect(screen.getByRole("dialog", { name: "Nümunə pəncərə" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bildiriş göstər" }));
    expect(within(screen.getByRole("region", { name: "Bildirişlər" })).getByText("Yadda saxlanıldı")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/gallery/
```
Expected: FAIL — `Failed to resolve import "./DesignGallery.jsx" from "src/live/gallery/DesignGallery.test.jsx". Does the file exist?`

- [ ] **Step 3: The gallery's strings** — `dashboard/src/live/i18n/strings/gallery.js`:

```js
// The design gallery (?tasarim=1) — a review page, not a product screen.
// From the prototype's dictionary (ceviri-sozluk / keyed H.t): seen, snooze, escalate, edit,
// open, criticalOnly, myPatients, users, roles, username, status, lastLogin, mfaRequired,
// allUnits, on, active, warning. Everything else is new and awaits native review.
export default {
  tr: {
    title: "Tasarım galerisi",
    intro: "Yalnız inceleme için; uygulamadan bağlantı verilmez. Prototiple yan yana karşılaştırın.",
    colours: "Renkler", token: "Değişken", type: "Yazı tipleri", icons: "Simgeler", components: "Bileşenler",
    buttons: "Düğmeler", boxes: "Kutular", choices: "Seçimler", tags: "Etiketler", risks: "Risk düzeyleri",
    form: "Form", notes: "Notlar", dialogs: "Pencere ve bildirim",
    specimen: "Pijamalı hasta yağız şoföre çabucak güvendi.",
    seen: "Gördüm", snooze: "Ertele", escalate: "Eskale", edit: "Düzenle",
    open: "Açık · {n}", criticalOnly: "Yalnız kritik", myPatients: "Benim hastalarım",
    users: "Kullanıcılar", roles: "Roller ve yetkiler",
    username: "Kullanıcı adı", status: "Durum", lastLogin: "Son giriş",
    mfaRequired: "Zorunlu · kurulmadı", allUnits: "Tüm birimler", on: "Açık", active: "Aktif",
    usernameHint: "Küçük harf, rakam, nokta · değiştirilemez",
    auditNote: "Değişiklikler denetim kaydına yazılır.",
    slowNote: "Bağlantı yavaş; veriler gecikebilir.",
    noMatch: "Eşleşen kayıt yok.",
    openDialog: "Pencereyi aç", dialogTitle: "Örnek pencere", showToast: "Bildirim göster",
    saved: "Kaydedildi", warning: "Uyarı", failed: "Kaydedilemedi",
  },
  az: {
    title: "Dizayn qalereyası",
    intro: "Yalnız baxış üçündür; tətbiqdən bura keçid yoxdur. Prototiplə yan-yana müqayisə edin.",
    colours: "Rənglər", token: "Dəyişən", type: "Şriftlər", icons: "İkonlar", components: "Komponentlər",
    buttons: "Düymələr", boxes: "Qutular", choices: "Seçimlər", tags: "Etiketlər", risks: "Risk səviyyələri",
    form: "Forma", notes: "Qeydlər", dialogs: "Pəncərə və bildiriş",
    specimen: "Zəfər, jaketini də papağını da götür, bu axşam hava çox soyuq olacaq.",
    seen: "Gördüm", snooze: "Təxirə sal", escalate: "Eskalasiya", edit: "Düzəliş et",
    open: "Açıq · {n}", criticalOnly: "Yalnız kritik", myPatients: "Mənim xəstələrim",
    users: "İstifadəçilər", roles: "Rollar və səlahiyyətlər",
    username: "İstifadəçi adı", status: "Vəziyyət", lastLogin: "Son giriş",
    mfaRequired: "Məcburi · qurulmayıb", allUnits: "Bütün bölmələr", on: "Açıq", active: "Aktiv",
    usernameHint: "Kiçik hərf, rəqəm, nöqtə · dəyişdirilə bilməz",
    auditNote: "Dəyişikliklər audit jurnalına yazılır.",
    slowNote: "Bağlantı yavaşdır; məlumatlar gecikə bilər.",
    noMatch: "Uyğun qeyd yoxdur.",
    openDialog: "Pəncərəni aç", dialogTitle: "Nümunə pəncərə", showToast: "Bildiriş göstər",
    saved: "Yadda saxlanıldı", warning: "Xəbərdarlıq", failed: "Yadda saxlanılmadı",
  },
  ru: {
    title: "Галерея дизайна",
    intro: "Только для просмотра; из приложения сюда ссылок нет. Сравните с прототипом.",
    colours: "Цвета", token: "Переменная", type: "Шрифты", icons: "Значки", components: "Компоненты",
    buttons: "Кнопки", boxes: "Блоки", choices: "Выбор", tags: "Метки", risks: "Уровни риска",
    form: "Форма", notes: "Примечания", dialogs: "Окно и уведомление",
    specimen: "Съешь же ещё этих мягких французских булок, да выпей чаю.",
    seen: "Принято", snooze: "Отложить", escalate: "Эскалировать", edit: "Изменить",
    open: "Открыто · {n}", criticalOnly: "Только критические", myPatients: "Мои пациенты",
    users: "Пользователи", roles: "Роли и права",
    username: "Имя пользователя", status: "Статус", lastLogin: "Последний вход",
    mfaRequired: "Обязательно · не настроено", allUnits: "Все отделения", on: "Вкл.", active: "Активно",
    usernameHint: "Строчные буквы, цифры, точка · изменить нельзя",
    auditNote: "Изменения записываются в журнал аудита.",
    slowNote: "Соединение медленное; данные могут задерживаться.",
    noMatch: "Совпадающих записей нет.",
    openDialog: "Открыть окно", dialogTitle: "Пример окна", showToast: "Показать уведомление",
    saved: "Сохранено", warning: "Предупреждение", failed: "Не удалось сохранить",
  },
  en: {
    title: "Design gallery",
    intro: "For review only; nothing in the app links here. Compare it side by side with the prototype.",
    colours: "Colours", token: "Token", type: "Typefaces", icons: "Icons", components: "Components",
    buttons: "Buttons", boxes: "Boxes", choices: "Choices", tags: "Tags", risks: "Risk levels",
    form: "Form", notes: "Notes", dialogs: "Dialog and toast",
    specimen: "The quick brown fox jumps over the lazy dog.",
    seen: "Seen", snooze: "Snooze", escalate: "Escalate", edit: "Edit",
    open: "Open · {n}", criticalOnly: "Critical only", myPatients: "My patients",
    users: "Users", roles: "Roles and permissions",
    username: "Username", status: "Status", lastLogin: "Last login",
    mfaRequired: "Required · not set up", allUnits: "All units", on: "On", active: "Active",
    usernameHint: "Lower-case letters, digits, dot · cannot be changed",
    auditNote: "Changes are written to the audit log.",
    slowNote: "The connection is slow; data may be delayed.",
    noMatch: "No matching records.",
    openDialog: "Open dialog", dialogTitle: "Sample dialog", showToast: "Show notification",
    saved: "Saved", warning: "Warning", failed: "Could not save",
  },
};
```

Register it in `dashboard/src/live/i18n/catalog.js`: after `import news2 from "./strings/news2.js";` add

```js
import gallery from "./strings/gallery.js";
```

and change `export const NAMESPACES = { common, risk, prefs, news2 };` to

```js
export const NAMESPACES = { common, risk, prefs, news2, gallery };
```

- [ ] **Step 4: The components barrel** — `dashboard/src/live/ui/index.js`:

```js
// src/live/ui/index.js — the live UI's base components, for screens to import from one place.
export { Icon } from "./Icon.jsx";
export { ICON_NAMES } from "./icons.js";
export { FOCUS_RING } from "./focus.js";
export { Button } from "./Button.jsx";
export { Box } from "./Box.jsx";
export { Note } from "./Note.jsx";
export { Empty } from "./Empty.jsx";
export { KV, KVList } from "./KV.jsx";
export { Tag, Pill, StatusPill, STATUS_TONES } from "./Tag.jsx";
export { riskStyle, ENGINE_RISKS } from "./riskStyle.js";
export { RiskPill } from "./RiskPill.jsx";
export { Seg } from "./Seg.jsx";
export { Tabs, TabPanel } from "./Tabs.jsx";
export { Field, Input, Select } from "./Field.jsx";
export { Table } from "./Table.jsx";
export { Modal } from "./Modal.jsx";
export { ToastProvider, useToast, TOAST_MS } from "./Toast.jsx";
```

- [ ] **Step 5: The page** — `dashboard/src/live/gallery/DesignGallery.jsx`:

```jsx
// src/live/gallery/DesignGallery.jsx — design review page, opened with ?tasarim=1.
//
// Every token, face, icon and base component of the live UI on one page, with switches for theme,
// text size and language, so the result can be compared side by side with the prototype
// (tasarim-taslaklari/app, anasayfa/gorsel/*.webp). No API, no patient data, not linked from the
// app. Loaded lazily from main.jsx: none of it is in the main bundle.
import "../theme/assets.js";
import React, { useState } from "react";
import { ThemeProvider, useTheme } from "../theme/ThemeProvider.jsx";
import { COLOR_TOKENS, kebab } from "../theme/tokens.js";
import { I18nProvider, useI18n } from "../i18n/I18nProvider.jsx";
import {
  Box, Button, Empty, ENGINE_RISKS, Field, Icon, ICON_NAMES, Input, KV, KVList, Modal, Note, Pill,
  RiskPill, Seg, Select, StatusPill, Table, TabPanel, Tabs, Tag, ToastProvider, useToast,
} from "../ui/index.js";

export default function DesignGallery() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <Gallery />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="mb-3 font-display text-17 font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ title, children }) {
  return (
    <div className="mt-5">
      <h3 className="mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{title}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Gallery() {
  const { t, lang, setLang, langs } = useI18n();
  const { theme, setTheme, size, setSize } = useTheme();
  return (
    <main className="min-h-full bg-page px-4 pb-10 pt-[18px] font-text text-14.5 leading-[1.5] text-ink sm:px-5">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("gallery.title")}</h1>
          <p className="mb-0 mt-1 text-13 text-mute">{t("gallery.intro")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Seg
            label={t("prefs.theme")}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "gece", label: t("prefs.themeGece"), icon: "moon" },
              { value: "gun", label: t("prefs.themeGun"), icon: "sun" },
            ]}
          />
          <Seg
            label={t("prefs.size")}
            value={size}
            onChange={setSize}
            options={[
              { value: "normal", label: t("prefs.sizeNormal") },
              { value: "buyuk", label: t("prefs.sizeBuyuk") },
            ]}
          />
          <Seg
            label={t("prefs.lang")}
            value={lang}
            onChange={setLang}
            options={langs.map((l) => ({ value: l.code, label: l.native, lang: l.code }))}
          />
        </div>
      </header>
      <Colours />
      <Typefaces />
      <Icons />
      <Components />
    </main>
  );
}

function Colours() {
  const { t } = useI18n();
  return (
    <Section id="g-colours" title={t("gallery.colours")}>
      <Table caption={t("gallery.colours")}>
        <thead>
          <tr>
            <th>{t("gallery.token")}</th>
            <th>{t("prefs.themeGece")}</th>
            <th>{t("prefs.themeGun")}</th>
          </tr>
        </thead>
        <tbody>
          {COLOR_TOKENS.map((name) => (
            <tr key={name}>
              <td className="font-data text-12">
                --{name} <span className="text-mute">· {kebab(name)}</span>
              </td>
              {["gece", "gun"].map((th) => (
                <td key={th}>
                  <div data-theme={th} className="inline-block rounded-lg bg-page p-1.5">
                    <div className="h-6 w-24 rounded-md border border-line" style={{ backgroundColor: `var(--${name})` }} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

const FACES = [
  ["font-display", "Space Grotesk · --font-display", "text-23 font-bold"],
  ["font-text", "Figtree · --font-text", "text-14.5"],
  ["font-data", "JetBrains Mono · --font-data", "text-13 font-bold"],
];
const SIZE_CLASSES = ["text-10", "text-10.5", "text-11", "text-11.5", "text-12", "text-12.5", "text-13", "text-13.5", "text-14", "text-14.5", "text-17", "text-23"];
const GLYPHS = "Ə ə · Ğ ğ · İ ı · Ş ş · Ç ç · Ö ö · Ü ü · Ж щ ё Ю я · 0123456789";

function Typefaces() {
  const { t } = useI18n();
  return (
    <Section id="g-type" title={t("gallery.type")}>
      <div className="grid gap-3">
        {FACES.map(([face, name, sizeClass]) => (
          <Box key={face} title={name}>
            <p className={`m-0 ${face} ${sizeClass}`}>{t("gallery.specimen")}</p>
            <p className={`mb-0 mt-1 ${face} ${sizeClass}`} translate="no">{GLYPHS}</p>
          </Box>
        ))}
        <Box title="--fs">
          <ul className="m-0 flex list-none flex-wrap items-baseline gap-4 p-0">
            {SIZE_CLASSES.map((cls) => (
              <li key={cls} className={cls}>{cls.replace("text-", "")}</li>
            ))}
          </ul>
        </Box>
      </div>
    </Section>
  );
}

function Icons() {
  const { t } = useI18n();
  return (
    <Section id="g-icons" title={t("gallery.icons")}>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 p-0">
        {ICON_NAMES.map((name) => (
          <li key={name} className="flex flex-col items-center gap-1.5 rounded-box border border-line bg-card px-2 py-3">
            <Icon name={name} size={22} />
            <span className="font-data text-11 text-mute">{name}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Components() {
  const { t } = useI18n();
  const toast = useToast();
  const [filter, setFilter] = useState("open");
  const [tab, setTab] = useState("users");
  const [dialog, setDialog] = useState(false);
  return (
    <Section id="g-components" title={t("gallery.components")}>
      <Sub title={t("gallery.buttons")}>
        <Button>{t("common.cancel")}</Button>
        <Button variant="primary" icon="userPlus">{t("common.save")}</Button>
        <Button variant="danger">{t("gallery.escalate")}</Button>
        <Button variant="ghost">{t("common.close")}</Button>
        <Button variant="primary" size="sm">{t("gallery.seen")}</Button>
        <Button size="sm">{t("gallery.snooze")}</Button>
        <Button variant="danger" size="sm">{t("gallery.escalate")}</Button>
        <Button variant="ghost" size="sm" icon="edit" label={t("gallery.edit")} />
        <Button variant="primary" size="lg">{t("common.save")}</Button>
        <Button disabled>{t("common.save")}</Button>
      </Sub>

      <Sub title={t("gallery.boxes")}>
        <Box title={t("gallery.status")} icon="user" right="hs.ornek" className="w-full max-w-sm">
          <KVList>
            <KV label={t("gallery.username")}>hs.ornek</KV>
            <KV label={t("gallery.lastLogin")}>23.09 19:58</KV>
            <KV label={t("gallery.status")} mono={false}><StatusPill tone="ok">{t("gallery.active")}</StatusPill></KV>
          </KVList>
        </Box>
      </Sub>

      <Sub title={t("gallery.choices")}>
        <Seg
          label={t("gallery.choices")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t("gallery.open", { n: 3 }) },
            { value: "crit", label: t("gallery.criticalOnly") },
            { value: "mine", label: t("gallery.myPatients") },
          ]}
        />
        <div className="w-full">
          <Tabs
            id="g-tabs"
            label={t("gallery.choices")}
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "users", label: t("gallery.users") },
              { value: "roles", label: t("gallery.roles"), count: 2 },
            ]}
          />
          <TabPanel id="g-tabs" value={tab}>
            <p className="m-0 text-13 text-mute">{tab === "users" ? t("gallery.users") : t("gallery.roles")}</p>
          </TabPanel>
        </div>
      </Sub>

      <Sub title={t("gallery.tags")}>
        <Tag>{t("gallery.allUnits")}</Tag>
        <Tag tone="warn">{t("gallery.mfaRequired")}</Tag>
        <Tag tone="crit" icon="lock">{t("risk.critical")}</Tag>
        <Pill icon="ok">{t("gallery.on")}</Pill>
        <StatusPill tone="ok">{t("gallery.active")}</StatusPill>
      </Sub>

      <Sub title={t("gallery.risks")}>
        {ENGINE_RISKS.map((risk) => (
          <RiskPill key={risk} risk={risk} />
        ))}
        <RiskPill risk="none" measured={false} />
        <RiskPill risk="stable" />
      </Sub>

      <Sub title={t("gallery.form")}>
        <div className="w-full max-w-xl">
          <Field label={t("gallery.username")} hint={t("gallery.usernameHint")} required>
            <Input placeholder="hs.ornek" autoComplete="off" />
          </Field>
          <Field label={t("prefs.lang")}>
            <Select defaultValue="az">
              {[["az", "Azərbaycan"], ["tr", "Türkçe"], ["ru", "Русский"], ["en", "English"]].map(([code, name]) => (
                <option key={code} value={code} lang={code}>{name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Sub>

      <Sub title={t("gallery.notes")}>
        <div className="grid w-full max-w-xl gap-2">
          <Note icon="alert">{t("gallery.slowNote")}</Note>
          <Note tone="info" icon="shield">{t("gallery.auditNote")}</Note>
          <Empty icon="search">{t("gallery.noMatch")}</Empty>
        </div>
      </Sub>

      <Sub title={t("gallery.dialogs")}>
        <Button onClick={() => setDialog(true)}>{t("gallery.openDialog")}</Button>
        <Button onClick={() => toast(t("gallery.saved"))}>{t("gallery.showToast")}</Button>
        <Button onClick={() => toast(t("gallery.warning"), "warn")}>{t("gallery.warning")}</Button>
        <Button onClick={() => toast(t("gallery.failed"), "error")}>{t("gallery.failed")}</Button>
        <Modal
          open={dialog}
          title={t("gallery.dialogTitle")}
          onClose={() => setDialog(false)}
          actions={(
            <>
              <Button onClick={() => setDialog(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={() => setDialog(false)}>{t("common.save")}</Button>
            </>
          )}
        >
          <Field label={t("gallery.username")}><Input placeholder="hs.ornek" /></Field>
          <Note tone="info">{t("gallery.auditNote")}</Note>
        </Modal>
      </Sub>
    </Section>
  );
}
```

- [ ] **Step 6: Run the gallery and dictionary tests**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/live/gallery/ src/live/i18n/
```
Expected: `Test Files  4 passed (4)`, `Tests  25 passed (25)` (gallery 6; translate 7, strings 4 — now also over the `gallery` namespace — I18nProvider 8).

- [ ] **Step 7: Gate**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: `Test Files  63 passed (63)`, `Tests  1116 passed (1116)`, `✓ built in …` (nothing imports the gallery yet; Task 19 routes to it).

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/live/i18n/strings/gallery.js dashboard/src/live/i18n/catalog.js dashboard/src/live/ui/index.js dashboard/src/live/gallery/DesignGallery.jsx dashboard/src/live/gallery/DesignGallery.test.jsx
git commit -m "feat(dashboard): design gallery for the live UI foundation

Every token in both themes, the three faces with AZ/RU glyphs, every icon
and every base component, with theme, text-size and language switches —
for comparing against the prototype. No API, no patient data.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: `?tasarim=1` opens the gallery

**Files:**
- Modify: `dashboard/src/main.jsx:28`, `:48`, `:54`
- Test: `dashboard/src/routing.test.js` (append)

- [ ] **Step 1: Write the failing tests.** Append to the end of `dashboard/src/routing.test.js`, after the closing `});` of `describe("AppShell", …)` (the file already imports `createElement`, `render` and `AppShell`):

```js

describe("design gallery (?tasarim=1)", () => {
  it("opens the new UI's design gallery", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1"))).toBe("tasarim");
  });

  it("never wins over an explicit ?live=1", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1&live=1"))).toBe("live");
  });

  it("gets no demo banner: it shows no data", () => {
    const { container } = render(createElement(AppShell, { mode: "tasarim" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to see the first fail**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/routing.test.js
```
Expected: `Tests  1 failed | 11 passed (12)` — `opens the new UI's design gallery`: `expected 'live' to be 'tasarim'`.

- [ ] **Step 3: Route it — three separate insertions in `dashboard/src/main.jsx`.**

(a) In `chooseMode`, replace the line

```js
  if (params.get("board") === "1") return "board";
```

with

```js
  if (params.get("board") === "1") return "board";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
```

(b) In `pickRoot`, replace the line

```js
  // ?board=1 → the legacy bearer-token board. It authenticates with a tenant token, so on any
```

with

```js
  if (mode === "tasarim") {
    return <React.Suspense fallback={null}><DesignGallery /></React.Suspense>;
  }
  // ?board=1 → the legacy bearer-token board. It authenticates with a tenant token, so on any
```

(c) Replace the line

```js
// #/demo is an older deep link into the simulation; honour it ahead of the query string.
```

with

```js
// Lazy: the gallery and its fonts load only when ?tasarim=1 asks for them.
const DesignGallery = React.lazy(() => import("./live/gallery/DesignGallery.jsx"));

// #/demo is an older deep link into the simulation; honour it ahead of the query string.
```

No import line changes (`React` is already imported; `React.lazy` / `React.Suspense` need nothing else). `chooseMode` now reads:

```js
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  if (params.get("demo") === "1") return "demo";
  if (params.get("mode") === "replay" || params.has("scenario")) return "replay";
  if (params.get("board") === "1") return "board";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  return "live";
}
```

`AppShell` needs no change: it draws the demo banner only for `demo` and `replay`.

- [ ] **Step 4: Run them to see them pass**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vitest run src/routing.test.js
```
Expected: `Tests  12 passed (12)`.

- [ ] **Step 5: Gate, and check the build split the gallery out**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
ls dist/assets | grep -E "DesignGallery|space-grotesk|jetbrains-mono"
grep -rl "fonts.googleapis\|fonts.gstatic" dist || echo "no Google Fonts"
```
Expected: `Test Files  63 passed (63)`, `Tests  1119 passed (1119)`, `✓ built in …`; then `DesignGallery-<hash>.css`, `DesignGallery-<hash>.js`, three `space-grotesk-*-wght-normal-<hash>.woff2` and five `jetbrains-mono-*-wght-normal-<hash>.woff2` (its 2 kB `cyrillic-ext` subset is under Vite's 4 kB inline limit and sits inside the gallery CSS); then `no Google Fonts`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/homunculus-g1
git add dashboard/src/main.jsx dashboard/src/routing.test.js
git commit -m "feat(dashboard): ?tasarim=1 opens the live UI design gallery

Checked after every existing mode, so ?live=1 still wins; lazily loaded,
so the main bundle does not grow; no demo banner; not linked anywhere and
not the PWA start URL.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Guide, roadmap, final verification and the visual review

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (after line 305)
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md:81-82, 217, 239` and a new section before "Kullanıcı kararları (Dalga 0 sonrası)"

- [ ] **Step 1: Glossary.** In `docs/homunculus-rehber-TR.md`, after the line `  ölçmenin yolu. İleride kanıt için en değerli deney.` (end of **Silent mode**), insert:

```markdown

**Tasarım değişkeni (design token)**
- *Basit:* Ekrandaki her rengin, yazı boyunun ve yazı tipinin tek bir yerde adı konmuş hâli
  (`--card`, `--crit`, `--font-text`). Bileşen "kırmızı" yazmaz, "kritik" der; Gece/Gün teması
  yalnız bu değerleri değiştirir.
- *Homunculus'ta:* Yeni arayüzün değişkenleri `dashboard/src/live/theme/tokens.css`'te,
  prototipin adlarıyla. Tailwind sınıfı adın kendisidir (`bg-card`, `text-crit-ink`).

**Kontrast oranı (WCAG AA)**
- *Basit:* Yazının zemine göre ne kadar okunur olduğu: 1:1 (görünmez) ile 21:1 (beyaz üstünde
  siyah) arası. Normal yazı en az 4,5:1, odak çerçevesi gibi arayüz işaretleri en az 3:1 olmalı.
- *Homunculus'ta:* Bir test her renk çiftini hesaplar. Prototipin Gün temasındaki risk hapları
  2,6–3,9:1'di; bu yüzden risk yazısı ayrı, koyu "mürekkep" renkleriyle yazılır. Gece nöbetinde
  okunamayan bir "kritik" etiketi, hiç olmamasından kötüdür.

**Tasarım galerisi (`?tasarim=1`)**
- *Basit:* Yeni arayüzün bütün renk, yazı, simge ve parçalarını tek sayfada, iki temada ve dört
  dilde gösteren inceleme sayfası. Uygulamadan bağlantı verilmez; adrese elle yazılır.
- *Homunculus'ta:* Varsayılan dil Azerbaycanca'dır (yol haritası D2); seçilen dil, tema ve yazı
  boyu tarayıcıda saklanır. Hasta verisi hiçbir zaman çevrilmez — yalnız arayüz metinleri.
```

- [ ] **Step 2: Roadmap status.** Get the date and the commit range:

```bash
cd /c/tmp/homunculus-g1
date +%d.%m
git log --reverse --format=%h fd15f04..HEAD -- dashboard/src/live dashboard/src/main.jsx | sed -n '1p;$p'
```
Expected: today's date (e.g. `04.10`) and two short hashes — the Task 1 commit and the Task 19 commit. In `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, replace the two rows

```markdown
| G1-05 | Tasarım temeli: Gece/Gün renk değişkenleri, fontlar (yerel paket), ikonlar, temel bileşenler — `dashboard/src/live/` | 5 | Düşük | G1-02 | Bekliyor |
| G1-06 | Dört dil çatısı (anahtarlı sözlük, D2 varsayılanı) | 3 | Düşük | G1-05 | Bekliyor |
```

with (put the date and the two hashes printed above where the rows say `<tarih>`, `<ilk>`, `<son>`):

```markdown
| G1-05 | Tasarım temeli: Gece/Gün renk değişkenleri, fontlar (yerel paket), ikonlar, temel bileşenler — `dashboard/src/live/` · plan: [dalga 1B](2026-10-03-g1-dalga1b-tasarim-temeli.md) | 5 | Düşük | G1-02 | ✅ <tarih> · <ilk>…<son> |
| G1-06 | Dört dil çatısı (anahtarlı sözlük, D2 varsayılanı) · plan: [dalga 1B](2026-10-03-g1-dalga1b-tasarim-temeli.md) | 3 | Düşük | G1-05 | ✅ <tarih> · <ilk>…<son> |
```

- [ ] **Step 3: The two G1-06 items.** In the same file, append to the end of the line that starts `- simulationGating · Dil algılama bugün İngilizce yerel ayarda TR` (after `→ G1-06`):

```markdown
 ✅ Yeni kabukta `src/live/i18n/I18nProvider.test.jsx` (AZ varsayılan, algılama yok, saklanan seçim kazanır); `i18n.rbac.test.js`'teki eski vakalar eski çalışma alanını G1-16'ya kadar korur.
```

and to the end of the line ``- Kısmi NEWS2 ipucu ve `NEWS2_MISSING_LABEL` yalnız Türkçe. → G1-06``:

```markdown
 ✅ Dört dilde `src/live/i18n/strings/news2.js`; karta G1-09 bağlar.
```

- [ ] **Step 4: What this wave leaves open.** In the same file, directly before the line `## Kullanıcı kararları (Dalga 0 sonrası)`, insert:

```markdown
## Dalga 1B'den açık kalanlar

- Giriş kutusu kenarı (`--line2`) karta karşı 1,5:1 (WCAG arayüz ölçütü 3:1); odaklanınca `--pri` olur. Bütün kenarları koyulaştırmak tasarım kararı → kullanıcıya soru.
- Prototip dışı yeni metinler (`risk.none/unmeasured/unknown`, `news2.*`, galerinin çoğu) AZ/RU/EN'de anadili konuşan bir klinisyenin okumasını bekliyor → pilot öncesi.
- Prototipin Gün temasında monitör paneli (`--monbg`) üzerindeki vital renkleri 1,2–3,8:1; `--monbg` taşınmadı → Grup 2 monitörü taşırken düzeltir.
- Otomatik tema (20:00–08:00) yalnız mobil prototipte vardı; web için ertelendi → G1-07 ya da sonrası.

```

- [ ] **Step 5: Final verification**

```bash
cd /c/tmp/homunculus-g1/dashboard
npx vitest run src/live/ 2>&1 | tail -5
npx vitest run 2>&1 | tail -5
npx vite build 2>&1 | grep -E "built in|error"
cd /c/tmp/homunculus-g1
git diff --stat fd15f04..HEAD -- dashboard/src/ClinicalDemo.jsx dashboard/src/ui.jsx dashboard/src/clinicalTheme.js dashboard/src/theme.js dashboard/src/risk.js dashboard/src/index.css dashboard/index.html dashboard/vite.config.js
grep -rnE "#[0-9a-fA-F]{3,8}\b" dashboard/src/live --include=*.jsx
grep -rnE "\b(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b" dashboard/src/live
```
Expected: `Test Files  20 passed (20)` / `Tests  306 passed (306)`; `Test Files  63 passed (63)` / `Tests  1119 passed (1119)`; `✓ built in …`; then no output from the `git diff --stat` (the old app is untouched) and none from either `grep` (no hex colour in a live component, no Tailwind palette colour anywhere under `src/live/`).

- [ ] **Step 6: Visual review against the prototype (for the user; nothing to commit)**

```bash
cd /c/tmp/homunculus-g1/dashboard && npx vite --port 5173
```
Open `http://localhost:5173/?tasarim=1` and, beside it, the prototype screenshots in `tasarim-taslaklari/anasayfa/gorsel/` (`users-TR-gece.webp`, `alarms-TR-gun.webp`, `alarms-RU-gece.webp`, `summary-TR-gun.webp`, `unitdash-TR-gece.webp`). Check:
1. Gece: navy page, cards one step lighter, cyan primary — as `users-TR-gece`. The small-button row "Gördüm / Təxirə sal / Eskalasiya" matches the alarm rows in `alarms-*`.
2. Gün: light page, white cards, teal primary — as `alarms-TR-gun` / `summary-TR-gun`. Expected and intended differences: the risk pills' text is darker than the prototype's (the inks), the danger red is a shade deeper in Gece.
3. Azerbaijani: every `ə`/`Ə` is a sans letter (from Segoe UI), never serif; Русский: headings in Cyrillic are sans; JetBrains Mono draws both itself.
4. "Böyük": all text about 12 % larger.
5. DevTools device toolbar at 390 px: no horizontal page scroll (the colour table scrolls inside its own frame).
6. Keyboard only: every control shows the cyan outline; the tab strip moves with ←/→; the sample dialog keeps Tab inside and closes on Esc; focus returns to "Pəncərəni aç".
7. Network panel: fonts come from `localhost` (`/assets/*.woff2`), nothing from `fonts.googleapis.com` / `fonts.gstatic.com`.
Stop the server with Ctrl+C.

- [ ] **Step 7: Commit the docs**

```bash
cd /c/tmp/homunculus-g1
git add docs/homunculus-rehber-TR.md docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md
git commit -m "docs: design foundation in the Turkish guide; G1-05/G1-06 done in the roadmap

Glossary: design token, contrast ratio, design gallery. Roadmap: G1-05 and
G1-06 status, the two G1-06 items closed, and what Wave 1B leaves open
(input border contrast, native review of new strings, the monitor's
daylight colours, the automatic theme).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (the brief for G1-05 + G1-06):

| Requirement | Task |
|---|---|
| Tokens for Gece (default) and Gün as CSS variables, switched by `data-theme` on the root; one stylesheet | 2 (switching on `<html>`: 5) |
| Tailwind utilities reference the variables (one source of colour); severity and vital colours; size scale `data-size="buyuk"` | 2, 3 |
| Automated WCAG AA contrast test (4.5:1 body, 3:1 UI) over the pairs used for text; minimal adjustments recorded | 2 (record: "Contrast" above, `tokens.css` header, Task 2 commit) |
| Fonts self-hosted via `@fontsource*`; ə and Cyrillic coverage per family verified; the prototype's Cyrillic fallback intent replicated | 4 (stacks in 2) |
| Icon component with the `H.icon` names, faithful paths, `currentColor`, size, aria-hidden by default; every name renders an `<svg>` | 8 |
| Base components: btn (+p/d/g/sm/lg), box/card (+h5), seg, tag (+w/c), pill, sv, tabs, table.t, fld, note (+i), empty, kv, modal, toast — focus ring, button types, modal trap + Escape, roles | 9–17 |
| Risk/severity mapping as a pure function (none/info neutral, moderate amber, never green) with tests | 12 |
| i18n: keyed dictionaries per language, `t(key, vars)`, fallback AZ default → TR → key with dev warning, provider/hook, `localStorage` with try/catch, `<html lang>`, patient data never translated, AZ/RU/EN from the prototype where TR matches, every key in all four languages | 6, 7 (prefs: 1) |
| Gallery at `?tasarim=1`: tokens, typography, icons, every component, both themes, four languages, theme + language switch; `chooseMode` with a routing test, `?live=1` keeps priority; scroll frame respected | 18, 19 |
| Decisions section; npm deps listed; size estimate; every task green + build | header, Decisions, Task 4, every gate |
| Roadmap items tagged G1-06 (language-detection tests, NEWS2 strings) | 6, 7, 20 |

**Placeholder scan:** every code step carries its full file or an exact replace-this-with-that pair. The only fill-ins are in Task 20 Step 2 (`<tarih>`, `<ilk>`, `<son>`), each produced by the command printed right above it.

**Consistency:** names defined once and used as defined — `readPref`/`writePref` (1) in 5 and 7; `COLOR_TOKENS`, `kebab`, `TYPE_SIZES`, `tailwindColors`, `tailwindFontSizes` (2) in 3 and 18; `rule`/`THEMES` (2) in 4; `useTheme`/`THEMES`/`SIZES` (5); `useI18n`, `DICTIONARIES`, `LANG_CODES` (6–7) in 12, 16, 17, 18; `FOCUS_RING` (9) in 13, 15; `StatusPill`/`STATUS_TONES` (11) in 12; `riskStyle`/`ENGINE_RISKS` (12) in 18; `TabPanel` (13), `TOAST_MS` (17). Tones are `crit | high | mid | low | ok | neutral` everywhere; i18n keys used by components (`common.close`, `common.notifications`, `risk.*`, `prefs.*`, `gallery.*`) all exist in the four dictionaries (`strings.test.js`, `riskStyle.test.js`). Test counts per task add up to 306 under `src/live/` + 3 = 309, i.e. 810 → 1119.
