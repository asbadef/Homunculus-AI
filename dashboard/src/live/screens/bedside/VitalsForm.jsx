// src/live/screens/bedside/VitalsForm.jsx — the bedside set's form (G3-01, D2–D8): eight boxes in the prototype's
// order, the time, «Önizle» and, on a fresh preview, «Kaydet». One form for both doors (D3): the «Yatak başı
// ölçüm» page (BedsideScreen.jsx) and the patient screen's «Ölçüm gir» dialog (patient/VitalsEntry.jsx). It is
// not a dialog itself; its host binds the writes to the patient.
//
// WHAT IT SENDS. Only what was entered (D4): an empty box is «ölçülmedi», never 0, and is not sent. The time is
// the clock's until she types one, and an untouched time is not sent at all (X12): the server stamps its own
// clock, so a tablet whose clock runs ahead never charts in the future. A typed time goes up to 24 h back and
// never ahead (D7). Everything in ONE request with one time (D5), through `onSave` — the board store's `chart`.
//
// THE PREVIEW FIRST (D8). «Kaydet» is offered only on a preview of exactly what would be sent now: change a box
// and the preview is old until it is asked again. «Kaydet» appears where «Önizle» stood, so for SAVE_ARM_MS each
// time it appears (a preview landing, or an edit undone) it ignores a press, and it always ignores a double
// click's second one (the SOFA form's rule, SIGN_ARM_MS). The preview is the engine's (PreviewPanel.jsx); nothing is scored here (Decision 1). A
// discharged number previews as `dropped`, and nothing is offered to save.
//
// THE SERVER IS AUTHORITATIVE (D6). The browser mirrors the door's slip bounds only to hold a slipped digit back,
// under its box, with the focus taken to the first one. What it lets through is the engine's to refuse, and the
// engine's sentence is what she reads: on the toast, named after the bed. A write with no answer may have landed
// (`mayHaveLanded`): she is told to look before entering it again, and the form is left (`onCancel`), so a second
// press cannot chart it twice. A 403 leaves the form too. A store that dropped its answer (null: the session
// ended) says nothing. `busy` holds the buttons (never `disabled`); `sending` ignores a press that beats the
// re-render.
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { apiErrorText, readErrorText } from "../../apiErrors.js";
import { Announce, Button, Field, Icon, Input, Seg, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { useNow } from "../common/useNow.js";
import { PreviewPanel } from "./PreviewPanel.jsx";
import { VITALS, checkDraft, draftKey, hasErrors, oldestInput, stepValue, toLocalInput } from "./vitalsFields.js";

/** How long «Kaydet» ignores a press after it appeared where «Önizle» stood (the SOFA form's 600 ms). */
export const SAVE_ARM_MS = 600;
/** How often an untouched time follows the clock: the field shows minutes. */
const CLOCK_MS = 60_000;
/** The order a held press takes the focus in: the counted boxes, then the time. */
const ORDER = [...VITALS.filter((s) => s.kind === "number").map((s) => s.code), "at"];

/** Is this answer to «Önizle» really a preview? It says so and carries a NEWS2 with a total. */
const isPreview = (answer) => answer?.preview === true && typeof answer?.news2?.total === "number";

/** What was saved, for the saved step: each sent value with the `chart` row the door answered for it, in request
 *  order (D10: the id a «hatalı giriş» names). A row the answer does not pair with its code has none to name —
 *  an engine older than G3-01 answers no `entries`. The time is the one sent, or the press's for an untouched one. */
export function savedOf(asked, answer, pressMs) {
  const ids = Array.isArray(answer?.entries) ? answer.entries : [];
  return {
    atMs: asked.recordedAt ? Date.parse(asked.recordedAt) : pressMs,
    rows: asked.entries.map((e, i) => {
      const id = ids[i];
      return { ...e, entry: id?.code === e.code && Number.isInteger(id?.entry) ? id.entry : null };
    }),
  };
}

/** The problem under a box, as Field draws it: critical ink, an icon, the reader's sentence. */
function Problem({ id, text }) {
  return (
    <p id={id} className="m-0 mt-1 flex items-start gap-1.5 text-12 font-semibold text-crit-ink">
      <Icon name="alert" size={14} className="mt-px" />
      <span>{text}</span>
    </p>
  );
}

/** One counted value: its label and unit, a − and a + beside the box (D3: tablet first, the prototype's large
 *  buttons), the problem under it. Labelled here rather than with <Field>, which labels its ONE child: the
 *  steppers share the input's row. A stepper never invents a first value (stepValue). */
function NumberBox({ spec, value, error, busy, onChange, inputRef }) {
  const { t } = useI18n();
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = spec.hintKey ? `${id}-hint` : undefined;
  const label = t(spec.labelKey);
  const step = (direction) => {
    const next = stepValue(spec, value, direction);
    if (next !== null) onChange(next);
  };
  return (
    <div className="mb-3" data-vital={spec.code}>
      <label htmlFor={id} className="mb-1.5 block font-text text-13.5 font-semibold text-mute">
        {label} <span className="font-normal">({t(spec.unitKey)})</span>
      </label>
      <div className="flex items-center gap-2">
        <Button size="lg" icon="minus" label={t("olcum.minus", { label })} onClick={() => step(-1)} busy={busy} />
        <Input
          ref={inputRef} id={id} inputMode={spec.whole ? "numeric" : "decimal"} autoComplete="off"
          className="text-center font-data text-17" value={value} placeholder={t("olcum.notMeasured")}
          onChange={(event) => onChange(event.target.value)} readOnly={busy}
          aria-invalid={error ? "true" : undefined} aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        />
        <Button size="lg" icon="plus" label={t("olcum.plus", { label })} onClick={() => step(1)} busy={busy} />
      </div>
      {error ? <Problem id={errorId} text={error} /> : null}
      {spec.hintKey ? <p id={hintId} className="m-0 mt-1 text-12 text-mute">{t(spec.hintKey)}</p> : null}
    </div>
  );
}

/** One charted choice (ek oksijen, bilinç) as the house Seg, «ölçülmedi» its first option: pressing the chosen
 *  option does nothing (Seg), so «not measured» has to be an option to go back to. A choice is always one of
 *  its values, so it has no problem to show. */
function ChoiceBox({ spec, value, busy, onChange }) {
  const { t } = useI18n();
  const options = [{ value: "", label: t("olcum.notMeasured") },
    ...spec.options.map((o) => ({ value: o.value, label: t(o.labelKey) }))];
  return (
    <div className="mb-3" data-vital={spec.code}>
      <p className="m-0 mb-1.5 font-text text-13.5 font-semibold text-mute">{t(spec.labelKey)}</p>
      <Seg label={t(spec.labelKey)} value={value} options={options} className="flex-wrap"
        onChange={(next) => { if (!busy) onChange(next); }} />
    </div>
  );
}

/** `bed` names the patient on every toast. `onPreview(entries, recordedAt)` and `onSave(entries, recordedAt)`
 *  are the writes, bound to the patient by the host; each resolves to the API's answer, or null when the store
 *  dropped it. `onSaved(saved)` gets `savedOf`'s rows; `onCancel()` leaves the form (also after a write that may
 *  have landed, and after a 403). `onBusy(busy)` tells a host dialog a request is in flight. `nowMs` is the
 *  screen's clock (the server's), for the preview's ages. */
export function VitalsForm({ bed, nowMs, onPreview, onSave, onSaved, onCancel, onBusy }) {
  const { t } = useI18n();
  const toast = useToast();
  const [values, setValues] = useState({});            // code -> what is in the box, as typed
  const [at, setAt] = useState("");                    // the typed time, once she has typed one
  const [atTouched, setAtTouched] = useState(false);
  const [tried, setTried] = useState(false);           // a press was held: problems are shown from now on
  const [busy, setBusy] = useState(null);              // "preview" | "save": the request in flight
  const [preview, setPreview] = useState(null);        // { key, answer }: the preview's answer, keyed by what it was asked
  const [said, setSaid] = useState("");                // spoken once: a preview landed, and «Kaydet» appeared
  const [arming, setArming] = useState(false);         // «Kaydet» just appeared: held for SAVE_ARM_MS
  const armed = useRef(true);                          // false inside the arming window, read by the press itself
  const armTimer = useRef(null);
  const sending = useRef(false);
  const mounted = useRef(false);
  const inputs = useRef({});
  const noteId = useId();
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(armTimer.current);
    };
  }, []);
  // A request in flight is said to the host, and its end is said by the cleanup: a save's answer clears `busy` in
  // the same render in which the host swaps the form for its saved step, and an effect of a form that is gone
  // never runs, so "no longer busy" must not wait for one.
  useEffect(() => {
    if (busy === null || !onBusy) return undefined;
    onBusy(true);
    return () => onBusy(false);
  }, [busy, onBusy]);
  // Re-rendered on the clock while the form is open, so an untouched time shows the minute it is.
  useNow(CLOCK_MS);
  const now = Date.now();
  const draftAt = (ms) => ({ values, at: atTouched ? at : toLocalInput(ms), atTouched });
  const checked = checkDraft(draftAt(now), now);
  // A held box leaves `checked.entries`, so the key alone would call a preview fresh while a box shows a problem.
  const fresh = preview !== null && !hasErrors(checked) && preview.key === draftKey(checked);
  const dropped = fresh && preview.answer.dropped === true;
  const offerSave = fresh && !dropped;
  const errorOf = (code) => (tried && checked.errors[code] ? t(checked.errors[code].key, checked.errors[code].params) : undefined);
  const formError = tried && checked.errors.form ? t(checked.errors.form.key) : "";
  let say = formError;
  if (!say && preview !== null && !fresh) say = t("olcum.previewOld");
  else if (!say && !fresh) say = t("olcum.previewFirst");
  const keep = (code) => (el) => { inputs.current[code] = el; };
  const set = (code) => (value) => setValues((current) => ({ ...current, [code]: value }));

  /** Hold «Kaydet» for SAVE_ARM_MS: it has just appeared where «Önizle» stood. */
  function arm() {
    clearTimeout(armTimer.current);
    armed.current = false;
    setArming(true);
    armTimer.current = setTimeout(() => {
      armed.current = true;
      if (mounted.current) setArming(false);
    }, SAVE_ARM_MS);
  }
  // Every time «Kaydet» appears, not only when a preview lands: an edit undone ("92" back to "91") makes the
  // preview fresh again and brings «Kaydet» back where «Önizle» stood. A layout effect, so the hold is in place
  // before the browser paints the button.
  useLayoutEffect(() => {
    if (offerSave) arm();
  }, [offerSave]);

  /** The draft as of the press: an untouched time is the press's own. A held one shows its problems under their
   *  boxes and takes the focus to the first (flushSync: the problem must be in the DOM, tied to its box, when
   *  the focus arrives). Returns the checked draft, or null. */
  function pressed() {
    const ms = Date.now();
    const result = checkDraft(draftAt(ms), ms);
    if (hasErrors(result)) {
      flushSync(() => setTried(true));
      const first = ORDER.find((code) => result.errors[code]);
      if (first) inputs.current[first]?.focus();
      // No box to take the focus to (nothing entered): the sentence beside the buttons is spoken instead.
      else if (result.errors.form) setSaid(t(result.errors.form.key));
      return null;
    }
    setTried(true);
    return result;
  }

  /** «Önizle» (D8): the preview route, which writes nothing. Its failure is a read's (`readErrorText`): nothing
   *  was written, so nothing "may have landed". Any outcome that is not a preview lets the earlier one go. */
  async function previewIt() {
    // A dropped preview holds «Önizle» (aria-disabled): the number is discharged, and asking again changes nothing.
    if (sending.current || busy || dropped) return;
    const asked = pressed();
    if (!asked) return;
    sending.current = true;
    setBusy("preview");
    // The earlier preview's sentence goes now: a re-preview that fails must not speak an old NEWS2 again.
    setSaid("");
    let done = null;   // { say: [text, tone], leave } once the request is settled
    try {
      const answer = await onPreview(asked.entries, asked.recordedAt);
      if (answer === null || !mounted.current) return;   // the store dropped it: the session ended
      if (answer?.dropped) {
        setPreview({ key: draftKey(asked), answer: { dropped: true } });
        setSaid(t("olcum.previewDropped"));
      } else if (isPreview(answer)) {
        setPreview({ key: draftKey(asked), answer });
        setSaid(t("olcum.previewed", { total: answer.news2.total }));
      } else {
        setPreview(null);
        done = { say: [t("olcum.previewRefused", { subject: bed, reason: t("olcum.previewNotPreview") }), "error"], leave: false };
      }
    } catch (err) {
      if (err?.superseded) return;   // a superseded session: nothing is said into the one that replaced it
      // A form that is gone: a read wrote nothing, and its host has already moved on.
      if (!mounted.current) return;
      setPreview(null);
      const forbidden = err?.status === 403;
      const reason = forbidden ? t("olcum.noRight") : readErrorText(t, err);
      done = { say: [t("olcum.previewRefused", { subject: bed, reason }), "error"], leave: forbidden };
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    if (!done) return;
    toast(...done.say);
    if (done.leave) onCancel();
  }

  /** «Kaydet»: the same values the fresh preview was asked with, in one request (D5). Not inside the arming
   *  window, and never a double click's second press. */
  async function saveIt(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current) return;
    if (sending.current || busy || !offerSave) return;
    const asked = pressed();
    if (!asked || draftKey(asked) !== preview.key) return;
    sending.current = true;
    setBusy("save");
    const pressMs = Date.now();
    let done;          // { say: [text, tone], saved?, leave? } once the write is settled
    try {
      const answer = await onSave(asked.entries, asked.recordedAt);
      if (answer === null) return;   // the store dropped it: the session ended
      done = answer?.dropped
        ? { say: [t("olcum.savedDropped", { subject: bed }), "warn"], leave: true }
        : { say: [t("olcum.savedToast", { subject: bed })], saved: savedOf(asked, answer, pressMs) };
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        done = { say: [t("olcum.savedMayHaveLanded", { subject: bed }), "warn"], leave: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? t("olcum.noRight") : apiErrorText(t, err);
        done = { say: [t("olcum.savedRefused", { subject: bed, reason }), "error"], leave: forbidden };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    // Out of the `try`: a host callback that throws must never turn a write the engine took into "not saved". The
    // toast is said even when the form is gone (a write's outcome outlives the screen); the host is called back
    // only while it still shows the form.
    toast(...done.say);
    if (!mounted.current) return;
    if (done.saved) onSaved(done.saved);
    else if (done.leave) onCancel();
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); if (offerSave) saveIt(); else previewIt(); }}>
      <div className="grid gap-x-4 min-[640px]:grid-cols-2">
        {VITALS.map((spec) => (spec.kind === "number" ? (
          <NumberBox key={spec.code} spec={spec} value={values[spec.code] ?? ""} error={errorOf(spec.code)}
            busy={busy !== null} onChange={set(spec.code)} inputRef={keep(spec.code)} />
        ) : (
          <ChoiceBox key={spec.code} spec={spec} value={values[spec.code] ?? ""} busy={busy !== null} onChange={set(spec.code)} />
        )))}
      </div>
      <Field label={t("olcum.at")} hint={t("olcum.atHint")} layout="col" error={errorOf("at")}>
        <Input
          ref={keep("at")} type="datetime-local" min={oldestInput(now)} max={toLocalInput(now)}
          value={atTouched ? at : toLocalInput(now)} readOnly={busy !== null}
          onChange={(event) => { setAtTouched(true); setAt(event.target.value); }}
        />
      </Field>
      {fresh ? <PreviewPanel answer={preview.answer} nowMs={nowMs} /> : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {say ? (
          <p id={noteId} className={`m-0 mr-auto min-w-0 flex-[1_1_14rem] text-12 font-semibold ${formError ? "text-att-ink" : "text-mute"}`}>{say}</p>
        ) : null}
        {/* The two buttons are one flex item: on a phone the pair wraps as a pair, under the sentence. */}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button size="lg" variant="ghost" onClick={onCancel} busy={busy !== null}>{t("olcum.back")}</Button>
          {offerSave ? (
            <Button size="lg" variant="primary" onClick={saveIt} busy={busy !== null} aria-disabled={arming ? "true" : undefined}>
              {t("common.save")}
            </Button>
          ) : (
            <Button size="lg" type="submit" variant="primary" busy={busy !== null}
              aria-disabled={dropped ? "true" : undefined} aria-describedby={say ? noteId : undefined}>
              {t("olcum.preview")}
            </Button>
          )}
        </div>
      </div>
      <Announce text={busy === "preview" ? t("olcum.previewing") : busy === "save" ? t("olcum.saving") : said} />
    </form>
  );
}
