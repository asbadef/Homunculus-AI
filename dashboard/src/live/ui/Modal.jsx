// src/live/ui/Modal.jsx — the prototype's H.modal as a React dialog.
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Button } from "./Button.jsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal dialog (role="dialog", aria-modal), named by its title.
 *  - Opening moves focus into it: the body's first control, else the dialog itself. Closing
 *    returns focus to whatever had it before.
 *  - Tab and Shift+Tab stay inside (focus trap). Escape, the ✕ and a press on the backdrop call
 *    onClose — except while `busy`: a request is in flight and its answer must land in an open
 *    dialog (the old workspace's ActionOverlay rule).
 *  - Rendered in a portal under <body>, so it takes <html data-theme> like everything else.
 *  `actions` is the footer (the prototype's .mf), `wide` its 1180 px variant. */
export function Modal({ open, ...props }) {
  if (!open) return null;
  return createPortal(<Dialog {...props} />, document.body);
}

function Dialog({ title, onClose, actions, wide = false, busy = false, children }) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  // Read during the first render, before the effect below moves focus into the dialog.
  const [opener] = useState(() => document.activeElement);
  const close = () => {
    if (!busy && onClose) onClose();
  };

  useEffect(() => {
    (bodyRef.current?.querySelector(FOCUSABLE) || dialogRef.current)?.focus();
    return () => {
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, [opener]);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      data-testid="modal-backdrop"
      className="fixed inset-0 z-[100] grid place-items-center bg-[rgba(2,6,14,.55)] p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-[calc(100vh-32px)] overflow-auto rounded-dlg border border-line2 bg-app font-text text-14.5 text-ink shadow-pop outline-none ${wide ? "w-[min(1180px,100%)]" : "w-[min(760px,100%)]"}`}
      >
        <div className="sticky top-0 z-[2] flex items-center gap-2.5 border-b border-line bg-app px-[18px] py-3.5">
          <h2 id={titleId} className="m-0 font-display text-17 font-bold leading-[normal]">{title}</h2>
          <Button variant="ghost" size="sm" icon="x" label={t("common.close")} onClick={close} disabled={busy} className="ml-auto" />
        </div>
        <div ref={bodyRef} className="px-[18px] py-4">{children}</div>
        {actions ? (
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-app px-[18px] py-3">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
