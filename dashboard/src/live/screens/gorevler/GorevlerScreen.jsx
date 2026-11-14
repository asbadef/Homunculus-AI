// src/live/screens/gorevler/GorevlerScreen.jsx — Görevlerim (G3-02): the ward's task queue for this shift.
// Two sources: tasks written by hand, and the vital measurement the server derives from the patient's last
// measurement of a NEWS2 input — typed by hand or, since G3-05 (D15), sent by a device — and the hospital's
// interval for the band. The grid (wide) and the list (narrow) read
// the same items; nothing here scores or decides — the server says the state, the screen paints it.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmm, hhmm } from "../../i18n/dates.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Button, Icon, Note, Seg } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { BoardStrip, ScopeNote, useBoardNow } from "../common/BoardState.jsx";
import { orderBeds } from "../beds/order.js";
import { counters, items, keep, myRole } from "./taskModel.js";
import { useTasks } from "./useTasks.js";
import { TaskGrid, scrollToNow } from "./TaskGrid.jsx";
import { TaskList } from "./TaskList.jsx";
import { NewTaskDialog, TaskDialog, VitalDialog } from "./TaskDialogs.jsx";

const NARROW_PX = 900;

// The prototype's four counters (.att.tkAtt): an icon in a tinted square, the number 24 px. Late is
// red while there is one; «now» wears the brand's tint; done the green tick.
const COUNTERS = [
  ["late", "alert", "counterLateTile"], ["due", "clock", "counterDueTile"], ["plan", "list", "counterPlan"], ["done", "ok", "counterDone"],
];
const LOOK = {
  late: (n) => (n ? ["border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)] bg-crit-soft", "bg-[color:color-mix(in_srgb,var(--crit)_18%,transparent)] text-crit"] : ["border-line bg-card", "bg-card2 text-ok"]),
  due: (n) => (n ? ["border-[color:color-mix(in_srgb,var(--pri)_40%,transparent)] bg-pri-soft", "bg-pri-soft text-pri"] : ["border-line bg-card", "bg-card2 text-mute"]),
  plan: () => ["border-line bg-card", "bg-card2 text-mute"],
  done: () => ["border-line bg-card", "bg-card2 text-ok"],
};

export function GorevlerScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { user, store } = useSession();
  const nowMs = useBoardNow(30_000);
  const { data, error, refresh, write } = useTasks(store);
  const canManage = user?.perms?.includes("tasks.manage") ?? false;
  const canChart = user?.perms?.includes("clinical.chart") ?? false;
  const role = myRole(user?.groups);
  const [mode, setMode] = useState(() => (typeof window !== "undefined" && window.innerWidth < NARROW_PX ? "list" : "grid"));
  const [filters, setFilters] = useState({ kind: "all", onlyLate: false, onlyMine: false });
  const [dialog, setDialog] = useState(null);     // { kind: "hand"|"vital"|"new", patientId?, item? }

  const patients = useMemo(() => orderBeds(board.patients), [board.patients]);
  const byId = useMemo(() => new Map((data?.patients ?? []).map((p) => [p.patient_id, p])), [data]);
  const grace = data?.settings?.grace_min ?? 30;
  const all = useMemo(() => patients.flatMap((p) => (byId.get(p.patient_id) ? items(byId.get(p.patient_id), nowMs, grace) : [])), [patients, byId, nowMs, grace]);
  const shown = useMemo(() => all.filter((x) => keep(x, filters, role)), [all, filters, role]);
  const count = counters(all);
  const shiftStartMs = data ? Date.parse(data.shift.start) : nowMs;
  const shiftEndMs = data ? Date.parse(data.shift.end) : nowMs;

  // The open dialog shows the item as the LAST read has it (keys are stable: `v:<pid>:now`, `t:<id>`), so a claim or a
  // skip is seen in the dialog itself; the item it opened with is the fallback while the patient is off the board.
  const liveItem = dialog?.item ? (all.find((x) => x.key === dialog.item.key) ?? dialog.item) : null;
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const openItem = (item) => setDialog(item.kind === "vital" ? { kind: "vital", patientId: item.patientId, item } : { kind: "hand", patientId: item.patientId, item });

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The prototype's .ph: «Name · bu nöbet 14.11 08:00 → 15.11 08:00 · 22 hasta», the tools at the right. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("gorevler.title")}</h1>
          <p className="m-0 mt-1 text-13 text-mute">
            {user?.fullName ? `${user.fullName} · ` : ""}{t("gorevler.thisShift")}{" "}
            {data ? <b className="font-data font-bold">{`${ddmm(shiftStartMs)} ${hhmm(shiftStartMs)} → ${ddmm(shiftEndMs)} ${hhmm(shiftEndMs)}`}</b> : "—"}
            {` · ${t("gorevler.patientCount", { count: patients.length })}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon="print" onClick={() => window.print()}>{t("gorevler.print")}</Button>
          <Seg label={t("gorevler.modeLabel")} value={mode} onChange={setMode}
            options={[{ value: "grid", label: t("gorevler.modeGrid") }, { value: "list", label: t("gorevler.modeList") }]} />
          {canManage ? <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: "new" })}>{t("gorevler.newTask")}</Button> : null}
        </div>
      </div>
      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {error ? <Alert tone="crit"><p className="m-0">{t("gorevler.readFailed", { reason: readErrorText(t, error) })}</p></Alert> : null}
      {!canManage ? <Note tone="info" icon="lock">{t("gorevler.readOnly")}</Note> : null}
      <div className="grid grid-cols-2 gap-3 min-[861px]:grid-cols-4">
        {COUNTERS.map(([k, icon, label]) => {
          const [box, ico] = LOOK[k](count[k]);
          const body = (
            <>
              <span className={`row-span-2 grid h-10 w-10 place-items-center rounded-[10px] ${ico}`}><Icon name={icon} size={20} /></span>
              <b data-testid={`counter-${k}`} className="font-display text-[calc(24px*var(--fs))] font-bold leading-none text-ink">{count[k]}</b>
              <span className="min-w-0 text-12.5 text-mute">{t(`gorevler.${label}`)}</span>
            </>
          );
          const cls = `grid min-w-0 grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-[3px] rounded-[14px] border px-[13px] py-3 text-left ${box}`;
          // «Geciken · yalnız bunları göster»: the late counter is the late filter, as in the prototype.
          return k === "late" ? (
            <button key={k} type="button" aria-pressed={filters.onlyLate} onClick={() => set({ onlyLate: !filters.onlyLate })}
              className={`${cls} transition-transform duration-150 hover:-translate-y-px ${FOCUS_RING}`}>{body}</button>
          ) : <div key={k} className={cls}>{body}</div>;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Seg label={t("gorevler.kindLabel")} value={filters.kind} onChange={(kind) => set({ kind })}
          options={[{ value: "all", label: t("gorevler.kindAll") }, { value: "vital", label: t("gorevler.kindVital") }, { value: "hand", label: t("gorevler.kindHand") }]} />
        <label className="flex items-center gap-2.5 text-13 font-semibold"><input type="checkbox" className="h-[22px] w-[22px] accent-[var(--pri)]" checked={filters.onlyLate} onChange={(e) => set({ onlyLate: e.target.checked })} />{t("gorevler.onlyLate")}</label>
        {role ? <label className="flex items-center gap-2 text-13"><input type="checkbox" checked={filters.onlyMine} onChange={(e) => set({ onlyMine: e.target.checked })} />{t("gorevler.onlyMine")}</label> : null}
        {mode === "grid" ? <Button variant="ghost" size="sm" icon="clock" onClick={scrollToNow}>{t("gorevler.gotoNow")}</Button> : null}
      </div>
      {patients.length === 0 ? <Note tone="info" icon="bed">{t("gorevler.noPatients")}</Note>
        : mode === "grid"
          ? <TaskGrid patients={patients} items={shown} shiftStartMs={shiftStartMs} nowMs={nowMs} onOpen={openItem} />
          : <TaskList patients={patients} items={shown} nowMs={nowMs} onOpen={openItem} />}
      <p className="m-0 text-11.5 text-mute">{t("gorevler.intro")}</p>
      {dialog?.kind === "new" ? <NewTaskDialog patients={patients} nowMs={nowMs} write={write} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "hand" ? <TaskDialog item={liveItem} patient={patients.find((p) => p.patient_id === dialog.patientId)} nowMs={nowMs} canManage={canManage} write={write} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "vital" ? <VitalDialog item={liveItem} patient={patients.find((p) => p.patient_id === dialog.patientId)} nowMs={nowMs} canManage={canManage} canChart={canChart} write={write} refresh={refresh} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
