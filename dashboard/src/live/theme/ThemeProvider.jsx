// src/live/theme/ThemeProvider.jsx — the live UI's colour theme and text size.
//
// Two themes, as in the prototype: "gece" (dark, the default — an ICU at night) and "gun"
// (daylight). The prototype's mobile "automatic" theme (20:00–08:00 dark) is not built: the web
// prototype's own settings offer only these two. Size "buyuk" scales all text by 1.12 (--fs).
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";

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

  // Record what <html> had before (usually nothing) and put it back on unmount: the old app may run
  // in the same tab (?eski=1, until G1-16) and must not keep the live UI's theme, and a page that
  // had set its own value keeps it. A layout effect declared BEFORE the ones that write: it runs
  // first when mounting, and when an instance is replaced in one commit (a key change, hot reload)
  // the old one's cleanup has already restored the page's value before this one reads it.
  useLayoutEffect(() => {
    const before = {
      theme: document.documentElement.getAttribute("data-theme"),
      size: document.documentElement.getAttribute("data-size"),
    };
    return () => {
      restoreAttribute("data-theme", before.theme);
      restoreAttribute("data-size", before.size);
    };
  }, []);

  // On <html>, not on a wrapper: dialogs and toasts render in a portal under <body> and must take
  // the same theme. A layout effect, so the first paint already has the right colours.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useLayoutEffect(() => {
    document.documentElement.dataset.size = size;
  }, [size]);

  // Another tab of this browser changed it: follow, without writing it back.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === `${PREF_PREFIX}theme` && THEMES.includes(event.newValue)) setThemeState(event.newValue);
      if (event.key === `${PREF_PREFIX}size` && SIZES.includes(event.newValue)) setSizeState(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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

/** Put an attribute of <html> back to `value`, or remove it when it had none. */
export function restoreAttribute(name, value) {
  if (value === null || value === undefined) document.documentElement.removeAttribute(name);
  else document.documentElement.setAttribute(name, value);
}
