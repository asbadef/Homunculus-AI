// src/live/ui/Modal.jsx — the prototype's H.modal as a React dialog.
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Button } from "./Button.jsx";

/** A <body> child carrying this attribute stays usable while a dialog is open. The toast region
 *  has it: a toast announced while a dialog is open (an error after its Save) must still be
 *  heard, and an inert live region is dropped from the accessibility tree. */
export const MODAL_EXEMPT = "data-modal-exempt";

// Everything that can take keyboard focus; filtered below for disabled, hidden and tabindex="-1".
const CANDIDATES = [
  "a[href]", "area[href]", "button", "input:not([type='hidden'])", "select", "textarea", "iframe", "summary",
  "audio[controls]", "video[controls]", "[contenteditable]:not([contenteditable='false'])", "[tabindex]",
].join(",");

function focusables(root) {
  return [...root.querySelectorAll(CANDIDATES)].filter((el) => {
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) < 0) return false;
    if (el.matches(":disabled") || el.closest("[hidden], [inert]")) return false;
    // display:none, visibility:hidden, a closed <details> — in browsers that can tell (jsdom cannot).
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    return true;
  });
}

// A radio group is one Tab stop; the browser lands on its checked radio.
const sameStop = (a, b) => a === b
  || (a?.type === "radio" && b?.type === "radio" && a.name !== "" && a.name === b.name && a.form === b.form);

// ── One stack for every open dialog: only the topmost is interactive ───────────────────────────
const stack = [];
const madeInert = new Set(); // what we set inert, so an element that was inert before is never touched
let scrollLock = null;

const top = () => stack[stack.length - 1];

function syncInert() {
  const current = top();
  for (const el of document.body.children) {
    const want = Boolean(current) && !el.contains(current.backdrop) && !el.hasAttribute(MODAL_EXEMPT);
    if (want && !el.hasAttribute("inert")) {
      el.setAttribute("inert", "");
      madeInert.add(el);
    } else if (!want && madeInert.has(el)) {
      el.removeAttribute("inert");
      madeInert.delete(el);
    }
  }
  for (const el of madeInert) {
    if (!current || el.parentNode !== document.body) {
      el.removeAttribute("inert");
      madeInert.delete(el);
    }
  }
}

function lockScroll() {
  scrollLock = [document.documentElement, document.body].map((el) => ({
    el, overflow: el.style.overflow, hadStyle: el.hasAttribute("style"),
  }));
  for (const { el } of scrollLock) el.style.overflow = "hidden";
}

function unlockScroll() {
  for (const { el, overflow, hadStyle } of scrollLock) {
    el.style.overflow = overflow;
    if (!hadStyle && el.getAttribute("style") === "") el.removeAttribute("style");
  }
  scrollLock = null;
}

/** Tab is the browser's inside the dialog; this only steps in where the browser would leave it:
 *  at its two ends, from outside it (<body>, a toast), and from a control that stopped being
 *  focusable while it had focus (a footer button disabled while busy). */
function trapTab(event, dialog) {
  const items = focusables(dialog);
  const active = document.activeElement;
  const back = event.shiftKey;
  const first = items[0];
  const last = items[items.length - 1];
  let next = null;
  if (items.length === 0) next = dialog;
  else if (!dialog.contains(active) || active === dialog) next = back ? last : first;
  else if (!items.some((el) => sameStop(el, active))) {
    const after = (el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    next = (back ? [...items].reverse().find((el) => !after(el)) : items.find(after)) || (back ? last : first);
  } else if (back && sameStop(active, first)) next = last;
  else if (!back && sameStop(active, last)) next = first;
  if (!next) return;
  event.preventDefault();
  const checked = next.type === "radio" && next.name
    ? items.find((el) => sameStop(el, next) && el.checked)
    : null;
  (checked || next).focus();
}

function onDocumentKeyDown(event) {
  const current = top();
  if (!current || event.defaultPrevented || event.isComposing) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    current.escape();
  } else if (event.key === "Tab") {
    trapTab(event, current.dialog);
  }
}

function pushModal(entry) {
  if (stack.length === 0) {
    lockScroll();
    document.addEventListener("keydown", onDocumentKeyDown);
  }
  stack.push(entry);
  syncInert();
}

function popModal(entry) {
  const at = stack.indexOf(entry);
  if (at !== -1) stack.splice(at, 1);
  syncInert();
  if (stack.length === 0) {
    unlockScroll();
    document.removeEventListener("keydown", onDocumentKeyDown);
  }
}

/** A modal dialog (role="dialog", aria-modal), named by its title.
 *  - While open, the rest of the page is inert (every other <body> child, except one marked
 *    MODAL_EXEMPT — the toasts) and does not scroll. Dialogs stack: a dialog opened from a dialog
 *    makes the one below inert too, and closing it gives the one below back.
 *  - Opening moves focus into it — unless a child already took it (autoFocus): the body's first
 *    control, else the dialog itself. Closing returns focus to whatever had it before — unless
 *    focus has already gone somewhere else (the caller moved it).
 *  - Tab and Shift+Tab stay inside, and Escape closes, for the topmost dialog wherever focus is
 *    (a click on the backdrop or a toast can leave it on <body>). Escape, the ✕ and a press on
 *    the backdrop call onClose — except while `busy`: a request is in flight and its answer must
 *    land in an open dialog (the old workspace's ActionOverlay rule).
 *  - Rendered in a portal under <body>, so it takes <html data-theme> like everything else.
 *  `actions` is the footer (the prototype's .mf), `wide` its 1180 px variant.
 *
 *  Not the native <dialog>.showModal(): Chrome lets a second Escape close a modal <dialog>
 *  whatever its cancel handler says (close-watcher abuse rule), which would break `busy`; it would
 *  also make the toast region inert; and jsdom has neither showModal nor inert, so its behaviour
 *  could not be tested here. Elements a dialog adds to <body> after it opened (a portal of its own)
 *  are left usable. */
export function Modal({ open, ...props }) {
  if (!open) return null;
  return createPortal(<Dialog {...props} />, document.body);
}

function Dialog({ title, onClose, actions, wide = false, busy = false, children }) {
  const { t } = useI18n();
  const titleId = useId();
  const backdropRef = useRef(null);
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  // Read during the first render, before the effect below moves focus into the dialog.
  const [opener] = useState(() => document.activeElement);
  const latest = useRef(null);
  latest.current = { busy, onClose };
  const close = () => {
    if (!latest.current.busy && latest.current.onClose) latest.current.onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    const entry = { backdrop: backdropRef.current, dialog, escape: close };
    pushModal(entry);
    if (!dialog.contains(document.activeElement)) (focusables(bodyRef.current)[0] || dialog).focus();
    return () => {
      popModal(entry);
      // Only when focus is nowhere — the closed dialog took it along. Anything else is a choice
      // this cleanup must not undo: a caller that moved focus on purpose, or StrictMode's rehearsal
      // unmount, after which a child's autoFocus is still inside the dialog. Tried now, and again
      // once the commit is over: when two stacked dialogs close together the outer one's cleanup
      // runs first, while the inner one still holds the page inert and the opener in it.
      const restore = () => {
        const nowhere = !document.activeElement || document.activeElement === document.body;
        const usable = opener && opener !== document.body && opener.isConnected && !opener.closest("[inert]");
        if (nowhere && usable && typeof opener.focus === "function") opener.focus();
      };
      restore();
      queueMicrotask(restore);
    };
    // `close` reads the latest busy/onClose through a ref: the stack entry lives as long as the dialog.
  }, [opener]);

  return (
    <div
      ref={backdropRef}
      data-testid="modal-backdrop"
      className="fixed inset-0 z-[100] grid place-items-center bg-scrim p-4"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault(); // focus stays in the dialog, not on <body>
        close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
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
