import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { AdminScreen, TABS, openTabs, resetTabs, stubTabs, tabScreenOf } from "./AdminScreen.jsx";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const USERS = [
  { id: "u-1", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Sentetik",
    auth_source: "local", is_active: true, totp_enabled: false, must_change_password: false,
    last_login_at: "2026-10-07T08:00:00Z",
    groups: [{ id: "g-nurse", slug: "nurse", name: "Hemşire", source: "manual" }] },
];
const GROUPS = [
  { id: "g-nurse", slug: "nurse", name: "Hemşire", description: "", mfa_required: false,
    is_system: false, permissions: ["board.view", "alerts.ack"], member_count: 1 },
];
const CATALOGUE = [{ key: "board.view", description: "See the live board" }];

/** Stand-ins for the tabs, which are built on their own branches. The registry's own seam
 *  (`stubTabs`, as `shell/routes.js` has `stubScreens`): `ids` names which of the three this
 *  test's build has. */
function tabsBuilt(ids) {
  const stubs = {};
  for (const id of ids) {
    stubs[id] = ({ admin }) => <p>{`${id}: ${admin.data.users.length} / ${admin.data.groups.length}`}</p>;
  }
  return stubTabs(stubs);
}

afterEach(() => {
  resetScreens();
  resetTabs();
  vi.restoreAllMocks();
});

async function open({ perms = ["users.manage", "groups.manage"], setup, built = ["users", "roles", "source"] } = {}) {
  tabsBuilt(built);
  const mounted = await mount(<AdminScreen />, {
    access: token({ perms }),
    me: profile({ perms }),
    setup: (api) => {
      api.adminUsers.mockResolvedValue(USERS);
      api.adminGroups.mockResolvedValue(GROUPS);
      api.adminPermissions.mockResolvedValue(CATALOGUE);
      api.unassignedScopes.mockResolvedValue({ tenant: "demo", unassigned_users: 2 });
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  return mounted;
}

describe("which tabs a session sees", () => {
  it("names the three tabs, each with the right that opens it", () => {
    expect(TABS.map((x) => [x.id, x.perm])).toEqual([
      ["users", "users.manage"], ["roles", "groups.manage"], ["source", "users.manage"],
    ]);
  });

  it("is frozen: which right opens which tab is not something a screen may widen", () => {
    expect(Object.isFrozen(TABS)).toBe(true);
    expect(TABS.every((x) => Object.isFrozen(x))).toBe(true);
    expect(() => { TABS[0].perm = "board.view"; }).toThrow(TypeError);
  });

  it("offers only the tabs the session's rights open", () => {
    tabsBuilt(["users", "roles", "source"]);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).toEqual(["users", "roles", "source"]);
    expect(openTabs(["users.manage"]).map((x) => x.id)).toEqual(["users", "source"]);
    expect(openTabs(["groups.manage"]).map((x) => x.id)).toEqual(["roles"]);
    expect(openTabs([]).map((x) => x.id)).toEqual([]);
  });

  it("offers no tab this build has not built — never a dead tab", () => {
    tabsBuilt(["roles"]);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).toEqual(["roles"]);
    expect(openTabs(["users.manage", "groups.manage"]).every((x) => tabScreenOf(x))).toBe(true);
  });

  it("the seam refuses outside the test build, and gives the build's tabs back", () => {
    tabsBuilt(["users"]);
    expect(tabScreenOf(TABS[0])).toBeTypeOf("function");
    resetTabs();
    expect(tabScreenOf(TABS[0])).toBeNull();
    vi.stubEnv("MODE", "production");
    try {
      expect(() => stubTabs({ users: () => null })).toThrow(/test seam/);
      expect(() => resetTabs()).toThrow(/test seam/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the administration screen", () => {
  it("names itself and the hospital, and says every change is audited", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "İdarə" })).toBeInTheDocument();
    expect(screen.getByText(/Sentetik Hastane · hər dəyişiklik audit jurnalına yazılır/)).toBeInTheDocument();
  });

  it("opens on the first tab the session may open, and switches", async () => {
    await open();
    expect(screen.getByRole("tab", { name: "İstifadəçilər", selected: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Rollar və səlahiyyətlər" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("roles:");
  });

  it("moves between the tabs from the keyboard alone", async () => {
    // The tablist's own arrow keys (ui/Tabs.jsx) driving THIS screen's state: a clinician who
    // cannot use a mouse must be able to reach every tab, and Home/End matter when there are three.
    await open();
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Rollar və səlahiyyətlər", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByRole("tab", { name: "Giriş mənbəyi", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "ArrowRight" });        // wraps round to the first
    expect(screen.getByRole("tab", { name: "İstifadəçilər", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "ArrowLeft" });          // and the other way
    expect(screen.getByRole("tab", { name: "Giriş mənbəyi", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getByRole("tab", { name: "İstifadəçilər", selected: true })).toBeInTheDocument();
  });

  it("has exactly one h1 — what a reader lands on after the shell moves focus", async () => {
    await open();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("a session with only groups.manage sees the roles tab alone", async () => {
    await open({ perms: ["groups.manage"] });
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["Rollar və səlahiyyətlər"]);
  });

  it("a session with only users.manage sees the users and the source tabs", async () => {
    await open({ perms: ["users.manage"] });
    expect(screen.getAllByRole("tab").map((x) => x.textContent))
      .toEqual(["İstifadəçilər", "Giriş mənbəyi"]);
  });

  it("shows no tab this build has not built", async () => {
    await open({ built: ["users"] });
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual(["İstifadəçilər"]);
  });

  it("says so when this build has nothing to show", async () => {
    await open({ built: [] });
    expect(screen.getByText("Bu bölməyə giriş səlahiyyətiniz yoxdur.")).toBeInTheDocument();
  });
});

describe("what it asks the API for", () => {
  it("asks only what the session's rights allow", async () => {
    const { api } = await open({ perms: ["users.manage"] });
    expect(api.adminUsers).toHaveBeenCalled();
    expect(api.adminGroups).toHaveBeenCalled();         // a user desk lists the groups it may give
    expect(api.adminPermissions).not.toHaveBeenCalled(); // needs groups.manage
    expect(api.unassignedScopes).toHaveBeenCalled();
  });

  it("a groups desk is not asked for the users", async () => {
    const { api } = await open({ perms: ["groups.manage"] });
    expect(api.adminUsers).not.toHaveBeenCalled();
    expect(api.adminGroups).toHaveBeenCalled();
    expect(api.adminPermissions).toHaveBeenCalled();
  });

  it("hands each tab what was loaded", async () => {
    await open();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("users: 1 / 1");
  });

  it("one refusal does not empty the screen: it is shown and the rest stands", async () => {
    await open({ setup: (api) => api.adminPermissions.mockRejectedValue(refusal(403, "permission required: groups.manage")) });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" "))
      .toContain("səlahiyyətiniz yoxdur (groups.manage)");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("users: 1 / 1");
  });

  it("offers to load again after a refusal", async () => {
    const { api } = await open({ setup: (fake) => fake.adminUsers.mockRejectedValue(refusal(503, "down")) });
    api.adminUsers.mockResolvedValue(USERS);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
      await settle();
    });
    await waitFor(() => expect(screen.getByRole("tabpanel")).toHaveTextContent("users: 1 /"));
  });

  it("says it is loading rather than showing an empty screen", async () => {
    let release;
    const mounted = await mount(<AdminScreen />, {
      access: token({ perms: ["users.manage"] }),
      me: profile({ perms: ["users.manage"] }),
      setup: (api) => {
        tabsBuilt(["users"]);
        api.adminUsers.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        api.adminGroups.mockResolvedValue([]);
        api.unassignedScopes.mockResolvedValue({ unassigned_users: 0 });
      },
    });
    // Two separate things, and the test checks both. The sentence on screen is an ordinary
    // paragraph with no role: a live region that is rendered already holding its text is not
    // announced at all (ui/Alert.jsx), so marking that paragraph role="status" would have looked
    // accessible and said nothing. The announcement comes from the one `Announce` region that was
    // mounted with the screen and takes the text ANNOUNCE_DELAY_MS later.
    const visible = within(screen.getByRole("tabpanel")).getByText("Yüklənir…");
    expect(visible.getAttribute("role")).toBeNull();
    expect(visible.closest('[role="status"]')).toBeNull();
    await waitFor(
      () => expect(screen.getAllByRole("status").map((s) => s.textContent)).toContain("Yüklənir…"),
      { timeout: 4000 },      // 150 ms of real time, under a suite running 99 files in parallel
    );
    await act(async () => { release(USERS); await settle(); });
    expect(mounted.api.adminUsers).toHaveBeenCalled();
  });
});
