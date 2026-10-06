// src/live/ui/Alert.jsx — a message that appears because of what the user just did, next to it:
// a refused sign-in, a wrong code, "you were signed out". The prototype's errBox (shell.js).
import React, { useEffect, useState } from "react";
import { Icon } from "./Icon.jsx";

const TONE = {
  crit: { role: "alert", icon: "alert",
    cls: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft text-crit-ink" },
  info: { role: "status", icon: "ok",
    cls: "border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft text-pri" },
};

/** Announced, unlike Note (a static aside): `crit` is role="alert" — read at once, for a refusal —
 *  and `info` role="status" — read politely, for a confirmation. Render it only while there is
 *  something to say: a screen reader announces it when it appears. tone: crit (default) | info.
 *
 *  A status region that is inserted with its text already in it is often not announced (NVDA/JAWS
 *  with Chrome): so `info` keeps its region on the page EMPTY at first and fills it right after
 *  mount, which is a change the reader does announce. A refusal (role="alert") is announced as
 *  inserted and renders at once. The same text is read once: to have it read again — a second
 *  failed attempt — unmount the Alert between attempts (give it a new `key`, or stop rendering it
 *  while the next request runs); re-rendering it with the same text says nothing. */
export function Alert({ tone = "crit", icon, className = "", children }) {
  const t = TONE[tone] ? tone : "crit";
  const polite = TONE[t].role === "status";
  const [filled, setFilled] = useState(!polite);
  useEffect(() => {
    setFilled(true);
  }, []);
  return (
    <div
      role={TONE[t].role}
      data-tone={t}
      className={filled
        ? `flex items-start gap-2 rounded-ctl border px-3 py-2.5 font-text text-13 font-semibold leading-snug ${TONE[t].cls} ${className}`
        : undefined}
    >
      {filled && <Icon name={icon || TONE[t].icon} size={16} className="mt-px shrink-0" />}
      {filled && <div className="min-w-0">{children}</div>}
    </div>
  );
}
