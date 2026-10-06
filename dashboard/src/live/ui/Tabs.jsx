// src/live/ui/Tabs.jsx — the prototype's .tabs, as an ARIA tab list.
import React, { useId, useRef } from "react";
import { FOCUS_RING } from "./focus.js";

// Ids come from the base and the tab's position, never from its value: a value may hold spaces
// or quotes, and aria-controls / aria-labelledby are space-separated id lists.
const tabId = (base, index) => `${base}-tab-${index}`;
const panelId = (base, index) => `${base}-panel-${index}`;

/** tabs: [{ value, label, count?, countLabel? }]. `id` is the base of the tab and panel ids: give
 *  the same `id` (and `tabs`) to <TabPanel>. Without `id` the tabs get generated ids and point at
 *  no panel. Left/Right move between tabs and select (automatic activation), Home/End jump to the
 *  ends — not with Alt, Ctrl or Meta held, which belong to the browser and the system. Only the
 *  selected tab is in the Tab order (the first one when `value` matches none), and only it
 *  carries aria-controls: the caller renders only the selected panel.
 *  `count` shows the prototype's amber badge (its <em>); `countLabel` (from t()) is what a screen
 *  reader hears instead of the bare number ("2 pending"). */
export function Tabs({ id, label, tabs, value, onChange, className = "" }) {
  const generated = useId();
  const base = id || generated;
  const refs = useRef([]);
  const index = tabs.findIndex((tab) => tab.value === value);
  const stop = index === -1 ? 0 : index;

  const onKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = { ArrowRight: stop + 1, ArrowLeft: stop - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = (target + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`my-3 flex gap-0.5 overflow-x-auto border-b border-line ${className}`}>
      {tabs.map((tab, i) => {
        const on = i === index;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(base, i)}
            aria-controls={on && id ? panelId(base, i) : undefined}
            aria-selected={on}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`inline-flex items-center gap-[5px] whitespace-nowrap border-b-2 bg-transparent px-3 py-[9px] font-text text-13 font-semibold leading-[normal] ${on ? "border-pri text-ink" : "border-transparent text-mute hover:text-ink"} ${FOCUS_RING}`}
          >
            {tab.label}
            {tab.count ? (
              <span aria-hidden={tab.countLabel ? "true" : undefined} className="rounded-full bg-mid px-1.5 py-px font-text text-10 font-bold text-onmid">
                {tab.count}
              </span>
            ) : null}
            {tab.count && tab.countLabel ? <span className="sr-only"> {tab.countLabel}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The selected tab's panel. Same `id` and `tabs` as its <Tabs>, and the selected `value`.
 *  A `value` that matches no tab selects none in <Tabs>, so the panel then claims no tab either:
 *  no id for an aria-controls, no aria-labelledby (the first tab is only the Tab stop). */
export function TabPanel({ id, tabs, value, className = "", children }) {
  if (!id && import.meta.env.DEV) console.warn("TabPanel: no id — it cannot name its tab (give <Tabs> and <TabPanel> the same id)");
  const index = id ? tabs.findIndex((tab) => tab.value === value) : -1;
  const link = index === -1 ? {} : { id: panelId(id, index), "aria-labelledby": tabId(id, index) };
  return (
    <div role="tabpanel" {...link} tabIndex={0} className={`${FOCUS_RING} ${className}`}>
      {children}
    </div>
  );
}
