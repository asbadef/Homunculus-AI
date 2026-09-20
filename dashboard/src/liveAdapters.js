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
    bedId: null,
    bedLabel: identity?.bed_label || null,
    unitId: null,
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
// Board/alert synthesis: BedBoard and AlarmPage were written against clinicalDemo.js's simulated
// `beds`/`alerts` shapes and stay that way (see ClinicalDemo.jsx's `BedBoard`/`AlertCard`). Rather
// than teach those components a second data language, these functions synthesize the SAME shapes
// from live patients, so live data renders through unmodified components.

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

// Engine severity (theme.js scale: info|low|moderate|high|critical) -> the TIER the alarm UI
// colors, sorts and gates snoozing by. Mirrors clinicalDemo.js's TIER_TO_SEV, inverted.
const SEVERITY_TO_TIER = {
  critical: "CRITICAL", high: "HIGH", moderate: "MEDIUM", low: "LOW", info: "INFO",
};

/** ISO-8601 -> epoch seconds, or null if absent/unparseable. Never fabricate a time. */
function secondsFromTimestamp(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/** Translate a real, wall-clock "first seen" instant into the SIMULATION clock's coordinate
 *  system. `AlertCard` (ClinicalDemo.jsx) computes `elapsed = state.clockSec - alert.firedAtSec`,
 *  where `clockSec` is the simulation's own small local clock (it starts near zero), not wall
 *  time. Handing that a raw Unix timestamp makes elapsed a huge negative number for every real
 *  alert. Placing firedAtSec at "nowClockSec, minus however many real seconds ago this fired"
 *  keeps elapsed correct and lets it grow normally as the sim clock ticks between refreshes.
 *
 *  Missing `first_seen_at` -> nowClockSec (elapsed 0): honest for an alert we just learned about,
 *  rather than fabricating a fired time. */
function firedAtSecOnSimClock(firstSeenAt, nowClockSec) {
  const firedEpochSec = secondsFromTimestamp(firstSeenAt);
  if (firedEpochSec == null) return nowClockSec;
  const nowEpochSec = Date.now() / 1000;
  return nowClockSec - Math.max(0, nowEpochSec - firedEpochSec);
}

/** Flattens every patient's alerts into the flat list AlarmPage/AlertCard and the audio/push
 *  effects in ClinicalDemo.jsx read. `id` is "<patient_id>::<kind>" — a delimiter that cannot
 *  appear in a kind, so it round-trips through acknowledgeAlert unambiguously (see liveStore.js).
 *
 *  `nowClockSec` is the simulation clock at the moment of synthesis (the store passes
 *  `base.getState().clockSec`) — see firedAtSecOnSimClock above for why firedAtSec needs it.
 *
 *  Escalation-chain fields (`currentStep`, `events`, `snooze`, `mutedUntil`) stay at their "just
 *  fired" defaults: escalation for live alerts happens server-side (the engine's own escalation
 *  loop), not by replaying the simulation's local clock over data that isn't on that clock.
 *  `source: "device"` marks that explicitly, so AlertCard can suppress the local escalation
 *  countdown it would otherwise compute from the simulation's own thresholds. */
export function alertsFromPatients(patients, nowClockSec = 0) {
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
        status: a.acknowledged ? "ACKNOWLEDGED" : "FIRED",
        escalated: !!a.escalated,
        firedAtSec: firedAtSecOnSimClock(a.first_seen_at, nowClockSec),
        currentStep: "NONE",
        events: [],
        // Only `by` and `atSec` are known: the backend does not persist a reason/note yet (Slice
        // 1's AckStore keeps only {by, at}). Inventing them would look like a clinician's own
        // words when they are not.
        ack: a.acknowledged
          ? { by: a.acknowledged_by ?? null, reason: null, note: null,
              atSec: secondsFromTimestamp(a.acknowledged_at) }
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
