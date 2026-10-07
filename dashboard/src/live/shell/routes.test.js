import { describe, it, expect, afterEach, vi } from "vitest";
import { ROUTES, canReach, hasWorkRoute, hashPath, homePath, matchRoute, navRoutes, resetScreens, resumePath, screenOf, stubScreens } from "./routes.js";
import { PERMISSION_KEYS } from "../../permissions.js";
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

  // Wave 2 builds the shell and the settings; Wave 3 fills the others in. Until then their
  // addresses answer "no such page" and the rail does not show them: no dead links.
  it("shows only built screens in the rail", () => {
    const { main, bottom } = navRoutes(ADMIN);
    expect(main.every((r) => screenOf(r))).toBe(true);
    expect(bottom.map((r) => r.id)).toEqual(["settings"]);
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
    expect(homePath([])).toBe("/settings");
  });

  // How a wave gives a route its screen, and the only way a test may stand in for one.
  it("takes a screen from the registry, and puts the build's own back", () => {
    const Probe = () => null;
    restore = stubScreens({ beds: Probe });
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBe(Probe);
    expect(navRoutes(["board.view"]).main.map((r) => r.id)).toEqual(["beds"]);
    expect(homePath(["board.view"])).toBe("/beds");
    restore();
    restore = null;
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBeNull();
    expect(homePath(["board.view"])).toBe("/settings");
  });

  it("puts every screen back at once, however many a test stood in for", () => {
    stubScreens({ beds: () => null });
    stubScreens({ alarms: () => null, admin: () => null });
    resetScreens();
    expect(ROUTES.filter((r) => screenOf(r)).map((r) => r.id)).toEqual(["settings"]);
  });

  // The app gains a screen by being built with one. Nothing may add one at run time.
  it("refuses the seam outside the test build", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(() => stubScreens({ beds: () => null })).toThrow(/test seam/);
      expect(() => resetScreens()).toThrow(/test seam/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(screenOf(ROUTES.find((r) => r.id === "beds"))).toBeNull();
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
    expect(hasWorkRoute(["devices.manage"])).toBe(false);     // biomedical: Group 4
    expect(hasWorkRoute(["audit.view"])).toBe(false);         // the audit page: Group 2
    expect(hasWorkRoute([])).toBe(false);
  });

  it("lands on the first built screen the session opens, else on its settings", () => {
    const first = navRoutes(NURSE).main[0];
    expect(homePath(NURSE)).toBe(first ? first.path : "/settings");
    expect(homePath(["devices.manage"])).toBe("/settings");
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
    restore = stubScreens({ beds: () => null });
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
