// src/live/screens/patient/trends/trendText.js — how the big chart's axis, its readout and its table
// word an instant and a mark, so the three never say one thing three ways.
import { ddmm, hhmm } from "../../../i18n/dates.js";

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says: an alarm with the engine's own kind (data, not translated), a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** A mark as the readout names it beside a reading: with its OWN time when that reads differently —
 *  a mark within one pixel column of a reading need not be at the reading's instant, and the readout
 *  must not give it the reading's time. */
export function markBeside(t, mark, readingMs, hours) {
  const own = whenText(mark.ms, hours);
  return own === whenText(readingMs, hours) ? markText(t, mark) : `${markText(t, mark)} (${own})`;
}

/** A value as the readout names it beside the reading under the cursor ("64 mmHg", the text already
 *  written): followed by its OWN time in parentheses when that reads differently. The second series of a
 *  card (MAP) is read at the nearest reading within one pixel column of the first — seconds, perhaps a
 *  minute, apart — and the readout must not give it the first one's time. */
export function valueBeside(text, readingMs, atMs, hours) {
  const own = whenText(readingMs, hours);
  return own === whenText(atMs, hours) ? text : `${text} (${own})`;
}

/** The engine's NEWS2 points for one reading, as a column prints them: "+3", "0", or "—" for none. */
export const pointsText = (points) => (Number.isInteger(points) ? (points > 0 ? `+${points}` : "0") : "—");
