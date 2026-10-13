// The fixtures are only worth having if they are the API's shapes: this holds them to the backend
// the way `catalogue.test.js` holds the permission mirror. (A test may read outside `src/live/` —
// boundaries.test.js checks the sources, not the tests.)
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_KEYS } from "./catalogue.js";
import {
  ADMIN_READS, ADMIN_WRITES, CATALOGUE, GROUPS, PERMISSION_TEXTS, USERS, adminProp, group, guid, ldapStatus, user,
} from "./admin.testutil.js";
import { groupFromApi, userFromApi } from "./rules.js";
import { fakeApi } from "../../session/testTokens.testutil.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = fs.readFileSync(
  path.resolve(HERE, "../../../../../homunculus-engine/src/homunculus/auth/permissions.py"), "utf8",
);

/** `PERMISSIONS: dict[str, str] = { "key": "description", … }`, with Python's adjacent-string
 *  concatenation folded, so a description split over two source lines reads as one. */
function backendDescriptions() {
  const block = /PERMISSIONS: dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(PY);
  expect(block, "PERMISSIONS block").not.toBeNull();
  const out = {};
  for (const m of block[1].matchAll(/^\s{4}"([\w.]+)":\s*((?:"(?:[^"\\]|\\.)*"\s*)+),/gm)) {
    out[m[1]] = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((q) => q[1]).join("");
  }
  return out;
}

describe("the administration fixtures are the API's own shapes", () => {
  it("the permission descriptions are the server's, word for word", () => {
    // A fixture that said anything else would let a tab pass its tests against a payload the
    // server cannot send. The first draft of this fixture was Turkish: every roles test passed
    // against text the server has never served.
    const backend = backendDescriptions();
    expect(Object.keys(backend).length).toBe(PERMISSION_KEYS.length);
    for (const key of PERMISSION_KEYS) expect(PERMISSION_TEXTS[key], key).toBe(backend[key]);
    expect(CATALOGUE.map((row) => row.key)).toEqual([...PERMISSION_KEYS]);
    expect(CATALOGUE.every((row) => typeof row.description === "string" && row.description.length > 0)).toBe(true);
  });

  it("the directory's status carries the host only", () => {
    // `auth/ldap.py`: `url_host` is `parts.hostname` — no scheme, no port, and never a DN.
    expect(ldapStatus().url_host).toBe("dc01.sentetik.local");
    expect(ldapStatus().url_host).not.toMatch(/:|\/|=/);
  });

  it("the builders are positional and refuse the other shape", () => {
    expect(() => group({ slug: "nurse" })).toThrow(TypeError);
    expect(() => user({ id: "u-1" })).toThrow(TypeError);
    expect(group("gece_ekibi").kind).toBeNull();                 // a hospital's own group
    expect(group("charge_nurse").kind).toBe("extra");
  });

  it("an external id is a UUID, as POST /admin/ldap/import requires", () => {
    expect(guid(7)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(guid(7)).not.toBe(guid(8));
  });
});

describe("ADMIN_READS", () => {
  it("answers every read, and makes every write the test did not state REJECT — silence is not success", async () => {
    // An unstubbed `vi.fn()` resolves `undefined`, which a tab reads as "the server took it": a
    // write test that forgot to say what the server answers would pass on a success nobody chose.
    const api = ADMIN_READS(fakeApi(vi));
    await expect(api.adminUsers()).resolves.toEqual(USERS);
    expect(ADMIN_WRITES.length).toBeGreaterThan(10);
    for (const write of ADMIN_WRITES) {
      expect(api[write], write).toBeTypeOf("function");
      // eslint-disable-next-line no-await-in-loop
      await expect(api[write](), write).rejects.toThrow(/was not stubbed/);
    }
    // A test that states the answer gets it.
    api.adminResetMfa.mockResolvedValue({ ok: true });
    await expect(api.adminResetMfa("u-1")).resolves.toEqual({ ok: true });
  });
});

describe("adminProp — the prop the frame hands a tab, for a tab mounted on its own", () => {
  it("goes through the loader's own adapters, says every answered read is known, and reloads", async () => {
    const admin = adminProp();
    expect(admin.data.users).toEqual(USERS.map(userFromApi));
    expect(admin.data.groups).toEqual(GROUPS.map(groupFromApi));
    expect(admin.data.catalogue).toEqual(CATALOGUE);
    expect(admin.data.unassigned).toBe(2);
    expect(admin.reads).toEqual({ users: "known", groups: "known", catalogue: "known", unassigned: "known" });
    expect(admin.failures).toEqual([]);
    expect(admin.loading).toBe(false);
    await expect(admin.reload()).resolves.toBeUndefined();
    expect(admin.reload).toHaveBeenCalledTimes(1);
  });

  it("a read with no answer is null and failed unless the test says unasked; a stale one keeps its answer", () => {
    expect(adminProp({ unassigned: null }).reads.unassigned).toBe("failed");
    const narrow = adminProp({ users: null, unassigned: null, reads: { users: "unasked", unassigned: "unasked" } });
    expect(narrow.data.users).toBeNull();
    expect(narrow.reads).toMatchObject({ users: "unasked", unassigned: "unasked", groups: "known" });
    expect(adminProp({ reads: { users: "stale" } }).data.users).toHaveLength(USERS.length);
  });

  it("refuses a state the loader cannot produce, so no tab is tested against one", () => {
    // "known" and "stale" carry an answer; "unasked", "loading" and "failed" carry none.
    expect(() => adminProp({ users: null, reads: { users: "known" } })).toThrow(/the loader cannot produce/);
    expect(() => adminProp({ reads: { catalogue: "failed" } })).toThrow(/the loader cannot produce/);
    expect(() => adminProp({ reads: { groups: "maybe" } })).toThrow(/the loader cannot produce/);
  });
});
