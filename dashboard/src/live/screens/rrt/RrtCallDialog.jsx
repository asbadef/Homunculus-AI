// src/live/screens/rrt/RrtCallDialog.jsx — «RRT çağır» (G2-B5, spec D8): call the rapid-response team to one
// alarm, with a reason. The alarm screen opens it from a row (AlarmsScreen.jsx), for a holder of `alerts.escalate`.
//
// THE REASON IS REQUIRED, 3–500 characters once trimmed — the engine's rule (POST /alerts/rrt-call), mirrored
// here only so the dialog can say what is wrong before anything is sent. The box stops at the ceiling; the engine
// still refuses a reason outside it. The reason is written for good into the append-only audit trail and shown on
// the RRT screen, so the hint asks for no names or identity numbers. A required reason is also why this dialog
// needs no arming window (RetractDialog's): an empty box cannot send, so a double click's second press sends
// nothing.
//
// THE ENGINE DECIDES, and the dialog says what it said ON THE TOAST, the alarm screen's rule for its acknowledgement
// and for the same reasons (AlarmsScreen.acknowledge): nothing is written to the board before the server takes the
// call, so a refusal leaves nothing to roll back; a toast outlives the screen, so a nurse who moved on still learns
// that the team was NOT called; and it names the alarm — the bed and the kind, the words the row uses, never a
// name. Either way the dialog closes: the answer is on the toast, and the row shows the call or still offers it.
import React, { useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, useToast } from "../../ui/index.js";
import { summaryOf } from "../common/BoardState.jsx";

/** The reason's least length once trimmed — the engine's rule (POST /alerts/rrt-call). */
export const RRT_MIN_REASON_CHARS = 3;
/** Its greatest length — the same rule's ceiling. */
export const RRT_MAX_REASON_CHARS = 500;

/** `alarm` the board alarm the call is for (its patient, kind and bed); `open` false renders nothing. A new
 *  alarm, or a new opening, starts with an empty reason. */
export function RrtCallDialog({ alarm, open, onClose }) {
  if (!open || !alarm) return null;
  return <CallForm key={alarm.id} alarm={alarm} onClose={onClose} />;
}

function CallForm({ alarm, onClose }) {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);   // the short-reason error shows once she has pressed «Çağır»
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const formId = useId();
  const whatId = useId();
  const bed = alarm.bedLabel || alarm.patientId;
  const subject = `${bed} · ${alarm.kind}`;
  const short = reason.trim().length < RRT_MIN_REASON_CHARS;

  async function send() {
    if (sending.current || busy) return;
    setTried(true);
    if (short) return;                          // said under the box; the server is not asked
    sending.current = true;
    setBusy(true);
    let said = null;                            // [text, tone] once the server has answered
    try {
      await board.store.callRrt(alarm.patientId, alarm.kind, reason.trim());
      said = [t("rrt.callDone", { subject })];
    } catch (err) {
      // A request the session's end cut off: nobody is there to read an answer.
      if (!err?.superseded) said = [t("rrt.callFailed", { subject, reason: apiErrorText(t, err) }), "error"];
    } finally {
      sending.current = false;
      setBusy(false);
    }
    if (said) toast(...said);
    onClose();
  }

  return (
    <Modal
      open title={t("rrt.callTitle", { bed })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} busy={busy}>{t("rrt.callCancel")}</Button>
          <Button variant="primary" icon="zap" onClick={send} busy={busy}>{t("rrt.callSend")}</Button>
        </>
      )}
    >
      {/* Enter in the reason box presses «Çağır»: the same checks. */}
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); send(); }}>
        {/* Which alarm, when a bed has more than one: the engine's own English summary, and its kind. */}
        <p id={whatId} className="m-0 mb-3 text-13 text-ink">
          <span lang="en">{summaryOf(alarm) ?? t("board.findingUnnamed")}</span>
          <span className="font-data text-mute">{` · ${alarm.kind}`}</span>
        </p>
        <Field
          label={t("rrt.callReason")} layout="col" required hint={t("rrt.callHint")}
          error={tried && short ? t("rrt.callReasonShort") : undefined}
        >
          <Input autoFocus autoComplete="off" maxLength={RRT_MAX_REASON_CHARS} value={reason}
            onChange={(event) => setReason(event.target.value)} readOnly={busy} aria-describedby={whatId} />
        </Field>
      </form>
      {/* A busy button reads only "unavailable"; the words come from here, as on the alarm screen. */}
      <Announce text={busy ? t("alarms.seeing") : ""} />
    </Modal>
  );
}
