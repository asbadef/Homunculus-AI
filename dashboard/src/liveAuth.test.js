import { describe, it, expect } from "vitest";
import { decodeJwtPayload, roleFromToken, UNSUPPORTED_ROLE } from "./liveAuth.js";
import { ROLE } from "./clinicalDemo.js";

/** Build an unsigned JWT-shaped token (only the payload matters to the client).
 *  Encodes UTF-8 bytes before base64url, exactly as a real JWT library does — btoa() alone
 *  cannot represent non-ASCII characters. */
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
    const t = tokenWith({ sub: "u1", roles: { "tenant-1": "ATTENDING" } });
    expect(decodeJwtPayload(t).sub).toBe("u1");
  });

  it("returns null for a malformed token instead of throwing", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload(null)).toBeNull();
  });

  it("handles unicode in the payload", () => {
    const t = tokenWith({ name: "Dr. Elif Yılmaz" });
    expect(decodeJwtPayload(t).name).toBe("Dr. Elif Yılmaz");
  });
});

describe("roleFromToken", () => {
  it("maps the backend roles that have a direct UI equivalent", () => {
    expect(roleFromToken(tokenWith({ roles: { t: "ATTENDING" } }))).toBe(ROLE.ATTENDING);
    expect(roleFromToken(tokenWith({ roles: { t: "CHARGE_NURSE" } }))).toBe(ROLE.CHARGE_NURSE);
    expect(roleFromToken(tokenWith({ roles: { t: "HOSPITAL_ADMIN" } }))).toBe(ROLE.HOSPITAL_ADMIN);
    expect(roleFromToken(tokenWith({ roles: { t: "RAPID_RESPONSE" } }))).toBe(ROLE.RRT);
  });

  it("maps the physician variants onto the physician panel", () => {
    for (const r of ["ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN", "UNIT_PHYSICIAN"]) {
      expect(roleFromToken(tokenWith({ roles: { t: r } }))).toBe(ROLE.ATTENDING);
    }
  });

  it("maps a plain NURSE onto the nurse panel", () => {
    expect(roleFromToken(tokenWith({ roles: { t: "NURSE" } }))).toBe(ROLE.CHARGE_NURSE);
  });

  it("FAILS CLOSED for roles with no safe UI equivalent — never silently grants admin", () => {
    // AUDITOR is read-only and PLATFORM_SUPPORT is vendor-side; mapping either onto
    // HOSPITAL_ADMIN would be a privilege escalation.
    expect(roleFromToken(tokenWith({ roles: { t: "AUDITOR" } }))).toBe(UNSUPPORTED_ROLE);
    expect(roleFromToken(tokenWith({ roles: { t: "PLATFORM_SUPPORT" } }))).toBe(UNSUPPORTED_ROLE);
    expect(roleFromToken(tokenWith({ roles: { t: "SOMETHING_NEW" } }))).toBe(UNSUPPORTED_ROLE);
  });

  it("returns null when the token carries no roles at all", () => {
    expect(roleFromToken(tokenWith({ sub: "u1" }))).toBeNull();
    expect(roleFromToken(tokenWith({ roles: {} }))).toBeNull();
    expect(roleFromToken("garbage")).toBeNull();
  });

  it("prefers the highest-privilege role when a user holds several", () => {
    const t = tokenWith({ roles: { a: "NURSE", b: "HOSPITAL_ADMIN", c: "ATTENDING" } });
    expect(roleFromToken(t)).toBe(ROLE.HOSPITAL_ADMIN);
  });
});

describe("the two roles the UI had and the backend did not", () => {
  // Both were drawn on screens — the pharmacist since the medication work, the biomedical
  // engineer since the device inventory — while no account could hold either, so the device
  // page was unreachable by the only role whose job it is. Added to the engine in 0007.
  it("a pharmacist signs in as a pharmacist", () => {
    expect(roleFromToken(tokenWith({ roles: { t: "PHARMACIST" } }))).toBe("PHARMACIST");
  });

  it("a biomedical engineer signs in as one", () => {
    expect(roleFromToken(tokenWith({ roles: { t: "BIOMEDICAL" } }))).toBe("BIOMEDICAL");
  });

  it("neither outranks a clinical role held by the same person", () => {
    // Someone who is both a nurse and the biomedical contact gets the ward, not the devices.
    expect(roleFromToken(tokenWith({ roles: { a: "BIOMEDICAL", b: "CHARGE_NURSE" } })))
      .toBe("CHARGE_NURSE");
    expect(roleFromToken(tokenWith({ roles: { a: "PHARMACIST", b: "ATTENDING" } })))
      .toBe("ATTENDING");
  });

  it("still fails closed for roles with no UI at all", () => {
    expect(roleFromToken(tokenWith({ roles: { t: "AUDITOR" } }))).toBe(UNSUPPORTED_ROLE);
  });
});
