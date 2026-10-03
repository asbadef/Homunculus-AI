// src/live/ui/Table.jsx — the prototype's table.t inside its .tw horizontal scroller.
import React from "react";
import { FOCUS_RING } from "./focus.js";

const TABLE = [
  "w-full border-collapse font-text text-13",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-card2 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left",
  "[&_th]:text-10.5 [&_th]:font-bold [&_th]:uppercase [&_th]:leading-[normal] [&_th]:tracking-[.08em] [&_th]:text-mute",
  "[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-[9px] [&_td]:align-middle",
  "[&_tr:last-child_td]:border-b-0",
].join(" ");

/** Callers write plain <thead>/<tbody>/<tr>/<th>/<td>; numeric cells take className="font-data
 *  font-bold" (the prototype's td.n). `caption` names the table (visually hidden) and makes the
 *  scroller a named, keyboard-focusable region, so a table wider than a 390 px phone can be
 *  scrolled without a mouse. Rows are not clickable: put a button or link in the row instead. */
export function Table({ caption, className = "", children }) {
  const region = caption ? { role: "region", "aria-label": caption, tabIndex: 0 } : {};
  return (
    <div {...region} className={`overflow-x-auto rounded-box border border-line bg-card ${FOCUS_RING} ${className}`}>
      <table className={TABLE}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
