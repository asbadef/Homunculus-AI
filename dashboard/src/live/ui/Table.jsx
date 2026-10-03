// src/live/ui/Table.jsx — the prototype's table.t inside its .tw horizontal scroller.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FOCUS_RING } from "./focus.js";

const TABLE = [
  "w-full border-collapse font-text text-13",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-card2 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left",
  "[&_th]:text-10.5 [&_th]:font-bold [&_th]:uppercase [&_th]:leading-[normal] [&_th]:tracking-[.08em] [&_th]:text-mute",
  "[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-[9px] [&_td]:align-middle",
  "[&_tr:last-child_td]:border-b-0",
].join(" ");

/** Whether the frame is narrower than its table: on mount, then on every resize of either. */
function useOverflows(ref, watch) {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const frame = ref.current;
    if (!watch || !frame) return undefined;
    const check = () => setOverflows(frame.scrollWidth > frame.clientWidth);
    check();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(check);
      observer.observe(frame);
      if (frame.firstElementChild) observer.observe(frame.firstElementChild);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [ref, watch]);
  return overflows;
}

/** Callers write plain <thead>/<tbody>/<tr>/<th>/<td>; numeric cells take className="font-data
 *  font-bold" (the prototype's td.n). A header cell that names its row (a user name in the first
 *  column) is a <th scope="row">, so a screen reader reads it with each cell of that row; column
 *  headers need no scope.
 *  `caption` names the table (visually hidden) — give one: an unnamed table warns in development.
 *  When the table is wider than its frame (a 390 px phone), the frame becomes a named,
 *  keyboard-focusable region of the same name, so it can be scrolled without a mouse; a table
 *  that fits adds no tab stop. Rows are not clickable: put a button or link in the row instead. */
export function Table({ caption, className = "", children }) {
  const frame = useRef(null);
  const overflows = useOverflows(frame, Boolean(caption));
  useEffect(() => {
    if (!caption && import.meta.env.DEV) console.warn("Table: no caption — the table has no accessible name");
  }, [caption]);
  const region = caption && overflows ? { role: "region", "aria-label": caption, tabIndex: 0 } : {};
  return (
    <div ref={frame} {...region} className={`overflow-x-auto rounded-box border border-line bg-card ${FOCUS_RING} ${className}`}>
      <table className={TABLE}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
