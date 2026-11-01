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
  TEST_PROTOCOL, birthText, labelHtml, labelLines, labelRefusal, minWidthMm, moduleMm,
  openLabelWindow, printLabel, testLabel,
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

  it("the test label is synthetic: the zero protocol, the words «test label», nothing else", () => {
    const label = testLabel(t, { width_mm: 50, height_mm: 30, printer_dpi: 300 });
    expect(label.protocol_no).toBe(TEST_PROTOCOL);
    expect(TEST_PROTOCOL).toBe("000000000000");
    expect(labelLines(label, t)).toEqual([{ kind: "protocol", text: "000000000000" }, { kind: "name", text: "SINAQ ETİKETİ" }]);
    expect(label.label).toEqual({ width_mm: 50, height_mm: 30, printer_dpi: 300 });
  });
});
