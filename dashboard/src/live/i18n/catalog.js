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

import roles from "./strings/roles.js";
import perms from "./strings/perms.js";

import source from "./strings/source.js";

// G1-16: the alarm sound and the critical-alarm notification, ported before the old workspace went.
import signals from "./strings/signals.js";

// Aşama A: the unvalidated monitor strip (screens/common/MonitorStrip.jsx).
import monitor from "./strings/monitor.js";

// Aşama B: the shadow engine's findings, «Gölge öneri · alarm kapalı» (screens/patient/shadow/).
import shadow from "./strings/shadow.js";

// G2-B1a: Hasta Kabul (screens/kabul, the admin's Yapı tab, the unit names, the coded refusals).
import kabul from "./strings/kabul.js";

// G2-ESLEME: the monitor→bed editor on «Monitörler» (screens/devices/MappingSection.jsx, MappingDialog.jsx).
import esleme from "./strings/esleme.js";

// G2-A4: the patient screen's SOFA box and form (screens/patient/sofa).
import sofa from "./strings/sofa.js";

// G2-B1d: Protokol — the protocol number, its label, Yönetim › Protokol ve etiket.
import protokol from "./strings/protokol.js";

// G3-01: the bedside measurement — the «Yatak başı ölçüm» page, «Ölçüm gir», «hatalı giriş».
import olcum from "./strings/olcum.js";

import doluluk from "./strings/doluluk.js";
// G3-02: Görevlerim — the task queue, its dialogs and the Yönetim › Görevler tab.
import gorevler from "./strings/gorevler.js";

// G3-03: Sıvı dengesi — the patient screen's fluid box, its chart and entry dialog (screens/patient/fluids).
import sivi from "./strings/sivi.js";

// Dalga: the live waveform panel (screens/common/WavePanel.jsx).
import waves from "./strings/waves.js";

// G2-B4: «Denetim bütünlüğü» — the audit trail's integrity page (screens/denetim).
import denetim from "./strings/denetim.js";

// G2-B5: the rapid-response team — the RRT screen (screens/rrt), its rail badge, «RRT çağır».
import rrt from "./strings/rrt.js";

// G2-B3b: «Vardiya devri» — the shift handover screen (screens/devir), its dialog, the note and the summary.
import devir from "./strings/devir.js";

// G2-B1c: Bakım ekibi, the care-team box on the patient screen (screens/patient/careTeam).
import ekip from "./strings/ekip.js";

// G2-B5b: «Ertele» — snoozing an alarm (screens/alarms: the button, the dialog, «Ertelenenler»; the refusals).
import ertele from "./strings/ertele.js";

// G4-01: «Cihaz & Veri Akışı» — the device page's «veri geliyor mu?» sections (screens/devices/FeedSections.jsx).
import cihaz from "./strings/cihaz.js";

// G4-02: «Yönetici özeti» — the hospital at a glance (screens/ozet).
import ozet from "./strings/ozet.js";

// G3-04: «Eczane» — the pharmacist's ward page (screens/eczane).
import eczane from "./strings/eczane.js";

// G3-05: «Cihaz ölçüm kaydı» — the record box, «Düzelt», the unmatched list (screens/patient/readings, bedside).
import kayit from "./strings/kayit.js";

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

  roles, perms,

  source,

  signals,

  monitor,

  shadow,

  kabul, // G2-B1a

  esleme, // G2-ESLEME

  sofa, // G2-A4

  protokol, // G2-B1d

  olcum, // G3-01

  doluluk, // G2-B3a
  gorevler, // G3-02

  sivi, // G3-03

  waves, // dalga

  denetim, // G2-B4

  rrt, // G2-B5

  devir, // G2-B3b

  ekip, // G2-B1c

  ertele, // G2-B5b

  cihaz, // G4-01

  ozet, // G4-02

  eczane, // G3-04

  kayit, // G3-05
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
