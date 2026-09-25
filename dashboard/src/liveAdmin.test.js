// dashboard/src/liveAdmin.test.js — the /admin adapters and the rule hints the admin panels use.
// Synthetic data only.
import { describe, it, expect } from "vitest";
import {
  userFromApi, groupFromApi, groupRights, userRights, rightsBeyond, canGrant, canManageUser,
} from "./liveAdmin.js";
import { PERMISSION_KEYS } from "./permissions.js";

describe("liveAdmin adapters", () => {
  it("maps an /admin/users row onto the UI shape and separates manual group ids", () => {
    const u = userFromApi({
      id: "u1", username: "ayse", email: null, full_name: "Ayşe Demir", auth_source: "ldap",
      is_active: true, totp_enabled: true, last_login_at: "2026-09-23T08:00:00Z",
      groups: [{ id: "g1", slug: "nurse", name: "Hemşire", source: "ldap" },
               { id: "g2", slug: "auditor", name: "Denetçi", source: "manual" }],
    });
    expect(u).toMatchObject({ id: "u1", username: "ayse", email: null, full_name: "Ayşe Demir",
                              active: true, mfa: true, authSource: "ldap",
                              lastLoginAt: "2026-09-23T08:00:00Z" });
    expect(u.groups.map((g) => g.slug)).toEqual(["nurse", "auditor"]);
    expect(u.manualGroupIds).toEqual(["g2"]);
  });

  it("fails closed on missing fields", () => {
    const u = userFromApi({ id: "u2", username: "x", full_name: "X" });
    expect(u).toMatchObject({ active: true, mfa: false, authSource: "local", groups: [], manualGroupIds: [], lastLoginAt: null });
  });

  it("an inactive account reads as inactive", () => {
    expect(userFromApi({ id: "u3", username: "y", full_name: "Y", is_active: false }).active).toBe(false);
  });

  it("maps an /admin/groups row", () => {
    expect(groupFromApi({ id: "g1", slug: "nurse", name: "Hemşire", description: null, mfa_required: false,
                          is_system: false, permissions: ["board.view"], member_count: 3 }))
      .toEqual({ id: "g1", slug: "nurse", name: "Hemşire", description: "", mfaRequired: false,
                 isSystem: false, permissions: ["board.view"], memberCount: 3 });
  });

  it("copies the permission list, so the UI can never edit the loaded row in place", () => {
    const row = { id: "g1", slug: "nurse", name: "Hemşire", permissions: ["board.view"] };
    const g = groupFromApi(row);
    g.permissions.push("users.manage");
    expect(row.permissions).toEqual(["board.view"]);
  });
});

// ---------------------------------------------------------------- the rules (hints only)

const CATALOGUE = PERMISSION_KEYS.map((key) => ({ key, description: key }));
const ADMIN = { id: "g0", slug: "hospital_admin", name: "Sistem Yöneticisi", isSystem: true,
                mfaRequired: true, permissions: [...PERMISSION_KEYS], memberCount: 1 };
const NURSE = { id: "g1", slug: "nurse", name: "Hemşire", isSystem: false, mfaRequired: false,
                permissions: ["board.view", "alerts.ack"], memberCount: 2 };
const DESK = { id: "g2", slug: "user_desk", name: "Kullanıcı Masası", isSystem: false, mfaRequired: true,
               permissions: ["board.view", "users.manage"], memberCount: 1 };
const GROUPS = [ADMIN, NURSE, DESK];

const DESK_PERMS = ["board.view", "users.manage"];           // a users.manage-only desk
const user = (id, groups, extra = {}) => ({
  id, username: id, full_name: id, authSource: "local", active: true, mfa: false,
  groups: groups.map((g) => ({ id: g.id, slug: g.slug, name: g.name, source: "manual" })),
  manualGroupIds: groups.map((g) => g.id), ...extra,
});

describe("groupRights", () => {
  it("is the group's keys for an ordinary group", () => {
    expect(groupRights(NURSE, CATALOGUE)).toEqual(["alerts.ack", "board.view"]);
  });

  it("is the whole catalogue for the system group, whatever rows it reports", () => {
    const stale = { ...ADMIN, permissions: ["users.manage"] };
    expect(groupRights(stale, CATALOGUE)).toEqual([...PERMISSION_KEYS].sort());
  });

  it("still covers the whole catalogue when the catalogue was not loaded (a users.manage desk)", () => {
    expect(groupRights({ ...ADMIN, permissions: [] }, [])).toEqual([...PERMISSION_KEYS].sort());
  });

  it("counts a catalogue key the UI does not know yet as a right of the system group", () => {
    const newer = [...CATALOGUE, { key: "reports.export", description: "" }];
    expect(groupRights(ADMIN, newer)).toContain("reports.export");
  });

  it("reads a raw API row's is_system too", () => {
    expect(groupRights({ id: "g0", is_system: true, permissions: [] }, [])).toEqual([...PERMISSION_KEYS].sort());
  });

  it("is empty for nothing", () => {
    expect(groupRights(null, CATALOGUE)).toEqual([]);
  });
});

describe("userRights", () => {
  it("is the union of the user's groups' rights, AD-held ones included", () => {
    const u = user("u1", [NURSE, DESK]);
    u.groups[0].source = "ldap";
    expect(userRights(u, GROUPS, CATALOGUE)).toEqual(["alerts.ack", "board.view", "users.manage"]);
  });

  it("is the whole catalogue for a member of the system group", () => {
    expect(userRights(user("u0", [ADMIN]), GROUPS)).toEqual([...PERMISSION_KEYS].sort());
  });

  it("is empty for a user in no group", () => {
    expect(userRights(user("u9", []), GROUPS)).toEqual([]);
  });

  it("is unknown (null) when one of the user's groups is not in the list: never assumed small", () => {
    const u = user("u1", [NURSE, { id: "g-gone", slug: "gone", name: "Gone" }]);
    expect(userRights(u, GROUPS)).toBeNull();
    expect(userRights(u, [])).toBeNull();
  });
});

describe("rightsBeyond", () => {
  it("lists, sorted, the rights the session does not hold", () => {
    expect(rightsBeyond(DESK_PERMS, ["users.manage", "groups.manage", "audit.view"]))
      .toEqual(["audit.view", "groups.manage"]);
    expect(rightsBeyond(null, ["board.view"])).toEqual(["board.view"]);
  });
});

describe("canGrant", () => {
  it("allows a group whose rights are within the session's", () => {
    expect(canGrant(DESK_PERMS, NURSE)).toBe(false);          // alerts.ack is beyond the desk
    expect(canGrant(["board.view", "alerts.ack", "users.manage"], NURSE)).toBe(true);
    expect(canGrant(DESK_PERMS, DESK)).toBe(true);
  });

  it("never lets anyone short of the whole catalogue grant the system group", () => {
    const allButOne = PERMISSION_KEYS.filter((k) => k !== "devices.manage");
    expect(canGrant(allButOne, ADMIN, CATALOGUE)).toBe(false);
    expect(canGrant(allButOne, { ...ADMIN, permissions: [] }, [])).toBe(false);
    expect(canGrant([...PERMISSION_KEYS], ADMIN, CATALOGUE)).toBe(true);
  });

  it("refuses without a session or a group", () => {
    expect(canGrant(null, NURSE)).toBe(false);
    expect(canGrant(DESK_PERMS, null)).toBe(false);
  });
});

describe("canManageUser", () => {
  const ALL = [...PERMISSION_KEYS];

  it("lets a desk act on a user whose rights are within its own", () => {
    const r = canManageUser(DESK_PERMS, user("u5", [DESK]), GROUPS, "u-me");
    expect(r).toEqual({ within: true, beyond: [], edit: true, setGroups: true,
                        resetPassword: true, resetMfa: true, deactivate: true });
  });

  it("refuses everything on a user who can do more, and says what more", () => {
    const r = canManageUser(DESK_PERMS, user("u1", [NURSE]), GROUPS, "u-me");
    expect(r).toEqual({ within: false, beyond: ["alerts.ack"], edit: false, setGroups: false,
                        resetPassword: false, resetMfa: false, deactivate: false });
    expect(canManageUser(DESK_PERMS, user("u0", [ADMIN]), GROUPS, "u-me").within).toBe(false);
  });

  it("never offers reset or deactivation on yourself; edit and groups stay", () => {
    const me = user("u-me", [ADMIN]);
    expect(canManageUser(ALL, me, GROUPS, "u-me")).toMatchObject({
      within: true, edit: true, setGroups: true, resetPassword: false, resetMfa: false, deactivate: false,
    });
  });

  it("fails closed when it cannot tell who you are", () => {
    for (const selfId of [null, undefined, ""]) {
      expect(canManageUser(ALL, user("u1", [NURSE]), GROUPS, selfId)).toMatchObject({
        within: true, resetPassword: false, resetMfa: false, deactivate: false,
      });
    }
  });

  it("offers a password reset only for a local account", () => {
    const ad = user("u2", [NURSE], { authSource: "ldap" });
    expect(canManageUser(ALL, ad, GROUPS, "u-me")).toMatchObject({ resetPassword: false, resetMfa: true });
  });

  it("refuses when the user's rights are unknown or the session cannot manage users", () => {
    const unknown = user("u1", [{ id: "g-gone", slug: "gone", name: "Gone" }]);
    expect(canManageUser(ALL, unknown, GROUPS, "u-me")).toMatchObject({ within: false, beyond: null, edit: false });
    const noDesk = ALL.filter((k) => k !== "users.manage");
    expect(canManageUser(noDesk, user("u1", [NURSE]), GROUPS, "u-me").within).toBe(false);
    expect(canManageUser(ALL, null, GROUPS, "u-me").within).toBe(false);
  });
});
