// The protocol number's barcode (G2-B1d, spec D10, §6): Code 128-C — digit pairs, so twelve digits
// are six data symbols and 121 modules with the two quiet zones. A table is data and cannot be read
// by eye; Code 128's own invariants catch a typo in it (every pattern 11 modules, STOP 13, no two
// alike), a hand-computed checksum pins the arithmetic, and the drawn bars are decoded back to the
// digits by a decoder that reads only the SVG's rectangles.
import { describe, it, expect } from "vitest";
import {
  PATTERNS, QUIET_MODULES, START_C, STOP, bars, code128cSvg, code128cValues, moduleCount,
} from "./code128c.js";

const sum = (pattern) => [...pattern].reduce((a, c) => a + Number(c), 0);

/** The SVG back to its digits, from its geometry alone: the bars' x and width, the gaps between
 *  them, the quiet zones; then six elements a symbol (STOP seven), each looked up, START-C first,
 *  the checksum held to the rule. Throws on anything that is not a clean Code 128-C. */
function decode(svg) {
  const total = Number(svg.match(/viewBox="0 0 (\d+) 1"/)[1]);
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="1"\/>/g)]
    .map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
  const elements = [];
  rects.forEach((r, i) => {
    elements.push(r.w);
    if (i + 1 < rects.length) elements.push(rects[i + 1].x - (r.x + r.w));
  });
  const quiet = [rects[0].x, total - (rects.at(-1).x + rects.at(-1).w)];
  const symbols = [];
  for (let at = 0; at < elements.length - 7; at += 6) symbols.push(elements.slice(at, at + 6).join(""));
  symbols.push(elements.slice(-7).join(""));
  const valueOf = new Map(PATTERNS.map((p, v) => [p, v]));
  const values = symbols.map((s) => {
    if (!valueOf.has(s)) throw new Error(`no symbol ${s}`);
    return valueOf.get(s);
  });
  if (values[0] !== START_C || values.at(-1) !== STOP) throw new Error("not START-C … STOP");
  const data = values.slice(1, -2);
  const check = data.reduce((acc, v, i) => acc + v * (i + 1), START_C) % 103;
  if (check !== values.at(-2)) throw new Error("checksum");
  return { digits: data.map((v) => String(v).padStart(2, "0")).join(""), quiet, total };
}

/** `digits` as full-width digits (U+FF10–FF19), the same count of characters. A Unicode-aware digit
 *  class (Python's `\d`, which the engine's own guard avoids) would take them; only ASCII `[0-9]`
 *  may reach the symbol table. */
const fullWidth = (digits) => [...digits].map((d) => String.fromCodePoint(d.charCodeAt(0) + 0xfee0)).join("");

describe("the Code 128 table", () => {
  it("holds 107 patterns: 0–102 data, 103–105 the starts, 106 STOP", () => {
    expect(PATTERNS).toHaveLength(107);
    expect(Object.isFrozen(PATTERNS)).toBe(true);
  });

  it("every pattern is six elements of 11 modules; STOP is seven of 13", () => {
    PATTERNS.forEach((pattern, value) => {
      const want = value === STOP ? { modules: 13, elements: 7 } : { modules: 11, elements: 6 };
      expect({ value, modules: sum(pattern), elements: pattern.length }).toEqual({ value, ...want });
    });
  });

  it("no two patterns are alike, and START-C, STOP and two data symbols are the standard's", () => {
    expect(new Set(PATTERNS).size).toBe(PATTERNS.length);
    expect([PATTERNS[START_C], PATTERNS[STOP], PATTERNS[0], PATTERNS[20]]).toEqual(["211232", "2331112", "212222", "221231"]);
  });
});

describe("code128cValues", () => {
  it("encodes digit pairs after START-C, then the checksum and STOP", () => {
    // 105 + 20·1 + 26·2 + 0·3 + 0·4 + 0·5 + 1·6 = 183; 183 mod 103 = 80 — by hand.
    expect(code128cValues("202600000001")).toEqual([105, 20, 26, 0, 0, 0, 1, 80, 106]);
    expect(code128cValues("000000000000")).toEqual([105, 0, 0, 0, 0, 0, 0, 105 % 103, 106]);
  });

  it.each([["12345"], ["20260000000A"], [""], [" 202600000001"], ["２０２６"], [null], [202600000001], ["H2600042"]])(
    "draws nothing for %j — a wrong barcode is worse than none", (input) => {
      expect(code128cValues(input)).toBeNull();
      expect(code128cSvg(input, { moduleMm: 0.375, heightMm: 10 })).toBeNull();
    });

  it("draws nothing for twelve full-width digits — twelve characters, an even count, none of them ASCII", () => {
    const wide = fullWidth("202600000001");
    expect(wide).toHaveLength(12);                 // the length is not what refuses it: the digits are
    expect(wide).not.toBe("202600000001");
    expect(code128cValues(wide)).toBeNull();
    expect(code128cSvg(wide, { moduleMm: 0.375, heightMm: 10 })).toBeNull();
  });

  it("twelve digits are 121 modules, the two quiet zones of 10 counted (E13)", () => {
    expect(moduleCount(code128cValues("202600000001"))).toBe(121);
    expect(moduleCount(code128cValues("20"))).toBe(10 + 11 + 11 + 11 + 13 + 10);
    expect(bars(code128cValues("202600000001"))[0].x).toBe(QUIET_MODULES);
  });
});

describe("code128cSvg", () => {
  it("is decoded back to the same twelve digits, with its quiet zones, from the drawing alone", () => {
    for (const digits of ["202600000001", "999999999999", "000000000000", "123456789012"]) {
      const got = decode(code128cSvg(digits, { moduleMm: 0.375, heightMm: 10 }));
      expect(got).toEqual({ digits, quiet: [QUIET_MODULES, QUIET_MODULES], total: 121 });
    }
  });

  it("a bar out of place is no barcode at all", () => {
    const svg = code128cSvg("202600000001", { moduleMm: 0.375, heightMm: 10 });
    const broken = svg.replace(/<rect x="(\d+)" y="0" width="1"/, (m, x) => `<rect x="${Number(x) + 1}" y="0" width="1"`);
    expect(broken).not.toBe(svg);
    expect(() => decode(broken)).toThrow();
  });

  it("sizes itself in millimetres: 121 modules at the dpi's module, crisp, the number its name", () => {
    const svg = code128cSvg("202600000001", { moduleMm: (3 * 25.4) / 203, heightMm: 10 });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('width="45.420mm"');
    expect(svg).toContain('height="10mm"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('aria-label="202600000001"');
  });
});
