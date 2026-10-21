// src/live/screens/patient/trends/BaselineForm.jsx — "the patient's normal" (spec §3.3): the patient's
// own range for the five vitals the engine keeps a baseline for, written through the engine's profile
// door (PUT /clinical/{id}/profile) by a `clinical.chart` holder.
//
// THE ENGINE REPLACES THE WHOLE SET WITH WHAT IS SENT (api/clinical.py `profile_from_payload`). So the
// form opens with what is charted and sends every filled pair; an emptied pair is a deleted baseline,
// and the form says so. Only `baselines` is sent: the comorbidities and the baseline SOFA are not in
// the body, so the engine keeps them (`backendApi.putPatientProfile`, not `setProfile`).
//
// THE FORM IS A SNAPSHOT of the set it was opened on, and it knows it: the trends poll hands it a
// fresh `own` every minute, and when that no longer matches what the rows were read from (another
// desk charted or cleared a range meanwhile) it says so and holds Save until the form is opened
// again — last write wins is the engine's, and a clinician must not make it silently. The box that
// opens it keys it by patient (TrendsBox), so rows read from one patient are never written to another.
//
// Held here before sending, in the reader's words: one side without the other, a bound that is not a
// plain decimal (a shape the engine would refuse, or one this form will not guess at: 1e3, +5, .5 and
// 5. are held back, and so is a number too large to be finite), low above high. Nothing else is judged
// — what a range means is the engine's, and anything this form lets through is the engine's to refuse.
//
// WHAT SAVE IS ABOUT TO DO is said beside it, in the footer that stays on screen (a sentence at the
// bottom of a scrolling body is below the fold on a laptop): the sentence is Save's description, the
// one live region says the consequential ones once, and a Save that would delete every range is the
// danger button. A held submit moves focus to the first row that is wrong; its field says why.
//
// A refusal goes on the toast, named after the bed, and never also inline (amendments (a), (f)); a
// write that got no answer may have landed (`mayHaveLanded`, the one rule): the trends are read again
// and the clinician is told to look at the band. `busy` holds Save (never `disabled`, amendment (c))
// and the fields go read-only while the write is in flight; a second press while one is in flight is
// ignored even before the screen has re-rendered (`sending`).
import React, { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { useSession } from "../../../session/SessionProvider.jsx";
import { apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { VITALS } from "../../common/vitals.js";
import { mayHaveLanded } from "../../admin/refusal.js";

/** The vitals the engine keeps a baseline for, in the bed card's order. A mirror of api/clinical.py
 *  BASELINE_SIGNALS — BaselineForm.test.jsx reads that file and holds the two equal. MAP and lactate
 *  have none, so they are not offered (spec D4). */
export const BASELINE_KEYS = Object.freeze(["heart_rate", "resp_rate", "spo2", "sbp", "temperature"]);
const META = Object.fromEntries(VITALS.map((v) => [v.at, v]));

/** A range the engine charted: BOTH bounds are numbers. The one idea of "charted" in this form — what the
 *  rows open with, what the snapshot compares and whether there is anything to clear all read it — so a
 *  range of nulls and a range that is not there are the same thing. */
const charted = (range) => Number.isFinite(range?.low) && Number.isFinite(range?.high);
const prefill = (range, side) => (charted(range) ? String(range[side]) : "");
/** A typed bound: "" when empty, its number (a decimal comma read as a point), NaN when it is not a
 *  plain finite decimal. A run of nines that overflows to Infinity travels as null and would come back
 *  as the engine's refusal, so it is not a number here. */
function bound(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** What the rows would send, and each row's problem as `{ side, key }`. */
export function checkBaselines(rows) {
  const errors = {};
  const baselines = {};
  for (const key of BASELINE_KEYS) {
    const low = bound(rows[key]?.low);
    const high = bound(rows[key]?.high);
    if (low === "" && high === "") continue;
    if (low === "" || high === "") errors[key] = { side: low === "" ? "low" : "high", key: "patient.baselineBothOrNeither" };
    else if (Number.isNaN(low) || Number.isNaN(high)) errors[key] = { side: Number.isNaN(low) ? "low" : "high", key: "patient.baselineNotNumber" };
    else if (low > high) errors[key] = { side: "low", key: "patient.baselineLowAboveHigh" };
    else baselines[key] = { low, high };
  }
  return { errors, baselines };
}

/** A set of ranges as one string: two sets are the same ranges when their strings are equal. */
export const keyOf = (set) => BASELINE_KEYS.map((key) => (charted(set?.[key]) ? `${set[key].low}~${set[key].high}` : "-")).join("|");

export function BaselineForm({ patient, bed, own, onClose, onSaved }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState(() => Object.fromEntries(
    BASELINE_KEYS.map((key) => [key, { low: prefill(own?.[key], "low"), high: prefill(own?.[key], "high") }])));
  const [openedWith] = useState(() => keyOf(own));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputs = useRef({});
  const sending = useRef(false);
  const mounted = useRef(false);
  const noteId = useId();
  const formId = useId();
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const { errors, baselines } = checkBaselines(rows);
  const empty = Object.keys(baselines).length === 0 && Object.keys(errors).length === 0;
  // Every row empty over a set that IS charted is a clear: the engine reads `{baselines: {}}` over a
  // charted profile as "delete every range" (api/clinical.py). Over nothing there is nothing to clear.
  const clearing = empty && BASELINE_KEYS.some((key) => charted(own?.[key]));
  const nothing = empty && !clearing;
  const changed = keyOf(own) !== openedWith;
  const held = changed || nothing;
  const say = changed ? t("patient.baselineChangedMeanwhile")
    : clearing ? t("patient.baselineClearsAll", { save: t("common.save") })
      : nothing ? t("patient.baselineNothingToSend") : "";
  const errorOf = (key, side) => (tried && errors[key]?.side === side ? t(errors[key].key) : undefined);
  const edit = (key, side) => (event) => {
    const { value } = event.target;
    setRows((current) => ({ ...current, [key]: { ...current[key], [side]: value } }));
  };

  async function save() {
    if (sending.current || busy) return;
    const first = BASELINE_KEYS.find((key) => errors[key]);
    if (first && !changed) {
      // The error is under its field, and the field is where she is taken (flushSync: it must be in
      // the DOM, and linked to the field, when the focus arrives).
      flushSync(() => setTried(true));
      inputs.current[`${first}.${errors[first].side}`]?.focus();
      return;
    }
    setTried(true);
    if (held) return;
    sending.current = true;
    const epoch = store.epoch();
    setBusy(true);
    let done;   // what is said and done once the write is settled and Save is released
    try {
      await store.track(() => store.api.putPatientProfile(patient.patient_id, { baselines }));
      if (epoch !== store.epoch()) return;
      const text = clearing ? t("patient.baselineClearedAll", { subject: bed }) : t("patient.baselineSaved", { subject: bed });
      done = { say: [text], reread: true, close: true };
    } catch (err) {
      if (err?.superseded || epoch !== store.epoch()) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("patient.baselineMayHaveLanded", { subject: bed }), "warn"], reread: true, close: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("patient.baselineNoRight") : apiErrorText(t, err);
        done = { say: [t("patient.baselineRefused", { subject: bed, reason }), "error"], reread: false, close: forbidden };
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
      open title={`${t("patient.baselineTitle")} · ${bed}`} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {say ? (
            <div id={noteId} className="mr-auto min-w-0 flex-[1_1_14rem]">
              {changed ? <Note tone="warn" icon="alert">{say}</Note> : (
                <p className={`m-0 text-12 font-semibold ${clearing || tried ? "text-att-ink" : "text-mute"}`}>{say}</p>
              )}
            </div>
          ) : null}
          {/* The two buttons are one flex item: on a phone the pair wraps as a pair, under the sentence. */}
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            {/* Save is the form's submit although it sits in the footer, outside it: `form` ties it to the
                fields, so a browser's Enter in any of them presses it (a form's default button is its first
                submit among everything associated with it), and a click submits the same way. A busy Save
                cancels the click (Button), and `sending` holds a second press that beats the re-render. */}
            <Button
              type="submit" form={formId} variant={clearing ? "danger" : "primary"} busy={busy}
              aria-disabled={held ? "true" : undefined} aria-describedby={say ? noteId : undefined}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
        <Note tone="info" icon="user">{t("patient.baselineNotDeviceAlarm")}</Note>
        {BASELINE_KEYS.map((key) => {
          const name = t(META[key].labelKey);
          // Each field's own name says whose range it is ("Nəbz alt"): ten fields called "alt" and
          // "üst" are indistinguishable in a screen reader's list of fields and to voice control.
          const label = (side) => <><span className="sr-only">{name} </span>{t(side === "low" ? "patient.baselineLow" : "patient.baselineHigh")}</>;
          const field = (side) => (
            <Field label={label(side)} layout="col" error={errorOf(key, side)}>
              <Input
                ref={(el) => { inputs.current[`${key}.${side}`] = el; }}
                inputMode="decimal" autoComplete="off" value={rows[key][side]} onChange={edit(key, side)} readOnly={busy}
              />
            </Field>
          );
          return (
            <fieldset key={key} data-baseline={key} className="m-0 mt-3 min-w-0 border-0 p-0">
              <legend className="mb-1 p-0 text-12.5 font-semibold">
                {name} <span className="font-normal text-mute">({t(META[key].unitKey)})</span>
              </legend>
              <div className="grid grid-cols-2 gap-x-2">
                {field("low")}
                {field("high")}
              </div>
            </fieldset>
          );
        })}
        <p className="m-0 mt-2 text-12 text-mute">{t("patient.baselineClearsNote")}</p>
      </form>
      {/* Said once, in this order of weight. "Nothing to send" only once a submit has been tried (Save pressed,
          or Enter in a field): a screen reader hears nothing from an Enter that did nothing otherwise. `tried`
          stays true once set, so after any earlier submit, a form left with nothing to send says so at once. */}
      <Announce text={busy ? t("patient.baselineSaving") : changed || clearing || (nothing && tried) ? say : ""} />
    </Modal>
  );
}
