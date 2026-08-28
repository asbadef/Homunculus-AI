// The engine's stale_inputs carries labels only (rules/sofa.py _INPUT_LABEL). The project skill
// asks the badge to state elapsed time; where the payload supplies an age we print it, and where it
// does not we print the name alone. A guessed age on a clinical badge is worse than no age.

const LABELS_TR: Record<string, string> = {
  MAP: "OAB",
  norepinephrine: "noradrenalin",
  epinephrine: "adrenalin",
  dopamine: "dopamin",
  dobutamine: "dobutamin",
  "PaO2/FiO2": "PaO2/FiO2",
  GCS: "GKS",
  creatinine: "kreatinin",
  bilirubin: "bilirubin",
  platelets: "trombosit",
};

export function localizeStaleInput(label: string): string {
  return LABELS_TR[label] ?? label;
}

export function ageLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} dk`;
  return `${Math.floor(minutes / 60)} sa`;
}

/** Badge text for a finding's stale inputs, or null when there is nothing to say. */
export function staleLabel(
  staleInputs: readonly string[],
  agesMs: Readonly<Record<string, number>> = {},
): string | null {
  if (staleInputs.length === 0) return null;
  return staleInputs
    .map((input) => {
      const name = localizeStaleInput(input);
      const age = agesMs[input];
      return age === undefined ? name : `${name} · ${ageLabel(age)}`;
    })
    .join(", ");
}
