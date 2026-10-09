// src/live/ui/RiskPill.jsx — an engine risk value as a status pill: tone, icon and a label in the
// current language. Never green (riskStyle.js). Pass `measured` (true) only for a card that has
// observations: without it, "none" reads "not measured", never "no finding".
//
// The pill says WHAT IT IS before it says the level. On screen the level alone is enough — a
// coloured pill in a card's corner is read as a risk — but a screen reader meets "Orta" with
// nothing around it, among a bed number, a name, six numbers and a score. So "Risk:" is there,
// visually hidden (roadmap G1-09: "Ekran okuyucu risk hapında yalnız düzeyi okur ('Orta');
// görünmez 'Risk:' öneki"). Two labels already carry the word themselves — "Risk bildirilməyib"
// and "Naməlum risk: x" — and are left alone rather than made to say it twice.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { riskStyle } from "./riskStyle.js";
import { StatusPill } from "./Tag.jsx";

/** The two labels that already name themselves (strings/risk.js): the prefix would repeat. */
const SAYS_RISK = new Set(["risk.unreported", "risk.unknown"]);

export function RiskPill({ risk, measured, className = "" }) {
  const { t } = useI18n();
  const style = riskStyle(risk, { measured });
  return (
    <StatusPill tone={style.tone} icon={style.icon} className={className}>
      {SAYS_RISK.has(style.labelKey) ? null : <span className="sr-only">{`${t("risk.prefix")}: `}</span>}
      {t(style.labelKey, style.labelVars)}
    </StatusPill>
  );
}
