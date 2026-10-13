// The mirror is only worth having if it is a mirror: this reads the backend's own catalogue and
// fails when the two drift. (A test may read outside `src/live/` — boundaries.test.js checks the
// sources, not the tests.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_GROUPS, EXTRA_DUTY_SLUGS, PERMISSION_KEYS, ROLE_SLUGS, groupKind, hasPerm,
} from "./catalogue.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = fs.readFileSync(
  path.resolve(HERE, "../../../../../homunculus-engine/src/homunculus/auth/permissions.py"), "utf8",
);

/** The keys of `PERMISSIONS: dict[str, str] = { "key": "description", … }`. */
function backendKeys() {
  const block = /PERMISSIONS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(PY);
  expect(block, "PERMISSIONS block").not.toBeNull();
  return [...block[1].matchAll(/^\s{4}"([\w.]+)":/gm)].map((m) => m[1]);
}

/** The slugs of DEFAULT_GROUPS, in the order the backend lists them. */
function backendGroups() {
  const block = /DEFAULT_GROUPS: tuple\[GroupSpec, \.\.\.\] = \(([\s\S]*?)\n\)/.exec(PY);
  expect(block, "DEFAULT_GROUPS block").not.toBeNull();
  return [...block[1].matchAll(/\{"slug": "(\w+)"/g)].map((m) => m[1]);
}

describe("the permission catalogue mirrors the backend", () => {
  it("has the backend's keys, in the backend's order", () => {
    expect(PERMISSION_KEYS).toEqual(backendKeys());
  });

  it("the reader found a catalogue worth checking", () => {
    expect(backendKeys().length).toBeGreaterThan(15);
    expect(backendKeys()).toContain("users.manage");
  });

  it("has the backend's default groups, in the backend's order", () => {
    expect(DEFAULT_GROUPS.map((g) => g.slug)).toEqual(backendGroups());
  });

  it("marks the system group and the groups that require two-step verification as the backend does", () => {
    const flag = (slug, name) => new RegExp(`\\{"slug": "${slug}"[\\s\\S]*?"${name}": (True|False)`).exec(PY)?.[1];
    for (const group of DEFAULT_GROUPS) {
      expect(flag(group.slug, "is_system") === "True", `${group.slug} is_system`).toBe(group.isSystem);
      expect(flag(group.slug, "mfa_required") === "True", `${group.slug} mfa_required`).toBe(group.mfaRequired);
    }
  });

  it("is frozen: one shared table nothing may widen at run time", () => {
    expect(Object.isFrozen(PERMISSION_KEYS)).toBe(true);
    expect(DEFAULT_GROUPS.every((g) => Object.isFrozen(g))).toBe(true);
    expect(() => { PERMISSION_KEYS.push("x"); }).toThrow(TypeError);
  });
});

describe("role, extra duty, or neither", () => {
  it("names the two duties the user form offers beside a role", () => {
    // Roadmap D3: "Rol + Ek görev + Birimler". A charge nurse is a nurse with more; a
    // rapid-response duty ends with the shift.
    expect(EXTRA_DUTY_SLUGS).toEqual(["charge_nurse", "rapid_response"]);
    expect(ROLE_SLUGS).toContain("nurse");
    expect(ROLE_SLUGS).not.toContain("charge_nurse");
  });

  it("every default group is one or the other", () => {
    expect([...EXTRA_DUTY_SLUGS, ...ROLE_SLUGS].sort()).toEqual(DEFAULT_GROUPS.map((g) => g.slug).sort());
  });

  it("agrees with the backend's own `kind`, which is now where the classification lives", () => {
    // The mirror used to be the ONLY place this was written down. `GroupSpec.kind` carries it now
    // and `GroupOut.kind` reports it, so the mirror is a fallback — for a group the API describes
    // without a kind, and for a desk that cannot read `/admin/groups` at all. A fallback that
    // disagreed with the thing it falls back from would be worse than none, so this reads the
    // backend and fails when the two drift.
    const kinds = new Map(
      [...PY.matchAll(/\{"slug": "(\w+)", "kind": "(\w+)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(kinds.size, "GroupSpec.kind in auth/permissions.py").toBe(DEFAULT_GROUPS.length);
    for (const group of DEFAULT_GROUPS) {
      expect(kinds.get(group.slug), `${group.slug} kind`).toBe(group.kind);
    }
  });

  it("a group the hospital made itself is neither", () => {
    expect(groupKind("nurse")).toBe("role");
    expect(groupKind("charge_nurse")).toBe("extra");
    expect(groupKind("gece_ekibi")).toBe("other");
    expect(groupKind(undefined)).toBe("other");
    expect(groupKind("constructor")).toBe("other");      // no prototype keys
  });
});

describe("hasPerm", () => {
  it("answers from the list it was given, and refuses anything else", () => {
    expect(hasPerm(["users.manage"], "users.manage")).toBe(true);
    expect(hasPerm(["users.manage"], "groups.manage")).toBe(false);
    expect(hasPerm(null, "users.manage")).toBe(false);
    expect(hasPerm(undefined, "users.manage")).toBe(false);
  });
});
