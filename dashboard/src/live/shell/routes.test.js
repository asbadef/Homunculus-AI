import { describe, it, expect, afterEach, vi } from "vitest";
import { ROUTES, canReach, hasWorkRoute, hashPath, homePath, matchRoute, navRoutes, resetScreens, resumePath, screenOf, stubScreens } from "./routes.js";
import { onlyScreens } from "./screens.testutil.js";
import { PERMISSION_KEYS } from "../screens/admin/catalogue.js";
import { DICTIONARIES } from "../i18n/catalog.js";
import { LANG_CODES } from "../i18n/langs.js";
import { ICON_NAMES } from "../ui/icons.js";

const NURSE = ["board.view", "alerts.ack", "admissions.view"];
const ADMIN = [...PERMISSION_KEYS];

let restore = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("the route table", () => {
  it("names real permissions, icons and texts in the four languages", () => {
    for (const r of ROUTES) {
      for (const key of r.perms) expect(PERMISSION_KEYS, `${r.id}: ${key}`).toContain(key);
      expect(ICON_NAMES, r.id).toContain(r.icon);
      for (const lang of LANG_CODES) {
        expect(DICTIONARIES[lang][r.labelKey], `${lang} ${r.labelKey}`).toBeTruthy();
        expect(DICTIONARIES[lang][r.shortKey], `${lang} ${r.shortKey}`).toBeTruthy();
      }
    }
  });

  it("has unique ids and paths", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  // G2-B3a (the browser walk): at 390 px the rail shows only the short labels, so two routes
  // sharing one — Doluluk's «Койки» / «Beds» beside the board's — are two items nobody can tell apart.
  it("gives every route a short label of its own, in every language", () => {
    for (const lang of LANG_CODES) {
      const seen = new Map();
      for (const r of ROUTES) {
        const text = DICTIONARIES[lang][r.shortKey];
        expect(seen.get(text), `${lang} «${text}»: ${seen.get(text)} and ${r.id}`).toBeUndefined();
        seen.set(text, r.id);
      }
    }
  });

  // Wave 2 builds the shell and the settings; Wave 3 fills the others in. Until then their
  // addresses answer "no such page" and the rail does not show them: no dead links.
  it("shows only built screens in the rail", () => {
    const { main, bottom } = navRoutes(ADMIN);
    expect(main.every((r) => screenOf(r))).toBe(true);
    expect(bottom.map((r) => r.id)).toEqual(["settings"]);
    // And a build with none of them shows none of them: no dead links, ever.
    restore = onlyScreens({}, { keep: [] });
    expect(navRoutes(ADMIN)).toEqual({ main: [], bottom: [] });
  });

  // The table is one shared object: a screen, or a test, that could edit it would change what
  // every later session and every later test may open. Mutating `admin.perms` to [] used to open
  // /admin to a session with no rights at all, and made homePath([]) land there.
  it("cannot be edited: the table, its entries and their permission lists are frozen", () => {
    const admin = ROUTES.find((r) => r.id === "admin");
    expect(Object.isFrozen(ROUTES)).toBe(true);
    expect(ROUTES.every((r) => Object.isFrozen(r) && Object.isFrozen(r.perms))).toBe(true);
    expect(() => { admin.perms.push("board.view"); }).toThrow(TypeError);
    expect(() => { admin.perms = []; }).toThrow(TypeError);
    expect(canReach(admin, [])).toBe(false);
    // No rights opens no main screen, whatever this build has built: its home is its settings.
    expect(homePath([])).toBe("/settings");
  });

  // How a wave gives a route its screen, and the only way a test may stand in for one.
  it("takes a screen from the registry, and puts the build's own back", () => {
    // Build-independent: it asserts the round trip, not which screens this build has. Written
    // against a literal ("after the restore, beds has no screen") it would break in a file no
    // Wave-3 branch owns, the moment one of them built that screen.
    const Probe = () => null;
    const beds = ROUTES.find((r) => r.id === "beds");
    const own = screenOf(beds);
    restore = stubScreens({ beds: Probe });
    expect(screenOf(beds)).toBe(Probe);
    expect(navRoutes(["board.view"]).main.map((r) => r.id)).toContain("beds");
    expect(homePath(["board.view"])).toBe("/beds");           // the first main route in the table
    restore();
    restore = null;
    expect(screenOf(beds)).toBe(own);
  });

  it("puts every screen back at once, however many a test stood in for", () => {
    const own = ROUTES.filter((r) => screenOf(r)).map((r) => r.id);
    stubScreens({ beds: () => null });
    stubScreens({ alarms: () => null, admin: () => null });
    resetScreens();
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(own);
  });

  // What a test that cares WHICH screens exist uses, so it does not depend on the build.
  it("pins the registry to a known set, and gives it back", () => {
    const Probe = () => null;
    const own = ROUTES.filter((r) => screenOf(r)).map((r) => r.id);
    restore = onlyScreens({ alarms: Probe }, { keep: [] });
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(["alarms"]);
    expect(homePath(["board.view"])).toBe("/alarms");
    restore();
    restore = null;
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(own);
  });

  // The app gains a screen by being built with one. Nothing may add one at run time.
  it("refuses the seam outside the test build", () => {
    const before = screenOf(ROUTES.find((r) => r.id === "beds"));
    vi.stubEnv("MODE", "production");
    try {
      expect(() => stubScreens({ beds: () => null })).toThrow(/test seam/);
      expect(() => resetScreens()).toThrow(/test seam/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBe(before);
  });

  // Each built screen's code is its own chunk, fetched the first time the screen is opened
  // (lazyScreen.js): the live UI's one chunk had grown past Vite's 500 kB. What arrives must be a
  // component — an export named wrong on a screen's line would otherwise fail only when someone
  // opens that screen, on the ward.
  it("fetches each built screen's code on first use, and what arrives is the screen", async () => {
    const built = ROUTES.filter((r) => screenOf(r));
    expect(built.length).toBeGreaterThan(1);
    for (const r of built) {
      expect(typeof screenOf(r).preload, r.id).toBe("function");
      // eslint-disable-next-line no-await-in-loop
      const shown = await screenOf(r).preload();
      expect(typeof shown, r.id).toBe("function");
      expect(shown.name, r.id).toMatch(/Screen$/);
    }
  });
});

describe("who may open what", () => {
  it("opens a screen with any one of its permissions; settings for everyone", () => {
    const admin = ROUTES.find((r) => r.id === "admin");
    expect(canReach(admin, ["groups.manage"])).toBe(true);
    expect(canReach(admin, NURSE)).toBe(false);
    expect(canReach(ROUTES.find((r) => r.id === "settings"), [])).toBe(true);
    expect(canReach(undefined, ADMIN)).toBe(false);
  });

  it("lets in whoever a Group-1 screen is for — built or not — and nobody else", () => {
    expect(hasWorkRoute(NURSE)).toBe(true);
    expect(hasWorkRoute(["users.manage"])).toBe(true);
    expect(hasWorkRoute(["devices.manage"])).toBe(true);      // biomedical: the monitor screen (Aşama A)
    expect(hasWorkRoute(["audit.view"])).toBe(true);          // G2-B4: the audit page
    expect(hasWorkRoute([])).toBe(false);
  });

  it("lands on the first built screen the session opens, else on its settings", () => {
    const first = navRoutes(NURSE).main[0];
    expect(homePath(NURSE)).toBe(first ? first.path : "/settings");
    expect(homePath(["devices.manage"])).toBe("/devices");
  });
});

// Aşama A: biomedical's device-only screen (Decision 12) — devices, beds and values, no patient.
describe("the monitor screen's route", () => {
  afterEach(() => resetScreens());
  const devices = () => ROUTES.find((r) => r.id === "devices");

  it("is a work screen for devices.manage or devices.map_beds, on the main rail, with its own icon and names", () => {
    expect(devices()).toMatchObject({ path: "/devices", perms: ["devices.manage", "devices.map_beds"], work: true, nav: "main",
      icon: "activity", labelKey: "nav.devices", shortKey: "nav.devicesShort" });
    expect(canReach(devices(), ["devices.map_beds"])).toBe(true);     // G2-ESLEME: a charge nurse reaches it from the rail
    expect(canReach(devices(), ["board.view"])).toBe(false);
    expect(screenOf(devices())).not.toBeNull();
    expect(ICON_NAMES).toContain("activity");
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang]["nav.devices"], lang).toBeTruthy();
  });

  it("is the first main entry and the home of a devices.manage session — biomedical, vendor support", () => {
    expect(navRoutes(["devices.manage"]).main.map((r) => r.id)).toEqual(["devices"]);
    // G2-B4: vendor support (platform_support: audit.view + devices.manage) gains the audit page, second
    expect(navRoutes(["audit.view", "devices.manage"]).main.map((r) => r.id)).toEqual(["devices", "denetim"]);
    for (const perms of [["devices.manage"], ["audit.view", "devices.manage"]]) {
      expect(hasWorkRoute(perms)).toBe(true);
      expect(homePath(perms)).toBe("/devices");
    }
  });

  it("is not a clinician's: board.view alone does not see it; a hospital administrator sees both", () => {
    expect(navRoutes(NURSE).main.map((r) => r.id)).not.toContain("devices");
    const hospitalAdmin = ["board.view", "alerts.ack", "users.manage", "groups.manage", "devices.manage"];
    const ids = navRoutes(hospitalAdmin).main.map((r) => r.id);
    expect(ids).toContain("beds");
    expect(ids).toContain("devices");
    expect(homePath(hospitalAdmin)).toBe("/beds");
  });
});

// G2-B4: «Denetim bütünlüğü» — the audit trail's integrity page, for audit.view (spec D3).
describe("the audit page's route", () => {
  afterEach(() => resetScreens());
  const denetim = () => ROUTES.find((r) => r.id === "denetim");

  it("is a work screen for audit.view, on the main rail, with its own names", () => {
    expect(denetim()).toMatchObject({ path: "/denetim", perms: ["audit.view"], work: true, nav: "main",
      icon: "file", labelKey: "denetim.nav", shortKey: "denetim.navShort" });
    expect(screenOf(denetim())).not.toBeNull();
    expect(canReach(denetim(), ["board.view"])).toBe(false);
    // G2-B5, G2-B3b: the RRT screen and then the handover screen come right after it (their own blocks below). What
    // follows them is pinned once, in the last route's own block (G4-02).
    const ids = ROUTES.map((r) => r.id);
    expect(ids.slice(ids.indexOf("denetim"), ids.indexOf("denetim") + 3)).toEqual(["denetim", "rrt", "devir"]);
  });

  it("is the home of an audit.view-only session and moves nobody else's", () => {
    expect(homePath(["audit.view"])).toBe("/denetim");
    expect(homePath(["board.view", "audit.view"])).toBe("/beds");          // the auditor group keeps the board first
    expect(navRoutes(["board.view", "audit.view"]).main.map((r) => r.id)).toEqual(["beds", "alarms", "denetim"]);
  });
});

// G2-B5 (spec D6): the RRT screen — for whoever may call the rapid-response team (alerts.escalate), not the nurse.
describe("the RRT screen's route", () => {
  afterEach(() => resetScreens());
  const rrt = () => ROUTES.find((r) => r.id === "rrt");
  /** The rapid-response team's group (`rapid_response`), as the engine seeds it (auth/permissions.py). */
  const RAPID_RESPONSE = ["board.view", "alerts.ack", "alerts.escalate", "admissions.view", "break_glass.use", "clinical.chart"];

  it("is a work screen for alerts.escalate, on the main rail after the audit page, with its own names", () => {
    expect(rrt()).toMatchObject({ path: "/rrt", perms: ["alerts.escalate"], work: true, nav: "main",
      icon: "zap", labelKey: "rrt.nav", shortKey: "rrt.navShort" });
    expect(screenOf(rrt())).not.toBeNull();
    // G2-B3b: the handover screen comes right after it (its own block below).
    const ids = ROUTES.map((r) => r.id);
    expect(ids[ids.indexOf("rrt") + 1]).toBe("devir");
  });

  it("is not the nurse's; whoever may call the team reaches it", () => {
    expect(canReach(rrt(), NURSE)).toBe(false);
    expect(navRoutes(NURSE).main.map((r) => r.id)).not.toContain("rrt");
    expect(canReach(rrt(), ["alerts.escalate"])).toBe(true);
    expect(hasWorkRoute(["alerts.escalate"])).toBe(true);
  });

  it("moves nobody's home: the RRT still lands on the beds, with its screen last on the rail", () => {
    expect(homePath(RAPID_RESPONSE)).toBe("/beds");
    expect(navRoutes(RAPID_RESPONSE).main.map((r) => r.id).at(-1)).toBe("rrt");
    expect(homePath(["alerts.escalate"])).toBe("/rrt");
  });
});

// G2-B3b (spec D9): «Vardiya devri» — for whoever signs a handover (handover.sign: the nurse, the charge nurse, the
// physicians), after the RRT screen so nobody's home moves.
describe("the handover screen's route", () => {
  afterEach(() => resetScreens());
  const devir = () => ROUTES.find((r) => r.id === "devir");
  /** The nurse's group (`nurse`), as the engine seeds it (auth/permissions.py). */
  const NURSE_GROUP = ["board.view", "alerts.ack", "admissions.view", "admissions.admit", "admissions.transfer.confirm",
    "handover.sign", "clinical.chart", "beds.release"];
  /** The auditor's group (`auditor`). */
  const AUDITOR = ["board.view", "audit.view"];

  it("is a work screen for handover.sign, on the main rail after the RRT screen, with its own names", () => {
    expect(devir()).toMatchObject({ path: "/devir", perms: ["handover.sign"], work: true, nav: "main",
      icon: "swap", labelKey: "devir.nav", shortKey: "devir.navShort" });
    expect(screenOf(devir())).not.toBeNull();
    const ids = ROUTES.map((r) => r.id);
    expect(ids[ids.indexOf("devir") - 1]).toBe("rrt");
  });

  it("a nurse reaches it from the rail, and her home is still the beds", () => {
    expect(canReach(devir(), NURSE_GROUP)).toBe(true);
    expect(navRoutes(NURSE_GROUP).main.map((r) => r.id)).toContain("devir");
    expect(homePath(NURSE_GROUP)).toBe("/beds");
    expect(hasWorkRoute(["handover.sign"])).toBe(true);
    expect(homePath(["handover.sign"])).toBe("/devir");
  });

  it("is not the auditor's", () => {
    expect(canReach(devir(), AUDITOR)).toBe(false);
    expect(navRoutes(AUDITOR).main.map((r) => r.id)).not.toContain("devir");
    expect(homePath(AUDITOR)).toBe("/beds");
  });
});

// G4-02 (spec D3): «Yönetici özeti» — for `summary.view`, which by default only the system administrator holds (the
// system group holds every key by rule). Not a work screen; after the handover screen, so nobody's home moves.
// THE ONE PINNED TAIL of the table is here: a slice that adds a route after «devir» edits this line and no other.
// G3-04 put the pharmacy page between the handover screen and this one: devir → eczane → ozet → settings.
describe("the management summary's route", () => {
  afterEach(() => resetScreens());
  const ozet = () => ROUTES.find((r) => r.id === "ozet");

  it("is for summary.view, on the main rail, not a work screen, with its own names", () => {
    expect(ozet()).toMatchObject({ path: "/ozet", perms: ["summary.view"], work: false, nav: "main",
      icon: "chart", labelKey: "ozet.nav", shortKey: "ozet.navShort" });
    expect(screenOf(ozet())).not.toBeNull();
    expect(ROUTES.map((r) => r.id).slice(-3)).toEqual(["eczane", "ozet", "settings"]);
  });

  it("is the system administrator's by default, and moves nobody's home", () => {
    expect(navRoutes(ADMIN).main.map((r) => r.id)).toContain("ozet");
    expect(homePath(ADMIN)).toBe("/beds");
    for (const perms of [NURSE, ["board.view", "audit.view"], ["alerts.escalate"], ["handover.sign"], ["devices.manage"]]) {
      expect(canReach(ozet(), perms), perms.join(",")).toBe(false);
    }
  });

  it("is no work screen: the key alone does not pass the entry rule", () => {
    expect(hasWorkRoute(["summary.view"])).toBe(false);
  });
});

// G3-04 (spec D2, D16): «Eczane» — the pharmacist's ward page, for `pharmacy.view`: the pharmacist and the physician
// groups, not the nurse and not the auditor (the carried rule). Between the handover screen and the summary.
describe("the pharmacy page's route", () => {
  afterEach(() => resetScreens());
  const eczane = () => ROUTES.find((r) => r.id === "eczane");
  /** The groups as the engine seeds them (auth/permissions.py DEFAULT_GROUPS). */
  const PHARMACIST = ["board.view", "admissions.view", "pharmacy.view"];
  const PHYSICIAN = ["board.view", "alerts.ack", "alerts.escalate", "admissions.view", "handover.sign", "break_glass.use",
    "clinical.chart", "scores.sign", "tasks.view", "tasks.manage", "pharmacy.view"];
  const NURSE_GROUP = ["board.view", "alerts.ack", "admissions.view", "admissions.admit", "admissions.transfer.confirm",
    "handover.sign", "clinical.chart", "beds.release", "tasks.view", "tasks.manage"];
  const AUDITOR = ["board.view", "audit.view"];

  it("is a work screen for pharmacy.view, on the main rail, with its own icon and names", () => {
    expect(eczane()).toMatchObject({ path: "/eczane", perms: ["pharmacy.view"], work: true, nav: "main",
      icon: "pill", labelKey: "eczane.nav", shortKey: "eczane.navShort" });
    expect(screenOf(eczane())).not.toBeNull();
    expect(ICON_NAMES).toContain("pill");
    expect(["tr", "az", "ru", "en"].map((lang) => DICTIONARIES[lang]["eczane.nav"])).toEqual(["Eczane", "Aptek", "Аптека", "Pharmacy"]);
  });

  it("sits between the handover screen and the summary", () => {
    const ids = ROUTES.map((r) => r.id);
    expect(ids.slice(ids.indexOf("devir"), ids.indexOf("devir") + 3)).toEqual(["devir", "eczane", "ozet"]);
  });

  it("the pharmacist and the physician reach it from the rail, and their home is still the beds", () => {
    for (const perms of [PHARMACIST, PHYSICIAN]) {
      expect(canReach(eczane(), perms)).toBe(true);
      expect(navRoutes(perms).main.map((r) => r.id)).toContain("eczane");
      expect(homePath(perms)).toBe("/beds");
    }
    expect(navRoutes(PHARMACIST).main.map((r) => r.id)).toEqual(["beds", "alarms", "kabul", "doluluk", "eczane"]);
    expect(navRoutes(ADMIN).main.map((r) => r.id)).toContain("eczane");
  });

  it("is not the nurse's and not the auditor's", () => {
    for (const perms of [NURSE, NURSE_GROUP, AUDITOR, ["devices.manage"], ["summary.view"]]) {
      expect(canReach(eczane(), perms), perms.join(",")).toBe(false);
      expect(navRoutes(perms).main.map((r) => r.id), perms.join(",")).not.toContain("eczane");
    }
  });

  it("the key alone passes the entry rule and lands on the page", () => {
    expect(hasWorkRoute(["pharmacy.view"])).toBe(true);
    expect(navRoutes(["pharmacy.view"]).main.map((r) => r.id)).toEqual(["eczane"]);
    expect(homePath(["pharmacy.view"])).toBe("/eczane");
  });
});

// G3-01 (D3, D14): the bedside page opens with clinical.chart, on the rail after the ward's other screens.
describe("«Yatak başı ölçüm»", () => {
  it("is on the rail for a clinical.chart holder, and the home of one who holds nothing else", () => {
    expect(navRoutes(["clinical.chart"]).main.map((r) => r.id)).toEqual(["olcum"]);
    expect(homePath(["clinical.chart"])).toBe("/olcum");
    expect(hasWorkRoute(["clinical.chart"])).toBe(true);
  });

  it("moves nobody's home, and is not offered without clinical.chart", () => {
    expect(homePath(["board.view", "clinical.chart"])).toBe("/beds");
    expect(navRoutes(NURSE).main.map((r) => r.id)).not.toContain("olcum");
  });
});

describe("matching an address", () => {
  it("finds a route and its parameters", () => {
    expect(matchRoute("/beds")).toMatchObject({ route: { id: "beds" }, params: {} });
    expect(matchRoute("/patients/P%2F1")).toMatchObject({ route: { id: "patient" }, params: { id: "P/1" } });
    expect(matchRoute("/settings/")).toMatchObject({ route: { id: "settings" } });
  });

  it("finds nothing for an unknown or malformed address", () => {
    for (const path of ["", "/", "/yok", "/patients", "/patients/a/b", "/patients/%E0%A4%A"]) {
      expect(matchRoute(path), path).toBeNull();
    }
  });

  // One route per address, however the slashes fall: an extra or a doubled one is no new page.
  it("reads a doubled or trailing slash as the same route", () => {
    for (const path of ["/settings", "//settings", "/settings/", "/settings//"]) {
      expect(matchRoute(path), path).toMatchObject({ route: { id: "settings" } });
    }
  });

  // Written one way only. The addresses are the table's own, lower case; a parameter is DATA and
  // keeps the case it was given (a patient id is the engine's, and "p-1" is not "P-1").
  it("is case-sensitive: another spelling is no page, never a different one", () => {
    expect(matchRoute("/BEDS")).toBeNull();
    expect(matchRoute("/Settings")).toBeNull();
    expect(matchRoute("/patients/p-1")).toMatchObject({ route: { id: "patient" }, params: { id: "p-1" } });
  });
});

describe("coming back to the screen a session left", () => {
  it("gives back the screen itself when this session may open it", () => {
    restore = stubScreens({ beds: () => null, alarms: () => null });
    expect(resumePath("/alarms", ["board.view"])).toBe("/alarms");
    expect(resumePath("/settings", ["board.view"])).toBe("/settings");
  });

  // The lock exists so that what was on the screen is gone; a patient is not handed back.
  it("refuses a screen the rail does not list and that names something", () => {
    restore = stubScreens({ beds: () => null, patient: () => null });
    expect(resumePath("/patients/P-1", ["board.view"])).toBe("/beds");
  });

  it("falls back to home for an address this session cannot open, or this build has not built", () => {
    // `onlyScreens`: the beds screen exists and NOTHING else does, whatever this build has built,
    // so "no screen behind it yet" is this test's own state and not a property of the build.
    restore = onlyScreens({ beds: () => null });
    expect(resumePath("/admin", ["board.view"])).toBe("/beds");        // not this session's
    expect(resumePath("/alarms", ["board.view"])).toBe("/beds");       // no screen behind it yet
    expect(resumePath("/yok", ["board.view"])).toBe("/beds");
    expect(resumePath("", ["board.view"])).toBe("/beds");
    expect(resumePath(null, [])).toBe("/settings");
  });
});

describe("the path inside an address's hash", () => {
  // A query or a second "#" in the hash belongs to the screen (a tab, an anchor), not to the
  // route. Read whole, "#/beds?unit=NICU" was "no such page" and "#/patients/P-1?tab=vitals"
  // opened a patient whose id was "P-1?tab=vitals".
  it("stops at a query or a second hash", () => {
    expect(hashPath("#/patients/P-1?tab=vitals")).toBe("/patients/P-1");
    expect(hashPath("#/beds?unit=NICU")).toBe("/beds");
    expect(hashPath("#/beds#top")).toBe("/beds");
    expect(hashPath("#/settings")).toBe("/settings");
  });

  it("answers an empty string for an address with no hash at all", () => {
    for (const hash of ["", "#", null, undefined]) expect(hashPath(hash)).toBe("");
  });

  it("matches what it reads", () => {
    expect(matchRoute(hashPath("#/patients/P-1?tab=vitals"))).toMatchObject({ params: { id: "P-1" } });
    expect(matchRoute(hashPath("#/beds?unit=NICU"))).toMatchObject({ route: { id: "beds" } });
  });

  // Defence in depth for a caller that strips the "#" by hand: no address in the table carries a
  // query or a fragment, so one that does is no page rather than a patient id with a query glued
  // to it. A patient id that really contains one arrives percent-encoded and still matches.
  it("refuses a path the router would never have handed it", () => {
    expect(matchRoute("/patients/P-1?tab=vitals")).toBeNull();
    expect(matchRoute("/beds?unit=NICU")).toBeNull();
    expect(matchRoute("/beds#top")).toBeNull();
    expect(matchRoute("/patients/P%3F1")).toMatchObject({ params: { id: "P?1" } });
  });
});

// G3-02 — Görevlerim: the ward's task queue, for whoever reads it.
describe("G3-02 — Görevlerim", () => {
  it("opens with tasks.view, after Ölçüm, and is a work screen", () => {
    expect(navRoutes(["tasks.view"]).main.map((r) => r.id)).toEqual(["gorevler"]);
    expect(homePath(["tasks.view"])).toBe("/gorevler");
    expect(homePath(["clinical.chart", "tasks.view"])).toBe("/olcum");
    const ids = ROUTES.filter((r) => r.nav === "main").map((r) => r.id);
    expect(ids.indexOf("gorevler")).toBe(ids.indexOf("olcum") + 1);
  });
});

// TRƏS-01 (spec §8, D23): the administration screen also opens for `tres.manage` alone — Yönetim › TRƏS is then its
// one tab (screens/admin/AdminScreen.jsx gates each tab by its own right).
describe("the administration route and the national feed's key", () => {
  afterEach(() => resetScreens());
  const admin = () => ROUTES.find((r) => r.id === "admin");

  it("opens for users.manage, groups.manage or tres.manage, and for no other right", () => {
    expect(admin().perms).toEqual(["users.manage", "groups.manage", "tres.manage"]);
    expect(canReach(admin(), ["tres.manage"])).toBe(true);
    expect(canReach(admin(), ["structure.manage"])).toBe(false);
    expect(canReach(admin(), NURSE)).toBe(false);
  });

  it("is a tres.manage session's one work screen and its home", () => {
    expect(hasWorkRoute(["tres.manage"])).toBe(true);
    expect(navRoutes(["tres.manage"]).main.map((r) => r.id)).toEqual(["admin"]);
    expect(homePath(["tres.manage"])).toBe("/admin");
  });
});
