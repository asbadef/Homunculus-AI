// src/live/screens/kabul/label/protocolLabel.js — the protocol label (Group 2 · B1d, spec §3, §6,
// D6, D10): whether a size holds its barcode, its lines, its page and its print.
//
// THE FIT RULE IS THE ENGINE'S (protocol/fit.py), line for line, and one case table pins both
// (homunculus-engine/tests/label_fit_cases.json): 121 modules of whole printer dots — 3 at 203 dpi,
// 4 at 300 — and 1.5 mm each side; dpi, then size, then fit (E11).
//
// THE LINES: the barcode, the protocol large, the FULL name (a label is paper: the screen's masking
// does not apply), birth date · sex, unit · bed. A line with nothing to say is dropped, never written
// as «—»: an empty field printed as a dash reads as "none", and "not told" is not "none". The words
// on it are the printing user's language. A larger configured size prints the same lines larger — as
// large as the label's width lets the text be (`labelLayout`).
//
// NOTHING ON THE LABEL IS EVER CUT (amendment A-3; Task 13 review F-3, F-9). A name cut to fit is a
// wrong-patient risk on paper, so there is no line clamp, no ellipsis and no hidden overflow. The name
// keeps two rows at the normal size; a longer one is set smaller, the size chosen by its length
// (`fitName`, a pure step function); at the smallest size it takes a third row, and as many more as it
// needs. The unit · bed line and the birth line step down the same way (`fitPlace`, `fitBorn`). What
// then does not fit the page is dropped WHOLE — the unit · bed line first, the birth line next — and
// never shown cut. `labelLayout` decides all of it, in one place, from the text alone.
import { code128cSvg } from "./code128c.js";

export const MM_PER_INCH = 25.4;
export const DOTS_PER_MODULE = Object.freeze({ 203: 3, 300: 4 });
export const BARCODE_MODULES = 121;
export const SIDE_MARGIN_MM = 1.5;
export const WIDTH_MM = Object.freeze([30, 110]);
export const HEIGHT_MM = Object.freeze([20, 80]);
/** The test label's protocol (spec §6): synthetic, and never a number the counter issues first. */
export const TEST_PROTOCOL = "000000000000";
const SEXES = new Set(["female", "male", "other", "unknown"]);

// (Not Object.hasOwn: translate.js documents Chrome 87 / Safari 14 targets, which do not have it.)
const knownDpi = (dpi) => Number.isInteger(dpi) && Object.prototype.hasOwnProperty.call(DOTS_PER_MODULE, dpi);
const within = (value, [lo, hi]) => Number.isInteger(value) && value >= lo && value <= hi;

/** One bar module at this resolution, in millimetres. */
export function moduleMm(dpi) {
  return (DOTS_PER_MODULE[dpi] * MM_PER_INCH) / dpi;
}

/** The narrowest label that holds the barcode at this resolution. */
export function minWidthMm(dpi) {
  return BARCODE_MODULES * moduleMm(dpi) + 2 * SIDE_MARGIN_MM;
}

/** null when the label is accepted, else the refusal's code — the server's, in its order. */
export function labelRefusal(widthMm, heightMm, dpi) {
  if (!knownDpi(dpi)) return "label_dpi";
  if (!within(widthMm, WIDTH_MM) || !within(heightMm, HEIGHT_MM)) return "label_size";
  if (widthMm < minWidthMm(dpi)) return "label_too_narrow";
  return null;
}

/** "1970-05-05" → "05.05.1970"; anything else null — a wrong date printed is worse than none. Read
 *  from the text, never through Date: a date has no time zone to shift it a day. */
export function birthText(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso : "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

const filled = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const joined = (parts) => parts.filter(Boolean).join(" · ") || null;

/** The label's lines in order, each {kind, text}; a line with nothing to say is not there. */
export function labelLines(label, t) {
  const sex = SEXES.has(label?.sex) ? t(`protokol.label.sex.${label.sex}`) : null;
  const bed = filled(label?.bed_label);
  return [
    { kind: "protocol", text: filled(label?.protocol_no) },
    { kind: "name", text: filled(label?.display_name) },
    { kind: "born", text: joined([birthText(label?.date_of_birth), sex]) },
    { kind: "place", text: joined([filled(label?.unit_name), bed ? `${t("protokol.label.bed")} ${bed}` : null]) },
  ].filter((line) => line.text);
}

// ── The layout (A-3) ─────────────────────────────────────────────────────────────────────────────
// All sizes are millimetres on the 50×30 reference label, times the text scale. A row holds as many
// characters as its width divides by the character's width; no layout is measured here (this is a pure
// function), so a character is taken at a fixed width in em — bold 0.75, regular text with capitals
// and digits 0.7. These are CONSERVATIVE AVERAGES for real names, not worst-case bounds: Azerbaijani
// names measured 0.69–0.93 of the model's width, and a run of the widest bold capitals (Arial Bold M
// and W exceed 0.75 em) can set wider than planned. The plan may therefore expect a row more than the
// page needs, and rarely a row less. Where it is a row less, the excess falls below the name — the
// page flows the name first, and the body clips at the label's height — so it takes the last optional
// line (the unit · bed line, then the birth line) inside that clip, and never the name.
const EM_BOLD = 0.75;
const EM_REGULAR = 0.7;
export const LINE_HEIGHT = 1.15;
const BAR_MM = 10; //          the barcode, at 30 mm of label height
const PROTOCOL_MM = 3.6; //    the protocol number's size
const FRAME_MM = 1; //         the top padding, and the same again kept free at the bottom

/** `rows` is how many rows the size is allowed. The NAME's last step is open: it takes the rows it
 *  needs, because the name is never shortened. */
export const NAME_STEPS = Object.freeze([
  Object.freeze({ size: 2.9, rows: 2 }), // the normal size, two rows
  Object.freeze({ size: 2.5, rows: 2 }),
  Object.freeze({ size: 2.1, rows: 2 }),
  Object.freeze({ size: 1.6, rows: 3 }), // the smallest: a third row, and more when the name needs them
]);
export const BORN_STEPS = Object.freeze([
  Object.freeze({ size: 2.4, rows: 1 }), Object.freeze({ size: 2.1, rows: 1 }), Object.freeze({ size: 1.8, rows: 1 }),
]);
export const PLACE_STEPS = Object.freeze([
  Object.freeze({ size: 2.4, rows: 1 }), Object.freeze({ size: 2.1, rows: 1 }), Object.freeze({ size: 1.8, rows: 2 }),
]);

/** How many rows `text` takes when `perRow` characters fit a row: words wrap at spaces, and a word
 *  longer than a row is broken anywhere (`overflow-wrap: anywhere`) after moving to a row of its own,
 *  as the page does. 0 for no text. */
export function wrapRows(text, perRow) {
  let rows = 0;
  let used = 0; // characters on the last row; 0 = that row is empty
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const length = [...word].length;
    if (rows > 0 && used > 0 && used + 1 + length <= perRow) {
      used += 1 + length;
    } else if (length <= perRow) {
      rows += 1;
      used = length;
    } else {
      const over = Math.ceil(length / perRow); // too long for a row: a row of its own, then broken anywhere
      rows += over;
      used = length - (over - 1) * perRow;
    }
  }
  return rows;
}

/** The first step (the largest size) at which `text` fits its rows, as {size, rows} in millimetres
 *  already times `scale`; past the last step, the last one with the rows the text needs if `open`
 *  (the name), else null (a line that fits no step is dropped whole). */
function fitText(text, steps, { availMm, scale, em, open = false }) {
  let last = null;
  for (const step of steps) {
    const size = step.size * scale;
    const perRow = Math.max(1, Math.floor(availMm / (size * em) + 1e-9));
    const rows = wrapRows(text, perRow);
    last = { size, rows };
    if (rows <= step.rows) return last;
  }
  return open ? last : null;
}

/** The size and rows of the full name: stepped by its length, never shortened. */
export const fitName = (name, availMm, scale) => fitText(name, NAME_STEPS, { availMm, scale, em: EM_BOLD, open: true });
/** The birth date · sex line, or null when it fits no step. */
export const fitBorn = (text, availMm, scale) => fitText(text, BORN_STEPS, { availMm, scale, em: EM_REGULAR });
/** The unit · bed line, or null when it fits no step — then it is dropped whole. */
export const fitPlace = (text, availMm, scale) => fitText(text, PLACE_STEPS, { availMm, scale, em: EM_REGULAR });

/**
 * The lines of `labelLines` with the size and rows each is set in, and whatever does not fit the page
 * dropped whole. `scale` is the text's scale: the height's (a 60 mm label is twice a 30 mm one) but
 * never more than the width holds (a 50 mm wide label is 1), so a tall narrow label does not set its
 * lines wider than its paper. `fits` is false only when even the name does not fit the page — which
 * the sizes above rule out for any name of the server's 200 characters on every label size.
 */
export function labelLayout(lines, { widthMm, heightMm }) {
  const k = heightMm / 30;
  const scale = Math.min(k, widthMm / 50);
  const availMm = widthMm - 2 * SIDE_MARGIN_MM;
  const rowsMm = (rows, size) => rows * size * LINE_HEIGHT;
  const text = (kind) => lines.find((line) => line.kind === kind)?.text;

  const set = [];
  let used = FRAME_MM * k * 2 + BAR_MM * k;
  if (text("protocol")) {
    const size = PROTOCOL_MM * scale;
    set.push({ kind: "protocol", text: text("protocol"), size, rows: 1 });
    used += rowsMm(1, size);
  }
  if (text("name")) {
    const fit = fitName(text("name"), availMm, scale);
    set.push({ kind: "name", text: text("name"), ...fit });
    used += rowsMm(fit.rows, fit.size);
  }
  // The birth line, then the unit · bed line: each only if it fits a step and the page is not full —
  // the last one goes first (A-3), whole.
  const optional = [];
  for (const [kind, fitter] of [["born", fitBorn], ["place", fitPlace]]) {
    const fit = text(kind) ? fitter(text(kind), availMm, scale) : null;
    if (fit) optional.push({ kind, text: text(kind), ...fit });
  }
  const fitsPage = (more) => used + more.reduce((sum, line) => sum + rowsMm(line.rows, line.size), 0) <= heightMm + 1e-9;
  while (optional.length && !fitsPage(optional)) optional.pop();
  for (const line of optional) {
    set.push(line);
    used += rowsMm(line.rows, line.size);
  }
  return { lines: set, scale, usedMm: used, fits: used <= heightMm + 1e-9 };
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const mm = (value) => `${Math.round(value * 100) / 100}mm`;

/** The whole print page: `@page` in the label's size, margin-free; the bars ≈10 mm high at 30 mm,
 *  every size in proportion to the height. Each line carries its own size from `labelLayout`; no line
 *  is clipped, clamped or ellipsised. */
export function labelHtml(label, { t, lang }) {
  const { width_mm: w, height_mm: h, printer_dpi: dpi } = label.label;
  const k = h / 30;
  const svg = code128cSvg(label.protocol_no, { moduleMm: moduleMm(dpi), heightMm: Math.round(BAR_MM * k * 100) / 100 }) ?? "";
  const lines = labelLayout(labelLines(label, t), { widthMm: w, heightMm: h }).lines
    .map(({ kind, text, size }) => `<div class="line ${kind}" style="font-size: ${mm(size)}">${escapeHtml(text)}</div>`).join("");
  return "<!doctype html>"
    + `<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(label.protocol_no ?? "")}</title><style>`
    + `@page { size: ${w}mm ${h}mm; margin: 0; }`
    + "html, body { margin: 0; padding: 0; background: #fff; color: #000; }"
    + `body { width: ${w}mm; height: ${h}mm; overflow: hidden; font-family: Arial, Helvetica, sans-serif; }`
    + `.label { box-sizing: border-box; width: ${w}mm; height: ${h}mm; padding: ${mm(FRAME_MM * k)} ${SIDE_MARGIN_MM}mm 0;`
    + " display: flex; flex-direction: column; align-items: center; }"
    + ".code svg { display: block; }"
    + `.line { width: 100%; text-align: center; line-height: ${LINE_HEIGHT}; overflow-wrap: anywhere; }`
    + ".protocol { font-weight: 700; letter-spacing: .04em; }"
    + ".name { font-weight: 700; }"
    + `</style></head><body><div class="label"><div class="code">${svg}</div>${lines}</div></body></html>`;
}

/** A window to print in, or null when the browser refused one. Called IN the click: a window
 *  opened after an await is a pop-up the browser blocks. */
export function openLabelWindow(win = window) {
  try {
    return win.open("", "_blank", "width=480,height=360") ?? null;
  } catch {
    return null;
  }
}

/** The page written into `popup`, then printed a moment later (the page must lay out first) and the
 *  window closed once printing is over: it holds the patient's full name, and a window left open is a
 *  name on a screen nobody is watching (Task 13 review F-11). `afterprint` fires when the print dialog
 *  closes, printed or cancelled; the handler is set after the page is written (`document.open()`
 *  clears a window's handlers) and before `print()` (which may block until the dialog is over). */
export function printLabel(popup, label, { t, lang, schedule = (fn) => setTimeout(fn, 250) }) {
  const doc = popup.document;
  doc.open();
  doc.write(labelHtml(label, { t, lang }));
  doc.close();
  popup.focus?.();
  schedule(() => {
    try {
      popup.onafterprint = () => {
        try {
          popup.close();
        } catch {
          /* gone already */
        }
      };
      popup.print();
    } catch {
      /* the reader may close it first */
    }
  });
}

/** The admin tab's test label (spec §6): synthetic only — the zero protocol and the words «test
 *  label» in the reader's language — in the size and resolution given. No request is made. */
export function testLabel(t, { width_mm, height_mm, printer_dpi }) {
  return { protocol_no: TEST_PROTOCOL, display_name: t("protokol.testName"), date_of_birth: null, sex: null,
    unit_name: null, bed_label: null, label: { width_mm, height_mm, printer_dpi } };
}
