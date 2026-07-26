import React, { useEffect, useState } from "react";

// Recent notification history, read from the tenant-scoped audit (GET /audit?event_type=notification).
export function NotificationHistory({ token, fetchAudit, onSelect }) {
  const [records, setRecords] = useState([]);

  useEffect(() => {
    let closed = false;
    fetchAudit(token, { eventType: "notification", limit: 50 })
      .then((r) => { if (!closed) setRecords([...r].reverse()); })   // newest first
      .catch(() => {});
    return () => { closed = true; };
  }, [token, fetchAudit]);

  return (
    <div className="border-b border-slate-800 px-3 py-2 text-sm">
      <div className="mb-1 font-semibold text-slate-100">Bildirim geçmişi ({records.length})</div>
      {records.length === 0
        ? <div className="text-slate-500">Henüz bildirim yok.</div>
        : (
          <div className="divide-y divide-slate-800">
            {records.map((r) => {
              const esc = r.payload.trigger === "escalation";
              return (
                <div
                  key={r.id}
                  onClick={() => onSelect(r.patient_id)}
                  tabIndex={0}
                  role="button"
                  className={`flex cursor-pointer items-center gap-2 py-1 transition-colors hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                    esc ? "text-sev-critical" : "text-slate-300"
                  }`}
                >
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">
                    {new Date(r.ts).toLocaleTimeString()}
                  </span>
                  <span className="truncate">
                    {r.patient_id}: {r.subject}
                  </span>
                  <span
                    className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                      esc ? "bg-sev-critical/15 text-sev-critical" : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {r.payload.trigger}
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
