// src/live/ui/Tabs.jsx — the prototype's .tabs, as an ARIA tab list.
import React, { useRef } from "react";
import { FOCUS_RING } from "./focus.js";

const tabId = (id, value) => `${id}-tab-${value}`;
const panelId = (id, value) => `${id}-panel-${value}`;

/** tabs: [{ value, label, count? }]. `id` is the base of the tab and panel ids: give the same
 *  `id` to <TabPanel>. Left/Right move between tabs and select (automatic activation), Home/End
 *  jump to the ends, and only the selected tab is in the Tab order. `count` shows the prototype's
 *  amber badge (its <em>). The caller renders only the selected panel. */
export function Tabs({ id, label, tabs, value, onChange, className = "" }) {
  const refs = useRef({});
  const index = tabs.findIndex((tab) => tab.value === value);

  const onKeyDown = (event) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length];
    onChange(next.value);
    refs.current[next.value]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`my-3 flex gap-0.5 overflow-x-auto border-b border-line ${className}`}>
      {tabs.map((tab) => {
        const on = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[tab.value] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id, tab.value)}
            aria-controls={panelId(id, tab.value)}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={`inline-flex items-center gap-[5px] whitespace-nowrap border-b-2 bg-transparent px-3 py-[9px] font-text text-13 font-semibold leading-[normal] ${on ? "border-pri text-ink" : "border-transparent text-mute hover:text-ink"} ${FOCUS_RING}`}
          >
            {tab.label}
            {tab.count ? (
              <span className="rounded-full bg-mid px-1.5 py-px font-text text-10 font-bold text-onmid">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, value, className = "", children }) {
  return (
    <div role="tabpanel" id={panelId(id, value)} aria-labelledby={tabId(id, value)} tabIndex={0} className={`${FOCUS_RING} ${className}`}>
      {children}
    </div>
  );
}
