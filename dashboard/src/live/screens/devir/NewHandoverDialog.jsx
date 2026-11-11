// src/live/screens/devir/NewHandoverDialog.jsx — «Yeni devir» (G2-B3b, spec D9), and the note step of an OPEN
// handover's signature. One patient per handover (owner D1); the outgoing person chooses the receiver (owner D2).
//
// TWO WAYS IN. Opened from «Yeni devir» (`handover` null): the patient comes from GET /admissions — my units, the
// states a patient is handed over in (HANDOVER_STATES, the engine's own) — and the receiver from the colleagues list;
// «Devret ve imzala» opens the handover and then signs it. Opened from an OPEN row's «İmzala» (`handover` that row):
// the patient and the receiver are the row's, and only the signature is sent.
//
// THE NOTE is D-Ö-D-Ö — Durum · Öykü · Değerlendirme · Öneri — four boxes, at least one of them holding three
// characters once trimmed, none over 2000 (devir.js `noteValid`, the engine's rule, D5). It is kept with the handover,
// so the hint asks for no names, no identity numbers and no working diagnosis. A note with nothing in it is said under
// its first box and the focus goes there (VitalsForm's rule, RrtCallDialog's: Field puts the problem first in the
// box's description, so it is the first thing read there).
//
// THE LIVE CRITICAL CHECK. The engine refuses the outgoing signature while the live board shows the patient a
// critical alarm nobody acknowledged, firing or latched (D3). The dialog reads the same board (`useBoard`, devir.js
// `openCriticalOnBoard`) and says so before anything is sent — «İmzalanamaz…», with a way to the alarm — and sends
// nothing while it holds. The server stays the judge: a board that has not loaded holds nothing here, and a 409
// `critical_alarm_open` the server answers anyway is said in THIS screen's words, never `apiErrorText`'s (whose
// sentence is the discharge's). When that 409 comes after the handover was opened, the handover stays OPEN: the
// dialog stays open and says so — in its Note, and on the toast, since a Note does not announce itself — its button
// now signs the handover already opened (a second press opens no second one), and the lists behind it are read again,
// so the OPEN one is there to sign later. A board that is not LIVE rules no alarm out, and the dialog says the check
// is the server's then.
//
// WHAT A PRESS IS FOR IS FIXED WHEN IT IS MADE. The selects are frozen while a request is out, and once the handover
// is opened the dialog signs THAT one — its patient's lock, its bed on every toast (`target`) — whatever the selects
// say. A patient with an OPEN handover of mine still inside its bridge (`mineOpen`) is not handed over again: the
// dialog says so and sends nothing; that one is signed from its row.
//
// EVERY OTHER ANSWER IS ON THE TOAST, naming the bed (RrtCallDialog's rule and its reasons: the toast outlives the
// screen; the subject is the bed and the unit, never the name). A write that got NO ANSWER (a timeout, a 502/504, a
// dropped line — `mayHaveLanded`) is not a refusal: it may have gone through, and the toast says so. After anything
// was written, or may have been, the lists are read again before the dialog lets go (`onWritten`, held — A-17), and
// it closes. Two refusals keep it open, with everything as it was: a refused OPENING wrote nothing, so the nurse can
// choose again — from a patient list read again, as the refusal's words say; and a refused NOTE (a 422 on the
// signature) is hers to fix — the handover is OPEN, and the next press signs it.
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText, readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Button, Field, KV, KVList, Modal, Note, Select, Textarea, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { boardKnown } from "../common/BoardState.jsx";
import { mayHaveLanded } from "../admin/refusal.js";
import { boardKeyOf } from "../kabul/boardKey.js";
import {
  NOTE_PARTS, PART_MAX, emptyNote, noteBody, noteValid, openCriticalOnBoard, patientOf, subjectOf,
} from "./devir.js";

/** The admission states a patient is handed over in — the engine's HANDOVER_STATES (D4): open and signed off. */
export const HANDOVER_STATES = Object.freeze(["ACTIVE", "PENDING_DISCHARGE", "PENDING_TRANSFER"]);

/** The engine's code for a signature held by an unacknowledged critical alarm (admission/errors.py, D3). */
export const CRITICAL_ALARM_OPEN = "critical_alarm_open";

/** An admission row's bed, as a handover row names it (devir.js `subjectOf`): the bed and the unit. */
const bedOf = (row) => [row?.bed_label, row?.unit_name].filter((part) => typeof part === "string" && part).join(" · ")
  || boardKeyOf(row) || "—";

const isPerson = (c) => c !== null && typeof c === "object" && c.id != null && typeof c.name === "string";

/** The four parts of a stored note, as text for the boxes; anything else is left blank. */
function partsOf(note) {
  const out = emptyNote();
  for (const part of NOTE_PARTS) if (typeof note?.[part] === "string") out[part] = note[part];
  return out;
}

/** The patients and the people the dialog offers, read when it opens (`enabled`), with a retry. */
function usePicks(enabled) {
  const { store } = useSession();
  const [state, setState] = useState({ phase: enabled ? "loading" : "none", admissions: [], colleagues: [], error: null });
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const load = useCallback(async () => {
    if (!enabled) return;
    setState((prev) => ({ ...prev, phase: "loading", error: null }));
    try {
      const [admissions, colleagues] = await Promise.all([
        store.track(() => store.api.admissions(HANDOVER_STATES)),
        store.track(() => store.api.handoverColleagues()),
      ]);
      if (!mounted.current) return;
      setState({
        phase: "ready",
        // The server was asked for these states; a row in another is not offered whatever it answers.
        admissions: (Array.isArray(admissions) ? admissions : []).filter((r) => r && HANDOVER_STATES.includes(r.state)),
        colleagues: (Array.isArray(colleagues) ? colleagues : []).filter(isPerson),
        error: null,
      });
    } catch (error) {
      if (mounted.current) setState((prev) => ({ ...prev, phase: "failed", error }));
    }
  }, [enabled, store]);
  useEffect(() => { load(); }, [load]);
  return { ...state, load };
}

/** `open` false renders nothing. `handover` null: a new handover; an OPEN row: its note step. `onWritten` reads the
 *  lists again (a promise, awaited before the dialog lets go). `mineOpen`: my OPEN handovers still inside their
 *  bridge — a patient among them is not handed over a second time. A new opening starts blank. */
export function NewHandoverDialog({ open, handover = null, mineOpen = [], onClose, onWritten }) {
  if (!open) return null;
  return <HandoverForm key={handover?.id ?? "new"} handover={handover} mineOpen={mineOpen} onClose={onClose} onWritten={onWritten} />;
}

/** The handover a dialog signs: its id, its patient's board key (what the lock reads) and its subject (what the toasts
 *  say). Fixed when it is opened — whatever the select says after — or from the row a note step was opened on. */
const targetOf = (row) => ({ id: row.id, boardKey: patientOf(row)?.board_key ?? null, subject: subjectOf(row) });

function HandoverForm({ handover, mineOpen, onClose, onWritten }) {
  const { t } = useI18n();
  const board = useBoard();
  const { store } = useSession();
  const toast = useToast();
  const fresh = handover === null;
  const picks = usePicks(fresh);
  const [admissionId, setAdmissionId] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [note, setNote] = useState(() => partsOf(handover?.note));
  const [tried, setTried] = useState(false);            // the errors show once «Devret ve imzala» was pressed
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(() => (handover ? targetOf(handover) : null));   // once there is one
  const [held, setHeld] = useState(false);              // the server held the signature: a critical alarm (409)
  const sending = useRef(false);
  const patientBox = useRef(null);
  const receiverBox = useRef(null);
  const firstPart = useRef(null);
  const formId = useId();
  const hintId = useId();
  const lockId = useId();
  const earlierId = useId();

  const opened = target !== null;
  const chosen = fresh ? picks.admissions.find((r) => r.id === admissionId) ?? null : null;
  const boardKey = opened ? target.boardKey : boardKeyOf(chosen);
  const subject = opened ? target.subject : chosen ? bedOf(chosen) : "—";
  const critical = openCriticalOnBoard(board, boardKey) > 0;
  // An OPEN handover of mine already covers this patient: it is the one to sign, from its row (review 4).
  const earlier = fresh && !opened && chosen !== null
    ? (Array.isArray(mineOpen) ? mineOpen : []).find((r) => String(patientOf(r)?.admission_id) === String(chosen.id)) ?? null
    : null;
  const missing = {
    patient: fresh && !opened && chosen === null,
    receiver: fresh && !opened && !picks.colleagues.some((c) => String(c.id) === receiverId),
  };
  const noteOk = noteValid(note);
  const lockText = held ? t("devir.lockAfterOpen") : critical ? t("devir.lock") : null;
  const why = [lockText ? lockId : null, earlier ? earlierId : null].filter(Boolean).join(" ") || undefined;

  async function send() {
    if (sending.current || busy) return;
    setHeld(false);                                      // the last answer's lock is not this press's
    if (missing.patient || missing.receiver || !noteOk) {
      // Said under each box, and the focus taken to the first that is wrong; the server is not asked. flushSync: the
      // problem must be in the DOM, tied to its box, when the focus arrives (RrtCallDialog).
      flushSync(() => setTried(true));
      (missing.patient ? patientBox : missing.receiver ? receiverBox : firstPart).current?.focus();
      return;
    }
    // The lock, or the earlier handover, is on screen already, with its way on: nothing is sent while it stands.
    if (critical || earlier) return;
    setTried(true);
    sending.current = true;
    setBusy(true);
    // What this press is for, fixed now: the selects are frozen while it is out, and once opened the handover is
    // the one it opened, whatever they say after (review 2).
    const sentFor = target ?? { id: null, boardKey: boardKeyOf(chosen), subject: bedOf(chosen) };
    const { subject: named } = sentFor;
    let id = sentFor.id;
    let said = null;                                     // [text, tone] for the toast
    let close = true;
    let touched = false;                                 // something was written, or may have been
    try {
      if (id === null) {
        const answer = await store.track(() => store.api.openHandover({
          unitId: chosen.admitting_unit_id, incomingUserId: receiverId, admissionId: chosen.id,
        }));
        touched = true;
        id = answer?.id ?? null;
        if (id !== null) setTarget({ ...sentFor, id });
      }
      if (id === null) {
        // Opened, by the server's 201, but with no id to sign by: the list will show it.
        said = [t("devir.mayHaveLanded", { subject: named }), "warn"];
      } else {
        await store.track(() => store.api.signHandover(id, noteBody(note)));
        touched = true;
        said = [t(fresh ? "devir.done" : "devir.signed", { subject: named })];
      }
    } catch (err) {
      if (err?.superseded) {
        said = null;                                     // the session ended: nobody is there to read an answer
      } else if (id !== null && err?.apiCode === CRITICAL_ALARM_OPEN) {
        touched = true;                                  // the handover is OPEN, on the list behind the dialog
        close = false;
        setHeld(true);
        // The Note in the dialog does not announce itself: the toast says it, as a row's refusal does (review 1).
        said = [t("devir.signRefused", { subject: named, reason: t("devir.criticalReason") }), "error"];
      } else if (mayHaveLanded(err)) {
        touched = true;
        said = [t("devir.mayHaveLanded", { subject: named }), "warn"];
      } else if (id === null) {
        // Nothing was opened: choose again — from a list read again, as the refusal says it was (review 5).
        close = false;
        said = [t("devir.openRefused", { subject: named, reason: apiErrorText(t, err) }), "error"];
        picks.load();
      } else if (err?.status === 422) {
        // The note was refused (D5): it is hers to fix, here, and the next press signs the handover already opened.
        touched = true;
        close = false;
        said = [t("devir.signRefused", { subject: named, reason: apiErrorText(t, err) }), "error"];
      } else {
        touched = true;
        said = [t("devir.signRefused", { subject: named, reason: apiErrorText(t, err) }), "error"];
      }
    }
    if (said) toast(...said);
    try {
      if (touched) await onWritten?.();                 // held until the lists say what the write did (A-17)
    } finally {
      sending.current = false;
      setBusy(false);
    }
    if (close) onClose();
  }

  const patient = fresh ? null : patientOf(handover);
  return (
    <Modal
      open title={fresh ? t("devir.newHandover") : t("devir.signTitle", { subject })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button variant="ghost" onClick={onClose} busy={busy}>{t("devir.cancel")}</Button>
          {/* Held, not disabled, while the lock or an earlier handover stands: it keeps its focus and says why. */}
          <Button type="submit" form={formId} variant="primary" icon="ok" busy={busy}
            aria-disabled={critical || earlier ? "true" : undefined} aria-describedby={why}>
            {opened ? t("devir.sign") : t("devir.submit")}
          </Button>
        </>
      )}
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); send(); }}>
        {fresh && picks.phase === "failed" ? (
          <Alert tone="crit" className="mb-3">
            <p className="m-0">{t("devir.pickRead", { reason: readErrorText(t, picks.error) })}</p>
            <Button size="sm" className="mt-2" onClick={picks.load}>{t("devir.retry")}</Button>
          </Alert>
        ) : null}
        {fresh ? (
          <>
            <Field
              label={t("devir.patient")} layout="col" required
              error={tried && missing.patient ? t("devir.patientMissing") : undefined}
              hint={picks.phase === "ready" && picks.admissions.length === 0 ? t("devir.noPatients") : undefined}
            >
              <Select ref={patientBox} value={admissionId} disabled={opened || busy} onChange={(e) => setAdmissionId(e.target.value)}>
                <option value="">{t("kabul.choose")}</option>
                {picks.admissions.map((r) => (
                  <option key={r.id} value={r.id}>{[bedOf(r), r.display_name].filter(Boolean).join(" · ")}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("devir.receiver")} layout="col" required
              error={tried && missing.receiver ? t("devir.receiverMissing") : undefined}
              hint={picks.phase === "ready" && picks.colleagues.length === 0 ? t("devir.noColleagues") : undefined}
            >
              <Select ref={receiverBox} value={receiverId} disabled={opened || busy} onChange={(e) => setReceiverId(e.target.value)}>
                <option value="">{t("kabul.choose")}</option>
                {picks.colleagues.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </Select>
            </Field>
          </>
        ) : (
          <KVList className="mb-3">
            <KV label={t("devir.patient")} mono={false}>
              {[subject, patient?.display_name].filter(Boolean).join(" · ")}
            </KV>
            <KV label={t("devir.receiver")} mono={false}>{handover.incoming?.name || "—"}</KV>
          </KVList>
        )}
        {/* A board that is not LIVE rules no alarm out: the check above is the server's then (review 8). */}
        {boardKnown(board.connection) ? null : (
          <Note tone="info" icon="eye" className="mb-3">{t("devir.boardNotLive")}</Note>
        )}
        {lockText ? (
          <Note icon="lock" className="mb-3">
            <span id={lockId}>{lockText}</span>{" "}
            <a href="#/alarms" className={`rounded-md underline ${FOCUS_RING}`}>{t("devir.toAlarms")}</a>
          </Note>
        ) : null}
        {earlier ? (
          <Note icon="swap" className="mb-3">
            <span id={earlierId}>{t("devir.alreadyOpen", { to: earlier.incoming?.name || "—" })}</span>
          </Note>
        ) : null}
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-1 p-0 font-text text-13.5 font-semibold text-mute">{t("devir.noteLegend")}</legend>
          <p id={hintId} className="m-0 mb-2 text-12 text-mute">{t("devir.noteHint")}</p>
          {NOTE_PARTS.map((part, i) => (
            <Field
              key={part} label={t(`devir.part.${part}`)} layout="col"
              error={i === 0 && tried && !noteOk ? t("devir.noteInvalid") : undefined}
            >
              <Textarea
                ref={i === 0 ? firstPart : undefined} value={note[part]} maxLength={PART_MAX} readOnly={busy}
                aria-describedby={hintId} onChange={(e) => { const { value } = e.target; setNote((n) => ({ ...n, [part]: value })); }}
              />
            </Field>
          ))}
        </fieldset>
      </form>
      {/* A busy button reads only "unavailable"; the words come from here. */}
      <Announce text={busy ? t("devir.sending") : ""} />
    </Modal>
  );
}
