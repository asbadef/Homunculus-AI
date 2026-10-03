// src/live/ui/riskStyle.js — how an engine `risk` value looks on screen. Pure.
//
// The engine sends risk ∈ none | info | low | moderate | high | critical: the highest severity
// among the patient's active alerts, "none" when there is none (homunculus-engine api/board.py
// _risk) — which includes a patient admitted but never measured (identity_only_board).
// Roadmap G1-09: moderate is amber; none and info are neutral; nothing falls back to a green
// "stable". An absent finding is not evidence of stability — the old mapping (risk.js, theme.js)
// painted none, and on the VM moderate too, green.
//
// riskStyle(risk, { measured }) -> { tone, icon, labelKey, labelVars? }
//   tone: a StatusPill tone; labelKey: an i18n key (strings/risk.js).
//   measured: only an explicit `true` lets none/info read "no finding"; anything else (left out,
//   false, a truthy non-boolean) reads "not measured". Clinical safety: "no finding" is a claim
//   about observations, and an identity-only card has none — so the claim must be opted into by
//   a caller that has them (G1-09 decides it from the card's timestamps), never be the default.
//   It never hides a real finding.
//   The value is read trimmed and lower-cased. Anything the screen cannot vouch for takes the
//   attention look (tone "att"), never neutral grey and never green: no value at all (null,
//   undefined, blank) reads "risk not reported"; a value this build does not know — the engine
//   added a level, a version skew — reads "unknown risk: <raw text>", so it is visible on the card
//   instead of silently calm. riskStyle.test.js reads the engine's level list from its source, so
//   a new level fails CI here before it reaches a ward.
//
// NOT handled here: the NEWS2 red_param floor (G1-09 acceptance: "a parameter scoring 3 makes the
// card at least amber"). It needs patient.news2.red_param, which this function does not take —
// G1-09 applies it on the card. Open conflict, recorded in the roadmap's "Kullanıcı kararları":
// rules/news2.py raises a MODERATE alert for red_param, but rules/patient_relative.py
// _adjust_news2 lowers a NEWS2 alert to LOW when a charted baseline or comorbidity explains every
// contributor — so the engine can send risk "low" with red_param true. Whether the clinician's
// chronic normal may override the red_param floor is a clinical decision, not a display one.
const RISK = {
  critical: { tone: "crit", icon: "alert", labelKey: "risk.critical" },
  high: { tone: "high", icon: "alert", labelKey: "risk.high" },
  moderate: { tone: "mid", icon: "clock", labelKey: "risk.moderate" },
  low: { tone: "low", icon: "clock", labelKey: "risk.low" },
  info: { tone: "neutral", icon: "eye", labelKey: "risk.info" },
  none: { tone: "neutral", icon: "minus", labelKey: "risk.none" },
};
const NO_FINDING = ["none", "info"];

export const ENGINE_RISKS = Object.keys(RISK);

export function riskStyle(risk, { measured } = {}) {
  const key = risk === null || risk === undefined ? "" : String(risk).trim().toLowerCase();
  if (key === "") return { tone: "att", icon: "alert", labelKey: "risk.unreported" };
  if (measured !== true && NO_FINDING.includes(key)) {
    return { tone: "neutral", icon: "minus", labelKey: "risk.unmeasured" };
  }
  if (Object.prototype.hasOwnProperty.call(RISK, key)) return { ...RISK[key] };
  return { tone: "att", icon: "alert", labelKey: "risk.unknown", labelVars: { value: String(risk) } };
}
