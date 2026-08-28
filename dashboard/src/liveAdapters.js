// Maps the API's board payload onto the patient shape the clinical components render.
//
// The split this file encodes: the engine supplies what a machine measured — vitals, alerts,
// risk. Everything else on a patient record (name, national ID, bed, diagnosis, admitting
// clinician) is typed in by clinicians and is not in this payload.
//
// Those fields are set to null, deliberately and explicitly. An invented name or bed number on a
// clinical board is worse than a blank one: a blank prompts someone to fill it in, a plausible
// value gets trusted and acted on.

/** One board entry -> one patient record. */
export function patientFromBoard(entry) {
  const latest = entry?.latest ?? {};
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
    // Awaiting a clinician. Null, never a placeholder that could be mistaken for data.
    display_name: null,
    sex: null,
    age: null,
    ageDays: null,
    isNeonate: false,
    tc_no: null,
    tcMasked: null,
    phone: null,
    address: null,
    mrn: null,
    protocolNo: null,
    bedId: null,
    bedLabel: null,
    unitId: null,
    diagnosis: null,
    admittedBy: null,
    admittedAtMs: null,
    source: "device",
  };
}

/** The whole /patients response -> patient records. */
export function patientsFromBoard(payload) {
  const list = Array.isArray(payload?.patients) ? payload.patients : [];
  return list.map(patientFromBoard);
}
