// src/live/screens/gorevler/TaskList.jsx — the narrow-screen list (G3-02 D12): open items late first, done hidden.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { Note, StatusPill } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { TONE, sortItems } from "./taskModel.js";

export function TaskList({ patients, items, nowMs, onOpen }) {
  const { t } = useI18n();
  const byId = new Map(patients.map((p) => [p.patient_id, p]));
  const shown = sortItems(items.filter((x) => x.state !== "done"));
  return (
    <div className="grid gap-2">
      {shown.length === 0 ? <Note tone="info" icon="list">{t("gorevler.empty")}</Note> : (
        <ul role="list" aria-label={t("gorevler.title")} className="m-0 grid list-none gap-2 p-0">
          {shown.map((x) => {
            const p = byId.get(x.patientId);
            const label = t(`gorevler.state${x.state[0].toUpperCase()}${x.state.slice(1)}`);
            return (
              <li key={x.key}>
                <button type="button" onClick={() => onOpen(x)} className={`grid w-full grid-cols-[56px_1fr_auto] items-center gap-3 rounded-box border border-line bg-card px-3 py-2 text-left ${FOCUS_RING}`}>
                  <span className="font-data text-13 font-bold">{x.at ? dayStamp(Date.parse(x.at), nowMs) : "—"}</span>
                  <span><b className="block text-ink">{x.kind === "vital" ? t("gorevler.vitalRow") : x.task.title}</b>
                    <small className="block text-12 text-mute">{p ? `${bedNameOf(p)} · ${nameOf(p, t)}` : x.patientId}{x.task?.claimed_by ? ` · ${t("gorevler.claimedBy", { who: x.task.claimed_by })}` : ""}</small></span>
                  <StatusPill tone={TONE[x.state]}>{label}</StatusPill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 text-12 text-mute">{t("gorevler.listHidesDone")}</p>
    </div>
  );
}
