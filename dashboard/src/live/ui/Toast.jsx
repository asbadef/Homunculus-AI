// src/live/ui/Toast.jsx — the prototype's H.toast: short confirmations, bottom right.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Button } from "./Button.jsx";

export const TOAST_MS = 3600; // the prototype's lifetime

const TONE = { ok: "border-l-ok", warn: "border-l-mid", error: "border-l-crit" };

const ToastContext = createContext(() => {
  if (import.meta.env.DEV) console.warn("useToast: no <ToastProvider> above this component");
});

/** const toast = useToast(); toast("Yadda saxlanıldı"); toast("…", "warn" | "error").
 *  One polite live region announces every toast; it exists before the first one, so a screen
 *  reader hears that one too. Each toast has a close button for whoever cannot read it in 3.6 s.
 *  Not for alarms: a clinical alarm never disappears on a timer. */
export function ToastProvider({ children }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((message, tone = "ok") => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list, { id, message, tone: TONE[tone] ? tone : "ok" }]);
    timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS));
    return id;
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const handle of pending.values()) clearTimeout(handle);
    };
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {createPortal(
        <div role="region" aria-label={t("common.notifications")} className="pointer-events-none fixed bottom-4 right-4 z-[120]">
          <div aria-live="polite" className="flex flex-col gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                data-tone={item.tone}
                className={`pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-xl border border-l-4 border-line2 bg-card py-2.5 pl-3.5 pr-2 font-text text-13.5 font-semibold text-ink shadow-pop ${TONE[item.tone]}`}
              >
                <span className="flex-1">{item.message}</span>
                <Button variant="ghost" size="sm" icon="x" label={t("common.close")} onClick={() => dismiss(item.id)} />
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
