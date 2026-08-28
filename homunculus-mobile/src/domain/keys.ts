/** The composite key the server uses for an alert: (patient_id, kind). */
export function alertKey(patientId: string, kind: string): string {
  return `${patientId}|${kind}`;
}
