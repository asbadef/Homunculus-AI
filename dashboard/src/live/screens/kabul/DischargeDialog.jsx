// src/live/screens/kabul/DischargeDialog.jsx — the physician's discharge decision (Group 2 · B1a,
// spec D7, §3.3 step 1): where the patient goes — home, another institution (named), exitus
// (reported by: the physician herself unless another name is written) — when (now by default,
// never in the future) and a note. The server decides and checks again (admission/form.py); a
// critical alarm nobody acknowledged refuses it there, said on the toast — and a refusal is news
// about the list (someone else may have started it), so the tab reads it again (`onRefused`).
//
// THE DEFAULT TIME IS NEVER BEFORE THE ADMISSION (A-30). A datetime-local holds minutes, and read
// back its value is the minute's start: a discharge within the admission's own minute went out
// before the admission and was refused (`field_invalid:discharge_at`). So the default is the
// moment the dialog opened or the admission's, whichever is later — kept to the millisecond and
// sent as it is while the field shows its minute; a minute chosen within the admission's own sends
// the admission's time; and a minute before it is refused here, with the server's own sentence.
// The admission's time goes out AS THE SERVER WROTE IT (review I-1): the server keeps microseconds
// (`…:40.123456Z`) and Date.parse milliseconds, so the same instant rebuilt here (`…:40.123Z`) is
// before the stored one and refused. Any time equal to the admission's to the millisecond is sent as
// `row.admission_datetime`, exactly; every later one is later than it however the server rounds.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Button, Field, Input, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, reasonOf, refusedFor } from "../admin/refusal.js";

export const DISPOSITIONS = Object.freeze([
  Object.freeze({ value: "HOME", key: "kabul.disp.home" }),
  Object.freeze({ value: "OTHER_INSTITUTION", key: "kabul.disp.other" }),
  Object.freeze({ value: "EXITUS", key: "kabul.disp.exitus" }),
]);

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

/** The body POST …/discharge/initiate takes (admission/schemas.py DischargeStart): the institution
 *  only for another institution, the reporter only for an exitus and only when written.
 *  `dischargeAt` is the time as sent, already a string (`dischargeAtOf`). */
export function dischargeBody({ disposition, institution, reportedBy, dischargeAt, note }) {
  return {
    disposition,
    institution: disposition === "OTHER_INSTITUTION" ? String(institution ?? "").trim() : null,
    reported_by: disposition === "EXITUS" && String(reportedBy ?? "").trim() ? String(reportedBy).trim() : null,
    discharge_at: dischargeAt,
    note: String(note ?? "").trim() || null,
  };
}

/** The discharge time as sent: the admission's own string when `atMs` is the admission's instant to
 *  the millisecond (its microseconds kept, review I-1), else `atMs` in ISO form. */
export function dischargeAtOf(atMs, admissionDatetime) {
  const admittedMs = Date.parse(admissionDatetime ?? "");
  return Number.isFinite(admittedMs) && atMs === admittedMs ? admissionDatetime : new Date(atMs).toISOString();
}

export function DischargeDialog({ row, subject, onClose, onDone, onRefused }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [disposition, setDisposition] = useState("HOME");
  const [institution, setInstitution] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const admittedMs = Date.parse(row.admission_datetime ?? "");
  // When the dialog opened, or the admission when that is later (this browser's clock behind it).
  const [opened] = useState(() => Math.max(Date.now(), Number.isFinite(admittedMs) ? admittedMs : -Infinity));
  const [at, setAt] = useState(() => localInput(opened));
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const asOpened = at === localInput(opened);
  const chosen = asOpened ? opened : fromLocalInput(at);
  // A minute chosen within the admission's own is the admission's time, not the minute's start.
  const sameMinute = Number.isFinite(admittedMs) && chosen < admittedMs && chosen + 60_000 > admittedMs;
  const atMs = sameMinute ? admittedMs : chosen;
  const errors = {
    institution: disposition === "OTHER_INSTITUTION" && !institution.trim() ? t("kabul.invalid.institution") : null,
    // The default is no future, whatever this browser's clock says: it is now or the admission's.
    at: !Number.isFinite(atMs) || (!asOpened && atMs > Date.now() + 60_000)
      || (Number.isFinite(admittedMs) && atMs < admittedMs) ? t("kabul.invalid.dischargeAt") : null,
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
      await store.track(() => store.api.startDischarge(row.id, dischargeBody({
        disposition, institution, reportedBy, dischargeAt: dischargeAtOf(atMs, row.admission_datetime), note,
      })));
      toast(doneFor(t, subject, t("kabul.dischargeStarted")));
      await onDone();                               // held until the tab has read its list again (A-17)
    } catch (err) {
      // An uncoded 404 ("Admission not found.") is said by its status (refusal.js `reasonOf`).
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
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
          <Input type="datetime-local" value={at} max={localInput(Math.max(Date.now(), opened))} readOnly={busy}
            min={Number.isFinite(admittedMs) ? localInput(admittedMs) : undefined}
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
