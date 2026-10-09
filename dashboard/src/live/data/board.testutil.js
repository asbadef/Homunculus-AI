// Test-only: synthetic board payloads in the API's own `/patients` shape (homunculus-engine
// api/board.py `patient_board` / `identity_only_board`), for the three clinical screens of Wave 3
// and the board store.
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6). Ids are `S-001`…, units `REA-01` / `NICU-01`,
// names "Ayşe Sentetik", the hospital "Sentetik Hastane" — the house style of the earlier waves.
// Nothing in this file may be replaced with anything taken from a real ward, a capture or an
// export, not even "just to reproduce a bug".
//
// The builders are deliberately explicit about absence: `entry()` gives a card whose channels have
// never been measured and whose identity the HIS has not sent, because that is the card every
// honesty rule turns on — a blank must not read as a finding. A test that wants a measured card
// says so (`measured()`), and one that wants a name says so (`identity()`).

/** When the fixtures are "now". A fixed instant, so an age in a test is the age the test wrote. */
export const NOW = Date.parse("2026-10-08T10:00:00Z");
/** An ISO instant this many seconds before NOW. */
export const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

/** `latest.at` with every continuous channel measured `seconds` ago (freshness.js SIGNAL_KEYS). */
export const measured = (seconds = 30) => ({
  heart_rate: ago(seconds), resp_rate: ago(seconds), spo2: ago(seconds),
  sbp: ago(seconds), map: ago(seconds), temperature: ago(seconds),
});

/** The identity block the HIS sends, resolved onto one of our beds (api/board.py
 *  `_bed_resolution`). `bed_matched: false` with a `bed_key` is the honest unmatched case: the
 *  patient keeps a card but belongs to no unit, so no scope grant can reach them. */
export const identity = (over = {}) => ({
  patient_id: "S-001", display_name: "Ayşe Sentetik", bed_label: "REA-01 · 2",
  state: "admitted", source: "comed", updated_at: ago(600), diagnoses: [],
  birth_date: null, sex: null,
  bed_id: "REA-01-2", unit_id: "REA-01", bed_matched: true, bed_key: "REA^01^2", ...over,
});

/** One alarm as the board carries it: the engine's own severity, summary and reasoning, merged
 *  with the acknowledgement store (`_merge_alert`). */
export const alarm = (kind = "news2", over = {}) => ({
  kind, severity: "high", urgency: "immediate",
  summary: `${kind} ölçütü karşılandı`,
  clinical_reasoning: null, supporting_evidence: [], recommended_actions: [], confidence: null,
  downgraded: false, chronic_context: "", stale_inputs: [],
  acknowledged: false, acknowledged_by: null, acknowledged_at: null,
  first_seen_at: ago(247), escalated: false, ...over,
});

/** The engine's NEWS2, in the shape the board carries it (`_news2`). `total` is always a number —
 *  NEWS2 scores a missing parameter as 0 — so `partial` and `missing` are what say whether that
 *  number is the whole story. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {}, ...over,
});

/** One board card. By default: measured by nothing, named by nobody, no alarm, risk "none" — the
 *  card that every "a blank is not a finding" rule is about. */
export function entry(id = "S-001", over = {}) {
  const { vitals = {}, at = {}, score = null, sofa = null, lactate = null, ...rest } = over;
  return {
    patient_id: id,
    identity: null,
    risk: "none",
    alerts: [],
    latest: {
      heart_rate: null, resp_rate: null, spo2: null, sbp: null, map: null, temperature: null,
      lactate, sofa, at, news2: score, ...vitals,
    },
    sepsis: { suspected_infection: null, sofa: null, baseline_sofa: null, baseline_assumed: true, rise: 0 },
    meds: null,
    ...rest,
  };
}

/** A whole `/patients` answer. `scope`/`scope_note` default to an unrestricted session, which is
 *  what an administrator sees; a scoped one passes its own. */
export function board(patients = [], over = {}) {
  return {
    patients,
    scope: { unrestricted: true, reason: "unrestricted_role", unit_ids: [], bed_ids: [], own_patients: 0, hidden: 0, unresolved_hidden: 0 },
    scope_note: null,
    ...over,
  };
}

/** The scope block of a session restricted to units, with the counts `/patients` sends. */
export function scopedTo(unitIds, over = {}) {
  return {
    unrestricted: false, reason: "assigned", unit_ids: unitIds, bed_ids: [], own_patients: 0,
    hidden: 0, unresolved_hidden: 0, ...over,
  };
}
