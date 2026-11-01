// src/live/screens/devices/deviceMap.js — the monitor→bed editor's pure rules (spec 2026-10-28 §3):
// how a monitor, a bed and (in the occupied-bed step only) a patient are named. No patient number is
// ever printed; a patient is «Ahmet Y.» from the session's own board card, or nobody (O5).
const pad = (n) => String(n).padStart(2, "0");
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export const MAPPING_PERMS = Object.freeze(["devices.map_beds", "devices.manage"]);
export const canSeeMapping = (perms) => MAPPING_PERMS.some((key) => Array.isArray(perms) && perms.includes(key));

/** Words that end an Azerbaijani, Turkish or Russian patronymic («Həsən oğlu», «Rəşid qızı»); compared
 *  lower-cased, so «OĞLU» and «Qızı» match as well. */
const PATRONYMIC = new Set(["oğlu", "qızı", "kızı", "оглы", "кызы", "oglu", "qizi"]);
/** The most initials after the first word. */
const MAX_INITIALS = 3;

/** A trailing patronymic marker. Lower-cased twice — without a locale and as Turkish — because «QIZI» and
 *  «KIZI» fold to «qizi» and «kızı» only in their own alphabets. */
const isPatronymic = (word) => PATRONYMIC.has(word.toLowerCase()) || PATRONYMIC.has(word.toLocaleLowerCase("tr"));

/** «Ahmet Yılmaz» → «Ahmet Y.»; «Məmmədov Əli Həsən oğlu» → «Məmmədov Ə. H.» (amendment A-1, O61).
 *  `display_name` is free text in whatever order the clerk typed it, so this is a recognition aid, not
 *  an identification. The first word stays whole, each later word is its initial and a dot (at most
 *  three), trailing patronymic markers are dropped and the first word is never dropped. The initial is the
 *  letter exactly as typed (A-18): it is NOT upper-cased, because `toLocaleUpperCase()` follows the
 *  browser's locale — «ilkin» would read «İ.» on an az/tr browser and «I.» on an en one, and one patient
 *  would read two ways on two screens. Letters are taken by code point, never `word[0]`, so a surrogate
 *  pair is not split. One word gives itself; a blank, null or undefined name gives null.
 *
 *  Where it may appear: only in the occupied-bed confirmation, beside the bed's label. Never in a log, a
 *  toast, `console.*` or a request body; the server never receives it. */
export function shortName(displayName) {
  const words = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && isPatronymic(words[words.length - 1])) words.pop();
  if (words.length === 0) return null;
  const initials = words.slice(1, 1 + MAX_INITIALS).map((word) => `${Array.from(word)[0]}.`);
  return [words[0], ...initials].join(" ");
}

/** Each occupied bed of a `bed_occupied` refusal (`err.occupied`) with the short name of its patient
 *  when the session's board holds that card; the board id itself goes no further. */
export function occupiedNames(occupied, patients) {
  const byId = new Map((patients ?? []).map((p) => [p.patient_id, p]));
  return (occupied ?? []).map((o) => ({ bedId: o.bed_id, name: shortName(byId.get(o.patient_id)?.display_name) }));
}

export const monitorName = (d) => (d.device_bed_label ? `${d.source} (${d.device_bed_label})` : d.source);

export function bedText(t, d) {
  if (!d.bed) return t("esleme.unbound");
  if (!d.bed.in_scope) return t("esleme.otherUnit");
  return `${d.bed.label} · ${d.bed.room} · ${d.bed.unit}`;
}

const clock = (ms) => { const at = new Date(ms); return `${pad(at.getHours())}:${pad(at.getMinutes())}`; };

export function visibility(d) {
  if (d.seen) return { key: "esleme.seen", vars: undefined };
  const ms = Date.parse(d.last_seen_at ?? "");
  return Number.isFinite(ms) ? { key: "esleme.unseenAt", vars: { time: clock(ms) } } : { key: "esleme.unseenUnknown", vars: undefined };
}

/** The strip's method line (DevicesScreen.jsx): an editor row's UTC time (D21) as this browser's local
 *  «YYYY-AA-GG SS:DD»; v2's date, and any other text a row carries, exactly as written. «—» is only for no
 *  value at all (null, a non-string, a blank): it reads as "never verified", so it never stands for a value that
 *  could not be read (A-18); a blank or whitespace-only string is no value either (A-20). Only an ISO
 *  date-time is parsed, because `Date.parse` makes a date of almost any text with a number in it («foo 1»). */
export function verifiedText(value) {
  if (typeof value !== "string" || value.trim() === "") return "—";
  if (DATE_ONLY.test(value) || !ISO_DATE_TIME.test(value)) return value;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clock(ms)}`;
}
