// src/live/screens/common/WaveFullscreen.jsx — the full-screen single-bed view (Lane C, dalga; spec
// W5): the panel's rows, filling the screen on a black ground, with the strip's own numbers beside
// them. Esc or × closes it; the stamp stays visible at full size. It asks the browser for full
// screen when it can, and is a window-filling overlay when it cannot. No sound, no number from a
// wave (spec §5.4, §5.8). The numbers are the strip's card for this monitor drawn by MonitorStrip
// itself — values, labels (HR is the strip's HR, PLS the strip's PLS), ages, evidence words and the
// whole note for the answer's stage («rules» at Aşama B), exactly as the strip prints them;
// MonitorStrip prints no patient.
import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { Button, Note, Tag } from "../../ui/index.js";
import { MonitorStrip, readUnknown, stripOn } from "./MonitorStrip.jsx";
import { maxAgeOf } from "./monitor.js";
import { WaveRows } from "./WaveRows.jsx";

/** The strip's card for this monitor — a bed card or an unassigned one — or null. */
export function cardOf(data, source) {
  if (!stripOn(data)) return null;
  return [...(data.beds ?? []), ...(data.unassigned ?? [])].find((card) => card.source === source) ?? null;
}

/** `note`: the panel's own words for why the stream is missing (a failed poll, a refusal), or null —
 *  the panel is behind this view, so a status is said here too, never left as a silent black row. */
export function WaveFullscreen({ source, title, device, note = null, onClose, raf, caf }) {
  const { t } = useI18n();
  const shadow = useShadow();
  const card = cardOf(shadow.data, source);
  const titleId = useId();
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    const root = rootRef.current;
    closeRef.current?.focus();
    // Escape closes, Tab stays on the one control there is; capture, so nothing behind sees either.
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
    const onChange = () => { if (!document.fullscreenElement) closing.current(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onChange);
    if (typeof root?.requestFullscreen === "function" && !document.fullscreenElement) {
      Promise.resolve(root.requestFullscreen()).catch(() => {});   // refused: the overlay fills the window
    }
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === root && typeof document.exitFullscreen === "function") {
        Promise.resolve(document.exitFullscreen()).catch(() => {});
      }
    };
  }, []);

  const maxAgeS = maxAgeOf(shadow.data);
  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={titleId} data-wave-fullscreen=""
      className="fixed inset-0 z-[120] flex flex-col gap-3 overflow-auto bg-black p-4 text-white">
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
