// src/live/screens/admin/limits.js — the server's own length limits for every field the
// administration forms draw, mirrored from homunculus-engine (`admin/schemas.py`, and
// `scope/models.py` for a scope key). `limits.test.js` reads those files and fails when the two
// drift: change both sides together.
//
// WHY A MIRROR. A control whose `maxLength` is the server's own never invites a refusal it could
// have prevented, and a refusal it could not prevent (a username already taken) is the server's to
// give. Three arms writing their own numbers is three copies of a safety mapping, which drift — the
// rule `pillRisk` was extracted for. These are HINTS like everything else on this surface: the
// server re-checks every field, and its 422 lands under the control it is about (`fieldRefusals`).
//
// THE SERVER COUNTS CODE POINTS. Python's `len` counts code points; JavaScript's `.length` counts
// UTF-16 units, so an emoji is one character to the server and two here. A form that checks a
// MINIMUM before sending counts with `lengthOf`, or it passes four emoji as an eight-character
// password that the server then refuses. (`maxLength` counts UTF-16 units too, which only ever
// makes the browser stricter than the server, never looser.)

/** The most characters each field takes. */
export const FIELD_MAX = Object.freeze({
  username: 128, //      UserCreate.username
  email: 254, //         _EMAIL_MAX (UserCreate, UserPatch)
  full_name: 200, //     UserCreate.full_name, UserPatch.full_name
  password: 1024, //     _PASSWORD_MAX (UserCreate, PasswordResetIn)
  reason: 200, //        _REASON_MAX (SignInUnlockIn)
  group_name: 120, //    GroupCreate.name, GroupPatch.name
  description: 500, //   _DESCRIPTION_MAX (GroupCreate, GroupPatch)
  slug: 64, //           _SLUG [a-z0-9_]{2,64}
  ad_group_dn: 2048, //  LdapMappingIn.ad_group_dn
  // ScopeGrantIn states no length at all: the only limit is the column, String(100), past which a
  // key is a database error rather than a 422. The field holds to the column.
  scope_key: 100,
});

/** The fewest characters a field takes, where the server states more than "not empty". */
export const FIELD_MIN = Object.freeze({
  username: 2, //        UserCreate.username
  password: 8, //        PASSWORD_MIN_LENGTH (auth/service.py; auth/passwordRules.js PASSWORD_MIN)
  slug: 2, //            _SLUG
  ad_group_dn: 3, //     LdapMappingIn.ad_group_dn
});

/** A length as the server counts it: code points, not UTF-16 units. */
export function lengthOf(text) {
  return [...String(text ?? "")].length;
}
