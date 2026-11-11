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
// have got there first. A link or a rejection with no answer may have landed: she is told where to look.
//
// THE QUESTION'S PATIENT may leave the board while it is asked (discharged, out of scope): as on the page's own
// identity step, the step says so and goes back to the list; on a board that is not LIVE the question waits, since
// that list is old, not empty. A link goes back to the list BEFORE the list is read again, and a rejection holds its
// dialog until it has been — a second press in between would send a second write. A set the engine has taken is left
// out of the old answer meanwhile (and if that read fails), so that it cannot be linked a second time; the next answer
// is the engine's word, whatever it says. Each view takes the focus when it opens, on its heading, so a keyboard and a
// screen reader follow the step.
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { numberText } from "../../i18n/numbers.js";
import { apiErrorKey, apiErrorText, readErrorText } from "../../apiErrors.js";
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

/** A refused link or rejection in the reader's words. A 403 is the missing right to link or reject
 *  (`kayit.noRightLink`) — not the correction's «noRight» — except the engine's own person-only refusal (a device
 *  credential names no actor), which keeps its sentence: it says why, and no right of hers would mend it. */
const refusedText = (t, err) => (
  err?.status === 403 && apiErrorKey(err)?.key !== "kayit.err.person" ? t("kayit.noRightLink") : apiErrorText(t, err)
);

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

/** `onReject(reason)` writes; `onDone(taken)` reads the list again and closes the dialog — resolved, so that the rejected
 *  set leaves the screen together with it — and is told whether the engine took the rejection; `onClose()` only closes
 *  (Cancel, Escape). */
function RejectDialog({ set, onReject, onDone, onClose }) {
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
    let taken = false;
    try {
      const answer = await onReject(reason.trim());
      if (answer !== null) {
        taken = true;
        toast(t("kayit.umRejected", { subject }));
      }
    } catch (err) {
      if (err?.superseded) close = false;       // its session is gone: nothing is said into the one that replaced it
      else {
        if (mayHaveLanded(err)) toast(t("kayit.umRejectMayHaveLanded", { subject }), "warn");
        else toast(t("kayit.umRejectRefused", { subject, reason: refusedText(t, err) }), "error");
        close = err?.apiCode !== "reading_reason_length";      // a reason the engine finds wrong keeps the dialog
      }
    }
    // The guards are held until the list has been read again: a second press in between sends nothing.
    try {
      if (close) await onDone(taken);
    } finally {
      sending.current = false;
      setBusy(false);
    }
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
  // The sets the engine has just taken (a link, a rejection), left out of the answer they came with until a read
  // replaces that answer: the old list must not offer a second link on them while the next read is out. `base` is the
  // answer they were taken from, so a replaced answer (the engine's word) shows whatever it says.
  const [taken, setTaken] = useState(null);       // { base, ids } | null
  const latest = useRef(sets);
  latest.current = sets;
  // `base` is read when the call is made (not when React gets to the update): the answer the write was made against.
  const take = (ids, base = latest.current) => setTaken((prev) => (
    { base, ids: prev?.base === base ? [...prev.ids, ...ids] : ids }
  ));
  const shown = taken && taken.base === sets
    ? sets.filter((set) => { const ids = idsOf(set); return !(ids.length > 0 && ids.every((id) => taken.ids.includes(id))); })
    : sets;
  // { name: "list", gone? } | { name: "pick", set } | { name: "confirm", set, id }: `gone` is the notice that the
  // patient chosen to link to left the board, and belongs to the list it was raised for.
  const [view, setView] = useState({ name: "list" });
  const [rejecting, setRejecting] = useState(null);
  const [linking, setLinking] = useState(false);
  const sending = useRef(false);
  const root = useRef(null);
  const seen = useRef(view.name);
  const target = view.name === "confirm" ? patients.find((p) => p.patient_id === view.id) ?? null : null;

  // The patient may leave a LIVE board under the open question: say so and go back to the list (BedsideScreen's rule
  // for its identity step). Not while the link is out — its own answer is what is said then.
  useEffect(() => {
    if (view.name === "confirm" && known && !target && !linking) setView({ name: "list", gone: true });
  }, [view.name, known, target, linking]);

  // Only a CHANGE of view moves the focus, to the new view's heading: the step opening is the page's to follow.
  useEffect(() => {
    if (seen.current === view.name) return;
    seen.current = view.name;
    const heading = root.current?.querySelector("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.classList.add("outline-none");
      heading.focus();
    }
  }, [view.name]);

  async function link() {
    if (sending.current || !target) return;
    sending.current = true;
    setLinking(true);
    const subject = bedOf(target);
    const ids = idsOf(view.set);
    try {
      const answer = await board.store.assignReadings(ids, view.id);
      if (answer !== null) {
        take(ids);       // the engine took it: it is not offered again while the list is read
        toast(t("kayit.umLinked", { subject }));
      }
    } catch (err) {
      if (!err?.superseded) {
        if (mayHaveLanded(err)) toast(t("kayit.umLinkMayHaveLanded", { subject }), "warn");
        else toast(t("kayit.umLinkRefused", { subject, reason: refusedText(t, err) }), "error");
      }
    } finally {
      sending.current = false;
      setLinking(false);
    }
    // Every ending goes back to the list FIRST and then reads it again: the identity question must not stay on screen,
    // enabled, while that read is out. The set is gone, or another desk got there first.
    setView({ name: "list" });
    reload();
  }

  let body;
  if (view.name === "pick") {
    body = (
      <>
        <h2 className="m-0 mb-2 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("kayit.umPickTitle")}</h2>
        <div className="mb-2 rounded-box border border-line bg-card px-4 py-3">
          <SetFacts set={view.set} nowMs={nowMs} />
          <SetValues set={view.set} />
        </div>
        <PickList patients={patients} nowMs={nowMs} known={known}
          onPick={(p) => setView({ name: "confirm", set: view.set, id: p.patient_id })} />
        <div className="mt-3"><Button icon="chevL" onClick={() => setView({ name: "list" })}>{t("kayit.umBack")}</Button></div>
      </>
    );
  } else if (view.name === "confirm") {
    // No patient to ask about (the board is not LIVE, or the effect above is about to leave): nothing, not the list.
    body = target ? (
      <IdentityStep patient={target} busy={linking} onYes={link} onNo={() => setView({ name: "list" })}
        title={t("kayit.umConfirmTitle")} ask={t("kayit.umConfirmAsk")} yes={t("kayit.umConfirmYes")} no={t("kayit.umConfirmNo")}>
        <div className="mt-3 border-t border-line pt-2">
          <SetFacts set={view.set} nowMs={nowMs} />
          <SetValues set={view.set} />
        </div>
        <Announce text={linking ? t("kayit.umLinking") : ""} />
      </IdentityStep>
    ) : null;
  } else {
    body = (
      <Box title={t("kayit.umTitle")} icon="link" level={2}>
        <p className="m-0 mb-2 text-12.5 text-mute">{t("kayit.umIntro")}</p>
        {view.gone ? <Note tone="warn" icon="alert" className="mb-2">{t("olcum.gone")}</Note> : null}
        {/* The Note is a static aside: said here as well, politely, so a screen reader hears why the question closed. */}
        <Announce text={view.gone ? t("olcum.gone") : ""} />
        {error ? <Note tone="warn" icon="alert" className="mb-2">{t("kayit.umReadFailed", { reason: readErrorText(t, error) })}</Note> : null}
        {phase === "loading" ? <p className="m-0 text-13 text-mute">{t("kayit.umReading")}</p> : null}
        {phase === "known" && shown.length === 0 ? <p className="m-0 text-13 text-mute">{t("kayit.umEmpty")}</p> : null}
        {shown.length > 0 ? (
          // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
          <ul role="list" className="m-0 list-none p-0">
            {shown.map((set) => (
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
            onDone={async (done) => {
              // The answer the rejection was made against, kept before the read: only a read that REPLACES it can bring
              // the set back — a render that lands meanwhile cannot. The set leaves with the dialog, after the read.
              const base = latest.current;
              await reload();
              if (done) take(idsOf(rejecting), base);      // the engine took it, whether or not that read answered
              setRejecting(null);
            }}
            onClose={() => setRejecting(null)}
          />
        ) : null}
      </Box>
    );
  }
  return <div ref={root}>{body}</div>;
}
