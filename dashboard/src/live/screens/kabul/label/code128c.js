// src/live/screens/kabul/label/code128c.js — the protocol number as a Code 128-C barcode (Group 2 ·
// B1d, spec D10, §6).
//
// Code 128-C encodes digit PAIRS: the twelve-digit protocol is six data symbols, 121 modules with
// its two 10-module quiet zones (Code 128-B, the prototype's, would need 187 and would not fit a
// 50 mm label at 3 printer dots a module). Input that is not an even number of ASCII digits is
// null, and nothing is drawn: a barcode that scans as another number is worse than none.
//
// The table is the prototype's (tasarim/prototip dashboard/src/patientLabel.js CODE128_PATTERNS),
// value for value: each pattern is six element widths — bar, space, bar, space, bar, space — of 11
// modules; STOP (106) is seven of 13. code128c.test.js checks every row and decodes the drawing back.

export const PATTERNS = Object.freeze([
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
]);

export const START_C = 105;
export const STOP = 106;
export const QUIET_MODULES = 10;

/** `digits` — a string of an even number of ASCII digits — as its symbol values
 *  [START-C, …pairs, checksum, STOP]; null for anything else. */
export function code128cValues(digits) {
  if (typeof digits !== "string" || !/^(?:[0-9]{2})+$/.test(digits)) return null;
  const pairs = [];
  for (let at = 0; at < digits.length; at += 2) pairs.push(Number(digits.slice(at, at + 2)));
  const check = pairs.reduce((acc, value, i) => acc + value * (i + 1), START_C) % 103;
  return [START_C, ...pairs, check, STOP];
}

/** The element widths of the symbols, bar first and alternating, one digit each. */
function widths(values) {
  return values.map((value) => PATTERNS[value]).join("");
}

/** The whole symbol's width in modules, both quiet zones counted (twelve digits: 121). */
export function moduleCount(values) {
  return QUIET_MODULES * 2 + [...widths(values)].reduce((acc, w) => acc + Number(w), 0);
}

/** The bars, in modules from the left edge: [{x, w}], the first right after the quiet zone. */
export function bars(values) {
  const out = [];
  let x = QUIET_MODULES;
  let bar = true;
  for (const w of widths(values)) {
    if (bar) out.push({ x, w: Number(w) });
    x += Number(w);
    bar = !bar;
  }
  return out;
}

/** The barcode as an SVG `moduleMm` millimetres a module and `heightMm` high — crisp edges, in
 *  module units inside — or null when `digits` cannot be encoded. */
export function code128cSvg(digits, { moduleMm, heightMm }) {
  const values = code128cValues(digits);
  if (!values) return null;
  const total = moduleCount(values);
  const rects = bars(values).map(({ x, w }) => `<rect x="${x}" y="0" width="${w}" height="1"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(total * moduleMm).toFixed(3)}mm" `
    + `height="${heightMm}mm" viewBox="0 0 ${total} 1" preserveAspectRatio="none" `
    + `shape-rendering="crispEdges" role="img" aria-label="${digits}">`
    + `<rect width="${total}" height="1" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
