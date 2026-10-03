// src/live/ui/Note.jsx — the prototype's .note (amber) and .note.i (information, primary blue).
import React from "react";
import { Icon } from "./Icon.jsx";

const TONE = {
  warn: "border-att-line bg-att text-att-ink",
  info: "border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft text-pri",
};

/** A short aside next to the content it qualifies. Static: it does not announce itself; a message
 *  that appears in response to an action belongs in a toast. tone: warn (default) | info. */
export function Note({ tone = "warn", icon, className = "", children }) {
  return (
    <div
      role="note"
      data-tone={TONE[tone] ? tone : "warn"}
      className={`flex items-start gap-2 rounded-ctl border px-2.5 py-2 font-text text-12.5 font-semibold leading-[normal] ${TONE[tone] || TONE.warn} ${className}`}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      <div>{children}</div>
    </div>
  );
}
