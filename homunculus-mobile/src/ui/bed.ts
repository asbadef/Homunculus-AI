/** The bed number a card or detail screen titles itself with. One place, so a future bed-id
 *  format change (ward prefixes, padding) cannot drift between the two screens. */
export function bedNumber(patientId: string): string {
  return patientId.replace(/^bed-/, "");
}
