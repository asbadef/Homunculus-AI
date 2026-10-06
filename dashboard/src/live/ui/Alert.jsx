// src/live/ui/Alert.jsx — a message that appears because of what the user just did, next to it:
// a refused sign-in, a wrong code, "you were signed out". The prototype's errBox (shell.js).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon.jsx";

const TONE = {
  crit: { icon: "alert",
    cls: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft text-crit-ink" },
  info: { icon: "ok",
    cls: "border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft text-pri" },
};

/** How long a notice's text waits before it is handed to the screen reader. React runs passive
 *  effects before the next frame, so a fill "right after mount" reaches the browser's
 *  accessibility tree together with the region and is not announced; a real delay is. */
export const ANNOUNCE_DELAY_MS = 150;

/** Announced, unlike Note (a static aside). tone: crit (default) | info.
 *
 *  `crit` is one `role="alert"` box, read at once: a refusal.
 *
 *  `info` is a confirmation, read politely, and is two things: the box everyone sees, shown at
 *  once and hidden from assistive technology (`aria-hidden`), and a visually hidden
 *  `role="status"` region that stays mounted EMPTY and receives the same text ANNOUNCE_DELAY_MS
 *  later — the only way a live region reliably speaks (NVDA/JAWS with Chrome). Nothing is spoken
 *  twice, and an unmount before the delay says nothing and leaves no timer.
 *
 *  The content of an `info` notice is TEXT ONLY: the box is hidden from assistive technology, so
 *  a link or a button in it would be focusable yet unnamed (development warns once). Put an
 *  action next to the notice, not in it.
 *
 *  Render it only while there is something to say. The same text is read once: to have it read
 *  again — a second failed attempt — unmount the Alert between attempts (a new `key`, or stop
 *  rendering it while the next request runs); re-rendering it with the same text says nothing. */
export function Alert({ tone = "crit", icon, className = "", children }) {
  const t = TONE[tone] ? tone : "crit";
  const box = (
    `flex items-start gap-2 rounded-ctl border px-3 py-2.5 font-text text-13 font-semibold leading-snug ${TONE[t].cls} ${className}`
  );
  const body = (
    <>
      <Icon name={icon || TONE[t].icon} size={16} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </>
  );
  if (t === "crit") {
    return <div role="alert" data-tone={t} className={box}>{body}</div>;
  }
  return <PoliteAlert tone={t} className={box}>{body}</PoliteAlert>;
}

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex=\"-1\"]), [contenteditable=\"true\"]";

function PoliteAlert({ tone, className, children }) {
  const visible = useRef(null);
  const warned = useRef(false);
  const [text, setText] = useState("");
  const [said, setSaid] = useState("");
  // The text the box shows, read after every render: a parent re-rendering with the same text hands
  // in a new `children` element each time, and must not postpone the announcement (the timer below
  // is keyed on the text, not on the element).
  useLayoutEffect(() => {
    setText(visible.current?.textContent ?? "");
    if (import.meta.env.DEV && !warned.current && visible.current?.querySelector(FOCUSABLE)) {
      warned.current = true;
      console.warn("Alert: an info notice is text only — its box is aria-hidden, so a focusable element in it is unnamed");
    }
  });
  useEffect(() => {
    if (!text) return undefined;
    const timer = setTimeout(() => setSaid(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <>
      <div ref={visible} aria-hidden="true" data-tone={tone} className={className}>{children}</div>
      <div role="status" className="sr-only">{said}</div>
    </>
  );
}
