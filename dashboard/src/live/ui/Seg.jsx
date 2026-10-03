// src/live/ui/Seg.jsx — the prototype's .seg: one choice out of a few, as joined buttons.
import React from "react";
import { Icon } from "./Icon.jsx";
import { FOCUS_RING } from "./focus.js";

// Windows high-contrast (forced colours) drops the chosen option's fill, so it gets a 2 px border
// there instead (system Highlight where the browser honours it, else the forced text colour), its
// padding 2 px smaller so the button keeps its size. A border, not an outline: the outline is the
// keyboard focus mark (FOCUS_RING), and the two must stay distinguishable.
const CHOSEN = "bg-pri text-onpri forced-colors:border-2 forced-colors:border-[Highlight] forced-colors:px-[9px] forced-colors:py-1";
const OTHER = "bg-transparent text-mute hover:text-ink";

/** A labelled group of toggle buttons (aria-pressed); the chosen one is filled.
 *  options: [{ value, label, icon?, lang? }] — `lang` marks a label in another language (a
 *  language picker's "Русский"), so a screen reader pronounces it in that language. */
export function Seg({ label, options, value, onChange, className = "" }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-ctl border border-line bg-card p-[3px] ${className}`}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            lang={option.lang}
            aria-pressed={on}
            onClick={() => {
              if (!on) onChange(option.value);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-[11px] py-1.5 font-text text-13 font-semibold leading-[normal] ${on ? CHOSEN : OTHER} ${FOCUS_RING}`}
          >
            {option.icon ? <Icon name={option.icon} size={15} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
