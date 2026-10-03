import { tailwindColors, tailwindFontSizes } from "./src/live/theme/tokens.js";

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" },
        sev: { info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444" },
        // The live UI (src/live): one class per CSS variable in src/live/theme/tokens.css.
        ...tailwindColors(),
      },
      fontFamily: {
        sans: ["'Figtree Variable'", "system-ui", "sans-serif"],
        // The live UI's three faces; the stacks themselves are in tokens.css.
        text: "var(--font-text)",
        display: "var(--font-display)",
        data: "var(--font-data)",
      },
      fontSize: tailwindFontSizes(),
      borderRadius: { ctl: "10px", box: "14px", dlg: "18px" },
      boxShadow: { pop: "var(--shadow)" },
    },
  },
  plugins: [],
};
