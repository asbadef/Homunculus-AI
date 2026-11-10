// src/live/screens/gorevler/TaskGrid.jsx — the prototype's 24-hour grid (G3-02 D12): one patient row, then
// one row per task kind; hour columns from the shift start; a cell is a button in the state's colour.
import React, { useRef } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { Button, StatusPill } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { HOUR_MS, TONE, hourIndex } from "./taskModel.js";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
//: a due time before the shift start sits in the first column, one after its end in the last
const column = (iso, shiftStartMs) => Math.min(23, Math.max(0, hourIndex(iso, shiftStartMs)));

function Cell({ item, t, onOpen }) {
  const label = t(`gorevler.state${item.state[0].toUpperCase()}${item.state.slice(1)}`);
  return (
    <button type="button" onClick={() => onOpen(item)} title={`${hhmm(Date.parse(item.at))} · ${label}`}
      aria-label={`${hhmm(Date.parse(item.at))} ${label}`} className={`inline-grid place-items-center rounded-ctl ${FOCUS_RING}`}>
      <StatusPill tone={TONE[item.state]}>{item.state === "late" ? "!" : item.state === "done" ? "✓" : "·"}</StatusPill>
    </button>
  );
}

export function TaskGrid({ patients, items, shiftStartMs, nowMs, onOpen }) {
  const { t } = useI18n();
  const nowCol = Math.min(23, Math.max(0, Math.floor((nowMs - shiftStartMs) / HOUR_MS)));
  const scroller = useRef(null);
  //: «Şimdiye git» — the current hour's column into view (jsdom has no scrollIntoView: then nothing)
  const goNow = () => {
    const th = scroller.current?.querySelector('[aria-current="time"]');
    if (th && typeof th.scrollIntoView === "function") th.scrollIntoView({ inline: "center", block: "nearest" });
  };
  return (
    <div className="rounded-box border border-line bg-card">
      <div className="flex justify-end border-b border-line px-3 py-2">
        <Button size="sm" icon="clock" onClick={goNow}>{t("gorevler.gotoNow")}</Button>
      </div>
      <div ref={scroller} className="overflow-x-auto">
      <table aria-label={t("gorevler.title")} className="min-w-[1100px] border-collapse text-13">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-card2 px-3 py-2 text-left">{t("gorevler.fieldPatient")}</th>
            {HOURS.map((h) => (
              <th key={h} scope="col" aria-current={h === nowCol ? "time" : undefined}
                className={`w-11 px-0 py-2 font-data text-11 ${h === nowCol ? "text-crit" : "text-mute"}`}>{hhmm(shiftStartMs + h * HOUR_MS)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => {
            // Every patient on the board has a row, items or none: the grid is the ward, not the backlog.
            const mine = items.filter((x) => x.patientId === p.patient_id);
            const late = mine.filter((x) => x.state === "late").length;
            const rows = [["vital", t("gorevler.vitalRow"), mine.filter((x) => x.kind === "vital")]];
            const byTitle = new Map();
            for (const x of mine.filter((x) => x.kind === "hand")) byTitle.set(x.task.title, [...(byTitle.get(x.task.title) ?? []), x]);
            for (const [title, xs] of byTitle) rows.push([`t:${title}`, title, xs]);
            return (
              <React.Fragment key={p.patient_id}>
                <tr aria-label={`${bedNameOf(p)} ${nameOf(p, t)}`} className="bg-card2">
                  <th scope="row" className="sticky left-0 bg-card2 px-3 py-2 text-left"><b className="font-data text-pri">{bedNameOf(p)}</b> <span className="text-ink">{nameOf(p, t)}</span></th>
                  <td colSpan={24} className="px-3 text-12 text-mute">{late ? t("gorevler.lateCount", { n: late }) : ""}</td>
                </tr>
                {rows.filter(([, , xs]) => xs.length > 0).map(([key, label, xs]) => {
                  // The row's label opens its live item — the vital that is due, the open task — not a past entry.
                  const live = xs.find((x) => x.state !== "done") ?? xs[xs.length - 1];
                  return (
                    <tr key={key}>
                      <th scope="row" className="sticky left-0 bg-card px-3 py-1 text-left font-text font-semibold text-ink">
                        <button type="button" onClick={() => onOpen(live)} className={`rounded-ctl text-left font-semibold text-ink ${FOCUS_RING}`}>{label}</button>
                      </th>
                      {HOURS.map((h) => {
                        const here = xs.filter((x) => column(x.at, shiftStartMs) === h);
                        return <td key={h} className="border-l border-line px-0 py-1 text-center">{here.map((x) => <Cell key={x.key} item={x} t={t} onOpen={onOpen} />)}</td>;
                      })}
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
