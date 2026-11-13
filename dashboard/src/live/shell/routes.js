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
// HOW A WAVE ADDS ITS SCREEN: its own `lazyScreen` line below, and its own line in SCREENS — two
// lines nobody else touches, so the parallel branches of Wave 3 do not meet. That is the ONLY way
// the app gains a screen; `stubScreens` is a test seam and refuses to run outside the test build.
// ROUTES itself is frozen, entries and permission lists included: a route's id, address and
// permissions are the same for every session and every test, and nothing can widen them at run
// time.
//
// EACH SCREEN'S CODE IS ITS OWN CHUNK, fetched the first time the screen is opened (lazyScreen.js):
// with every screen in it, the live UI's one chunk had grown past Vite's 500 kB. A screen's line
// names its module by a literal path (so the reachability walk and the boundary rules read it as an
// import) and the export the screen is. The shell shows a loading note while a chunk travels and a
// reload when one does not come (Shell.jsx); the PWA precache holds every chunk (vite.config.js).
import { lazyScreen } from "./lazyScreen.js";

const SettingsScreen = lazyScreen(() => import("../screens/settings/SettingsScreen.jsx"), "SettingsScreen");
const BedsScreen = lazyScreen(() => import("../screens/beds/BedsScreen.jsx"), "BedsScreen");

const AlarmsScreen = lazyScreen(() => import("../screens/alarms/AlarmsScreen.jsx"), "AlarmsScreen");

const PatientScreen = lazyScreen(() => import("../screens/patient/PatientScreen.jsx"), "PatientScreen");

const AdminScreen = lazyScreen(() => import("../screens/admin/AdminScreen.jsx"), "AdminScreen");

const DevicesScreen = lazyScreen(() => import("../screens/devices/DevicesScreen.jsx"), "DevicesScreen");

const KabulScreen = lazyScreen(() => import("../screens/kabul/KabulScreen.jsx"), "KabulScreen"); // G2-B1a

const BedsideScreen = lazyScreen(() => import("../screens/bedside/BedsideScreen.jsx"), "BedsideScreen"); // G3-01

const GorevlerScreen = lazyScreen(() => import("../screens/gorevler/GorevlerScreen.jsx"), "GorevlerScreen"); // G3-02

const DenetimScreen = lazyScreen(() => import("../screens/denetim/DenetimScreen.jsx"), "DenetimScreen"); // G2-B4

const DolulukScreen = lazyScreen(() => import("../screens/doluluk/DolulukScreen.jsx"), "DolulukScreen"); // G2-B3a

const RrtScreen = lazyScreen(() => import("../screens/rrt/RrtScreen.jsx"), "RrtScreen"); // G2-B5

const DevirScreen = lazyScreen(() => import("../screens/devir/DevirScreen.jsx"), "DevirScreen"); // G2-B3b

const EczaneScreen = lazyScreen(() => import("../screens/eczane/EczaneScreen.jsx"), "EczaneScreen"); // G3-04

const OzetScreen = lazyScreen(() => import("../screens/ozet/OzetScreen.jsx"), "OzetScreen"); // G4-02

const KaliteScreen = lazyScreen(() => import("../screens/kalite/KaliteScreen.jsx"), "KaliteScreen"); // G4-03

const IsYukuScreen = lazyScreen(() => import("../screens/isyuku/IsYukuScreen.jsx"), "IsYukuScreen"); // G4-04

const EnfeksiyonScreen = lazyScreen(() => import("../screens/enfeksiyon/EnfeksiyonScreen.jsx"), "EnfeksiyonScreen"); // G4-05

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

  patient: PatientScreen, // G1-11

  admin: AdminScreen, // G1-12 (users), G1-13 (roles), G1-14 (login source) — tabs inside one screen

  devices: DevicesScreen, // Aşama A — biomedical's monitor screen (devices, beds, values; no patient)

  kabul: KabulScreen, // G2-B1a — Hasta Kabul: admission, discharge, beds

  olcum: BedsideScreen, // G3-01 — Yatak başı ölçüm: the bedside set by hand

  gorevler: GorevlerScreen, // G3-02 — Görevlerim: the ward's task queue

  denetim: DenetimScreen, // G2-B4 — «Denetim bütünlüğü»: the audit chain's verification and the newest events

  doluluk: DolulukScreen, // G2-B3a — Doluluk: the ward's beds, their states and moves

  rrt: RrtScreen, // G2-B5 — the rapid-response team's calls and the unanswered urgent alarms

  devir: DevirScreen, // G2-B3b — «Vardiya devri»: to countersign, mine, a new handover with its D-Ö-D-Ö note

  eczane: EczaneScreen, // G3-04 — «Eczane»: the pharmacist's ward page — vasopressors, the antibiotic clock, creatinine, fluids

  ozet: OzetScreen, // G4-02 — «Yönetici özeti»: the cards, alarm quality, the units as of now; no patient

  kalite: KaliteScreen, // G4-03 — «Kalite göstergeleri»: per unit, alarm response, snoozes, RRT, handovers; no patient

  isyuku: IsYukuScreen, // G4-04 — «İş yükü»: per unit this shift, the nurse cards, the charge nurse's assignment; no patient

  enfeksiyon: EnfeksiyonScreen, // G4-05 — «Enfeksiyon kontrol»: isolation, suspected infection, the antibiotic clock, sepsis alarms, the isolation beds

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

  // `under`: the rail entry this screen sits beneath. A patient is opened from the beds board, so
  // the beds entry reads as current while one is on screen (Sidebar.jsx) — otherwise the rail says
  // "you are nowhere" for the screen a clinician spends most of her time on.
  route({ id: "patient", path: "/patients/:id", icon: "user", labelKey: "nav.patient", shortKey: "nav.patient",
    perms: ["board.view"], work: false, nav: false, under: "beds" }),

  route({ id: "admin", path: "/admin", icon: "shield", labelKey: "nav.admin", shortKey: "nav.adminShort",
    perms: ["users.manage", "groups.manage"], work: true, nav: "main" }),

  // Aşama A (Decision 12): the monitors for the people who own the device→bed table — biomedical and
  // the vendor's support group sign in to this alone; it shows no patient.
  route({ id: "devices", path: "/devices", icon: "activity", labelKey: "nav.devices", shortKey: "nav.devicesShort",
    perms: ["devices.manage", "devices.map_beds"], work: true, nav: "main" }),   // G2-ESLEME: + the editor's key

  // G2-B1a — Hasta Kabul (spec §5.1): for whoever reads admissions, admits or confirms a discharge
  // (releasing a bed moved to Doluluk, X7) — and, G2-B1b (X5), for whoever moves a patient, by either
  // of its two keys. After the board's screens in the table, so nobody's home moves.
  route({ id: "kabul", path: "/kabul", icon: "userPlus", labelKey: "kabul.nav", shortKey: "kabul.navShort",
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm",
      "admissions.move.initiate", "admissions.transfer.confirm"],   // G2-B1b (X5)
    work: true, nav: "main" }),   // G2-B3a (X7)

  // G2-B3a — Doluluk (spec D2): for whoever reads admissions, admits, confirms a discharge or releases
  // a bed — the right to its names (GET /tenant/occupancy). After Kabul, so nobody's home moves.
  route({ id: "doluluk", path: "/doluluk", icon: "bed", labelKey: "doluluk.nav", shortKey: "doluluk.navShort",
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm", "beds.release"], work: true, nav: "main" }),

  // G3-01 (D3, D14) — Yatak başı ölçüm: for whoever charts (`clinical.chart`). After the ward's other screens,
  // so nobody's home moves; a session that only charts lands here.
  route({ id: "olcum", path: "/olcum", icon: "heart", labelKey: "olcum.nav", shortKey: "olcum.navShort",
    perms: ["clinical.chart"], work: true, nav: "main" }),

  // G3-02 (D12) — Görevlerim: for whoever reads the queue (`tasks.view`). After Ölçüm, so nobody's home moves;
  // a session that only reads tasks lands here.
  route({ id: "gorevler", path: "/gorevler", icon: "clip", labelKey: "gorevler.nav", shortKey: "gorevler.navShort",
    perms: ["tasks.view"], work: true, nav: "main" }),

  // G2-B4 (spec D3) — «Denetim bütünlüğü»: for whoever reads the audit trail (`audit.view`: the auditor group,
  // vendor support, the hospital administrator). Last on the rail, so nobody's home moves; a session that only
  // reads the audit trail lands here.
  route({ id: "denetim", path: "/denetim", icon: "file", labelKey: "denetim.nav", shortKey: "denetim.navShort",
    perms: ["audit.view"], work: true, nav: "main" }),

  // G2-B5 (spec D6) — the RRT screen: for whoever may call the rapid-response team (`alerts.escalate`: the RRT,
  // charge nurses, physicians, the administrator) — not the nurse (roadmap). After the audit page, so nobody's
  // home moves.
  route({ id: "rrt", path: "/rrt", icon: "zap", labelKey: "rrt.nav", shortKey: "rrt.navShort",
    perms: ["alerts.escalate"], work: true, nav: "main" }),

  // G2-B3b (spec D9) — «Vardiya devri»: for whoever signs a handover (`handover.sign`: the nurse, the charge nurse,
  // the physicians). After the RRT screen, so nobody's home moves; a session that only signs handovers lands here.
  route({ id: "devir", path: "/devir", icon: "swap", labelKey: "devir.nav", shortKey: "devir.navShort",
    perms: ["handover.sign"], work: true, nav: "main" }),

  // G3-04 (spec D2, D16) — «Eczane»: for whoever holds `pharmacy.view` (the pharmacist, the physician groups, the
  // administrator) — not the nurse, not the auditor. After the handover screen, so nobody's home moves; a session
  // that holds this key alone lands here.
  route({ id: "eczane", path: "/eczane", icon: "pill", labelKey: "eczane.nav", shortKey: "eczane.navShort",
    perms: ["pharmacy.view"], work: true, nav: "main" }),

  // G4-02 (spec D3) — «Yönetici özeti»: for whoever holds `summary.view` — the system administrator, by rule; another
  // group only once a hospital gives it the key. Not a work screen: it is read, not worked in. After the handover
  // screen, so nobody's home moves.
  route({ id: "ozet", path: "/ozet", icon: "chart", labelKey: "ozet.nav", shortKey: "ozet.navShort",
    perms: ["summary.view"], work: false, nav: "main" }),

  // G4-03 (spec D3) — «Kalite göstergeleri»: for whoever holds `quality.view` — the auditor group by default (migration
  // 0020), the system administrator by rule, any group a hospital gives it. A work screen: a hospital's own quality
  // group, given this key alone, signs in to it. After the management summary, so nobody's home moves.
  route({ id: "kalite", path: "/kalite", icon: "star", labelKey: "kalite.nav", shortKey: "kalite.navShort",
    perms: ["quality.view"], work: true, nav: "main" }),

  // G4-04 (spec D2, D6, §5 M6) — «İş yükü»: for whoever holds `workload.view` or `shifts.manage` (the form needs the
  // second) — the charge-nurse group holds both by default (migration 0022), the system administrator by rule. A work
  // screen; after the quality indicators, so nobody's home moves. `users`: the prototype's own icon for it (shell.js),
  // used by no other route.
  route({ id: "isyuku", path: "/is-yuku", icon: "users", labelKey: "isyuku.nav", shortKey: "isyuku.navShort",
    perms: ["workload.view", "shifts.manage"], work: true, nav: "main" }),

  // G4-05 (spec D2, D13, §5 M1) — «Enfeksiyon kontrol»: for whoever holds `infection.view` — the default attending,
  // unit-physician, physician, charge-nurse and nurse groups (migration 0023), the system administrator by rule. A work
  // screen; after «İş yükü», so nobody's home moves. `thermo`: used by no other route (`shield` is the administration's).
  route({ id: "enfeksiyon", path: "/enfeksiyon", icon: "thermo", labelKey: "enfeksiyon.nav", shortKey: "enfeksiyon.navShort",
    perms: ["infection.view"], work: true, nav: "main" }),

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
