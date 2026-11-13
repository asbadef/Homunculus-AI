// src/live/shell/GlobalSearch.jsx — the prototype's top-bar search (.top .search): «Hasta, yatak,
// protokol ara» with Ctrl K. It searches the board this session already holds — bed label, patient
// id (the protocol number), HIS name — with the bed board's own matching (beds/order.js `matching`),
// and opens the patient. It reads nothing new and shows nothing the board does not.
//
// Keys: Ctrl K (⌘K) or «/» outside a text field puts the cursor here; ↑ ↓ move, Enter opens, Esc
// closes. The list is a listbox the field controls (combobox pattern), so a screen reader hears the
// count and the row under the cursor.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { Icon } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { bedNameOf, matching } from "../screens/beds/order.js";
import { nameOf } from "../screens/common/BoardState.jsx";

export const SEARCH_MAX = 8;
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function GlobalSearch() {
  const { t } = useI18n();
  const board = useBoard();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef(null);
  const list = useId();
  const hits = useMemo(() => (query.trim() ? matching(board.patients ?? [], query).slice(0, SEARCH_MAX) : []), [board.patients, query]);

  useEffect(() => {
    const onKey = (e) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing(document.activeElement))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (p) => {
    if (!p) return;
    window.location.hash = `#/patients/${encodeURIComponent(p.patient_id)}`;
    setQuery("");
    setOpen(false);
    input.current?.blur();
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAt((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(hits[at]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };
  const shown = open && query.trim() !== "";

  return (
    <div className="relative hidden w-full min-w-[160px] max-w-[440px] flex-1 min-[861px]:block">
      <label className="flex h-10 items-center gap-2 rounded-xl border border-line bg-card2 pl-[11px] pr-1.5 text-mute focus-within:border-pri">
        <Icon name="search" size={16} />
        <span className="sr-only">{t("shell.search")}</span>
        <input
          ref={input}
          role="combobox"
          aria-expanded={shown}
          aria-controls={list}
          aria-autocomplete="list"
          aria-activedescendant={shown && hits[at] ? `${list}-${at}` : undefined}
          value={query}
          placeholder={t("shell.searchPlaceholder")}
          onChange={(e) => { setQuery(e.target.value); setAt(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent font-text text-13 font-medium text-ink outline-none placeholder:text-mute"
        />
        <kbd className="rounded-md border border-line2 bg-card px-1.5 py-1 font-data text-10.5 font-semibold leading-none text-mute">Ctrl K</kbd>
      </label>
      {shown ? (
        <ul id={list} role="listbox" aria-label={t("shell.search")}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 m-0 max-h-[min(420px,60vh)] list-none overflow-auto rounded-box border border-line bg-card p-1 shadow-pop">
          {hits.length ? hits.map((p, i) => (
            <li key={p.patient_id} id={`${list}-${i}`} role="option" aria-selected={i === at}>
              <a href={`#/patients/${encodeURIComponent(p.patient_id)}`} onMouseDown={(e) => { e.preventDefault(); go(p); }}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-13 ${i === at ? "bg-pri-soft" : "hover:bg-card2"} ${FOCUS_RING}`}>
                <b className="shrink-0 font-data text-pri">{bedNameOf(p)}</b>
                <span className={`min-w-0 truncate ${p.display_name ? "text-ink" : "italic text-mute"}`}>{nameOf(p, t)}</span>
                <span className="ml-auto shrink-0 font-data text-11 text-mute">{p.patient_id}</span>
              </a>
            </li>
          )) : <li className="px-2.5 py-2 text-13 text-mute">{t("shell.searchNone", { query: query.trim() })}</li>}
        </ul>
      ) : null}
    </div>
  );
}
