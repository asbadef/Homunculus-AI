// dashboard/src/nav.test.js
import { describe, it, expect } from "vitest";
import { NAV_ITEMS, canSee, ADMIN_TABS } from "./ClinicalDemo.jsx";
import { permsForRole } from "./permissions.js";

const keysFor = (perms) => NAV_ITEMS.filter((i) => canSee(i, perms)).map((i) => i.key);

describe("navigation gates on permissions", () => {
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
    expect(keysFor(["board.view"])).not.toContain("admin");
  });

  it("admin tabs are gated per permission and simulation-only tabs hide in live mode", () => {
    const visible = (perms, live) => ADMIN_TABS.filter((t) => canSee(t, perms) && !(live && t.demoOnly)).map((t) => t.key);
    expect(visible(["devices.manage"], true)).toEqual(["devices"]);
    expect(visible(["users.manage"], false)).toContain("security");
    expect(visible(["users.manage"], true)).not.toContain("security");
    expect(visible(["users.manage", "groups.manage"], true)).toContain("staff");
  });
});
