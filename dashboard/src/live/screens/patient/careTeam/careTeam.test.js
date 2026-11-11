// The «Bakım ekibi» box's rules (G2-B1c, spec §4, T1, T5, T8, X4). Pure.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONCALL_MAX_MS, PHYSICIAN_GROUPS, actionsFor, activeRows, attendingOf, canClaim, closedRows,
  expired, isPhysician, matchesName, windowProblem,
} from "./careTeam.js";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const HOUR = 3_600_000;
const row = (over = {}) => ({
  id: "r-1", user_id: "u-1", full_name: "Sentetik Həkim", role: "ASSOCIATE_PHYSICIAN",
  window_start: null, window_end: null, is_active: true, ...over,
});
const user = (slugs, id = "u-ayse") => ({ id, groups: slugs.map((slug) => ({ slug, name: slug })) });
const ASSIGN = ["admissions.view", "care_team.assign"];
const NONE = { promote: false, remove: false, leave: false };

describe("who is a physician (T1)", () => {
  it("is a member of a physician role group, and nobody else", () => {
    for (const slug of ["attending", "unit_physician", "physician"]) expect(isPhysician(user([slug]))).toBe(true);
    for (const slugs of [["nurse"], ["nurse", "charge_nurse"], ["hospital_admin"], []]) {
      expect(isPhysician(user(slugs))).toBe(false);
    }
    expect(isPhysician(null)).toBe(false);
  });

  it("holds the server's physician groups and on-call bound (admission/service.py)", () => {
    const py = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../../homunculus-engine/src/homunculus/admission/service.py"), "utf8");
    const groups = /^PHYSICIAN_GROUPS = \(([^)]*)\)/m.exec(py)[1];
    expect([...groups.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual([...PHYSICIAN_GROUPS]);
    expect(Number(/^ONCALL_MAX_WINDOW = timedelta\(hours=(\d+)\)/m.exec(py)[1]) * HOUR).toBe(ONCALL_MAX_MS);
  });
});

describe("the team and its history", () => {
  const rows = [row({ id: "a", role: "ATTENDING" }), row({ id: "b" }), row({ id: "c", is_active: false })];

  it("splits the active rows from the closed ones, in the server's order, and finds the attending", () => {
    expect(activeRows(rows).map((r) => r.id)).toEqual(["a", "b"]);
    expect(closedRows(rows).map((r) => r.id)).toEqual(["c"]);
    expect(attendingOf(rows).id).toBe("a");
    expect(attendingOf([row()])).toBeNull();
    expect(activeRows(undefined)).toEqual([]);
  });

  it("says an on-call window has passed, and only an on-call one", () => {
    const oncall = (endMs) => row({
      role: "ONCALL_PHYSICIAN", window_start: new Date(endMs - 8 * HOUR).toISOString(), window_end: new Date(endMs).toISOString(),
    });
    expect(expired(oncall(NOW - HOUR), NOW)).toBe(true);
    expect(expired(oncall(NOW + HOUR), NOW)).toBe(false);
    expect(expired(row({ window_end: new Date(NOW - HOUR).toISOString() }), NOW)).toBe(false);
  });

  it("says it only after the end, as the server does: a window ending exactly now has not passed", () => {
    const at = (endMs) => row({ role: "ONCALL_PHYSICIAN", window_end: new Date(endMs).toISOString() });
    expect(expired(at(NOW), NOW)).toBe(false);
    expect(expired(at(NOW - 1), NOW)).toBe(true);
  });
});

describe("the buttons (§4)", () => {
  it("offers nothing on the attending's row (T5)", () => {
    expect(actionsFor(row({ role: "ATTENDING" }), { user: user(["attending"]), perms: ASSIGN })).toEqual(NONE);
  });

  it("lets an assigner make another's row the attending, or remove it", () => {
    expect(actionsFor(row(), { user: user(["attending"]), perms: ASSIGN })).toEqual({ promote: true, remove: true, leave: false });
  });

  it("lets a member leave her own row, with or without care_team.assign", () => {
    const own = row({ user_id: "u-ayse" });
    expect(actionsFor(own, { user: user(["physician"]), perms: ["admissions.view"] })).toEqual({ promote: false, remove: false, leave: true });
    expect(actionsFor(own, { user: user(["attending"]), perms: ASSIGN })).toEqual({ promote: true, remove: false, leave: true });
  });

  it("offers nothing on a closed row, nor to a reader without a right", () => {
    expect(actionsFor(row({ is_active: false }), { user: user(["attending"]), perms: ASSIGN })).toEqual(NONE);
    expect(actionsFor(row(), { user: user(["nurse"]), perms: ["admissions.view"] })).toEqual(NONE);
  });

  it("offers «Sorumlu hekim ol» to a physician holding care_team.claim who is not the attending", () => {
    const claim = ["admissions.view", "care_team.claim"];
    const attending = row({ role: "ATTENDING", user_id: "u-other" });
    expect(canClaim({ user: user(["attending"]), perms: claim, attending })).toBe(true);
    expect(canClaim({ user: user(["attending"]), perms: claim, attending: { ...attending, user_id: "u-ayse" } })).toBe(false);
    expect(canClaim({ user: user(["nurse", "charge_nurse"]), perms: claim, attending })).toBe(false);    // D7, T1
    expect(canClaim({ user: user(["physician"]), perms: ["admissions.view"], attending })).toBe(false);
  });
});

describe("the on-call window (§5.2)", () => {
  it("names what is wrong with it, in the dialog's order", () => {
    expect(windowProblem(Number.NaN, NOW + HOUR, NOW)).toBe("start");
    expect(windowProblem(NOW, Number.NaN, NOW)).toBe("end");
    expect(windowProblem(NOW, NOW, NOW)).toBe("order");
    expect(windowProblem(NOW - 10 * HOUR, NOW - 2 * HOUR, NOW)).toBe("future");
    expect(windowProblem(NOW, NOW + 49 * HOUR, NOW)).toBe("long");
    expect(windowProblem(NOW, NOW + 48 * HOUR, NOW)).toBeNull();
  });

  it("takes an end only after now: an end exactly now is not in the future", () => {
    expect(windowProblem(NOW - HOUR, NOW, NOW)).toBe("future");
    expect(windowProblem(NOW - HOUR, NOW + 1, NOW)).toBeNull();
  });
});

describe("the picker's search", () => {
  it("finds a name by any part of it, whatever its case and its dotted or dotless i", () => {
    expect(matchesName("Sentetik Növbətçi", "növ")).toBe(true);
    expect(matchesName("İlkin Qasımov", "ilkin")).toBe(true);
    expect(matchesName("Ilkin Qasımov", "qasim")).toBe(true);
    expect(matchesName("Sentetik Həkim", "  ")).toBe(true);
    expect(matchesName("Sentetik Həkim", "köm")).toBe(false);
  });

  it("reads the schwa as e, in either case, so a keyboard without it still finds the name", () => {
    expect(matchesName("Sentetik Həkim", "hekim")).toBe(true);
    expect(matchesName("Sentetik Həkim", "HEKİM")).toBe(true);
    expect(matchesName("Əli Sentetik", "eli")).toBe(true);
    expect(matchesName("Sentetik Həkim", "həkim")).toBe(true);
    expect(matchesName("Sentetik Həkim", "hakim")).toBe(false);
  });

  it("makes a run of spaces one, in the query and in the name", () => {
    expect(matchesName("Sentetik Həkim", "sentetik   hekim")).toBe(true);
    expect(matchesName("Sentetik  Həkim", "sentetik hekim")).toBe(true);
    expect(matchesName("Sentetik Həkim", "sentetik\thekim")).toBe(true);
  });
});
