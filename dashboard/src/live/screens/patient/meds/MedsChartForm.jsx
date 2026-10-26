// src/live/screens/patient/meds/MedsChartForm.jsx — the septic-shock inputs a `clinical.chart` holder
// charts from the patient screen's Meds box (G2-A3): a vasopressor / inotrope rate, a crystalloid bolus,
// the weight and "antibiotic given", at a time she gives, through the board store's `chart` (POST
// /clinical/{id} with `entries` and `recorded_at`; the store reloads the board after it).
//
// A RATE IS THE INFUSION'S CURRENT RATE AT THE RECORD TIME (D2): a change of rate is a new entry, and
// 0 is an entry — the drug stopped — never the same as an empty field, which sends nothing. A bolus is
// one bolus per entry: the engine sums the three-hour window itself, so this form adds nothing up.
// "Antibiotic given" sends 1 and only ever 1: an unticked box is not a record that none was given.
//
// THE TIME IS THE CLINICIAN'S (D3): up to 24 h back, never ahead — a minute of skew between this
// browser's clock and the server's is not "ahead". It travels as a UTC instant, which carries a zone
// (the door refuses a stamp without one).
//
// THE FORM IS A MODAL (D4, X1) whose title names the bed, so a form that outlives a glance still says
// whose record this is. Nothing is prefilled, so there is no snapshot here to go stale (BaselineForm's).
//
// THE SERVER IS AUTHORITATIVE (D1, D6). The browser computes no clinical value: it mirrors the door's
// plausibility bounds and holds back only what the engine would refuse — a rate without a drug, a drug
// without a rate, a number that is not a plain decimal, a slipped decimal outside the bounds, a time
// outside the window — in the reader's words under the field, with the focus taken to the first one.
// Anything it lets through is the engine's to refuse, and the engine's own sentence is what she reads:
// on the toast, named after the bed, never also inline. A discharged admission answers 200 with nothing
// charted (`dropped`), which is not a save and is not said as one. A write that got no answer may have
// landed (`mayHaveLanded`, the one rule): the box is told to look again, and so is she. `busy` holds
// Save (never `disabled`); `sending` ignores a second press that beats the re-render.
import React, { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, Select, useToast } from "../../../ui/index.js";
import { mayHaveLanded } from "../../admin/refusal.js";
import { BACKDATE_MS, PRESSORS, checkDraft, toLocalInput } from "./medsFields.js";

/** The fields in the order the form lists them: a held submit takes the focus to the first one wrong. */
const ORDER = ["weight", "pressor", "rate", "bolus", "antibiotic", "at"];

/** `patient` is what the box opened it on; the write itself is `onChart(entries, recordedAt)`, already
 *  bound to that patient by the box, which resolves to the API's answer. */
export function MedsChartForm({ bed, onChart, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState(() => ({ pressor: "", rate: "", bolus: "", weight: "", antibiotic: false, at: toLocalInput(Date.now()) }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputs = useRef({});
  const sending = useRef(false);
  const mounted = useRef(false);
  const noteId = useId();
  const formId = useId();
  const antibioticHintId = useId();
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const now = Date.now();
  const { errors, entries, empty, recordedAt } = checkDraft(draft, now);
  // Said beside Save once a submit has been tried on a form with nothing in it (Save, or Enter).
  const say = tried && empty ? t("patient.medsEmpty") : "";
  const errorOf = (field) => (tried && errors[field] ? t(errors[field].key, errors[field].params) : undefined);
  const edit = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const keep = (field) => (el) => { inputs.current[field] = el; };
  const withUnit = (labelKey, unitKey) => <>{t(labelKey)} <span className="font-normal">({t(unitKey)})</span></>;

  async function save() {
    if (sending.current || busy) return;
    const first = ORDER.find((field) => errors[field]);
    if (first) {
      // The error is under its field, and the field is where she is taken (flushSync: it must be in
      // the DOM, and linked to the field, when the focus arrives).
      flushSync(() => setTried(true));
      inputs.current[first]?.focus();
      return;
    }
    setTried(true);
    if (empty) return;
    sending.current = true;
    setBusy(true);
    let done;   // what is said and done once the write is settled and Save is released
    try {
      const answer = await onChart(entries, recordedAt);
      done = answer?.dropped
        ? { say: [t("patient.medsDropped", { subject: bed }), "warn"], reread: false, close: true }
        : { say: [t("patient.medsSaved", { subject: bed })], reread: true, close: true };
    } catch (err) {
      // A superseded session is gone: nothing is said about it into the one that replaced it.
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("patient.medsMayHaveLanded", { subject: bed }), "warn"], reread: true, close: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("patient.medsNoRight") : apiErrorText(t, err);
        done = { say: [t("patient.medsRefused", { subject: bed, reason }), "error"], reread: false, close: forbidden };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    // Out of the `try`: a callback that throws must never turn a write the engine took into "not saved".
    toast(...done.say);
    try {
      if (done.reread) onSaved();
    } finally {
      if (done.close) onClose();
    }
  }

  return (
    <Modal
      open title={`${t("patient.medsChartTitle")} · ${bed}`} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {say ? (
            <div id={noteId} className="mr-auto min-w-0 flex-[1_1_14rem]">
              <p className="m-0 text-12 font-semibold text-att-ink">{say}</p>
            </div>
          ) : null}
          {/* The two buttons are one flex item: on a phone the pair wraps as a pair, under the sentence. */}
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            {/* Save is the form's submit from the footer (`form`), so Enter in a field presses it too. */}
            <Button
              type="submit" form={formId} variant="primary" busy={busy}
              aria-disabled={empty ? "true" : undefined} aria-describedby={say ? noteId : undefined}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
        <Note tone="info" icon="syringe">{t("patient.medsChartIntro")}</Note>
        <div className="mt-3">
          <Field label={withUnit("patient.medsWeight", "patient.medsWeightUnit")} hint={t("patient.medsWeightHint")} layout="col" error={errorOf("weight")}>
            <Input ref={keep("weight")} inputMode="decimal" autoComplete="off" value={draft.weight} onChange={edit("weight")} readOnly={busy} />
          </Field>
          <Field label={t("patient.medsPressor")} layout="col" error={errorOf("pressor")}>
            {/* A select cannot be read-only: it is disabled while the write is in flight, as the admin forms do. */}
            <Select ref={keep("pressor")} value={draft.pressor} onChange={edit("pressor")} disabled={busy}>
              <option value="">{t("patient.medsPressorNone")}</option>
              {PRESSORS.map((p) => <option key={p.key} value={p.key}>{t(p.labelKey)}</option>)}
            </Select>
          </Field>
          <Field label={withUnit("patient.medsRate", "patient.medsRateUnit")} hint={t("patient.medsRateHint")} layout="col" error={errorOf("rate")}>
            <Input ref={keep("rate")} inputMode="decimal" autoComplete="off" value={draft.rate} onChange={edit("rate")} readOnly={busy} />
          </Field>
          <Field label={withUnit("patient.medsBolus", "patient.medsBolusUnit")} hint={t("patient.medsBolusHint")} layout="col" error={errorOf("bolus")}>
            <Input ref={keep("bolus")} inputMode="decimal" autoComplete="off" value={draft.bolus} onChange={edit("bolus")} readOnly={busy} />
          </Field>
          <div className="mb-2.5">
            <label className="flex items-center gap-2 font-text text-13.5 font-semibold text-mute">
              <input
                ref={keep("antibiotic")} type="checkbox" checked={draft.antibiotic} onChange={edit("antibiotic")}
                disabled={busy} aria-describedby={antibioticHintId}
              />
              {t("patient.medsAntibiotic")}
            </label>
            <p id={antibioticHintId} className="m-0 mt-1.5 text-12 text-mute">{t("patient.medsAntibioticHint")}</p>
          </div>
          <Field label={t("patient.medsAt")} hint={t("patient.medsAtHint")} layout="col" error={errorOf("at")}>
            <Input
              ref={keep("at")} type="datetime-local" min={toLocalInput(now - BACKDATE_MS)} max={toLocalInput(now)}
              value={draft.at} onChange={edit("at")} readOnly={busy}
            />
          </Field>
        </div>
      </form>
      {/* Said once: "saving" while the write is in flight, and the reason nothing was sent once a submit has
          been tried on an empty form (a screen reader hears nothing from an Enter that did nothing otherwise). */}
      <Announce text={busy ? t("patient.medsSaving") : say} />
    </Modal>
  );
}
