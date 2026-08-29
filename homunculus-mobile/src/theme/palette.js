// The Homunculus clinical palette — two runtime-switchable skins, translated from the web
// cockpit's `dashboard/src/clinicalTheme.js`. CommonJS because tailwind.config.js requires it,
// and the palette must not exist twice — a colour that drifts between config and code is a bug
// that only shows up on a ward at night.
//
// Severity text-variants differ per skin where the raw web chip colours fail WCAG AA as TEXT
// (arithmetic in __tests__/contrast.test.ts decides, not taste).
module.exports = {
  icu: {
    background: "#020617", // slate-950
    card: "#0f172a", // slate-900
    foreground: "#f1f5f9", // slate-100
    accent: "#0891b2", // brand teal — branding moments, never severity
    clinical: {
      border: "#1e293b", // slate-800
      safe: "#10b981", // emerald-500
      warning: "#f59e0b", // amber-500
      critical: "#f87171", // red-400 (red-500 measures 4.3:1 on slate-900 — under AA)
      stale: "#94a3b8", // slate-400
    },
  },
  light: {
    background: "#f1f5f9", // slate-100
    card: "#ffffff",
    foreground: "#0f172a", // slate-900
    accent: "#0891b2",
    clinical: {
      border: "#e2e8f0", // slate-200
      safe: "#047857", // emerald-700
      warning: "#b45309", // amber-700
      // Spec table says red-600 (#dc2626). Measured against `background` (#f1f5f9) it comes out
      // to 4.41:1 — under the 4.5:1 AA body bar (against `card`/white it clears easily, at
      // 4.83:1, which is presumably what the spec table checked). Same class of miss as icu's
      // critical below: darkened slightly, off the exact swatch, to clear AA on both surfaces
      // (4.70:1 on background, 5.15:1 on card) while staying red-600-adjacent.
      critical: "#d61f1f",
      stale: "#64748b", // slate-500
    },
  },
};
