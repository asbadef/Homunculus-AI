// src/live/shell/Menu.jsx — the top bar's drop-downs: the prototype's .menu (shell.js openMenu).
//
// Popover: a button that opens a panel under it (the bell, the keyboard shortcuts). MenuButton: the
// same with a list of actions (the account, the language), as an ARIA menu. Both close on Escape —
// focus back on the button — and on a press outside them, which leaves focus where it went.
import React, { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";

export const TOOL_BUTTON =
  `relative grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-mute hover:bg-card2 hover:text-ink ${FOCUS_RING}`;
const PANEL = "absolute right-0 top-full z-[90] mt-1.5 min-w-[220px] rounded-box border border-line2 bg-card p-2 font-text text-ink shadow-pop";

function useDisclosure() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  return { open, setOpen, close, wrapRef, buttonRef };
}

/** A button and the panel it opens. `children(close)` renders the panel; it gets focus on open. */
export function Popover({ label, button, buttonClassName = TOOL_BUTTON, panelClassName = "", children }) {
  const { open, setOpen, close, wrapRef, buttonRef } = useDisclosure();
  const panelId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
          className={`${PANEL} outline-none ${panelClassName}`}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

/** A menu of actions. items: [{ key, label, icon?, onSelect, checked? }, …] and "separator";
 *  `checked` (true/false) makes the item a menuitemradio (the language). `header` is shown above
 *  the list and is not an item (who is signed in). Arrow keys move, Home/End jump, Escape and Tab
 *  close; opening focuses the checked item, else the first. */
export function MenuButton({ label, button, buttonClassName = TOOL_BUTTON, header = null, items, panelClassName = "" }) {
  const { open, setOpen, close, wrapRef, buttonRef } = useDisclosure();
  const menuId = useId();
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const all = [...listRef.current.querySelectorAll("[role^='menuitem']")];
    (all.find((el) => el.getAttribute("aria-checked") === "true") || all[0])?.focus();
  }, [open]);

  const move = (event) => {
    const all = [...listRef.current.querySelectorAll("[role^='menuitem']")];
    const at = all.indexOf(document.activeElement);
    const go = (i) => { event.preventDefault(); all[(i + all.length) % all.length]?.focus(); };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(all.length - 1);
    else if (event.key === "Escape") { event.stopPropagation(); close(); }
    else if (event.key === "Tab") close(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); }
          // Focus came back to the button while the menu is open (Shift+Tab from its first item).
          else if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        <div className={`${PANEL} ${panelClassName}`}>
          {header}
          <ul ref={listRef} id={menuId} role="menu" aria-label={label} onKeyDown={move} className="m-0 list-none p-0">
            {items.map((item, i) => (item === "separator" ? (
              <li key={`sep-${i}`} role="separator" className="my-1.5 border-t border-line" />
            ) : (
              <li key={item.key} role="none">
                <button
                  type="button"
                  role={typeof item.checked === "boolean" ? "menuitemradio" : "menuitem"}
                  aria-checked={typeof item.checked === "boolean" ? item.checked : undefined}
                  tabIndex={-1}
                  onClick={() => { close(); item.onSelect(); }}
                  className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[9px] text-left text-13 font-semibold text-ink hover:bg-card2 focus:bg-card2 ${FOCUS_RING}`}
                >
                  {item.icon ? <Icon name={item.icon} size={17} className="text-mute" /> : null}
                  <span className="flex-1">{item.label}</span>
                  {item.checked ? <Icon name="ok" size={16} className="text-pri" /> : null}
                </button>
              </li>
            )))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
