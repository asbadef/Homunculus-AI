import React, { useEffect, useState } from "react";
import { PatientList } from "./PatientList.jsx";
import { PatientDetail } from "./PatientDetail.jsx";
import { fetchBoard as realFetchBoard, openStream as realOpenStream } from "./api.js";

export function Board({ token, fetchBoard = realFetchBoard, openStream = realOpenStream }) {
  const [patients, setPatients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let closed = false;
    fetchBoard(token).then((list) => { if (!closed) setPatients(list); }).catch(() => {});
    const close = openStream(
      token,
      (board) => setPatients((prev) => {
        const rest = prev.filter((p) => p.patient_id !== board.patient_id);
        return [...rest, board].sort((a, b) => a.patient_id.localeCompare(b.patient_id));
      }),
      (s) => setStatus(s === "open" ? "live" : "reconnecting"),
    );
    return () => { closed = true; close(); };
  }, [token, fetchBoard, openStream]);

  const current = patients.find((p) => p.patient_id === selected) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100vh", fontFamily: "system-ui" }}>
      <aside style={{ borderRight: "1px solid #ddd", overflowY: "auto" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 700 }}>
          Homunculus <span style={{ float: "right", fontSize: 12, color: "#888" }}>{status}</span>
        </div>
        <PatientList patients={patients} selected={selected} onSelect={setSelected} />
      </aside>
      <main style={{ overflowY: "auto" }}>
        {current ? <PatientDetail patient={current} /> : <p style={{ padding: 16, color: "#888" }}>Bir hasta seçin.</p>}
      </main>
    </div>
  );
}
