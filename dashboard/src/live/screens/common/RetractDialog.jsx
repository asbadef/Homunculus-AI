// src/live/screens/common/RetractDialog.jsx — «hatalı giriş» (G3-01, D10, D11): withdraw one hand-entered value,
// with a reason. Two screens open it — the bedside saved step (bedside/SavedStep.jsx) and the trend dialog's
// table (patient/trends/TrendModal.jsx) — so it lives here, with the other shared pieces (X15).
//
// WHAT IT SAYS before anything is sent: which value (its name, the number as entered, when it was measured) and
// what the withdrawal does — the value leaves every score and alert, the chart keeps it struck through with the
// reason, the act is written to the audit trail. The reason is the clinician's: at least
// RETRACT_MIN_REASON_CHARS characters once trimmed — the server's rule (api/clinical.py), mirrored only so the
// button can say why it waits. The button ignores a press for RETRACT_ARM_MS after the dialog opens (the second
// press of the double click that opened it must not withdraw — A4's and ESLEME's rule), and always ignores a
// double click's second press.
//
// THE ENGINE DECIDES (D11), and its refusal is said on the toast, named after the bed, in its own words. «Already
// withdrawn» (another desk got there first — by its sentence, RETRACT_ALREADY; the engine's other 409, «discharged»,
// is NOT it) closes the dialog and the host marks the row; «no such hand entry» and «discharged» close it with no
// outcome, since nothing was written; a reason the engine finds short keeps it open. A 403 closes it. A withdrawal with no
// answer may have landed (`mayHaveLanded`): she is told to look at the chart, the host reads again, the dialog
// closes. A store that dropped its answer (null: the session ended) says nothing. `onDone(outcome)` tells the
// host how it ended: "retracted" | "already" | "uncertain".
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Note, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";

/** The reason's least length once trimmed — api/clinical.py RETRACT_MIN_REASON_CHARS. */
export const RETRACT_MIN_REASON_CHARS = 10;
/** How long the confirm button ignores a press after the dialog opened. */
export const RETRACT_ARM_MS = 600;
/** The engine's RETRACT_ALREADY (api/clinical.py): the ONE 409 that means another desk withdrew the value first. The
 *  engine's other 409, RETRACT_DISCHARGED («taburcu edilmiş bir hastada değer geri alınamaz»), wrote nothing — the
 *  value still scores — so it is not «already» and must not strike a row (D11). */
export const RETRACT_ALREADY = "bu değer zaten hatalı giriş olarak işaretlenmiş";

/** Did the engine say that another desk withdrew it first? By its sentence, which the error keeps whatever
 *  `errors.retractAlready` text apiErrors.js shows for it (G3-01, Task 11, X17). */
const saidAlready = (err) => err?.status === 409 && String(err.message ?? "").trim() === RETRACT_ALREADY;

/** `bed` names the patient in the title and on the toast; `what` is `{ label, value, time }` as the clinician
 *  reads them (the value with its unit, the time with its day when it is not today's). `onRetract(reason)` is
 *  the write, bound to the patient and the entry by the host; it resolves to the API's answer, or null when the
 *  store dropped it. */
export function RetractDialog({ bed, what, onRetract, onDone, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [arming, setArming] = useState(true);
  const armed = useRef(false);                 // false inside the arming window, read by the press itself
  const sending = useRef(false);
  const mounted = useRef(false);
  const formId = useId();
  const countId = useId();
  const whatId = useId();
  const introId = useId();
  // The arming window starts when the dialog does. True inside the effect (the house pattern), so StrictMode's
  // rehearsal does not leave it false; the rehearsal's timer is cleared with it.
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
  const count = reason.trim().length;
  const short = count < RETRACT_MIN_REASON_CHARS;

  async function confirm(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current || short || sending.current || busy) return;
    sending.current = true;
    setBusy(true);
    let done;   // { say: [text, tone], outcome: string | null, close } once the write is settled
    try {
      const answer = await onRetract(reason.trim());
      if (answer === null) return;   // the store dropped it: the session ended
      done = { say: [t("olcum.retractDone", { subject: bed, label: what.label })], outcome: "retracted", close: true };
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("olcum.retractMayHaveLanded", { subject: bed }), "warn"], outcome: "uncertain", close: true };
      } else {
        const forbidden = err?.status === 403;
        const said = forbidden ? t("olcum.noRight") : apiErrorText(t, err);
        done = {
          say: [t("olcum.retractRefused", { subject: bed, reason: said }), "error"],
          outcome: saidAlready(err) ? "already" : null,
          close: err?.status !== 400,
        };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
    // Out of the `try`: a host callback that throws must never turn a withdrawal the engine took into "not marked".
    toast(...done.say);
    try {
      if (done.outcome) onDone(done.outcome);
    } finally {
      if (done.close) onClose();
    }
  }

  return (
    <Modal
      open title={t("olcum.retractTitle", { bed })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p id={countId} className="m-0 mr-auto text-12 font-semibold text-mute">
            {t("olcum.retractCount", { count, min: RETRACT_MIN_REASON_CHARS })}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirm} busy={busy}
              aria-disabled={short || arming ? "true" : undefined} aria-describedby={countId}>
              {t("olcum.retractConfirm")}
            </Button>
          </div>
        </div>
      )}
    >
      {/* Enter in the reason box presses the button: the same checks, and no `detail`. */}
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); confirm(); }}>
        <p id={whatId} className="m-0 font-data text-14.5 font-semibold">{t("olcum.retractWhat", what)}</p>
        <Note tone="warn" icon="alert" className="mt-2"><span id={introId}>{t("olcum.retractIntro")}</span></Note>
        <div className="mt-3">
          {/* Focus lands in this box, so a screen reader never meets the value line or the intro above it: the box
              carries them as its description (Field keeps this and adds its own). */}
          <Field label={t("olcum.retractReason")} layout="col" required>
            <Input autoFocus autoComplete="off" value={reason} onChange={(event) => setReason(event.target.value)} readOnly={busy}
              aria-describedby={`${whatId} ${introId}`} />
          </Field>
        </div>
      </form>
      <Announce text={busy ? t("olcum.saving") : ""} />
    </Modal>
  );
}
