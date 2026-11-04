import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { tokens, ThemeColors, ThemeMode } from "./tokens";

const STORAGE_KEY = "hm-theme";
const BIG_KEY = "hm-bigtext";
const CONTRAST_KEY = "hm-contrast";

type ThemeCtx = {
  t: ThemeColors;
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
  scale: number; // text size multiplier (accessibility)
  bigText: boolean;
  contrast: boolean;
  toggleBigText: () => void;
  toggleContrast: () => void;
};

const Ctx = createContext<ThemeCtx>({
  t: tokens.light, mode: "light", toggle: () => {}, setMode: () => {},
  scale: 1, bigText: false, contrast: false, toggleBigText: () => {}, toggleContrast: () => {},
});

// Stronger foreground / borders for the high-contrast accessibility mode.
function withContrast(base: ThemeColors, mode: ThemeMode): ThemeColors {
  return mode === "dark"
    ? { ...base, fg: "#ffffff", muted: "#d4ddeb", faint: "#9fb0c3", border: "#4b5b74" }
    : { ...base, fg: "#000000", muted: "#334155", faint: "#475569", border: "#8aa0b5" };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light"); // default light
  const [bigText, setBigText] = useState(false);
  const [contrast, setContrast] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => { if (v === "light" || v === "dark") setModeState(v); }).catch(() => {});
    AsyncStorage.getItem(BIG_KEY).then((v) => { if (v === "1") setBigText(true); }).catch(() => {});
    AsyncStorage.getItem(CONTRAST_KEY).then((v) => { if (v === "1") setContrast(true); }).catch(() => {});
  }, []);

  function setMode(m: ThemeMode) {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }
  function toggle() {
    setMode(mode === "dark" ? "light" : "dark");
  }
  function toggleBigText() {
    setBigText((v) => { AsyncStorage.setItem(BIG_KEY, v ? "0" : "1").catch(() => {}); return !v; });
  }
  function toggleContrast() {
    setContrast((v) => { AsyncStorage.setItem(CONTRAST_KEY, v ? "0" : "1").catch(() => {}); return !v; });
  }

  const base = tokens[mode];
  const t = contrast ? withContrast(base, mode) : base;
  const scale = bigText ? 1.18 : 1;

  return (
    <Ctx.Provider value={{ t, mode, toggle, setMode, scale, bigText, contrast, toggleBigText, toggleContrast }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
