// tailwind.config.js must reach every live token by class, and must not change a class the old
// app (ClinicalDemo and friends, removed in G1-16) already uses.
import { describe, it, expect } from "vitest";
import defaultColors from "tailwindcss/colors";
import config from "../../../tailwind.config.js";
import { COLOR_TOKENS, TYPE_SIZES, kebab } from "./tokens.js";

const extend = config.theme.extend;

describe("tailwind.config.js and the live tokens", () => {
  it("maps every colour token to its CSS variable", () => {
    for (const name of COLOR_TOKENS) expect(extend.colors[kebab(name)], name).toBe(`var(--${name})`);
  });

  it("keeps the old app's brand, sev and sans exactly as they were", () => {
    expect(extend.colors.brand).toEqual({ DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" });
    expect(extend.colors.sev).toEqual({
      info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444",
    });
    expect(extend.fontFamily.sans).toEqual(["'Figtree Variable'", "system-ui", "sans-serif"]);
  });

  it("adds no key that would shadow a Tailwind default the old app relies on", () => {
    const palette = Object.keys(defaultColors);
    for (const key of Object.keys(extend.colors)) expect(palette, key).not.toContain(key);
    expect(extend.fontFamily).not.toHaveProperty("mono");
    for (const key of ["xs", "sm", "base", "lg", "xl", "2xl"]) expect(extend.fontSize).not.toHaveProperty(key);
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
