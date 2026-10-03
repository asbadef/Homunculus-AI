// Which characters each self-hosted face actually draws — read from the font files' cmap — and
// why the stacks in tokens.css end the way they do.
//
// The prototype measured it in the browser (istekler #279, 27-yazi-tipleri.html): Figtree has no
// "ə" and no Cyrillic, Space Grotesk no Cyrillic. Its app.css patched Cyrillic with @font-face
// aliases to local system fonts, because its `font: 600 13px Figtree` shorthands named no
// fallback and the missing letters fell to the browser's serif. Here every stack names a system
// sans that draws both (Segoe UI on Windows, Roboto on Android, Arial elsewhere), so a missing
// letter falls back per character to a matching-weight sans, never to serif — including the
// "ə" the prototype's patch did not cover. The mismatch of a fallback letter inside a Figtree
// word is the accepted cost of keeping these faces (decision #303).
//
// If a font update starts drawing a letter, the matching assertion fails: update this note.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { rule } from "./tokensCss.testutil.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.resolve(HERE, "../../../node_modules");

// WOFF2 (W3C): a 48-byte header, a table directory, then every table Brotli-compressed as one
// stream, in directory order. cmap is never transformed, so its bytes come out as the plain table.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
  "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC",
  "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat",
  "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf",
  "Silf", "Glat", "Gloc", "Feat", "Sill"];

function readBase128(buf, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[cursor.at];
    cursor.at += 1;
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value >>> 0;
  }
  throw new Error("bad UIntBase128");
}

function cmapTable(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${file}: not WOFF2`);
  const numTables = buf.readUInt16BE(12);
  const compressedLength = buf.readUInt32BE(20);
  const cursor = { at: 48 };
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[cursor.at];
    cursor.at += 1;
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buf.toString("latin1", cursor.at, cursor.at + 4);
      cursor.at += 4;
    }
    const version = flags >> 6;
    let length = readBase128(buf, cursor);
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    if (transformed) length = readBase128(buf, cursor);
    tables.push({ tag, length });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(cursor.at, cursor.at + compressedLength));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === "cmap") return data.subarray(offset, offset + table.length);
    offset += table.length;
  }
  throw new Error(`${file}: no cmap table`);
}

/** Every code point the cmap maps to a real glyph (formats 4 and 12). */
function codepoints(cmap) {
  const found = new Set();
  const subtables = cmap.readUInt16BE(2);
  for (let i = 0; i < subtables; i += 1) {
    const at = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(at);
    if (format === 4) {
      const segments = cmap.readUInt16BE(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s += 1) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c += 1) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            glyph = cmap.readUInt16BE(ranges + s * 2 + rangeOffset + (c - start) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) found.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g += 1) {
        const first = cmap.readUInt32BE(at + 16 + g * 12);
        const last = cmap.readUInt32BE(at + 20 + g * 12);
        for (let c = first; c <= last; c += 1) found.add(c);
      }
    }
  }
  return found;
}

/** Everything the package's upright (non-italic) files draw, all subsets together. */
function coverage(pkg) {
  const dir = path.join(MODULES, pkg, "files");
  const all = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".woff2") && !f.includes("italic"))) {
    for (const c of codepoints(cmapTable(path.join(dir, file)))) all.add(c);
  }
  return all;
}

const AZ_LETTERS = [..."əƏıİğĞşŞçÇöÖüÜ"];
const RUSSIAN = [..."АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя"];
const missing = (drawn, chars) => chars.filter((ch) => !drawn.has(ch.codePointAt(0))).join("");

const FACES = {
  text: { pkg: "@fontsource-variable/figtree", family: "Figtree Variable" },
  display: { pkg: "@fontsource-variable/space-grotesk", family: "Space Grotesk Variable" },
  data: { pkg: "@fontsource-variable/jetbrains-mono", family: "JetBrains Mono Variable" },
};
const ROOT = rule(":root");
const stack = (name) => ROOT[name].split(",").map((f) => f.trim().replace(/^"|"$/g, ""));

describe("what each self-hosted face draws", () => {
  it("JetBrains Mono (data) draws Azerbaijani and Russian itself", () => {
    const drawn = coverage(FACES.data.pkg);
    expect(missing(drawn, AZ_LETTERS)).toBe("");
    expect(missing(drawn, RUSSIAN)).toBe("");
  });

  it("Space Grotesk (display) draws Azerbaijani, but no Cyrillic", () => {
    const drawn = coverage(FACES.display.pkg);
    expect(missing(drawn, AZ_LETTERS)).toBe("");
    expect(missing(drawn, RUSSIAN)).toBe(RUSSIAN.join(""));
  });

  it("Figtree (text) draws neither ə/Ə nor Cyrillic", () => {
    const drawn = coverage(FACES.text.pkg);
    expect(missing(drawn, AZ_LETTERS)).toBe("əƏ");
    expect(missing(drawn, RUSSIAN)).toBe(RUSSIAN.join(""));
  });
});

describe("the stacks in tokens.css", () => {
  it.each(["text", "display", "data"])("--font-%s starts with the family its package registers", (name) => {
    const css = fs.readFileSync(path.join(MODULES, FACES[name].pkg, "index.css"), "utf8");
    expect(css).toContain(`font-family: '${FACES[name].family}'`);
    expect(stack(`font-${name}`)[0]).toBe(FACES[name].family);
  });

  it.each(["text", "display"])("--font-%s falls back to a system sans that draws ə and Cyrillic, never to serif", (name) => {
    const fonts = stack(`font-${name}`);
    expect(fonts.slice(1, 4)).toEqual(["Segoe UI", "Roboto", "Arial"]);
    expect(fonts.at(-1)).toBe("sans-serif");
    expect(fonts).not.toContain("serif");
  });

  it("--font-data ends in a monospace face", () => {
    expect(stack("font-data").at(-1)).toBe("monospace");
  });
});
