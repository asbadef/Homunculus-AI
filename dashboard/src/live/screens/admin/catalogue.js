// src/live/screens/admin/catalogue.js — the permission keys and the default groups, mirrored from
// the backend (homunculus-engine/src/homunculus/auth/permissions.py). `catalogue.test.js` reads
// that file and fails when the two drift: change both sides together.
//
// Why a mirror at all, when `/admin/permissions` serves the catalogue with its descriptions? Two
// reasons, both about rights the screen must judge without being able to ask:
//   * `/admin/permissions` needs `groups.manage`. A user desk that holds `users.manage` alone can
//     list the groups it may give but cannot read the catalogue — and it still has to know what
//     the SYSTEM group holds, which is "everything", in order to grey out giving it away
//     (`groupRights` in rules.js). Without the mirror that desk would read the system group as
//     holding only the rows the API happened to report.
//   * A key the catalogue no longer holds is retired and the server ignores it; the mirror is how
//     the screen knows which of a custom group's keys those are.
//
// The LIVE session's own rights are never taken from here: they come from the token
// (`useSession().user.perms`), which is what the server checks this hour. This list is the
// vocabulary, not the grant.
//
// It was a copy rather than an import of `src/permissions.js`: roadmap D1 kept `src/live/` off the
// old workspace, which G1-16 deleted, that file with it. The old file carried the simulation's
// role tables too, which have no meaning here.
const freeze = (a) => Object.freeze([...a]);

export const PERMISSION_KEYS = freeze([
  "board.view", "alerts.ack", "alerts.escalate",
  "admissions.view", "admissions.admit", "admissions.sign_off",
  "admissions.move.initiate", "admissions.transfer.confirm", "admissions.discharge.confirm",
  "care_team.claim", "care_team.assign", "handover.sign", "shifts.manage",
  "break_glass.use", "audit.view",
  "users.manage", "groups.manage", "structure.manage", "devices.manage",
  "clinical.chart", "scores.sign",

  // G2-B1a — a cleaned bed marked free by the ward's nurses (spec D8)
  "beds.release",
]);

/** The backend's DEFAULT_GROUPS, in its order and with its slugs. The screen needs the ORDER (the
 *  roles table reads top to bottom as the hospital's own hierarchy) and `kind`: the user form
 *  offers one ROLE and any number of EXTRA DUTIES (roadmap D3). The API reports `kind` itself now
 *  (`GroupSpec.kind` / `GroupOut.kind`, Task 14c) and the screens read that first; this copy is
 *  the FALLBACK for a group described without one, and `catalogue.test.js` holds it to the
 *  backend's. A group the hospital created itself is neither and appears under "other groups". */
export const DEFAULT_GROUPS = Object.freeze([
  { slug: "hospital_admin", kind: "role", mfaRequired: true, isSystem: true },
  { slug: "attending", kind: "role", mfaRequired: true, isSystem: false },
  { slug: "unit_physician", kind: "role", mfaRequired: true, isSystem: false },
  { slug: "physician", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "charge_nurse", kind: "extra", mfaRequired: false, isSystem: false },
  { slug: "nurse", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "rapid_response", kind: "extra", mfaRequired: false, isSystem: false },
  { slug: "auditor", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "platform_support", kind: "role", mfaRequired: true, isSystem: false },
  { slug: "pharmacist", kind: "role", mfaRequired: false, isSystem: false },
  { slug: "biomedical", kind: "role", mfaRequired: false, isSystem: false },
].map((g) => Object.freeze(g)));

/** The two groups the user form offers as an EXTRA DUTY rather than as a role (roadmap D3:
 *  "Rol + Ek görev + Birimler"; the prototype's `H.EXTRA`). A duty adds rights to the person's
 *  role — a charge nurse is a nurse with more, and a rapid-response duty ends with the shift. The
 *  membership list is flat; the distinction is the backend's `GroupSpec.kind`, mirrored here. */
export const EXTRA_DUTY_SLUGS = freeze(DEFAULT_GROUPS.filter((g) => g.kind === "extra").map((g) => g.slug));
export const ROLE_SLUGS = freeze(DEFAULT_GROUPS.filter((g) => g.kind === "role").map((g) => g.slug));

/** What a group is to the user form: "role", "extra" or "other" (one the hospital created). */
export function groupKind(slug) {
  const known = DEFAULT_GROUPS.find((g) => g.slug === slug);
  return known ? known.kind : "other";
}

/** Does this session hold the right? `perms` is `useSession().user.perms` — the token's own list. */
export function hasPerm(perms, key) {
  return Array.isArray(perms) && perms.includes(key);
}
