// Test-only: pin the screen registry to a KNOWN set, whatever this build has built.
//
// Why this exists. Wave 2's shell tests were written against the build it had — one screen, the
// settings — so they said things like "the rail holds exactly ['#/settings']" and "the session's
// home is /settings". Every one of those broke the moment Wave 3 built its first screen, in a file
// none of Wave 3's branches owns. That is the collision the registry's two-line seam was meant to
// prevent, and it was still there in the tests.
//
// So a test that cares WHICH screens exist says so itself: `onlyScreens({ beds: Probe })` leaves
// the beds route with that screen and every other route with none, so the rail, the home path and
// the router's two refusals are the test's own choice and not a property of the build. A test that
// does not care uses the build as it is and asserts through `homePath` / `screenOf` rather than
// against a literal address.
//
// It is the registry's own seam underneath (`stubScreens`), so it refuses outside the test build
// and `resetScreens()` in an `afterEach` puts the build's screens back.
import { ROUTES, screenOf, stubScreens } from "./routes.js";

/** The settings screen is every session's fallback home (`perms: []`, `nav: "bottom"`), it is not
 *  Wave 3's business, and a test that removed it would be testing a build that cannot exist. So it
 *  is kept as this build has it unless a test names it. */
export const KEEP = Object.freeze(["settings"]);

/** The registry reduced to `screens`: every other route loses its screen, except the ids in
 *  `keep`, which stay as this build built them. Returns `resetScreens`, which an `afterEach` must
 *  call — the registry is shared by every test in the file. */
export function onlyScreens(screens = {}, { keep = KEEP } = {}) {
  const table = {};
  for (const route of ROUTES) {
    table[route.id] = keep.includes(route.id) ? screenOf(route) : null;
  }
  return stubScreens({ ...table, ...screens });
}
