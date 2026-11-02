// src/live/screens/common/WaveFullscreen.jsx — the full-screen single-bed view (Lane C, dalga; spec
// W5): the panel's rows, filling the window on a black ground, with the strip's own numbers beside
// them. Esc or × closes it; the header and the stamp stay in view, the stamp at full size. No sound,
// no number from a wave (spec §5.4, §5.8). The numbers are the strip's card for this monitor drawn by
// MonitorStrip itself — values, labels (HR is the strip's HR, PLS the strip's PLS), ages, evidence
// words and the whole note for the answer's stage («rules» at Aşama B), exactly as the strip prints
// them — and the card is handed over without its patient (the device screen's rule, everywhere).
//
// The view is a fixed overlay (z-110) inside the page, and the browser's full screen is asked for
// the PAGE (<html>), not for the overlay: the app's toasts (z-120), idle warning (z-200) and alarm
// holder (z-210) stay above it and on screen while someone watches the waves. The page's full screen
// is shared with the top bar's button, so a view asks for it only when the page is not in it
// already, and hands it back only if a view asked for it, once no view is open. A browser that
// refuses — or throws — leaves the overlay filling the window. The rest of the page is not made
// inert (ui/Modal.jsx keeps that mechanism to itself); Tab is held on the one control instead.
import React, { useEffect, useId, useRef } from "react";
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

/** `note`: the panel's own words for why the stream is missing (a failed poll), or null — the panel
 *  is behind this view, so a status is said here too, never left as a silent black row. */
export function WaveFullscreen({ source, title, device, note = null, onClose, raf, caf }) {
  const { t } = useI18n();
  const shadow = useShadow();
  const card = cardOf(shadow.data, source);
  const titleId = useId();
  const closeRef = useRef(null);
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    page.views += 1;
    askForFullScreen();
    closeRef.current?.focus();
    // Escape closes, Tab comes back to the one control there is; capture, so nothing behind sees either.
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closing.current();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
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
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-wave-fullscreen=""
      className="fixed inset-0 z-[110] flex flex-col gap-3 overflow-auto bg-black p-4 text-white">
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
