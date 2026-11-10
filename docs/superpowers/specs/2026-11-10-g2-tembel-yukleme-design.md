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

- **What it is.** A small component that renders a `React.lazy` of a **named** export. The screens keep their
  named exports, and their tests still import them by name. The convention of one line per wave, with a blank line either side, is unchanged. The import
  line became a `lazyScreen` line, and the `SCREENS` and `TAB_SCREENS` entries are untouched.
- **Literal paths.** The module path is written out as a literal. `live/imports.testutil.js` already reads
  `import("…")`, so `src/reachable.test.js` and the boundary rules in `boundaries.test.js` and
  `waveBoundaries.test.js` follow it with no change.
- **`preload()`.** It fetches the module and answers with the component the screen shows. If the fetch fails, the
  failure is not remembered, and the next ask fetches again.
- **A failed screen is retried.** `React.lazy` remembers a rejected import for good: re-rendered, it throws the
  same error and fetches nothing. So once the shell's boundary has *shown* a failure, it calls
  `retryFailedScreens()`, and a failed screen's next render goes through a fresh `React.lazy` that fetches again.
  It is not done sooner: React renders a failing screen more than once before it gives up (its retry, the dev
  replay), and a fresh lazy on each of those renders would fetch, fail and fetch again while the network is down.
- **`isChunkFailure(error)`.** It tells a chunk that did not come from any other error. A lazy screen marks its
  own failed fetch, whatever the browser calls it, and the browsers' own wording is recognised for a plain
  `React.lazy`.
- **No suspend once the code is here.** When the module has already arrived, the lazy hands React a thenable that
  answers synchronously. React 18.3's `lazyInitializer` resolves such a thenable without suspending, so a screen
  whose code is here opens at once, with no loading note.
- **`preloadScreens()`.** Every lazy screen made is listed. `preloadScreens()` fetches them all, including the ones
  a fetched module makes in turn: the admin tabs are made when the AdminScreen chunk is evaluated. It never rejects;
  a screen it could not fetch leaves one `console.warn` naming the screen.

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
not from the screen. The note is also **said**: an `<Announce>` region in `<main>`, always mounted outside the
`Suspense`, receives the note while the fallback is up and is emptied when the screen arrives. A region born holding
its text would not be announced (`ui/Alert.jsx`). Focus is unchanged: it still goes to `<main>` after a move.

The administration screen has its own `<Suspense>` inside the tab panel. Its fallback is the note the first load
already shows, `admin.loading`, and the screen's existing `<Announce>` says it while it is up. The heading and the
tabs stay in place, so a keyboard user keeps her place.

**A screen that cannot be shown.** A `ScreenBoundary` sits around the `Suspense`. It is keyed by the **route id**
and reset by the **address** (`resetKey={path}`). The reset happens in `getDerivedStateFromProps`, before the render
at the new address. Clearing it in `componentDidUpdate` instead would also reset a failure that happened AT the new
address, in the same commit that showed it: the screen would be rendered again and logged, or fetched, twice. A test
pins this.

- Moving to another screen starts with a fresh boundary.
- Moving from one patient to another updates the same screen in place, as before, and a failure on the first
  patient does not follow to the next (from the bell, or a link).
- On failure it draws the shell's refusal card: a warning sign, `shell.loadFailed`, a sentence, and a
  `shell.reload` button that calls `location.reload()`. The sentence depends on why:
  - A chunk that did not come (offline, or a deploy replaced the hashed file) gets `shell.loadFailedHelp`, «check
    your connection and reload; no data has been lost». That is true here: nothing was typed into a screen that
    never arrived.
  - Any other error is a screen that threw, perhaps holding a half-filled form. It gets `shell.screenFailedHelp`
    (tr «Bu ekran bir hatayla durdu. Sayfayı yeniden yükleyin; kaydedilmemiş girişler kaybolabilir.»).
- It writes `Homunculus: the screen "<id>" could not be rendered` to the console.
- It arms the failed lazy screens to fetch again (`retryFailedScreens`). Moving away and back, or to the next
  patient, tries again, so Reload is not the only way out once the network is back.
- The rail and the other screens keep working.
- A tab chunk that fails reaches this same boundary.

`shell.loadFailed`, `shell.loadFailedHelp` and `shell.reload` are the same words `src/LoadFailed.jsx` uses for the
page's root, in all four languages.
`LoadFailed.jsx`'s `LoadBoundary` itself is not reused, for two reasons:

- `boundaries.test.js` allows `src/live/` to import nothing from `src/` except the API client.
- Inside the shell the dictionary and the design tokens are available. LoadFailed carries its own texts only because
  it runs when they are not.

**Preload.** `PRELOAD_AFTER_MS` (2 s) after **the page** opens, `LiveApp`'s mount effect calls
`preloadScreens()`; the timer is cleared on unmount. This happens in **every phase**: the session check, the
sign-in form, the TOTP step, the password change, the lock and the shell. The screens are static files and need no
session. After that the open page holds every screen's code, as the one chunk did. A deploy that later replaces the
hashed files does not break a screen of a page that was already open, including one left at sign-in or at the lock,
and no later move flashes the loading note. The bytes were already downloaded by the service worker's precache, so
this costs only module evaluation. A screen the preload could not fetch leaves one `console.warn` naming it, and is
fetched again when it is opened.

**What a user can notice.**

1. In the first 2 s after the page opens, opening a screen for the first time can show «Səhifə yüklənir…» for a
   moment. The browser check measured this at ≈80 ms.
2. A screen that throws while rendering now shows the shell's failure card inside `<main>`, with its own sentence,
   and the rail stays. Before, the error reached the root `LoadBoundary` in `main.jsx`, which replaced the whole
   page with the connection message.

## 4. The PWA precache

The workbox config in `vite.config.js` is unchanged. Its `globPatterns` (`**/*.{js,css,html,json,woff2,svg}`) already match every
lazy chunk. `globIgnores` still keeps only `DesignGallery-*.js` out, as before.

| | Base `60207389` | This branch |
|---|---|---|
| Precache entries | 20 (1356.50 KiB) | **60** (1376.74 KiB) |
| JS chunks precached | 3 of 3 (DesignGallery excluded) | **43 of 43** (DesignGallery excluded) |

In the browser the service worker's cache held 59 unique URLs: `icon.svg` is listed twice in the manifest. With the
network emulated offline, a dynamic `import()` of all 43 chunks succeeded from `cache-storage`. A ward PC that has
been on the page once still opens every screen offline.

## 5. Sizes

These are from `npx vite build`, minified, with gzip in brackets. There is no chunk-size warning after the change.

| Chunk | Before | After |
|---|---|---|
| `LiveApp-*.js` | **523.43 kB** (157.81) ⚠ | 149.12 kB (51.05) |
| `Toast-*.js`: shared with the design gallery (the ui kit and the four dictionaries) | 433.20 kB (153.77) | 430.03 kB (152.89), now the largest |
| `index-*.js`: entry, React DOM, LoadFailed | 146.75 kB (48.02) | 146.91 kB (48.11) |
| `PatientScreen-*.js` | (in LiveApp) | 96.46 kB (29.53) |
| `KabulScreen-*.js` | (in LiveApp) | 32.60 kB (10.11) |
| `UsersTab-*.js` | (in LiveApp) | 24.29 kB (7.62) |
| Every other screen, tab and shared chunk | (in LiveApp) | ≤ 20.67 kB each |
| JS chunks | 4 | 44 |

`Toast-*.js` has ≈70 kB of headroom under the limit. Most of it is the four languages' dictionaries.

## 6. Tests

- **`src/setupTests.js`.** Before a test file's first test, it preloads every lazy screen that the file's imports
  have made. `vite.config.js` gives hooks the same 20 s net as tests (`hookTimeout`). A test therefore opens a screen at once, as it did before the split. Nothing is sprinkled with waits,
  and no test meets the loading note by surprise. A file that imports no screen fetches nothing. This is what keeps
  the `rawKeys.test.jsx` sweep (one h1 per screen, no raw key) and every Shell or LiveApp test unchanged.
- **New behaviour is tested on purpose, with stand-ins made inside each test:**
  - `shell/lazyScreen.test.jsx` (9): the named export, no flash once preloaded, one fetch however often it is asked,
    a failed fetch not remembered, a failure handed to the nearest boundary, a retry only after a failure was shown,
    `isChunkFailure`, `preloadScreens` covering lazies made by fetched modules, and never rejecting while warning
    once per failed screen.
  - `shell/Shell.test.jsx` (+6): the loading note under the route's title, the note in Russian too, the note said
    politely and then cleared, the failed chunk (message, reload, console line, rail kept, the next screen opens),
    a screen that threw (its own sentence, the next patient renders), and a failed screen fetched again when it is
    opened again.
  - `LiveApp.test.jsx` (+1): the page preloads at the sign-in form, after `PRELOAD_AFTER_MS`.
  - `screens/admin/AdminScreen.test.jsx`: the tab-panel loading note, shown and said, and every built tab arriving
    as a component. The three tests that pinned a tab's component now compare what its `preload()` answers.
  - `shell/routes.test.js` (+1): every built screen is lazy and arrives as a component.
- **Unchanged:** `onlyScreens`, `stubScreens` and `resetScreens` work as before, because a stand-in can be a plain
  component or a lazy one. `reachable.test.js` is green with no change, since its reader already counts
  `import("…")`.
- **Suite:** 147 files / 3967 tests at the base, **148 files / 3986 tests** here, all green.

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
