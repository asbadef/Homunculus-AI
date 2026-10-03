// src/live/i18n/langs.js — the live UI's four languages.
//
// Roadmap D2: Azerbaijani is the default; the user can pick Turkish, Russian or English and the
// choice is kept in the browser. There is no locale detection: the pilot's ward PCs run an
// English-locale browser, and the default is a product decision, not the browser's.
// Turkish is the source language: dictionaries are written in Turkish first, and a key missing
// from another language shows its Turkish text.
export const LANGS = [
  { code: "az", native: "Azərbaycan" },
  { code: "tr", native: "Türkçe" },
  { code: "ru", native: "Русский" },
  { code: "en", native: "English" },
];
export const LANG_CODES = LANGS.map((l) => l.code);
export const DEFAULT_LANG = "az";
export const SOURCE_LANG = "tr";
