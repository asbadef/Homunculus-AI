import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { tokens, ThemeColors, ThemeMode } from "./tokens";

const STORAGE_KEY = "hm-theme";

type ThemeCtx = { t: ThemeColors; mode: ThemeMode; toggle: () => void; setMode: (m: ThemeMode) => void };

const Ctx = createContext<ThemeCtx>({ t: tokens.light, mode: "light", toggle: () => {}, setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light"); // default light

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "light" || v === "dark") setModeState(v);
      })
      .catch(() => {});
  }, []);

  function setMode(m: ThemeMode) {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }
  function toggle() {
    setMode(mode === "dark" ? "light" : "dark");
  }

  return <Ctx.Provider value={{ t: tokens[mode], mode, toggle, setMode }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
