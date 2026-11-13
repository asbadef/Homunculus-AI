// src/live/screens/admin/tresWords.js — TRƏS-01: the national feed's vocabulary as the tab says it — the eight record
// types (moved here from TresTab.jsx in phase F1, which re-exports them), the ledger's statuses and the catalogue's skip
// reasons (homunculus-engine tres/models.py STATUSES, tres/az.py and tres/mapping/*). A status or a reason the map does
// not name is shown as the engine's code, never as a raw translation key.

/** The eight record types, in the package's order (the engine's `tres/models.py` RESOURCE_TYPES), with their labels. */
export const TYPES = Object.freeze([
  ["patient", "tres.type.patient"], ["practitioner", "tres.type.practitioner"], ["encounter", "tres.type.encounter"],
  ["condition", "tres.type.condition"], ["procedure", "tres.type.procedure"], ["vital", "tres.type.vital"],
  ["lab", "tres.type.lab"], ["composition", "tres.type.composition"],
]);

/** The ledger's statuses (tres/models.py STATUSES), in its order. */
export const STATUSES = Object.freeze([
  ["pending", "tres.status.pending"], ["sent", "tres.status.sent"], ["validated", "tres.status.validated"],
  ["failed", "tres.status.failed"], ["skipped", "tres.status.skipped"], ["stuck", "tres.status.stuck"],
  ["deleted", "tres.status.deleted"],
]);

/** The catalogue's skip reasons of phase F1 (tres/az.py, tres/mapping/*, tres/package.py, tres/worker.py) —
 *  `discharge_missing` (a finished stay with no discharge time, its Encounter skipped) and `patient_unheld`
 *  (in a send, a stay whose package stopped at its Patient: its Encounter row is skipped with it) among them —
 *  and `package_error`, the one reason of a FAILED row (final review: the stay's package raised an unexpected
 *  error; its Encounter row reads `failed`, and the night tries it again). */
export const REASONS = new Map([
  ["fin_missing", "tres.reason.finMissing"], ["fin_format", "tres.reason.finFormat"],
  ["name_single", "tres.reason.nameSingle"], ["father_name_missing", "tres.reason.fatherNameMissing"],
  ["sex_unmapped", "tres.reason.sexUnmapped"], ["birth_date_invalid", "tres.reason.birthDateInvalid"],
  ["identity_missing", "tres.reason.identityMissing"], ["name_missing", "tres.reason.nameMissing"],
  ["unit_unmapped", "tres.reason.unitUnmapped"], ["organization_missing", "tres.reason.organizationMissing"],
  ["timezone_unknown", "tres.reason.timezoneUnknown"], ["discharge_missing", "tres.reason.dischargeMissing"],
  ["no_reference", "tres.reason.noReference"], ["patient_unheld", "tres.reason.patientUnheld"],
  ["type_off", "tres.reason.typeOff"], ["package_error", "tres.reason.packageError"],
]);

/** The two platforms a hospital's account can point at (the tab's select; the engine's `environment`). */
export const ENVIRONMENT_KEYS = Object.freeze([["test", "tres.envTest"], ["live", "tres.envLive"]]);

/** The admission states the stay lookup can answer with, other than ACTIVE (said by `stillAdmitted`) and
 *  DISCHARGED with its time (said by `discharged`) — the engine's `AdmissionState`, each in its own words. */
export const STAY_STATES = new Map([
  ["DRAFT", "tres.deliveries.state.DRAFT"], ["PENDING_DISCHARGE", "tres.deliveries.state.PENDING_DISCHARGE"],
  ["PENDING_TRANSFER", "tres.deliveries.state.PENDING_TRANSFER"], ["TRANSFERRED", "tres.deliveries.state.TRANSFERRED"],
  ["DISCHARGED", "tres.deliveries.state.DISCHARGED"],
]);

const TYPE_KEYS = new Map(TYPES);
const STATUS_KEYS = new Map(STATUSES);
const ENVIRONMENT_NAMES = new Map(ENVIRONMENT_KEYS);

export const typeLabel = (t, type) => (TYPE_KEYS.has(type) ? t(TYPE_KEYS.get(type)) : String(type ?? ""));
export const statusLabel = (t, status) => (STATUS_KEYS.has(status) ? t(STATUS_KEYS.get(status)) : String(status ?? ""));
export const reasonLabel = (t, reason) => (reason == null ? "" : REASONS.has(reason) ? t(REASONS.get(reason)) : String(reason));
/** An environment as the tab names it; one this build does not know, as the engine's word; none, an empty text. */
export const environmentLabel = (t, environment) => (ENVIRONMENT_NAMES.has(environment)
  ? t(ENVIRONMENT_NAMES.get(environment)) : String(environment ?? ""));

/** A hand's rows counted by status, as the toast says them: «Göndərildi 3 · Uğursuz 1». The ledger's order; a status
 *  this build does not name comes last, as its code. No row at all: the «no records» words. The label comes first and
 *  the number after it, in every language — so no plural is ever wrong («Failed 1», never «1 records»). */
export function countsText(t, rows) {
  const counts = new Map();
  for (const one of Array.isArray(rows) ? rows : []) {
    const status = typeof one?.status === "string" && one.status ? one.status : "—";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const known = STATUSES.map(([status]) => status).filter((status) => counts.has(status));
  const other = [...counts.keys()].filter((status) => !STATUS_KEYS.has(status));
  const parts = [...known, ...other].map((status) => `${statusLabel(t, status)} ${counts.get(status)}`);
  return parts.length > 0 ? parts.join(" · ") : t("tres.deliveries.handledNone");
}
