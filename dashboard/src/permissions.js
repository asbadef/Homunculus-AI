// src/permissions.js — the permission keys the UI gates on, mirrored from the backend catalogue
// (homunculus-engine/src/homunculus/auth/permissions.py). The backend is the source of truth:
// the live session's `perms` come from the token; these tables only give the SIMULATION the same
// vocabulary so both modes share one gate. permissions.test.js reads permissions.py and fails when
// PERMISSION_KEYS or DEFAULT_GROUPS no longer match it — change both sides together.

const freeze = (a) => Object.freeze([...a]);

export const PERMISSION_KEYS = freeze([
  "board.view", "alerts.ack", "alerts.escalate",
  "admissions.view", "admissions.admit", "admissions.sign_off",
  "admissions.move.initiate", "admissions.transfer.confirm", "admissions.discharge.confirm",
  "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
  "break_glass.use", "audit.view",
  "users.manage", "groups.manage", "structure.manage", "devices.manage",
]);

// The backend's DEFAULT_GROUPS (spec §3), in its order. The system group (`isSystem`) holds the
// whole catalogue by rule and its rights cannot be edited; `mfaRequired` groups must pass TOTP.
export const DEFAULT_GROUPS = Object.freeze([
  { slug: "hospital_admin", mfaRequired: true, isSystem: true, permissions: PERMISSION_KEYS },
  { slug: "attending", mfaRequired: true, isSystem: false, permissions: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.sign_off",
    "admissions.move.initiate", "care_team.claim", "care_team.assign", "handover.sign",
    "break_glass.use"] },
  { slug: "unit_physician", mfaRequired: true, isSystem: false, permissions: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.sign_off",
    "admissions.move.initiate", "handover.sign", "break_glass.use"] },
  { slug: "physician", mfaRequired: false, isSystem: false, permissions: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "handover.sign",
    "break_glass.use"] },
  { slug: "charge_nurse", mfaRequired: false, isSystem: false, permissions: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "admissions.admit",
    "admissions.transfer.confirm", "admissions.discharge.confirm", "care_team.claim",
    "handover.sign", "shifts.manage", "break_glass.use"] },
  { slug: "nurse", mfaRequired: false, isSystem: false, permissions: [
    "board.view", "alerts.ack", "admissions.view", "admissions.admit",
    "admissions.transfer.confirm", "handover.sign"] },
  { slug: "rapid_response", mfaRequired: false, isSystem: false, permissions: [
    "board.view", "alerts.ack", "alerts.escalate", "admissions.view", "break_glass.use"] },
  { slug: "auditor", mfaRequired: false, isSystem: false, permissions: ["board.view", "audit.view"] },
  { slug: "platform_support", mfaRequired: true, isSystem: false, permissions: ["audit.view", "devices.manage"] },
  { slug: "pharmacist", mfaRequired: false, isSystem: false, permissions: ["board.view", "admissions.view"] },
  { slug: "biomedical", mfaRequired: false, isSystem: false, permissions: ["devices.manage"] },
].map((g) => Object.freeze({ ...g, permissions: freeze(g.permissions) })));

// Demo ROLE (clinicalDemo.js) -> the default group it stands for. Not used in live mode.
export const DEMO_ROLE_TO_GROUP = Object.freeze({
  HOSPITAL_ADMIN: "hospital_admin",
  ATTENDING: "attending",
  CHARGE_NURSE: "charge_nurse",
  RRT: "rapid_response",
  PHARMACIST: "pharmacist",
  BIOMEDICAL: "biomedical",
});

// Demo ROLE -> that group's permissions. Not used in live mode.
export const ROLE_PERMS = Object.freeze(Object.fromEntries(
  Object.entries(DEMO_ROLE_TO_GROUP).map(([role, slug]) =>
    [role, DEFAULT_GROUPS.find((g) => g.slug === slug).permissions]),
));

export function permsForRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMS, role) ? [...ROLE_PERMS[role]] : [];
}

export function hasPerm(perms, key) {
  return Array.isArray(perms) && perms.includes(key);
}

/** True when `keys` is empty/absent (nothing required) or the session holds any of them. */
export function hasAny(perms, keys) {
  if (!keys || keys.length === 0) return true;
  return Array.isArray(perms) && keys.some((k) => perms.includes(k));
}

/** A DISPLAY role for icons and labels only — never used to gate anything. The administrator is
 *  shown only for the whole catalogue (the system group's rule): a user manager holding
 *  users.manage is not displayed as an administrator. */
export function uiRoleFromPerms(perms) {
  const p = Array.isArray(perms) ? perms : [];
  if (PERMISSION_KEYS.every((k) => p.includes(k))) return "HOSPITAL_ADMIN";
  if (p.includes("admissions.sign_off")) return "ATTENDING";
  if (p.includes("admissions.admit")) return "CHARGE_NURSE";
  if (p.includes("alerts.escalate")) return "RRT";
  if (p.includes("devices.manage")) return "BIOMEDICAL";
  if (p.includes("admissions.view")) return "PHARMACIST";
  return null;
}
