// src/live/ui/Toast.jsx — the prototype's H.toast: short confirmations, bottom right.
import React, { createContext, useContext, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Button } from "./Button.jsx";
import { Icon } from "./Icon.jsx";
import { MODAL_EXEMPT } from "./Modal.jsx";

export const TOAST_MS = 3600; //       a confirmation: the prototype's lifetime
export const TOAST_WARN_MS = 10000; // a warning has to be read, not glanced at
export const TOAST_MAX = 5; //         toasts on screen at once

// lifetime null: stays until dismissed. prefix: what a screen reader hears before the message, so
// the tone is not told by colour alone (the icon does that on screen).
const TONES = {
  ok: { stripe: "border-l-ok", icon: "ok", ink: "text-ok-ink", lifetime: TOAST_MS, prefix: null },
  warn: { stripe: "border-l-mid", icon: "alert", ink: "text-mid-ink", lifetime: TOAST_WARN_MS, prefix: "ui.toast.warn" },
  error: { stripe: "border-l-crit", icon: "alert", ink: "text-crit-ink", lifetime: null, prefix: "ui.toast.error" },
};

const ToastContext = createContext(() => {
  if (import.meta.env.DEV) console.warn("useToast: no <ToastProvider> above this component");
});

/** The provider's state outside React: timers, pause reasons and focus bookkeeping, which event
 *  handlers and timeouts both reach. `publish` hands the visible list to React. */
function createToasts(publish) {
  let items = [];
  let seq = 0;
  const timers = new Map(); //  id -> { left, since, handle }; an error has none
  const hovered = new Set(); // ids of the toasts under the pointer (a removed one stops counting)
  let focusInside = false;
  let region = null;
  let returnTo = null; //       the last element focused outside the region

  const paused = () => hovered.size > 0 || focusInside;

  function start(id) {
    const timer = timers.get(id);
    if (!timer || timer.handle !== null) return;
    timer.since = Date.now();
    timer.handle = setTimeout(() => remove([id]), timer.left);
  }

  function stop(id) {
    const timer = timers.get(id);
    if (!timer || timer.handle === null) return;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.left = Math.max(0, timer.left - (Date.now() - timer.since));
  }

  function sync(wasPaused) {
    const now = paused();
    if (now !== wasPaused) for (const id of timers.keys()) (now ? stop : start)(id);
  }

  function remove(ids) {
    const gone = new Set(ids);
    for (const id of gone) {
      clearTimeout(timers.get(id)?.handle);
      timers.delete(id);
    }
    const was = paused();
    for (const id of gone) hovered.delete(id);
    sync(was);
    // Focus on a toast that is going away goes back to where it came from, else to <body>.
    const active = document.activeElement;
    const holder = region && active && region.contains(active) ? active.closest("[data-toast]") : null;
    if (holder && gone.has(Number(holder.dataset.toast))) {
      if (returnTo && returnTo.isConnected && !returnTo.closest("[inert]")) returnTo.focus();
      if (region.contains(document.activeElement)) document.activeElement.blur();
    }
    items = items.filter((item) => !gone.has(item.id));
    publish(items);
  }

  function add(message, tone = "ok") {
    const kind = TONES[tone] ? tone : "ok";
    // Room for the new one: the oldest toast that is not an error goes, else the oldest error.
    const pool = [...items];
    const victims = [];
    while (pool.length >= TOAST_MAX) {
      const at = pool.findIndex((item) => item.tone !== "error");
      victims.push(pool.splice(at === -1 ? 0 : at, 1)[0].id);
    }
    if (victims.length) remove(victims);
    seq += 1;
    const id = seq;
    items = [...items, { id, message, tone: kind }];
    publish(items);
    const lifetime = TONES[kind].lifetime;
    if (lifetime) {
      timers.set(id, { left: lifetime, since: 0, handle: null });
      if (!paused()) start(id);
    }
    return id;
  }

  return {
    add,
    remove,
    hover(id, on) {
      const was = paused();
      if (on) hovered.add(id);
      else hovered.delete(id);
      sync(was);
    },
    focus(on) {
      const was = paused();
      focusInside = on;
      sync(was);
    },
    noteFocus(target) {
      if (!region || !region.contains(target)) returnTo = target;
    },
    attach(el) {
      region = el;
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer.handle);
      timers.clear();
    },
  };
}

/** const toast = useToast(); toast("Yadda saxlanıldı"); toast("…", "warn" | "error").
 *  - Lifetimes: a confirmation 3.6 s, a warning 10 s, an error until it is dismissed. Every timer
 *    pauses while the pointer is on a toast or focus is in one, and resumes with the time it had.
 *  - Announced from two live regions that exist before the first toast: errors in role="alert",
 *    the rest politely; each says its tone word first ("Xəta: …") and only the message — the close
 *    button is outside them, labelled in the current language and described by its message.
 *  - At most TOAST_MAX on screen; a new one pushes out the oldest that is not an error.
 *  - A toast closed while it has focus gives focus back to where it was (else <body>).
 *  - Stays usable while a Modal is open (MODAL_EXEMPT).
 *  Not for alarms: a clinical alarm never lives in a toast. */
export function ToastProvider({ children }) {
  const { t } = useI18n();
  const base = useId();
  const [items, setItems] = useState([]);
  const [toasts] = useState(() => createToasts(setItems));
  const sayId = (id) => `${base}-toast-${id}`;

  useEffect(() => {
    const note = (event) => toasts.noteFocus(event.target);
    document.addEventListener("focusin", note);
    return () => {
      document.removeEventListener("focusin", note);
      toasts.dispose();
    };
  }, [toasts]);

  const said = (item) => (
    <p key={item.id} id={sayId(item.id)} className="m-0">
      {TONES[item.tone].prefix ? `${t(TONES[item.tone].prefix)} ` : ""}
      {item.message}
    </p>
  );

  return (
    <ToastContext.Provider value={toasts.add}>
      {children}
      {createPortal(
        <div
          ref={toasts.attach}
          role="region"
          aria-label={t("common.notifications")}
          {...{ [MODAL_EXEMPT]: "" }}
          onFocus={() => toasts.focus(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) toasts.focus(false);
          }}
          className="pointer-events-none fixed bottom-4 right-4 z-[120]"
        >
          <div aria-live="polite" className="sr-only">{items.filter((item) => item.tone !== "error").map(said)}</div>
          <div role="alert" aria-atomic="false" className="sr-only">{items.filter((item) => item.tone === "error").map(said)}</div>
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const tone = TONES[item.tone];
              return (
                <div
                  key={item.id}
                  data-toast={item.id}
                  data-tone={item.tone}
                  onMouseEnter={() => toasts.hover(item.id, true)}
                  onMouseLeave={() => toasts.hover(item.id, false)}
                  className={`pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-xl border border-l-4 border-line2 bg-card py-2.5 pl-3.5 pr-2 font-text text-13.5 font-semibold text-ink shadow-pop ${tone.stripe}`}
                >
                  <Icon name={tone.icon} size={16} className={`mt-0.5 ${tone.ink}`} />
                  {/* Read from the live regions above; hidden here so it is not read twice. */}
                  <span aria-hidden="true" className="flex-1">{item.message}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="x"
                    label={t("common.close")}
                    aria-describedby={sayId(item.id)}
                    onClick={() => toasts.remove([item.id])}
                  />
                </div>
              );
            })}
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
