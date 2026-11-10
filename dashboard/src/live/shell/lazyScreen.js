// src/live/shell/lazyScreen.js — a screen whose code is fetched the first time it is opened.
//
// WHY. The live UI was one chunk with every screen in it (dist/assets/LiveApp-*.js, 523 kB, over
// Vite's 500 kB line). Each screen of the route table (routes.js SCREENS) and each tab of the
// administration screen (AdminScreen.jsx TAB_SCREENS) is now its own chunk, fetched when it is
// first shown. The PWA's precache still holds every chunk (vite.config.js globPatterns), so a ward
// PC that has been here once opens any screen offline as before.
//
// It is React.lazy with what React.lazy does not do:
//   - it takes a NAMED export: the screens export `BedsScreen`, not a default, and are imported by
//     that name in their tests;
//   - `preload()` fetches the module now. A screen whose module has already arrived opens AT ONCE:
//     React.lazy reads a thenable that answers synchronously without suspending, so no loading note
//     flashes on a screen whose code is already here;
//   - every lazy screen made is listed, so `preloadScreens()` can fetch them all. The page does,
//     soon after it opens and whatever its phase (LiveApp.jsx), so an open page holds every
//     screen's code as the one chunk did: a deploy that replaces the hashed files later breaks no
//     screen of a page already open — one left at the sign-in form or the lock included. And
//     setupTests.js does, before each test file's first test, so a test renders a screen as it did
//     before the split — at once — instead of meeting a loading note;
//   - a failure is not for good. A preload that failed is forgotten (the next ask fetches again)
//     and leaves one console warning naming the screen. React.lazy itself remembers a rejected
//     import for good — re-rendered, it throws the same error and fetches nothing — so once the
//     shell's boundary has SHOWN a failure it calls `retryFailedScreens()`, and the failed screen's
//     next render goes through a fresh React.lazy that fetches again. Not sooner: React renders a
//     failing screen more than once before it gives up (a retry, the dev replay), and a fresh lazy
//     on each of those renders would fetch, fail and fetch again for as long as the network is down;
//   - `isChunkFailure(error)` tells a chunk that did not come from any other error, so the shell
//     says "check your connection" only when that is what happened.
import { createElement, lazy } from "react";

/** How long after the page opens every screen's code is fetched (LiveApp.jsx): its own first
 *  screen and the sign-in form go first, the rest after. The bytes are already in the PWA's
 *  precache; this costs only their evaluation. */
export const PRELOAD_AFTER_MS = 2000;

/** Every lazy screen made in this page, in the order made. */
const MADE = new Set();

/** The errors that were a lazy screen's own code not arriving, whatever the browser called them. */
const CHUNK_FAILURES = new WeakSet();

/** What the browsers say when a dynamic import's module did not arrive: Chromium, Firefox, Safari.
 *  For a plain React.lazy (main.jsx's roots), which marks nothing. */
const CHUNK_WORDS = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** `load` is `() => import("…")` written out at the call site — a path the reachability walk
 *  (reachable.test.js) and the boundary rules can read — and `name` the export to show.
 *  `preload()` answers with that export: the component the screen shows. */
export function lazyScreen(load, name) {
  let shown = null;
  let loading = null;
  let failed = false;
  const preload = () => {
    loading ??= load().then(
      (arrived) => { shown = arrived[name]; return shown; },
      (error) => { loading = null; throw error; },
    );
    return loading;
  };
  const fresh = () => lazy(() => (shown
    ? { then: (answer) => answer({ default: shown }) }
    : preload().then(
      (component) => ({ default: component }),
      (error) => {
        failed = true;
        if (error !== null && typeof error === "object") CHUNK_FAILURES.add(error);
        throw error;
      },
    )));
  let current = fresh();
  function Screen(props) {
    return createElement(current, props);
  }
  Screen.displayName = name;
  Screen.preload = preload;
  /** After a failure was shown: the next render fetches again. */
  Screen.retry = () => {
    if (!failed) return;
    failed = false;
    current = fresh();
  };
  MADE.add(Screen);
  return Screen;
}

/** Fetch every lazy screen made so far — and those the fetched modules make in turn (the
 *  administration screen's tabs are made when its own chunk is evaluated). Never rejects: a screen
 *  that cannot be fetched now says so when it is opened, by the shell's boundary; here it leaves
 *  one warning naming it, so the cause can be found afterwards. */
export async function preloadScreens() {
  const asked = new Set();
  for (let next = [...MADE]; next.length > 0; next = [...MADE].filter((screen) => !asked.has(screen))) {
    next.forEach((screen) => asked.add(screen));
    // eslint-disable-next-line no-await-in-loop
    const settled = await Promise.allSettled(next.map((screen) => Promise.resolve().then(() => screen.preload())));
    settled.forEach((result, at) => {
      if (result.status !== "rejected") return;
      // eslint-disable-next-line no-console
      console.warn(`Homunculus: the code of ${next[at].displayName} could not be fetched ahead; it is fetched again when the screen is opened`, result.reason);
    });
  }
}

/** Arm every lazy screen whose failure has been shown to fetch again on its next render. The shell's
 *  boundary calls it once it has caught one (Shell.jsx ScreenBoundary). */
export function retryFailedScreens() {
  for (const screen of MADE) screen.retry();
}

/** Whether `error` is a screen's code that did not arrive (offline, or a deploy replaced the hashed
 *  file) rather than a screen that threw. */
export function isChunkFailure(error) {
  if (error === null || typeof error !== "object") return false;
  return CHUNK_FAILURES.has(error) || error.name === "ChunkLoadError" || CHUNK_WORDS.test(String(error.message ?? ""));
}
