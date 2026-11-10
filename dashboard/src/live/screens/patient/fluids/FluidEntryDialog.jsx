// src/live/screens/patient/fluids/FluidEntryDialog.jsx — «Giriş/çıkış ekle» (G3-03 D10, D11): one or more fluid
// entries — a category of the eight (fluidCodes.js), a volume in mL, a time — charted through the board store's
// `chart` (POST /clinical/{id}; the store reloads the board after it), for a `clinical.chart` holder only.
//
// ONE REQUEST PER TIME. Rows that share a time go in ONE `/clinical` request, all or nothing (D10). Rows with
// different times go one request per distinct time, in the order the rows were written, and the first refusal
// stops the rest: the toast says how many rows were saved and how many were not, the saved rows leave the dialog
// (a second press must not chart them twice) and the refused ones stay for her to correct.
//
// THE TIME IS THE CLINICIAN'S (D3): at most 24 h back, never ahead — a minute of skew is not «ahead». A row's time
// starts as now and follows the clock until she edits it (the Meds form's rule, final review I2); the press reads
// the clock again, so a dialog opened at 14:00 and saved at 15:30 charts 15:30.
//
// THE SERVER IS AUTHORITATIVE. The dialog mirrors the door's bounds (0–5000 mL a row, the bolus 0–10000 mL) and
// the time window only to hold a slip back, under the field, with the focus taken to the first one; anything it
// lets through is the engine's to refuse, in the engine's words on the toast, named after the bed. A discharged
// admission answers with nothing charted (`dropped`), which is not a save and is not said as one. A write that got
// no answer may have landed (`mayHaveLanded`): she is told to look at the box in a moment, and the box reads again.
//
// The bolus row says it is the Meds box's bolus (D11): one code, one record, whichever form wrote it.
import React, { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Select, useToast } from "../../../ui/index.js";
import { mayHaveLanded } from "../../admin/refusal.js";
import { useNow } from "../../common/useNow.js";
import { BACKDATE_MS, toLocalInput } from "../meds/medsFields.js";
import { INTAKE, OUTPUT, checkRow, groupByTime, labelKey } from "./fluidCodes.js";

/** How often an untouched time is moved on to the clock: the field shows minutes. */
const CLOCK_MS = 60_000;
const FIRST_CODE = "urine_output_ml";

/** `bed` names the patient in the title and on the toasts; the write is `onChart(entries, recordedAt)`, already
 *  bound to that patient by the box, which resolves to the API's answer (null when the store dropped it: the
 *  session ended). `onSaved()` asks the box to read the ledger again; `onClose()` closes the dialog. */
export function FluidEntryDialog({ bed, onChart, onSaved, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const keys = useRef(0);
  const blank = () => {
    keys.current += 1;
    return { key: keys.current, code: FIRST_CODE, ml: "", at: "", touched: false };
  };
  const [rows, setRows] = useState(() => [blank()]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputs = useRef({});
  const sending = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Re-rendered on the clock while the dialog is open, so an untouched time moves on with it.
  useNow(CLOCK_MS);
  const now = Date.now();
  /** The rows as of the instant `at` (ms): an untouched time is that instant's, a typed one is hers. */
  const asOf = (list, at) => list.map((r) => (r.touched ? r : { ...r, at: toLocalInput(at) }));
  const shown = asOf(rows, now);
  const checked = shown.map((r) => checkRow(r, now));
  const errorOf = (i, field) => {
    const problem = tried ? checked[i]?.errors[field] : null;
    return problem ? t(problem.key, problem.params) : undefined;
  };
  const keep = (key, field) => (el) => { inputs.current[`${key}:${field}`] = el; };
  const edit = (key, field) => (event) => {
    const { value } = event.target;
    setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: value, ...(field === "at" ? { touched: true } : {}) } : r)));
  };
  const addRow = () => setRows((list) => [...list, blank()]);
  const removeRow = (key) => setRows((list) => (list.length > 1 ? list.filter((r) => r.key !== key) : list));

  async function save() {
    if (sending.current || busy) return;
    // Checked again at the press, not as of the last render: an untouched time is the moment of saving.
    const at = Date.now();
    const pressedRows = asOf(rows, at);
    const pressed = pressedRows.map((r) => checkRow(r, at));
    const firstBad = pressed.findIndex((c) => Object.keys(c.errors).length > 0);
    if (firstBad >= 0) {
      // The error is under its field, and the field is where she is taken (flushSync: it must be in the DOM, and
      // linked to the field, when the focus arrives).
      flushSync(() => setTried(true));
      const field = pressed[firstBad].errors.ml ? "ml" : "at";
      inputs.current[`${pressedRows[firstBad].key}:${field}`]?.focus();
      return;
    }
    setTried(true);
    const groups = groupByTime(pressed);
    sending.current = true;
    setBusy(true);
    let saved = [];      // the indexes of the rows the engine took
    let done;            // what is said and done once the writes are settled and Save is released
    try {
      for (const group of groups) {
        // eslint-disable-next-line no-await-in-loop
        const answer = await onChart(group.entries, group.atIso);
        if (answer === null) return;   // the store dropped it: the session ended
        if (answer?.dropped) {
          done = { say: [t("sivi.dropped", { subject: bed }), "warn"], reread: saved.length > 0, close: true };
          break;
        }
        saved = [...saved, ...group.rows];
      }
      if (!done) done = { say: [t("sivi.saved", { subject: bed, n: saved.length })], reread: true, close: true };
    } catch (err) {
      // A superseded session is gone: nothing is said about it into the one that replaced it.
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("sivi.mayHaveLanded", { subject: bed }), "warn"], reread: true, close: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("sivi.noRight") : apiErrorText(t, err);
        done = saved.length > 0
          ? { say: [t("sivi.partSaved", { subject: bed, saved: saved.length, left: pressed.length - saved.length, reason }), "error"],
              reread: true, close: forbidden, keep: saved }
          : { say: [t("sivi.refused", { subject: bed, reason }), "error"], reread: false, close: forbidden };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    // The saved rows leave the dialog; the refused ones stay, as she typed them.
    if (done.keep && mounted.current) {
      const savedKeys = new Set(done.keep.map((i) => pressedRows[i].key));
      setRows((list) => list.filter((r) => !savedKeys.has(r.key)));
    }
    // Out of the `try`: a callback that throws must never turn a write the engine took into «not saved».
    toast(...done.say);
    try {
      if (done.reread) onSaved();
    } finally {
      if (done.close) onClose();
    }
  }

  return (
    <Modal
      open wide title={t("sivi.addTitle", { bed })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" icon="plus" onClick={addRow} busy={busy}>{t("sivi.addRow")}</Button>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("sivi.cancel")}</Button>
            {/* Save is the form's submit from the footer (`form`), so Enter in a field presses it too. */}
            <Button type="submit" form={formId} variant="primary" busy={busy}>{t("sivi.save")}</Button>
          </div>
        </div>
      )}
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
        {shown.map((row, i) => (
          <fieldset key={row.key} className="m-0 mb-2.5 rounded-ctl border border-line p-2.5">
            <legend className="px-1 text-12 font-semibold text-mute">{t("sivi.row", { n: i + 1 })}</legend>
            <div className="grid gap-x-2.5 min-[861px]:grid-cols-[2fr_1fr_1.4fr]">
              <Field label={t("sivi.fieldCode")} layout="col">
                {/* A select cannot be read-only: it is disabled while the write is in flight, as the admin forms do. */}
                <Select value={row.code} onChange={edit(row.key, "code")} disabled={busy}>
                  <optgroup label={t("sivi.intake")}>
                    {INTAKE.map((code) => <option key={code} value={code}>{t(labelKey(code))}</option>)}
                  </optgroup>
                  <optgroup label={t("sivi.output")}>
                    {OUTPUT.map((code) => <option key={code} value={code}>{t(labelKey(code))}</option>)}
                  </optgroup>
                </Select>
              </Field>
              <Field label={t("sivi.fieldMl")} layout="col" error={errorOf(i, "ml")}>
                <Input ref={keep(row.key, "ml")} inputMode="decimal" autoComplete="off" value={row.ml}
                  onChange={edit(row.key, "ml")} readOnly={busy} />
              </Field>
              <Field label={t("sivi.fieldAt")} layout="col" error={errorOf(i, "at")}>
                <Input ref={keep(row.key, "at")} type="datetime-local" min={toLocalInput(now - BACKDATE_MS)} max={toLocalInput(now)}
                  value={row.at} onChange={edit(row.key, "at")} readOnly={busy} />
              </Field>
            </div>
            {shown.length > 1 ? (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => removeRow(row.key)} busy={busy}>{t("sivi.removeRow")}</Button>
            ) : null}
          </fieldset>
        ))}
      </form>
      <Announce text={busy ? t("sivi.saving") : ""} />
    </Modal>
  );
}
