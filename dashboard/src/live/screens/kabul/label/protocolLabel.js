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
// on it are the printing user's language. A larger configured size prints the same lines larger.
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

const knownDpi = (dpi) => Number.isInteger(dpi) && Object.hasOwn(DOTS_PER_MODULE, dpi);
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

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
const mm = (value) => `${Math.round(value * 100) / 100}mm`;

/** The whole print page: `@page` in the label's size, margin-free; the bars ≈10 mm high at 30 mm,
 *  every size in proportion to the height. */
export function labelHtml(label, { t, lang }) {
  const { width_mm: w, height_mm: h, printer_dpi: dpi } = label.label;
  const k = h / 30;
  const svg = code128cSvg(label.protocol_no, { moduleMm: moduleMm(dpi), heightMm: Math.round(10 * k * 100) / 100 }) ?? "";
  const lines = labelLines(label, t)
    .map(({ kind, text }) => `<div class="line ${kind}">${escapeHtml(text)}</div>`).join("");
  return "<!doctype html>"
    + `<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(label.protocol_no ?? "")}</title><style>`
    + `@page { size: ${w}mm ${h}mm; margin: 0; }`
    + "html, body { margin: 0; padding: 0; background: #fff; color: #000; }"
    + `body { width: ${w}mm; height: ${h}mm; overflow: hidden; font-family: Arial, Helvetica, sans-serif; }`
    + `.label { box-sizing: border-box; width: ${w}mm; height: ${h}mm; padding: ${mm(k)} ${SIDE_MARGIN_MM}mm 0;`
    + " display: flex; flex-direction: column; align-items: center; }"
    + ".code svg { display: block; }"
    + ".line { width: 100%; text-align: center; line-height: 1.15; white-space: nowrap; overflow: hidden; }"
    + `.protocol { font-size: ${mm(3.6 * k)}; font-weight: 700; letter-spacing: .04em; }`
    + `.name { font-size: ${mm(2.9 * k)}; font-weight: 700; white-space: normal; overflow-wrap: anywhere;`
    + " display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }"
    + `.born, .place { font-size: ${mm(2.4 * k)}; }`
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

/** The page written into `popup`, then printed a moment later (the page must lay out first). */
export function printLabel(popup, label, { t, lang, schedule = (fn) => setTimeout(fn, 250) }) {
  const doc = popup.document;
  doc.open();
  doc.write(labelHtml(label, { t, lang }));
  doc.close();
  popup.focus?.();
  schedule(() => {
    try {
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
