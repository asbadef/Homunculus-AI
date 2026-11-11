// src/live/screens/bedside/UnmatchedStep.jsx — «Eşleşmeyen ölçümler» (G3-05, D4, D10, D11, D17): the device readings
// whose number matched no stay, or a discharged patient's, kept with their values — a step of the bedside page.
//
// THE LIST is the shell's own read (data/UnmatchedProvider.jsx): one row per set — one number, one device, one time
// — with the number AS IT WAS TYPED, why it matched nobody, the device, the measurement time and the values. The
// engine has already left out what this session may not see (a discharged patient of another unit, D11) and says
// which sets can still be linked (`linkable`: the browser judges no age).
//
// «HASTAYA BAĞLA» walks the page's own two steps before anything is sent (D11): the patient list (the board in this
// session's scope), then the identity question — name, year of birth, bed — asked over the reading's values. Only
// «Evet, bağla» sends the link. The engine takes each reading at its own time, with the device as its source: the
// patient's card and scores change as if the device had sent the right number, and the board reloads.
// «REDDET» asks for a reason of 10–200 characters; the values stay in the record.
//
// THE ENGINE DECIDES: a refusal is said on the toast in the reader's words (apiErrors.js maps its code), named after
// the bed for a link and after the number for a rejection, and the list is read again either way — another desk may
// have got there first. A link with no answer may have landed: she is told where to look.
import React, { useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { numberText } from "../../i18n/numbers.js";
import { apiErrorText, readErrorText } from "../../apiErrors.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useUnmatched } from "../../data/UnmatchedProvider.jsx";
import { Announce, Box, Button, Field, Input, Modal, Note, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { IdentityStep, PickList, bedOf } from "./PickSteps.jsx";
import { specOf, valueText } from "./vitalsFields.js";

/** The reason's bounds — api/readings.py REJECT_MIN_REASON_CHARS / REJECT_MAX_REASON_CHARS, mirrored only so the
 *  button can say why it waits and the box stops at the ceiling; the engine stays the judge. */
export const REJECT_MIN_REASON_CHARS = 10;
export const REJECT_MAX_REASON_CHARS = 200;

const timeOf = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : null;
};
const idsOf = (set) => (Array.isArray(set.readings) ? set.readings : []).map((r) => r.id).filter(Number.isInteger);
const keyOf = (set) => `${set.received_key}|${set.source}|${set.observed_at}`;

/** A set's values as one line: «Nabız 88 /dk · SpO2 97 %» — the bedside form's names and units for the codes it
 *  knows, the engine's code and number for any other. */
function SetValues({ set }) {
  const { t, lang } = useI18n();
  const parts = (Array.isArray(set.readings) ? set.readings : []).map((r) => {
    const spec = specOf(r.code);
    if (spec) return `${t(spec.labelKey)} ${valueText(t, r.code, r.value, lang)}`;
    const number = typeof r.value === "number" ? numberText(lang, r.value) : "—";
    return [String(r.code ?? "—"), number, r.unit].filter(Boolean).join(" ");
  });
  return <p data-um-values="" className="m-0 mt-1 font-data text-14.5 font-semibold text-ink">{parts.join(" · ")}</p>;
}

/** What a set is, in words: the number as typed, why it waits, the device, when it was measured. */
function SetFacts({ set, nowMs }) {
  const { t } = useI18n();
  const at = timeOf(set.observed_at);
  const facts = [
    t(set.reason === "discharged" ? "kayit.umReasonDischarged" : "kayit.umReasonUnknown"),
    set.source ? t("kayit.umDevice", { device: set.source }) : null,
    t("kayit.umMeasured", { time: at === null ? "—" : dayStamp(at, nowMs) }),
  ].filter(Boolean);
  return (
    <>
      <b className="block font-data text-15 font-bold text-ink">{t("kayit.umNumber", { number: set.received_key })}</b>
      <span className="block text-12.5 text-mute">{facts.join(" · ")}</span>
    </>
  );
}

function RejectDialog({ set, onReject, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const countId = useId();
  const introId = useId();
  const count = reason.trim().length;
  const short = count < REJECT_MIN_REASON_CHARS;
  const subject = t("kayit.umSubject", { number: set.received_key });

  async function confirm(event) {
    if ((event?.detail ?? 0) > 1 || short || sending.current) return;
    sending.current = true;
    setBusy(true);
    let close = true;
    try {
      const answer = await onReject(reason.trim());
      if (answer !== null) toast(t("kayit.umRejected", { subject }));
    } catch (err) {
      if (err?.superseded) return;
      toast(t("kayit.umRejectRefused", { subject, reason: err?.status === 403 ? t("kayit.noRight") : apiErrorText(t, err) }), "error");
      close = err?.apiCode !== "reading_reason_length";      // a reason the engine finds wrong keeps the dialog
    } finally {
      sending.current = false;
      setBusy(false);
    }
    if (close) onClose();
  }

  return (
    <Modal
      open title={t("kayit.umRejectTitle", { number: set.received_key })} onClose={onClose} busy={busy}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p id={countId} className="m-0 mr-auto text-12 font-semibold text-mute">
            {t("kayit.correctCount", { count, min: REJECT_MIN_REASON_CHARS })}
          </p>
          <div className="ml-auto flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
            <Button variant="danger" onClick={confirm} busy={busy} aria-disabled={short ? "true" : undefined} aria-describedby={countId}>
              {t("kayit.umRejectConfirm")}
            </Button>
          </div>
        </div>
      )}
    >
      <form noValidate onSubmit={(event) => { event.preventDefault(); confirm(); }}>
        <SetValues set={set} />
        <Note tone="warn" icon="alert" className="mt-2"><span id={introId}>{t("kayit.umRejectIntro")}</span></Note>
        <div className="mt-3">
          <Field label={t("kayit.correctReason")} layout="col" required>
            <Input autoFocus autoComplete="off" maxLength={REJECT_MAX_REASON_CHARS} value={reason} readOnly={busy}
              onChange={(event) => setReason(event.target.value)} aria-describedby={introId} />
          </Field>
        </div>
      </form>
      <Announce text={busy ? t("kayit.saving") : ""} />
    </Modal>
  );
}

/** `patients` is the page's own list (the board, ordered by bed), `nowMs` its clock, `known` whether the board may
 *  be spoken of as current; `onBack` returns to the page's first step. */
export function UnmatchedStep({ patients, nowMs, known, onBack }) {
  const { t } = useI18n();
  const board = useBoard();
  const toast = useToast();
  const { sets, phase, error, reload } = useUnmatched();
  // { name: "list" } | { name: "pick", set } | { name: "confirm", set, id, bed }
  const [view, setView] = useState({ name: "list" });
  const [rejecting, setRejecting] = useState(null);
  const [linking, setLinking] = useState(false);
  const sending = useRef(false);
  const target = view.name === "confirm" ? patients.find((p) => p.patient_id === view.id) ?? null : null;

  async function link() {
    if (sending.current) return;
    sending.current = true;
    setLinking(true);
    const subject = view.bed;
    try {
      const answer = await board.store.assignReadings(idsOf(view.set), view.id);
      if (answer !== null) toast(t("kayit.umLinked", { subject }));
    } catch (err) {
      if (!err?.superseded) {
        if (mayHaveLanded(err)) toast(t("kayit.umLinkMayHaveLanded", { subject }), "warn");
        else toast(t("kayit.umLinkRefused", { subject, reason: err?.status === 403 ? t("kayit.noRight") : apiErrorText(t, err) }), "error");
      }
    } finally {
      sending.current = false;
      setLinking(false);
    }
    // Every ending reads the list again and goes back to it: the set is gone, or another desk got there first.
    await reload();
    setView({ name: "list" });
  }

  if (view.name === "pick") {
    return (
      <>
        <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("kayit.umPickTitle")}</h2>
        <div className="mb-2 rounded-box border border-line bg-card px-4 py-3">
          <SetFacts set={view.set} nowMs={nowMs} />
          <SetValues set={view.set} />
        </div>
        <PickList patients={patients} nowMs={nowMs} known={known}
          onPick={(p) => setView({ name: "confirm", set: view.set, id: p.patient_id, bed: bedOf(p) })} />
        <div className="mt-3"><Button icon="chevL" onClick={() => setView({ name: "list" })}>{t("kayit.umBack")}</Button></div>
      </>
    );
  }
  if (view.name === "confirm" && target) {
    return (
      <IdentityStep patient={target} busy={linking} onYes={link} onNo={() => setView({ name: "list" })}
        title={t("kayit.umConfirmTitle")} ask={t("kayit.umConfirmAsk")} yes={t("kayit.umConfirmYes")} no={t("kayit.umConfirmNo")}>
        <div className="mt-3 border-t border-line pt-2">
          <SetFacts set={view.set} nowMs={nowMs} />
          <SetValues set={view.set} />
        </div>
        <Announce text={linking ? t("kayit.umLinking") : ""} />
      </IdentityStep>
    );
  }
  return (
    <Box title={t("kayit.umTitle")} icon="link" level={2}>
      <p className="m-0 mb-2 text-12.5 text-mute">{t("kayit.umIntro")}</p>
      {error ? <Note tone="warn" icon="alert" className="mb-2">{t("kayit.umReadFailed", { reason: readErrorText(t, error) })}</Note> : null}
      {phase === "loading" ? <p className="m-0 text-13 text-mute">{t("kayit.umReading")}</p> : null}
      {phase === "known" && sets.length === 0 ? <p className="m-0 text-13 text-mute">{t("kayit.umEmpty")}</p> : null}
      {sets.length > 0 ? (
        // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
        <ul role="list" className="m-0 list-none p-0">
          {sets.map((set) => (
            <li key={keyOf(set)} data-um-set={set.received_key} className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <SetFacts set={set} nowMs={nowMs} />
                <SetValues set={set} />
                {set.linkable === true ? null : <span className="mt-1 block text-12 font-semibold text-mute">{t("kayit.umTooOld")}</span>}
              </span>
              <span className="flex shrink-0 flex-wrap gap-2">
                {set.linkable === true ? (
                  <Button variant="primary" icon="link" onClick={() => setView({ name: "pick", set })}>{t("kayit.umLink")}</Button>
                ) : null}
                <Button variant="ghost" icon="x" onClick={() => setRejecting(set)}>{t("kayit.umReject")}</Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3"><Button icon="chevL" onClick={onBack}>{t("kayit.umBack")}</Button></div>
      {rejecting ? (
        <RejectDialog
          set={rejecting}
          onReject={(reason) => board.store.rejectReadings(idsOf(rejecting), reason)}
          onClose={() => { setRejecting(null); reload(); }}
        />
      ) : null}
    </Box>
  );
}
