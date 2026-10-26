// src/live/screens/kabul/DischargeDialog.jsx — the physician's discharge decision (Group 2 · B1a,
// spec D7, §3.3 step 1): where the patient goes — home, another institution (named), exitus
// (reported by: the physician herself unless another name is written) — when (now by default,
// never in the future) and a note. The server decides and checks again (admission/form.py); a
// critical alarm nobody acknowledged refuses it there, said on the toast — and a refusal is news
// about the list (someone else may have started it), so the tab reads it again (`onRefused`).
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Button, Field, Input, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, refusedFor } from "../admin/refusal.js";

export const DISPOSITIONS = Object.freeze([
  Object.freeze({ value: "HOME", key: "kabul.disp.home" }),
  Object.freeze({ value: "OTHER_INSTITUTION", key: "kabul.disp.other" }),
  Object.freeze({ value: "EXITUS", key: "kabul.disp.exitus" }),
]);

/** A refused discharge write on the toast, as `refusedFor` says it — except an uncoded 404
 *  ("Admission not found."), which is said by its status in the reader's words, never in the
 *  server's English (amendment A-9). The Taburcu tab's confirmation says it the same way. */
export const refusedDischarge = (t, subject, err) => refusedFor(t, subject,
  err && typeof err === "object" && err.status === 404 && !err.apiCode ? t("errors.requestFailed", { status: 404 }) : err);

const pad = (n) => String(n).padStart(2, "0");
/** An instant as a datetime-local value, in this browser's time. */
export const localInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** A datetime-local value as an instant, built from its parts in this browser's time — not
 *  `Date.parse`, whose reading of a date-time with no offset browsers have not always agreed on.
 *  NaN for anything that is not one, a day the month does not have (30 February) included. */
export const fromLocalInput = (value) => {
  const parts = LOCAL.exec(String(value ?? ""));
  if (!parts) return NaN;
  const [y, mo, d, h, mi] = parts.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return NaN;
  const at = new Date(y, mo - 1, d, h, mi);
  return at.getFullYear() === y && at.getMonth() === mo - 1 && at.getDate() === d ? at.getTime() : NaN;
};

export function DischargeDialog({ row, subject, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [disposition, setDisposition] = useState("HOME");
  const [institution, setInstitution] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [at, setAt] = useState(() => localInput(Date.now()));
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const atMs = fromLocalInput(at);
  const errors = {
    institution: disposition === "OTHER_INSTITUTION" && !institution.trim() ? t("kabul.invalid.institution") : null,
    at: !Number.isFinite(atMs) || atMs > Date.now() + 60_000 ? t("kabul.invalid.dischargeAt") : null,
  };
  const wrong = Object.values(errors).some(Boolean);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (wrong) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      await store.track(() => store.api.startDischarge(row.id, {
        disposition,
        institution: disposition === "OTHER_INSTITUTION" ? institution.trim() : null,
        reported_by: disposition === "EXITUS" && reportedBy.trim() ? reportedBy.trim() : null,
        discharge_at: new Date(atMs).toISOString(),
        note: note.trim() || null,
      }));
      toast(doneFor(t, subject, t("kabul.dischargeStarted")));
      onDone();
    } catch (err) {
      toast(refusedDischarge(t, subject, err), "error");
      onRefused?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t("kabul.dischargeTitle", { subject })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button type="submit" form="discharge-form" variant="primary" icon="out" busy={busy}>{t("kabul.dischargeSubmit")}</Button>
        </>
      )}>
      <form id="discharge-form" noValidate onSubmit={submit}>
        <fieldset className="mb-2.5 min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("kabul.f.disposition")}</legend>
          <div className="flex flex-wrap gap-3">
            {DISPOSITIONS.map((d) => (
              <label key={d.value} className="inline-flex items-center gap-1.5 text-13.5">
                <input type="radio" name="disposition" value={d.value} checked={disposition === d.value}
                  onChange={() => setDisposition(d.value)} className={FOCUS_RING} />
                {t(d.key)}
              </label>
            ))}
          </div>
        </fieldset>
        {disposition === "OTHER_INSTITUTION" ? (
          <Field label={t("kabul.f.institution")} required error={tried ? errors.institution ?? undefined : undefined}>
            <Input value={institution} maxLength={200} readOnly={busy} onChange={(e) => setInstitution(e.target.value)} />
          </Field>
        ) : null}
        {disposition === "EXITUS" ? (
          <Field label={t("kabul.f.reportedBy")} hint={t("kabul.reportedByHint")}>
            <Input value={reportedBy} maxLength={200} readOnly={busy} onChange={(e) => setReportedBy(e.target.value)} />
          </Field>
        ) : null}
        <Field label={t("kabul.f.dischargeAt")} required error={tried ? errors.at ?? undefined : undefined}>
          <Input type="datetime-local" value={at} max={localInput(Date.now())} readOnly={busy}
            onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label={t("kabul.f.note")}>
          <textarea value={note} maxLength={2000} rows={3} readOnly={busy} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none focus:border-pri" />
        </Field>
      </form>
    </Modal>
  );
}
