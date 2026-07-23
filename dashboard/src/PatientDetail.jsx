import React from "react";
import { riskColor } from "./risk.js";

function LatestStrip({ latest }) {
  const items = [["HR", latest.heart_rate], ["MAP", latest.map], ["Laktat", latest.lactate], ["SOFA", latest.sofa]];
  return (
    <div style={{ display: "flex", gap: 16, margin: "8px 0 16px", color: "#333" }}>
      {items.map(([k, v]) => (<span key={k}><strong>{k}</strong> {v ?? "—"}</span>))}
    </div>
  );
}

function AlertCard({ alert, onAck }) {
  const at = alert.acknowledged_at ? new Date(alert.acknowledged_at).toLocaleTimeString() : "";
  return (
    <div style={{ border: `1px solid ${riskColor(alert.severity)}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
      {alert.escalated && (
        <div style={{ background: "#c0392b", color: "#fff", fontWeight: 700, padding: "4px 8px", borderRadius: 4, marginBottom: 8 }}>
          ESKALE EDİLDİ
        </div>
      )}
      <div style={{ color: riskColor(alert.severity), fontWeight: 700 }}>⚠ {alert.summary}</div>
      <p style={{ margin: "8px 0" }}><strong>Gerekçe:</strong> {alert.clinical_reasoning}</p>
      <div style={{ margin: "8px 0" }}>
        <strong>Önerilen:</strong>
        <ul>{alert.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </div>
      <div style={{ fontSize: 13, color: "#555" }}><strong>Kaynak:</strong> {alert.supporting_evidence.join(", ")}</div>
      <div style={{ fontSize: 13, color: "#555" }}><strong>Güven:</strong> {alert.confidence}</div>
      <div style={{ marginTop: 10 }}>
        {alert.acknowledged
          ? <span style={{ color: "#2e7d32", fontWeight: 600 }}>✓ Onaylandı: {alert.acknowledged_by} · {at}</span>
          : <button onClick={() => onAck(alert.kind)}>Onayla</button>}
      </div>
    </div>
  );
}

export function PatientDetail({ patient, onAck = () => {} }) {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: 0 }}>{patient.patient_id}</h2>
      <LatestStrip latest={patient.latest} />
      {patient.alerts.length === 0
        ? <p style={{ color: "#2e7d32" }}>Aktif uyarı yok.</p>
        : patient.alerts.map((a) => <AlertCard key={a.kind} alert={a} onAck={onAck} />)}
    </div>
  );
}
