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

// THE TEST'S OWN REFERENCE (Task 13 review F-7). Code 128's symbol table, ISO/IEC 15417: one row per
// symbol value 0–106, the six element widths (bar, space, bar, space, bar, space) in modules — STOP,
// 106, seven. It is written here as a literal and NOT imported from the encoder: a decoder that looked
// its symbols up in the encoder's own table would read a swap of two rows back as correctly as the
// encoder wrote it, and every round-trip below would pass on a barcode that scans as another number.
// In Code set C a value 0–99 is that digit pair; 100–102 are Code B, Code A, FNC1; 103–105 the three
// starts (A, B, C); 106 STOP.
const REFERENCE = `
  0 212222
  1 222122
  2 222221
  3 121223
  4 121322
  5 131222
  6 122213
  7 122312
  8 132212
  9 221213
 10 221312
 11 231212
 12 112232
 13 122132
 14 122231
 15 113222
 16 123122
 17 123221
 18 223211
 19 221132
 20 221231
 21 213212
 22 223112
 23 312131
 24 311222
 25 321122
 26 321221
 27 312212
 28 322112
 29 322211
 30 212123
 31 212321
 32 232121
 33 111323
 34 131123
 35 131321
 36 112313
 37 132113
 38 132311
 39 211313
 40 231113
 41 231311
 42 112133
 43 112331
 44 132131
 45 113123
 46 113321
 47 133121
 48 313121
 49 211331
 50 231131
 51 213113
 52 213311
 53 213131
 54 311123
 55 311321
 56 331121
 57 312113
 58 312311
 59 332111
 60 314111
 61 221411
 62 431111
 63 111224
 64 111422
 65 121124
 66 121421
 67 141122
 68 141221
 69 112214
 70 112412
 71 122114
 72 122411
 73 142112
 74 142211
 75 241211
 76 221114
 77 413111
 78 241112
 79 134111
 80 111242
 81 121142
 82 121241
 83 114212
 84 124112
 85 124211
 86 411212
 87 421112
 88 421211
 89 212141
 90 214121
 91 412121
 92 111143
 93 111341
 94 131141
 95 114113
 96 114311
 97 411113
 98 411311
 99 113141
100 114131
101 311141
102 411131
103 211412
104 211214
105 211232
106 2331112
`.trim().split("\n").map((row) => {
  const [value, pattern] = row.trim().split(/\s+/);
  return { value: Number(value), pattern };
});

/** The SVG back to its digits, from its geometry alone: the bars' x and width, the gaps between
 *  them, the quiet zones; then six elements a symbol (STOP seven), each looked up in the TEST'S OWN
 *  reference above, START-C first, the checksum held to the rule. Throws on anything that is not a
 *  clean Code 128-C. */
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
  const valueOf = new Map(REFERENCE.map(({ value, pattern }) => [pattern, value]));
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

describe("the test's own reference table", () => {
  // The literal is itself checked, by what the standard guarantees of EVERY symbol — so a slip in
  // retyping it is caught here, not mistaken for a fault in the encoder.
  it("has 107 rows, values 0–106 in order, each a self-checking Code 128 symbol", () => {
    expect(REFERENCE.map((row) => row.value)).toEqual(Array.from({ length: 107 }, (_, v) => v));
    REFERENCE.forEach(({ value, pattern }) => {
      const widths = [...pattern].map(Number);
      const bars = widths.filter((_, i) => i % 2 === 0).reduce((a, w) => a + w, 0);
      const spaces = widths.filter((_, i) => i % 2 === 1).reduce((a, w) => a + w, 0);
      expect({ value, widths: widths.length, modules: sum(pattern), within: widths.every((w) => w >= 1 && w <= 4) })
        .toEqual({ value, ...(value === STOP ? { widths: 7, modules: 13 } : { widths: 6, modules: 11 }), within: true });
      // Code 128's parity rule: the bars of a symbol total an even number of modules, the spaces an odd one.
      expect({ value, bars: bars % 2, spaces: spaces % 2 }).toEqual({ value, bars: 0, spaces: 1 });
    });
    expect(new Set(REFERENCE.map((row) => row.pattern)).size).toBe(107);
  });
});

describe("the Code 128 table", () => {
  it("is the reference table, row by row — a swap of two data rows is a fault (F-7)", () => {
    expect(PATTERNS).toHaveLength(REFERENCE.length);
    REFERENCE.forEach(({ value, pattern }) => {
      expect({ value, pattern: PATTERNS[value] }).toEqual({ value, pattern });
    });
  });

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

  it("every digit pair 00–99 is drawn as the reference's symbol, not a neighbour's (F-7)", () => {
    // One long number holding all 100 data symbols; the decoder looks each up in the test's own table.
    const every = Array.from({ length: 100 }, (_, v) => String(v).padStart(2, "0")).join("");
    expect(decode(code128cSvg(every, { moduleMm: 0.375, heightMm: 10 })).digits).toBe(every);
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
