import React from "react";
import { sev } from "./theme.js";
import { strings } from "./i18n.js";

// Patient risk levels (none|low|high|critical) map onto the shared severity scale for the dot.
const RISK_TO_SEV = { none: "info", low: "low", high: "high", critical: "critical" };

export function PatientList({ patients, selected, onSelect, lang = "tr" }) {
  const L = strings(lang);
  if (!patients || patients.length === 0) {
    return <p className="px-3 py-4 text-sm text-slate-400">{L.noPatients}</p>;
  }

  return (
    <ul className="m-0 list-none p-0">
      {patients.map((p) => {
        const s = sev(RISK_TO_SEV[p.risk]);
        const isSelected = p.patient_id === selected;
        return (
          <li
            key={p.patient_id}
            onClick={() => onSelect(p.patient_id)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(p.patient_id);
            }}
            className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 transition-colors hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              isSelected ? "bg-slate-800" : ""
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
            <span className="flex-1 font-medium text-slate-100">{p.patient_id}</span>
            <span className={`text-xs ${s.text}`}>{L.risk[p.risk] ?? p.risk}</span>
          </li>
        );
      })}
    </ul>
  );
}
