import React from "react";
import { riskLabel, riskColor } from "./risk.js";

export function PatientList({ patients, selected, onSelect }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {patients.map((p) => (
        <li
          key={p.patient_id}
          onClick={() => onSelect(p.patient_id)}
          style={{
            cursor: "pointer",
            padding: "10px 12px",
            borderLeft: `5px solid ${riskColor(p.risk)}`,
            background: p.patient_id === selected ? "#eef" : "transparent",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{p.patient_id}</span>
          <span style={{ color: riskColor(p.risk), fontWeight: 600 }}>{riskLabel(p.risk)}</span>
        </li>
      ))}
    </ul>
  );
}
