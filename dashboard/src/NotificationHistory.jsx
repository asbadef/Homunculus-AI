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
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 13 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Bildirim geçmişi ({records.length})</div>
      {records.length === 0
        ? <div style={{ color: "#888" }}>Henüz bildirim yok.</div>
        : records.map((r) => (
            <div key={r.id} onClick={() => onSelect(r.patient_id)}
                 style={{ cursor: "pointer", padding: "2px 0",
                          color: r.payload.trigger === "escalation" ? "#c0392b" : "#8a5a00" }}>
              {new Date(r.ts).toLocaleTimeString()} — {r.patient_id}: {r.subject} ({r.payload.trigger})
            </div>
          ))}
    </div>
  );
}
