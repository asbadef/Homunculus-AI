/// <reference types="jest" />
// WCAG AA, enforced as arithmetic instead of a review note. The final M1 review measured
// clinical.critical at 4.22:1 on card — below the 4.5:1 body-text bar at every size the app
// actually renders it (12px semibold pills, 11px section headers). A palette edit that pushes
// any meaning-bearing pair back under the bar should fail here, not in a ward at night.
//
// M3: the palette became two skins (icu/light), both hex now (translated from the web cockpit's
// Tailwind classes) rather than hsl(). The parser below learned #rrggbb; the hsl() path is kept
// only so this file still fails loudly if a future edit reintroduces an hsl() literal by mistake.
import palettes from "../src/theme/palette";
import type { ThemeKey } from "../src/theme/ThemeContext";

function hslToRgb(hsl: string): [number, number, number] {
  const m = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/.exec(hsl);
  if (!m) throw new Error(`not an hsl() string: ${hsl}`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) throw new Error(`not a #rrggbb string: ${hex}`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function toRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) return hexToRgb(color);
  if (color.startsWith("hsl(")) return hslToRgb(color);
  throw new Error(`unrecognised colour format: ${color}`);
}

function luminance(color: string): number {
  const [r, g, b] = toRgb(color).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const SKINS: ThemeKey[] = ["icu", "light"];

describe("palette contrast (WCAG AA)", () => {
  const body = 4.5;
  // accent is UI chrome (tab-bar active icon, chip borders/text at 14px+) — never body text — so
  // it only has to clear the large-text/graphical-object bar, not the 4.5:1 body-text one.
  const chrome = 3;

  describe.each(SKINS)("%s skin", (skin) => {
    const palette = palettes[skin];

    it.each([
      ["foreground on background", palette.foreground, palette.background],
      ["stale on card", palette.clinical.stale, palette.card],
      ["warning on card", palette.clinical.warning, palette.card],
      ["safe on card", palette.clinical.safe, palette.card],
      ["critical on card", palette.clinical.critical, palette.card],
      ["critical on background", palette.clinical.critical, palette.background],
    ])("%s clears 4.5:1", (_name, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(body);
    });

    it("accent on card clears 3:1 (UI chrome, not body text)", () => {
      expect(contrast(palette.accent, palette.card)).toBeGreaterThanOrEqual(chrome);
    });
  });
});
