// dashboard/src/liveAuth.test.js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeJwtPayload, sessionFromToken, accessProblem, secretFromProvisioningUri,
  NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";

// A default group's rights, read from the backend's own catalogue (auth/permissions.py) as text:
// the rights a token carries are the server's, and the dashboard keeps no copy of them to drift.
// Only groups written as a literal tuple — `"permissions": ("board.view", …)` — can be read; a
// derived one (hospital_admin, unit_physician) fails here, loudly, rather than reading as empty.
const PERMISSIONS_PY = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../homunculus-engine/src/homunculus/auth/permissions.py"), "utf8");
function backendPermsOf(slug) {
  const spec = new RegExp(`\\{"slug": "${slug}"[^}]*?"permissions": \\(([^)]*)\\)`).exec(PERMISSIONS_PY);
  if (!spec) throw new Error(`auth/permissions.py: no literal permissions tuple for "${slug}"`);
  return [...spec[1].matchAll(/"([\w.]+)"/g)].map((m) => m[1]);
}

/** Build an unsigned JWT-shaped token (only the payload matters to the client).
 *  Encodes UTF-8 bytes before base64url, exactly as a real JWT library does — btoa() alone
 *  cannot represent non-ASCII characters. Synthetic: no real account, no real signature. */
function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("decodeJwtPayload", () => {
  it("reads the payload of a base64url token", () => {
    expect(decodeJwtPayload(tokenWith({ sub: "u1" })).sub).toBe("u1");
  });
  it("returns null for a malformed token instead of throwing", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
  });
  it("handles unicode in the payload", () => {
    expect(decodeJwtPayload(tokenWith({ name: "Dr. Elif Yılmaz" })).name).toBe("Dr. Elif Yılmaz");
  });
});

describe("sessionFromToken", () => {
  it("reads tenant, groups, perms and the MFA flags", () => {
    const s = sessionFromToken(tokenWith({
      tenant: "demo-hastanesi", groups: ["nurse"], perms: ["board.view", "alerts.ack"],
      mfa_required: true, mfa_verified: false,
    }));
    expect(s).toEqual({
      tenant: "demo-hastanesi", groups: ["nurse"], perms: ["board.view", "alerts.ack"],
      mfaRequired: true, mfaVerified: false,
    });
  });

  it("fails closed on missing or malformed claims", () => {
    expect(sessionFromToken(tokenWith({ sub: "u1" }))).toEqual({
      tenant: null, groups: [], perms: [], mfaRequired: false, mfaVerified: false,
    });
    expect(sessionFromToken(tokenWith({ perms: "board.view", groups: 7 })).perms).toEqual([]);
    expect(sessionFromToken(tokenWith({ perms: ["board.view", 3, null] })).perms).toEqual(["board.view"]);
    expect(sessionFromToken("garbage")).toBeNull();
  });

  it("reads a blank tenant as none, as the server does", () => {
    // auth/dependencies.py and the board resolver treat a blank slug as no tenant (403 NO_TENANT).
    expect(sessionFromToken(tokenWith({ tenant: "", perms: ["board.view"] })).tenant).toBeNull();
    expect(sessionFromToken(tokenWith({ tenant: "   ", perms: ["board.view"] })).tenant).toBeNull();
    expect(sessionFromToken(tokenWith({ tenant: 7, perms: ["board.view"] })).tenant).toBeNull();
  });

  it("does not read a truthy non-boolean as an MFA flag", () => {
    const s = sessionFromToken(tokenWith({ mfa_required: "true", mfa_verified: 1 }));
    expect(s.mfaRequired).toBe(false);
    expect(s.mfaVerified).toBe(false);
  });
});

describe("accessProblem", () => {
  const s = (perms) => ({ tenant: "t", groups: [], perms, mfaRequired: false, mfaVerified: false });
  it("refuses a session with no permissions at all", () => {
    expect(accessProblem(s([]))).toBe(NO_PERMISSIONS);
    expect(accessProblem(null)).toBe(NO_PERMISSIONS);
    expect(accessProblem({ tenant: "t" })).toBe(NO_PERMISSIONS);   // not a session: fail closed
  });
  it("refuses a session that names no tenant", () => {
    // Every right is held in a tenant; the server answers 403 NO_TENANT to such a token on every
    // tenant-scoped route, and a refresh would mint the same token.
    expect(accessProblem({ ...s(["board.view"]), tenant: null })).toBe(NO_PERMISSIONS);
  });
  it("refuses a session that cannot see the board", () => {
    expect(accessProblem(s(["devices.manage"]))).toBe(NO_BOARD_ACCESS);
  });
  it("accepts a session with board.view", () => {
    expect(accessProblem(s(["board.view"]))).toBeNull();
  });
});

describe("secretFromProvisioningUri", () => {
  it("extracts the shared secret for manual authenticator entry", () => {
    expect(secretFromProvisioningUri("otpauth://totp/Homunculus:ayse?secret=JBSWY3DPEHPK3PXP&issuer=Homunculus"))
      .toBe("JBSWY3DPEHPK3PXP");
  });
  it("returns null when there is none", () => {
    expect(secretFromProvisioningUri("otpauth://totp/x")).toBeNull();
    expect(secretFromProvisioningUri("nonsense")).toBeNull();
  });
});

describe("the pharmacist and biomedical groups in the permission model", () => {
  // On main these were two roles (PHARMACIST, BIOMEDICAL, engine migration 0007) the UI mapped
  // from the token's `roles`. Here a token carries its groups' `perms`, and what opens the
  // clinical UI is board.view (accessProblem), not the name of a role.
  const permsOf = backendPermsOf;
  const sessionFor = (...slugs) => sessionFromToken(tokenWith({
    tenant: "demo-hastanesi", groups: slugs, perms: [...new Set(slugs.flatMap(permsOf))],
  }));

  it("a pharmacist (board.view, admissions.view) opens a session", () => {
    const session = sessionFor("pharmacist");
    expect(session.perms).toEqual(expect.arrayContaining(["board.view", "admissions.view"]));
    expect(accessProblem(session)).toBeNull();
  });

  it("a biomedical engineer (devices.manage, no board.view) is refused the clinical UI", () => {
    const session = sessionFor("biomedical");
    expect(session.perms).toEqual(["devices.manage"]);
    expect(accessProblem(session)).toBe(NO_BOARD_ACCESS);
  });

  it("the biomedical group does not take the board from a nurse who also holds it", () => {
    expect(accessProblem(sessionFor("biomedical", "nurse"))).toBeNull();
  });
});
