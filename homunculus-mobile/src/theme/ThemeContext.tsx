// The runtime switch between the two clinical skins (see src/theme/palette.js). NativeWind v4
// resolves Tailwind colours (bg-background, text-clinical-critical, ...) through CSS variables —
// tailwind.config.js points every colour token at `var(--color-…)` — so swapping skins is a
// matter of setting those variables on a root View via `vars()`. className usage elsewhere in
// the app never has to change.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { vars } from "nativewind";

import { getThemeKey, setThemeKey } from "../store/secureTokens";
import palettes from "./palette";
import type { Tone } from "./tokens";

export type ThemeKey = "icu" | "light";

type Palette = (typeof palettes)["icu"];

export interface Theme {
  key: ThemeKey;
  palette: Palette;
  /** severity/tone -> concrete colour in the ACTIVE skin. "muted" reads clinical.stale. */
  toneColor(tone: Tone): string;
  setTheme(key: ThemeKey): void;
}

function toneColorFor(palette: Palette, tone: Tone): string {
  switch (tone) {
    case "critical":
      return palette.clinical.critical;
    case "warning":
      return palette.clinical.warning;
    case "safe":
      return palette.clinical.safe;
    case "muted":
      return palette.clinical.stale;
  }
}

function cssVarsFor(palette: Palette): Record<string, string> {
  return {
    "--color-background": palette.background,
    "--color-card": palette.card,
    "--color-panel": palette.panel,
    "--color-soft": palette.soft,
    "--color-foreground": palette.foreground,
    "--color-accent": palette.accent,
    "--color-clinical-border": palette.clinical.border,
    "--color-clinical-safe": palette.clinical.safe,
    "--color-clinical-warning": palette.clinical.warning,
    "--color-clinical-critical": palette.clinical.critical,
    "--color-clinical-stale": palette.clinical.stale,
  };
}

// M6: light IS the kit (see src/theme/palette.js's header comment) and becomes the default — the
// night skin is a derived, arithmetic-checked variant, not a separately-approved design.
const DEFAULT_KEY: ThemeKey = "light";

// Tests and any other isolated render of a component (no <ThemeProvider> ancestor) get this
// rather than a thrown error — honesty note: the *app* always mounts ThemeProvider at the root
// (see app/_layout.tsx), so this fallback is never live-authoritative. It exists purely so
// component tests can render RiskPill/MonitorTile/etc. in isolation, as they did before M3,
// without every one of them growing a `<ThemeProvider>` wrapper. It is always the DEFAULT_KEY skin.
const defaultTheme: Theme = {
  key: DEFAULT_KEY,
  palette: palettes[DEFAULT_KEY],
  toneColor: (tone) => toneColorFor(palettes[DEFAULT_KEY], tone),
  setTheme: () => {},
};

const ThemeReactContext = createContext<Theme>(defaultTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<ThemeKey>(DEFAULT_KEY);

  useEffect(() => {
    let cancelled = false;
    void getThemeKey().then((stored) => {
      if (cancelled) return;
      if (stored === "icu" || stored === "light") setKey(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTheme = useCallback((next: ThemeKey) => {
    setKey(next);
    void setThemeKey(next);
  }, []);

  const palette = palettes[key];

  const value = useMemo<Theme>(
    () => ({
      key,
      palette,
      toneColor: (tone: Tone) => toneColorFor(palette, tone),
      setTheme,
    }),
    [key, palette, setTheme],
  );

  return (
    <ThemeReactContext.Provider value={value}>
      <View style={[{ flex: 1, backgroundColor: palette.background }, vars(cssVarsFor(palette))]}>
        {children}
      </View>
    </ThemeReactContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeReactContext);
}
