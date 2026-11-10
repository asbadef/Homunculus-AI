// src/live/screens/alarms/SnoozeDialog.jsx — «Ertele» (G2-B5b, spec 2026-11-10-g2b-b5b-ertele-design.md, D4): snooze
// one alarm for a bounded time, with a named reason. The alarm screen opens it from a row (AlarmsScreen.jsx), for a
// holder of `alerts.ack`, on an unanswered high or moderate alarm (`maySnooze`).
//
// THE OWNER'S RULES (D1), mirrored from the engine (POST /alerts/snooze) only so the dialog offers what the engine
// takes:
//   - the durations within the cap: high 5/10/15/30, moderate 15/30/60/120, the shortest chosen first;
//   - a reason from the fixed list;
//   - for «Diğer», an explanation of at least 15 characters.
// The engine still decides. The reason and the explanation are written for good into the append-only audit trail, so
// the hint asks for no names or identity numbers. The dialog says when the alarm sounds again: the board's clock plus
// the minutes chosen.
//
// A missing reason or a short explanation is said under its control, and the focus goes there (RrtCallDialog's
// rule). The server is not asked.
//
// THE ENGINE DECIDES, and the dialog says what it said ON THE TOAST, the alarm screen's rule (RrtCallDialog, and
// AlarmsScreen.acknowledge):
//   - nothing is written to the board before the server takes the snooze;
//   - a toast outlives the screen;
//   - it names the alarm: the bed and the kind, never a name.
// Either way the dialog closes. A snooze that got NO ANSWER (`mayHaveLanded`) is not a refusal: the engine may have
// recorded it. The toast says so, and that snoozing again is harmless, since a second snooze replaces the first.
import React, { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { OTHER, OTHER_MIN_CHARS, REASON_TEXT_MAX, SNOOZE_CHOICES, SNOOZE_REASONS } from "../../data/snooze.js";
import { apiErrorText } from "../../apiErrors.js";
import { hhmm } from "../../i18n/dates.js";
import { Announce, Button, Field, Input, Modal, Seg, Select, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { summaryOf, useBoardNow } from "../common/BoardState.jsx";

/** «Sounds again at»: the minute it names must be right while the dialog stays open. */
const TICK_MS = 1_000;

/** Each reason's words, by the engine's code. The keys are literal, so rawKeys.test.jsx checks every one exists. */
export const REASON_KEYS = Object.freeze({
  CLINICAL_DECISION_MADE: "ertele.reason.clinical",
  ARTEFACT_OR_SIGNAL_NOISE: "ertele.reason.artefact",
  PROCEDURE_IN_PROGRESS: "ertele.reason.procedure",
  PATIENT_BASELINE: "ertele.reason.baseline",
  OTHER: "ertele.reason.other",
});

/** A snooze's reason as a row says it: «Diğer»'s own explanation (the person's words), the list's words otherwise,
 *  and a code this build does not know as it came. */
export function snoozeReasonText(t, snooze) {
  if (!snooze) return "";
  if (snooze.reason === OTHER && snooze.reasonText) return snooze.reasonText;
  return Object.prototype.hasOwnProperty.call(REASON_KEYS, snooze.reason)
    ? t(REASON_KEYS[snooze.reason])
    : String(snooze.reason ?? "—");
}

/** The snooze's end that the engine's answer (a board entry, raw) carries for `kind`, in ms, or null. */
function untilOn(entry, kind) {
  const alert = Array.isArray(entry?.alerts) ? entry.alerts.find((a) => a?.kind === kind) : null;
  const ms = Date.parse(alert?.snooze?.until ?? "");
  return Number.isNaN(ms) ? null : ms;
}

/** `alarm` the board alarm to snooze; `open` false renders nothing. A new alarm, or a new opening, starts afresh. */
export function SnoozeDialog({ alarm, open, onClose }) {
  if (!open || !alarm) return null;
  return <SnoozeForm key={alarm.id} alarm={alarm} onClose={onClose} />;
}

function SnoozeForm({ alarm, onClose }) {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const choices = SNOOZE_CHOICES[alarm.severity] ?? [];
  const [minutes, setMinutes] = useState(choices[0] ?? null);
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);   // a problem shows once she has pressed «Ertele»
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const reasonBox = useRef(null);
  const textBox = useRef(null);
  const formId = useId();
  const whatId = useId();
  const bed = alarm.bedLabel || alarm.patientId;
  const subject = `${bed} · ${alarm.kind}`;
  const other = reason === OTHER;
  const noReason = !SNOOZE_REASONS.includes(reason);
  const shortText = other && text.trim().length < OTHER_MIN_CHARS;

  async function send() {
    if (sending.current || busy || minutes === null) return;
    if (noReason || shortText) {
      // Said under its control, and the focus taken there; the server is not asked. flushSync: the problem must be in
      // the DOM, tied to the control, when the focus arrives (VitalsForm).
      flushSync(() => setTried(true));
      (noReason ? reasonBox : textBox).current?.focus();
      return;
    }
    setTried(true);
    sending.current = true;
    setBusy(true);
    let said = null;                             // [text, tone] once the server has answered
    try {
      const entry = await board.store.snooze(alarm.patientId, alarm.kind, minutes, reason, other ? text.trim() : null);
      const until = untilOn(entry, alarm.kind);
      said = [t("ertele.done", { subject, time: until === null ? "—" : hhmm(until) })];
    } catch (err) {
      // A request the session's end cut off: nobody is there to read an answer.
      if (err?.superseded) said = null;
      else if (mayHaveLanded(err)) said = [t("ertele.mayHaveLanded", { subject }), "warn"];
      else said = [t("ertele.failed", { subject, reason: apiErrorText(t, err) }), "error"];
    } finally {
      sending.current = false;
      setBusy(false);
    }
    if (said) toast(...said);
    onClose();
  }

  return (
    <Modal
      open title={t("ertele.title", { bed })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} busy={busy}>{t("ertele.cancel")}</Button>
          <Button variant="primary" icon="clock" onClick={send} busy={busy}>{t("ertele.send")}</Button>
        </>
      )}
    >
      {/* Enter in the explanation box presses «Ertele»: the same checks. */}
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); send(); }}>
        {/* Which alarm, when a bed has more than one: the engine's own English summary, and its kind. */}
        <p id={whatId} className="m-0 mb-3 text-13 text-ink">
          <span lang="en">{summaryOf(alarm) ?? t("board.findingUnnamed")}</span>
          <span className="font-data text-mute">{` · ${alarm.kind}`}</span>
        </p>
        <div className="mb-2.5 grid gap-1.5">
          <Seg label={t("ertele.duration")} value={minutes} onChange={setMinutes}
            options={choices.map((m) => ({ value: m, label: t("ertele.minutes", { count: m }) }))} />
          {minutes !== null ? (
            <p className="m-0 text-12.5 text-mute">{t("ertele.soundsAgain", { time: hhmm(nowMs + minutes * 60_000) })}</p>
          ) : null}
        </div>
        <Field label={t("ertele.reasonLabel")} layout="col" required
          error={tried && noReason ? t("ertele.reasonMissing") : undefined}>
          <Select ref={reasonBox} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy}
            aria-describedby={whatId}>
            <option value="">{t("ertele.reasonPick")}</option>
            {SNOOZE_REASONS.map((code) => <option key={code} value={code}>{t(REASON_KEYS[code])}</option>)}
          </Select>
        </Field>
        {other ? (
          <Field label={t("ertele.text")} layout="col" required hint={t("ertele.textHint")}
            error={tried && shortText ? t("ertele.textShort") : undefined}>
            <Input ref={textBox} autoComplete="off" maxLength={REASON_TEXT_MAX} value={text}
              onChange={(event) => setText(event.target.value)} readOnly={busy} />
          </Field>
        ) : null}
        <p className="m-0 text-12 text-mute">{t("ertele.trail")}</p>
      </form>
      {/* A busy button reads only "unavailable"; the words come from here, as on the alarm screen. */}
      <Announce text={busy ? t("ertele.sending") : ""} />
    </Modal>
  );
}
