// WCAG AA for the live UI's palette, enforced as arithmetic rather than a review note (the mobile
// app's precedent: homunculus-mobile/__tests__/contrast.test.ts). Each pair below is one that
// actually renders as text — or, at 3:1, a focus outline or severity stripe — and says where.
// Body text needs 4.5:1. Every text pair is held to 4.5:1, large or not: the pills and badges
// that carry severity are 10–12 px.
//
// Not measured on purpose: --line/--line2 (borders; the input border is ~1.4-1.6:1 on a card in
// both themes — an open user decision in the roadmap's "Kullanıcı kararları"), --attLine, the
// shadows, --scrim (a dimmed backdrop, not a ground for text).
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

/**
 * A token as it renders over an opaque surface token (alpha compositing). Several translucent
 * layers may be given — a name or a list, bottom first: ["band-mid", "band-n"] is the patient's
 * own normal laid over a NEWS2 row, both over the ground.
 */
function over(theme, layers, ground) {
  return [].concat(layers).reduce((under, name) => {
    const c = parse(THEMES[theme][name]);
    return c.rgb.map((v, i) => v * c.a + under[i] * (1 - c.a));
  }, solid(theme, ground));
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
// Read from the registry, so a new vital channel or a new band tint is measured without anyone
// remembering to add it here.
const VITALS = COLOR_TOKENS.filter((name) => name.startsWith("v-"));
const BANDS = COLOR_TOKENS.filter((name) => name.startsWith("band-"));
// The patient's own normal (band-n) can lie inside a scored NEWS2 row: it is then composited over
// that row's tint (bottom first), the thinnest ground a line is ever drawn on.
const STACKED = BANDS.filter((name) => name !== "band-n").map((name) => `${name} + band-n`);
// The mini chart sits on a card; the big chart in the kit Modal, whose panel is bg-app (Modal.jsx).
// card2 and page are measured too, as the severity fills are: a chart may be moved there.
const CHART_GROUNDS = ["card", "card2", "page", "app"];

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

  it.each(["card", "card2", "page", "app"])(
    "warning note, tag and attention pill: attInk on att over %s clears 4.5:1",
    (ground) => {
      expect(ratio(s("attInk"), over(theme, "att", ground))).toBeGreaterThanOrEqual(BODY);
    },
  );

  it("critical tag: critInk on critSoft over a card clears 4.5:1", () => {
    expect(ratio(s("critInk"), over(theme, "critSoft", "card"))).toBeGreaterThanOrEqual(BODY);
  });

  it.each(SEVERITY.flatMap((sev) => ["page", "app", "card", "card2"].map((bg) => [sev, bg])))(
    "%s ink (timers, bed numbers) clears 4.5:1 on %s",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), s(bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  // The tint is translucent, so the pill's ground counts: a card, a card2 row, and — in a page
  // header or a dialog — the page or the app frame.
  it.each(SEVERITY.flatMap((sev) => ["card", "card2", "page", "app"].map((bg) => [sev, bg])))(
    "%s status pill: ink on its 14%% tint over %s clears 4.5:1",
    (sev, bg) => {
      expect(ratio(s(`${sev}Ink`), tint(theme, sev, 0.14, bg))).toBeGreaterThanOrEqual(BODY);
    },
  );

  // On a card only. On card2 Gun's v-map (4.38) and v-spo (4.46) fall under 4.5:1: recorded in the
  // roadmap for G1-09/G1-11, which decide where vitals sit.
  it.each(VITALS)("vital %s clears 4.5:1 on a card", (v) => {
    expect(ratio(s(v), s("card"))).toBeGreaterThanOrEqual(BODY);
  });

  // The focus outline (ui/focus.js) sits 2 px outside a control, on whatever ground surrounds it:
  // any surface — the rail holds the G1-07 sidebar's links, card2 input rows and table headers,
  // the app frame dialogs — and the tinted grounds a control can sit in, measured over a card: a
  // warning note or attention card (att), a critical tag's ground (critSoft), an info note
  // (priSoft).
  it.each(SURFACES)("focus outline (pri) clears 3:1 against %s", (bg) => {
    expect(ratio(s("pri"), s(bg))).toBeGreaterThanOrEqual(UI);
  });

  it.each(["att", "critSoft", "priSoft"])("focus outline (pri) clears 3:1 against %s over a card", (tinted) => {
    expect(ratio(s("pri"), over(theme, tinted, "card"))).toBeGreaterThanOrEqual(UI);
  });

  // The top bar's "may be out of date" marks (G1-07): the bell's and the unit chip's amber ring
  // and dot (mid), and the grey dot that means "cannot know" (mute). They sit on the RAIL, which
  // the severity fills below are not measured against — and they are the only thing that says, at
  // a glance, that what the bell shows may be stale.
  it.each(["mid", "mute"])("the top bar's %s ring and dot clear 3:1 against the rail", (name) => {
    expect(ratio(s(name), s("rail"))).toBeGreaterThanOrEqual(UI);
  });

  // Group 2's trend charts (screens/patient/trends/): a vital's dots and dashed connectors are drawn
  // over a band tint — a NEWS2 row scoring 1–2 (band-mid) or 3 (band-crit), or the patient's own
  // normal (band-n) — on a card (the mini chart) or on the dialog's app background (the big chart).
  // A line is a graphic, held to 3:1, over every tint it can cross, on every ground it is drawn on.
  // (The prototype drew MAP at reduced opacity; at .55–.70 that measured 2.17–3.20:1 over the
  // tints, so the charts draw MAP at full colour with hollow dots instead.)
  it.each(VITALS.flatMap((v) => BANDS.flatMap((b) => CHART_GROUNDS.map((g) => [v, b, g]))))(
    "chart: the %s line clears 3:1 over the %s tint on %s",
    (vital, band, ground) => {
      expect(ratio(s(vital), over(theme, band, ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // Where the patient's own normal lies inside a scored row, band-n is laid over band-mid or
  // band-crit: two translucent layers on the ground, the thinnest margins in this set.
  it.each(VITALS.flatMap((v) => STACKED.flatMap((b) => CHART_GROUNDS.map((g) => [v, b, g]))))(
    "chart: the %s line clears 3:1 over the stacked %s tints on %s",
    (vital, stack, ground) => {
      expect(ratio(s(vital), over(theme, stack.split(" + "), ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // The ▲ alarm and ◆ antibiotic marks sit in their own lane under the plot — on the card in the
  // mini chart, on the dialog's app background in the big one — never over a band.
  it.each(["crit", "pri"].flatMap((name) => ["card", "app"].map((g) => [name, g])))(
    "chart: the %s marker clears 3:1 on %s",
    (name, ground) => {
      expect(ratio(s(name), s(ground))).toBeGreaterThanOrEqual(UI);
    },
  );

  // A bed card's stripe sits on the card, a dot or bar in a card2 row (G1-09), a stripe on the
  // page or the app frame (G1-07): each ground is held to 3:1.
  it.each(SEVERITY.flatMap((sev) => ["card", "card2", "page", "app"].map((bg) => [sev, bg])))(
    "%s fill (stripe, bar, dot) clears 3:1 against %s",
    (sev, bg) => {
      expect(ratio(s(sev), s(bg))).toBeGreaterThanOrEqual(UI);
    },
  );
});

// The sign-in hero and the lock screen are always dark (data-theme="gece" on their roots) and lie
// on a radial gradient from color-mix(in srgb, var(--pri) 25%, var(--page)) to the page colour:
// their text is held to 4.5:1 at the gradient's lightest point, and the primary icons to 3:1.
describe("the dark gradient of the sign-in hero and the lock screen (Gece)", () => {
  const glow = tint("gece", "pri", 0.25, "page");
  it.each(["ink", "mute"])("%s clears 4.5:1 on the gradient's lightest point", (name) => {
    expect(ratio(solid("gece", name), glow)).toBeGreaterThanOrEqual(BODY);
  });
  // The hero's pill is ink on priSoft: pri text there would be 4.09:1.
  it("pri (icons) clears 3:1 there, and the pill's ink 4.5:1 on priSoft over it", () => {
    expect(ratio(solid("gece", "pri"), glow)).toBeGreaterThanOrEqual(UI);
    const pill = parse(THEMES.gece.priSoft);
    const ground = pill.rgb.map((v, i) => v * pill.a + glow[i] * (1 - pill.a));
    expect(ratio(solid("gece", "ink"), ground)).toBeGreaterThanOrEqual(BODY);
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
