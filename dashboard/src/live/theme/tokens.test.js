// WCAG AA for the live UI's palette, enforced as arithmetic rather than a review note (the mobile
// app's precedent: homunculus-mobile/__tests__/contrast.test.ts). Each pair below is one that
// actually renders as text — or, at 3:1, a focus outline or severity stripe — and says where.
// Body text needs 4.5:1. Every text pair is held to 4.5:1, large or not: the pills and badges
// that carry severity are 10–12 px.
//
// Not measured on purpose: --line/--line2 (borders; the input border is 1.5:1 in both themes —
// recorded in the plan as an open design question), --attLine, the shadows.
import { describe, it, expect } from "vitest";
import { COLOR_TOKENS } from "./tokens.js";
import { rule, THEMES } from "./tokensCss.testutil.js";

function parse(value) {
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (m) return { rgb: [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255), a: 1 };
  m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (m) return { rgb: [m[1], m[2], m[3]].map((n) => Number(n) / 255), a: Number(m[4]) };
  throw new Error(`not a colour this test reads: ${value}`);
}

/** An opaque token. A translucent one must say what it sits on (over/tint). */
function solid(theme, name) {
  const c = parse(THEMES[theme][name]);
  if (c.a !== 1) throw new Error(`--${name} is translucent in ${theme}: measure it over a surface`);
  return c.rgb;
}

/** A token as it renders over an opaque surface token (alpha compositing). */
function over(theme, name, ground) {
  const c = parse(THEMES[theme][name]);
  const g = solid(theme, ground);
  return c.rgb.map((v, i) => v * c.a + g[i] * (1 - c.a));
}

/** color-mix(in srgb, var(--name) <share>, transparent) — the pill tint — over a surface. */
function tint(theme, name, share, ground) {
  const c = solid(theme, name);
  const g = solid(theme, ground);
  return c.map((v, i) => v * share + g[i] * (1 - share));
}

const luminance = (rgb) => {
  const f = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const BODY = 4.5;
const UI = 3;
const SURFACES = ["page", "app", "rail", "card", "card2"];
const SEVERITY = ["crit", "high", "mid", "low", "ok"];

describe.each(["gece", "gun"])("%s theme: contrast", (theme) => {
  const s = (name) => solid(theme, name);

  it.each(SURFACES)("ink and mute text clear 4.5:1 on %s", (bg) => {
    expect(ratio(s("ink"), s(bg))).toBeGreaterThanOrEqual(BODY);
    expect(ratio(s("mute"), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["page", "app", "card", "card2"])("primary text (links, info notes) clears 4.5:1 on %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it("info note: pri text on priSoft over a card clears 4.5:1", () => {
    expect(ratio(s("pri"), over(theme, "priSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each([
    ["onpri", "pri", "primary button, chosen segment"],
    ["oncrit", "crit", "danger button"],
    ["onmid", "mid", "tab count badge"],
  ])("%s on %s (%s) clears 4.5:1", (fg, bg) => {
    expect(ratio(s(fg), s(bg))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["card", "page"])("warning note and tag: attInk on att over %s clears 4.5:1", (ground) => {
    expect(ratio(s("attInk"), over(theme, "att", ground))).toBeGreaterThanOrEqual(BODY);
  });

  it("critical tag: critInk on critSoft over a card clears 4.5:1", () => {
    expect(ratio(s("critInk"), over(theme, "critSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(SEVERITY.flatMap((sev) => ["page", "app", "card", "card2"].map((bg) => [sev, bg])))(
    "%s ink (timers, bed numbers) clears 4.5:1 on %s",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), s(bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  it.each(SEVERITY.flatMap((sev) => ["card", "card2"].map((bg) => [sev, bg])))(
    "%s status pill: ink on its 14%% tint over %s clears 4.5:1",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), tint(theme, sev, 0.14, bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  it.each(["v-hr", "v-map", "v-spo", "v-rr", "v-t"])("vital %s clears 4.5:1 on a card", (v) => {
    expect(ratio(s(v), s("card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(["page", "card", "card2"])("focus outline (pri) clears 3:1 against %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(UI);
  });

  it.each(SEVERITY)("%s fill (stripe, bar, dot) clears 3:1 against a card", (sev) => {
    expect(ratio(s(sev), s("card"))).toBeGreaterThanOrEqual(UI);
  });
});

describe("token registry", () => {
  it.each(["gece", "gun"])("%s declares every named colour, and only those", (theme) => {
    const declared = Object.keys(THEMES[theme]).filter((name) => name !== "shadow").sort();
    expect(declared).toEqual([...COLOR_TOKENS].sort());
    for (const name of COLOR_TOKENS) expect(() => parse(THEMES[theme][name]), name).not.toThrow();
  });

  it("text size: --fs is 1, and 1.12 under data-size=buyuk", () => {
    expect(rule(":root").fs).toBe("1");
    expect(rule('[data-size="buyuk"]').fs).toBe("1.12");
  });
});
