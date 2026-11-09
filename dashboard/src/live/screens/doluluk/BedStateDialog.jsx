// src/live/screens/doluluk/BedStateDialog.jsx — «Rezerv et» and «İstifadədən çıxar» (Group 2 ·
// B3a, spec §3, D4).
// - Reserve: the note says for whom and why. It is at most 200 characters, and the server keeps it
//   encrypted (R8).
// - Out of service: a reason is required, and «Digər» needs a note as well (X3).
// The server checks all of it again. A refusal is said on the toast, named after the bed, and
// the screen reads its beds again (`onRefused`).
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Button, Field, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";
import { REASONS } from "./occupancy.js";

export const NOTE_MAX = 200;

/** `mode`: "reserve" | "outOfService"; `bed`: the structure's bed; `subject`: "label · room · unit".
 *  `onDone` is awaited (the screen re-reads before the dialog's buttons let go); `onRefused` is not. */
export function BedStateDialog({ mode, bed, subject, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const out = mode === "outOfService";
  const text = note.trim();
  const errors = {
    reason: out && !reason ? t("doluluk.dialog.reasonNeeded") : null,
    note: out && reason === "OTHER" && !text ? t("doluluk.dialog.noteNeeded") : null,
  };
  const formId = `doluluk-${mode}`;
  const reasonErrorId = `${formId}-reason-error`;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (errors.reason || errors.note) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      await store.track(() => (out
        ? store.api.bedOutOfService(bed.id, { reason, note: text || null })
        : store.api.reserveBed(bed.id, { note: text || null })));
      toast(doneFor(t, subject, t(`doluluk.done.${mode}`)));
      await onDone();
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      onRefused?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t(out ? "doluluk.dialog.outTitle" : "doluluk.dialog.reserveTitle", { bed: subject })}
      onClose={onClose} busy={busy}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" icon="ok" busy={busy}>
            {t(out ? "doluluk.dialog.submitOut" : "doluluk.dialog.submitReserve")}
          </Button>
        </>
      )}>
      <form id={formId} noValidate onSubmit={submit}>
        {out ? (
          <fieldset className="mb-2.5 min-w-0 border-0 p-0"
            aria-describedby={tried && errors.reason ? reasonErrorId : undefined}>
            <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("doluluk.dialog.reason")}</legend>
            <div className="flex flex-wrap gap-3">
              {REASONS.map((value) => (
                <label key={value} className="inline-flex items-center gap-1.5 text-13.5">
                  <input type="radio" name={`${formId}-reason`} value={value} checked={reason === value}
                    disabled={busy} onChange={() => setReason(value)} className={FOCUS_RING} />
                  {t(`doluluk.reason.${value}`)}
                </label>
              ))}
            </div>
            {tried && errors.reason
              ? <p id={reasonErrorId} role="alert" className="m-0 mt-1 text-12.5 text-crit-ink">{errors.reason}</p>
              : null}
          </fieldset>
        ) : null}
        <Field label={t("doluluk.dialog.note")} hint={t(out ? "doluluk.dialog.noteHint" : "doluluk.dialog.reserveHint")}
          error={tried ? errors.note ?? undefined : undefined}>
          <textarea value={note} maxLength={NOTE_MAX} rows={3} readOnly={busy} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none focus:border-pri" />
        </Field>
      </form>
    </Modal>
  );
}
