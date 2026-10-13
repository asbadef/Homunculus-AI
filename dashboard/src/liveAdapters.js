// Maps the API's board payload onto the patient shape the clinical components render.
//
// The split this file encodes: the engine supplies what a machine measured — vitals, alerts,
// risk. Everything else on a patient record (name, national ID, bed, diagnosis, admitting
// clinician) is typed in by clinicians and is not in this payload.
//
// The optional identity block now supplies the HIS name and bed; other fields stay null.
// An invented name or bed number on a
// clinical board is worse than a blank one: a blank prompts someone to fill it in, a plausible
// value gets trusted and acted on.

/**
 * Whole years from an ISO date of birth, or null.
 *
 * Derived rather than stored: an age is only true on the day it was written down, and a stored
 * one silently ages wrong. Returns null for anything unparseable or in the future — a bad date
 * of birth must not become a confident number on a clinical card.
 */
export function ageFromBirthDate(birthDate, today = new Date()) {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime()) || born > today) return null;
  let years = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) years -= 1;
  return years >= 0 && years < 130 ? years : null;
}

/**
 * A patient the HIS has admitted who has not been taken onto a bed here yet.
 *
 * These are the cards the admission form should offer to CONFIRM rather than make someone
 * type from scratch: the hospital already said who they are, where they are and what they are
 * being treated for.
 */
export function awaitingLocalAdmission(patients = []) {
  return patients.filter((p) => p?.source === "comed" && !p?.bedId
                                && p?.identityState !== "discharged");
}

/** One board entry -> one patient record. */
export function patientFromBoard(entry) {
  const latest = entry?.latest ?? {};
  const identity = entry?.identity ?? null;
  return {
    patient_id: entry?.patient_id ?? null,
    risk: entry?.risk ?? null,
    alerts: entry?.alerts ?? [],
    // `??` and not `||`: a measured 0 is a clinical finding, not a missing value.
    vitals: {
      hr: latest.heart_rate ?? null,
      map: latest.map ?? null,
      sbp: latest.sbp ?? null,
      spo2: latest.spo2 ?? null,
      temp: latest.temperature ?? null,
      rr: latest.resp_rate ?? null,
    },
    lactate: latest.lactate ?? null,
    sofa: latest.sofa ?? null,
    // When each channel was last measured, ISO-8601 per signal. On an on-prem deployment nobody
    // can look at the bridge from here, so this is how a screen tells a quiet ward from a feed
    // that stopped an hour ago — the two look identical without it.
    measuredAt: latest.at ?? {},
    // The engine's NEWS2, carried through so the UI displays it rather than scoring again.
    // {total, partial, missing[], red_param, breakdown{}} — or null on a card that has never
    // had an observation, which must not read as "NEWS2 0".
    news2: latest.news2 ?? null,
    // What the Sepsis-3 criterion is being judged against on this patient:
    // {suspected_infection, sofa, baseline_sofa, baseline_assumed, rise}.
    // `suspected_infection: null` means nobody has charted either way — and until someone does,
    // the engine evaluates no sepsis rule at all, so a quiet card is not a reassuring card.
    sepsis: entry?.sepsis ?? null,
    // Infusions, the 1-hour antibiotic clock, and the two numbers a pharmacist reads them
    // against: {pressors, on_pressor, antibiotic_given, antibiotic_at, antibiotic_clock,
    // creatinine, weight_kg}. `antibiotic_given: null` means nobody charted it either way.
    meds: entry?.meds ?? null,
    // HIS demographics only; missing fields stay null.
    display_name: identity?.display_name || null,
    // Sex and date of birth come from the HIS when it sent them. They are here so the admission
    // form can be confirmed rather than retyped — "unknown" is left as null so a missing value
    // never renders as a stated one.
    sex: identity?.sex && identity.sex !== "unknown" ? identity.sex : null,
    birthDate: identity?.birth_date || null,
    age: ageFromBirthDate(identity?.birth_date),
    ageDays: null,
    isNeonate: false,
    tc_no: null,
    tcMasked: null,
    phone: null,
    address: null,
    mrn: null,
    protocolNo: identity?.patient_id ?? null,
    // The bed and unit the BOARD resolved this card onto (api/board.py `_bed_resolution`): our own
    // ids from the site's HIS-location table, not the HIS's words — these are exactly the keys the
    // server's scope filter matches against (`sees_patient`), so a screen that filters or explains
    // by unit must read the same ones. Null when the table does not cover the location: that card
    // belongs to no unit, which is why a scoped session cannot see it at all.
    bedId: identity?.bed_id || null,
    bedLabel: identity?.bed_label || null,
    unitId: identity?.unit_id || null,
    // Whether the table covered it (false also when there is no table), and the normalised HIS
    // location that was looked up — the line an operator adds to the table. A screen can turn
    // "this patient is on no bed" into a fixable instruction instead of a blank.
    bedMatched: identity?.bed_matched === true,
    bedKey: identity?.bed_key || null,
    diagnosis: null,
    admittedBy: null,
    admittedAtMs: null,
    // ICD-10 the HIS sent with the admission (ADT DG1). Empty means the feed said nothing —
    // never that the patient has no diagnoses — so the card must not render "none".
    hisDiagnoses: identity?.diagnoses ?? [],
    identityState: identity?.state ?? null,
    identityUpdatedAt: identity?.updated_at ?? null,
    source: identity?.source || "device",
  };
}

/** The whole /patients response -> patient records. */
export function patientsFromBoard(payload) {
  const list = Array.isArray(payload?.patients) ? payload.patients : [];
  return list.map(patientFromBoard);
}

// -----------------------------------------------------------------------------------------------
// Board/alert synthesis. The shapes are the old workspace's: its BedBoard and AlarmPage were
// written against clinicalDemo.js's simulated `beds`/`alerts`, and these functions gave them the
// same shapes from live patients. That workspace went in G1-16 (it can be read at e4cdf15); the
// live board store reads `alertsFromPatients`, and the shapes are otherwise kept as they were.

/** One live bed per patient. There is no clinician-assigned bed label yet (Slice 2), so the label
 *  is the patient id — that IS the identifier the HL7 feed keys a patient by, so it is honest
 *  rather than invented. unitId/unitName/roomId/roomLabel stay null for the same reason. */
export function bedsFromPatients(patients) {
  const list = Array.isArray(patients) ? patients : [];
  return list.map((p) => ({
    id: `live-bed-${p.patient_id}`,
    label: p.bedLabel || p.patient_id,
    unitId: null,
    unitName: null,
    roomId: null,
    roomLabel: null,
    state: "OCCUPIED",
    patientId: p.patient_id,
  }));
}

// Engine severity (info|low|moderate|high|critical) -> the TIER the old workspace's alarm UI
// coloured, sorted and gated snoozing by (clinicalDemo.js's TIER_TO_SEV, inverted). The live UI
// reads `severity`.
const SEVERITY_TO_TIER = {
  critical: "CRITICAL", high: "HIGH", moderate: "MEDIUM", low: "LOW", info: "INFO",
};

/** ISO-8601 -> epoch milliseconds, or null if absent/unparseable. Never fabricate a time. */
function msFromTimestamp(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Flattens every patient's alerts into one flat list (the board store's `alerts`). `id` is
 *  "<patient_id>::<kind>" — a delimiter that cannot appear in a kind, so it round-trips
 *  unambiguously.
 *
 *  A real alarm's age is WALL-CLOCK time since the backend first saw it: `firstSeenAtMs` (epoch
 *  ms), null when the payload does not say — then the UI shows no age rather than an invented
 *  one. `firedAtSec` stays null: it was the old workspace's simulation clock, which ran at 60x and
 *  aged a real alarm a minute per second.
 *
 *  Escalation-chain fields (`currentStep`, `events`, `snooze`, `mutedUntil`) stay at their "just
 *  fired" defaults: escalation for live alerts happens server-side (the engine's own escalation
 *  loop). `source: "device"` marks that explicitly — the old workspace's AlertCard drew its own
 *  local escalation countdown for anything without it. */
export function alertsFromPatients(patients) {
  const list = Array.isArray(patients) ? patients : [];
  const out = [];
  for (const p of list) {
    for (const a of p.alerts ?? []) {
      out.push({
        id: `${p.patient_id}::${a.kind}`,
        patientId: p.patient_id,
        // Same honesty rule as bedsFromPatients: the patient id IS the device's bed identifier.
        bedLabel: p.bedLabel || p.patient_id,
        kind: a.kind ?? null,
        tier: SEVERITY_TO_TIER[a.severity] ?? null,
        severity: a.severity ?? null,
        urgency: a.urgency ?? null,
        summary: a.summary ?? null,
        // WHY the engine raised it, and what it rests on (reco/engine.py Alert): the reasoning,
        // the vault sources behind it, what it suggests considering, how certain that is, whether
        // the patient's own charted normal lowered it and which inputs were already stale. The
        // patient screen shows these; nothing here is translated or rewritten — it is the engine's
        // own text, and a screen that paraphrased clinical reasoning would be writing its own.
        // Absent fields stay null / empty: an alert carries no reasoning rather than a made-up one.
        clinicalReasoning: a.clinical_reasoning ?? null,
        evidence: Array.isArray(a.supporting_evidence) ? a.supporting_evidence : [],
        actions: Array.isArray(a.recommended_actions) ? a.recommended_actions : [],
        confidence: a.confidence ?? null,
        downgraded: a.downgraded === true,
        chronicContext: a.chronic_context || null,
        staleInputs: Array.isArray(a.stale_inputs) ? a.stale_inputs : [],
        status: a.acknowledged ? "ACKNOWLEDGED" : "FIRED",
        // WHO and WHEN, for an alarms row. **These two are the pair a screen reads**, the instant
        // in milliseconds on the wall clock. `ack` below is a presence flag the board store tests
        // (`needsAnswer`); it no longer carries a time of its own (G1-16).
        ackBy: a.acknowledged ? (a.acknowledged_by ?? null) : null,
        ackAtMs: a.acknowledged ? msFromTimestamp(a.acknowledged_at) : null,
        escalated: !!a.escalated,
        firstSeenAtMs: msFromTimestamp(a.first_seen_at),
        firedAtSec: null,
        currentStep: "NONE",
        events: [],
        // Only `by` is known: the backend does not persist a reason/note yet (Slice 1's AckStore
        // keeps only {by, at}). Inventing them would look like a clinician's own words when they
        // are not. Until G1-16 this also carried the instant in SECONDS (`atSec`) for the old
        // workspace's time-to-acknowledge — the same time in a second unit, which
        // `elapsed(ack.atSec)` would have read as about 56 years. The instant is `ackAtMs`.
        ack: a.acknowledged
          ? { by: a.acknowledged_by ?? null, reason: null, note: null }
          : null,
        snooze: null,
        mutedUntil: null,
        auto: false,
        trigger: null,
        source: "device",
      });
    }
  }
  return out;
}
