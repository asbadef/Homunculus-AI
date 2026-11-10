# G2 — Tembel yükleme: each screen's code is its own chunk

**Date:** 2026-11-10 · **Lane:** A's technical slice · **Branch:** `feat/g2-tembel-yukleme`, cut from `60207389`
(main `f2f81a93` + G2-B3b «Vardiya devri») · **Scope:** dashboard only. No backend change, no migration, no owner
decision.

## 1. Why

`npx vite build` warned that one chunk was over 500 kB: `dist/assets/LiveApp-*.js` was **523.43 kB**
(157.81 kB gzip). The G3-03 build note had recorded it at 502.8 kB. That chunk held the whole live UI with every
screen in it. A static `manualChunks` split was tried earlier and reverted because of the chunk-cycle risk, and this
slice does not use one. The split here comes only from `import()`.

## 2. What is lazy

- **The route screens.** These are the 13 entries of `shell/routes.js` `SCREENS`: beds, alarms, patient, admin,
  devices, kabul, olcum, gorevler, denetim, doluluk, rrt, devir and settings.
- **The administration tabs.** These are the 6 entries of `screens/admin/AdminScreen.jsx` `TAB_SCREENS`: users,
  roles, source, structure, protocol and tasks.

Every lazy screen is built with `shell/lazyScreen.js`:

```js
const BedsScreen = lazyScreen(() => import("../screens/beds/BedsScreen.jsx"), "BedsScreen");
```

- **What it is.** `React.lazy` on a **named** export. The screens keep their named exports, and their tests still
  import them by name. The convention of one line per wave, with a blank line either side, is unchanged. The import
  line became a `lazyScreen` line, and the `SCREENS` and `TAB_SCREENS` entries are untouched.
- **Literal paths.** The module path is written out as a literal. `live/imports.testutil.js` already reads
  `import("…")`, so `src/reachable.test.js` and the boundary rules in `boundaries.test.js` and
  `waveBoundaries.test.js` follow it with no change.
- **`preload()`.** It fetches the module and answers with the component the screen shows. If the fetch fails, the
  failure is not remembered, and the next ask fetches again.
- **No suspend once the code is here.** When the module has already arrived, the lazy hands React a thenable that
  answers synchronously. React 18.3's `lazyInitializer` resolves such a thenable without suspending, so a screen
  whose code is here opens at once, with no loading note.
- **`preloadScreens()`.** Every lazy screen made is listed. `preloadScreens()` fetches them all, including the ones
  a fetched module makes in turn: the admin tabs are made when the AdminScreen chunk is evaluated. It never rejects.

`routes.js` keeps its guarantees:

- `ROUTES` and `SCREENS` are frozen.
- `screenOf` returns `null` for an unbuilt route.
- `stubScreens` and `resetScreens` still refuse to run outside the test build.

## 3. Loading, failure, preload

**While a chunk travels.** `Shell.jsx` wraps the screen in `<Suspense>`. The fallback is a Box that reads
`shell.screenLoading`, which says the *page* is loading, so it cannot read as "no data":

| Language | Text |
|---|---|
| tr | Sayfa yükleniyor… |
| az | Səhifə yüklənir… |
| ru | Страница загружается… |
| en | Loading the page… |

The top bar and the document title already carry the route's name, because they are computed from the route and
not from the screen. The administration screen has its own `<Suspense>` inside the tab panel. Its fallback is the
note the first load already shows, `admin.loading`. The heading and the tabs stay in place, so a keyboard user keeps
her place.

**A chunk that does not come.** This covers offline, and a deploy that replaced the hashed file. A
`ScreenBoundary` sits around the `Suspense` and is keyed by the **route id**:

- Moving to another screen starts with a fresh boundary.
- Moving from one patient to another updates the same screen in place, as before.
- On failure it draws the shell's refusal card: a warning sign, `shell.loadFailed`, `shell.loadFailedHelp`, and a
  `shell.reload` button that calls `location.reload()`.
- It writes `Homunculus: the screen "<id>" could not be rendered` to the console.
- The rail and the other screens keep working.
- A tab chunk that fails reaches this same boundary.

The texts are the same words `src/LoadFailed.jsx` uses for the page's root, in all four languages.
`LoadFailed.jsx`'s `LoadBoundary` itself is not reused, for two reasons:

- `boundaries.test.js` allows `src/live/` to import nothing from `src/` except the API client.
- Inside the shell the dictionary and the design tokens are available. LoadFailed carries its own texts only because
  it runs when they are not.

**Preload.** `PRELOAD_AFTER_MS` (2 s) after the shell opens, it calls `preloadScreens()`. The first screen's chunk
goes first and the rest follow. After that the open page holds every screen's code, as the one chunk did. A deploy
that later replaces the hashed files does not break a screen that an open page has not visited yet, and no later
move flashes the loading note. The bytes were already downloaded by the service worker's precache, so this costs
only module evaluation.

**What a user can notice.**

1. In the first 2 s after sign-in, opening a screen for the first time can show «Səhifə yüklənir…» for a moment.
   The browser check measured this at ≈80 ms.
2. A screen that throws while rendering now shows the shell's failure card inside `<main>`, and the rail stays.
   Before, the error reached the root `LoadBoundary` in `main.jsx`, which replaced the whole page with the same
   message.

## 4. The PWA precache

`vite.config.js` is unchanged. Its workbox `globPatterns` (`**/*.{js,css,html,json,woff2,svg}`) already match every
lazy chunk. `globIgnores` still keeps only `DesignGallery-*.js` out, as before.

| | Base `60207389` | This branch |
|---|---|---|
| Precache entries | 20 (1356.50 KiB) | **60** (1375.09 KiB) |
| JS chunks precached | 3 of 3 (DesignGallery excluded) | **43 of 43** (DesignGallery excluded) |

In the browser the service worker's cache held 59 unique URLs: `icon.svg` is listed twice in the manifest. With the
network emulated offline, a dynamic `import()` of all 43 chunks succeeded from `cache-storage`. A ward PC that has
been on the page once still opens every screen offline.

## 5. Sizes

These are from `npx vite build`, minified, with gzip in brackets. There is no chunk-size warning after the change.

| Chunk | Before | After |
|---|---|---|
| `LiveApp-*.js` | **523.43 kB** (157.81) ⚠ | 148.12 kB (50.62) |
| `Toast-*.js`: shared with the design gallery (the ui kit and the four dictionaries) | 433.20 kB (153.77) | 429.57 kB (152.75), now the largest |
| `index-*.js`: entry, React DOM, LoadFailed | 146.75 kB (48.02) | 146.91 kB (48.11) |
| `PatientScreen-*.js` | (in LiveApp) | 96.46 kB (29.53) |
| `KabulScreen-*.js` | (in LiveApp) | 32.60 kB (10.11) |
| `UsersTab-*.js` | (in LiveApp) | 24.29 kB (7.62) |
| Every other screen, tab and shared chunk | (in LiveApp) | ≤ 20.67 kB each |
| JS chunks | 4 | 44 |

`Toast-*.js` has ≈70 kB of headroom under the limit. Most of it is the four languages' dictionaries.

## 6. Tests

- **`src/setupTests.js`.** Before a test file's first test, it preloads every lazy screen that the file's imports
  have made. A test therefore opens a screen at once, as it did before the split. Nothing is sprinkled with waits,
  and no test meets the loading note by surprise. A file that imports no screen fetches nothing. This is what keeps
  the `rawKeys.test.jsx` sweep (one h1 per screen, no raw key) and every Shell or LiveApp test unchanged.
- **New behaviour is tested on purpose, with stand-ins made inside each test:**
  - `shell/lazyScreen.test.jsx` (7): the named export, no flash once preloaded, one fetch however often it is asked,
    a failed fetch not remembered, a failure handed to the nearest boundary, `preloadScreens` covering lazies made
    by fetched modules, and never rejecting.
  - `shell/Shell.test.jsx` (+4): the loading note under the route's title, the note in Russian too, the failed
    chunk (message, reload, console line, rail kept, the next screen opens), and the preload after
    `PRELOAD_AFTER_MS`.
  - `screens/admin/AdminScreen.test.jsx`: the tab-panel loading note, and every built tab arriving as a component.
    The three tests that pinned a tab's component now compare what its `preload()` answers.
  - `shell/routes.test.js` (+1): every built screen is lazy and arrives as a component.
- **Unchanged:** `onlyScreens`, `stubScreens` and `resetScreens` work as before, because a stand-in can be a plain
  component or a lazy one. `reachable.test.js` is green with no change, since its reader already counts
  `import("…")`.
- **Suite:** 147 files / 3967 tests at the base, **148 files / 3981 tests** here, all green.

## 7. Browser check

A real browser was driven against `vite preview` of the build. The API paths were proxied by a temporary config to
the local stack's nginx (`https://127.0.0.1:18463`), and the build was same-origin like the on-prem image.

- **Accounts.** Synthetic accounts from the G1-15 plan were used: `test.sorumlu.hemsire`, `test.denetci` and
  `test.biyomedikal`.
- **Screens opened, each with its own h1, no stuck note and no blank `<main>`:** beds, alarms, a patient, devices,
  kabul, doluluk, olcum, rrt, devir, settings, denetim.
- **Screens checked only at the chunk level.** No TOTP-free account holds `users.manage` or `tasks.view`, so admin
  and gorevler opened as "no access". Their chunks, and all six admin tabs, were fetched (HTTP 200) by the preload
  and evaluated by a dynamic import, as were all 43 chunks.
- **Held chunk.** With the RRT chunk held back for 3 s, `<main>` read «Səhifə yüklənir…» under the title
  «Sürətli cavab (RRT)», then the screen appeared.
- **Failed chunk.** With the Devir chunk failed, `<main>` showed «Səhifə yüklənə bilmədi … Yenidən yüklə». The rail
  stayed, the beds screen opened next, and the button reloaded the page.
- **Console.** There were no uncaught exceptions and no console errors. The only errors were the deliberate log lines
  of the failed-chunk case, plus network 404/405/409 answers from endpoints the older local API lacks: `/fluids`,
  `/tenant/occupancy`, GET `/handovers` and `/infinity-shadow/device-beds`. Those screens showed their own notes.
