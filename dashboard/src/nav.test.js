// dashboard/src/nav.test.js
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, canSee, ADMIN_TABS } from "./ClinicalDemo.jsx";
import { permsForRole, PERMISSION_KEYS } from "./permissions.js";

const keysFor = (perms, live = false) => NAV_ITEMS.filter((i) => canSee(i, perms, live)).map((i) => i.key);
const tabsFor = (perms, live = false) => ADMIN_TABS.filter((t) => canSee(t, perms, live)).map((t) => t.key);
const ALL = [...PERMISSION_KEYS];

describe("navigation gates on permissions (simulation)", () => {
  it("the board, alarms and heatmap are open to every signed-in user", () => {
    expect(keysFor([])).toEqual(["board", "alarms", "heatmap"]);
  });

  it("keeps today's demo layout for the attending, the charge nurse and the admin", () => {
    expect(keysFor(permsForRole("ATTENDING"))).toEqual(["board", "admission", "care", "alarms", "results", "heatmap"]);
    expect(keysFor(permsForRole("CHARGE_NURSE"))).toEqual(["board", "admission", "care", "alarms", "results", "heatmap"]);
    expect(keysFor(permsForRole("HOSPITAL_ADMIN"))).toContain("admin");
  });

  it("opens the admin page to anyone holding an administrative permission", () => {
    expect(keysFor(["devices.manage"])).toContain("admin");
    expect(keysFor(["audit.view"])).toContain("admin");
    expect(keysFor(["structure.manage"])).toContain("admin");
    expect(keysFor(["board.view"])).not.toContain("admin");
  });

  it("gates each admin tab on its permission", () => {
    expect(tabsFor(["devices.manage"])).toEqual(["devices"]);
    expect(tabsFor(["users.manage"])).toEqual(["reports", "staff", "security", "archive", "sessions"]);
    expect(tabsFor(ALL)).toEqual(ADMIN_TABS.map((t) => t.key));
  });
});

describe("live mode shows nothing the simulation backs", () => {
  it("only the board and the alarms, the pages the API backs, are open to every signed-in user", () => {
    // admission, care team and results write only to the simulation; the heatmap is computed
    // from the simulated ward.
    expect(keysFor([], true)).toEqual(["board", "alarms"]);
    expect(keysFor(permsForRole("ATTENDING"), true)).toEqual(["board", "alarms"]);
    expect(keysFor(permsForRole("CHARGE_NURSE"), true)).toEqual(["board", "alarms"]);
  });

  it("only the staff tab is live, and the admin page shows only when a live tab is visible", () => {
    expect(tabsFor(ALL, true)).toEqual(["staff"]);
    expect(tabsFor(["users.manage"], true)).toEqual(["staff"]);
    expect(tabsFor(["groups.manage"], true)).toEqual(["staff"]);
    expect(tabsFor(["devices.manage"], true)).toEqual([]);
    expect(tabsFor(["audit.view", "structure.manage"], true)).toEqual([]);

    expect(keysFor(ALL, true)).toEqual(["board", "alarms", "admin"]);
    expect(keysFor(["board.view", "users.manage"], true)).toContain("admin");
    expect(keysFor(["board.view", "devices.manage"], true)).not.toContain("admin");
    expect(keysFor(["board.view", "audit.view"], true)).not.toContain("admin");
  });
});
