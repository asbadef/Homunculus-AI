import React from "react";

export function Toasts({ toasts, onDismiss, onSelect }) {
  return (
    <div style={{ position: "fixed", top: 12, right: 12, display: "flex", flexDirection: "column",
                  gap: 8, zIndex: 1000, maxWidth: 320 }}>
      {toasts.map(({ id, note }) => {
        const esc = note.trigger === "escalation";
        return (
          <div key={id} onClick={() => onSelect(note.patient_id)}
               style={{ background: esc ? "#c0392b" : "#e67e22", color: "#fff", borderRadius: 6,
                        padding: "10px 12px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{esc ? "Eskalasyon" : "Yeni uyarı"}</strong>
              <button aria-label="kapat" onClick={(e) => { e.stopPropagation(); onDismiss(id); }}
                      style={{ background: "transparent", border: "none", color: "#fff",
                               cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{note.body}</div>
          </div>
        );
      })}
    </div>
  );
}
