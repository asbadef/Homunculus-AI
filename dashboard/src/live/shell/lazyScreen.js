// src/live/shell/lazyScreen.js — a screen whose code is fetched the first time it is opened.
//
// WHY. The live UI was one chunk with every screen in it (dist/assets/LiveApp-*.js, 523 kB, over
// Vite's 500 kB line). Each screen of the route table (routes.js SCREENS) and each tab of the
// administration screen (AdminScreen.jsx TAB_SCREENS) is now its own chunk, fetched when it is
// first shown. The PWA's precache still holds every chunk (vite.config.js globPatterns), so a ward
// PC that has been here once opens any screen offline as before.
//
// It is React.lazy with three things React.lazy does not do:
//   - it takes a NAMED export: the screens export `BedsScreen`, not a default, and are imported by
//     that name in their tests;
//   - `preload()` fetches the module now. A screen whose module has already arrived opens AT ONCE:
//     React.lazy reads a thenable that answers synchronously without suspending, so no loading note
//     flashes on a screen whose code is already here;
//   - every lazy screen made is listed, so `preloadScreens()` can fetch them all — the shell does,
//     soon after it opens (Shell.jsx), so an open page holds every screen's code as the one chunk
//     did: a deploy that replaces the hashed files later does not break a screen the ward has not
//     opened yet. And setupTests.js does, before each test file's first test, so a test renders a
//     screen as it did before the split — at once — instead of meeting a loading note.
//
// A module that fails to arrive is not remembered: the next ask fetches it again. React.lazy itself
// does remember a failure for the screen it was rendering (the boundary in Shell.jsx then offers a
// reload, which is what fixes a chunk a deploy has replaced).
import { lazy } from "react";

/** Every lazy screen made in this page, in the order made. */
const MADE = new Set();

/** `load` is `() => import("…")` written out at the call site — a path the reachability walk
 *  (reachable.test.js) and the boundary rules can read — and `name` the export to show.
 *  `preload()` answers with that export: the component the screen shows. */
export function lazyScreen(load, name) {
  let shown = null;
  let loading = null;
  const preload = () => {
    loading ??= load().then(
      (arrived) => { shown = arrived[name]; return shown; },
      (error) => { loading = null; throw error; },
    );
    return loading;
  };
  const Screen = lazy(() => (shown
    ? { then: (answer) => answer({ default: shown }) }
    : preload().then((component) => ({ default: component }))));
  Screen.preload = preload;
  MADE.add(Screen);
  return Screen;
}

/** Fetch every lazy screen made so far — and those the fetched modules make in turn (the
 *  administration screen's tabs are made when its own chunk is evaluated). Never rejects: a screen
 *  that cannot be fetched now says so when it is opened, by its own boundary, not here. */
export async function preloadScreens() {
  const asked = new Set();
  for (let next = [...MADE]; next.length > 0; next = [...MADE].filter((screen) => !asked.has(screen))) {
    next.forEach((screen) => asked.add(screen));
    // eslint-disable-next-line no-await-in-loop
    await Promise.allSettled(next.map((screen) => Promise.resolve().then(() => screen.preload())));
  }
}
