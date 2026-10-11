// src/live/shell/routes.js — every screen of Group 1, who may open it, and whether it exists yet.
//
// The one table the rail, the router and the entry rule read. A screen of a later wave is listed
// now with no screen behind it: the rail does not show it and its address answers "no such page" —
// never a dead link.
//
// `perms`: any one of them opens the screen ([] = every signed-in user). `work`: a screen someone
// signs in to use — the entry rule (canEnter) asks whether the session can reach at least one,
// built or not, so nobody is turned away in Wave 2 for want of a screen Wave 3 is building.
// `nav`: "main" (the rail, in this order), "bottom" (the rail's foot) or false (reached from
// another screen: a patient is opened from the beds — and while such a screen is open no rail
// entry reads as current, see Sidebar.jsx).
//
// HOW A WAVE ADDS ITS SCREEN: its own import line below, and its own line in SCREENS — two lines
// nobody else touches, so the parallel branches of Wave 3 do not meet. That is the ONLY way the
// app gains a screen; `stubScreens` is a test seam and refuses to run outside the test build.
// ROUTES itself is frozen, entries and permission lists included: a route's id, address and
// permissions are the same for every session and every test, and nothing can widen them at run
// time.
import { SettingsScreen } from "../screens/settings/SettingsScreen.jsx";
import { BedsScreen } from "../screens/beds/BedsScreen.jsx";

import { AlarmsScreen } from "../screens/alarms/AlarmsScreen.jsx";

// G1-11: import { PatientScreen } from "../screens/patient/PatientScreen.jsx";

// G1-12: import { AdminScreen } from "../screens/admin/AdminScreen.jsx";

/** The screen each route shows in THIS build, by route id — `null` until its wave sets it.
 *  THIS is the line a wave edits (and only its own). Frozen: it is the canonical answer, and
 *  `resetScreens` puts it back whatever a test stood in for. */
const SCREENS = Object.freeze({
  // One entry per wave, each on its own with a blank line either side. The blank lines are the
  // point: git merges line ranges, and four arms editing four ADJACENT lines of the same object
  // conflict every time, while four arms editing lines with untouched context between them do
  // not. Do not close up the gaps.
  beds: BedsScreen, // G1-09

  alarms: AlarmsScreen, // G1-10

  patient: null,   // G1-11

  admin: null,     // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen

  settings: SettingsScreen,
});

/** What `screenOf` reads: this build's own screens, until a test stands in for one. */
const BUILT = { ...SCREENS };

const route = (entry) => Object.freeze({ ...entry, perms: Object.freeze(entry.perms) });

export const ROUTES = Object.freeze([
  route({ id: "beds", path: "/beds", icon: "grid", labelKey: "nav.beds", shortKey: "nav.bedsShort",
    perms: ["board.view"], work: true, nav: "main" }),

  route({ id: "alarms", path: "/alarms", icon: "bell", labelKey: "nav.alarms", shortKey: "nav.alarmsShort",
    perms: ["board.view"], work: true, nav: "main" }),

  route({ id: "patient", path: "/patients/:id", icon: "user", labelKey: "nav.patient", shortKey: "nav.patient",
    perms: ["board.view"], work: false, nav: false }),

  route({ id: "admin", path: "/admin", icon: "shield", labelKey: "nav.admin", shortKey: "nav.adminShort",
    perms: ["users.manage", "groups.manage"], work: true, nav: "main" }),

  route({ id: "settings", path: "/settings", icon: "gear", labelKey: "nav.settings", shortKey: "nav.settingsShort",
    perms: [], work: false, nav: "bottom" }),
]);

/** The component a route shows, or null when this build has not built it. */
export function screenOf(route_) {
  return (route_ && BUILT[route_.id]) || null;
}

/** A seam only the test build has: outside it, the screens of a build are the ones it was built
 *  with, and nothing may add one at run time. */
function testOnly(what) {
  if (import.meta.env?.MODE !== "test") {
    throw new Error(`${what} is a test seam: a build's screens are the ones it was built with`);
  }
}

/** TEST ONLY — stand in for the screens a later wave will build ({routeId: Component}), and get
 *  back `resetScreens`. A test MUST restore in `afterEach`: the registry is shared by every test
 *  in its file. Only screens can be stood in for — permissions and addresses are frozen.
 *  Wave 3 does NOT call this: it edits its own line in SCREENS above. */
export function stubScreens(screens) {
  testOnly("stubScreens");
  Object.assign(BUILT, screens);
  return resetScreens;
}

/** TEST ONLY — every route back to the screen this build actually has, whatever was stood in for
 *  (nested stubs included). This is what an `afterEach` should call. */
export function resetScreens() {
  testOnly("resetScreens");
  Object.assign(BUILT, SCREENS);
}

const has = (perms, keys) => keys.length === 0 || keys.some((k) => perms.includes(k));

/** Whether these rights open the route (built or not). */
export function canReach(route_, perms) {
  return Boolean(route_) && has(Array.isArray(perms) ? perms : [], route_.perms);
}

/** The entry rule: the session reaches at least one work screen of Group 1. */
export function hasWorkRoute(perms) {
  return ROUTES.some((r) => r.work && canReach(r, perms));
}

/** The rail: built routes these rights open, `main` ones then `bottom` ones. */
export function navRoutes(perms) {
  const open = ROUTES.filter((r) => r.nav && screenOf(r) && canReach(r, perms));
  return { main: open.filter((r) => r.nav === "main"), bottom: open.filter((r) => r.nav === "bottom") };
}

/** Where a session lands: the first built main screen it opens, else its settings. */
export function homePath(perms) {
  const { main } = navRoutes(perms);
  return (main[0] ?? ROUTES.find((r) => r.id === "settings")).path;
}

/** Where a session whose shell went should come back to, having been on `path` — its own screen,
 *  or its home.
 *
 *  A screen the rail does not list and that NAMES something — a patient — is not reopened: the
 *  lock exists so that what was on the screen is gone, and a clinician unlocking at a shared
 *  station must not be handed a patient back (her own included: she may have left it for a
 *  reason). Nor is a screen this session can no longer open, or one this build does not have —
 *  coming back to "no access" or "no such page" is worse than coming back to the ward. */
export function resumePath(path, perms) {
  const home = homePath(perms);
  const match = matchRoute(path || "");
  if (!match) return home;
  const { route, params } = match;
  if (!route.nav && Object.keys(params).length > 0) return home;
  if (!canReach(route, perms) || !screenOf(route)) return home;
  return path;
}

/** The route path inside an address's hash: "#/patients/P-1?tab=vitals" -> "/patients/P-1".
 *  A query string or a second "#" inside the hash belongs to the SCREEN — a tab, an anchor — not
 *  to the route. Read whole, "#/beds?unit=NICU" was "no such page" and "#/patients/P-1?tab=vitals"
 *  opened a patient whose id was "P-1?tab=vitals". */
export function hashPath(hash) {
  return String(hash ?? "").replace(/^#/, "").split(/[?#]/)[0];
}

/** The route a path names, with its parameters — or null. `/patients/P-1` -> {route, params: {id}}.
 *  It takes a path as `hashPath` returns one. Empty segments are dropped, so a doubled or
 *  trailing slash is the same route. The addresses are matched exactly: another spelling
 *  ("/BEDS") is no page rather than this one, while a parameter keeps the case it was given — a
 *  patient id is the engine's data, not our vocabulary.
 *
 *  A path still carrying a "?" or a "#" is no page either: no address in the table has one, so a
 *  caller that did not go through `hashPath` gets "no such page" rather than a patient whose id
 *  is "P-1?tab=vitals". An id that really contains one arrives percent-encoded and is unharmed. */
export function matchRoute(path) {
  const text = String(path || "");
  if (text.includes("?") || text.includes("#")) return null;
  const parts = text.split("/").filter(Boolean);
  for (const route_ of ROUTES) {
    const pattern = route_.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    let ok = true;
    pattern.forEach((p, i) => {
      if (p.startsWith(":")) {
        try {
          params[p.slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          ok = false;
        }
      } else if (p !== parts[i]) ok = false;
    });
    if (ok) return { route: route_, params };
  }
  return null;
}
