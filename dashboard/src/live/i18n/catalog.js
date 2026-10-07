// src/live/i18n/catalog.js — every namespace's dictionaries, flattened per language.
//
// One file per namespace under strings/, each { tr, az, ru, en } with the same keys. A screen
// adds its own namespace file and one import line below, so parallel branches touch different
// files. Keys are "<namespace>.<key>", nested objects joined with dots: "news2.missing.spo2".
import { LANG_CODES } from "./langs.js";
import common from "./strings/common.js";
import risk from "./strings/risk.js";
import prefs from "./strings/prefs.js";
import news2 from "./strings/news2.js";
import gallery from "./strings/gallery.js";
import ui from "./strings/ui.js";
import errors from "./strings/errors.js";
import dates from "./strings/dates.js";
import shell from "./strings/shell.js";
import auth from "./strings/auth.js";
import lock from "./strings/lock.js";

export const NAMESPACES = {
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth, lock,
};

function flattenInto(out, prefix, entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (value && typeof value === "object") flattenInto(out, `${prefix}${key}.`, value);
    else out[`${prefix}${key}`] = value;
  }
  return out;
}

export function buildDictionaries(namespaces) {
  return Object.fromEntries(LANG_CODES.map((lang) => [
    lang,
    Object.entries(namespaces).reduce((out, [ns, dict]) => flattenInto(out, `${ns}.`, dict[lang] || {}), {}),
  ]));
}

export const DICTIONARIES = buildDictionaries(NAMESPACES);
