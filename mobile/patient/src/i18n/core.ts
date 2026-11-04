// Pure i18n logic — no React Native imports, so it is unit-testable in plain Jest.
import az from "./az";
import tr from "./tr";
import ru from "./ru";
import en from "./en";

export const LANGS = ["az", "tr", "ru", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "az";

export const DICTS: Record<Lang, Record<string, string>> = { az, tr, ru, en };

// Returns the key itself when a translation is missing, so a gap is visible in the UI.
export function translate(lang: Lang, key: string): string {
  return DICTS[lang]?.[key] ?? DICTS[DEFAULT_LANG][key] ?? key;
}
