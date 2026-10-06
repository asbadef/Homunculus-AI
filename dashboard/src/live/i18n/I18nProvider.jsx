// src/live/i18n/I18nProvider.jsx — the live UI's language: provider and hook.
//
// const { t, lang, setLang, langs } = useI18n();  t("common.close"), t("risk.unknown", { value })
// The language opens as stored in this browser, else Azerbaijani (roadmap D2). Switching stores
// the choice (prefs.js: storage may be refused, the UI still switches) and sets <html lang>, which
// screen readers use to pick a voice and CSS text-transform uses for İ/ı when upper-casing.
// Outside a provider useI18n() speaks Azerbaijani and cannot switch.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";
import { restoreAttribute } from "../theme/ThemeProvider.jsx";
import { DEFAULT_LANG, LANGS, LANG_CODES } from "./langs.js";
import { DICTIONARIES } from "./catalog.js";
import { createTranslator } from "./translate.js";

const warned = new Set();
function warnMissing({ key, lang, found }) {
  if (!import.meta.env.DEV) return;
  const id = `${lang}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[i18n] "${key}" has no ${lang} text — showing ${found ? `the ${found} text` : "the key"}.`);
}

const I18nContext = createContext({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: createTranslator(DEFAULT_LANG, DICTIONARIES, warnMissing),
  langs: LANGS,
});

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => readPref("lang", LANG_CODES, DEFAULT_LANG));

  // Record <html lang> and give it back as it was on unmount (the old app sets its own). Declared
  // before the effect that writes it; see ThemeProvider for why that order matters.
  useLayoutEffect(() => {
    const before = document.documentElement.getAttribute("lang");
    return () => restoreAttribute("lang", before);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  // Another tab of this browser switched language: follow, without writing it back.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === `${PREF_PREFIX}lang` && LANG_CODES.includes(event.newValue)) setLangState(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLang = useCallback((code) => {
    if (!LANG_CODES.includes(code)) return;
    setLangState(code);
    writePref("lang", code);
  }, []);

  const t = useMemo(() => createTranslator(lang, DICTIONARIES, warnMissing), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, langs: LANGS }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
