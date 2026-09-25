// src/ui.jsx — small form and overlay primitives shared by the clinical workspace and the admin
// panels. Moved out of ClinicalDemo.jsx so a component in another file can use them without
// importing the whole workspace.
import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

export function Field({ T, label, hint, children }) {
  return (
    <label className="block">
      <div className={`mb-1 font-medium ${T.sizes.label} ${T.muted}`}>{label}</div>
      {children}
      {hint && <div className={`mt-1 text-xs ${T.faint}`}>{hint}</div>}
    </label>
  );
}

export const inputCls = (T) => `w-full rounded-lg border px-3 py-2.5 outline-none transition focus:ring-2 focus:ring-brand/40 ${T.input} ${T.sizes.nav}`;

export function btnCls(T, kind = "primary") {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
  const map = { primary: T.primary, ghost: T.ghost, danger: T.danger, warn: T.warn };
  return `${base} ${map[kind] || T.primary} ${T.sizes.nav}`;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal dialog, named by its title for assistive technology.
 *  - Escape, the backdrop and the X close it through `onClose`, except while `busy` (a request is
 *    in flight: its answer must land in an open dialog). The X is named by `closeLabel`; callers
 *    pass their language's `S.close` (the default is Turkish, the app's default language).
 *  - On opening, focus moves into it — to the first control of its content, or to the title — unless
 *    a child already took it (autoFocus). On closing, focus goes back to what held it before.
 *  - There is no focus trap: Tab can still leave the dialog. */
export function ActionOverlay({ T, title, onClose, children, busy = false, closeLabel = "Kapat" }) {
  const titleId = useId();
  const cardRef = useRef(null);
  const bodyRef = useRef(null);
  const titleRef = useRef(null);
  // Read during the first render, before any child's autoFocus moves focus into the dialog.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  const close = () => { if (!busy && onClose) onClose(); };

  useEffect(() => {
    if (!cardRef.current?.contains(document.activeElement)) {
      (bodyRef.current?.querySelector(FOCUSABLE) || titleRef.current)?.focus();
    }
    return () => {
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === "function") {
        opener.focus();
      }
    };
  }, [opener]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className={`absolute inset-0 ${T.overlay}`} onClick={close} />
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`relative w-full max-w-sm rounded-2xl border ${T.border} ${T.card} p-5 shadow-2xl`}>
        <div className="mb-3 flex items-center justify-between">
          <h4 ref={titleRef} id={titleId} tabIndex={-1} className={`font-bold outline-none ${T.heading}`}>{title}</h4>
          <button type="button" onClick={close} disabled={busy} aria-label={closeLabel} title={closeLabel}
            className={`grid h-8 w-8 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40 ${T.ghost}`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div ref={bodyRef}>{children}</div>
      </div>
    </div>
  );
}
