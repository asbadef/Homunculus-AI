// src/live/ui/RiskPill.jsx — an engine risk value as a status pill: tone, icon and a label in the
// current language. Never green (riskStyle.js).
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { riskStyle } from "./riskStyle.js";
import { StatusPill } from "./Tag.jsx";

export function RiskPill({ risk, measured = true, className = "" }) {
  const { t } = useI18n();
  const style = riskStyle(risk, { measured });
  return (
    <StatusPill tone={style.tone} icon={style.icon} className={className}>
      {t(style.labelKey, style.labelVars)}
    </StatusPill>
  );
}
