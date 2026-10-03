// src/live/theme/ThemeProvider.jsx — the live UI's colour theme and text size.
//
// Two themes, as in the prototype: "gece" (dark, the default — an ICU at night) and "gun"
// (daylight). The prototype's mobile "automatic" theme (20:00–08:00 dark) is not built: the web
// prototype's own settings offer only these two. Size "buyuk" scales all text by 1.12 (--fs).
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { readPref, writePref } from "../prefs.js";

export const THEMES = ["gece", "gun"];
export const SIZES = ["normal", "buyuk"];
export const DEFAULT_THEME = "gece";
export const DEFAULT_SIZE = "normal";

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  size: DEFAULT_SIZE,
  setTheme: () => {},
  setSize: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => readPref("theme", THEMES, DEFAULT_THEME));
  const [size, setSizeState] = useState(() => readPref("size", SIZES, DEFAULT_SIZE));

  // On <html>, not on a wrapper: dialogs and toasts render in a portal under <body> and must take
  // the same theme. A layout effect, so the first paint already has the right colours.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.size = size;
  }, [size]);
  // On unmount, take them off again: G1-07 mounts the new shell beside the old app in one tab, and
  // the old app's page must not keep the live UI's theme.
  useLayoutEffect(() => () => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.size;
  }, []);

  const setTheme = useCallback((value) => {
    if (!THEMES.includes(value)) return;
    setThemeState(value);
    writePref("theme", value);
  }, []);
  const setSize = useCallback((value) => {
    if (!SIZES.includes(value)) return;
    setSizeState(value);
    writePref("size", value);
  }, []);

  const value = useMemo(() => ({ theme, size, setTheme, setSize }), [theme, size, setTheme, setSize]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
