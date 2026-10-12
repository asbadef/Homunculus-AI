// The old workspace's liveAdmin tests, carried over with the module, plus what Wave 3 added:
// `kind`, `scopeFromApi`, `unlockSignIn` and `canMapGroups`. Synthetic accounts only.
import { describe, it, expect } from "vitest";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  canGrant, canManageUser, canMapGroups, groupFromApi, groupRights, rightsBeyond, scopeFromApi,
  userFromApi, userRights,
} from "./rules.js";

const CATALOGUE = PERMISSION_KEYS.map((key) => ({ key, description: key }));
const group = (over = {}) => groupFromApi({
  id: "g-nurse", slug: "nurse", name: "Hemşire", description: "", mfa_required: false,
  is_system: false, permissions: ["board.view", "alerts.ack"], member_count: 4, ...over,
});
const SYSTEM = group({ id: "g-admin", slug: "hospital_admin", name: "Sistem Yöneticisi", is_system: true, permissions: ["users.manage"] });

describe("userFromApi", () => {
  it("reads the account the API describes", () => {
    const user = userFromApi({
      id: "u-1", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Sentetik",
      auth_source: "local", is_active: true, totp_enabled: true, must_change_password: true,
      last_login_at: "2026-10-07T08:00:00Z",
      groups: [{ id: "g-nurse", slug: "nurse", name: "Hemşire", source: "manual" }],
    });
    expect(user).toMatchObject({
      id: "u-1", username: "ayse", fullName: "Ayşe Sentetik", authSource: "local",
      active: true, mfa: true, mustChangePassword: true,
    });
    expect(user.groups[0]).toEqual({ id: "g-nurse", slug: "nurse", name: "Hemşire", source: "manual", kind: "role" });
    expect(user.manualGroupIds).toEqual(["g-nurse"]);
  });

  it("says which of a group is a role, an extra duty, or the hospital's own", () => {
    const user = userFromApi({ groups: [
      { id: "a", slug: "nurse" }, { id: "b", slug: "charge_nurse" }, { id: "c", slug: "gece_ekibi" },
    ] });
    expect(user.groups.map((g) => g.kind)).toEqual(["role", "extra", "other"]);
  });

  it("leaves out a membership the directory holds when listing what may be replaced", () => {
    // `PUT /users/{id}/groups` replaces the MANUAL memberships; a directory-held one is AD's.
    const user = userFromApi({ groups: [
      { id: "a", slug: "nurse", source: "manual" }, { id: "b", slug: "physician", source: "directory" },
    ] });
    expect(user.manualGroupIds).toEqual(["a"]);
    expect(user.groups).toHaveLength(2);
  });

  it("an account the API says nothing about is shown as it is, not quietly hidden", () => {
    expect(userFromApi({}).active).toBe(true);
    expect(userFromApi(null).active).toBe(true);
    expect(userFromApi({}).mfa).toBe(false);
    expect(userFromApi({}).mustChangePassword).toBe(false);
    expect(userFromApi({}).groups).toEqual([]);
  });

  it("an account with no e-mail has none, not an empty one", () => {
    expect(userFromApi({ email: null }).email).toBeNull();
  });
});

describe("groupFromApi", () => {
  it("reads the group the API describes", () => {
    expect(group()).toMatchObject({
      id: "g-nurse", slug: "nurse", name: "Hemşire", mfaRequired: false, isSystem: false,
      kind: "role", memberCount: 4,
    });
    expect(group().permissions).toEqual(["board.view", "alerts.ack"]);
  });

  it("a member count the API did not send is none", () => {
    expect(group({ member_count: null }).memberCount).toBe(0);
    expect(groupFromApi(null).memberCount).toBe(0);
  });
});

describe("scopeFromApi", () => {
  it("reads the units, the beds and the grants that are still active", () => {
    const scope = scopeFromApi({
      user_id: "u-1", unrestricted: false, reason: "assigned",
      unit_ids: ["rea-01"], bed_ids: ["rea-01-2"],
      grants: [
        { unit_id: "REA-01", bed_id: "", is_active: true },
        { unit_id: "", bed_id: "REA-01-2", is_active: true },
        { unit_id: "NICU-01", bed_id: "", is_active: false },   // revoked
      ],
    });
    expect(scope).toMatchObject({ userId: "u-1", unrestricted: false, reason: "assigned" });
    expect(scope.grants).toEqual([{ unitId: "REA-01", bedId: "" }, { unitId: "", bedId: "REA-01-2" }]);
  });

  it("a scope the API could not resolve is not an empty one", () => {
    // The resolver's own answer for "we could not find out" (scope/resolver.py UNKNOWN).
    expect(scopeFromApi({ unrestricted: false, reason: "unknown" }).reason).toBe("unknown");
    expect(scopeFromApi(null)).toMatchObject({ unrestricted: false, reason: "unknown", grants: [] });
  });
});

describe("groupRights", () => {
  it("is a group's own keys, within the catalogue", () => {
    expect(groupRights(group(), CATALOGUE)).toEqual(["alerts.ack", "board.view"]);
  });

  it("drops a key the catalogue no longer holds", () => {
    expect(groupRights(group({ permissions: ["board.view", "eski.yetki"] }), CATALOGUE)).toEqual(["board.view"]);
  });

  it("the SYSTEM group holds everything, even to a desk that cannot read the catalogue", () => {
    // A `users.manage` desk gets 403 from /admin/permissions. Without the mirror it would read the
    // system group as holding one key and offer to give it away.
    expect(groupRights(SYSTEM, [])).toEqual([...PERMISSION_KEYS].sort());
    expect(groupRights(SYSTEM, CATALOGUE)).toEqual([...PERMISSION_KEYS].sort());
  });

  it("without a catalogue, a group's keys are taken as they are", () => {
    expect(groupRights(group({ permissions: ["board.view", "eski.yetki"] }), [])).toEqual(["board.view", "eski.yetki"]);
  });

  it("nothing at all is no rights", () => {
    expect(groupRights(null, CATALOGUE)).toEqual([]);
    expect(groupRights(undefined)).toEqual([]);
  });
});

describe("userRights", () => {
  it("is the union of the user's groups, manual and directory alike", () => {
    const groups = [group(), group({ id: "g-rrt", slug: "rapid_response", permissions: ["alerts.escalate"] })];
    const user = userFromApi({ groups: [{ id: "g-nurse", source: "manual" }, { id: "g-rrt", source: "directory" }] });
    expect(userRights(user, groups, CATALOGUE)).toEqual(["alerts.ack", "alerts.escalate", "board.view"]);
  });

  it("is UNKNOWN when a group of the user's is not in the list — never taken to be small", () => {
    const user = userFromApi({ groups: [{ id: "g-missing", source: "manual" }] });
    expect(userRights(user, [group()], CATALOGUE)).toBeNull();
  });

  it("a user in no group holds nothing", () => {
    expect(userRights(userFromApi({ groups: [] }), [group()], CATALOGUE)).toEqual([]);
  });
});

describe("rightsBeyond", () => {
  it("names what the session lacks, sorted", () => {
    expect(rightsBeyond(["board.view"], ["board.view", "users.manage", "audit.view"]))
      .toEqual(["audit.view", "users.manage"]);
    expect(rightsBeyond(PERMISSION_KEYS, PERMISSION_KEYS)).toEqual([]);
  });
});

describe("canGrant", () => {
  it("only a group within the session's own rights", () => {
    expect(canGrant(["board.view", "alerts.ack", "users.manage"], group(), CATALOGUE)).toBe(true);
    expect(canGrant(["board.view", "users.manage"], group(), CATALOGUE)).toBe(false);
  });

  it("never the system group, unless the session holds everything", () => {
    expect(canGrant(["users.manage"], SYSTEM, CATALOGUE)).toBe(false);
    expect(canGrant([...PERMISSION_KEYS], SYSTEM, CATALOGUE)).toBe(true);
  });

  it("refuses what it cannot decide", () => {
    expect(canGrant(["users.manage"], null, CATALOGUE)).toBe(false);
    expect(canGrant(null, group(), CATALOGUE)).toBe(false);
  });
});

describe("canManageUser", () => {
  const groups = [group()];
  const nurse = userFromApi({ id: "u-2", auth_source: "local", groups: [{ id: "g-nurse", slug: "nurse", source: "manual" }] });
  const ad = userFromApi({ id: "u-3", auth_source: "ldap", groups: [{ id: "g-nurse", slug: "nurse", source: "manual" }] });
  const DESK = ["users.manage", "board.view", "alerts.ack"];

  it("a desk within whose rights the user falls may act", () => {
    expect(canManageUser(DESK, nurse, groups, "u-1", CATALOGUE)).toMatchObject({
      within: true, edit: true, setGroups: true, resetPassword: true, resetMfa: true, deactivate: true,
    });
  });

  it("names the rights the session lacks, and acts on nothing", () => {
    const admin = userFromApi({ id: "u-9", groups: [{ id: "g-admin", slug: "hospital_admin", source: "manual" }] });
    const verdict = canManageUser(DESK, admin, [SYSTEM], "u-1", CATALOGUE);
    expect(verdict.within).toBe(false);
    expect(verdict.beyond).toContain("groups.manage");   // the system group holds everything
    expect(verdict.edit).toBe(false);
  });

  it("unknown rights refuse everything", () => {
    const stranger = userFromApi({ id: "u-4", groups: [{ id: "g-?", source: "manual" }] });
    const verdict = canManageUser(DESK, stranger, groups, "u-1", CATALOGUE);
    expect(verdict.beyond).toBeNull();
    expect(verdict.within).toBe(false);
  });

  it("nobody resets or deactivates themselves", () => {
    const verdict = canManageUser(DESK, { ...nurse, id: "u-1" }, groups, "u-1", CATALOGUE);
    expect(verdict.edit).toBe(true);                 // a name or an e-mail, yes
    expect(verdict.resetPassword).toBe(false);
    expect(verdict.resetMfa).toBe(false);
    expect(verdict.deactivate).toBe(false);
    expect(verdict.unlockSignIn).toBe(false);
  });

  it("without an id for the session, the user might be yourself: refuse", () => {
    expect(canManageUser(DESK, nurse, groups, null, CATALOGUE).resetPassword).toBe(false);
    expect(canManageUser(DESK, nurse, groups, "", CATALOGUE).deactivate).toBe(false);
  });

  it("a directory account's password is AD's, and only it has a sign-in throttle to lift", () => {
    expect(canManageUser(DESK, ad, groups, "u-1", CATALOGUE).resetPassword).toBe(false);
    expect(canManageUser(DESK, ad, groups, "u-1", CATALOGUE).unlockSignIn).toBe(true);
    expect(canManageUser(DESK, nurse, groups, "u-1", CATALOGUE).unlockSignIn).toBe(false);
  });

  it("a desk without users.manage may do nothing at all", () => {
    expect(canManageUser(["groups.manage"], nurse, groups, "u-1", CATALOGUE))
      .toMatchObject({ within: false, edit: false, setGroups: false });
  });
});

describe("canMapGroups", () => {
  it("only an administrator who holds every key", () => {
    // The server's own rule (403 MAPPING_ADMIN_ONLY): a desk that may not regroup one nurse
    // directly must not be able to regroup every nurse at once through the mapping.
    expect(canMapGroups([...PERMISSION_KEYS], CATALOGUE)).toBe(true);
    expect(canMapGroups(["users.manage"], CATALOGUE)).toBe(false);
    expect(canMapGroups([], CATALOGUE)).toBe(false);
  });

  it("falls back to the mirrored catalogue when the session cannot read the real one", () => {
    expect(canMapGroups([...PERMISSION_KEYS], [])).toBe(true);
    expect(canMapGroups(["users.manage"], [])).toBe(false);
  });
});
