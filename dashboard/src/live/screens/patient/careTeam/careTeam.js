// src/live/screens/patient/careTeam/careTeam.js — what the «Bakım ekibi» box knows without React
// (Group 2 · B1c, spec §4, T1, T5, T8). Pure.
//
// - Who a physician is: the session's role groups (T1). This is a display hint only: the server checks
//   again (admission/service.py PHYSICIAN_GROUPS, held equal by careTeam.test.js) and refuses
//   `care_team_not_physician`.
// - Which rows are the team now, which are its history, and which one is the attending's.
// - Which buttons a row offers this session (§4's table).
// - Whether an on-call window is one the server takes: an end after the start, in the future, and at
//   most 48 hours after the start (`ONCALL_MAX_MS`).

/** The default ROLE groups whose members are physicians (admission/service.py PHYSICIAN_GROUPS). */
export const PHYSICIAN_GROUPS = Object.freeze(["attending", "unit_physician", "physician"]);
/** The longest on-call window the server takes (admission/service.py ONCALL_MAX_WINDOW). */
export const ONCALL_MAX_MS = 48 * 3_600_000;
/** The roles, in the add dialog's order (spec §4: Yardımcı hekim / Nöbetçi hekim / Sorumlu hekim). */
export const ROLES = Object.freeze(["ASSOCIATE_PHYSICIAN", "ONCALL_PHYSICIAN", "ATTENDING"]);
/** The admissions the box looks among. A DRAFT says the attending comes with the signature (D3). */
export const OPEN = Object.freeze(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);

/** Whether the session is a physician's (T1). */
export const isPhysician = (user) =>
  (Array.isArray(user?.groups) ? user.groups : []).some((g) => PHYSICIAN_GROUPS.includes(g?.slug));

const rowsOf = (rows) => (Array.isArray(rows) ? rows : []);
/** The team now: the active rows, in the server's order (the newest first). */
export const activeRows = (rows) => rowsOf(rows).filter((r) => r.is_active);
/** The history: the closed rows, newest first. */
export const closedRows = (rows) => rowsOf(rows).filter((r) => !r.is_active);
/** The attending's row (D2: exactly one while the team lives), or null. */
export const attendingOf = (rows) => activeRows(rows).find((r) => r.role === "ATTENDING") ?? null;

/** An on-call row whose window has passed. It grants nothing (F9), and the screen says so. */
export function expired(row, nowMs) {
  if (row?.role !== "ONCALL_PHYSICIAN" || !row.window_end) return false;
  const end = Date.parse(row.window_end);
  return Number.isFinite(end) && end < nowMs;
}

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** §4's buttons on one row, for this session. The attending's row has none (T5): it ends when another
 *  attending is made. A member's own row offers «Ekipten ayrıl» instead of «Ekipten çıkar». */
export function actionsFor(row, { user, perms }) {
  const assign = (perms ?? []).includes("care_team.assign");
  const open = Boolean(row?.is_active) && row.role !== "ATTENDING";
  const own = same(row?.user_id, user?.id);
  return { promote: open && assign, remove: open && assign && !own, leave: open && own };
}

/** «Sorumlu hekim ol»: a `care_team.claim` holder who is a physician and not the attending. */
export function canClaim({ user, perms, attending }) {
  return (perms ?? []).includes("care_team.claim") && isPhysician(user) && !same(attending?.user_id, user?.id);
}

/** What is wrong with an on-call window, as the last part of its `ekip.dialog.need.*` key, or null. */
export function windowProblem(startMs, endMs, nowMs) {
  if (!Number.isFinite(startMs)) return "start";
  if (!Number.isFinite(endMs)) return "end";
  if (endMs <= startMs) return "order";
  if (endMs <= nowMs) return "future";
  if (endMs - startMs > ONCALL_MAX_MS) return "long";
  return null;
}

/** A name folded for the picker's search: lower case, accents off (the combining marks U+0300–U+036F
 *  that NFD splits off), the dotless ı read as i and the schwa ə read as e, and runs of spaces made one,
 *  so «ilkin» finds «İlkin», «qasim» finds «Qasımov» and «hekim» finds «Həkim». ə has no NFD
 *  decomposition, so it is folded by hand; Ə is already ə once lower-cased. */
const fold = (text) => String(text ?? "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").replace(/ə/g, "e").replace(/\s+/g, " ").trim();

/** Whether a name holds what was typed in the picker's search. An empty search holds every name. */
export function matchesName(name, query) {
  const wanted = fold(query);
  return wanted === "" || fold(name).includes(wanted);
}
