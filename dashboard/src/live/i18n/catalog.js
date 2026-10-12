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
import account from "./strings/account.js";
import nav from "./strings/nav.js";
// Wave 3's screens. `board` is shared by the three clinical ones (the connection, the engine's
// scope, the feed) and is added with the first of them; the other six are one import and one entry
// per screen — the same seam `shell/routes.js` has, so the parallel branches of Wave 3 touch
// different lines. Each branch uncomments ITS OWN two lines and nobody else's.
import board from "./strings/board.js";
import beds from "./strings/beds.js";

import alarms from "./strings/alarms.js";

import patient from "./strings/patient.js";

import admin from "./strings/admin.js";

// G1-13: import roles from "./strings/roles.js";

import source from "./strings/source.js";

export const NAMESPACES = {
  common, risk, prefs, news2, gallery, ui, errors, dates, shell, auth, lock, account, nav,
  board,

  // One entry per arm, each with a blank line either side, for the same reason as the import
  // block above and `shell/routes.js`'s SCREENS: adjacent lines conflict on merge, lines with
  // untouched context between them do not. Do not tidy the gaps away.
  beds,

  alarms,

  patient,

  admin,

  // G1-13: roles,

  source,
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
