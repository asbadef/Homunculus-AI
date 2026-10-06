// src/live/ui/Alert.jsx — a message that appears because of what the user just did, next to it:
// a refused sign-in, a wrong code, "you were signed out". The prototype's errBox (shell.js).
import React from "react";
import { Icon } from "./Icon.jsx";

const TONE = {
  crit: { role: "alert", icon: "alert",
    cls: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft text-crit-ink" },
  info: { role: "status", icon: "ok",
    cls: "border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft text-pri" },
};

/** Announced, unlike Note (a static aside): `crit` is role="alert" — read at once, for a refusal —
 *  and `info` role="status" — read politely, for a confirmation. Render it only while there is
 *  something to say: a screen reader announces it when it appears. tone: crit (default) | info. */
export function Alert({ tone = "crit", icon, className = "", children }) {
  const t = TONE[tone] ? tone : "crit";
  return (
    <div
      role={TONE[t].role}
      data-tone={t}
      className={`flex items-start gap-2 rounded-ctl border px-3 py-2.5 font-text text-13 font-semibold leading-snug ${TONE[t].cls} ${className}`}
    >
      <Icon name={icon || TONE[t].icon} size={16} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
