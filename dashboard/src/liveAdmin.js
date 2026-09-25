// src/liveAdmin.js — adapters from the /admin payloads onto the shapes the admin panels render,
// and the rules those panels follow (homunculus-engine admin/service.py).
//
// Adapters. Fail closed: a missing flag reads as the safer value (inactive is NOT assumed — an
// account the API says nothing about is shown as it is, active, so nobody is quietly hidden).
//
// Rules. HINTS ONLY: they decide what a panel offers or greys out, never what is allowed — the
// server re-checks every write under the tenant lock, with the caller's rights read from the
// database, and its 403/409 is what the panel then shows. "No grant beyond your own rights":
//   - a group can be given only if its rights are within the session's (`canGrant`);
//   - a user can be acted on only if their rights are within the session's, and never reset or
//     deactivated by themselves (`canManageUser`).
// Where a rule cannot be decided (a group the list does not hold, no session id) it refuses.

import { PERMISSION_KEYS, hasPerm } from "./permissions.js";

export function userFromApi(u) {
  const row = u && typeof u === "object" ? u : {};
  const groups = Array.isArray(row.groups) ? row.groups : [];
  const mapped = groups.map((g) => ({ id: g.id, slug: g.slug, name: g.name, source: g.source || "manual" }));
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    full_name: row.full_name,
    authSource: row.auth_source || "local",
    active: row.is_active !== false,
    mfa: row.totp_enabled === true,
    lastLoginAt: row.last_login_at ?? null,
    groups: mapped,
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
    permissions: Array.isArray(row.permissions) ? [...row.permissions] : [],
    memberCount: Number(row.member_count) || 0,
  };
}

// ---------------------------------------------------------------- rules (hints)

/** Keys from a list of keys or of catalogue entries ({key, description}). */
const keysOf = (list) => (Array.isArray(list)
  ? list.map((p) => (typeof p === "string" ? p : p?.key)).filter((k) => typeof k === "string")
  : []);

const sortedSet = (keys) => [...new Set(keys)].sort();

/** A group's rights, as a token minted from it would carry them (service.py `group_rights`):
 *  the whole catalogue for the system group, otherwise its keys within the catalogue. `catalogue`
 *  is `state.adminPermissions` (or plain keys).
 *    - The system group: a users.manage desk cannot read the catalogue, so it is widened with the
 *      UI's mirrored PERMISSION_KEYS and the keys the API reported for the group (GroupOut already
 *      reports the whole catalogue for it). It never reads as holding less than everything.
 *    - An ordinary group: a key the catalogue no longer holds is retired, and the server ignores
 *      it, so it is dropped here too. Without a catalogue its keys are taken as they are; a retired
 *      key then only makes the group look harder to grant.
 *  Every rule below judges groups through this, so the panels need no filter of their own. Sorted. */
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
 *  (service.py `user_rights`). `groups` is `state.adminGroups`. null when one of the user's groups
 *  is not in `groups`: unknown rights are never taken to be small. Sorted. */
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

/** The rights the session does not hold, sorted — what the server's 403 would list after
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
 *    within      — users.manage, and the user's rights are within the session's;
 *    beyond      — the user's rights the session lacks (null: unknown);
 *    edit        — name, e-mail, reactivation (PATCH);
 *    setGroups   — manual memberships (PUT groups; each group offered still needs canGrant);
 *    resetPassword, resetMfa, deactivate — never on yourself (`selfId`: `state.user.id`), and a
 *                  password reset only for a local account.
 *  What the UI cannot see is left to the server's 409: an account shared with another tenant or a
 *  platform operator's (credentials, flags, e-mail, name) and the last administrator. */
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
  };
}
