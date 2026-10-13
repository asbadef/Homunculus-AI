import { tailwindColors, tailwindFontSizes } from "./src/live/theme/tokens.js";

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // The live UI (src/live): one class per CSS variable in src/live/theme/tokens.css.
        ...tailwindColors(),
      },
      fontFamily: {
        // The page's own face (index.css's <body>, so LoadFailed.jsx too); the live UI uses the
        // three below.
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
