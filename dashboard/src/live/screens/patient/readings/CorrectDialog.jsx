// src/live/screens/patient/readings/CorrectDialog.jsx — «Düzelt» (G3-05, D3, D13, Q3): a wrong value corrected,
// whoever produced it — the device or a hand. Two screens open it: the «Ölçüm kaydı» box and the trend table.
//
// WHAT IT DOES, in this order, and only after the clinician gave a reason:
//   1. withdraws the wrong value — the engine's «hatalı giriş» (`onRetract(reason)`): the value leaves every score
//      and alert, and stays in the record and on the chart struck through, with the reason, who and when;
//   2. when a right value was typed, charts it BY HAND at the reading's own time (`onChart(entries, recordedAt)`),
//      so the record shows it as «elle» — never as the device's.
// The right value is optional (an empty box only withdraws) and is held to the bedside form's own check
// (`checkVital`: a slipped digit, not a clinical bound). The engine takes a hand entry at most 24 hours back, so for
// an older reading the box is not offered and the dialog says why — the withdrawal still works. Whether the box is
// offered is decided ONCE, when the dialog opens (the screen's clock ticks every 30 s and must not take a box away
// while she types); the bound is checked again, on a fresh clock, when she confirms: a value typed for a reading
// that has become too old since is held back with the reason and kept in the box — never silently dropped.
//
// THE ENGINE DECIDES, and each ending is said on a toast named after the bed:
//   both done → «düzeltildi»; only the withdrawal asked → «hatalı giriş olarak işaretlendi»;
//   withdrawn but the right value REFUSED (an answer) → the PARTIAL message, which says which half happened and
//     where and AT WHAT TIME to enter the value (never a plain failure: the wrong value IS out of the scores);
//   withdrawn but the chart got NO ANSWER (a timeout, a dropped line, a 502) → UNCERTAIN: the value may have been
//     written, so she is told to look at the record before she enters it again — never «not written»;
//   the withdrawal refused → nothing is charted; «already withdrawn» closes and the host re-reads; a reason the
//     engine finds short keeps the dialog open; a withdrawal with no answer may have landed — she is told to look.
// `onDone(outcome)`: "corrected" | "retracted" | "partial" | "already" | "uncertain". The button ignores a press for
// RETRACT_ARM_MS after the dialog opens and a double click's second press (RetractDialog's rule).
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { apiErrorKey, apiErrorText } from "../../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../../ui/index.js";
import { mayHaveLanded } from "../../admin/refusal.js";
import { BACKDATE_MS, SKEW_MS, checkVital, specOf } from "../../bedside/vitalsFields.js";
import {
  RETRACT_ALREADY, RETRACT_ARM_MS, RETRACT_MAX_REASON_CHARS, RETRACT_MIN_REASON_CHARS,
} from "../../common/RetractDialog.jsx";

/** The engine takes a hand entry at most a day back (api/clinical.py BEDSIDE_BACKDATE); the skew's minute is kept
 *  inside the edge, as the bedside form keeps it — the browser is the stricter side. */
export const CORRECT_BACKDATE_MS = BACKDATE_MS - SKEW_MS;

const withinBackdate = (nowMs, observedMs) => Number.isFinite(observedMs) && nowMs - observedMs <= CORRECT_BACKDATE_MS;

const saidAlready = (err) => err?.status === 409 && String(err.message ?? "").trim() === RETRACT_ALREADY;

/** A 403 that is the retract route's «a person does this» refusal (api/clinical.py RETRACT_NEEDS_PERSON: a device
 *  credential cannot withdraw a value) says so in its own words; any other 403 is a missing right. */
const saidPersonOnly = (err) => apiErrorKey(err)?.key === "errors.retractNeedsPerson";

/** `bed` names the patient in the title and on the toasts. `what` is `{ code, label, value, time, source,
 *  observedMs }`: the engine's code, and the label, the value with its unit, the measurement time and the source as
 *  the clinician reads them; `observedMs` is the reading's own instant. `nowMs` is the screen's clock.
 *  `onRetract(reason)` and `onChart(entries, recordedAtIso)` are the two writes, bound to the patient and the
 *  entry by the host; each resolves to the API's answer, or null when the store dropped it. */
export function CorrectDialog({ bed, what, nowMs = Date.now(), onRetract, onChart, onDone, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [raw, setRaw] = useState("");
  const [valueError, setValueError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [arming, setArming] = useState(true);
  const armed = useRef(false);
  const sending = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const countId = useId();
  const whatId = useId();
  const introId = useId();
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      armed.current = true;
      if (mounted.current) setArming(false);
    }, RETRACT_ARM_MS);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  const spec = specOf(what.code);
  // A value of a kind the bedside form types as a number can be re-entered here; a choice (oxygen, ACVPU) is
  // corrected on the bedside form itself, where its options are.
  const typable = Boolean(spec) && spec.kind === "number";
  // Decided once, as the dialog opens (the host mounts a new dialog for each value). `opened` lets confirm() read a
  // fresh clock: the screen's own, or that one advanced by the time this dialog has been open — whichever is later.
  const [offerValue] = useState(() => typable && withinBackdate(nowMs, what.observedMs));
  const [opened] = useState(() => ({ wall: Date.now(), screen: nowMs }));
  const count = reason.trim().length;
  const short = count < RETRACT_MIN_REASON_CHARS;

  async function confirm(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current || short || sending.current || busy) return;
    let entries = null;
    if (offerValue) {
      const checked = checkVital(spec, raw);
      if (checked.error) {
        setValueError(t(checked.error.key, checked.error.params));
        return;
      }
      if (!checked.skip) entries = [{ code: what.code, value: checked.value }];
    }
    // The bound again, on a fresh clock: the reading may have aged out while she typed. Nothing is sent, and the
    // typed value stays in its box beside the reason. A withdrawal takes a value out of every score, so it is never
    // sent on the strength of a press that was meant to replace it: the note says to empty the box and confirm
    // again, and only then the wrong value alone is withdrawn.
    if (entries !== null && !withinBackdate(Math.max(nowMs, opened.screen + (Date.now() - opened.wall)), what.observedMs)) {
      setValueError(t("kayit.correctNowTooOld"));
      return;
    }
    setValueError(null);
    sending.current = true;
    setBusy(true);
    let done;   // { say: [text, tone], outcome: string | null, close }
    try {
      const withdrawn = await onRetract(reason.trim());
      if (withdrawn === null) return;                // the store dropped it: the session ended
      if (entries === null) {
        done = { say: [t("kayit.correctWithdrawn", { subject: bed, label: what.label })], outcome: "retracted", close: true };
      } else {
        try {
          const charted = await onChart(entries, new Date(what.observedMs).toISOString());
          if (charted === null) return;
          done = { say: [t("kayit.correctDone", { subject: bed, label: what.label })], outcome: "corrected", close: true };
        } catch (err) {
          if (err?.superseded) return;
          // The wrong value IS withdrawn: say which half happened, never a plain failure. A chart with no answer may
          // have landed — only an answer (a refusal) means «not written»; entering it again unseen could double it.
          done = mayHaveLanded(err)
            ? { say: [t("kayit.correctChartMayHaveLanded", { subject: bed, time: what.time }), "warn"], outcome: "uncertain", close: true }
            : { say: [t("kayit.correctPartial", { subject: bed, reason: apiErrorText(t, err), time: what.time }), "warn"], outcome: "partial", close: true };
        }
      }
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("kayit.correctMayHaveLanded", { subject: bed }), "warn"], outcome: "uncertain", close: true };
      } else {
        const said = err?.status === 403 && !saidPersonOnly(err) ? t("kayit.noRight") : apiErrorText(t, err);
        done = {
          say: [t("kayit.correctRefused", { subject: bed, reason: said }), "error"],
          outcome: saidAlready(err) ? "already" : null,
          close: err?.status !== 400,
        };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    // Out of the `try`: a host callback that throws must never turn a correction the engine took into "not done".
    toast(...done.say);
    try {
      if (done.outcome) onDone(done.outcome);
    } finally {
      if (done.close) onClose();
    }
  }

  return (
    <Modal
      open title={t("kayit.correctTitle", { bed })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p id={countId} className="m-0 mr-auto text-12 font-semibold text-mute">
            {t("kayit.correctCount", { count, min: RETRACT_MIN_REASON_CHARS })}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            {/* The button is the form's submit button (`form`), so Enter in either box presses it — the browser
                clicks it for the form. onClick takes the press itself and cancels the native submit, so one press
                is one confirm(). */}
            <Button variant="danger" type="submit" form={formId} busy={busy}
              onClick={(event) => { event.preventDefault(); confirm(event); }}
              aria-disabled={short || arming ? "true" : undefined} aria-describedby={countId}>
              {t("kayit.correctConfirm")}
            </Button>
          </div>
        </div>
      )}
    >
      {/* A submit that reaches the form without the button (requestSubmit, a test): the same checks, no `detail`. */}
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); confirm(); }}>
        <p id={whatId} className="m-0 font-data text-14.5 font-semibold">
          {t("kayit.correctWhat", { label: what.label, value: what.value, time: what.time, source: what.source })}
        </p>
        <Note tone="warn" icon="alert" className="mt-2"><span id={introId}>{t("kayit.correctIntro")}</span></Note>
        <div className="mt-3">
          <Field label={t("kayit.correctReason")} layout="col" required>
            <Input autoFocus autoComplete="off" maxLength={RETRACT_MAX_REASON_CHARS} value={reason}
              onChange={(event) => setReason(event.target.value)} readOnly={busy}
              aria-describedby={`${whatId} ${introId}`} />
          </Field>
          {offerValue ? (
            <Field label={t("kayit.correctValue", { label: `${what.label} (${t(spec.unitKey)})` })} layout="col"
              hint={t("kayit.correctValueHint")} error={valueError}>
              <Input inputMode="decimal" autoComplete="off" value={raw} readOnly={busy}
                onChange={(event) => { setRaw(event.target.value); setValueError(null); }} />
            </Field>
          ) : null}
          {typable && !offerValue ? <p className="m-0 text-12.5 text-mute">{t("kayit.correctTooOld")}</p> : null}
        </div>
      </form>
      <Announce text={busy ? t("kayit.saving") : ""} />
    </Modal>
  );
}
