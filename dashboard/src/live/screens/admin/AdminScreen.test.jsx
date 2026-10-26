import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { resetScreens } from "../../shell/routes.js";
import { AdminScreen, TABS, onlyTabs, openTabs, resetTabs, tabScreenOf } from "./AdminScreen.jsx";
import { READS } from "./useAdminData.js";

import { StructureTab } from "./StructureTab.jsx"; // G2-B1a

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** A list's length, or "null" for a read that has no answer — never 0 for "no answer". */
const len = (list) => (Array.isArray(list) ? list.length : "null");

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

/** Stand-ins for the tabs, which are built on their own branches. `onlyTabs` — not `stubTabs` —
 *  because the subject of these tests is WHICH tabs exist: `ids` names the tabs this test's build
 *  has, and every other tab has none, whatever the real build built. With `stubTabs`, which only
 *  assigns, three of the tests below passed for a build with no tabs and broke the day the first
 *  one landed, in a file none of the three parallel branches owns. */
function tabsBuilt(ids) {
  const stubs = {};
  for (const id of ids) {
    stubs[id] = ({ admin }) => <p>{`${id}: ${len(admin.data.users)} / ${len(admin.data.groups)}`}</p>;
  }
  return onlyTabs(stubs);
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
  it("names the four tabs, each with the right that opens it", () => {
    expect(TABS.map((x) => [x.id, x.perm])).toEqual([
      ["users", "users.manage"], ["roles", "groups.manage"], ["source", "users.manage"],
      ["structure", "structure.manage"], // G2-B1a
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

  // G2-B1a — on this build's own tabs: Yapı is built, and `structure.manage` alone opens it.
  it("offers the structure tab to structure.manage, and to no other right", () => {
    expect(openTabs(["structure.manage"]).map((x) => x.id)).toEqual(["structure"]);
    expect(tabScreenOf(openTabs(["structure.manage"])[0])).toBe(StructureTab);
    expect(openTabs(["users.manage", "groups.manage"]).map((x) => x.id)).not.toContain("structure");
  });

  it("the seam refuses outside the test build, and gives the build's tabs back", () => {
    // `onlyTabs` takes every tab away but the one it names; `resetTabs` hands the BUILD's tabs
    // back — whatever this build has, which is the point: the seam is not a second source of
    // truth about what was built.
    // Read, never pinned: which tabs THIS build has is the build's business, and a branch that
    // lands one must not have to edit this file.
    const asBuilt = TABS.map(tabScreenOf);
    onlyTabs({ roles: () => null });
    expect(tabScreenOf(TABS[1])).toBeTypeOf("function");
    expect(tabScreenOf(TABS[0])).toBeNull();
    resetTabs();
    expect(TABS.map(tabScreenOf)).toEqual(asBuilt);
    vi.stubEnv("MODE", "production");
    try {
      expect(() => onlyTabs({ users: () => null })).toThrow(/test seam/);
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

describe("what the frame knows about each read", () => {
  /** A tab that prints what the frame handed it, read by read, and can reload as a write does. */
  function Reads({ admin }) {
    return (
      <>
        <p data-testid="reads">{READS.map((read) => `${read}=${admin.reads[read]}`).join(" ")}</p>
        <p data-testid="data">
          {`users=${len(admin.data.users)} groups=${len(admin.data.groups)} catalogue=${len(admin.data.catalogue)} unassigned=${admin.data.unassigned}`}
        </p>
        <button type="button" onClick={() => admin.reload()}>after-a-write</button>
      </>
    );
  }

  async function openReads({ perms = ["users.manage", "groups.manage"], setup, wrap = (ui) => ui } = {}) {
    onlyTabs({ users: Reads, roles: Reads, source: Reads });
    const mounted = await mount(wrap(<AdminScreen />), {
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
  const reads = () => screen.getByTestId("reads").textContent;
  const data = () => screen.getByTestId("data").textContent;
  const alerts = () => screen.getAllByRole("alert").map((a) => a.textContent).join(" ");

  it("an answered read is known; one the session may not make is unasked and null — never an empty list", async () => {
    await openReads({ perms: ["groups.manage"] });
    expect(reads()).toBe("users=unasked groups=known catalogue=known unassigned=unasked");
    expect(data()).toBe("users=null groups=1 catalogue=1 unassigned=null");
  });

  it("a read that never answered is FAILED and null, and the Alert names it", async () => {
    // `[]` for a failed read was the same value as "the hospital has no users", and the users tab
    // then said "no user matches" under an Alert that did not say which read had failed.
    await openReads({ setup: (api) => api.adminUsers.mockRejectedValue(refusal(503, "down")) });
    expect(reads()).toBe("users=failed groups=known catalogue=known unassigned=known");
    expect(data()).toBe("users=null groups=1 catalogue=1 unassigned=2");
    expect(alerts()).toContain("İstifadəçi siyahısı oxunmadı: Server hazırda əlçatan deyil.");
  });

  it("a reload after a write that fails to re-read keeps the last answer, marks it stale, and says what is shown", async () => {
    // Measured by the review: users went 3 → 0 under an Alert that named no read, and the tab
    // read "no matching users" about a hospital whose list had been on screen a second earlier.
    const { api } = await openReads();
    expect(data()).toBe("users=1 groups=1 catalogue=1 unassigned=2");
    api.adminUsers.mockRejectedValue(refusal(503, "down"));
    await act(async () => { fireEvent.click(screen.getByText("after-a-write")); await settle(); });
    expect(data()).toBe("users=1 groups=1 catalogue=1 unassigned=2");
    expect(reads()).toBe("users=stale groups=known catalogue=known unassigned=known");
    expect(alerts()).toContain(
      "İstifadəçi siyahısı yenidən oxunmadı: Server hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin. Göstərilən son alınmış cavabdır.",
    );
    // And the next answer that lands makes it known again, and the Alert goes.
    api.adminUsers.mockResolvedValue([...USERS, { ...USERS[0], id: "u-2", username: "kamran" }]);
    await act(async () => { fireEvent.click(screen.getByText("after-a-write")); await settle(); });
    expect(reads()).toBe("users=known groups=known catalogue=known unassigned=known");
    expect(data()).toBe("users=2 groups=1 catalogue=1 unassigned=2");
    expect(alerts().trim()).toBe("");
  });

  it("a read that timed out says nothing was read — not that the operation may have happened", async () => {
    // errors.requestTimeout is a WRITE's warning ("it may have happened; check before repeating").
    // Nothing happens when a list is not read.
    await openReads({ setup: (api) => api.adminGroups.mockRejectedValue(Object.assign(new Error("…"), { code: "REQUEST_TIMEOUT" })) });
    expect(alerts()).toContain("Qrup siyahısı oxunmadı: Server vaxtında cavab vermədi; heç nə oxunmadı.");
    expect(alerts()).not.toMatch(/yerinə yetirilmiş ola bilər/);
  });

  it("Retry keeps its button and its focus while it runs, and hands the focus to the heading when the Alert goes", async () => {
    // The button used to unmount itself on the click (the Alert was cleared before the reload),
    // and a keyboard user's focus fell to <body> with nothing said.
    let release;
    const { api } = await openReads({ setup: (fake) => fake.adminGroups.mockRejectedValue(refusal(503, "down")) });
    const retry = screen.getByRole("button", { name: "Yenidən cəhd et" });
    retry.focus();
    api.adminGroups.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await act(async () => { fireEvent.click(retry); await settle(); });
    expect(document.body.contains(retry)).toBe(true);
    expect(retry).toHaveAttribute("aria-busy", "true");
    expect(retry).not.toBeDisabled();                        // busy, never disabled
    expect(document.activeElement).toBe(retry);
    await act(async () => { release(GROUPS); await settle(); });
    await act(async () => { await settle(); });
    expect(document.body.contains(retry)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("lands its answers under StrictMode, whose rehearsal unmounts and remounts every effect", async () => {
    // A `mounted` ref set true only at creation was set false by the rehearsal's cleanup and never
    // back: every answer after it was dropped as "unmounted", and the screen said "loading" forever.
    await openReads({ wrap: (ui) => <React.StrictMode>{ui}</React.StrictMode> });
    expect(reads()).toBe("users=known groups=known catalogue=known unassigned=known");
    expect(data()).toBe("users=1 groups=1 catalogue=1 unassigned=2");
  });
});
