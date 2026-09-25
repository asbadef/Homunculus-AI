// src/liveAuth.js — read the session the backend put into the access token.
//
// The token carries {tenant, groups, perms, mfa_required, mfa_verified} (auth/service.py
// `issue_tokens`). The UI gates on `perms` and nothing else; there is no role map any more, so
// there is nothing to widen by accident. Reading fails closed: a claim that is not the expected
// shape is treated as absent, the way auth/dependencies.py reads it on the server.
//
// Everything here is a DISPLAY and GATING HINT. The signature is not checked in the browser and
// cannot be; the API re-checks the token, its `tv` and the tenant membership on every request.

/** Reason codes for refusing a session. */
export const NO_PERMISSIONS = "NO_PERMISSIONS";
export const NO_BOARD_ACCESS = "NO_BOARD_ACCESS";

/** Decode a JWT payload client-side (display only — the signature is verified by the API). */
export function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    // Decode as UTF-8 so non-ASCII names survive.
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The session described by an access token, or null when the token is unreadable. */
export function sessionFromToken(token) {
  const p = decodeJwtPayload(token);
  if (!p || typeof p !== "object") return null;
  return {
    // A blank slug names no tenant, exactly as on the server (403 NO_TENANT there).
    tenant: typeof p.tenant === "string" && p.tenant.trim() ? p.tenant : null,
    groups: strings(p.groups),
    perms: strings(p.perms),
    mfaRequired: p.mfa_required === true,
    mfaVerified: p.mfa_verified === true,
  };
}

/** Why a session cannot open the clinical UI, or null when it can.
 *  A session naming no tenant holds no rights anywhere (every permission is held in a tenant, and
 *  the server refuses such a token with 403 NO_TENANT), so it reads as NO_PERMISSIONS. */
export function accessProblem(session) {
  if (!session || !Array.isArray(session.perms) || session.perms.length === 0) return NO_PERMISSIONS;
  if (session.tenant == null) return NO_PERMISSIONS;
  if (!session.perms.includes("board.view")) return NO_BOARD_ACCESS;
  return null;
}

/** The shared secret inside an otpauth:// URI, for manual entry into an authenticator. */
export function secretFromProvisioningUri(uri) {
  try {
    return new URL(uri).searchParams.get("secret") || null;
  } catch {
    return null;
  }
}
