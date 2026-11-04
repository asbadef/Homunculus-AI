import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LANGS, Lang, DEFAULT_LANG, translate } from "./core";

export { LANGS, DEFAULT_LANG, translate };
export type { Lang };

const STORAGE_KEY = "hm-lang";

type I18nCtx = { t: (key: string) => string; lang: Lang; setLang: (l: Lang) => void };
const Ctx = createContext<I18nCtx>({ t: (k) => k, lang: DEFAULT_LANG, setLang: () => {} });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v && (LANGS as readonly string[]).includes(v)) setLangState(v as Lang);
      })
      .catch(() => {});
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  }

  return <Ctx.Provider value={{ t: (k) => translate(lang, k), lang, setLang }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
