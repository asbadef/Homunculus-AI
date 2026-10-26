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
// says so (`reading()`), and one that wants a name says so (`identity()`).
//
// THE CONVENTION, because three parallel arms will copy the nearest example. The two arguments a
// fixture almost always varies are POSITIONAL, and everything else goes in a trailing override
// object:
//
//     entry("S-001", [alarm("news2", "critical")], { identity: identity() })
//     board([entry("S-001"), entry("S-002")], { scope: scopedTo(["REA-01"]) })
//
// Both builders REFUSE the other shape loudly rather than accept it, which is the whole reason the
// guards are here: `entry("S-001", { alerts: [...] })` used to spread an object where an array was
// expected and leave the card with `alerts: []` and a junk `"0"` key — a fixture that silently did
// not hold the alarm the test was about. A test-only helper may throw; a silent wrong fixture
// cannot be allowed to pass.

/** When the fixtures are "now". A fixed instant, so an age in a test is the age the test wrote. */
export const NOW = Date.parse("2026-10-08T10:00:00Z");
/** An ISO instant this many seconds before NOW. */
export const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

/** `latest.at` with each of the six monitor channels measured `seconds` ago — TIMESTAMPS ONLY, for
 *  a test whose subject is the feed (is this bed reporting?) and not the numbers. A card built from
 *  this has been measured and has no values, which is a real state (`hasMeasurement` true,
 *  `measuredVitals` empty) but rarely the one a screen test means: for a card that shows numbers
 *  use `reading()`, which cannot let the two disagree.
 *
 *  Note it is not "every bed-alive channel": `temperature` is in here and is deliberately NOT one
 *  (`feedHealth.CHANNELS`, `continuous: false` — a spot measurement vouches for no feed), and
 *  `lactate` is in neither. The five that answer "is this bed reporting" are heart rate, SpO2,
 *  systolic, mean and respiration. */
export const measured = (seconds = 30) => ({
  heart_rate: ago(seconds), resp_rate: ago(seconds), spo2: ago(seconds),
  sbp: ago(seconds), map: ago(seconds), temperature: ago(seconds),
});

/** A card's readings and their instants together: `reading({ heart_rate: 96, spo2: 91 }, 30)` gives
 *  `{ vitals, at }` to spread into `entry`'s override, with a timestamp for exactly the channels
 *  that have a value. Built as one thing because built as two it diverged — a "measured" fixture
 *  with timestamps and no numbers, or numbers with no age — and a screen whose job is to print a
 *  value beside its age cannot be tested by a card that holds only one of them. */
export function reading(values, seconds = 30) {
  const at = {};
  for (const key of Object.keys(values)) at[key] = ago(seconds);
  return { vitals: { ...values }, at };
}

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
 *  with the acknowledgement store (`_merge_alert`). `kind` and `severity` are positional — they
 *  are what a test varies — and everything else goes in the override. */
export function alarm(kind = "news2", severity = "high", over = {}) {
  if (typeof severity !== "string") {
    // The example names the PAYLOAD's field. `acknowledged` is what `/patients` carries and what
    // `alertsFromPatients` reads; `ack` is the adapter's OUTPUT shape, so `{ack: true}` here would
    // be a stray key that leaves the alarm FIRED — and this message is where three arms will learn
    // the convention, so it has to teach the right field.
    throw new TypeError("alarm(kind, severity, over): severity is a string — alarm('news2', 'high', {acknowledged: true})");
  }
  return {
    kind, severity, urgency: "immediate",
    summary: `${kind} ölçütü karşılandı`,
    clinical_reasoning: null, supporting_evidence: [], recommended_actions: [], confidence: null,
    downgraded: false, chronic_context: "", stale_inputs: [],
    acknowledged: false, acknowledged_by: null, acknowledged_at: null,
    first_seen_at: ago(247), escalated: false, resolved_at: null, ...over,
  };
}

/** The engine's own `risk` for a card: the highest severity among its active alarms, "none" when
 *  there is none (api/board.py `_risk`). `entry` derives the card's risk this way instead of
 *  defaulting it, because a fixture with a HIGH alarm and `risk: "none"` would have rendered "no
 *  finding" beside a high alarm — a screen state the engine cannot produce, and exactly the kind
 *  of card a test must not be able to assert against by accident. A test that wants the
 *  contradiction on purpose still passes `{ risk: … }` and says so. */
const SEVERITY_RANK = ["info", "low", "moderate", "high", "critical"];
export function riskOf(alarms) {
  // A latched alarm (`resolved_at` set, G2-A1) is a to-do, not a risk: the engine computes `risk`
  // from the firing alarms only (api/board.py, D10), and so does this.
  const list = (Array.isArray(alarms) ? alarms : []).filter((a) => a?.resolved_at == null);
  // A severity this build does not know comes FIRST, not last, and is passed through raw. The UI
  // treats an unknown severity as possibly-the-worst — `waitingAlarms` sorts it ahead of critical,
  // and `riskStyle` gives it the attention look and "Naməlum risk: x" — so a fixture must not
  // quietly turn it into something calmer. Filtering it out (what this did) derived `risk: "none"`
  // for a card holding one, and `RiskPill` then read "Tapıntı yoxdur" beside an alarm the bell was
  // counting under `unknown`: the exact contradiction `riskOf` exists to prevent, reintroduced for
  // the one severity where it matters most. And the arms will build this card deliberately, to
  // test that an unknown severity sorts first.
  const unknown = list.find((a) => !SEVERITY_RANK.includes(a?.severity));
  if (unknown) return unknown.severity ?? null;
  const ranked = list.map((a) => SEVERITY_RANK.indexOf(a.severity));
  return ranked.length === 0 ? "none" : SEVERITY_RANK[Math.max(...ranked)];
}

/** The engine's NEWS2, in the shape the board carries it (`_news2`). `total` is always a number —
 *  NEWS2 scores a missing parameter as 0 — so `partial` and `missing` are what say whether that
 *  number is the whole story. G2-A2: `stale`, `assumed` and the stamps default to empty — a test
 *  that is about them states them. */
export const news2 = (over = {}) => ({
  total: 6, partial: false, missing: [], red_param: false, breakdown: {},
  stale: [], assumed: [], measured_at: {}, fresh_until: {},
  last_charted: { air_or_oxygen: null, consciousness: null }, ...over,
});

/** One board card. By default: measured by nothing, named by nobody, no alarm, risk "none" — the
 *  card that every "a blank is not a finding" rule is about.
 *
 *  `alarms` is the second argument because it is what a test varies most, and the card's `risk`
 *  is DERIVED from it (`riskOf`) unless the override states one. */
export function entry(id = "S-001", alarms = [], over = {}) {
  if (!Array.isArray(alarms)) {
    throw new TypeError("entry(id, alarms, over): the second argument is the alarm ARRAY — entry('S-001', [alarm()], {identity: identity()})");
  }
  const { vitals = {}, at = {}, score = null, sofa = null, lactate = null, ...rest } = over;
  return {
    patient_id: id,
    identity: null,
    risk: riskOf(alarms),
    alerts: alarms,
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
