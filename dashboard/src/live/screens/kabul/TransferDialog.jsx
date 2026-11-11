// src/live/screens/kabul/TransferDialog.jsx — «Nakil» (Group 2 · B1b, spec §4): the patient moves to
// another bed in one step. The dialog says where she lies now and that the old bed goes to cleaning.
// It asks:
// - the reason, one of six (D4);
// - a note of at most 200 characters, with its count — optional, but «Diğer» needs one (D8), as
//   B3a's out-of-service dialog does;
// - the new bed, from the picker opened on her unit. Her own bed is occupied, so it is not offered.
// A reserved bed is asked about first (ReservedAsk.jsx, B3a's question, its note read from
// GET /tenant/occupancy) and goes out with `confirm_reserved`. A bed reserved after the picker read
// it comes back `bed_reserved`: the beds are read again and the question is asked.
//
// A critical alarm nobody acknowledged is said in the warning tone and holds nothing (D7): a
// patient often moves because she is worse, and her alarms move with her. The tab passes it only
// once the board has loaded — a hint, not a hold. The server checks all of it again; a refusal is
// said on the toast in words, `field_invalid:note` in the transfer's own (X7).
//
// The dialog stays open and held until the tab has read its list again (A-17). What the answer says
// beyond the move — the card did not reach the new bed (`board: failed`) — is the tab's to keep
// (DischargeTab.jsx, «Kartı yeniden taşı»).
//
// What B1c's dialog (AddMemberDialog.jsx) taught, kept here:
// - The bed she picked is sent only while the picker still offers it. A re-read that shows it taken,
//   closed or gone drops the pick (`picked`), so what goes out is always what she can see; changing
//   the unit drops it too. While the write is held the picker is held with it.
// - A send stopped for a field moves the focus to the first one at fault — the reason, the note, the
//   bed — and the error then describes it (`asked`, applied after the render that draws the errors).
// - The button that moves her is described by the sentence of what it does («the old bed goes to
//   cleaning») and, when it shows, the warning: a screen reader says them with the button.
// - `onDone` runs outside the write's own try: a failing re-read after a move that landed is not a
//   refusal of the move. It MUST handle its own read failure (DischargeTab's does).
// - After a refusal that is not about a field, the beds are read again — inside the hold, so the
//   buttons free only once the picker is current: it may be out of date (the bed is taken now, or
//   reserved). A note the server refused mends in the dialog, and a session that ended has no reader.
// Nothing here depends on a clock, and there is no search box: the dialog has no hidden pick to send.
//
// Review of Task 9, kept here:
// - A send that got no answer (`mayHaveLanded`: a timeout, a 5xx, a dropped line) may have moved her. The
//   body that went is kept (`unanswered`) and the next press sends THAT body, whatever the re-read now
//   shows — the bed she asked for may be hers already — and the server answers a resent move with the
//   arriving row (T9). The form is locked meanwhile, so what she sees is what goes, and says so.
//   A refusal that did answer ends the lock.
// - The reserved yes is for the bed the question named (`submit(null, yesBed)`), as AdmitTab's (I-1):
//   a pick that is another bed by then is asked about, never sent with the yes for the other.
// - After `bed_reserved` the beds are read again and the question is asked only if the bed is still
//   offered; if it is taken meanwhile, the refusal is said on the toast and the focus goes to the bed.
// - `onDone` is guarded: a rejection from it is the tab's own read failure, already said there, and must
//   neither become an unhandled rejection nor be said as a refusal of a move that landed.
// - The wait is announced politely (`Announce`), as AdmitTab's is.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { admissible, indexStructure, normId } from "../../data/structure.js";
import { Announce, Button, Field, Modal, Note, Select, Textarea, useToast } from "../../ui/index.js";
import { mayHaveLanded, reasonOf, refusedFor } from "../admin/refusal.js";
import { BedPicker } from "./BedPicker.jsx";
import { ReservedAsk } from "./ReservedAsk.jsx";

/** The six reasons (admission/models.py TransferReason), in the prototype's order. */
export const TRANSFER_REASONS = Object.freeze(["CLINICAL_NEED", "TO_ICU", "ICU_TO_WARD", "ISOLATION", "PATIENT_OR_FAMILY_REQUEST", "OTHER"]);
/** A note's bound in characters (admission/schemas.py TRANSFER_NOTE_MAX). */
export const NOTE_MAX = 200;

const FORM_ID = "transfer-form";
const BED_ID = "transfer-bed";
const NOW_ID = "transfer-now";
const CRITICAL_ID = "transfer-critical";
const RESEND_ID = "transfer-resend";

/** The body POST …/transfer takes (admission/schemas.py TransferRequest): the bed, the reason, the
 *  note trimmed (null when blank), and `confirm_reserved` only after a yes to a reserved bed. */
export function transferBody({ bedId, reason, note, confirmReserved = false }) {
  const text = String(note ?? "").trim();
  return { target_bed_id: bedId, reason, note: text || null, ...(confirmReserved ? { confirm_reserved: true } : null) };
}

/** `row`: the admitted patient's row (AdmissionRow); `subject`: her bed, "label · room · unit";
 *  `critical`: the loaded board shows her a critical alarm nobody acknowledged. `onDone({answer,
 *  body, to})` is awaited — the tab reads its list again before the dialog lets go (A-17) — and,
 *  being outside the write's try, must handle its own read failure; `onRefused` is not awaited. */
export function TransferDialog({ row, subject, critical = false, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const { structure, index, phase, error, reload } = useStructure();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [unitId, setUnitId] = useState(null);           // a unit chosen in the picker
  const [target, setTarget] = useState(null);           // {id, unitId, label}: what she pressed
  const [ask, setAsk] = useState(null);                 // the reserved-bed question: {bedId, bed}
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(0);                // bumped by a send stopped for a field: draws the errors, moves the focus
  const [unanswered, setUnanswered] = useState(null);   // {body, to}: a send that got no answer, to go again as it was
  const want = useRef("reason");                        // the control the focus goes to: "reason" | "note" | "bed"
  const reasonRef = useRef(null);
  const noteRef = useRef(null);
  // Held: a write is out, or one with no answer is waiting to go again as it went.
  const held = busy || unanswered !== null;
  // The picker opens on her unit: her bed's, from the structure (A-12), until another is chosen.
  const shownUnit = unitId ?? index.beds.get(normId(row.bed_id))?.unitId ?? null;
  // What she pressed, while the structure still offers it: a read made since (after a refusal, after
  // a reservation) may show it taken, closed or gone, and what is sent must be what she can see. A
  // send with no answer keeps her pick on show, taken or not: the bed may be hers by now.
  const picked = target && (unanswered || admissible(index.beds.get(normId(target.id)))) ? target : null;
  const errors = {
    reason: reason ? null : t("kabul.transfer.reasonNeeded"),
    note: reason === "OTHER" && !note.trim() ? t("kabul.transfer.noteNeeded") : null,
    bed: picked ? null : t("kabul.transfer.bedNeeded"),
  };
  const wrong = Object.values(errors).some(Boolean);

  useEffect(() => {
    if (asked === 0) return;
    const control = want.current === "reason" ? reasonRef.current
      : want.current === "note" ? noteRef.current
        : document.getElementById(BED_ID);
    control?.focus();
  }, [asked]);

  /** `yesBed`: the bed the reserved-bed question named, when this press is her yes to it. */
  async function submit(event, yesBed = null) {
    event?.preventDefault();
    if (busy) return;
    let body;
    let to;
    if (unanswered) {
      // The last send got no answer, so she may be at the new bed already. The same body goes again,
      // whatever the re-read shows now; the server answers a resent move with the arriving row (T9).
      ({ body, to } = unanswered);
    } else {
      if (wrong) {
        want.current = errors.reason ? "reason" : errors.note ? "note" : "bed";
        setTried(true);
        setAsked((n) => n + 1);
        return;
      }
      // Her yes counts for the bed the question named, and for no other (AdmitTab's I-1).
      const confirmed = yesBed != null && normId(yesBed) === normId(picked.id);
      if (index.beds.get(normId(picked.id))?.state === "RESERVED" && !confirmed) {
        setAsk({ bedId: picked.id, bed: picked.label });
        return;
      }
      body = transferBody({ bedId: picked.id, reason, note, confirmReserved: confirmed });
      to = picked.label;
    }
    setBusy(true);
    try {
      let answer;
      try {
        answer = await store.track(() => store.api.transfer(row.id, body));
      } catch (err) {
        // No answer: it may have landed, and the same body is kept for the next press. An answer, of
        // any refusal, ends that.
        setUnanswered(mayHaveLanded(err) ? { body, to } : null);
        if (err?.apiCode === "bed_reserved") {
          // Reserved after the picker read it; nothing was written. Read the beds again, and ask only
          // if the bed is still offered: a read that failed cannot say, so it asks.
          const tree = await reload();
          if (tree === null || admissible(indexStructure(tree).beds.get(normId(body.target_bed_id)))) {
            setAsk({ bedId: body.target_bed_id, bed: to });
            return;
          }
          // Taken meanwhile: there is nothing to confirm. Say so, and take her to the bed.
          toast(refusedFor(t, subject, t("kabul.err.bedNotAvailable")), "error");
          onRefused?.();
          want.current = "bed";
          setTried(true);
          setAsked((n) => n + 1);
          return;
        }
        const said = err?.apiCode === "field_invalid:note" ? t("kabul.transfer.noteInvalid") : reasonOf(t, err);
        toast(refusedFor(t, subject, said), "error");
        onRefused?.();
        // The note is mended here, and a session that ended has no reader. Any other refusal says the
        // picker may be out of date — the bed is taken now — so the beds are read again, before the
        // buttons are given back.
        if (err?.apiCode !== "field_invalid:note" && !err?.superseded) await reload();
        return;
      }
      const failed = answer?.board === "failed";
      toast(t(failed ? "kabul.transfer.doneBoardFailed" : "kabul.transfer.done", { from: subject, to }),
        failed ? "warn" : "ok");
      try {
        await onDone({ answer, body, to });
      } catch {
        // The tab's own read failed and said so there. The move has landed: that is no refusal of it,
        // and no unhandled rejection either.
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal open title={t("kabul.transfer.title", { bed: subject })} onClose={onClose} busy={busy}
        actions={(
          <>
            <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            <Button type="submit" form={FORM_ID} variant="primary" icon="swap" busy={busy}
              aria-describedby={[NOW_ID, critical ? CRITICAL_ID : null, unanswered ? RESEND_ID : null].filter(Boolean).join(" ")}>
              {t("kabul.transfer.submit")}
            </Button>
          </>
        )}>
        <form id={FORM_ID} noValidate onSubmit={submit} className="grid gap-2">
          <p id={NOW_ID} className="m-0 text-14">{t("kabul.transfer.now", { bed: subject })}</p>
          {critical ? <div id={CRITICAL_ID}><Note icon="alert">{t("kabul.transfer.critical")}</Note></div> : null}
          {unanswered ? <div id={RESEND_ID}><Note icon="alert">{t("kabul.transfer.resend")}</Note></div> : null}
          <Field label={t("kabul.transfer.reason")} required error={tried ? errors.reason ?? undefined : undefined}>
            <Select ref={reasonRef} value={reason} disabled={held} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t("kabul.transfer.choose")}</option>
              {TRANSFER_REASONS.map((value) => <option key={value} value={value}>{t(`kabul.transfer.reasons.${value}`)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.transfer.note")} required={reason === "OTHER"} hint={t("kabul.transfer.noteHint")}
            error={tried ? errors.note ?? undefined : undefined}>
            <Textarea ref={noteRef} value={note} maxLength={NOTE_MAX} rows={3} readOnly={held} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <p aria-hidden="true" className="m-0 -mt-2 text-right text-12 text-mute">{note.length} / {NOTE_MAX}</p>
          {/* A held write holds the picker too: nothing she presses meanwhile could change what went out. */}
          <fieldset disabled={held} className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("kabul.transfer.bed")}</legend>
            <BedPicker structure={structure} phase={phase} error={error} onRetry={reload}
              unitId={shownUnit} bedId={picked?.id ?? null}
              onUnit={(id) => { setUnitId(id); setTarget(null); }}
              onBed={(bed) => setTarget(bed)}
              invalid={tried && Boolean(errors.bed)} focusId={BED_ID}
              describedBy={tried && errors.bed ? `${BED_ID}-error` : undefined} />
            {tried && errors.bed
              ? <p id={`${BED_ID}-error`} role="alert" className="m-0 mt-1 text-12.5 font-semibold text-crit-ink">{errors.bed}</p>
              : null}
          </fieldset>
          <Announce text={busy ? t("kabul.transfer.moving") : ""} />
        </form>
      </Modal>
      {ask ? (
        <ReservedAsk bedId={ask.bedId} bed={ask.bed} confirmKey="kabul.transfer.reservedConfirm"
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            const yes = ask.bedId;           // her yes is for the bed asked about (AdmitTab's I-1)
            setAsk(null);
            submit(null, yes);
          }} />
      ) : null}
    </>
  );
}
