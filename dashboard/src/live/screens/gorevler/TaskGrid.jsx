// src/live/screens/gorevler/TaskGrid.jsx — the prototype's 24-hour grid (G3-02 D12): one patient row, then
// one row per task kind; hour columns from the shift start; a cell is a button in the state's colour.
//
// Drawn as the prototype's .tk (measured from it, 2026-11-14): the grid spans the page, a 230 px first
// column stays put while the hours scroll, the hours are equal columns, the day changes at a thicker line
// with the day's name over it, and «now» is a red line down the grid with its time on top. A cell is the
// prototype's .tc: 32 px, a clock on blue when it is due now, a dashed frame when it is planned, a green
// tick when done, a red «!» when late.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmm, hhmm, weekdayKey } from "../../i18n/dates.js";
import { Icon } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { HOUR_MS, hourIndex } from "./taskModel.js";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
//: a due time before the shift start sits in the first column, one after its end in the last
const column = (iso, shiftStartMs) => Math.min(23, Math.max(0, hourIndex(iso, shiftStartMs)));

const CELL = {
  due: "border-pri bg-pri-soft text-pri shadow-[0_0_0_3px_color-mix(in_srgb,var(--pri-soft)_77%,transparent)]",
  late: "border-[color:color-mix(in_srgb,var(--crit)_55%,transparent)] bg-crit-soft text-crit",
  plan: "border-dashed border-line2 text-mute",
  done: "border-transparent text-ok",
};
const CELL_ICON = { due: "clock", late: "alert", done: "ok" };

function Cell({ item, t, onOpen }) {
  const label = t(`gorevler.state${item.state[0].toUpperCase()}${item.state.slice(1)}`);
  const look = CELL[item.state] ?? CELL.plan;
  return (
    <button type="button" onClick={() => onOpen(item)} title={`${hhmm(Date.parse(item.at))} · ${label}`}
      aria-label={`${hhmm(Date.parse(item.at))} ${label}`}
      className={`inline-grid h-8 w-8 place-items-center rounded-[9px] border font-text text-11 font-bold ${look} ${FOCUS_RING}`}>
      {CELL_ICON[item.state] ? <Icon name={CELL_ICON[item.state]} size={15} /> : null}
    </button>
  );
}

const STICKY = "sticky left-0 z-[1] shadow-[1px_0_0_var(--line2)]";

export function TaskGrid({ patients, items, shiftStartMs, nowMs, onOpen }) {
  const { t } = useI18n();
  const nowCol = Math.min(23, Math.max(0, Math.floor((nowMs - shiftStartMs) / HOUR_MS)));
  const frac = Math.min(1, Math.max(0, (nowMs - shiftStartMs) / (24 * HOUR_MS)));
  const dayOf = (ms) => `${t(weekdayKey(ms))} ${ddmm(ms)}`;
  const firstDay = new Date(shiftStartMs).getDate();
  const isNewDay = (h) => h > 0 && new Date(shiftStartMs + h * HOUR_MS).getDate() !== new Date(shiftStartMs + (h - 1) * HOUR_MS).getDate();
  const lastMs = shiftStartMs + 23 * HOUR_MS;
  return (
    <div className="relative overflow-x-auto rounded-[14px] border border-line bg-card">
      <div className="relative min-w-[1100px]">
        {/* «now»: a red line down the hours, its time on top (the prototype's .tkNow). */}
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 top-0 z-[2] w-0.5 bg-crit"
          style={{ left: `calc(230px + (100% - 230px) * ${frac})` }}>
          <span className="absolute left-1 top-0.5 rounded bg-card px-[3px] font-data text-10 font-bold leading-[normal] text-crit">{hhmm(nowMs)}</span>
        </div>
        <table aria-label={t("gorevler.title")} className="w-full table-fixed border-collapse">
          <colgroup><col className="w-[230px]" />{HOURS.map((h) => <col key={h} />)}</colgroup>
          <thead>
            <tr className="h-10">
              <th scope="col" className={`${STICKY} bg-card2 px-2.5 text-left font-data text-10.5 font-bold text-mute`}>
                {t("gorevler.colPatientTask")}
                <small className="block font-text text-[9px] font-bold tracking-[.02em] text-pri">
                  {`${dayOf(shiftStartMs)}${new Date(lastMs).getDate() !== firstDay ? ` → ${dayOf(lastMs)}` : ""}`}
                </small>
              </th>
              {HOURS.map((h) => {
                const at = shiftStartMs + h * HOUR_MS;
                const newDay = h === 0 || isNewDay(h);
                return (
                  <th key={h} scope="col" aria-current={h === nowCol ? "time" : undefined}
                    className={`bg-card2 px-0 text-center font-data text-10.5 font-bold ${h === nowCol ? "text-crit" : "text-mute"} ${isNewDay(h) ? "border-l-2 border-line2" : "border-l border-line"}`}>
                    {newDay ? <small className="block font-text text-[9px] font-bold tracking-[.02em] text-pri">{dayOf(at)}</small> : null}
                    {String(new Date(at).getHours()).padStart(2, "0")}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => {
              // Every patient on the board has a row, items or none: the grid is the ward, not the backlog.
              const mine = items.filter((x) => x.patientId === p.patient_id);
              const late = mine.filter((x) => x.state === "late").length;
              const due = mine.filter((x) => x.state === "due").length;
              const rows = [["vital", "activity", t("gorevler.vitalRow"), mine.filter((x) => x.kind === "vital")]];
              const byTitle = new Map();
              for (const x of mine.filter((x) => x.kind === "hand")) byTitle.set(x.task.title, [...(byTitle.get(x.task.title) ?? []), x]);
              for (const [title, xs] of byTitle) rows.push([`t:${title}`, "clip", title, xs]);
              return (
                <React.Fragment key={p.patient_id}>
                  <tr aria-label={`${bedNameOf(p)} ${nameOf(p, t)}`} className="h-11 border-t border-line bg-card2">
                    <th scope="row" className={`${STICKY} bg-card2 px-2.5 text-left font-normal`}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <b className="shrink-0 font-data text-12.5 font-bold text-pri">{bedNameOf(p)}</b>
                        <span className={`truncate text-14.5 font-bold ${p.display_name ? "text-ink" : "italic text-mute"}`}>{nameOf(p, t)}</span>
                      </span>
                    </th>
                    <td colSpan={24} className="border-l border-line pl-2.5 text-12 text-mute">
                      <span className="inline-flex items-center gap-1.5">
                        {due ? <span className="rounded-lg border border-line2 px-2 py-[3px] text-11.5 font-semibold leading-[normal]">{t("gorevler.dueCount", { n: due })}</span> : null}
                        {late ? <span className="rounded-lg bg-crit-soft px-2 py-[3px] text-11.5 font-semibold leading-[normal] text-crit-ink">{t("gorevler.lateCount", { n: late })}</span> : null}
                        <span>{t("gorevler.itemCount", { n: mine.length })}</span>
                      </span>
                    </td>
                  </tr>
                  {rows.filter(([, , , xs]) => xs.length > 0).map(([key, icon, label, xs]) => {
                    // The row's label opens its live item — the vital that is due, the open task — not a past entry.
                    const live = xs.find((x) => x.state !== "done") ?? xs[xs.length - 1];
                    return (
                      <tr key={key} className="h-[42px] border-t border-line">
                        <th scope="row" className={`${STICKY} bg-card px-2.5 text-left`}>
                          <button type="button" onClick={() => onOpen(live)}
                            className={`flex min-w-0 max-w-full items-center rounded-ctl text-left text-12.5 font-semibold leading-[normal] text-ink ${FOCUS_RING}`}>
                            <Icon name={icon} size={14} className="mr-1.5 text-mute" />
                            <span className="truncate">{label}</span>
                          </button>
                        </th>
                        {HOURS.map((h) => {
                          const here = xs.filter((x) => column(x.at, shiftStartMs) === h);
                          return (
                            <td key={h} className={`px-0 text-center ${isNewDay(h) ? "border-l-2 border-line2" : "border-l border-line"}`}>
                              {here.map((x) => <Cell key={x.key} item={x} t={t} onOpen={onOpen} />)}
                            </td>
                          );
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

/** «Şimdiye git»: the current hour's column into view (jsdom has no scrollIntoView: then nothing). */
export function scrollToNow() {
  const th = document.querySelector('table [aria-current="time"]');
  if (th && typeof th.scrollIntoView === "function") th.scrollIntoView({ inline: "center", block: "nearest" });
}
