// src/live/ui/Toast.jsx — the prototype's H.toast: short confirmations, bottom right.
import React, { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
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

/** The ids that must go from `list` to make room for one more: the oldest toast that is not an
 *  error, else the oldest error. */
function crowded(list) {
  const pool = [...list];
  const victims = [];
  while (pool.length >= TOAST_MAX) {
    const at = pool.findIndex((item) => item.tone !== "error");
    victims.push(pool.splice(at === -1 ? 0 : at, 1)[0].id);
  }
  return victims;
}

/** The provider's state outside React: timers, pause reasons and focus bookkeeping, which event
 *  handlers and timeouts both reach. `publish` hands the visible list to React. `open` and
 *  `session` start as the provider's props and follow them through `gate`. */
function createToasts(publish, { open: openAtFirst, session: sessionAtFirst }) {
  let items = []; //            on screen, oldest first
  let held = []; //             kept out of sight while the provider is closed, oldest first
  let open = openAtFirst;
  let session = sessionAtFirst;
  let seq = 0;
  const timers = new Map(); //  id -> { left, since, handle }; an error has none; a held one's never runs
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

  // Only a toast on screen has a running clock: a held one keeps the time it had.
  function sync(wasPaused) {
    const now = paused();
    if (now !== wasPaused) for (const item of items) (now ? stop : start)(item.id);
  }

  /** `ids` leave the screen: the pointer on them stops counting, and focus on one of them goes
   *  back to where it came from, else to <body>. Their timers are the caller's business. */
  function leave(ids) {
    const gone = new Set(ids);
    const was = paused();
    for (const id of gone) hovered.delete(id);
    // Out of the list BEFORE focus moves: the blur below re-enters `sync` at once, and must not
    // restart the clock of a toast that is being held.
    items = items.filter((item) => !gone.has(item.id));
    const active = document.activeElement;
    const holder = region && active && region.contains(active) ? active.closest("[data-toast]") : null;
    if (holder && gone.has(Number(holder.dataset.toast))) {
      if (returnTo && returnTo.isConnected && !returnTo.closest("[inert]")) returnTo.focus();
      if (region.contains(document.activeElement)) document.activeElement.blur();
    }
    sync(was);
    publish(items);
  }

  function remove(ids) {
    for (const id of ids) {
      clearTimeout(timers.get(id)?.handle);
      timers.delete(id);
    }
    leave(ids);
  }

  function show(item) {
    const victims = crowded(items);
    if (victims.length) remove(victims);
    items = [...items, item];
    publish(items);
    if (!paused()) start(item.id);
  }

  // The same room rule as on screen, so what comes back at reopening is what would be on screen
  // had the toasts arrived with it open.
  function hold(item) {
    const victims = new Set(crowded(held));
    for (const id of victims) timers.delete(id);
    held = [...held.filter((h) => !victims.has(h.id)), item];
  }

  /** `from`: the session of the useToast() that raised it. A toast raised for another session —
   *  a write that answered after its session ended — is dropped.
   *
   *  The same words in the same tone REPLACE the earlier copy, on screen or held (G2-B1a walk,
   *  M-6): a refusal pressed twice stacked two identical errors, which stay until dismissed. The
   *  copy leaves and the new one comes last, with a clock of its own — and, being new, is said
   *  again, which is right: it is the answer to a second press. */
  function add(message, tone = "ok", from = session) {
    if (from !== session) return null;
    const kind = TONES[tone] ? tone : "ok";
    const same = (item) => item.tone === kind && item.message === message;
    const copies = items.filter(same).map((item) => item.id);
    if (copies.length) remove(copies);
    for (const item of held.filter(same)) timers.delete(item.id);
    held = held.filter((item) => !same(item));
    seq += 1;
    const id = seq;
    const lifetime = TONES[kind].lifetime;
    if (lifetime) timers.set(id, { left: lifetime, since: 0, handle: null });
    (open ? show : hold)({ id, message, tone: kind });
    return id;
  }

  return {
    add,
    remove,
    /** The provider's props moved. A new session drops every toast, on screen and held; closing
     *  holds the ones on screen with their clocks stopped; opening shows the held ones in order. */
    gate(nextOpen, nextSession) {
      if (nextSession !== session) {
        session = nextSession;
        remove(items.map((item) => item.id));
        for (const item of held) timers.delete(item.id);
        held = [];
      }
      if (nextOpen === open) return;
      open = nextOpen;
      if (!open) {
        for (const item of items) stop(item.id);
        held = items;
        leave(items.map((item) => item.id));
      } else {
        const back = held;
        held = [];
        for (const item of back) show(item);
      }
    },
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
 *  - The same words in the same tone replace the earlier copy, which leaves its place: never two
 *    alike (G2-B1a walk, M-6).
 *  - A toast holds the TEXT it was raised with — every caller passes words already translated, never
 *    a key — so it stays in the language it was raised in when the reader switches language.
 *  - A toast closed while it has focus gives focus back to where it was (else <body>).
 *  - Stays usable while a Modal is open (MODAL_EXEMPT), and then sits top right instead of
 *    bottom right (<body> carries MODAL_OPEN). On a short screen (390 x 380) a dialog fills it
 *    and its sticky footer — Save, Cancel — is exactly where the stack would be. A dialog is
 *    centred, so its footer never reaches the top ~70 px; only the header of a dialog taller
 *    than about two thirds of the screen does, and its ✕ has stand-ins (Escape, Cancel). Not a
 *    raised bottom inset: that clears a full-height dialog's footer but lands on a short centred
 *    dialog's one. A keyboard user cannot Tab into a toast while a dialog is open (the dialog
 *    keeps Tab inside): recorded in the roadmap.
 *  `open` and `session`: the live shell's two facts (LiveApp — its screens are on the page; the
 *  session's epoch). Without them the provider is always open, in one session.
 *  - While not open (the lock screen, a step screen) nothing is drawn: not in the stack, not in
 *    the live regions. A toast raised meanwhile — a write that began before the lock and answered
 *    behind it — is HELD, and so are the ones on screen at closing, their timers stopped.
 *  - Opening again in the same session shows the held ones, in order and under TOAST_MAX, and
 *    their timers resume with the time they had. The live regions stayed on the page, empty,
 *    throughout, so the text arrives in regions that were already there and is announced.
 *  - A new session drops every toast, on screen and held; and useToast() is bound to the session
 *    it was rendered in, so a write of an ended session that answers later — even after the next
 *    sign-in — raises nothing. A toast never crosses sessions. Stopping the WRITE is not the
 *    toast's job: a screen still has to decide what a write that outlived its session may do.
 *  Raise a toast from an event handler or a passive effect, never from a layout effect: one raised
 *  in a child's useLayoutEffect in the commit that moves `session` is dropped as another session's,
 *  since children's layout effects run before the provider's `gate`. Nothing does so today.
 *  Not for alarms: a clinical alarm never lives in a toast. */
export function ToastProvider({ open = true, session, children }) {
  const { t } = useI18n();
  const base = useId();
  const [items, setItems] = useState([]);
  const [toasts] = useState(() => createToasts(setItems, { open, session }));
  const sayId = (id) => `${base}-toast-${id}`;

  // A layout effect: the toasts go out of sight before the lock screen is first painted, so a
  // refusal naming a bed or an account is never shown over it.
  useLayoutEffect(() => {
    toasts.gate(open, session);
  }, [toasts, open, session]);

  const raise = useMemo(() => (message, tone) => toasts.add(message, tone, session), [toasts, session]);

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
    <ToastContext.Provider value={raise}>
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
          className="pointer-events-none fixed bottom-4 right-4 z-[120] [body[data-modal-open]_&]:bottom-auto [body[data-modal-open]_&]:top-4"
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
