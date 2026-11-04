// Theme tokens ported from dashboard/src/clinicalTheme.js (light = clean medical,
// dark = "icu/gecə" slate family). Default theme is light; user toggles dark.
// Brand turquoise #0891b2 keeps the patient app in the same family as the panel.

export type ThemeColors = {
  bg: string;
  surface: string;
  surface2: string;
  fg: string;
  muted: string;
  faint: string;
  border: string;
  brand: string;
  brandInk: string;
  brandSoft: string;
  ok: string;
  wait: string;
  info: string;
  danger: string;
};

export const tokens: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    bg: "#f5f8f9",
    surface: "#ffffff",
    surface2: "#eef4f6",
    fg: "#0f172a",
    muted: "#64748b",
    faint: "#94a3b8",
    border: "#e2e8f0",
    brand: "#0891b2",
    brandInk: "#ffffff",
    brandSoft: "#e0f4f8",
    ok: "#10b981",
    wait: "#f59e0b",
    info: "#0891b2",
    danger: "#ef4444",
  },
  dark: {
    bg: "#0b1220",
    surface: "#111c2e",
    surface2: "#0f1a2a",
    fg: "#f1f5f9",
    muted: "#94a3b8",
    faint: "#64748b",
    border: "#1e293b",
    brand: "#22d3ee",
    brandInk: "#04232b",
    brandSoft: "#0e2a33",
    ok: "#34d399",
    wait: "#fbbf24",
    info: "#22d3ee",
    danger: "#f87171",
  },
};

// Shared layout scale (not themed).
export const layout = {
  radius: 18,
  radiusSm: 13,
  gap: 11,
  pad: 16,
  fontFamily: "Figtree_400Regular",
  fontMedium: "Figtree_500Medium",
  fontSemiBold: "Figtree_600SemiBold",
  fontBold: "Figtree_700Bold",
  fontExtraBold: "Figtree_800ExtraBold",
};

export type ThemeMode = "light" | "dark";
