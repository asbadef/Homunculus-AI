// tailwind.config.js must reach every live token by class, must not change one of Tailwind's own
// classes under a component's feet, and keeps nothing of the old app's (removed in G1-16) but the
// page's sans.
import { describe, it, expect } from "vitest";
import defaultColors from "tailwindcss/colors";
import defaultTheme from "tailwindcss/defaultTheme";
import config from "../../../tailwind.config.js";
import { COLOR_TOKENS, TYPE_SIZES, kebab } from "./tokens.js";

const extend = config.theme.extend;

// Every key Tailwind ships in the sections this config extends. A key of the same name in
// `extend` would silently change one of Tailwind's own classes (text-sm, rounded-lg, shadow-md,
// font-mono, bg-white…) for every component that uses it. colors is a function in the default theme; the palette module adds the
// names it keeps for compatibility (lightBlue, warmGray…).
const DEFAULT_KEYS = {
  colors: [...new Set([...Object.keys(defaultTheme.colors({ colors: defaultColors })), ...Object.keys(defaultColors)])],
  fontFamily: Object.keys(defaultTheme.fontFamily),
  fontSize: Object.keys(defaultTheme.fontSize),
  borderRadius: Object.keys(defaultTheme.borderRadius),
  boxShadow: Object.keys(defaultTheme.boxShadow),
};
// The one deliberate shadow: the page's sans (Figtree first). index.css gives it to <body>, which
// is what LoadFailed.jsx is drawn in when the live UI's own stylesheet could not load.
const INTENTIONAL = { fontFamily: ["sans"] };

const shadowed = (ext, section) => Object.keys(ext[section] || {}).filter((k) => DEFAULT_KEYS[section].includes(k));

describe("tailwind.config.js and the live tokens", () => {
  it("maps every colour token to its CSS variable", () => {
    for (const name of COLOR_TOKENS) expect(extend.colors[kebab(name)], name).toBe(`var(--${name})`);
  });

  // The old app's palette (`brand`, `sev`) and its class-switched dark mode went with it (G1-16):
  // a `bg-sev-critical` written into a live component would otherwise still compile, to a colour
  // no theme controls. The sans stays — it is the page's, not the old app's.
  it("keeps the page's sans and nothing else of the old app's", () => {
    expect(extend.fontFamily.sans).toEqual(["'Figtree Variable'", "system-ui", "sans-serif"]);
    expect(extend.colors.brand).toBeUndefined();
    expect(extend.colors.sev).toBeUndefined();
    expect(config.darkMode).toBeUndefined();
  });

  it("extends only the sections checked for shadowing below", () => {
    expect(Object.keys(extend).sort()).toEqual(Object.keys(DEFAULT_KEYS).sort());
  });

  it("reads Tailwind's own keys for each of them", () => {
    for (const [section, keys] of Object.entries(DEFAULT_KEYS)) expect(keys.length, section).toBeGreaterThan(2);
    expect(DEFAULT_KEYS.colors).toEqual(expect.arrayContaining(["white", "slate", "transparent", "current"]));
  });

  it.each(Object.keys(DEFAULT_KEYS))("%s: no key shadows a Tailwind default (but the page's sans)", (section) => {
    expect(shadowed(extend, section)).toEqual(INTENTIONAL[section] || []);
  });

  it("the shadow check sees a key that would change a default class", () => {
    const fake = { colors: { white: "x", card: "y" }, fontSize: { sm: "1px" }, borderRadius: { lg: "1px" }, boxShadow: { md: "x" } };
    expect(shadowed(fake, "colors")).toEqual(["white"]);
    expect(shadowed(fake, "fontSize")).toEqual(["sm"]);
    expect(shadowed(fake, "borderRadius")).toEqual(["lg"]);
    expect(shadowed(fake, "boxShadow")).toEqual(["md"]);
  });

  it("makes every type size the prototype's pixel size times --fs", () => {
    expect(Object.keys(extend.fontSize).sort()).toEqual([...TYPE_SIZES].sort());
    for (const px of TYPE_SIZES) expect(extend.fontSize[px]).toBe(`calc(${px}px * var(--fs))`);
  });

  it("points the three faces at the token stacks", () => {
    expect(extend.fontFamily.text).toBe("var(--font-text)");
    expect(extend.fontFamily.display).toBe("var(--font-display)");
    expect(extend.fontFamily.data).toBe("var(--font-data)");
  });
});
