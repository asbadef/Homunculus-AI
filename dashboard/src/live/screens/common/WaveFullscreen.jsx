// src/live/screens/common/WaveFullscreen.jsx — the full-screen single-bed view (Lane C, dalga; spec
// W5): the panel's rows, filling the window on a black ground, with the strip's own numbers beside
// them. Esc or × closes it; the header and the stamp stay in view, the stamp at full size. No sound,
// no number from a wave (spec §5.4, §5.8). The numbers are the strip's card for this monitor drawn by
// MonitorStrip itself — values, labels (HR is the strip's HR, PLS the strip's PLS), ages, evidence
// words and the whole note for the answer's stage («rules» at Aşama B), exactly as the strip prints
// them — and the card is handed over without its patient (the device screen's rule, everywhere).
//
// The view is a fixed overlay (z-80) inside the page, and the browser's full screen is asked for
// the PAGE (<html>), not for the overlay: the app's toasts (z-120), idle warning (z-200) and alarm
// holder (z-210) stay above it and on screen while someone watches the waves. The page's full screen
// is shared with the top bar's button, so a view asks for it only when the page is not in it
// already, and hands it back only if a view asked for it, once no view is open. A browser that
// refuses — or throws — leaves the overlay filling the window below the top bar.
//
// The full screen never hides an alarm cue (final review I-1). New alarms raise no toast, the
// notification fires only for a hidden page and the sound starts off, so the app's top bar — the
// bell with its waiting count — stays in view: the overlay starts at the bar's bottom edge, measured
// when it opens (the bar is found by its landmark, the page's banner: a wave module imports nothing
// from shell/), and sits under the bar's drop-downs (z-90), so the bell's list opens over the black.
// The bar is in reach of Tab too: Tab and Shift+Tab go round the bar's controls and the view's,
// never to the page behind. The view is therefore not aria-modal. Its keys are its own (Lane A's
// review, M3): it answers Tab and Escape only for a key pressed inside it or with the focus lost to
// the page's body, and Tab in the bar; a layer above it (the idle warning, the alarm holder) and the
// bar's own menus keep their Escape. The rest of the page is not made inert (ui/Modal.jsx keeps that
// mechanism to itself).
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { Button, Note, Tag } from "../../ui/index.js";
import { MonitorStrip, readUnknown, stripOn } from "./MonitorStrip.jsx";
import { maxAgeOf } from "./monitor.js";
import { WaveRows } from "./WaveRows.jsx";

/** The strip's card for this monitor — a bed card or an unassigned one — without its patient, or
 *  null. The full screen opens from the device screen too, which never shows who is linked. */
export function cardOf(data, source) {
  if (!stripOn(data)) return null;
  const card = [...(data.beds ?? []), ...(data.unassigned ?? [])].find((c) => c.source === source);
  return card ? { ...card, patient_id: null, link: "hidden", link_reason: null } : null;
}

// The page's full screen, as the wave views hold it. Module state, because StrictMode's rehearsal
// mounts, unmounts and mounts a view again before the browser has answered the first request.
const page = { views: 0, asked: false, pending: false };

function askForFullScreen() {
  const root = document.documentElement;
  if (document.fullscreenElement || page.asked || typeof root.requestFullscreen !== "function") return;
  page.asked = true;
  page.pending = true;
  try {
    Promise.resolve(root.requestFullscreen()).then(
      () => { page.pending = false; handBack(); },          // a view closed before the answer: give it back
      () => { page.pending = false; page.asked = false; },   // refused: the overlay fills the window
    );
  } catch {
    page.pending = false;                                    // refused outright (a policy, an old browser)
    page.asked = false;
  }
}

/** The page's full screen back, if a wave view asked for it and none is open any more. */
function handBack() {
  if (page.views > 0 || !page.asked || page.pending) return;
  page.asked = false;
  if (!document.fullscreenElement || typeof document.exitFullscreen !== "function") return;
  try {
    Promise.resolve(document.exitFullscreen()).catch(() => {});
  } catch {
    // refused outright: the page stays in full screen, and the top bar's button still leaves it
  }
}

/** The app's top bar: the page's banner landmark — an explicit one, or a <header> outside any
 *  sectioning element (HTML-AAM) — or null on a page without one. */
function topBar() {
  return [...document.querySelectorAll("header, [role='banner']")].find((el) => el.getAttribute("role") === "banner"
    || !el.parentElement?.closest("main, article, aside, nav, section, [role='dialog'], [role='alertdialog']")) ?? null;
}

/** Where the view starts: the top bar's bottom edge, or the window's top on a page without a bar. */
function topOf(bar) {
  const bottom = bar ? bar.getBoundingClientRect().bottom : 0;
  return Number.isFinite(bottom) && bottom > 0 ? Math.round(bottom) : 0;
}

const TABBABLE = "a[href], button, input, select, textarea, [tabindex]";
/** The controls Tab goes round while the view is open, in page order: the bar's, then the view's. */
function tabbable(...roots) {
  return roots.filter(Boolean)
    .flatMap((root) => [...root.querySelectorAll(TABBABLE)])
    .filter((el) => el.tabIndex >= 0 && !el.disabled && !el.closest("[inert]"))
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/** Focus the next control after `from` (or before it, `back`), round the end; one the browser will
 *  not focus (hidden at this width) is passed over. */
function step(ring, from, back) {
  const after = ring.filter((el) => from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const before = ring.filter((el) => el !== from && !after.includes(el));
  const order = back ? [...before.reverse(), ...after.reverse()] : [...after, ...before];
  for (const el of order) {
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/** `note`: the panel's own words for why the stream is missing (a failed poll), or null — the panel
 *  is behind this view, so a status is said here too, never left as a silent black row. */
export function WaveFullscreen({ source, title, device, note = null, onClose, raf, caf }) {
  const { t } = useI18n();
  const shadow = useShadow();
  const card = cardOf(shadow.data, source);
  const titleId = useId();
  const viewRef = useRef(null);
  const closeRef = useRef(null);
  const closing = useRef(onClose);
  closing.current = onClose;
  // Measured once, as it opens: the bar is 58 px at every width and does not move while the view is up.
  const [top] = useState(() => topOf(topBar()));

  useEffect(() => {
    page.views += 1;
    askForFullScreen();
    closeRef.current?.focus();
    // Capture, so a key the view answers reaches nothing behind it. Only a key pressed in the view, or
    // with the focus lost to the page (on <body>), is the view's; Tab in the top bar goes round the bar
    // and the view; any other key, and every key of a layer above (the idle warning, the alarm
    // holder), is left alone (M3).
    const onKey = (event) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      const target = event.target;
      const lost = target === document || target === document.body || target === document.documentElement;
      const inView = lost || Boolean(viewRef.current?.contains(target));
      const bar = topBar();
      if (event.key === "Escape") {
        if (!inView) return;                                 // the bar's menus and the layers above keep theirs
        event.preventDefault();
        event.stopPropagation();
        closing.current();
        return;
      }
      if (!inView && !bar?.contains(target)) return;
      event.preventDefault();
      const moved = !lost && step(tabbable(bar, viewRef.current), target, event.shiftKey);
      if (!moved) closeRef.current?.focus();
    };
    // In browser full screen, Escape leaves full screen without a key event: that closes it too.
    // Entering it is announced the same way, and is not a reason to close.
    const onChange = () => {
      if (document.fullscreenElement) return;
      page.asked = false;
      closing.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onChange);
      page.views -= 1;
      handBack();
    };
  }, []);

  const maxAgeS = maxAgeOf(shadow.data);
  return createPortal(
    <div ref={viewRef} role="dialog" aria-labelledby={titleId} data-wave-fullscreen="" style={{ top: `${top}px` }}
      className="fixed inset-x-0 bottom-0 z-[80] flex flex-col gap-3 overflow-auto bg-black p-4 text-white">
      {/* The header and the stamp stay in view however far the rows and the strip scroll. */}
      <div data-wave-head="" className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-col gap-3 bg-black px-4 pb-1 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={titleId} className="m-0 font-display text-20 font-bold leading-[normal]">
            {title ? `${title} · ${t("waves.title")}` : t("waves.title")}
          </h2>
          <Tag tone="warn">{t("waves.tag")}</Tag>
          <span className="font-text text-12.5 text-white/70">{t("waves.delay")}</span>
          <Button ref={closeRef} icon="x" label={t("waves.close")} onClick={() => closing.current()} className="ml-auto" />
        </div>
        <p data-wave-stamp="" className="m-0 font-text text-17 font-bold text-amber-300">{t("waves.stamp")}</p>
        {note ? <Note className="self-start">{note}</Note> : null}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_340px]">
        <WaveRows device={device} tall raf={raf} caf={caf} />
        {card ? (
          <MonitorStrip entry={card} variant="full" title={title} level={3} className="self-start bg-card text-ink"
            nowMs={shadow.nowMs} fetchedAtMs={shadow.fetchedAtMs} maxAgeS={maxAgeS}
            feedOk={shadow.data.feed?.state === "ok"} stage={shadow.data.stage}
            unreadable={readUnknown(shadow, shadow.nowMs, maxAgeS)} />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
