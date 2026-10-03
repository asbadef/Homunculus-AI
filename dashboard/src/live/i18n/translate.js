// src/live/i18n/translate.js — key -> text, for one language. Pure; the React side is I18nProvider.
//
// t(key, vars): the language's own text; else the Turkish source text; else the key itself —
// and each fallback is reported through onMissing, so a gap is visible in development instead
// of silently shipping Turkish to an Azerbaijani ward.
//
// Only keys are translated. Variables are inserted exactly as given and never looked up: a
// patient's name, a bed, a unit name or a value from the engine is data, and data is never
// translated (the prototype's rule; its DOM-rewriting ceviri.js layer is not ported).
import { DEFAULT_LANG, LANG_CODES, SOURCE_LANG } from "./langs.js";

export function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

export function createTranslator(lang, dictionaries, onMissing) {
  const code = LANG_CODES.includes(lang) ? lang : DEFAULT_LANG;
  const own = dictionaries[code] || {};
  const source = dictionaries[SOURCE_LANG] || {};
  return function t(key, vars) {
    let template = own[key];
    if (template === undefined) {
      template = code === SOURCE_LANG ? undefined : source[key];
      if (onMissing) onMissing({ key, lang: code, found: template === undefined ? null : SOURCE_LANG });
      if (template === undefined) return key;
    }
    return interpolate(template, vars);
  };
}
