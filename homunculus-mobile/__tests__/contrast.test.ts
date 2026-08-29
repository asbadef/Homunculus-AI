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
import { tintFor } from "../src/theme/tint";

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

/** Relative luminance from an already-normalised (0..1) rgb triple — the shared math underneath
 *  both `luminance` (an opaque colour string) and the composited pairs below (a blended one). */
function luminanceRgb01([r, g, b]: [number, number, number]): number {
  const gamma = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * gamma(r) + 0.7152 * gamma(g) + 0.0722 * gamma(b);
}

function luminance(color: string): number {
  return luminanceRgb01(toRgb(color));
}

function contrastFromLuminance(l1: number, l2: number): number {
  const [hi, lo] = [l1, l2].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function contrast(fg: string, bg: string): number {
  return contrastFromLuminance(luminance(fg), luminance(bg));
}

/**
 * What a tinted chip's background actually renders as: the app never paints a translucent layer
 * on its own, so measuring contrast against the *un*composited tint (as if it sat on nothing)
 * would understate the truth on a light background and overstate it on a dark one. This blends
 * an `#rrggbbaa` tint over an opaque `#rrggbb` parent, per channel, and returns the resulting
 * opaque colour as the same normalised rgb triple `luminance` works in.
 */
function compositeOver(fgHexWithAlpha: string, bgHex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(
    fgHexWithAlpha,
  );
  if (!m) throw new Error(`not a #rrggbbaa string: ${fgHexWithAlpha}`);
  const [fr, fg, fb] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const a = parseInt(m[4], 16) / 255;
  const [br, bg, bb] = toRgb(bgHex);
  return [fr * a + br * (1 - a), fg * a + bg * (1 - a), fb * a + bb * (1 - a)];
}

/** Contrast of an opaque foreground colour against an already-composited background triple. */
function contrastAgainstComposite(fg: string, compositedBg: [number, number, number]): number {
  return contrastFromLuminance(luminance(fg), luminanceRgb01(compositedBg));
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

// The pairs above are solid-on-solid. Every one of these is solid-on-*tint* — a coloured chip's
// text, painted over that same colour's own tinted-alpha background — and the plain contrast()
// check above cannot see it: it never composites the alpha, so it silently measured the text
// against the *tint string itself* (transparent) or was never asked at all. This is the pairing
// that actually renders on screen for RiskPill, PatientCard's escalated/unacknowledged chips,
// Waveform's bpm readout, and the ward header's active tab — driven through the real `tintFor`
// so this file tracks the idiom rather than a copy of its numbers.
//
// Before src/theme/tint.ts split the alpha by skin (both skins at the old flat `1A`), this block
// failed on light for every case below except the two riskpill/waveform "on card" safe-text
// cases — for example:
//   ● palette contrast: tinted-chip idiom (composited) › light skin › escalated chip: critical
//     text over its tint, on card clears 4.5:1
//     expect(received).toBeGreaterThanOrEqual(expected)
//     Expected: >= 4.5
//     Received:    4.374089...
// `tintFor`'s reduced light-skin alpha (see src/theme/tint.ts) is what makes them pass now.
describe("palette contrast: tinted-chip idiom (composited)", () => {
  const body = 4.5;
  const chrome = 3;

  describe.each(SKINS)("%s skin", (skin) => {
    const palette = palettes[skin];

    it.each([
      ["riskpill critical text over its tint, on card", palette.clinical.critical, palette.card],
      ["riskpill warning text over its tint, on card", palette.clinical.warning, palette.card],
      ["riskpill safe text over its tint, on card", palette.clinical.safe, palette.card],
      [
        "escalated chip: critical text over its tint, on card",
        palette.clinical.critical,
        palette.card,
      ],
      [
        "unacknowledged chip: warning text over its tint, on card",
        palette.clinical.warning,
        palette.card,
      ],
      ["waveform bpm: safe text over its tint, on card", palette.clinical.safe, palette.card],
      [
        "waveform bpm: safe text over its tint, on background",
        palette.clinical.safe,
        palette.background,
      ],
    ])("%s clears 4.5:1", (_name, fg, bgParent) => {
      const composited = compositeOver(tintFor(fg, skin), bgParent);
      expect(contrastAgainstComposite(fg, composited)).toBeGreaterThanOrEqual(body);
    });

    // Same chrome exception as the plain "accent on card" case above: this is the active ward
    // tab's actual rendering (accent text over accent's own tint, over the screen background),
    // so it only has to clear 3:1, not the 4.5:1 body-text bar.
    it("ward tab: accent text over its tint, on background, clears 3:1 (chrome)", () => {
      const composited = compositeOver(tintFor(palette.accent, skin), palette.background);
      expect(contrastAgainstComposite(palette.accent, composited)).toBeGreaterThanOrEqual(chrome);
    });
  });
});
