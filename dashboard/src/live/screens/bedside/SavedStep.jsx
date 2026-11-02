// src/live/screens/bedside/SavedStep.jsx — «Kaydedildi» (G3-01, D3, D13): what was just saved and when it was
// measured, and a «Hatalı giriş» for each value. A slipped value is most likely to be seen right after it was
// typed. A withdrawn row stays, struck through and said as such, as the chart keeps it. A row's id is the
// door's answer (`entries`, VitalsForm `savedOf`); a row with none (an older engine) offers no button. The
// host's actions are the children: the page's «Sıradaki hasta» and «Hasta ekranı», the dialog's «Kapat».
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Box, Button } from "../../ui/index.js";
import { RetractDialog } from "../common/RetractDialog.jsx";
import { specOf, valueText } from "./vitalsFields.js";

/** `saved` is `{ atMs, rows: [{ code, value, entry }] }`; `onRetract(entry, reason)` is the withdrawal, bound to
 *  the patient by the host; `nowMs` says which day «today» is for the time. */
export function SavedStep({ bed, saved, nowMs, onRetract, children }) {
  const { t } = useI18n();
  const [withdrawn, setWithdrawn] = useState(() => new Set());
  const [open, setOpen] = useState(null);   // the row whose «Hatalı giriş» is open
  const time = dayStamp(saved.atMs, nowMs);
  const labelOf = (code) => {
    const spec = specOf(code);
    return spec ? t(spec.labelKey) : code;
  };
  return (
    <Box title={t("olcum.saved", { time })} icon="ok" level={2}>
      <h3 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("olcum.savedList")}</h3>
      {/* role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver. */}
      <ul role="list" className="m-0 mt-1 list-none p-0">
        {saved.rows.map((row) => {
          const struck = row.entry !== null && withdrawn.has(row.entry);
          const value = valueText(t, row.code, row.value);
          return (
            <li key={row.code} data-row={row.code} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
              <span className="min-w-0 flex-1 text-14.5">
                <span className="font-semibold text-mute">{labelOf(row.code)}</span>{" "}
                {struck ? <s className="font-data">{value}</s> : <b className="font-data">{value}</b>}
                {struck ? <span className="ml-2 text-12 font-semibold text-att-ink">{t("olcum.retractedShort")}</span> : null}
              </span>
              {row.entry !== null && !struck ? (
                <Button size="sm" variant="ghost" icon="x" onClick={() => setOpen(row)}>{t("olcum.retract")}</Button>
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
          // «Already» is withdrawn too; an uncertain one keeps its button — a second try is answered «already».
          onDone={(outcome) => {
            if (outcome !== "uncertain") setWithdrawn((current) => new Set(current).add(open.entry));
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </Box>
  );
}
