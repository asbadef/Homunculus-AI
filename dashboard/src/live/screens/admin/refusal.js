// src/live/screens/admin/refusal.js — a refused administration write, as the administrator reads
// it on the toast. ONE copy, shared by the three tabs, for the reason `BoardState.jsx` exists on
// the clinical side: three tabs with a copy each is how three screens come to word the same
// refusal three ways.
//
// TWO RULES, BOTH LEARNED ON THE CLINICAL SCREENS.
//
//   * A REFUSAL GOES ON THE TOAST, never in a screen's own state, and never ALSO as an inline
//     `Alert`. The toast's provider sits above the router (`LiveApp`), so the refusal outlives a
//     move to another tab or another screen — a refusal held in a tab's state died with the tab,
//     and an administrator who clicked away mid-write saw no error at all and would reasonably
//     believe the write had landed. And `Alert` tone `crit` is itself a `role="alert"`, as is the
//     toast's error region, so showing both announces one refusal twice.
//
//   * A REFUSAL NAMES ITS SUBJECT. "Bu hesap başka bir kurumda da etkin…" read on the users tab
//     after moving to the roles tab tells an administrator that SOMETHING was refused and not
//     what, so she repeats the wrong action or none. The subject goes first and the reason after
//     it: the account, the group, the mapping row, the directory host — whatever the write was
//     earned on.
//
// `useToast()` IS the function (`ui/Toast.jsx` `value={raise}`): there is no `.show`. Calling
// one on the clinical side was a Critical — a chart the server had taken told the clinician it had
// failed, in the literal text "toast.show is not a function".
import { apiErrorText } from "../../apiErrors.js";

/**
 * The one line a refused write puts on the toast: `<subject>: <reason>`.
 *
 * @param t        the translator (`useI18n().t`)
 * @param subject  what the write was about, already in words a reader knows — a user's full name,
 *                 a group's name, an AD group's own name. Never an id, never a key; an id is not
 *                 what an administrator was looking at.
 * @param err      the failure from the API client — or a reason already in the reader's words,
 *                 which is used as it is: a 422's `others` (`apiErrors.fieldRefusals`), the
 *                 refusals about fields the form does not draw, joined.
 */
export function refusedFor(t, subject, err) {
  const reason = apiErrorText(t, err);
  const named = String(subject ?? "").trim();
  // No subject (a write that belongs to the whole tab — the directory test, a reload): the reason
  // alone, rather than an empty prefix and a colon.
  return named ? t("admin.refusedFor", { subject: named, reason }) : reason;
}

/**
 * The same for a write that SUCCEEDED, so the two read alike: `<subject> · <what happened>`.
 * A confirmation that does not name its subject is the milder half of the same fault — an
 * administrator resetting four passwords in a row cannot tell which one the toast is about.
 */
export function doneFor(t, subject, text) {
  const named = String(subject ?? "").trim();
  return named ? t("admin.doneFor", { subject: named, text }) : text;
}
