// src/live/shell/routes.js — every screen of Group 1, who may open it, and whether it exists yet.
//
// The one table the rail, the router and the entry rule read. A screen of a later wave is listed
// now with `screen: null`: the rail does not show it and its address answers "no such page" —
// never a dead link. The wave that builds it replaces its own `screen: null` with the component
// (and its own import line below), so the parallel branches of Wave 3 touch different lines.
//
// `perms`: any one of them opens the screen ([] = every signed-in user). `work`: a screen someone
// signs in to use — the entry rule (canEnter) asks whether the session can reach at least one,
// built or not, so nobody is turned away in Wave 2 for want of a screen Wave 3 is building.
// `nav`: "main" (the rail, in this order), "bottom" (the rail's foot) or false (reached from
// another screen: a patient is opened from the beds).
import { SettingsScreen } from "../screens/settings/SettingsScreen.jsx";
// G1-09: import { BedsScreen } from "../screens/beds/BedsScreen.jsx";

// G1-10: import { AlarmsScreen } from "../screens/alarms/AlarmsScreen.jsx";

// G1-11: import { PatientScreen } from "../screens/patient/PatientScreen.jsx";

// G1-12: import { AdminScreen } from "../screens/admin/AdminScreen.jsx";

export const ROUTES = Object.freeze([
  { id: "beds", path: "/beds", icon: "grid", labelKey: "nav.beds", shortKey: "nav.bedsShort",
    perms: ["board.view"], work: true, nav: "main",
    screen: null }, // G1-09

  { id: "alarms", path: "/alarms", icon: "bell", labelKey: "nav.alarms", shortKey: "nav.alarmsShort",
    perms: ["board.view"], work: true, nav: "main",
    screen: null }, // G1-10

  { id: "patient", path: "/patients/:id", icon: "user", labelKey: "nav.patient", shortKey: "nav.patient",
    perms: ["board.view"], work: false, nav: false,
    screen: null }, // G1-11

  { id: "admin", path: "/admin", icon: "shield", labelKey: "nav.admin", shortKey: "nav.adminShort",
    perms: ["users.manage", "groups.manage"], work: true, nav: "main",
    screen: null }, // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen

  { id: "settings", path: "/settings", icon: "gear", labelKey: "nav.settings", shortKey: "nav.settingsShort",
    perms: [], work: false, nav: "bottom", screen: SettingsScreen },
]);

const has = (perms, keys) => keys.length === 0 || keys.some((k) => perms.includes(k));

/** Whether these rights open the route (built or not). */
export function canReach(route, perms) {
  return Boolean(route) && has(Array.isArray(perms) ? perms : [], route.perms);
}

/** The entry rule: the session reaches at least one work screen of Group 1. */
export function hasWorkRoute(perms) {
  return ROUTES.some((r) => r.work && canReach(r, perms));
}

/** The rail: built routes these rights open, `main` ones then `bottom` ones. */
export function navRoutes(perms) {
  const open = ROUTES.filter((r) => r.nav && r.screen && canReach(r, perms));
  return { main: open.filter((r) => r.nav === "main"), bottom: open.filter((r) => r.nav === "bottom") };
}

/** Where a session lands: the first built main screen it opens, else its settings. */
export function homePath(perms) {
  const { main } = navRoutes(perms);
  return (main[0] ?? ROUTES.find((r) => r.id === "settings")).path;
}

/** The route a path names, with its parameters — or null. `/patients/P-1` -> {route, params: {id}}. */
export function matchRoute(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  for (const route of ROUTES) {
    const pattern = route.path.split("/").filter(Boolean);
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
    if (ok) return { route, params };
  }
  return null;
}
