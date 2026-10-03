// src/live/ui/Tag.jsx — the prototype's small labels: .tag (outlined), .pill (soft), .sv (status).
import React from "react";
import { Icon } from "./Icon.jsx";

const TAG = {
  neutral: "border-line2 text-mute", //                                                    .tag
  warn: "border-att-line bg-att text-att-ink", //                                          .tag.w
  crit: "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft text-crit-ink", // .tag.c
};

/** An outlined label: a unit name, "first sign-in", "2FA required". tone: neutral | warn | crit. */
export function Tag({ tone = "neutral", icon, className = "", children }) {
  const t = TAG[tone] ? tone : "neutral";
  return (
    <span data-tone={t} className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-lg border px-2 py-[3px] font-text text-11.5 font-semibold leading-[normal] ${TAG[t]} ${className}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

/** A soft, borderless label on card2 (the prototype's .pill): "2FA on", a count, a source. */
export function Pill({ icon, className = "", children }) {
  return (
    <span className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-card2 px-2 py-[3px] font-text text-11.5 font-semibold leading-[normal] text-mute ${className}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

// Severity text sits on its own fill's 14 % tint (the prototype's .sv). Ink, not fill, for the
// text: in daylight the fills are too light to read on their tint (tokens.test.js). Neutral uses
// the .pill look, because mute on a mute tint is under 4.5:1 in daylight. att is the warning
// tag's look (.tag.w; an inset ring, so the pill keeps its size) for a value the screen cannot
// vouch for — an engine risk it does not know, or none at all (riskStyle.js).
const STATUS = {
  crit: "text-crit-ink bg-[color:color-mix(in_srgb,var(--crit)_14%,transparent)]",
  high: "text-high-ink bg-[color:color-mix(in_srgb,var(--high)_14%,transparent)]",
  mid: "text-mid-ink bg-[color:color-mix(in_srgb,var(--mid)_14%,transparent)]",
  low: "text-low-ink bg-[color:color-mix(in_srgb,var(--low)_14%,transparent)]",
  ok: "text-ok-ink bg-[color:color-mix(in_srgb,var(--ok)_14%,transparent)]",
  att: "text-att-ink bg-att ring-1 ring-inset ring-att-line",
  neutral: "text-mute bg-card2",
};
export const STATUS_TONES = Object.keys(STATUS);

/** A coloured status pill, upper-cased by CSS (so <html lang> gets "İ" right in AZ/TR).
 *  tone: crit | high | mid | low | ok | att | neutral. Colour is never the only signal: the label is
 *  the children, and risk pills add an icon (RiskPill). ok is for states like "Active" — an
 *  engine risk never maps to it (riskStyle.js). */
export function StatusPill({ tone = "neutral", icon, className = "", children }) {
  const t = STATUS[tone] ? tone : "neutral";
  return (
    <span data-tone={t} className={`inline-flex h-fit items-center gap-[5px] whitespace-nowrap rounded-full px-2 py-1 font-text text-10.5 font-bold uppercase leading-[normal] tracking-[.04em] ${STATUS[t]} ${className}`}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
