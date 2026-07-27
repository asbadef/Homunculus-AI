import React from "react";
import { AlertTriangle, Bell, X } from "lucide-react";
import { strings } from "./i18n.js";

export function Toasts({ toasts, onDismiss, onSelect, lang = "tr" }) {
  const L = strings(lang);
  return (
    <div className="fixed top-3 right-3 z-[1000] flex max-w-sm flex-col gap-2">
      {toasts.map(({ id, note }) => {
        const esc = note.trigger === "escalation";
        return (
          <div
            key={id}
            onClick={() => onSelect(note.patient_id)}
            tabIndex={0}
            role="button"
            className={`cursor-pointer rounded-lg px-3 py-2.5 shadow-lg ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              esc ? "bg-sev-critical/95 text-white ring-sev-critical/50" : "bg-sev-high/95 text-white ring-sev-high/50"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {esc ? <AlertTriangle size={16} /> : <Bell size={16} />}
                {esc ? L.toastEsc : L.toastNew}
              </span>
              <button
                aria-label={L.close}
                onClick={(e) => { e.stopPropagation(); onDismiss(id); }}
                className="cursor-pointer rounded p-0.5 text-white/80 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-1 text-sm">{note.body}</div>
          </div>
        );
      })}
    </div>
  );
}
