import React from "react";
import { AlertTriangle, Circle, Clock, Check, ChevronRight } from "lucide-react";
import { sev } from "./theme.js";
import { strings } from "./i18n.js";

function LatestStrip({ latest }) {
  const items = [["HR", latest.heart_rate], ["MAP", latest.map], ["Laktat", latest.lactate], ["SOFA", latest.sofa]];
  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-slate-900 p-3 ring-1 ring-slate-800">
          <span className="text-xs text-slate-400">{k}</span> <span className="text-lg text-slate-100">{v ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

function AlertCard({ alert, onAck, L }) {
  const s = sev(alert.severity);
  const at = alert.acknowledged_at ? new Date(alert.acknowledged_at).toLocaleTimeString() : "";
  const hasStale = alert.stale_inputs && alert.stale_inputs.length > 0;

  return (
    <div className={`rounded-xl bg-slate-900 p-4 ring-1 ${alert.downgraded ? "ring-slate-700" : s.ring}`}>
      <div className="flex items-center gap-2 font-semibold text-slate-100">
        {alert.downgraded
          ? <Circle size={16} className="flex-shrink-0 text-slate-500" />
          : <AlertTriangle size={16} className={`flex-shrink-0 ${s.text}`} />}
        {alert.summary}
      </div>

      {alert.escalated && !alert.downgraded && (
        <span className="mr-2 mt-2 inline-flex items-center gap-1 rounded-full bg-sev-critical px-2 py-0.5 text-xs font-semibold text-white">
          <AlertTriangle size={14} /> {L.escBadge}
        </span>
      )}
      {alert.downgraded && (
        <span className="mr-2 mt-2 inline-flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-xs font-semibold text-slate-300">
          {L.chronic}
        </span>
      )}
      {hasStale && (
        <span className="mr-2 mt-2 inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
          <Clock size={14} /> {L.stale} {alert.stale_inputs.join(", ")}
        </span>
      )}

      {alert.chronic_context && (
        <p className="mt-2 text-sm italic text-slate-400">{alert.chronic_context}</p>
      )}

      <p className="mt-2 text-sm text-slate-300"><strong className="text-slate-100">{L.reason}</strong> {alert.clinical_reasoning}</p>

      <div className="mt-2">
        <strong className="text-sm text-slate-100">{L.recommended}</strong>
        <ul className="mt-1 space-y-1">
          {alert.recommended_actions.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
              <ChevronRight size={14} className="mt-0.5 flex-shrink-0 text-slate-500" />
              {a}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-2 text-sm text-slate-400">
        <strong className="text-slate-100">{L.source}</strong>{" "}
        <span className="font-mono text-xs text-slate-400">{alert.supporting_evidence.join(", ")}</span>
      </div>

      <div className="mt-1 text-sm text-slate-400"><strong className="text-slate-100">{L.confidence}</strong> {alert.confidence}</div>

      {!alert.downgraded && (
        <div className="mt-3">
          {alert.acknowledged
            ? (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-400">
                <Check size={14} /> {L.acked} {alert.acknowledged_by} · {at}
              </span>
            )
            : (
              <button
                onClick={() => onAck(alert.kind)}
                className="cursor-pointer rounded bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {L.ack}
              </button>
            )}
        </div>
      )}
    </div>
  );
}

export function PatientDetail({ patient, onAck = () => {}, lang = "tr" }) {
  const L = strings(lang);
  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold text-slate-100">{patient.patient_id}</h2>
      <LatestStrip latest={patient.latest} />
      {patient.alerts.length === 0
        ? <p className="text-sm text-emerald-400">{L.noAlerts}</p>
        : <div className="space-y-3">{patient.alerts.map((a) => <AlertCard key={a.kind} alert={a} onAck={onAck} L={L} />)}</div>}
    </div>
  );
}
