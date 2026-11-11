// src/live/screens/gorevler/TaskDialogs.jsx — the three dialogs of Görevlerim (G3-02 D13): a hand task (claim ·
// finish · not done), the vital task (G3-01's entry button + skip this interval), a new task. Every write goes
// through `write` (session store → read again); a refusal becomes a toast in the catalog's words.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { apiErrorText } from "../../apiErrors.js";
import { Button, Field, Input, Modal, Select, StatusPill, useToast } from "../../ui/index.js";
import { nameOf } from "../common/BoardState.jsx";
import { bedNameOf } from "../beds/order.js";
import { VitalsEntry } from "../patient/VitalsEntry.jsx";
import { fromLocalInput, toLocalInput } from "../patient/meds/medsFields.js";
import { BAND_KEY, TONE } from "./taskModel.js";

const REASON_MAX = 200;
const CONTROL = "w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none focus:border-pri";

function stateLabel(t, state) { return t(`gorevler.state${state[0].toUpperCase()}${state.slice(1)}`); }

function ReasonForm({ label, confirm, onConfirm, onCancel, busy }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 1 && reason.length <= REASON_MAX;
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(reason.trim()); }} className="grid gap-2">
      <Field label={label} hint={t("gorevler.skipReasonHint")} required layout="col">
        <textarea value={reason} maxLength={REASON_MAX} rows={2} className={CONTROL} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex gap-2"><Button type="submit" variant="danger" busy={busy}>{confirm}</Button><Button onClick={onCancel}>{t("gorevler.cancel")}</Button></div>
    </form>
  );
}

export function TaskDialog({ item, patient, nowMs, canManage, write, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const task = item.task;
  const bed = patient ? bedNameOf(patient) : item.patientId;
  const run = async (call, okKey) => {
    setBusy(true);
    try { await write(call); toast(t(okKey)); if (okKey !== "gorevler.claimed") onClose(); }
    catch (err) { toast(t("gorevler.refused", { subject: task.title, reason: apiErrorText(t, err) }), "error"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={t("gorevler.taskTitle", { title: task.title, bed })} onClose={onClose} busy={busy}>
      <div className="grid gap-2 text-13">
        <p className="m-0"><StatusPill tone={TONE[item.state]}>{stateLabel(t, item.state)}</StatusPill> <span className="font-data">{dayStamp(Date.parse(task.due_at), nowMs)}</span> · {patient ? nameOf(patient, t) : ""}</p>
        <p className="m-0 text-mute">{t("gorevler.createdBy", { who: task.created_by, time: dayStamp(Date.parse(task.created_at), nowMs) })}{task.claimed_by ? ` · ${t("gorevler.claimedBy", { who: task.claimed_by })}` : ""}</p>
        {task.state !== "open" && task.closed_by ? <p className="m-0 text-mute">{t("gorevler.closedBy", { who: task.closed_by, time: dayStamp(Date.parse(task.closed_at), nowMs) })}</p> : null}
        {canManage && task.state === "open" && !skipping ? (
          <div className="flex flex-wrap gap-2">
            {!task.claimed_by ? <Button busy={busy} onClick={() => run((api) => api.claimTask(task.id), "gorevler.claimed")}>{t("gorevler.claim")}</Button> : null}
            <Button variant="primary" busy={busy} onClick={() => run((api) => api.doneTask(task.id), "gorevler.finished")}>{t("gorevler.finish")}</Button>
            <Button variant="ghost" onClick={() => setSkipping(true)}>{t("gorevler.skip")}</Button>
          </div>
        ) : null}
        {skipping ? <ReasonForm label={t("gorevler.skipReason")} confirm={t("gorevler.skipConfirm")} busy={busy} onCancel={() => setSkipping(false)}
          onConfirm={(reason) => run((api) => api.skipTask(task.id, reason), "gorevler.skipped")} /> : null}
      </div>
    </Modal>
  );
}

export function VitalDialog({ item, patient, nowMs, canManage, canChart = false, write, refresh, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const v = item.vital;
  const bed = patient ? bedNameOf(patient) : item.patientId;
  const canSkip = canManage && (item.state === "due" || item.state === "late");
  const skip = async (reason) => {
    setBusy(true);
    try {
      const got = await write((api) => api.skipVitalTask(item.patientId, reason));
      toast(t("gorevler.vitalSkipped", { time: dayStamp(Date.parse(got.skipped_until), nowMs) }));
      onClose();
    } catch (err) { toast(t("gorevler.refused", { subject: t("gorevler.vitalRow"), reason: apiErrorText(t, err) }), "error"); }
    finally { setBusy(false); }
  };
  return (
    <Modal open title={t("gorevler.vitalTitle", { bed })} onClose={onClose} busy={busy}>
      <div className="grid gap-2 text-13">
        <p className="m-0"><StatusPill tone={TONE[item.state]}>{stateLabel(t, item.state)}</StatusPill>{v.due_at ? <> · {t("gorevler.vitalDue", { time: dayStamp(Date.parse(v.due_at), nowMs) })}</> : null}{v.partial ? <> · {t("gorevler.vitalPartial")}</> : null}</p>
        {/* the anchor is the server's (the last hand set, or the admission when there is none): one neutral word */}
        <p className="m-0 text-mute">{t("gorevler.vitalBand", { band: BAND_KEY[v.band] ? t(BAND_KEY[v.band]) : String(v.band ?? "—"), minutes: v.interval_min })}{v.anchor_at ? ` · ${t("gorevler.vitalAnchor", { time: dayStamp(Date.parse(v.anchor_at), nowMs) })}` : ""}</p>
        {patient && canManage && canChart ? <VitalsEntry patientId={patient.patient_id} bed={bed} nowMs={nowMs} onWritten={() => refresh()} /> : null}
        {canSkip && !skipping ? <div><Button variant="ghost" onClick={() => setSkipping(true)}>{t("gorevler.skipVitalConfirm")}</Button></div> : null}
        {skipping ? <ReasonForm label={t("gorevler.skipReason")} confirm={t("gorevler.skipVitalConfirm")} busy={busy} onCancel={() => setSkipping(false)} onConfirm={skip} /> : null}
      </div>
    </Modal>
  );
}

export function NewTaskDialog({ patients, nowMs, write, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const nextHour = Math.ceil(nowMs / 3_600_000) * 3_600_000;
  // No patient preselected: a task for the wrong bed is worse than one more choice (review round 1).
  const [form, setForm] = useState({ patientId: "", title: "", due: toLocalInput(nextHour), role: "nurse" });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const badTitle = form.title.trim().length < 1 || form.title.length > 200;
  const dueMs = fromLocalInput(form.due);
  const badDue = !Number.isFinite(dueMs) || dueMs < nowMs - 24 * 3_600_000 || dueMs > nowMs + 7 * 24 * 3_600_000;
  async function save(e) {
    e.preventDefault();
    if (badTitle || badDue || !form.patientId) { setTried(true); return; }
    setBusy(true);
    try {
      await write((api) => api.createTask({ patient_id: form.patientId, title: form.title.trim(), due_at: new Date(dueMs).toISOString(), target_role: form.role }));
      toast(t("gorevler.created"));
      onClose();
    } catch (err) { toast(t("gorevler.refused", { subject: t("gorevler.newTitle"), reason: apiErrorText(t, err) }), "error"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title={t("gorevler.newTitle")} onClose={onClose} busy={busy}>
      <form noValidate autoComplete="off" onSubmit={save} className="grid gap-2">
        <Field label={t("gorevler.fieldPatient")} required error={tried && !form.patientId ? t("gorevler.err.patient") : undefined}>
          <Select value={form.patientId} onChange={(e) => set({ patientId: e.target.value })}>
            <option value="">—</option>
            {patients.map((p) => <option key={p.patient_id} value={p.patient_id}>{`${bedNameOf(p)} · ${nameOf(p, t)}`}</option>)}
          </Select>
        </Field>
        <Field label={t("gorevler.fieldText")} hint={t("gorevler.fieldTextHint")} required error={tried && badTitle ? t("gorevler.err.titleLength") : undefined}>
          <Input value={form.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label={t("gorevler.fieldDue")} hint={t("gorevler.fieldDueHint")} required error={tried && badDue ? t("gorevler.err.dueWindow") : undefined}>
          <Input type="datetime-local" value={form.due} onChange={(e) => set({ due: e.target.value })} />
        </Field>
        <Field label={t("gorevler.fieldRole")}>
          <Select value={form.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="nurse">{t("gorevler.roleNurse")}</option>
            <option value="physician">{t("gorevler.rolePhysician")}</option>
            <option value="any">{t("gorevler.roleAny")}</option>
          </Select>
        </Field>
        <div className="flex gap-2"><Button type="submit" variant="primary" busy={busy}>{t("gorevler.save")}</Button><Button onClick={onClose}>{t("gorevler.cancel")}</Button></div>
      </form>
    </Modal>
  );
}
