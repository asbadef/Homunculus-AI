// src/live/screens/kabul/admitForm.js — the admission form's values, what is still missing, and
// the body POST /admissions takes (Group 2 · B1a, spec §5.2). Pure.
//
// The server checks the same rules again (homunculus-engine admission/form.py) and answers
// `field_invalid:<field>`: this copy exists so that "Kabul et" can stay held, and the side panel
// can NAME each missing field, before anything is sent. It holds presence and format only — no
// clinical bound: a weight the engine will not chart is the server's refusal, said on the toast.

// Every choice with the key of its words, written out: a key assembled at run time is one no
// check can see (strings.test.js, rawKeys.test.jsx).
const choices = (pairs) => Object.freeze(pairs.map(([value, key]) => Object.freeze({ value, key })));

/** The prototype's `ADM_T`, as the engine stores it. */
export const ADMISSION_TYPES = choices([["MEDICAL", "kabul.type.medical"], ["SURGICAL", "kabul.type.surgical"],
  ["ICU", "kabul.type.icu"], ["PROCEDURE", "kabul.type.procedure"]]);
export const BLOOD_GROUPS = choices([["UNKNOWN", "kabul.blood.unknown"], ["A_POS", "kabul.blood.aPos"],
  ["A_NEG", "kabul.blood.aNeg"], ["B_POS", "kabul.blood.bPos"], ["B_NEG", "kabul.blood.bNeg"],
  ["AB_POS", "kabul.blood.abPos"], ["AB_NEG", "kabul.blood.abNeg"], ["O_POS", "kabul.blood.oPos"],
  ["O_NEG", "kabul.blood.oNeg"]]);
/** The comorbidity codes the engine reads (rules/patient_relative.py); "dementia" stands for
 *  dementia and chronic confusion together, as the form's one checkbox says. */
export const COMORBIDITIES = choices([["copd", "kabul.comorbidity.copd"],
  ["chronic_respiratory_failure", "kabul.comorbidity.respiratoryFailure"],
  ["chronic_oxygen", "kabul.comorbidity.homeOxygen"], ["dementia", "kabul.comorbidity.dementia"]]);
export const RELATIONS = choices([["spouse", "kabul.relation.spouse"], ["mother", "kabul.relation.mother"],
  ["father", "kabul.relation.father"], ["child", "kabul.relation.child"],
  ["sibling", "kabul.relation.sibling"], ["other", "kabul.relation.other"]]);
export const NATIONALITIES = choices([["az", "kabul.nat.az"], ["tr", "kabul.nat.tr"], ["ru", "kabul.nat.ru"],
  ["ge", "kabul.nat.ge"], ["ir", "kabul.nat.ir"], ["other", "kabul.nat.other"]]);
export const SEXES = choices([["female", "kabul.sex.female"], ["male", "kabul.sex.male"]]);
/** Where the patient came from (admission/models.py SourceOfAdmission); optional. */
export const SOURCES = choices([["EMERGENCY", "kabul.source.emergency"],
  ["ELECTIVE_SURGERY", "kabul.source.electiveSurgery"], ["TRANSFER_INTERNAL", "kabul.source.transferInternal"],
  ["TRANSFER_EXTERNAL", "kabul.source.transferExternal"], ["OTHER", "kabul.source.other"]]);
export const CONSENTS = choices([["KVKK_SIGNED", "kabul.consent.signed"], ["UNCONSCIOUS_LATER", "kabul.consent.later"]]);
/** What the answer's `engine` part names, when it did not land. */
export const ENGINE_FAILED = Object.freeze({
  board: "kabul.engineFailed.board", weight: "kabul.engineFailed.weight", profile: "kabul.engineFailed.profile",
});

/** No nationality is chosen for the nurse: a default is a value nobody chose that looks like one. */
export function emptyForm() {
  return {
    name: "", father: "", sex: "", dob: "", nationality: "", fin: "", passport: "", phone: "",
    type: "", source: "", diagnosis: "", weight: "", height: "", blood: "UNKNOWN",
    allergy: "", noAllergy: false, comorbidities: [], comorbiditiesText: "", his: "",
    relativeName: "", relativeRelation: "", relativePhone: "", companion: "",
    consent: "", sms: false, bedId: null, unitId: null, bedLabel: null,
  };
}

const blank = (value) => String(value ?? "").trim() === "";
/** A positive decimal, comma or point: "72,5" is 72.5. null for anything else. */
export function positive(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}
const FIN = /^[A-Za-z0-9]{7}$/;
/** The earliest date of birth the server takes (admission/form.py EARLIEST_BIRTH): an earlier one
 *  is a slipped digit — "0050-01-01" read as an age of 1976 years. */
export const EARLIEST_BIRTH = "1900-01-01";

const DAY_MS = 86_400_000;
/** The day `months` whole months after year/month0/day — the day clamped to that month's length:
 *  a month after 31 January is the last day of February. */
function monthsAfter(year, month0, day, months) {
  const total = month0 + months;
  const y = year + Math.floor(total / 12);
  const m = total % 12;
  return Date.UTC(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
}

/** Whole years, months and days from a date of birth (YYYY-MM-DD) to `today` (the same shape),
 *  or null for no date, a date that is not one, one after today or one before 1900. Shown beside
 *  the date, never edited (spec §5.2).
 *
 *  Counted from the birth date itself: the most whole months whose anniversary (its day clamped to
 *  the month's length) is not after today, then the days from that anniversary to today — never
 *  negative. 31 January to 1 March is one month (to the last day of February) and one day. */
export function ageOf(dob, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob ?? ""));
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today ?? ""));
  if (!m || !n) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const [ty, tmo, td] = n.slice(1).map(Number);
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;   // 2026-02-30
  if (dob < EARLIEST_BIRTH || dob > today) return null;
  const now = Date.UTC(ty, tmo - 1, td);
  let months = (ty - y) * 12 + (tmo - mo);
  let anniversary = monthsAfter(y, mo - 1, d, months);
  if (anniversary > now) {
    months -= 1;
    anniversary = monthsAfter(y, mo - 1, d, months);
  }
  return { years: Math.floor(months / 12), months: months % 12, days: Math.round((now - anniversary) / DAY_MS) };
}

/** Each field the form still lacks or holds wrong, in the form's order: [{field, key}] — `key` is
 *  the panel's sentence for it. Empty when "Kabul et" may be pressed. */
export function missing(form, today) {
  const out = [];
  const add = (field, key) => out.push({ field, key });
  if (blank(form.name)) add("name", "kabul.miss.name");
  if (!form.sex) add("sex", "kabul.miss.sex");
  if (blank(form.dob)) add("dob", "kabul.miss.dob");
  else if (!ageOf(form.dob, today)) add("dob", "kabul.miss.dobWrong");     // not a date, future, before 1900
  if (!blank(form.fin) && !FIN.test(form.fin.trim())) add("fin", "kabul.miss.fin");
  if (!form.type) add("type", "kabul.miss.type");
  if (blank(form.diagnosis)) add("diagnosis", "kabul.miss.diagnosis");
  if (!blank(form.weight) && positive(form.weight) === null) add("weight", "kabul.miss.weight");
  if (!blank(form.height) && positive(form.height) === null) add("height", "kabul.miss.height");
  // Both or neither: ticking «none known» never erases a typed allergy — the nurse removes one.
  if (blank(form.allergy) === !form.noAllergy) add("allergy", "kabul.miss.allergy");
  if (!form.consent) add("consent", "kabul.miss.consent");
  if (!form.bedId) add("bed", "kabul.miss.bed");
  return out;
}

const text = (value) => (blank(value) ? null : String(value).trim());

/** The body POST /admissions takes (admission/schemas.py AdmissionCreate). */
export function toBody(form) {
  return {
    patient: {
      display_name: form.name.trim(), date_of_birth: form.dob, sex: form.sex,
      father_name: text(form.father), nationality: text(form.nationality),
      national_id: text(form.fin)?.toUpperCase() ?? null, passport_no: text(form.passport),
      phone: text(form.phone), his_patient_reference: text(form.his),
      relative_name: text(form.relativeName), relative_relation: text(form.relativeRelation),
      relative_phone: text(form.relativePhone), companion_name: text(form.companion),
      consent: form.consent, sms_permitted: Boolean(form.sms),
    },
    note: {
      admitting_unit_id: form.unitId, bed_id: form.bedId, admission_type: form.type,
      source_of_admission: form.source || null,
      admission_diagnosis_free_text: form.diagnosis.trim(),
      weight_kg: positive(form.weight), height_cm: positive(form.height),
      blood_group: form.blood || null,
      allergies_text: form.noAllergy ? null : text(form.allergy),
      no_known_allergy: Boolean(form.noAllergy),
      comorbidity_codes: [...form.comorbidities],
      comorbidities_text: text(form.comorbiditiesText),
    },
  };
}
