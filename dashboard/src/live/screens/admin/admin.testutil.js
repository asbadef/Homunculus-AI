// Test-only: synthetic `/admin`, `/admin/ldap` and `/scope` payloads, in the shapes the API really
// sends (homunculus-engine `admin/schemas.py`, `scope/schemas.py`). The administration equivalent
// of `data/board.testutil.js`, and here for the same reason: three tabs built on three parallel
// branches would otherwise each write their own fixtures, and three fixtures drift — a field spelt
// `member_count` in one and `memberCount` in another makes two tabs that disagree about what the
// server sends, with both suites green.
//
// NO REAL ACCOUNTS AND NO PATIENT DATA, EVER (CLAUDE.md hard rule 6). Staff are "Ayşe Sentetik",
// "Kamran Sintetik"; the hospital is "Sentetik Hastane"; units are REA-01 / NICU-01; AD objects
// live under DC=sentetik,DC=local. Nothing here may be replaced by anything from a real directory,
// a real export or a support capture, not even to reproduce a bug.
//
// Shapes are the API's, snake_case: these go through `rules.userFromApi` / `groupFromApi` /
// `scopeFromApi` exactly as an answer does. A builder that took the ADAPTED shape would let a tab
// pass its tests against a payload the server cannot send.
import { vi } from "vitest";
import { DEFAULT_GROUPS, PERMISSION_KEYS } from "./catalogue.js";
import { groupFromApi, userFromApi } from "./rules.js";
import { READS } from "./useAdminData.js";

/** A synthetic objectGUID: the directory's own id, which `POST /admin/ldap/import` parses as a
 *  UUID (`LdapImportIn.external_ids: list[uuid.UUID]`), so a fixture may not use "e-1". */
export const guid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One group as `GroupOut` carries it. `slug` is positional — it is what a test varies, and what
 *  `groupKind` reads to call the group a role, an extra duty or the hospital's own. */
export function group(slug = "nurse", over = {}) {
  if (typeof slug !== "string") {
    throw new TypeError("group(slug, over): the slug is a string — group('nurse', {permissions: []})");
  }
  return {
    id: `g-${slug}`,
    slug,
    name: { nurse: "Hemşire", physician: "Hekim", charge_nurse: "Sorumlu hemşire", hospital_admin: "Sistem yöneticisi" }[slug] || slug,
    description: "",
    mfa_required: false,
    is_system: false,
    permissions: ["board.view", "alerts.ack"],
    member_count: 0,
    // `GroupOut.kind`, as the API now reports it: the spec's own kind for one of the eleven
    // default groups, and **null** for a group the hospital created — which is an answer, not a
    // gap. Derived here rather than defaulted, so a fixture cannot describe a group the server
    // would describe differently.
    kind: DEFAULT_GROUPS.find((g) => g.slug === slug)?.kind ?? null,
    ...over,
  };
}

/** The system group, whose permissions the API reports as the WHOLE catalogue (`_group_out`). */
export const SYSTEM_GROUP = group("hospital_admin", {
  name: "Sistem yöneticisi", mfa_required: true, is_system: true,
  permissions: [...PERMISSION_KEYS].sort(), member_count: 1,
});

/** One account as `UserOut` carries it. `id` is positional. `groups` entries are `UserGroupOut`:
 *  `{id, slug, name, source}` where `source` is "manual" or "ldap" — a directory-held
 *  membership is AD's and `PUT /users/{id}/groups` leaves it alone. */
export function user(id = "u-1", over = {}) {
  if (typeof id !== "string") {
    throw new TypeError("user(id, over): the id is a string — user('u-1', {groups: [member(group())]})");
  }
  return {
    id,
    username: "hs.aygun",
    email: "hs.aygun@sentetik.local",
    full_name: "Ayşe Sentetik",
    auth_source: "local",
    is_active: true,
    totp_enabled: false,
    last_login_at: "2026-10-10T07:12:00Z",
    must_change_password: false,
    groups: [],
    ...over,
  };
}

/** A membership link, from a group fixture. */
export const member = (g, source = "manual") => ({ id: g.id, slug: g.slug, name: g.name, source });

/** The permission catalogue as `/admin/permissions` serves it — the server's OWN descriptions,
 *  word for word (`auth/permissions.PERMISSIONS`). They are English developer prose, not the
 *  hospital's words, which is why the roles tab translates them by key (`strings/perms.js`) and
 *  shows these only as the `lang="en"` fallback for a key it does not know. The fixture carries
 *  them unchanged because a fixture that carried anything else would describe a payload the
 *  server cannot send; `admin.testutil.test.js` reads the backend and fails when they drift. */
export const PERMISSION_TEXTS = Object.freeze({
  "board.view": "See the live board, patient detail and the event stream — including, while Aşama A is on, the monitor strip labelled unvalidated, which feeds no rule, score, alert, notification or sound",
  "alerts.ack": "Acknowledge or snooze an alert",
  "alerts.escalate": "Create an alert manually; escalate one",
  "admissions.view": "Read admissions and patient records",
  "admissions.admit": "Create an admission",
  "admissions.sign_off": "Physician sign-off of an admission",
  "admissions.move.initiate": "Initiate a transfer or discharge",
  "admissions.transfer.confirm": "Confirm a transfer arrival",
  "admissions.discharge.confirm": "Confirm a discharge; release the bed",
  "care_team.claim": "Claim a care-team role on a patient",
  "care_team.assign": "Assign others to a patient's care team",
  "handover.sign": "Sign or countersign a handover",
  "shifts.manage": "Create shift schedules",
  "break_glass.use": "Open, extend or close a break-glass session",
  "audit.view": "Read the audit trail",
  "users.manage": "Users: create, edit, activate, reset password or MFA, unlock an AD sign-in, set groups; read a user's unit and bed scope, count the users with none, and assign one (assigning also needs a caller whose own scope is unrestricted by role); search and import AD accounts, read the AD group mapping (changing the mapping needs every permission)",
  "groups.manage": "Groups and their permission sets",
  "structure.manage": "Tenant, site, unit, room and bed configuration",
  "devices.manage": "Devices: the device screen and the research window — live per-device values decoded from bedside-monitor traffic, UNVALIDATED. Aşama A shows them to clinicians as a strip labelled unvalidated; they are never an observation and no rule, score, alert, notification or audit row is made from them. Shows no patient. Held by default by biomedical and by platform_support, the vendor's support group",
  "clinical.chart": "Chart clinician-observed inputs (infection suspicion, pressor, fluids, GCS…) and the patient's own baseline",
  "scores.sign": "Sign a severity-score form (SOFA) with corrections",

  // G2-B1a
  "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",
});
export const CATALOGUE = PERMISSION_KEYS.map((key) => ({ key, description: PERMISSION_TEXTS[key] }));

/** One user's scope as `ScopeView` carries it (`GET /scope/{id}`).
 *
 *  `unit_ids` / `bed_ids` are the RESOLVED, normalised sets — `build_scope` casefolds them — while
 *  `grants` carries the keys as they were stored. The editor shows the grants, not the resolved
 *  sets, which is why a fixture must be able to differ between the two.
 *
 *  `role` is the scope CLASS `scope/service.read_role` answers — "HOSPITAL_ADMIN",
 *  "PLATFORM_SUPPORT", "MEMBER" or null — never a clinical role (a "NURSE" here described a payload
 *  the server cannot send). `own_patients` is a COUNT, the care-team and break-glass patients the
 *  scope reaches by name (`ScopeView.own_patients`). */
export function scopeView(over = {}) {
  const grants = over.grants ?? [];
  return {
    user_id: "u-1",
    role: "MEMBER",
    unrestricted: false,
    reason: "assigned",
    unit_ids: grants.filter((g) => g.unit_id).map((g) => String(g.unit_id).toLowerCase()).sort(),
    bed_ids: grants.filter((g) => g.bed_id).map((g) => String(g.bed_id).toLowerCase()).sort(),
    own_patients: 0,
    ...over,
    grants: grants.map((g, i) => ({
      id: `sg-${i}`, unit_id: "", bed_id: "", is_active: true, granted_by_id: "u-admin",
      created_at: "2026-10-01T09:00:00Z", revoked_at: null, ...g,
    })),
  };
}

/** The scope of a desk that MAY assign one (`reason: "role"`), and of one that may not. */
export const SCOPE_ADMIN = scopeView({ user_id: "u-admin", role: "HOSPITAL_ADMIN", unrestricted: true, reason: "role" });
export const SCOPE_UNASSIGNED = scopeView({ unrestricted: true, reason: "unassigned" });

// ---------------------------------------------------------------- the directory

export const ldapStatus = (over = {}) => ({
  // `url_host` is the HOST ONLY (`auth/ldap.py`: `parts.hostname`) — no port, no scheme, no DN.
  configured: true, url_host: "dc01.sentetik.local",
  last_test_at: "2026-10-11T06:00:00Z", last_test_ok: true, ...over,
});

/** One AD account as the search reports it (`LdapUserOut`). */
export function ldapUser(n = 1, over = {}) {
  return {
    external_id: guid(n), username: `hs.sintetik${n}`, upn: `hs.sintetik${n}@sentetik.local`,
    email: `hs.sintetik${n}@sentetik.local`, display_name: `Kamran Sintetik ${n}`,
    dn: `CN=Kamran Sintetik ${n},OU=Personel,DC=sentetik,DC=local`,
    disabled: false, already_imported: false, ...over,
  };
}

export const ldapGroup = (over = {}) => ({
  dn: "CN=YB-Hemsire,OU=Gruplar,DC=sentetik,DC=local", name: "YB-Hemsire", ...over,
});

/** One row of the AD group → our group table (`LdapMappingOut`). */
export const mapping = (over = {}) => ({
  id: "m-1", ad_group_dn: "CN=YB-Hemsire,OU=Gruplar,DC=sentetik,DC=local",
  group_id: "g-nurse", group_slug: "nurse", group_name: "Hemşire",
  created_at: "2026-10-02T10:00:00Z", ...over,
});

// ---------------------------------------------------------------- a whole desk

export const NURSE_GROUP = group("nurse", { member_count: 4 });
export const WARD_GROUP = group("gece_ekibi", { name: "Gece ekibi", permissions: ["board.view"], member_count: 2 });

/** The accounts a tab's test lists by default: a local nurse who must still change her password, a
 *  directory account, and one whose group this answer does not describe — the row whose rights are
 *  UNKNOWN, which must read as "not decided" and never as "nothing". */
export const USERS = [
  user("u-nurse", { groups: [member(NURSE_GROUP)], must_change_password: true }),
  user("u-ad", {
    username: "dr.kamran", full_name: "Kamran Sintetik", email: null, auth_source: "ldap",
    totp_enabled: true, last_login_at: null, groups: [member(NURSE_GROUP, "ldap")],
  }),
  user("u-stranger", {
    username: "hs.gece", full_name: "Gecə Sintetik", groups: [{ id: "g-?", slug: "?", name: "?", source: "manual" }],
  }),
];
export const GROUPS = [SYSTEM_GROUP, NURSE_GROUP, WARD_GROUP];

/** What each read state carries: "known" and "stale" an answer, the other three none. */
const CARRIES_AN_ANSWER = { known: true, stale: true, unasked: false, loading: false, failed: false };

/**
 * The `admin` prop the frame hands a tab (`AdminScreen` → `useAdminData`), for a test that mounts
 * one tab on its own. ONE builder for the three arms, for the reason the payload builders are one:
 * three hand-built copies of this object drift, and a tab passes against a shape the loader cannot
 * produce.
 *
 *   adminProp()                                      every read known, the desk above
 *   adminProp({ users: [user("u-1")] })              API-shaped, adapted as an answer is
 *   adminProp({ unassigned: null })                  a read with no answer: null and "failed"
 *   adminProp({ catalogue: null, reads: { catalogue: "unasked" } })   one the session may not make
 *   adminProp({ reads: { users: "stale" } })         the last answer, kept through a failed re-read
 *
 * `users` / `groups` / `catalogue` are the API's own shapes and go through `userFromApi` /
 * `groupFromApi` exactly as an answer does. A state the loader cannot produce — "known" with no
 * answer, "failed" with one, a state that does not exist — THROWS, so no tab is tested against it.
 * `reload` is a spy that resolves; pass your own to hold it.
 */
export function adminProp(over = {}) {
  const pick = (name, fallback) => (name in over ? over[name] : fallback);
  const users = pick("users", USERS);
  const groups = pick("groups", GROUPS);
  const catalogue = pick("catalogue", CATALOGUE);
  const data = {
    users: users === null ? null : users.map(userFromApi),
    groups: groups === null ? null : groups.map(groupFromApi),
    catalogue: catalogue === null ? null : [...catalogue],
    unassigned: pick("unassigned", 2),
  };
  const reads = {};
  for (const read of READS) {
    const state = over.reads?.[read] ?? (data[read] === null ? "failed" : "known");
    if (!(state in CARRIES_AN_ANSWER) || CARRIES_AN_ANSWER[state] !== (data[read] !== null)) {
      throw new TypeError(
        `adminProp: ${read} is "${state}" with ${data[read] === null ? "no answer" : "an answer"} — a state the loader cannot produce`,
      );
    }
    reads[read] = state;
  }
  return {
    data,
    reads,
    failures: over.failures ?? [],
    loading: over.loading ?? false,
    reload: over.reload ?? vi.fn(async () => {}),
  };
}

/** Every call the three tabs make that CHANGES something (or, for the directory test, acts), by
 *  its `backendApi` name. */
export const ADMIN_WRITES = Object.freeze([
  "adminCreateUser", "adminUpdateUser", "adminSetUserGroups", "adminResetPassword", "adminResetMfa",
  "adminUnlockSignIn", "setScope",
  "adminCreateGroup", "adminUpdateGroup", "adminDeleteGroup",
  "ldapTest", "ldapImport", "ldapCreateMapping", "ldapDeleteMapping",
]);

/**
 * Stub every READ the three tabs make, with the fixtures above. `over` replaces any of them:
 *
 *   ADMIN_READS(api, { ldapStatus: { configured: false } })
 *
 * Writes are not ANSWERED: a test that expects a write states what the server answers, because
 * what a write answers is the thing it is testing. But a write the test did not state REJECTS —
 * an unstubbed `vi.fn()` resolves `undefined`, which a tab reads as "the server took it", so a
 * test that forgot to say would pass on a success nobody chose. The rejection names the call.
 */
export function ADMIN_READS(api, over = {}) {
  for (const write of ADMIN_WRITES) {
    api[write].mockRejectedValue(
      new Error(`ADMIN_READS: ${write} was not stubbed — a test that writes states what the server answers`),
    );
  }
  const value = (name, fallback) => (name in over ? over[name] : fallback);
  api.adminUsers.mockResolvedValue(value("adminUsers", USERS));
  api.adminGroups.mockResolvedValue(value("adminGroups", GROUPS));
  api.adminPermissions.mockResolvedValue(value("adminPermissions", CATALOGUE));
  api.unassignedScopes.mockResolvedValue(value("unassignedScopes", { tenant: "sentetik", unassigned_users: 2 }));
  api.myScope.mockResolvedValue(value("myScope", SCOPE_ADMIN));
  api.userScope.mockResolvedValue(value("userScope", scopeView({ grants: [{ unit_id: "REA-01" }] })));
  api.ldapStatus.mockResolvedValue(value("ldapStatus", ldapStatus()));
  api.ldapMappings.mockResolvedValue(value("ldapMappings", [mapping()]));
  api.ldapSearch.mockResolvedValue(value("ldapSearch", [ldapUser(1), ldapUser(2, { disabled: true })]));
  api.ldapGroups.mockResolvedValue(value("ldapGroups", [ldapGroup()]));
  return api;
}
