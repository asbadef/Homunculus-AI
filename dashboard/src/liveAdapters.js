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
      spo2: latest.spo2 ?? null,
      temp: latest.temperature ?? null,
      rr: latest.resp_rate ?? null,
    },
    lactate: latest.lactate ?? null,
    sofa: latest.sofa ?? null,
    // HIS demographics only; missing fields stay null.
    display_name: identity?.display_name || null,
    sex: null,
    age: null,
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

/** ISO-8601 -> epoch milliseconds, or null if absent/unparseable. */
function msFromTimestamp(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Flattens every patient's alerts into the flat list AlarmPage/AlertCard and the audio/push
 *  effects in ClinicalDemo.jsx read. `id` is "<patient_id>::<kind>" — a delimiter that cannot
 *  appear in a kind, so it round-trips through acknowledgeAlert unambiguously (see liveStore.js).
 *
 *  A real alarm's age is WALL-CLOCK time since the backend first saw it: `firstSeenAtMs` (epoch
 *  ms), null when the payload does not say — then the UI shows no age rather than an invented
 *  one. Nothing is put on the simulation's clock (`firedAtSec` is null): that clock runs at 60x
 *  and would age a real alarm a minute per second.
 *
 *  Escalation-chain fields (`currentStep`, `events`, `snooze`, `mutedUntil`) stay at their "just
 *  fired" defaults: escalation for live alerts happens server-side (the engine's own escalation
 *  loop). `source: "device"` marks that explicitly, so AlertCard shows none of the simulation's
 *  local escalation countdown, stages or chain for it. */
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
        status: a.acknowledged ? "ACKNOWLEDGED" : "FIRED",
        escalated: !!a.escalated,
        firstSeenAtMs: msFromTimestamp(a.first_seen_at),
        firedAtSec: null,
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
