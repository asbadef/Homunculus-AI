/// <reference types="jest" />
// WCAG AA, enforced as arithmetic instead of a review note. The final M1 review measured
// clinical.critical at 4.22:1 on card — below the 4.5:1 body-text bar at every size the app
// actually renders it (12px semibold pills, 11px section headers). A palette edit that pushes
// any meaning-bearing pair back under the bar should fail here, not in a ward at night.
//
// M6: the app adopts the user's chosen Figma "Medical Health Mobile App" kit language (see
// docs/superpowers/specs/2026-08-31-mobile-kit-language-m6-design.md). Light is now the kit and
// the default skin; two surfaces are new (`panel`, `soft`) and the kit's own layering law is
// tested here as arithmetic, not left as a style note: **blue (accent) text sits only on
// `panel`, never on `card`** — measured directly off the kit, accent-on-card is 3.48:1, under the
// 4.5:1 body bar, while accent-on-panel clears it. The channel-colour block (M5's per-vital
// numeral colours) is gone — the kit has no per-vital colour, a deliberate reversal, not a loss;
// its cases are deleted below rather than carried forward.
import palettes from "../src/theme/palette";
import type { ThemeKey } from "../src/theme/ThemeContext";
import { tintFor } from "../src/theme/tint";

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) throw new Error(`not a #rrggbb string: ${hex}`);
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Relative luminance from an already-normalised (0..1) rgb triple — the shared math underneath
 *  both `luminance` (an opaque colour string) and the composited pairs below (a blended one). */
function luminanceRgb01([r, g, b]: [number, number, number]): number {
  const gamma = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * gamma(r) + 0.7152 * gamma(g) + 0.0722 * gamma(b);
}

function luminance(color: string): number {
  return luminanceRgb01(hexToRgb(color));
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
  const [br, bg, bb] = hexToRgb(bgHex);
  return [fr * a + br * (1 - a), fg * a + bg * (1 - a), fb * a + bb * (1 - a)];
}

/** Contrast of an opaque foreground colour against an already-composited background triple. */
function contrastAgainstComposite(fg: string, compositedBg: [number, number, number]): number {
  return contrastFromLuminance(luminance(fg), luminanceRgb01(compositedBg));
}

const SKINS: ThemeKey[] = ["light", "icu"];

describe("palette contrast (WCAG AA)", () => {
  const body = 4.5;
  // accent is UI chrome (nav-bar fill, chip borders/text at 14px+) — never body text — so it only
  // has to clear the large-text/graphical-object bar, not the 4.5:1 body-text one, EXCEPT where it
  // is used as text on `panel` (the layering law below), which is a real body-text usage.
  const chrome = 3;

  describe.each(SKINS)("%s skin", (skin) => {
    const palette = palettes[skin];

    it.each([
      ["foreground on background", palette.foreground, palette.background],
      ["foreground on card", palette.foreground, palette.card],
      // Task 4: foreground text on `panel` is new to the parameterised suite — StatPill/VitalsRow
      // cell values already rendered this way (M3), but no case covered it. Task 4 adds several
      // more (AlertToast's title/body, ServerSection's text-input value, GuidelineDrawer's close
      // label), so it earns its own arithmetic case rather than staying an untested assumption.
      ["foreground on panel", palette.foreground, palette.panel],
      ["stale on card", palette.clinical.stale, palette.card],
      ["stale on background", palette.clinical.stale, palette.background],
      // Task 4: SettingsPanel's ghost pill (ThemeSection's unselected skin chip, every unselected
      // role/speed/threshold chip) puts `clinical.stale` text on `panel` for the first time.
      ["stale on panel", palette.clinical.stale, palette.panel],
    ])("%s clears 4.5:1", (_name, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(body);
    });

    // Severity as TEXT/border colour (`clinical.critical/warning/safe`) — the kit's layering law
    // applies here too: these render on `panel` (or straight on `background`), never on the wash.
    it.each([
      ["critical on panel", palette.clinical.critical, palette.panel],
      ["critical on background", palette.clinical.critical, palette.background],
      ["warning on panel", palette.clinical.warning, palette.panel],
      ["warning on background", palette.clinical.warning, palette.background],
      ["safe on panel", palette.clinical.safe, palette.panel],
      ["safe on background", palette.clinical.safe, palette.background],
    ])("severity text-variant: %s clears 4.5:1", (_name, fg, bg) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(body);
    });

    // THE LAYERING LAW. Measured directly off the kit's own frames: accent (#2260FF) text on the
    // pale wash (`card`, #CAD6FF) comes out to 3.48:1 — under the 4.5:1 body bar — which is why
    // the kit always gives blue type a white inner panel (`panel`) instead. Both halves are
    // asserted as arithmetic: `panel` must clear the bar the wash cannot, so a future edit that
    // quietly brightens `card` enough to pass would have to update this test, not just eyeball it.
    it("accent on panel clears 4.5:1 (blue text's only legal surface)", () => {
      expect(contrast(palette.accent, palette.panel)).toBeGreaterThanOrEqual(body);
    });

    it("accent on card stays under 4.5:1 (the wash is not a legal surface for blue text)", () => {
      expect(contrast(palette.accent, palette.card)).toBeLessThan(body);
    });

    it("accent on card still clears 3:1 (chrome only — borders, icons, never body text)", () => {
      expect(contrast(palette.accent, palette.card)).toBeGreaterThanOrEqual(chrome);
    });

    it("white icon on solid accent fill clears 3:1 (floating nav bar chrome)", () => {
      expect(contrast("#ffffff", palette.accent)).toBeGreaterThanOrEqual(chrome);
    });

    // Solid severity pills (BedCard's severity pill, ESKALE mini-pill): the fill's own text
    // colour (white for critical/safe, dark ink for warning — see palette.js's sevSolidText
    // comment on why warning can't just take the skin's own `foreground`) painted directly on
    // the fill.
    it.each([
      ["critical", palettes.sevSolidText.critical, palette.sevSolid.critical],
      ["warning", palettes.sevSolidText.warning, palette.sevSolid.warning],
      ["safe", palettes.sevSolidText.safe, palette.sevSolid.safe],
    ])("sevSolid %s: its text colour on its own fill clears 4.5:1", (_name, text, fill) => {
      expect(contrast(text, fill)).toBeGreaterThanOrEqual(body);
    });
  });
});

// The pairs above are solid-on-solid. These are solid-on-*tint* — a severity colour's text,
// painted over that same colour's own tinted-alpha background — and the plain contrast() check
// above cannot see it: it never composites the alpha. This is the pairing that actually renders
// for RiskPill, driven through the real `tintFor` so this file tracks the idiom rather than a
// copy of its numbers. Composited onto `panel`, per the layering law above — not `card`: the wash
// is dark enough itself (unlike the old slate-50 card it replaces) that a text colour tuned only
// to clear `card` solid would fail once its own faint tint sat behind it there too; `panel` is
// where these chips actually render in the kit language.
describe("palette contrast: tinted-chip idiom (composited)", () => {
  const body = 4.5;
  const chrome = 3;

  describe.each(SKINS)("%s skin", (skin) => {
    const palette = palettes[skin];

    it.each([
      ["critical", palette.clinical.critical],
      ["warning", palette.clinical.warning],
      ["safe", palette.clinical.safe],
    ])("riskpill %s text over its own tint, on panel, clears 4.5:1", (_name, fg) => {
      const composited = compositeOver(tintFor(fg, skin), palette.panel);
      expect(contrastAgainstComposite(fg, composited)).toBeGreaterThanOrEqual(body);
    });

    // The chip-row's active "Tümü" state and any other accent-tinted chrome chip: accent text
    // over its own tint, on `background` — chrome bar only (same exception as the solid case).
    it("accent text over its own tint, on background, clears 3:1 (chrome)", () => {
      const composited = compositeOver(tintFor(palette.accent, skin), palette.background);
      expect(contrastAgainstComposite(palette.accent, composited)).toBeGreaterThanOrEqual(chrome);
    });
  });
});
