// src/liveAuth.js — translate the backend's identity into what the UI understands.
//
// The access token carries {roles: {tenant_id: BACKEND_ROLE}}; the UI routes on its own smaller
// ROLE set. Mapping is explicit and **fails closed**: a backend role with no safe UI equivalent
// resolves to UNSUPPORTED_ROLE rather than being quietly widened into HOSPITAL_ADMIN, which would
// be a privilege escalation in a clinical system.

import { ROLE } from "./clinicalDemo.js";

/** Returned when the account's role has no safe UI equivalent — the UI must refuse the session. */
export const UNSUPPORTED_ROLE = "UNSUPPORTED_ROLE";

// Backend UserRole -> UI ROLE. Anything absent here is deliberately unsupported.
const ROLE_MAP = {
  ATTENDING: ROLE.ATTENDING,
  ASSOCIATE_PHYSICIAN: ROLE.ATTENDING,   // physician panel
  ONCALL_PHYSICIAN: ROLE.ATTENDING,
  UNIT_PHYSICIAN: ROLE.ATTENDING,
  CHARGE_NURSE: ROLE.CHARGE_NURSE,
  NURSE: ROLE.CHARGE_NURSE,              // nurse panel (the UI has no separate plain-nurse view)
  RAPID_RESPONSE: ROLE.RRT,
  HOSPITAL_ADMIN: ROLE.HOSPITAL_ADMIN,
  PHARMACIST: ROLE.PHARMACIST,
  BIOMEDICAL: ROLE.BIOMEDICAL,
  // AUDITOR (read-only) and PLATFORM_SUPPORT (vendor-side) have no UI counterpart: mapping them
  // onto HOSPITAL_ADMIN would grant powers they must not have.
};

// Most-privileged first — a user holding several memberships gets the highest.
//
// PHARMACIST and BIOMEDICAL sit at the bottom: neither is a clinical decision-maker, and a
// person who is both a nurse and the biomedical contact should get the nurse's ward, not the
// device page. Anyone absent from this list cannot be selected at all, which is why every
// mapped role has to appear here.
const PRECEDENCE = [
  "HOSPITAL_ADMIN", "ATTENDING", "UNIT_PHYSICIAN", "ONCALL_PHYSICIAN",
  "ASSOCIATE_PHYSICIAN", "RAPID_RESPONSE", "CHARGE_NURSE", "NURSE",
  "PHARMACIST", "BIOMEDICAL",
];

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

/**
 * The UI role for an access token.
 * Returns null when the token carries no roles, and UNSUPPORTED_ROLE when it carries only
 * roles the UI cannot safely represent.
 */
export function roleFromToken(token) {
  const payload = decodeJwtPayload(token);
  const roles = payload?.roles;
  if (!roles || typeof roles !== "object") return null;

  const held = Object.values(roles);
  if (held.length === 0) return null;

  for (const candidate of PRECEDENCE) {
    if (held.includes(candidate)) return ROLE_MAP[candidate];
  }
  return UNSUPPORTED_ROLE;   // roles exist, but none is safely representable
}
