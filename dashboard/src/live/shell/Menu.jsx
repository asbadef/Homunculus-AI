// src/live/shell/Menu.jsx — the top bar's drop-downs: the prototype's .menu (shell.js openMenu).
//
// Popover: a button that opens a panel under it (the bell, the keyboard shortcuts). MenuButton: the
// same with a list of actions (the account, the language), as an ARIA menu. Both close on Escape —
// focus back on the button — and whenever focus leaves them (a press outside, Tab out, a script, a
// screen reader's virtual cursor), which leaves focus where it went: a panel that stayed open
// behind a focus that left it would have no key that reaches it.
import React, { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";

export const TOOL_BUTTON =
  `relative grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-mute hover:bg-card2 hover:text-ink ${FOCUS_RING}`;
const PANEL = "absolute right-0 top-full z-[90] mt-1.5 min-w-[220px] rounded-box border border-line2 bg-card p-2 font-text text-ink shadow-pop outline-none";

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
  // Focus left the button and its panel (ui/Toast.jsx's rule): closed, focus staying where it went.
  // A focus that moves inside — the panel, an item, the button — is not a leaving.
  const blur = (event) => {
    if (!wrapRef.current?.contains(event.relatedTarget)) close(false);
  };
  return { open, setOpen, close, blur, wrapRef, buttonRef };
}

/** A button and the panel it opens. `children(close)` renders the panel; it gets focus on open. */
export function Popover({ label, button, buttonClassName = TOOL_BUTTON, panelClassName = "", children }) {
  const { open, setOpen, close, blur, wrapRef, buttonRef } = useDisclosure();
  const panelId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  return (
    <div ref={wrapRef} onBlur={blur} className="relative">
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
          className={`${PANEL} ${panelClassName}`}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

const ITEMS = "[role^='menuitem']";

/** A menu of actions. items: [{ key, label, icon?, onSelect, checked? }, …] and "separator";
 *  `checked` (true/false) makes the item a menuitemradio (the language). `header` is shown above
 *  the list and is not an item (who is signed in). Arrow keys move, Home/End jump, Escape and Tab
 *  close; opening focuses the checked item, else the first — ArrowUp on the button opens at the
 *  last (APG menu button), and either arrow on the button of an open menu enters it there. */
export function MenuButton({ label, button, buttonClassName = TOOL_BUTTON, header = null, items, panelClassName = "" }) {
  const { open, setOpen, close, blur, wrapRef, buttonRef } = useDisclosure();
  const menuId = useId();
  const listRef = useRef(null);
  const landing = useRef("checked");       // where the next opening puts focus: checked | first | last

  const itemAt = (where) => {
    const all = [...(listRef.current?.querySelectorAll(ITEMS) ?? [])];
    if (where === "last") return all[all.length - 1];
    if (where === "first") return all[0];
    return all.find((el) => el.getAttribute("aria-checked") === "true") || all[0];
  };

  useEffect(() => {
    if (!open) return;
    itemAt(landing.current)?.focus();
    landing.current = "checked";
  }, [open]);

  const openAt = (where) => {
    if (open) {
      itemAt(where)?.focus();
    } else {
      landing.current = where;
      setOpen(true);
    }
  };

  const move = (event) => {
    const all = [...listRef.current.querySelectorAll(ITEMS)];
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
    <div ref={wrapRef} onBlur={blur} className="relative">
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
          if (e.key === "ArrowDown") { e.preventDefault(); openAt("first"); }
          else if (e.key === "ArrowUp") { e.preventDefault(); openAt("last"); }
          // Focus is on the button while its menu is open (put there by a script or a screen
          // reader's virtual cursor — Tab out of the list already closes it): Escape still closes.
          else if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        // Focusable (not in the Tab order), so a press on the header keeps focus inside the menu.
        <div tabIndex={-1} className={`${PANEL} ${panelClassName}`}>
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
