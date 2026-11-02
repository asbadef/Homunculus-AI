// src/live/i18n/numbers.js — a number as the active language writes it (G3-01, the saved step).
//
// The engine's JSON writes 36.8 with a point; a nurse who typed «36,8» reads «36,8» back. Turkish, Azerbaijani and
// Russian write the decimal comma, English the point. Only the separator is localised: there is no grouping (the
// values here are vitals, never thousands) and no digit rewriting, so the text a screen builds from this is the
// number the engine holds. A language this file does not know keeps the point.
const DECIMAL_COMMA = new Set(["tr", "az", "ru"]);

/** `value` as text in `lang`: "36.8" -> "36,8" for tr/az/ru, "36.8" for en; a whole number is left as it is. */
export function numberText(lang, value) {
  const text = String(value);
  return DECIMAL_COMMA.has(lang) ? text.replace(".", ",") : text;
}
