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
    },
  },
  plugins: [],
};
