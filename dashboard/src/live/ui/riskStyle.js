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
//   An unrecognised value stays neutral but shows its raw value, so a level the engine adds later
//   is visible on the card instead of silently calm.
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
  if (measured !== true && NO_FINDING.includes(risk)) {
    return { tone: "neutral", icon: "minus", labelKey: "risk.unmeasured" };
  }
  if (Object.prototype.hasOwnProperty.call(RISK, risk)) return { ...RISK[risk] };
  return { tone: "neutral", icon: "alert", labelKey: "risk.unknown", labelVars: { value: String(risk) } };
}
