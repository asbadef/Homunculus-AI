// The protocol label (G2-B1d, spec §3, §6): the barcode-fit rule on the ENGINE's case table
// (homunculus-engine/tests/label_fit_cases.json — one table pins both sides, E13), the lines in
// their order with the empty ones dropped and the name in full, the page in the configured size
// with a module of whole printer dots, and the print. Synthetic labels only.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DICTIONARIES } from "../../../i18n/catalog.js";
import { createTranslator } from "../../../i18n/translate.js";
import {
  TEST_PROTOCOL, birthText, fitBorn, fitName, fitPlace, labelHtml, labelLayout, labelLines, labelRefusal,
  minWidthMm, moduleMm, openLabelWindow, printLabel, testLabel, wrapRows,
} from "./protocolLabel.js";

// (Paths built with node:path: under jsdom the global URL is jsdom's — apiErrors.test.js.)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE = JSON.parse(fs.readFileSync(
  path.resolve(HERE, "../../../../../../homunculus-engine/tests/label_fit_cases.json"), "utf8"));
const t = createTranslator("az", DICTIONARIES);

const LABEL = {
  protocol_no: "202600000001", display_name: "Test Hasta", date_of_birth: "1970-05-05", sex: "female",
  unit_name: "Reanimasiya", bed_label: "1", label: { width_mm: 50, height_mm: 30, printer_dpi: 203 },
};

describe("the fit rule — the engine's own case table", () => {
  it("is read: the table holds the cases and the narrowest widths", () => {
    expect(TABLE.cases.length).toBeGreaterThan(10);
    expect(Object.keys(TABLE.min_width_mm).sort()).toEqual(["203", "300"]);
  });

  it.each(TABLE.cases.map((c) => [`${c.width_mm}x${c.height_mm}@${c.printer_dpi}`, c]))("%s", (_name, c) => {
    expect(labelRefusal(c.width_mm, c.height_mm, c.printer_dpi)).toBe(c.answer);
  });

  it("a module is whole printer dots, and the narrowest label is the table's", () => {
    expect(moduleMm(203)).toBeCloseTo((3 * 25.4) / 203, 9);
    expect(moduleMm(300)).toBeCloseTo((4 * 25.4) / 300, 9);
    for (const [dpi, min] of Object.entries(TABLE.min_width_mm)) expect(minWidthMm(Number(dpi))).toBeCloseTo(min, 3);
  });

  it("refuses what the server's types refuse: a dpi as text, a size not a whole millimetre", () => {
    expect(labelRefusal(50, 30, "203")).toBe("label_dpi");
    expect(labelRefusal(50.5, 30, 203)).toBe("label_size");
    expect(labelRefusal(Number.NaN, 30, 203)).toBe("label_size");
  });

  // Task 13 review F-8: translate.js documents Chrome 87 / Safari 14 targets, which have no Object.hasOwn.
  it("does not need Object.hasOwn", () => {
    const hasOwn = Object.hasOwn;
    try {
      Object.hasOwn = undefined;
      expect(labelRefusal(50, 30, 203)).toBeNull();
      expect(labelRefusal(50, 30, 300)).toBeNull();
      expect(labelRefusal(50, 30, 150)).toBe("label_dpi");
      expect(labelRefusal(50, 30, 0)).toBe("label_dpi");
    } finally {
      Object.hasOwn = hasOwn;
    }
  });
});

describe("the lines", () => {
  it("are the protocol, the full name, birth date · sex, unit · bed — in that order", () => {
    expect(labelLines(LABEL, t)).toEqual([
      { kind: "protocol", text: "202600000001" }, { kind: "name", text: "Test Hasta" },
      { kind: "born", text: "05.05.1970 · Qadın" }, { kind: "place", text: "Reanimasiya · Çarpayı 1" },
    ]);
  });

  it("drop what is empty — never «—» — and keep what is left of a line", () => {
    const lines = labelLines({ ...LABEL, date_of_birth: null, sex: "", unit_name: "  ", bed_label: "1" }, t);
    expect(lines.map((l) => l.kind)).toEqual(["protocol", "name", "place"]);
    expect(lines.at(-1).text).toBe("Çarpayı 1");
    expect(JSON.stringify(labelLines({ ...LABEL, sex: "x", date_of_birth: "05/05/1970", unit_name: null, bed_label: null }, t)))
      .not.toMatch(/—|undefined|null/);
  });

  it("print a birth date only when it is a whole ISO date — a wrong date is worse than none", () => {
    expect(birthText("1970-05-05")).toBe("05.05.1970");
    for (const bad of ["1970-5-5", "05.05.1970", "", null, "1970-05-05T00:00:00Z"]) expect(birthText(bad)).toBeNull();
  });
});

// A-3 (Task 13 review F-3, F-9): a name is never cut — no clamp, no ellipsis, no hidden overflow. The
// name keeps two rows at the normal size; a longer one is set smaller, by its length, and at the smallest
// size it takes a third row (and as many more as it needs); whatever then no longer fits the page is
// dropped WHOLE, the unit · bed line first. The unit · bed line steps down like the name and is never
// clipped mid-text. The reference label is 50×30: 47 mm of row, text scale 1. The model sets a bold
// capital at 0.75 em and a regular character at 0.7 em — conservative averages for real names, not
// bounds (see protocolLabel.js) — which makes a row of the name hold 21 / 25 / 29 / 39 characters at 2.9 / 2.5 /
// 2.1 / 1.6 mm, and a row of the place 27 / 31 / 37 at 2.4 / 2.1 / 1.8 mm.
describe("the layout — the name is never cut (A-3)", () => {
  const REF = { widthMm: 50, heightMm: 30 };
  const AVAIL = 47;
  const N = (n) => "N".repeat(n);                      // a name with no space: the strictest, breaks anywhere
  const layoutOf = (over = {}, dims = REF) => labelLayout(labelLines({ ...LABEL, ...over }, t), dims);
  const lineOf = (layout, kind) => layout.lines.find((line) => line.kind === kind);
  const kindsOf = (layout) => layout.lines.map((line) => line.kind);

  it("counts rows the way the page wraps: at spaces, a word too long for a row broken anywhere", () => {
    expect(wrapRows("", 21)).toBe(0);
    expect(wrapRows("Test Hasta", 21)).toBe(1);
    expect(wrapRows(N(21), 21)).toBe(1);
    expect(wrapRows(N(22), 21)).toBe(2);
    expect(wrapRows(`${N(12)} ${N(8)}`, 21)).toBe(1);   // 12 + 1 + 8 = 21 fits the row
    expect(wrapRows(`${N(12)} ${N(9)}`, 21)).toBe(2);   // 22 does not: the word moves down
    expect(wrapRows(`${N(5)} ${N(43)}`, 21)).toBe(4);   // the long word starts a row of its own, then breaks over three
  });

  it.each([
    [42, 2.9, 2], [43, 2.5, 2],       // the normal size holds 2 × 21
    [50, 2.5, 2], [51, 2.1, 2],       // 2 × 25
    [58, 2.1, 2], [59, 1.6, 2],       // 2 × 29: past it the smallest size …
    [78, 1.6, 2], [79, 1.6, 3],       // … which holds 2 × 39 in two rows, then takes a third row
    [117, 1.6, 3], [118, 1.6, 4],     // 3 × 39: past it more rows — never a shorter name
    [200, 1.6, 6],                    // the server's longest display_name (max_length 200)
  ])("a %i-character name is set at %f mm in %i rows", (length, size, rows) => {
    expect(fitName(N(length), AVAIL, 1)).toEqual({ size, rows });
  });

  it("steps by where the words fall, not by the count alone: three 12-letter words need the 25-character row", () => {
    const name = `${N(12)} ${N(12)} ${N(12)}`;           // 38 characters, yet 3 rows at 21 to a row
    expect(name).toHaveLength(38);
    expect(fitName(name, AVAIL, 1)).toEqual({ size: 2.5, rows: 2 });
  });

  it.each([
    [27, 2.4, 1], [28, 2.1, 1],       // the unit · bed line is one row at 2.4 mm up to 27 characters
    [31, 2.1, 1], [32, 1.8, 1],
    [37, 1.8, 1], [38, 1.8, 2],       // at the smallest size it may take a second row
    [74, 1.8, 2],
  ])("a %i-character place is set at %f mm in %i rows", (length, size, rows) => {
    expect(fitPlace(N(length), AVAIL, 1)).toEqual({ size, rows });
  });

  it("a place that fits no step is dropped whole, never cut — and the birth line the same", () => {
    expect(fitPlace(N(75), AVAIL, 1)).toBeNull();
    expect(fitBorn(N(37), AVAIL, 1)).toEqual({ size: 1.8, rows: 1 });
    expect(fitBorn(N(38), AVAIL, 1)).toBeNull();
  });

  it("sets an ordinary label at the normal sizes: the protocol, the name in one row, the rest", () => {
    const layout = layoutOf();
    expect(layout.lines).toEqual([
      { kind: "protocol", text: "202600000001", size: 3.6, rows: 1 },
      { kind: "name", text: "Test Hasta", size: 2.9, rows: 1 },
      { kind: "born", text: "05.05.1970 · Qadın", size: 2.4, rows: 1 },
      { kind: "place", text: "Reanimasiya · Çarpayı 1", size: 2.4, rows: 1 },
    ]);
    expect(layout.fits).toBe(true);
  });

  it("the unit · bed line steps down in size when it is long, and keeps every word of it", () => {
    const unit = "Reanimasiya və intensiv";                  // 23 + " · Çarpayı 1" = 35 characters
    const place = lineOf(layoutOf({ unit_name: unit }), "place");
    expect(place).toEqual({ kind: "place", text: `${unit} · Çarpayı 1`, size: 1.8, rows: 1 });
  });

  it("a unit · bed line too long for any step is dropped whole, not shown cut", () => {
    const unit = "Ürək-damar cərrahiyyəsi reanimasiya və intensiv terapiya şöbəsi, ikinci korpus, üçüncü mərtəbə";
    const layout = layoutOf({ unit_name: unit });
    expect(kindsOf(layout)).toEqual(["protocol", "name", "born"]);
    const html = labelHtml({ ...LABEL, unit_name: unit }, { t, lang: "az" });
    expect(html).not.toContain("Ürək-damar");
    expect(html).not.toContain("Çarpayı");
  });

  it("a name that needs a fourth row pushes the unit · bed line off before it is ever shortened", () => {
    const four = layoutOf({ display_name: N(120) });          // 4 rows at 1.6 mm: 7.36 + 2.76 + 2.76 ≤ 13.86 mm
    expect(kindsOf(four)).toEqual(["protocol", "name", "born", "place"]);
    expect(lineOf(four, "name")).toMatchObject({ text: N(120), size: 1.6, rows: 4 });
    const five = layoutOf({ display_name: N(160) });          // 5 rows: 9.2 + 2.76 + 2.76 > 13.86 mm
    expect(kindsOf(five)).toEqual(["protocol", "name", "born"]);
    expect(lineOf(five, "name")).toMatchObject({ text: N(160), size: 1.6, rows: 5 });
    expect(five.fits).toBe(true);
    expect(labelHtml({ ...LABEL, display_name: N(160) }, { t, lang: "az" })).not.toContain("Reanimasiya");
  });

  it("scales the text by the height, but never past what the width holds", () => {
    // 60×60: the bars and the frame double (k = 2); the text only grows to the width, 60 / 50 = 1.2.
    const layout = layoutOf({}, { widthMm: 60, heightMm: 60 });
    expect(layout.scale).toBeCloseTo(1.2, 9);
    expect(lineOf(layout, "name").size).toBeCloseTo(2.9 * 1.2, 9);
    expect(layoutOf({}, { widthMm: 110, heightMm: 20 }).scale).toBeCloseTo(20 / 30, 9);
    expect(layoutOf({}, { widthMm: 49, heightMm: 80 }).scale).toBeCloseTo(49 / 50, 9);
  });

  it("holds the longest name the server accepts, whole, on every label size the settings allow", () => {
    const names = [
      N(200), `${"Abcdefgh ".repeat(22)}Abcd`.slice(0, 200), "Wi ".repeat(66),
      `${"Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx ".repeat(6)}Xxxxxxxxxxxxxxxxxxxx`.slice(0, 200),
      "MMMMMMMM WWWWWWWW ".repeat(11), "Test Hasta",
    ];
    for (const widthMm of [44, 49, 50, 60, 80, 110]) {
      for (const heightMm of [20, 25, 30, 45, 60, 80]) {
        for (const name of names) {
          const layout = layoutOf({ display_name: name }, { widthMm, heightMm });
          expect({ widthMm, heightMm, name: name.length, fits: layout.fits }).toEqual({ widthMm, heightMm, name: name.length, fits: true });
          expect(lineOf(layout, "name").text).toBe(name.trim());
        }
      }
    }
  });

  it("writes the name uncut: no clamp, no ellipsis, no hidden overflow, the size on the line itself", () => {
    const name = "Sentetik Hasta ".repeat(10).trim();          // 149 characters
    const html = labelHtml({ ...LABEL, display_name: name }, { t, lang: "az" });
    expect(html).toContain(name);
    expect(html).not.toMatch(/line-clamp|text-overflow|ellipsis|…/);
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(css).not.toMatch(/\.line[^}]*overflow\s*:\s*hidden/);
    expect(css).not.toMatch(/\.line[^}]*nowrap/);
    expect(css).not.toMatch(/\.name[^}]*-webkit-box/);
    expect(html).toMatch(/<div class="line name" style="font-size: 1\.6mm">Sentetik Hasta/);
    expect(labelHtml(LABEL, { t, lang: "az" })).toMatch(/<div class="line name" style="font-size: 2\.9mm">Test Hasta</);
    expect(labelHtml(LABEL, { t, lang: "az" })).toMatch(/<div class="line place" style="font-size: 2\.4mm">Reanimasiya/);
  });
});

describe("the page", () => {
  it("is the configured size, margin-free, its bars whole printer dots, the name in full", () => {
    const html = labelHtml(LABEL, { t, lang: "az" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("@page { size: 50mm 30mm; margin: 0; }");
    expect(html).toContain('width="45.420mm"');                 // 121 × 3 dots at 203 dpi
    expect(html).toContain('height="10mm"');
    expect(html).toContain("Test Hasta");
    expect(html).toContain('<html lang="az">');
    const at300 = labelHtml({ ...LABEL, label: { width_mm: 60, height_mm: 60, printer_dpi: 300 } }, { t, lang: "az" });
    expect(at300).toContain("@page { size: 60mm 60mm; margin: 0; }");
    expect(at300).toContain('width="40.979mm"');                // 121 × 4 dots at 300 dpi
    expect(at300).toContain('height="20mm"');                   // a larger label, the same lines larger
  });

  it("writes every text as text", () => {
    const html = labelHtml({ ...LABEL, display_name: "Test <b>Hasta</b> & \"O'Brien\"" }, { t, lang: "az" });
    expect(html).toContain("Test &lt;b&gt;Hasta&lt;/b&gt; &amp; &quot;O&#39;Brien&quot;");
    expect(html).not.toContain("<b>Hasta</b>");
  });

  it("prints a moment after it is written, and a blocked window is no window", () => {
    let written = "";
    const popup = { document: { open: vi.fn(), write: (s) => { written += s; }, close: vi.fn() },
      focus: vi.fn(), print: vi.fn() };
    printLabel(popup, LABEL, { t, lang: "az", schedule: (fn) => fn() });
    expect(written).toContain("202600000001");
    expect(popup.document.close).toHaveBeenCalled();
    expect(popup.print).toHaveBeenCalledTimes(1);
    expect(openLabelWindow({ open: () => null })).toBeNull();
    expect(openLabelWindow({ open: () => { throw new Error("blocked"); } })).toBeNull();
  });

  // Task 13 review F-11: the print window holds the full name; it is closed once printing is over.
  // `afterprint` fires when the print dialog closes, printed or cancelled. The handler is set AFTER the
  // page is written (document.open() clears a window's handlers) and BEFORE print() (which may block).
  it("closes its window after printing, and sets the handler after the page is written and before print", () => {
    const events = [];
    const popup = {
      document: { open: () => events.push("open"), write: () => events.push("write"), close: () => events.push("document.close") },
      focus: () => events.push("focus"),
      close: vi.fn(() => events.push("window.close")),
      print: vi.fn(() => { events.push("print"); popup.onafterprint(); }),
    };
    let handler = null;
    Object.defineProperty(popup, "onafterprint", {
      get: () => handler,
      set: (fn) => { handler = fn; events.push("handler"); },
    });
    printLabel(popup, LABEL, { t, lang: "az", schedule: (fn) => fn() });
    expect(events).toEqual(["open", "write", "document.close", "focus", "handler", "print", "window.close"]);
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("does not close the window before the dialog is over, and a window gone already is no error", () => {
    let fire = null;
    const popup = { document: { open() {}, write() {}, close() {} }, focus() {}, print: vi.fn(),
      close: vi.fn(() => { throw new Error("gone already"); }) };
    printLabel(popup, LABEL, { t, lang: "az", schedule: (fn) => fn() });
    fire = popup.onafterprint;
    expect(typeof fire).toBe("function");
    expect(popup.close).not.toHaveBeenCalled();
    expect(() => fire()).not.toThrow();
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("the test label is synthetic: the zero protocol, the words «test label», nothing else", () => {
    const label = testLabel(t, { width_mm: 50, height_mm: 30, printer_dpi: 300 });
    expect(label.protocol_no).toBe(TEST_PROTOCOL);
    expect(TEST_PROTOCOL).toBe("000000000000");
    expect(labelLines(label, t)).toEqual([{ kind: "protocol", text: "000000000000" }, { kind: "name", text: "SINAQ ETİKETİ" }]);
    expect(label.label).toEqual({ width_mm: 50, height_mm: 30, printer_dpi: 300 });
  });
});
