// The fixtures are only worth having if they are the API's shapes: this holds them to the backend
// the way `catalogue.test.js` holds the permission mirror. (A test may read outside `src/live/` —
// boundaries.test.js checks the sources, not the tests.)
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_KEYS } from "./catalogue.js";
import { CATALOGUE, PERMISSION_TEXTS, group, guid, ldapStatus, user } from "./admin.testutil.js";

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
  });

  it("an external id is a UUID, as POST /admin/ldap/import requires", () => {
    expect(guid(7)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(guid(7)).not.toBe(guid(8));
  });
});
