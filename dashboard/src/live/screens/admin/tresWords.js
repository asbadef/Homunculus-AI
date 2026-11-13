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
 *  (in a send, a stay whose package stopped at its Patient: its Encounter row is skipped with it) among them. */
export const REASONS = new Map([
  ["fin_missing", "tres.reason.finMissing"], ["fin_format", "tres.reason.finFormat"],
  ["name_single", "tres.reason.nameSingle"], ["father_name_missing", "tres.reason.fatherNameMissing"],
  ["sex_unmapped", "tres.reason.sexUnmapped"], ["birth_date_invalid", "tres.reason.birthDateInvalid"],
  ["identity_missing", "tres.reason.identityMissing"], ["name_missing", "tres.reason.nameMissing"],
  ["unit_unmapped", "tres.reason.unitUnmapped"], ["organization_missing", "tres.reason.organizationMissing"],
  ["timezone_unknown", "tres.reason.timezoneUnknown"], ["discharge_missing", "tres.reason.dischargeMissing"],
  ["no_reference", "tres.reason.noReference"], ["patient_unheld", "tres.reason.patientUnheld"],
  ["type_off", "tres.reason.typeOff"],
]);

const TYPE_KEYS = new Map(TYPES);
const STATUS_KEYS = new Map(STATUSES);

export const typeLabel = (t, type) => (TYPE_KEYS.has(type) ? t(TYPE_KEYS.get(type)) : String(type ?? ""));
export const statusLabel = (t, status) => (STATUS_KEYS.has(status) ? t(STATUS_KEYS.get(status)) : String(status ?? ""));
export const reasonLabel = (t, reason) => (reason == null ? "" : REASONS.has(reason) ? t(REASONS.get(reason)) : String(reason));
