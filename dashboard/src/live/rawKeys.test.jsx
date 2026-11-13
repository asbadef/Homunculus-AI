// Cross-cutting: NO SCREEN OF THIS BUILD PRINTS A TRANSLATION KEY WHERE ITS TEXT SHOULD BE.
//
// `createTranslator` returns the key itself when a key is missing (translate.js, deliberately: a
// gap must be visible, not silently Turkish). That is the right fallback and it is also a failure
// nothing else catches — it throws nothing, logs nothing in a test run, and renders a plausible
// looking `beds.identityPending` into a clinical card. Wave 3 met it twice. The foundation moved
// the unit names out of `beds.*` because "the alarms and patient screens, built on their own
// branches, would have rendered the raw key" (strings/board.js), and then six more keys were found
// in the same position — `board.identityPending`, `board.news2*`, `board.escalated*`, which the bed
// card, the alarms row and the patient screen all say. `escalated` had no test on any branch at
// all, so on a branch without the alarms arm the screen printed the literal key and the suite was
// green.
//
// So this test is not about those six: it is the systemic version, and it follows THE BUILD rather
// than a pinned registry (the one place that rule is right: the subject is a property every built
// screen must have, not which screens exist). An arm that lands a screen in `shell/routes.js`
// SCREENS is swept by it without editing this file, and its address's parameters are filled from
// the fixture below — `/patients/:id` is opened on the card this payload carries.
//
// What it cannot see: a key inside a `{variable}` the engine supplied (that is data, never
// translated), and a key rendered only on a state this payload does not reach. The second test
// below is the anchor against that — a sweep over screens that rendered nothing would pass
// vacuously, so the six keys the fix-up moved are asserted present, in Azerbaijani, on the screens
// that draw them.
//
// Synthetic accounts and synthetic cards only (board.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { mount } from "./session/mount.testutil.jsx";
import { profile, token } from "./session/testTokens.testutil.js";
import { DICTIONARIES, NAMESPACES } from "./i18n/catalog.js";
import { LANG_CODES } from "./i18n/langs.js";
import { ROUTES, hashPath, resetScreens, screenOf } from "./shell/routes.js";
import { onlyScreens } from "./shell/screens.testutil.js";
import { Shell } from "./shell/Shell.jsx";
import { BedsScreen } from "./screens/beds/BedsScreen.jsx";
import { AlarmsScreen } from "./screens/alarms/AlarmsScreen.jsx";
import { PERMISSION_KEYS } from "./screens/admin/catalogue.js";
import { NOW, ago, alarm, board, entry, identity, news2, reading } from "./data/board.testutil.js";
import { bed, param, strip, unassigned } from "./data/shadow.testutil.js";
import { ADMIN_READS } from "./screens/admin/admin.testutil.js";
import { BANDS, channel, marker, point, trends } from "./screens/patient/trends/trends.testutil.js";
import { BED, UUID_TEXT, row as admissionRow, structure as wardStructure } from "./screens/kabul/kabul.testutil.js"; // G2-B1a
import { device, list as mappingList, onBed } from "./screens/devices/esleme.testutil.js"; // G2-ESLEME
import { fluids } from "./screens/patient/fluids/fluids.testutil.js"; // G3-03
import { readings } from "./screens/patient/readings/readings.testutil.js"; // G3-05
import { unmatched } from "./screens/bedside/unmatched.testutil.js"; // G3-05
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
import { ANSWER as QUALITY_SWEEP } from "./screens/kalite/kalite.testutil.js"; // G4-03

/** `src/live/` on disk. (Paths with node:path: under jsdom the global URL is jsdom's, which
 *  fileURLToPath refuses — the note apiErrors.test.js carries.) */
const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Every right Group 1 knows — the mirrored catalogue itself, not a list written out here — so the
 *  sweep is not stopped at a screen by a missing permission, and so no CONTROL a right unlocks is
 *  left outside the net. `clinical.chart` was missing once, and the patient screen then rendered
 *  only the "you may not chart this" sentence while the five strings of the charting control
 *  (`patient.chartTitle|chartNote|chartYes|chartNo|chartSaving`) were never swept: a permission
 *  omitted here is a whole region of the UI this file silently does not cover, which is the
 *  opposite of what it exists for.
 *
 *  The administration surface made the list itself the only safe answer. Its group-mapping
 *  controls are drawn only for a desk that holds the WHOLE catalogue (the server's own rule,
 *  `admin/ldap_service._full_administrator`, 403 otherwise) — so `users.manage` and
 *  `groups.manage` are not enough, and no fixed list of three or five rights ever would be: a
 *  right added to `auth/permissions.py` would silently close the mapping panel to this sweep. */
const PERMS = [...PERMISSION_KEYS];
/** The card a parameterised address is opened on. */
const FIXTURE_ID = "S-001";

// The shape of a key as `t()` returns it when it is missing: one of THIS build's own namespaces, a
// dot, then the key's own camelCase or dotted path, with no spaces. The namespaces come from the
// catalogue rather than being written out, so a namespace an arm adds is included the day it lands.
//
// Restricting the first word to the catalogue's namespaces is what makes the check usable: the bare
// `word.word` shape also matches text a screen is RIGHT to print — `«alerts.ack»` is a permission
// key quoted inside `alarms.noAckPerm`, and a file name, a decimal or an abbreviation ending in a
// full stop would each match too. Those are not namespaces, so they are not flagged, while every
// raw key of every namespace is. The detector's own test below states both halves.
const KEY_SHAPE = new RegExp(
  `\\b(?:${Object.keys(NAMESPACES).join("|")})\\.[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)*\\b`,
  "g",
);
/** The attributes a reader meets that are not in the text: an accessible name is as much a place
 *  for a raw key as a paragraph, and `aria-label` is where a card's whole name lives. */
const LABELS = ["aria-label", "aria-description", "aria-roledescription", "title", "placeholder", "alt"];
/** Not markup a reader is ever shown. A stylesheet in particular is full of `nav.something`. */
const NOT_TEXT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
/** A file this interface names is not a key, whatever its first word is (`api/board.py`). */
const A_FILE = /\.(?:js|jsx|ts|tsx|py|json|md|css|html)$/i;
/** A PERMISSION key is not a translation key, and two of them are namespace-shaped: `board.view`
 *  and `board.py` share a first word with the `board` namespace. The roles table prints every key
 *  of the catalogue on purpose, under the server's own description — it is what an administrator
 *  searches that table by and what a support call quotes, which is why `apiErrors.js` leaves them
 *  untranslated inside `errors.permissionRequired` and `admin.beyond` too. Only the EXACT keys of
 *  the catalogue are exempt, so a real `board.news2` left raw is still caught. Found by this
 *  file's own tab-walking sweep the first time the roles tab was built. */
const PERMISSION_KEY = new Set(PERMISSION_KEYS);

/** Every key-shaped string this subtree shows a reader, text and accessible names alike.
 *
 *  Each text NODE is read on its own rather than through `textContent`, which concatenates
 *  neighbouring elements with nothing between them: two keys in two adjacent cells came back as
 *  one unsearchable `beds.identityPendingnews2.missing.spo2`, and a report a reviewer cannot paste
 *  into a grep is half a report. */
export function rawKeys(root) {
  const texts = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (node) => (NOT_TEXT.has(node.parentNode?.nodeName) ? 2 /* REJECT */ : 1 /* ACCEPT */),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.data);
  for (const el of root.querySelectorAll(LABELS.map((a) => `[${a}]`).join(","))) {
    for (const attr of LABELS) {
      const value = el.getAttribute(attr);
      if (value) texts.push(value);
    }
  }
  const found = new Set();
  for (const text of texts) {
    for (const match of text.matchAll(KEY_SHAPE)) {
      if (!A_FILE.test(match[0]) && !PERMISSION_KEY.has(match[0])) found.add(match[0]);
    }
  }
  return [...found];
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** One card with a name, a measured channel, the engine's NEWS2 at its loudest (partial, with a
 *  red parameter) and an escalated alarm; one card the HIS has not named. Between them they reach
 *  every string the three clinical screens share.
 *
 *  The first card carries a MEDS block on purpose. With `meds: null` — `entry`'s default — the
 *  patient screen drew only `patient.noMeds`, so the four antibiotic strings and the two
 *  pressor/weight/creatinine ones were outside the sweep. A fixture that does not reach a branch
 *  makes this file quietly smaller than it reads, and the branches it was not reaching were the
 *  three-valued antibiotic: the one place on that screen where a missing record must not be
 *  rendered as a deadline the ward missed. */
const PAYLOAD = board([
  // G2-B5: the alarm carries an open RRT call, so the RRT screen's row and the rail's RRT badge are drawn.
  entry(FIXTURE_ID, [alarm("news2", "high", { escalated: true, rrt_call: { by: "leyla", at: ago(120), reason: "Solunum güçlüğü" } })], {
    identity: identity(),
    score: news2({ partial: true, missing: ["spo2"], red_param: true }),
    ...reading({ heart_rate: 96, spo2: 91 }, 30),
    meds: {
      pressors: { norepinephrine: 0.08 }, antibiotic_given: true, antibiotic_at: ago(600),
      antibiotic_clock: null, weight_kg: 72, creatinine: 1.9,
    },
  }),
  // G2-B5b: a snoozed alarm, so the alarm screen draws «Ertelenenler», its row's snooze line, and the dialog.
  entry("S-002", [alarm("acute_change", "moderate", { urgency: "soon", summary: "Acute change from baseline",
    snooze: { by: "leyla", at: ago(300), until: new Date(NOW + 10 * 60_000).toISOString(), minutes: 15,
      reason: "PATIENT_BASELINE", reason_text: null } })], reading({ heart_rate: 88 }, 30)),
]);

/** Aşama A's monitor strip, on: a monitor on the fixture's card (a value, a `***`, a partly checked
 *  parameter, an old one, an NBP with the time it changed), a bed with no patient (its NBP awaiting a
 *  change), a bed with two monitors, a silent one, a device the table leaves unplaced and one it does
 *  not list. The beds, patient, devices and settings screens draw it; without it every `monitor.*`
 *  string was outside the sweep. Synthetic devices only (shadow.testutil.js). */
const STRIP = strip({
  beds: [
    bed("REA-01 · 1", [param("hr", 96), param("spo2", null), param("art_mean", 84), param("respiration", 18, { age_s: 40 }),
      param("nbp", [118, 79, 92])], { link: "one", patient_id: FIXTURE_ID }),
    bed("REA-01 · 3", [param("temperature", 37.1), param("nbp", null)]),
    bed("REA-01 · 4", [], { link: "ambiguous", link_reason: "two_monitors" }),
    bed("REA-01 · 5", [], { status: "silent" }),
  ],
  unassigned: [unassigned("192.0.2.28"), unassigned("192.0.2.34", "not_in_table", [param("pls", 70)], { status: "streaming" })],
});

/** G4-01: a strip with the device page's ledger (api/infinity_shadow.py board_view): a silent monitor, a vanished
 *  one, and on a streaming one a channel with no value for four minutes and one for an hour and a half. STRIP carries no ledger, so the sweep
 *  meets only the sections' empty words; this is where the rest are drawn. Synthetic devices only. */
const minutesBefore = (n) => new Date(NOW - n * 60_000).toISOString();
const FEED_STRIP = {
  ...strip({
    beds: [
      bed("REA-01 · 1", [param("hr", 96)], { last_packet_at: minutesBefore(0),
        channels_seen: [{ parameter: "hr", last_value_at: minutesBefore(0) }, { parameter: "art_systolic", last_value_at: minutesBefore(4) },
          { parameter: "art_mean", last_value_at: minutesBefore(90) }] }),
      bed("REA-01 · 5", [], { status: "silent", last_packet_at: minutesBefore(7), silent_for_s: 420, channels_seen: [] }),
      bed("REA-01 · 6", [], { status: "unknown", last_packet_at: minutesBefore(3), silent_for_s: 180, channels_seen: [] }),
    ],
  }),
  watching_since: minutesBefore(120), stale_list_after_s: 60,
  vanished: [{ source: "192.0.2.6", bed_label: "REA-01 · 6", last_packet_at: minutesBefore(3), last_report_at: minutesBefore(3) }],
};

/** The trend charts (Group 2 · slice 1), reaching every card state: a red frame with the
 *  own-normal pill and a delta, a single reading, an amber frame, the two-series pressure card, a
 *  thinned channel and a lactate never measured; and both kinds of mark for the dialog. */
const TRENDS = trends(FIXTURE_ID, [
  channel("heart_rate", [point(60, 120, 2), point(5, 132, 3)], {
    latest: { ts: point(5, 0)[0], value: 132, delta: 12, news2_points: 3, within_own_normal: true },
    bands: { news2: BANDS.heart_rate, own_normal: { low: 100, high: 135 }, device: null },
  }),
  channel("resp_rate", [point(5, 22, 2)]),
  channel("spo2", [point(30, 93, 2)]),
  channel("sbp", [point(30, 118, 0)]),
  channel("map", [point(30, 80)]),
  channel("temperature", [point(90, 37.9, 0), point(30, 38.2, 1)], { thinned: true, total_points: 2400 }),
], { markers: [marker(45, "alarm"), marker(20, "antibiotic")], markers_truncated: true });

/** G2-B1a: a ward (kabul.testutil.js) and its admissions in each open state. */
const WARD = wardStructure();
const ADMISSIONS = [
  admissionRow({ id: "a-1", patient_number: FIXTURE_ID, state: "DRAFT", bed_label: "1" }),
  admissionRow({ id: "a-2", patient_number: "H2600002", state: "ACTIVE", bed_label: "2" }),
  admissionRow({ id: "a-3", patient_number: "H2600003", state: "PENDING_DISCHARGE", bed_label: "5", room_name: "Otaq 2",
    discharge_disposition: "EXITUS", discharge_at: "2026-10-08T09:30:00Z" }),
];

/** G2-B1d: GET /admin/protocol-settings with no start number set — the tab's warning and its form. */
const PROTOCOL_SETTINGS = { configured: false, next_no: null, last_issued: null, label_width_mm: 50,
  label_height_mm: 30, printer_dpi: 203, updated_at: null };

// G3-02: one patient with a late vital and one open hand task, so the sweep meets every state word.
const TASKS_SWEEP = { from: "2026-10-08T04:00:00Z", to: "2026-10-09T04:00:00Z", shift: { start: "2026-10-08T04:00:00Z", end: "2026-10-09T04:00:00Z" }, now: "2026-10-08T10:00:00Z",
  settings: { grace_min: 30, intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null } },
  patients: [{ patient_id: "S-001", bed_key: "REA^01^2", unit_id: "REA-01",
    vital: { state: "late", anchor_at: "2026-10-07T21:00:00Z", due_at: "2026-10-08T09:00:00Z", band: "b0", interval_min: 720, partial: false, skipped_until: null, entries: ["2026-10-08T05:00:00Z"] },
    tasks: [{ id: "t1", patient_id: "S-001", title: "Pansuman", due_at: "2026-10-08T12:00:00Z", target_role: "nurse", state: "open", late: false, created_by: "hem.ayse", created_at: "2026-10-08T09:00:00Z", claimed_by: null, claimed_at: null, closed_by: null, closed_at: null }] }] };
const TASK_SETTINGS_SWEEP = { configured: false, shift_start_a: 8, shift_start_b: 20, grace_min: 30, intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null }, updated_at: null, updated_by: null, default_source: { b0: "news2-rcp-2017" } };
/** G2-B4: the audit page's newest events (a labelled type, a code no version names, a masked id) and a broken chain. */
const AUDIT_ROWS = { records: [
  { id: 1, ts: "2026-11-09T10:01:00+00:00", tenant: "demo-hastanesi", event_type: "ack", patient_id: "260109004821",
    subject: "news2_high", payload: { actor: "ayse" }, prev_hash: "", hash: "" },
  { id: 2, ts: "2026-11-09T10:02:00+00:00", tenant: "demo-hastanesi", event_type: "legacy.made_up", patient_id: "",
    subject: "", payload: { actor: "admin" }, prev_hash: "", hash: "" },
  // G2-B4 follow-up D2: a scope row written before the engine wrote names — both its user ids masked
  { id: 3, ts: "2026-11-09T10:03:00+00:00", tenant: "demo-hastanesi", event_type: "scope", patient_id: "",
    subject: "22222222-2222-4222-8222-2222222261a2", payload: { by: "11111111-1111-4111-8111-11111111ad01", before: [], after: [] },
    prev_hash: "", hash: "" },
] };
const BROKEN_CHAIN = { ok: false, checked: 1, unsealed: 1, broken_at: 2, reason: "önceki kayda bağlanmıyor — arada kayıt silinmiş olabilir",
  records: 2, complete: true };
const HEAT_REPORT = { episodes: 2, truncated: true, days: 7, window_from: "2026-11-08T06:00:00+00:00", per_patient_hour: [
  { patient_id: "260109004821", hour: "2026-11-09T10:00:00+00:00", episodes: 2 },
] };

/** G2-B3b: «Vardiya devri» — one handover in each box, each with its D-Ö-D-Ö note and its sealed summary (an open
 *  alert in it), so a row of the lists, the note's parts and the summary's words are drawn; and the colleagues the
 *  «Yeni devir» dialog offers. Synthetic people, the fixture's card. */
const HANDOVER_PATIENT = { admission_id: "a-2", board_key: FIXTURE_ID, display_name: "Ayşe Sentetik", bed_label: "REA-01 · 2",
  unit_name: "Reanimasiya" };
const HANDOVER_NOTE = { situation: "Stabil", background: "Sentetik öykü", assessment: "Değerlendirme", recommendation: "Mobilizasyon" };
const HANDOVER_SUMMARY = { risk: "high", news2: { total: 7, partial: true },
  latest: { heart_rate: 96, map: 70, spo2: 91, resp_rate: 24, temperature: 38.1 }, on_pressor: true,
  open_alerts: [{ kind: "news2", severity: "high", acknowledged: false }], captured_at: ago(300) };
const handoverRow = (id, status, over) => ({ id, status, created_at: ago(900), bridge_expires_at: ago(-900),
  outgoing_signed_at: ago(300), incoming_signed_at: null, outgoing: { id: "u-leyla", name: "Leyla Sentetik" },
  incoming: { id: "u-ayse", name: "Ayşe Sentetik" }, patients: [HANDOVER_PATIENT], note: HANDOVER_NOTE,
  summary: HANDOVER_SUMMARY, ...over });
const HANDOVERS = {
  incoming: [handoverRow("h-1", "OUTGOING_SIGNED")],
  outgoing: [handoverRow("h-2", "COMPLETED", { incoming_signed_at: ago(60),
    outgoing: { id: "u-ayse", name: "Ayşe Sentetik" }, incoming: { id: "u-leyla", name: "Leyla Sentetik" } })],
};
const COLLEAGUES = [{ id: "u-leyla", name: "Leyla Sentetik" }, { id: "u-murad", name: "Murad Sentetik" }];

/** G4-02: «Yönetici özeti» — one unit of the ward with a handover waiting since three hours before the answer, so the
 *  card's and the cell's «oldest» words are drawn. Counts and times only, as the API sends them. */
const PENDING_SWEEP = { generated_at: "2026-10-08T10:00:00+00:00", units: [{ unit_id: WARD.sites[0].units[0].id,
  unit_name: WARD.sites[0].units[0].name, pending: 1, oldest_outgoing_signed_at: "2026-10-08T07:00:00+00:00" }] };

/** G4-04: «İş yükü» — the ward's occupied bed 2 to one nurse for the current shift, so the units table's ratio and a
 *  nurse card are drawn; the form's people, one of whom cannot see the unit. Synthetic names, as the API sends them. */
const SCHEDULE_SWEEP = { shift: { start: "2026-10-08T04:00:00Z", end: "2026-10-08T16:00:00Z", which: "A" },
  generated_at: "2026-10-08T10:00:00Z", units: [{ unit_id: WARD.sites[0].units[0].id, unit_name: WARD.sites[0].units[0].name,
    other_rows: 1, items: [{ bed_id: BED(2), nurse_id: "n-leyla", nurse_name: "Leyla Sentetik", nurse_username: "leyla" }] }] };
const NURSES_SWEEP = [{ id: "n-leyla", name: "Leyla Sentetik", username: "leyla", reaches_unit: true },
  { id: "n-nigar", name: "Nigar Sentetik", username: "nigar", reaches_unit: false }];

/** The shell on one address, as LiveApp nests it, with the board LIVE and its first reload landed. */
async function openAt(path, extra) {
  window.location.hash = `#${path}`;
  const mounted = await mount(<ThemeProvider><Shell resume={hashPath(`#${path}`)} /></ThemeProvider>, {
    access: token({ perms: PERMS }),
    me: profile({ perms: PERMS }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(PAYLOAD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      // The administration screen reads four more routes before it draws a row. Unstubbed they
      // resolve `undefined`, every list comes out empty, and the sweep walks three tabs that each
      // say only "nothing matches" — green, and covering none of the strings this file exists for.
      ADMIN_READS(api);
      api.shadowBoard.mockResolvedValue(STRIP);
      api.patientTrends.mockImplementation((pid, hours) => Promise.resolve({ ...TRENDS, patient_id: pid, hours }));

      // G2-B1a: the ward's structure and its open admissions — a DRAFT on the fixture's card (the
      // sign-off strip and the badge), an admitted patient and a started discharge (Taburcu).
      api.structure.mockResolvedValue(WARD);
      api.admissions.mockResolvedValue(ADMISSIONS);

      // G2-ESLEME: the monitor–bed list on «Monitörler» — a bound, a label-only, another unit's and
      // an absent monitor, so every row kind and both actions are drawn.
      api.deviceBeds.mockResolvedValue(MAPPING);

      // G2-B4: «Denetim bütünlüğü» (screens/denetim)
      api.audit.mockResolvedValue(AUDIT_ROWS);
      api.verifyAudit.mockResolvedValue(BROKEN_CHAIN);
      api.alarmQuality.mockResolvedValue(HEAT_REPORT);   // G2-B6

      // G2-B1d: Yönetim › Protokol ve etiket reads its settings — unstubbed it would draw a form
      // on defaults, and the sweep would not meet the «no start number» note.
      api.protocolSettings.mockResolvedValue(PROTOCOL_SETTINGS);

      // G3-02: the task queue and its settings tab — unstubbed the screen reads `undefined` and draws nothing.
      api.tasks.mockResolvedValue(TASKS_SWEEP);
      api.taskSettings.mockResolvedValue(TASK_SETTINGS_SWEEP);

      // G3-03: the patient screen's «Sıvı» box — today's entries (one withdrawn), the shifts and the last day, so
      // the sweep meets every word the box prints. Unstubbed it would say only that the ledger is unreadable.
      api.patientFluids.mockImplementation((pid) => Promise.resolve(fluids(pid)));

      // G3-05: the patient screen's «Ölçüm kaydı» box — a hand entry, a device round with a withdrawn value and a
      // late arrival, so the sweep meets both sources, the struck value and «alındı».
      api.patientReadings.mockImplementation((pid, hours) => Promise.resolve(readings(pid, hours)));
      api.unmatchedReadings.mockResolvedValue(unmatched());   // … and the bedside page's «Eşleşmeyen ölçümler» count

      // G2-B3b: «Vardiya devri» (screens/devir) — the two boxes and the dialog's colleagues.
      api.handovers.mockImplementation((box) => Promise.resolve(HANDOVERS[box] ?? []));
      api.handoverColleagues.mockResolvedValue(COLLEAGUES);

      // G4-02: «Yönetici özeti» (screens/ozet) — the units' waiting handovers.
      api.pendingHandovers.mockResolvedValue(PENDING_SWEEP);

      // G3-04: «Eczane» (screens/eczane) — a row in each of the six antibiotic states, with vasopressors, a creatinine
      // and a fluid balance, so the sweep meets every word of the table. Unstubbed the page would say only that its
      // list could not be read.
      api.pharmacy.mockResolvedValue(pharmacyAnswer());

      // G4-03: «Kalite göstergeleri» (screens/kalite) — a whole week: the units, the unplaced row, the snoozes.
      api.qualityIndicators.mockResolvedValue(QUALITY_SWEEP);

      // G4-04: «İş yükü» (screens/isyuku) — the shift's assignment and the form's people.
      api.shiftSchedule.mockResolvedValue(SCHEDULE_SWEEP);
      api.shiftNurses.mockResolvedValue(NURSES_SWEEP);
      extra?.(api);   // G4-01: a test's own answers, laid over the sweep's
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  await act(async () => { mounted.shadow.start(PERMS); await settle(); });
  return mounted;
}

// G2-ESLEME: the editor's list for every sweep (synthetic monitors on the kabul ward's beds). The absent
// monitor is what the server sends for one the worker no longer reports: status "unknown", seen false (A-19).
const MAPPING = mappingList([
  device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
  device("192.0.2.12", { device_bed_label: "BED01", row_id: 2 }),
  device("192.0.2.14", { row_id: 4, editable: false, bed: { id: BED(6), in_scope: false } }),
  device("192.0.2.20", { row_id: 5, seen: false, status: "unknown", last_seen_at: null }),
]);

/** The address of a route, with its parameters on the fixture's card. */
const addressOf = (route) => route.path.replace(/:\w+/g, FIXTURE_ID);

beforeEach(() => {
  window.location.hash = "";
  vi.setSystemTime(NOW);
});
afterEach(() => {
  resetScreens();
  vi.useRealTimers();
  localStorage.clear();
});

describe("no screen shows a reader a translation key", () => {
  it("catches a raw key, and leaves text a screen is right to print alone", () => {
    const root = document.createElement("div");
    root.innerHTML = [
      "<p>beds.identityPending</p>",
      "<p>news2.missing.spo2</p>",
      "<p lang=\"ru\">«alerts.ack» · 4.07 · 09:58 · мм рт. ст. · board.py</p>",
      // The roles table's own cells: the catalogue's keys, printed on purpose. `board.view` is
      // namespace-shaped and still not a translation key; `board.news2` is one and is caught.
      "<span>board.view</span><span>clinical.chart</span><span>board.news2</span>",
      "<button aria-label=\"board.escalated\">·</button>",
    ].join("");
    expect(rawKeys(root).sort()).toEqual([
      "beds.identityPending", "board.escalated", "board.news2", "news2.missing.spo2",
    ]);
  });

  it("every screen this build has renders its texts, on every address the rail can reach", async () => {
    const offenders = [];
    const visited = [];
    for (const route of ROUTES.filter((r) => screenOf(r))) {
      const path = addressOf(route);
      const mounted = await openAt(path);
      // The screen itself, not the router's "no access" or "no such page" — both of which carry an
      // h1 of their own and no screen's text at all, and would have made this sweep vacuous.
      expect(document.querySelectorAll("h1"), `${route.id} (${path})`).toHaveLength(1);
      for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) → ${key}`);
      // A TABBED screen shows one panel at a time, so arriving at it sweeps the FIRST tab and
      // nothing else: the administration screen's roles and login-source tabs — two whole
      // namespaces, built on their own branches — would have sat outside this net while it
      // reported the screen covered. Every tab is clicked and its panel swept. `role="tab"` is
      // read again after each click: the list may be rebuilt.
      for (let at = 0; at < screen.queryAllByRole("tab").length; at += 1) {
        const tab = screen.queryAllByRole("tab")[at];
        const name = tab.textContent;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { fireEvent.click(tab); await settle(); });
        for (const key of rawKeys(document.body)) offenders.push(`${route.id} (${path}) · ${name} → ${key}`);
        visited.push(`${route.id}:${at}`);
      }
      visited.push(route.id);
      act(() => { mounted.board.clear(); });
      cleanup();
    }
    expect(offenders, `a screen printed a key instead of its text:\n${offenders.join("\n")}`).toEqual([]);
    // Not WHICH screens exist (that is the build's business and this file does not pin it), only
    // that the sweep had screens to sweep: a build whose routes were all unbuilt would otherwise
    // report a clean board having rendered nothing.
    expect(visited.length, `swept: ${visited.join(", ")}`).toBeGreaterThan(1);
  }, 60_000);   // mounts every screen of the build: slow on a loaded runner

  // The anchor for the sweep above, and the regression test for the six keys the Wave 3 fix-up
  // moved into `board.*`: each is asserted as the reader meets it, so a payload that stopped
  // reaching one of them fails here rather than quietly weakening the sweep.
  //
  // Unlike the sweep, this test names two screens, so it states that build itself rather than
  // leaning on the registry (`afterEach` restores it): with the registry pinned empty it opened
  // `/beds` on no screen at all (G1-15, F3).
  it("the keys three screens share resolve on each screen that draws them", async () => {
    onlyScreens({ beds: BedsScreen, alarms: AlarmsScreen });
    await openAt("/beds");
    expect(screen.getByText("kimlik gözlənilir")).toBeInTheDocument();      // board.identityPending
    expect(screen.getByText("NEWS2:")).toBeInTheDocument();                 // board.news2
    // board.news2Partial — the card's own, not the monitor strip's `monitor.partial` (the same word)
    expect(screen.getAllByText("qismən").filter((el) => !el.closest("[data-monitor-strip]"))).toHaveLength(1);
    expect(screen.getByText("Bir parametr 3 bal alıb")).toBeInTheDocument(); // board.news2Red
    cleanup();
    const mounted = await openAt("/alarms");
    expect(screen.getByText("Eskalasiya edilib")).toBeInTheDocument();      // board.escalated
    expect(screen.getByText(/Eskalasiyanı mühərrik yürüdür/)).toBeInTheDocument(); // board.escalatedHelp
    act(() => { mounted.board.clear(); });
  });

  // The same anchor for the trend charts: the cards are on the patient screen, but the big chart, its
  // table and the patient's-normal form open only on a click, so the sweep above never saw them.
  // G2-B1a — the same anchor for Hasta Kabul: the form's panel and the bed picker, both lists of
  // Taburcu and its dialog (which opens only on a click), Yataklar, the sign-off strip and the
  // badge, and Yönetim › Yapı — and on none of them a UUID (spec D9).
  it("the Hasta Kabul keys resolve on its three tabs, the discharge dialog, the strip, the badge and Yapı", async () => {
    let mounted = await openAt("/kabul");
    expect(screen.getByText("Çatışmayan sahələr")).toBeInTheDocument();                 // kabul.missingTitle
    expect(screen.getByRole("button", { name: /^Reanimasiya/ })).toBeInTheDocument();  // the picker, by name
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Köçürmə / Evə yazılma" })); await settle(); });
    expect(screen.getByText("Vəfat (exitus)", { exact: false })).toBeInTheDocument();  // kabul.disp.exitus
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Evə yazılmanı başlat: / })); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Çıxış forması");             // kabul.f.disposition
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
    cleanup();

    mounted = await openAt(`/patients/${FIXTURE_ID}`);
    expect(screen.getByText(/^Həkim imzası gözlənilir —/)).toBeInTheDocument();          // kabul.awaitingSignature
    act(() => { mounted.board.clear(); });
    cleanup();

    mounted = await openAt("/beds");
    expect(screen.getByText("Həkim imzası gözlənilir")).toBeInTheDocument();             // kabul.badgeDraft
    act(() => { mounted.board.clear(); });
    cleanup();

    mounted = await openAt("/admin");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Struktur" })); await settle(); });
    expect(screen.getByText(/Bina, şöbə, otaq və çarpayıları buradan qurun/)).toBeInTheDocument();
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G2-ESLEME — the same anchor for the monitor–bed editor: «Monitörler» draws its list (bound, label-only,
  // another unit's and an absent monitor) and the dialog's pick opens only on a click, so the sweep above
  // never saw it. The texts are the namespace's az values as amendment A-7 fixed them («qoş-», not «bağla»).
  it("the monitor–bed editor's keys resolve on its list and in its dialog", async () => {
    const mounted = await openAt("/devices");
    expect(screen.getByRole("heading", { name: "Monitor–çarpayı uyğunlaşdırması" })).toBeInTheDocument(); // esleme.title
    expect(screen.getByText("başqa şöbədə")).toBeInTheDocument();                                         // esleme.otherUnit
    expect(screen.getByText("görünmür · son görünmə bilinmir")).toBeInTheDocument();                      // esleme.unseenUnknown
    expect(screen.getAllByText("qoşulmayıb").length).toBeGreaterThan(0);                                  // esleme.unbound
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Başqa çarpayıya qoş: 192.0.2.11 (BED05)" })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Çarpayılar");                                    // esleme.pick.legend
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G4-02 — «Yönetici özeti»: the sweep's report is the heatmap's (no figures, no days, no kinds); here a whole one, so
  // the quality box's figures, its daily bars and its kinds are drawn, beside the cards and the units table.
  it("the summary page's keys resolve on its cards, its quality box and its units table", async () => {
    const mounted = await openAt("/ozet", (api) => {
      api.alarmQuality.mockResolvedValue({ episodes: 3, answered: 2, unanswered: 1, escalated: 1, pending: 0,
        answered_rate: 0.6667, median_response_sec: 75, p90_response_sec: 75, days: 7, truncated: false, window_from: null,
        per_kind: [{ kind: "news2", episodes: 3, answered: 2, escalated: 1, median_response_sec: 75 }],
        per_day: [{ date: "2026-10-07", episodes: 3 }], noisiest_beds: [], per_patient_hour: [] });
    });
    expect(screen.getByRole("heading", { level: 2, name: "Unudulan işlər" })).toBeInTheDocument();     // ozet.cards.title
    expect(screen.getByRole("table", { name: "Şöbələr, indi" })).toBeInTheDocument();                 // ozet.units.caption
    expect(screen.getByText("07.10: 3 epizod")).toBeInTheDocument();                                  // ozet.q.dayCount
    expect(screen.getByText("Şöbəsi bəlli olmayan")).toBeInTheDocument();                            // ozet.units.unplaced
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G3-04 — «Eczane»: the sweep's answer is fresh, so the two past-tense twins and the «not fresh» alert are outside
  // it; here the fresh page's words are anchored, and then a failed poll draws the rest.
  it("the pharmacy page's keys resolve on its counters, its table and its notes — fresh and not fresh", async () => {
    let fail = false;
    const mounted = await openAt("/eczane", (api) => {
      api.pharmacy.mockImplementation(() => (fail ? Promise.reject(new Error("kapsam şu anda okunamıyor")) : Promise.resolve(pharmacyAnswer())));
    });
    expect(screen.getByRole("heading", { level: 1, name: "Aptek" })).toBeInTheDocument();              // eczane.title
    expect(screen.getByRole("table", { name: "Aptek siyahısı: 6 xəstə" })).toBeInTheDocument();         // eczane.caption
    expect(screen.getByText("Müddət keçib · 25 dəq")).toBeInTheDocument();                               // eczane.ab.missed + eczane.dur.min
    expect(screen.getByText("Müddət gedir · 20 dəq qalıb")).toBeInTheDocument();                         // eczane.ab.running
    expect(screen.getByText("noradrenalin 0.12 mkq/kq/dəq · 20 dəq əvvəl")).toBeInTheDocument();         // patient.medsRunning, reused
    expect(screen.getAllByText("Bu gün qeyd yoxdur").length).toBeGreaterThan(0);                         // eczane.fluid.none
    expect(screen.getByText("sayılan tətbiq qeydi yoxdur: 2")).toBeInTheDocument();                          // eczane.count.noRecord
    expect(rawKeys(document.body)).toEqual([]);
    fail = true;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });   // the page reads again
    expect(screen.getByText(/^Aptek siyahısı aktual deyil · son cavab /)).toBeInTheDocument();           // eczane.stale
    expect(screen.getByText(/^Son cavabda müddət keçmişdi · bitmə /)).toBeInTheDocument();               // eczane.ab.staleMissed
    expect(screen.getByText(/^Son cavabda müddət gedirdi · bitmə /)).toBeInTheDocument();                // eczane.ab.staleRunning
    expect(screen.getByText(/^son cavab .* vəziyyətinə görə$/)).toBeInTheDocument();                     // eczane.asOf
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G4-03 — «Kalite göstergeleri»: its cards and its table, then — only once a unit is chosen — the snooze reasons'
  // second column and that unit's alarms by kind.
  it("the quality page's keys resolve on its cards, its table and a unit's selection", async () => {
    const mounted = await openAt("/kalite");
    expect(screen.getByRole("heading", { level: 1, name: "Keyfiyyət göstəriciləri" })).toBeInTheDocument();      // kalite.title
    const table = screen.getByRole("table", { name: "Şöbələrə görə keyfiyyət göstəriciləri" });                  // kalite.units.caption
    expect(within(table).getByText("Şöbəsi bəlli olmayan")).toBeInTheDocument();                                 // kalite.units.unplaced
    expect(screen.getByText("1 ədədi öz-özünə düzəldi")).toBeInTheDocument();                                     // kalite.cards.selfResolved
    await act(async () => { fireEvent.click(within(table).getByRole("button", { name: "Reanimasiya" })); await settle(); });
    expect(screen.getByRole("heading", { level: 2, name: "Növə görə siqnallar · Reanimasiya" })).toBeInTheDocument(); // kalite.kinds.title
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G4-04 — «İş yükü»: its table, the changed-hours note and a nurse card, then — once a unit is chosen — «Nöbet
  // ataması» with a person marked.
  it("the workload page's keys resolve on its table, its nurse cards and the assignment form", async () => {
    const mounted = await openAt("/is-yuku");
    expect(screen.getByRole("heading", { level: 1, name: "İş yükü" })).toBeInTheDocument();                       // isyuku.title
    expect(screen.getByRole("table", { name: "Şöbələrə görə iş yükü, bu növbə" })).toBeInTheDocument();           // isyuku.units.caption
    expect(screen.getByText("1 xəstə / 1 tibb bacısı · orta 1,0")).toBeInTheDocument();                            // isyuku.units.ratio, .mean
    expect(screen.getAllByText("Növbə saatları dəyişdi; bu növbənin təyinatı yenidən edilməlidir.").length).toBeGreaterThan(0); // .otherRows
    expect(screen.getByRole("heading", { level: 3, name: "Leyla Sentetik" })).toBeInTheDocument();                  // a nurse card
    await act(async () => { fireEvent.change(screen.getByLabelText("Şöbə"), { target: { value: WARD.sites[0].units[0].id } }); await settle(); });
    await act(async () => { await settle(); });
    expect(screen.getByRole("heading", { level: 2, name: "Növbə təyinatı · Reanimasiya" })).toBeInTheDocument();    // isyuku.form.title
    expect(screen.getAllByRole("option", { name: "Nigar Sentetik — bu şöbəni görə bilməz" }).length).toBeGreaterThan(0); // isyuku.form.unreached
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
  // monitor, and a table row whose monitor was never seen — states the sweep's STRIP and MAPPING do not reach.
  it("the device page's feed keys resolve on every section", async () => {
    const mounted = await openAt("/devices", (api) => {
      api.shadowBoard.mockResolvedValue(FEED_STRIP);
      api.deviceBeds.mockResolvedValue(mappingList([...MAPPING.devices,
        device("192.0.2.21", { row_id: 6, seen: false, status: null, last_seen_at: null, device_bed_label: "BED09" })]));
    });
    expect(screen.getByRole("heading", { level: 2, name: "Məlumat gəlirmi?" })).toBeInTheDocument();          // cihaz.verdictTitle
    expect(screen.getByText(/^Məlumat axır · \d+\/\d+ monitordan məlumat gəlir$/)).toBeInTheDocument();         // cihaz.verdictFlowing
    expect(screen.getByText(/^İzləmə başlanğıcı \d\d:\d\d · /)).toBeInTheDocument();                           // cihaz.watchingSince
    const silent = screen.getByRole("region", { name: "Səssiz monitorlar" });
    expect(silent).toHaveTextContent("dəqiqədir məlumat yoxdur · son məlumat");                                // cihaz.silentFor, forMinutes
    expect(silent).toHaveTextContent("hub artıq bildirmir");                                                   // cihaz.vanished
    expect(screen.getByRole("region", { name: "Köhnələn kanallar" })).toHaveTextContent("dəqiqədir dəyər yoxdur"); // cihaz.staleChannel
    expect(screen.getByRole("region", { name: "Köhnələn kanallar" })).toHaveTextContent("çıxarılmış ola bilər"); // cihaz.staleLongCount
    expect(screen.getByRole("region", { name: "Məlumat zənciri" })).toHaveTextContent("Ötürücü · son göndəriş"); // cihaz.chainForwarder
    expect(screen.getByRole("region", { name: "Cədvəldə var, heç görünməyib" })).toHaveTextContent("192.0.2.21 (BED09)"); // cihaz.neverTitle
    expect(rawKeys(document.body)).toEqual([]);
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
  });

  // G2-B4 — the audit page: its verdict appears only on the button (owner D1), so the sweep above never saw it.
  it("the audit page's keys resolve on its events and on a broken chain's verdict", async () => {
    const mounted = await openAt("/denetim");
    expect(screen.getByRole("heading", { level: 1, name: "Audit bütövlüyü" })).toBeInTheDocument();   // denetim.title
    // the label is also the filter's option, so ask for the events row's cell, not the first match
    expect(screen.getAllByText("Siqnalın təsdiqi").some((el) => el.tagName === "TD")).toBe(true);   // denetim.type.ack
    expect(screen.getByText("istifadəçi ••••ad01")).toBeInTheDocument();                           // denetim.maskedUser
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Zənciri yoxla" })); await settle(); });
    expect(screen.getByText(/Zəncir qırılıb/)).toBeInTheDocument();                                 // denetim.verdictBroken
    expect(screen.getByText(/möhürdən əvvəl yazılıb/)).toBeInTheDocument();                         // denetim.unsealed
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəritəni göstər" })); await settle(); });
    expect(screen.getByText(/klinik hədd deyil/)).toBeInTheDocument();                              // denetim.heat.legend
    expect(screen.getByText(/rəqəmlər natamamdır/)).toBeInTheDocument();                            // denetim.heat.truncatedFrom
    expect(screen.getByText(/yalnız .* sonrakı hadisələr sayıldı/)).toBeInTheDocument();             // its {from} filled in, not left as a placeholder
    expect(rawKeys(document.body)).toEqual([]);
    act(() => { mounted.board.clear(); });
  });

  // G2-B5 — the RRT screen: the fixture's alarm carries an open call, so its row, the tier-off note and the rail
  // badge's words are drawn; a sweep over two empty lists would have proved nothing about them.
  it("the RRT screen's keys resolve on its call row, its note and the rail's badge", async () => {
    const mounted = await openAt("/rrt");
    expect(screen.getByRole("heading", { level: 1, name: "Sürətli cavab komandası (RRT)" })).toBeInTheDocument(); // rrt.title
    expect(screen.getByText(/^Avtomatik RRT pilləsi bağlıdır/)).toBeInTheDocument();                // rrt.tierOff
    expect(screen.getByText("Əl ilə çağırılıb · leyla")).toBeInTheDocument();                        // rrt.calledBy, {by} filled in
    expect(screen.getByText("Səbəb: Solunum güçlüğü")).toBeInTheDocument();                          // rrt.reason
    const rail = screen.getByRole("navigation", { name: "Əsas menyu" });
    expect(within(rail).getByRole("link", { name: /Sürətli cavab/ })).toHaveAccessibleName(/1 açıq RRT çağırışı/); // rrt.badgeCount
    expect(rawKeys(document.body)).toEqual([]);
    act(() => { mounted.board.clear(); });
  });

  // G2-B5b — «Ertele»: the snoozed group and its row's line are drawn only while an alarm is snoozed, and the dialog
  // (with «Digər»'s explanation box) only on a click, so the sweep above never met them.
  it("the snooze keys resolve on the snoozed group, its row and in the dialog", async () => {
    const mounted = await openAt("/alarms");
    expect(screen.getByRole("heading", { level: 2, name: /Təxirə salınanlar/ })).toBeInTheDocument(); // ertele.groupTitle
    expect(screen.getByText(/^Təxirə salınıb · bitmə /)).toBeInTheDocument();                        // ertele.snoozedRow
    fireEvent.click(screen.getAllByRole("button", { name: /^Təxirə sal:/ })[0]);                       // ertele.snoozeLabel
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "OTHER" } });
    expect(within(dialog).getByRole("textbox")).toBeInTheDocument();                                 // ertele.text, its hint
    expect(rawKeys(document.body)).toEqual([]);
    act(() => { mounted.board.clear(); });
  });

  // G2-B3b — «Vardiya devri»: the note's parts and the summary are drawn only on a row that carries them, and the
  // «Yeni devir» dialog only on its button, so the sweep above met the lists and never the dialog.
  it("the handover screen's keys resolve on its lists, a row's note and summary, and the new handover's dialog", async () => {
    const mounted = await openAt("/devir");
    expect(screen.getByRole("heading", { level: 1, name: "Növbə təhvili" })).toBeInTheDocument();         // devir.title
    for (const name of ["Əks-imzanızı gözləyənlər", "Mənim təhvil verdiklərim", "Son 24 saat ərzində"]) {     // the three lists
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText("V · Vəziyyət")).toBeInTheDocument();                                          // devir.part.situation
    expect(screen.getByText("Sistem xülasəsi · imza anındakı məlumat")).toBeInTheDocument();               // devir.summaryTitle
    expect(screen.getByText("Tamamlanıb")).toBeInTheDocument();                                            // devir.status.COMPLETED
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yeni təhvil" })); await settle(); });
    const dialog = screen.getByRole("dialog", { name: "Yeni təhvil" });
    expect(dialog).toHaveTextContent("Təhvil alacaq şəxs");                                                 // devir.receiver
    expect(within(dialog).getByRole("textbox", { name: "T · Tövsiyə" })).toBeInTheDocument();             // devir.part.recommendation
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  // G2-B1d — Yönetim › Protokol ve etiket: the warning while no start number is set, the form's
  // texts and the fit paragraph, and on none of it a raw key or a UUID.
  it("the Protokol ve etiket keys resolve on its tab", async () => {
    const mounted = await openAt("/admin");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Protokol və etiket" })); await settle(); });
    expect(screen.getByText(/^Başlanğıc nömrəsi daxil edilməyib/)).toBeInTheDocument();  // protokol.notConfigured
    expect(screen.getByText(/^Barkod sığır: /)).toBeInTheDocument();                       // protokol.fits
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  it("the trend charts' keys resolve on the cards, in the big chart, its table and the form", async () => {
    const mounted = await openAt(`/patients/${FIXTURE_ID}`);
    await act(async () => { await settle(); });
    const box = document.querySelector("[data-trends-box]");
    expect(box).toHaveTextContent("NEWS2 +3");                                          // trendsFrameBadge
    expect(box).toHaveTextContent("Xəstənin normasında");                               // trendsOwnNormalPill
    expect(box).toHaveTextContent("↑ +12 (əvvəlkinə görə)");                            // trendsDelta
    expect(box).toHaveTextContent("tək ölçmə");                                         // trendsSingle
    expect(box).toHaveTextContent("Bu kanal üçün ölçmə yoxdur");                        // trendsNoData
    const offenders = [...rawKeys(document.body)];
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("NEWS2 zolağı (yetkin) · mənbə news2-rcp-2017");
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cədvəl" })); await settle(); });
    expect(screen.getByRole("table")).toHaveTextContent("siqnal: news2");
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    // The two-series pressure card: its series labels, the table's channel column and the legend's
    // "MAP is not scored" line, which no single-series card reaches.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Sistolik AT · MAP: böyük qrafiki aç/ })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("MAP NEWS2-də qiymətləndirilmir");      // trendsLegendNoBand
    expect(screen.getByRole("dialog")).toHaveTextContent("işarələrin hamısı oxunmadı");          // trendsLegendMarksTruncated
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cədvəl" })); await settle(); });
    expect(screen.getByRole("table")).toHaveTextContent("Kanal");                       // trendsColChannel
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Bədən hərarəti: böyük qrafiki aç/ })); await settle(); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Bədən hərarəti seyrəldildi: 2400 nöqtədən 2");
    offenders.push(...rawKeys(document.body));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstənin norması…" })); await settle(); });
    const formName = "Xəstənin norması · REA-01 · 2";
    expect(screen.getByRole("dialog", { name: formName })).toHaveTextContent("Boş saxlanılan aralıq silinir.");
    offenders.push(...rawKeys(document.body));
    // Every row emptied over a charted set is a clear, and the footer says so beside Save.
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Nəbz alt" }), { target: { value: "" } });
      fireEvent.change(screen.getByRole("textbox", { name: "Nəbz üst" }), { target: { value: "" } });
      await settle();
    });
    expect(screen.getByRole("dialog", { name: formName })).toHaveTextContent("Bütün sətirlər boşdur: «Yadda saxla»"); // baselineClearsAll
    offenders.push(...rawKeys(document.body));
    expect(offenders).toEqual([]);
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
  });

  // The same anchor for Aşama A's monitor strip: with no strip in the shadow store, every
  // `monitor.*` string sat outside the sweep while it reported the beds, patient, devices and
  // settings screens covered. Each of these is a branch STRIP below has to reach.
  it("the monitor strip's keys resolve on the beds screen, on a card, in the section and in the chip", async () => {
    onlyScreens({ beds: BedsScreen });
    const mounted = await openAt("/beds");
    expect(screen.getByRole("region", { name: "Monitor · təsdiqlənməmiş" })).toBeInTheDocument(); // monitor.title, on S-001's card
    expect(screen.getAllByText("TƏSDİQLƏNMƏMİŞ").length).toBeGreaterThan(1);                      // monitor.tag
    expect(screen.getByRole("heading", { name: "Monitorlar — təsdiqlənməmiş" })).toBeInTheDocument(); // monitor.section
    expect(screen.getAllByText("Bu çarpayıya bağlı xəstə qeydi yoxdur").length).toBeGreaterThan(0); // monitor.noPatient
    expect(screen.getByText(/Bu çarpayıya bir neçə monitor yazılıb/)).toBeInTheDocument();          // monitor.ambiguousMonitors
    expect(screen.getByRole("region", { name: "Təyin edilməmiş cihaz · 192.0.2.28 · Monitor · təsdiqlənməmiş" }))
      .toHaveTextContent("Cihaz→çarpayı cədvəlində çarpayısı müəyyənləşdirilməyib");                 // monitor.unassignedTitle, reasonUnassigned
    expect(screen.getByText("monitor etibarlı dəyər göstərmir")).toBeInTheDocument();               // monitor.invalid
    expect(screen.getByText(/^köhnə · /)).toBeInTheDocument();                                       // monitor.old
    expect(screen.getByText(/\d+\/\d+ məlumat göndərir/).closest("span")).toHaveTextContent("Monitor (təsdiqlənməmiş):"); // monitor.chipTitle, chipCounts
    expect(screen.getByText("Monitor məlumat göndərir; göstəriləcək dəyər yoxdur")).toBeInTheDocument(); // monitor.noValues
    expect(screen.getByText(/^ölçmə ≤ \d\d:\d\d \(10 dəq\)$/)).toBeInTheDocument();                   // monitor.nbpMeasured
    expect(screen.getByText(/^118 bölü 79, orta 92 mmHg; ölçmə \d\d:\d\d/)).toHaveClass("sr-only"); // monitor.nbpSaid
    expect(screen.getByText("ölçmə gözlənilir")).toBeInTheDocument();                                 // monitor.nbpWaiting
    act(() => { mounted.board.clear(); mounted.shadow.clear(); });
  });
});

// ── The same guarantee for the text the sweep above cannot reach ───────────────────────────────
//
// The sweep renders; it therefore covers only what a payload and a few clicks reach. A dialog's
// title, a confirmation's sentence, the words under a refused field — the administration tabs put
// a great deal of their copy exactly there, and no fixture opens every dialog of every tab. So the
// keys are checked WITHOUT rendering: every `t("ns.key")` a live source names as a plain string
// literal must exist in all four languages. It cannot see a key built at run time (`t(\`x.${y}\`)`
// — which is why the live code does not build them), and it says nothing about whether the text is
// RIGHT; it catches the whole class of "this key was renamed, moved or never written", which is
// what printed `beds.identityPending` into a clinical card twice in Wave 3.
//
// WHICH LITERALS. The first version read only a key written straight into `t("…")` or after
// `labelKey:` / `textKey:`, and it missed 80 of the 386 key literals the live sources held
// (measured by the review): every `t(open ? "x.a" : "x.b")`, and every lookup table or
// `{ key: "x.y" }` object — exactly where the administration tabs keep their dialogs' titles and
// their reason maps. So now EVERY string literal outside a comment whose first word is one of this
// build's namespaces is a key, and must exist in all four languages — the permission keys excepted
// (`board.view` is a permission that happens to be namespace-shaped; the roles table prints it on
// purpose) and file names excepted. And a literal in KEY POSITION — anywhere in `t(…)`'s first
// argument, ternary branches included, or after `labelKey:` / `textKey:` — whose first word is
// NOT a namespace fails as well: that is a mistyped namespace, which the first version skipped as
// "not one of ours". Outside key position an unknown first word is not a key — `hmc.lock` is a
// storage key, `hs.ornek` an example login — and is left alone. A key built at run time, or one
// inside a template literal's `${…}`, is still out of reach; the live code does not build them.
const NAMESPACE = new Set(Object.keys(NAMESPACES));
/** A whole string literal that is key-shaped: `"ns.key"`, `'ns.key'` or `` `ns.key` ``. */
const KEY_LITERAL = /(["'`])([a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9_]*)+)\1/g;
/** The characters after which a `/` starts a regular expression rather than a division. */
const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", ";", "{", "+", "-", "*", "%", "~", "^"]);

/** The source with its comments taken out and every string kept whole. A small scanner, not a
 *  parser: it knows the three quotes, both comment forms and a regular-expression literal — which
 *  can hold a quote (`/["']/`) that would otherwise open a "string" swallowing the code after it. */
export function codeOf(text) {
  let out = "";
  let at = 0;
  while (at < text.length) {
    const c = text[at];
    const next = text[at + 1];
    if (c === "/" && next === "/") {
      while (at < text.length && text[at] !== "\n") at += 1;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end === -1 ? text.length : end + 2;
      out += " ";
    } else if (c === "/" && (REGEX_AFTER.has(out.trimEnd().slice(-1)) || /(?:=>|\breturn)$/.test(out.trimEnd()))) {
      let inClass = false;
      at += 1;
      while (at < text.length && text[at] !== "\n" && (inClass || text[at] !== "/")) {
        if (text[at] === "\\") at += 1;
        else if (text[at] === "[") inClass = true;
        else if (text[at] === "]") inClass = false;
        at += 1;
      }
      at += 1;
      while (at < text.length && /[a-z]/i.test(text[at])) at += 1;
      out += " ";
    } else if (c === "\"" || c === "'" || c === "`") {
      let literal = c;
      at += 1;
      while (at < text.length && text[at] !== c) {
        literal += text[at] === "\\" ? text.slice(at, at + 2) : text[at];
        at += text[at] === "\\" ? 2 : 1;
      }
      out += `${literal}${c}`;
      at += 1;
    } else {
      out += c;
      at += 1;
    }
  }
  return out;
}

/** The text of every key position in `code`: each `t(` call's first argument, read to its
 *  top-level `,` or `)` with strings skipped, and the literal after each `labelKey:` / `textKey:`. */
function keyPositions(code) {
  const out = [];
  for (const call of code.matchAll(/(?<![\w$.])t\(/g)) {
    let depth = 0;
    let at = call.index + call[0].length;
    const start = at;
    for (; at < code.length; at += 1) {
      const ch = code[at];
      if (ch === "\"" || ch === "'" || ch === "`") {
        at = code.indexOf(ch, at + 1);
        if (at === -1) break;
      } else if ("([{".includes(ch)) depth += 1;
      else if (")]}".includes(ch)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (ch === "," && depth === 0) break;
    }
    out.push(code.slice(start, at === -1 ? code.length : at));
  }
  for (const named of code.matchAll(/\b(?:labelKey|textKey):\s*(["'`][^"'`]*["'`])/g)) out.push(named[1]);
  return out;
}

/** Every problem with the keys one source names, as `"<file> → <key> …"` lines. */
export function keyProblems(text, file) {
  const code = codeOf(text);
  const problems = [];
  for (const [, , key] of code.matchAll(KEY_LITERAL)) {
    if (!NAMESPACE.has(key.split(".")[0]) || PERMISSION_KEY.has(key) || A_FILE.test(key)) continue;
    const missing = LANG_CODES.filter((lang) => !(key in DICTIONARIES[lang]));
    if (missing.length > 0) problems.push(`${file} → ${key} (${missing.join(", ")})`);
  }
  for (const position of keyPositions(code)) {
    for (const [, , key] of position.matchAll(KEY_LITERAL)) {
      // A permission key can sit in `t()`'s argument without being a text — the roles tab asks
      // `t(hasPerm(perms, "groups.manage") ? … : …)` — and is exempt there too.
      if (!NAMESPACE.has(key.split(".")[0]) && !PERMISSION_KEY.has(key) && !A_FILE.test(key)) {
        problems.push(`${file} → ${key}: not a namespace`);
      }
    }
  }
  return problems;
}

describe("every key the live sources name exists in all four languages", () => {
  const LIVE = path.join(HERE, "live");
  /** Every `.js`/`.jsx` under src/live/ that ships — tests and test utilities excluded (a test may
   *  name a key that does not exist; this file's own detector fixtures do), and the dictionaries
   *  themselves, which DEFINE keys and whose values are prose. */
  function sources(dir) {
    const out = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) out.push(...sources(full));
      else if (/\.jsx?$/.test(item.name) && !/\.test\.jsx?$/.test(item.name) && !/\.testutil\.jsx?$/.test(item.name)) out.push(full);
    }
    return out;
  }
  const FILES = sources(LIVE).filter((file) => !file.includes(path.join("i18n", "strings")));
  const ALL = LANG_CODES.join(", ");

  it("found sources to read, and reads every way a key is named — and nothing a comment says", () => {
    expect(FILES.length).toBeGreaterThan(40);
    const sample = [
      'const a = t(open ? "admin.title" : "admin.nopeOne");',                  // a ternary
      'const LABEL = { users: "admin.readUsers", other: "admin.nopeTwo" };',   // a lookup table
      'const b = { labelKey: "admin.tabUsers" }; const c = t("adimn.title");', // a mistyped namespace
      '// t("admin.nopeInAComment") is prose, and so is /* labelKey: "admin.nopeInABlock" */',
      "{/* t(\"admin.nopeInJsx\") */}",
      'const re = /["\']/g; const d = t("admin.nopeAfterARegex");',             // a quote in a regex
      'const store = "hmc.lock"; const perm = "board.view"; const file = "api/board.py";',
      'const e = t(hasPerm(perms, "groups.manage") ? "admin.title" : "admin.loading");', // a permission, asked inside t()
      "const built = `admin.${kind}`;",                                         // run time: out of reach
    ].join("\n");
    expect(keyProblems(sample, "sample.jsx").sort()).toEqual([
      "sample.jsx → adimn.title: not a namespace",
      `sample.jsx → admin.nopeAfterARegex (${ALL})`,
      `sample.jsx → admin.nopeOne (${ALL})`,
      `sample.jsx → admin.nopeTwo (${ALL})`,
    ]);
  });

  it("names no key the dictionaries do not have, and no namespace this build does not have", () => {
    const problems = FILES.flatMap((file) => keyProblems(fs.readFileSync(file, "utf8"), path.relative(LIVE, file)));
    expect(problems, `a live source names a key no dictionary has:\n${problems.join("\n")}`).toEqual([]);
  });
});
