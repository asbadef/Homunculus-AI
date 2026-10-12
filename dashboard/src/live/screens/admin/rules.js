// src/live/screens/admin/rules.js — the /admin payloads as the screens render them, and the rules
// those screens follow (homunculus-engine admin/service.py).
//
// Taken over from the old workspace's `src/liveAdmin.js`, which was written and tested against
// exactly this API; roadmap D1 keeps `src/live/` off that workspace, so it is copied rather than
// imported, with its reasoning, and the `kind` of a group added (catalogue.js: a role, an extra
// duty, or one the hospital made itself — the distinction the user form needs and the API does
// not send).
//
// ADAPTERS fail closed, with one deliberate exception: a flag the API said nothing about reads as
// the SAFER value, except `is_active` — an account the API does not describe is shown as it is,
// active, so nobody is quietly hidden from the administrator who has to manage them.
//
// RULES ARE HINTS. They decide what a panel offers or greys out, never what is allowed: the server
// re-checks every write under the tenant's lock, with the caller's rights read from the database,
// and its 403/409 is what the panel then shows. The hint exists so an administrator is not invited
// to press a button that cannot work. Two rules carry the weight:
//   * no grant beyond your own rights — a group may be given only if its rights are within the
//     session's (`canGrant`), and a user may be acted on only if theirs are (`canManageUser`);
//   * nobody resets or deactivates themselves.
// Where a rule cannot be DECIDED — a group the list does not hold, no session id — it refuses.
// Unknown rights are never taken to be small.
import { PERMISSION_KEYS, groupKind, hasPerm } from "./catalogue.js";

export function userFromApi(u) {
  const row = u && typeof u === "object" ? u : {};
  const groups = Array.isArray(row.groups) ? row.groups : [];
  const mapped = groups.map((g) => ({
    id: g.id, slug: g.slug, name: g.name, source: g.source || "manual", kind: groupKind(g.slug),
  }));
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    fullName: row.full_name,
    authSource: row.auth_source || "local",
    active: row.is_active !== false,
    mfa: row.totp_enabled === true,
    mustChangePassword: row.must_change_password === true,
    lastLoginAt: row.last_login_at ?? null,
    groups: mapped,
    /** The memberships an administrator may replace. A membership the DIRECTORY holds is AD's to
     *  decide (the group mapping), and `PUT /users/{id}/groups` leaves it alone. */
    manualGroupIds: mapped.filter((g) => g.source === "manual").map((g) => g.id),
  };
}

export function groupFromApi(g) {
  const row = g && typeof g === "object" ? g : {};
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    mfaRequired: row.mfa_required === true,
    isSystem: row.is_system === true,
    kind: groupKind(row.slug),
    permissions: Array.isArray(row.permissions) ? [...row.permissions] : [],
    // A count the API did not send is NOT ZERO. `Number(x) || 0` turned null, undefined and a
    // string alike into 0 — which a screen then printed as "0 people", a statement about the
    // group's membership that nobody had made — and the roles table's "member count unknown"
    // sentence, guarded on `Number.isFinite`, could never be reached. Measured on the finished
    // tree, where that four-language string was dead and no test could tell. The one safety rule
    // these screens share: no count unless the read that produced it answered.
    memberCount: typeof row.member_count === "number" && Number.isFinite(row.member_count)
      ? row.member_count
      : null,
  };
}

/** One user's scope as `/scope/{id}` describes it (scope/schemas.py ScopeView). */
export function scopeFromApi(s) {
  const row = s && typeof s === "object" ? s : {};
  return {
    userId: row.user_id ?? null,
    unrestricted: row.unrestricted === true,
    reason: row.reason || "unknown",
    unitIds: Array.isArray(row.unit_ids) ? [...row.unit_ids] : [],
    bedIds: Array.isArray(row.bed_ids) ? [...row.bed_ids] : [],
    /** The ACTIVE grants, which is what `PUT /scope/{id}` replaces. A revoked row stays in the
     *  answer with `revoked_at` set; sending it back would grant it again. */
    grants: (Array.isArray(row.grants) ? row.grants : [])
      .filter((g) => g && g.is_active !== false)
      .map((g) => ({ unitId: g.unit_id || "", bedId: g.bed_id || "" })),
  };
}

// ---------------------------------------------------------------- rules (hints)

/** Keys from a list of keys or of catalogue entries ({key, description}). */
const keysOf = (list) => (Array.isArray(list)
  ? list.map((p) => (typeof p === "string" ? p : p?.key)).filter((k) => typeof k === "string")
  : []);

const sortedSet = (keys) => [...new Set(keys)].sort();

/** A group's rights, as a token minted from it would carry them (service.py `group_rights`): the
 *  whole catalogue for the system group, otherwise its keys within the catalogue.
 *    - The SYSTEM group: a `users.manage` desk cannot read `/admin/permissions`, so its rights are
 *      widened with the mirrored PERMISSION_KEYS and whatever the API reported for it. It never
 *      reads as holding less than everything — which is what makes "you may not give this group
 *      away" come out right for a desk that cannot see the catalogue.
 *    - An ordinary group: a key the catalogue no longer holds is retired, and the server ignores
 *      it, so it is dropped here too. Without a catalogue its keys are taken as they are; a
 *      retired key then only makes the group look harder to grant, never easier. */
export function groupRights(group, catalogue = []) {
  if (!group || typeof group !== "object") return [];
  const own = keysOf(group.permissions);
  const known = keysOf(catalogue);
  if (group.isSystem === true || group.is_system === true) {
    return sortedSet([...known, ...PERMISSION_KEYS, ...own]);
  }
  if (known.length === 0) return sortedSet(own);
  const inCatalogue = new Set(known);
  return sortedSet(own.filter((k) => inCatalogue.has(k)));
}

/** A user's rights: the union of their groups' rights, manual and directory-held alike
 *  (service.py `user_rights`). `null` when one of the user's groups is not in `groups` — unknown
 *  rights are never taken to be small. */
export function userRights(user, groups, catalogue = []) {
  const byId = new Map((Array.isArray(groups) ? groups : []).map((g) => [g?.id, g]));
  const rights = [];
  for (const link of Array.isArray(user?.groups) ? user.groups : []) {
    const group = byId.get(link?.id);
    if (!group) return null;
    rights.push(...groupRights(group, catalogue));
  }
  return sortedSet(rights);
}

/** The rights the session does not hold, sorted — what the server's 403 lists after
 *  "Kendi yetkilerinizi aşan bir işlem yapılamaz: ". */
export function rightsBeyond(sessionPerms, rights) {
  const held = new Set(keysOf(sessionPerms));
  return sortedSet(keysOf(rights)).filter((k) => !held.has(k));
}

/** May the session give this group to someone? Its rights must be within the session's. */
export function canGrant(sessionPerms, group, catalogue = []) {
  if (!group || !Array.isArray(sessionPerms)) return false;
  return rightsBeyond(sessionPerms, groupRights(group, catalogue)).length === 0;
}

/** What the session may do to `user`, action by action:
 *    within         — `users.manage`, and the user's rights are within the session's;
 *    beyond         — the user's rights the session lacks (`null`: unknown);
 *    edit           — name, e-mail, reactivation (PATCH);
 *    setGroups      — manual memberships (PUT groups; each group offered still needs `canGrant`);
 *    resetPassword  — never on yourself, and only for a LOCAL account (an AD password is AD's);
 *    resetMfa       — never on yourself;
 *    deactivate     — never on yourself;
 *    unlockSignIn   — only for a DIRECTORY account: the throttle it lifts is the AD bind chain
 *                     (`directory_binds`), which a local account has none of. ON YOURSELF TOO,
 *                     unlike the three above, because the server allows it and says why
 *                     (`admin/service.unlock_sign_in`: "Oneself is allowed — an unlock hands
 *                     nothing over, the next sign-in still needs the password"). An AD
 *                     administrator whose own bind chain is throttled is signed in already and is
 *                     exactly the person who needs it; refusing her here hid a working action,
 *                     and `admin.selfNote` does not claim otherwise — it names the password, the
 *                     authenticator and the account's active state, which ARE refused.
 *  What the UI cannot see is left to the server's 409: an account shared with another tenant or a
 *  platform operator's, and the last administrator. */
export function canManageUser(sessionPerms, user, groups, selfId, catalogue = []) {
  const rights = user && typeof user === "object" ? userRights(user, groups, catalogue) : null;
  const beyond = rights === null ? null : rightsBeyond(sessionPerms, rights);
  const within = hasPerm(sessionPerms, "users.manage") && beyond !== null && beyond.length === 0;
  // Without an id for the session the user might be yourself: refuse.
  const notSelf = within && selfId != null && selfId !== "" && user.id !== selfId;
  return {
    within,
    beyond,
    edit: within,
    setGroups: within,
    resetPassword: notSelf && user.authSource === "local",
    resetMfa: notSelf,
    deactivate: notSelf,
    unlockSignIn: within && user.authSource === "ldap",
  };
}

/** May the session ASSIGN a scope at all? `PUT /scope/{user_id}` is refused with 403
 *  `kapsam atamak için kapsamı sınırsız bir yönetici olmalısınız` unless the CALLER's own scope is
 *  unrestricted BY ROLE (`scope/router.py put_scope`, `SCOPE_UNRESTRICTED_ROLES` =
 *  hospital_admin / platform_support). No permission key reports that — `users.manage` alone is
 *  not enough — so the only honest source is the caller's own `/scope/me`, whose `reason` says
 *  WHY it is unrestricted.
 *
 *  `reason === "role"` and nothing else: a desk that is unrestricted only because nobody has been
 *  assigned anything yet (`reason: "unassigned"`, which is `unrestricted: true` until the
 *  deployment flips `enforce_unassigned`) would be refused by the server, and that is the common
 *  case at a pilot. `null` means the answer has not arrived — the screen then says so rather than
 *  offering a Save that may not work, because unknown rights are never taken to be large either. */
export function canAssignScope(myScope) {
  if (!myScope || typeof myScope !== "object") return null;
  return myScope.unrestricted === true && myScope.reason === "role";
}

/** May the session change the AD group mapping? The server allows it only to an administrator who
 *  holds EVERY key (admin/ldap_service.py MAPPING_ADMIN_ONLY, 403): a user desk that may not
 *  regroup one nurse directly must not be able to regroup every nurse at once. Reading the mapping
 *  needs `users.manage` only. */
export function canMapGroups(sessionPerms, catalogue = []) {
  const known = keysOf(catalogue);
  const whole = known.length > 0 ? known : PERMISSION_KEYS;
  return rightsBeyond(sessionPerms, whole).length === 0;
}
