// src/live/screens/bedside/SavedStep.jsx — «Kaydedildi» (G3-01, D3, D13): what was just saved and when it was
// measured, and a «Hatalı giriş» for each value. A slipped value is most likely to be seen right after it was
// typed. A withdrawn row stays, struck through and said as such, as the chart keeps it. A row's id is the
// door's answer (`entries`, VitalsForm `savedOf`); a row with none (an older engine) offers no button. The
// host's actions are the children: the page's «Sıradaki hasta» and «Hasta ekranı», the dialog's «Kapat».
//
// FOCUS. A struck row loses its button, and `Modal` cannot give focus back to a button that has left the page, so
// focus would fall to <body>. The row takes it instead (`tabIndex={-1}`, a ref per entry): its words — value,
// «hatalı giriş olarak işaretlendi» — are what the clinician needs to hear next. Only a withdrawal that struck the
// row moves it; every other ending leaves the button, and `Modal` restores focus to it.
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button, FOCUS_RING } from "../../ui/index.js";
import { RetractDialog } from "../common/RetractDialog.jsx";
import { specOf, valueText } from "./vitalsFields.js";

/** `saved` is `{ atMs, rows: [{ code, value, entry }] }`; `onRetract(entry, reason)` is the withdrawal, bound to
 *  the patient by the host; `nowMs` says which day «today» is for the time. `level` is the heading level of the
 *  box (the page's 2; 3 inside a dialog, under the dialog's own h2), and its list heading sits one below it. */
export function SavedStep({ bed, saved, nowMs, onRetract, level = 2, children }) {
  const { t } = useI18n();
  const [withdrawn, setWithdrawn] = useState(() => new Set());
  const [open, setOpen] = useState(null);   // the row whose «Hatalı giriş» is open
  const rows = useRef(new Map());            // entry -> its <li>, for the focus a struck row takes
  const struckNow = useRef(null);            // the entry whose strike is waiting for its row's focus
  const base = useId();
  const time = dayStamp(saved.atMs, nowMs);
  // After the commit that struck the row (and closed the dialog): the dialog's own cleanup has run by now.
  useEffect(() => {
    if (struckNow.current === null) return;
    rows.current.get(struckNow.current)?.focus();
    struckNow.current = null;
  }, [withdrawn]);
  const labelOf = (code) => {
    const spec = specOf(code);
    return spec ? t(spec.labelKey) : code;
  };
  const ListHeading = `h${level + 1}`;
  return (
    <Box title={t("olcum.saved", { time })} icon="ok" level={level}>
      <ListHeading className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.savedList")}</ListHeading>
      {/* role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver. */}
      <ul role="list" className="m-0 mt-1 list-none p-0">
        {saved.rows.map((row) => {
          const struck = row.entry !== null && withdrawn.has(row.entry);
          const value = valueText(t, row.code, row.value);
          const labelId = `${base}-${row.code}`;
          return (
            <li
              key={`${row.code}:${row.entry ?? ""}`} data-row={row.code} tabIndex={-1}
              ref={(node) => {
                if (row.entry === null) return;
                if (node) rows.current.set(row.entry, node);
                else rows.current.delete(row.entry);
              }}
              className={`flex flex-wrap items-center gap-2 border-b border-line py-2 outline-none last:border-b-0 ${FOCUS_RING}`}
            >
              <span className="min-w-0 flex-1 text-14.5">
                <span id={labelId} className="font-semibold text-mute">{labelOf(row.code)}</span>{" "}
                {struck ? <s className="font-data">{value}</s> : <b className="font-data">{value}</b>}
                {struck ? <span className="ml-2 text-12 font-semibold text-att-ink">{t("olcum.retractedShort")}</span> : null}
              </span>
              {row.entry !== null && !struck ? (
                // The name stays «Hatalı giriş»; the row's label tells the buttons apart for a screen reader.
                <Button size="sm" variant="ghost" icon="x" aria-describedby={labelId} onClick={() => setOpen(row)}>{t("olcum.retract")}</Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap justify-end gap-2">{children}</div>
      {open ? (
        <RetractDialog
          bed={bed} what={{ label: labelOf(open.code), value: valueText(t, open.code, open.value), time }}
          onRetract={(reason) => onRetract(open.entry, reason)}
          // «Already» is withdrawn too; an uncertain one keeps its button — a second try is answered «already». A
          // refusal that wrote nothing (a discharged patient) sends no outcome at all.
          onDone={(outcome) => {
            if (outcome === "uncertain") return;
            struckNow.current = open.entry;
            setWithdrawn((current) => new Set(current).add(open.entry));
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </Box>
  );
}
