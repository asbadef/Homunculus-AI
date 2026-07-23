import React, { useEffect, useState } from "react";
import { PatientList } from "./PatientList.jsx";
import { PatientDetail } from "./PatientDetail.jsx";
import { fetchBoard as realFetchBoard, openStream as realOpenStream, ackAlert as realAckAlert } from "./api.js";

export function Board({ token, fetchBoard = realFetchBoard, openStream = realOpenStream, ackAlert = realAckAlert }) {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [role, setRole] = useState("nurse");

  const mergeBoard = (board) => setPatients((prev) => {
    const rest = prev.filter((p) => p.patient_id !== board.patient_id);
    return [...rest, board].sort((a, b) => a.patient_id.localeCompare(b.patient_id));
  });

  useEffect(() => {
    let closed = false;
    fetchBoard(token).then((list) => { if (!closed) setPatients(list); }).catch(() => {});
    const close = openStream(token, mergeBoard, (s) => setStatus(s === "open" ? "live" : "reconnecting"));
    return () => { closed = true; close(); };
  }, [token, fetchBoard, openStream]);

  const onAck = (patientId, kind) => { ackAlert(token, patientId, kind, role).then(mergeBoard).catch(() => {}); };

  const current = patients.find((p) => p.patient_id === selected) ?? null;
  const escalated = patients.flatMap((p) => p.alerts.filter((a) => a.escalated).map((a) => ({ p, a })));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100vh", fontFamily: "system-ui" }}>
      <aside style={{ borderRight: "1px solid #ddd", overflowY: "auto" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
          <span>Homunculus</span>
          <span style={{ fontSize: 12, color: "#888" }}>{status}</span>
        </div>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", fontSize: 13 }}>
          Rol:{" "}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="nurse">hemşire</option>
            <option value="doctor">doktor</option>
          </select>
        </div>
        {escalated.length > 0 && (
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", background: "#fdecea" }}>
            <div style={{ color: "#c0392b", fontWeight: 700, fontSize: 13 }}>Eskale ({escalated.length})</div>
            {escalated.map(({ p, a }) => (
              <div key={p.patient_id + a.kind} style={{ cursor: "pointer", fontSize: 13, padding: "2px 0" }}
                   onClick={() => setSelected(p.patient_id)}>
                🔴 {p.patient_id} — {a.summary}
              </div>
            ))}
          </div>
        )}
        <PatientList patients={patients} selected={selected} onSelect={setSelected} />
      </aside>
      <main style={{ overflowY: "auto" }}>
        {current
          ? <PatientDetail patient={current} onAck={(kind) => onAck(current.patient_id, kind)} />
          : <p style={{ padding: 16, color: "#888" }}>Bir hasta seçin.</p>}
      </main>
    </div>
  );
}
