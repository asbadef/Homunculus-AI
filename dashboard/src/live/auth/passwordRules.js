// src/live/auth/passwordRules.js — what a new password must be, checked before it is sent.
//
// The server's rules, and only those (auth/service.py change_password: at least
// PASSWORD_MIN_LENGTH characters, different from the current one); passwordRules.test.js reads
// the number from there. A stricter rule enforced only here would be a rule the administrator's
// own tools do not know: the policy is the server's to tighten, and this file follows it.
export const PASSWORD_MIN = 8;

/** The first problem with the form, as {field, key} (an i18n key), or null. Fields: current,
 *  next, repeat. In the order a person fills them in. */
export function passwordProblem({ current, next, repeat }) {
  if (!current) return { field: "current", key: "errors.passwordRequired" };
  if (!next || next.length < PASSWORD_MIN) return { field: "next", key: "errors.passwordTooShort" };
  if (next === current) return { field: "next", key: "errors.passwordUnchanged" };
  if (repeat !== next) return { field: "repeat", key: "auth.mismatch" };
  return null;
}

/** Which field a refusal from the server belongs to, by its errors.* key; null: the whole form. */
export function fieldOfRefusal(key) {
  if (key === "errors.wrongCurrentPassword") return "current";
  if (key === "errors.passwordTooShort" || key === "errors.passwordUnchanged" || key === "errors.passwordTooLong") return "next";
  return null;
}
