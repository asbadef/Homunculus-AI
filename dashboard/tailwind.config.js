export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" },
        sev: { info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444" },
      },
      fontFamily: { sans: ["'Figtree Variable'", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
