// src/live/screens/common/vitals.js — which measured channels a screen shows, in what order, and
// where each one's value, unit and timestamp come from. Shared by the bed card, the bed list and
// the patient screen, so the three never disagree about what a channel is called.
//
// The order is the engine's own publishing order (api/board.py `_PUBLISHED_SIGNALS`), with lactate
// last because it is a lab rather than a monitor channel. `at` is the key inside the card's
// `measuredAt` block — the server's name for the signal; `get` reads the adapter's own shorter
// name (liveAdapters `patientFromBoard`).
//
// NOTHING HERE IS A THRESHOLD. There is no low/high, no normal band, no colour that depends on the
// value: `color` is the channel's identity colour (the prototype's `--v-*`), the same whatever the
// number is. A band or a cut-off would be the browser scoring the patient, which is the engine's
// work and nobody else's (the prototype's `H.VITAL.al/nb` are exactly that, and are not ported).
//
// `--v-map` and `--v-spo` clear 4.5:1 on `card` in daylight but not on `card2` (Wave 1B's contrast
// table), so a vital row belongs on the card surface. The list view writes its numbers in `ink`.
//
// `sbp` and `map` deliberately share `text-v-map`. The token set has five vital colours — hr, map,
// spo, rr, t (theme/tokens.js) — and pressure is one of them: inventing a sixth would add a colour
// to the design system from a screen, which is backwards. They are told apart the way every value
// on this screen is told apart: by its label and its unit. Colour is never the only carrier of a
// distinction here — it cannot be, for the colour-blind clinician or the printed handover.
export const VITALS = Object.freeze([
  { at: "heart_rate", get: (p) => p?.vitals?.hr, labelKey: "board.chHr", unitKey: "beds.unitBpm", color: "text-v-hr" },
  { at: "resp_rate", get: (p) => p?.vitals?.rr, labelKey: "board.chRr", unitKey: "beds.unitBpm", color: "text-v-rr" },
  { at: "spo2", get: (p) => p?.vitals?.spo2, labelKey: "board.chSpo2", unitKey: "beds.unitPct", color: "text-v-spo" },
  { at: "sbp", get: (p) => p?.vitals?.sbp, labelKey: "board.chSbp", unitKey: "beds.unitMmhg", color: "text-v-map" },
  { at: "map", get: (p) => p?.vitals?.map, labelKey: "board.chMap", unitKey: "beds.unitMmhg", color: "text-v-map" },
  { at: "temperature", get: (p) => p?.vitals?.temp, labelKey: "board.chTemp", unitKey: "beds.unitC", color: "text-v-t" },
  { at: "lactate", get: (p) => p?.lactate, labelKey: "board.chLac", unitKey: "beds.unitMmol", color: "text-ink" },
]);

/** The channels this card HAS a value for, with the value and the instant it was measured.
 *  `!= null`, never truthiness: a measured 0 is a clinical finding (liveAdapters' rule). */
export function measuredVitals(patient) {
  return VITALS
    .map((v) => ({ ...v, value: v.get(patient), at_: patient?.measuredAt?.[v.at] ?? null }))
    .filter((v) => v.value !== null && v.value !== undefined);
}
