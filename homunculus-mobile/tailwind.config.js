// The palette itself now lives in src/theme/palette.js as two skins (icu/light); Tailwind's
// colour tokens here just name the CSS variables ThemeProvider sets on the root subtree via
// NativeWind's vars() — so className usage (bg-background, text-clinical-critical, ...) never
// has to change when the active skin does.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        card: "var(--color-card)",
        // M6: the kit's white inner panel (blue text lives ONLY here — see palette.js) and its
        // chip/icon-circle fill.
        panel: "var(--color-panel)",
        soft: "var(--color-soft)",
        foreground: "var(--color-foreground)",
        accent: "var(--color-accent)",
        clinical: {
          border: "var(--color-clinical-border)",
          safe: "var(--color-clinical-safe)",
          warning: "var(--color-clinical-warning)",
          critical: "var(--color-clinical-critical)",
          stale: "var(--color-clinical-stale)",
        },
      },
      fontFamily: {
        // M6: League Spartan is the kit's face. SemiBold is the default weight everywhere;
        // heavier weights (700/800) are applied via explicit fontFamily styles where a component
        // asks for them. system-ui is the fallback for the brief window before the font loads (or
        // under any environment that never loads it, e.g. a headless export).
        sans: ["LeagueSpartan_600SemiBold", "system-ui"],
      },
    },
  },
  plugins: [],
};
