// src/live/screens/patient/sofa/SofaFormModal.jsx — the SOFA severity form, read from the engine, completed,
// corrected, previewed and signed (G2-A4, D2, D3, D5, D6).
//
// WHAT IT SHOWS (D2) is the engine's form, word for word: six organ rows in the source table's order, each with
// the worst value of the window, its unit, when it was measured (the reader's clock, with its day when it is not
// today's, X5), where it came from and its points; «ölçülmedi» for an organ with no measurement — never a 0,
// although the score counts it as one; the organ-failure mark where the engine says `failure`; the window, and,
// when the patient has been here for less than it (`covers_full_window` false), that the form rests on the
// shorter stay. Under the renal row: urine output is not scored here (D8). Under the cardiovascular row: MAP
// comes from the record and is not entered here, the pressors come from the Meds box (D9). Under the
// respiration row: what charted support changes. The browser scores nothing (Decision 1): every point, total
// and failure mark is the engine's.
//
// WHAT IT WRITES. A `clinical.chart` holder completes a row (D3, SofaEditors.jsx `ChartEntry`): one measurement
// through POST /clinical/{id}, and the form is read again — the engine re-scores, never this screen. A
// `scores.sign` holder corrects a measured value (D5, `CorrectionEntry`); the corrections are held here, unsent,
// until «Önizle» asks the engine what a signature would seal (D6) — on the preview route, which writes nothing
// and can never sign (review 2, C1). «İmzala» is offered only on a preview of exactly the corrections held now —
// change one and the preview is stale until it is asked again (X12) — and sends the same list with the
// preview's fingerprint, `expect` (C2): the engine signs only the record that preview scored. If anything under
// the form moved in between it answers 409 and signs nothing: the preview is let go, the form read again, and
// that is said. «İmzala» appears where «Önizle» stood, so for SIGN_ARM_MS after a preview it is held
// (aria-disabled), and the second press of a double click is never a press: a double click on «Önizle» must not
// sign. A signature whose total, organ points or value under a correction (the engine reads each `original` at
// signing) still differ from the preview's is said as such (X11) — a second line behind the 409. Against an
// engine that sends no `min_reason_chars` — one older than G2-A4 — nothing is corrected, previewed or signed
// (X13); one without the preview route (404, 405) refuses the preview, which is said, and nothing is offered to
// sign (C1). An answer to «Önizle» is shown as a preview only when it says it is one and carries its
// fingerprint. One that says it was SIGNED is said, and the box reads its signature again; any other shape is a
// refused preview. Each control is ABSENT without its right, never disabled, and a sentence says why.
//
// THE REFUSALS are the house's (admin/refusal.js, meds/MedsChartForm.jsx): on the toast, named after the bed —
// and, D10, the same sentence in the footer as plain text, which is no live region, so the refusal is announced
// once (X4). The footer says the last outcome BESIDE the standing note — why a control is absent, or what
// signing needs first — never instead of it. A 403 for a missing right (the engine's permission sentence, or a
// bare 403) is said as "no right", never with the permission key; any other 403 (a device, a scope) in the
// engine's own words. On a preview or a signature a 403 closes the form. A write with no answer may have landed (`mayHaveLanded`): a measurement reads the form again, a
// signature closes the form and the box reads its last signature again. A preview writes nothing, so its failure
// is a read's (`readErrorText`); a preview that lands is announced, since nothing else says it. Closing with
// corrections held drops them, and the toast says so. Nothing here alerts, rings or notifies (D10).
//
// THE PATIENT IS FIXED AT OPENING: `api` is bound to it by the box (SofaBox.jsx), so a write in flight stays with
// its patient when the screen moves on; the box closes this dialog for another patient.
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { apiErrorKey, apiErrorText, readErrorText } from "../../../apiErrors.js";
import { Announce, Button, Modal, Note, StatusPill, useToast } from "../../../ui/index.js";
import { mayHaveLanded } from "../../admin/refusal.js";
import { ChartEntry, CorrectionEntry } from "./SofaEditors.jsx";
import {
  correctionsKey, isEnterable, labelOf, overridesOf, recordedOf, rowsInOrder, sourceText, stampOf,
} from "./sofaFields.js";

/** How long «İmzala» is held after a preview: it appears where «Önizle» stood, and a double click's second press
 *  comes well inside this (measured in Chrome on a dialog of the same shape). */
export const SIGN_ARM_MS = 600;

/** The fingerprint a preview gives the record it scored (review 2, C2): 64 lowercase hex, as the engine writes it. */
const FINGERPRINT = /^[0-9a-f]{64}$/;

/** Is this answer to «Önizle» really a preview? It says so — not signed, with a form and a total — and carries
 *  the fingerprint a signature of it must send back (C2). The preview route never signs (C1); an answer that
 *  says it did, or any other shape, is not shown as a preview (X13), and without a fingerprint there is
 *  nothing to sign. */
const isPreview = (answer) => answer?.preview === true && answer.signed === false
  && answer.form !== null && typeof answer.form === "object" && Number.isInteger(answer.total)
  && typeof answer.expect === "string" && FINGERPRINT.test(answer.expect);

/** A server that does not know the preview route (C1): an engine older than it answers 404 — FastAPI's own
 *  "Not Found", or no sentence at all — or 405 there, and signs nothing. A 404 in the engine's own words,
 *  "hasta bulunamadı" (the patient is not, or no longer, in her scope), is that refusal, said as such. */
function unknownRoute(err) {
  if (err?.status === 405) return true;
  return err?.status === 404 && apiErrorKey(err)?.key !== "errors.patientNotFound";
}

/** What the record held under an answer, as one string: each correction's `original` by code (the engine reads
 *  it from the record when it scores) and each organ's points. A preview and its signature agree on this only
 *  when the record did not move between them (X11). */
function recordUnder(answer) {
  const originals = {};
  for (const o of Array.isArray(answer?.overrides) ? answer.overrides : []) {
    if (o && typeof o.code === "string") originals[o.code] = o.original ?? null;
  }
  const points = {};
  for (const row of Array.isArray(answer?.form?.rows) ? answer.form.rows : []) {
    if (row && typeof row.organ === "string") points[row.organ] = row.points ?? null;
  }
  const sorted = (table) => Object.keys(table).sort().map((k) => [k, table[k]]);
  return JSON.stringify([sorted(originals), sorted(points)]);
}

/** A total as the engine sent it, or a dash: never a number it did not send. */
const totalOf = (n) => (Number.isInteger(n) ? n : "—");

/** The engine's permission refusal, as `_require` writes it (api/app.py): case-sensitive, as written. */
const PERMISSION_REFUSAL = /^permission required: /;

/** A 403's reason. A missing right, as the engine's permission sentence or a bare 403, is said in the form's
 *  own words (`noRightKey`, "this account has no right to …"), never as the raw permission key in brackets —
 *  a key such as "scores.sign" is an administrator's word, not a clinician's. Any other refusal — a scope's,
 *  a device's ("skor formunu yalnız bir kişi imzalayabilir") — is the engine's, in the reader's words through
 *  the house mapping: the form's sentence would say less, or something false. */
function forbiddenReason(t, err, noRightKey) {
  const text = typeof err?.message === "string" ? err.message.trim() : "";
  const noRight = text === "" || PERMISSION_REFUSAL.test(text) || apiErrorKey(err)?.key === "errors.requestFailed";
  return noRight ? t(noRightKey) : apiErrorText(t, err);
}

/** The window line (D2): the engine's hours and bounds — or, when the patient has been here for less than the
 *  window (`covers_full_window` false), that the form rests on the shorter stay. */
function windowLine(t, form, nowMs) {
  const stamp = (iso) => stampOf(iso, nowMs) || "—";
  return form.covers_full_window === false
    ? t("sofa.windowShort", { hours: form.window_hours, to: stamp(form.window_to) })
    : t("sofa.windowFull", { hours: form.window_hours, from: stamp(form.window_from), to: stamp(form.window_to) });
}

/** One input as the engine sent it: the value or «ölçülmedi», the unit, the time and the source, and what is
 *  unusual about it — a value from before the window, a value corrected in a preview, a correction held here.
 *  `children` are the controls her rights give her. */
function Cell({ cell, nowMs, held, children }) {
  const { t } = useI18n();
  const { label, unit } = labelOf(t, cell.code);
  const meta = [cell.measured ? stampOf(cell.at, nowMs) : "", sourceText(t, cell.source)].filter(Boolean).join(" · ");
  return (
    <div data-sofa-cell={cell.code} className="mt-1.5">
      <p className="m-0 text-13">
        <span className="font-semibold">{label}</span>{": "}
        {cell.measured ? (
          <><b className="font-data">{String(cell.value)}</b>{unit ? ` ${unit}` : ""}</>
        ) : (
          <span className="italic text-mute">{t("sofa.unmeasured")}</span>
        )}
        {meta ? <span className="text-11.5 text-mute">{` · ${meta}`}</span> : null}
      </p>
      {cell.outside_window ? <p className="m-0 text-11.5 font-semibold text-att-ink">{t("sofa.outsideWindow")}</p> : null}
      {cell.overridden ? <p className="m-0 text-11.5 font-semibold text-att-ink">{t("sofa.corrected", { original: cell.original ?? "—" })}</p> : null}
      {held ? <p className="m-0 text-11.5 font-semibold text-att-ink">{t("sofa.heldLine", { value: held.value, unit })}</p> : null}
      {children}
    </div>
  );
}

/** One organ: its name as a heading, the engine's points or «ölçülmedi», and the failure mark where the engine
 *  set it (D2) — never computed here from the points. */
function OrganRow({ entry, children }) {
  const { t } = useI18n();
  const { row } = entry;
  return (
    <li data-sofa-organ={entry.organ} className="rounded-box border border-line bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-text text-13.5 font-bold">{t(entry.labelKey)}</h3>
        <span className="font-data text-13 font-bold">{row.measured ? t("sofa.points", { points: row.points }) : t("sofa.unmeasured")}</span>
        {row.failure ? <StatusPill tone="crit" icon="alert">{t("sofa.failure")}</StatusPill> : null}
      </div>
      {children}
    </li>
  );
}

/** `bed` names the patient in the title and on every toast; `api` is `{ read, chart(entries, recordedAt),
 *  preview(overrides), sign(overrides, expect) }`, bound to the patient by the box; `canChart` / `canSign` are
 *  her rights; `nowMs` the screen's clock (the reader's "today"). `onClose(changed)` — `changed` says that
 *  something was written, so the box reads its form again. */
export function SofaFormModal({ bed, nowMs = Date.now(), canChart, canSign, api, onClose }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState(null);              // the engine's form as last read
  const [readError, setReadError] = useState(null);
  const [reading, setReading] = useState(true);
  const [corrections, setCorrections] = useState({});  // code -> { value, reason }: held until the preview (D5)
  const [preview, setPreview] = useState(null);        // { key, answer }: the engine's answer to `preview: true`
  const [editing, setEditing] = useState(null);        // { kind: "chart" | "correct", code }: one editor at a time
  const [busy, setBusy] = useState(null);              // "chart" | "preview" | "sign": the request in flight
  const [said, setSaid] = useState(null);              // { text, warn }: the footer's sentence for the last outcome
  const [arming, setArming] = useState(false);         // «İmzala» just appeared: held for SIGN_ARM_MS
  const footerId = useId();
  const changed = useRef(false);                       // something was written: the box reads its form again
  const sending = useRef(false);                       // a second press that beats the re-render is ignored
  const reads = useRef(0);                             // only the newest read lands
  const buttons = useRef({});                          // `${kind}:${code}` -> the button an editor gives focus back to
  const armed = useRef(true);                          // false inside the arming window, read by the press itself
  const armTimer = useRef(null);
  const editingNow = useRef(null);                     // `editing` as last rendered, for an answer that lands late
  const mounted = useRef(false);
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(armTimer.current);
    };
  }, []);

  /** Hold «İmzala» for SIGN_ARM_MS: it has just appeared where «Önizle» stood. */
  function arm() {
    clearTimeout(armTimer.current);
    armed.current = false;
    setArming(true);
    armTimer.current = setTimeout(() => {
      armed.current = true;
      if (mounted.current) setArming(false);
    }, SIGN_ARM_MS);
  }

  async function read() {
    const mine = ++reads.current;
    setReading(true);
    try {
      const answer = await api.read();
      if (!mounted.current || mine !== reads.current) return;
      setForm(answer ?? null);
      setReadError(null);
    } catch (err) {
      if (err?.superseded || !mounted.current || mine !== reads.current) return;
      setReadError(err);
    } finally {
      if (mounted.current && mine === reads.current) setReading(false);
    }
  }
  // Read once per opening (X9): the box keys this dialog by its opening, so a new opening is a new read.
  useEffect(() => { read(); }, []);

  const key = correctionsKey(corrections);
  const fresh = preview !== null && preview.key === key;
  const shown = fresh ? preview.answer.form : form;
  // The engine's reason length. An engine older than G2-A4 sends none, and it can neither preview nor say
  // how long a reason must be: no correction, preview or signature is offered against it (X13).
  const minReason = Number.isInteger(form?.min_reason_chars) ? form.min_reason_chars : null;
  const signable = canSign && minReason !== null;
  const label = (code) => labelOf(t, code).label;
  const heldOf = (code) => (Object.prototype.hasOwnProperty.call(corrections, code) ? corrections[code] : null);
  const keepButton = (kind, code) => (el) => { buttons.current[`${kind}:${code}`] = el; };
  // The editor open now, for an answer that lands after she opened another one.
  editingNow.current = editing;

  /** Escape, ✕, the backdrop or «Kapat»: never held up, but corrections held and not signed are dropped with
   *  the dialog, and the toast says so. */
  function close() {
    if (Object.keys(corrections).length > 0) toast(t("sofa.heldDropped", { subject: bed }), "warn");
    onClose(changed.current);
  }

  function openEditor(next) {
    setSaid(null);
    setEditing(next);
  }
  /** Close THIS editor — the one of `kind` for `code`, if it is still the one open — and give the focus back to
   *  the button that opened it, which stays on the row. An editor she opened since is hers: a chart that lands
   *  late neither closes it nor takes its focus. */
  function closeEditor(kind, code) {
    const open = editingNow.current;
    if (open?.kind !== kind || open?.code !== code) return;
    editingNow.current = null;
    setEditing(null);
    buttons.current[`${kind}:${code}`]?.focus();
  }

  /** Complete a row (D3): one measurement through the door, then the form again — the engine re-scores it. A
   *  preview of the old record is let go: it is no longer what a signature would seal. */
  async function chartOne(code, value, recordedAt) {
    if (sending.current) return;
    sending.current = true;
    setBusy("chart");
    let done;
    try {
      const answer = await api.chart([{ code, value }], recordedAt);
      changed.current = true;
      done = answer?.dropped
        ? { text: t("sofa.chartDropped", { subject: bed }), tone: "warn", close: true, reread: false }
        : { text: t("sofa.chartSaved", { subject: bed, input: label(code) }), tone: "ok", close: true, reread: true };
    } catch (err) {
      // A superseded session is gone: nothing is said about it into the one that replaced it.
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        changed.current = true;
        done = { text: t("sofa.chartMayHaveLanded", { subject: bed }), tone: "warn", close: true, reread: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? forbiddenReason(t, err, "sofa.chartNoRight") : apiErrorText(t, err);
        done = { text: t("sofa.chartRefused", { subject: bed, reason }), tone: "error", close: forbidden, reread: false };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    // Out of the `try`: the toast outlives this dialog, and is said whatever the screen does next.
    toast(done.text, done.tone);
    if (!mounted.current) return;
    setSaid({ text: done.text, warn: done.tone !== "ok" });
    if (done.close) closeEditor("chart", code);
    if (done.reread) {
      setPreview(null);
      await read();
    }
  }

  /** Hold a correction (D5). Nothing is sent; the preview scores it. */
  function keep(code, correction) {
    setCorrections((current) => ({ ...current, [code]: correction }));
    closeEditor("correct", code);
    setSaid({ text: t("sofa.held", { input: label(code) }), warn: false });
  }
  /** Let a held correction go. The button that removed it goes with it: the focus goes to «Düzelt» on the
   *  same input. */
  function drop(code) {
    setCorrections((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
    setEditing((current) => (current?.code === code ? null : current));
    setSaid(null);
    buttons.current[`correct:${code}`]?.focus();
  }

  /** «Önizle» (D6): the engine's answer to the corrections held now, signed by nobody and written nowhere. A
   *  failure is a read's: nothing was written, so nothing "may have landed"; a server without the preview
   *  route says so in the form's words (C1). The answer is a preview only when it says so and carries its
   *  fingerprint (X13, C2): one that says it SIGNED — which the preview route never does — is a signature in
   *  the record, said as such, and the box reads its last signature again; any other shape is a refused
   *  preview, never something to sign. */
  async function previewIt() {
    if (sending.current) return;
    sending.current = true;
    setBusy("preview");
    const asked = corrections;
    let done;
    try {
      const answer = await api.preview(overridesOf(asked));
      if (!answer) return;                             // the session ended: nothing is said into the next one
      if (answer.signed === true) {
        changed.current = true;
        done = { text: t("sofa.previewSigned", { subject: bed }), tone: "warn", close: true };
      } else if (isPreview(answer)) {
        if (!mounted.current) return;
        setPreview({ key: correctionsKey(asked), answer });
        arm();
        // Spoken too: no toast says a preview landed, and «İmzala» has just appeared.
        setSaid({ text: t("sofa.previewed", { total: answer.total }), warn: false, spoken: true });
        return;
      } else {
        done = { text: t("sofa.previewRefused", { subject: bed, reason: t("sofa.previewNotPreview") }), tone: "error", close: false };
      }
    } catch (err) {
      if (err?.superseded) return;
      // A 403 here is a signature's 403 (the preview keeps every refusal of signing, X3), and closes alike.
      const forbidden = err?.status === 403;
      let reason;
      if (forbidden) reason = forbiddenReason(t, err, "sofa.signNoRight");
      else if (unknownRoute(err)) reason = t("sofa.previewUnsupported");
      else reason = readErrorText(t, err);
      done = { text: t("sofa.previewRefused", { subject: bed, reason }), tone: "error", close: forbidden };
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    toast(done.text, done.tone);
    if (mounted.current) setSaid({ text: done.text, warn: true });
    if (done.close) onClose(changed.current);
  }

  /** «İmzala» (D6): the same corrections the fresh preview was asked with, and its fingerprint (C2). Not
   *  inside the arming window, and never the second press of a double click (`detail` > 1): «İmzala»
   *  appeared where «Önizle» stood. If the record moved since the preview — another desk charted, the window
   *  slid — the engine answers 409 and signs nothing: the preview is let go and the form read again, her
   *  corrections kept to be previewed anew, and nothing is marked as changed. Should a signature still differ
   *  from its preview — the total, an organ's points, the value under a correction — that is said (X11). */
  async function signIt(event) {
    if ((event?.detail ?? 0) > 1 || !armed.current) return;
    if (sending.current || !fresh) return;
    sending.current = true;
    setBusy("sign");
    const asked = preview.answer;
    const previewed = asked.total;
    let done;
    try {
      const answer = await api.sign(overridesOf(corrections), asked.expect);
      changed.current = true;
      // A total the engine did not send is never claimed: the box's signature line is where it is read.
      const total = Number.isInteger(answer?.total) ? answer.total : null;
      if (total === null) {
        done = { text: t("sofa.signedNoTotal", { subject: bed }), tone: "warn", close: true };
      } else if (total !== previewed) {
        done = { text: t("sofa.signedDiffers", { subject: bed, total, previewed }), tone: "warn", close: true };
      } else if (recordUnder(answer) !== recordUnder(asked)) {
        done = { text: t("sofa.signedRecordMoved", { subject: bed, total }), tone: "warn", close: true };
      } else {
        done = { text: t("sofa.signedToast", { subject: bed, total }), tone: "ok", close: true };
      }
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        changed.current = true;
        done = { text: t("sofa.signMayHaveLanded", { subject: bed }), tone: "warn", close: true };
      } else if (err?.status === 409) {
        // C2: the record is no longer the one the preview scored. Nothing was signed, so nothing changed.
        done = { text: t("sofa.recordMovedResign", { subject: bed }), tone: "warn", close: false, reread: true };
      } else {
        const forbidden = err?.status === 403;
        const reason = forbidden ? forbiddenReason(t, err, "sofa.signNoRight") : apiErrorText(t, err);
        done = { text: t("sofa.signRefused", { subject: bed, reason }), tone: "error", close: forbidden };
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(null);
    }
    toast(done.text, done.tone);
    if (done.close) {
      onClose(changed.current);
      return;
    }
    if (!mounted.current) return;
    setSaid({ text: done.text, warn: true });
    if (done.reread) {
      setPreview(null);
      await read();
    }
  }

  /** The controls her rights give her on one cell: «Ölçüm gir» for the six inputs the form takes (D3; MAP and
   *  the pressors are not entered here, D9), «Düzelt» for a measured value (D5), and «Düzeltmeyi kaldır» for a
   *  correction held. They stay on the row while an editor is open under it, so the focus can come back. */
  function actionsFor(cell) {
    const { code } = cell;
    const kind = editing?.code === code ? editing.kind : null;
    const held = heldOf(code);
    const enterable = canChart && isEnterable(code);
    const correctable = signable && cell.measured === true;
    const name = label(code);
    return (
      <>
        {enterable || correctable ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {enterable ? (
              <Button ref={keepButton("chart", code)} size="sm" icon="plus" aria-expanded={kind === "chart"}
                aria-label={t("sofa.enterFor", { input: name })} onClick={() => openEditor({ kind: "chart", code })}>
                {t("sofa.enter")}
              </Button>
            ) : null}
            {correctable ? (
              <Button ref={keepButton("correct", code)} size="sm" icon="edit" aria-expanded={kind === "correct"}
                aria-label={t(held ? "sofa.correctEditFor" : "sofa.correctFor", { input: name })}
                onClick={() => openEditor({ kind: "correct", code })}>
                {t(held ? "sofa.correctEdit" : "sofa.correct")}
              </Button>
            ) : null}
            {held ? (
              <Button size="sm" variant="ghost" icon="x" aria-label={t("sofa.dropFor", { input: name })} onClick={() => drop(code)}>
                {t("sofa.drop")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {kind === "chart" ? (
          <ChartEntry code={code} busy={busy === "chart"} onCancel={() => closeEditor("chart", code)}
            onSave={(value, recordedAt) => chartOne(code, value, recordedAt)} />
        ) : null}
        {kind === "correct" ? (
          <CorrectionEntry code={code} recorded={recordedOf(form, code)} minReason={minReason} initial={held}
            onCancel={() => closeEditor("correct", code)} onKeep={(correction) => keep(code, correction)} />
        ) : null}
      </>
    );
  }

  // Respiratory support (D4) is no cell of the form — it decides which PaO₂/FiO₂ bands apply — so it is charted
  // from under the respiration row, by a `clinical.chart` holder only.
  const supportOpen = editing?.code === "on_resp_support";
  const support = canChart ? (
    <div data-sofa-cell="on_resp_support" className="mt-1.5">
      <p className="m-0 text-13 font-semibold">{label("on_resp_support")}</p>
      <Button ref={keepButton("chart", "on_resp_support")} size="sm" icon="plus" className="mt-1" aria-expanded={supportOpen}
        onClick={() => openEditor({ kind: "chart", code: "on_resp_support" })}>
        {t("sofa.supportChart")}
      </Button>
      {supportOpen ? (
        <ChartEntry code="on_resp_support" busy={busy === "chart"} onCancel={() => closeEditor("chart", "on_resp_support")}
          onSave={(value, recordedAt) => chartOne("on_resp_support", value, recordedAt)} />
      ) : null}
    </div>
  ) : null;

  const heldCodes = Object.keys(corrections);
  let body;
  if (shown) {
    body = (
      <>
        <Note tone="info" icon="clip">{t("sofa.intro")}</Note>
        {readError ? <Note tone="warn" icon="alert" className="mt-2">{t("sofa.rereadFailed", { reason: readErrorText(t, readError) })}</Note> : null}
        <p className="m-0 mt-2 text-12.5 text-mute">{windowLine(t, shown, nowMs)}</p>
        <p className="m-0 mt-1 font-display text-17 font-bold">
          {fresh
            ? t("sofa.totalPreview", { total: preview.answer.total, auto: totalOf(preview.answer.auto_total) })
            : t("sofa.total", { total: totalOf(shown.total) })}
        </p>
        {!canChart ? <p className="m-0 mt-1 text-12 text-mute">{t("sofa.chartNoRightNote")}</p> : null}
        {/* role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver. */}
        <ol role="list" className="m-0 mt-2.5 grid list-none gap-2 p-0">
          {rowsInOrder(shown).map((entry) => (
            <OrganRow key={entry.organ} entry={entry}>
              {(Array.isArray(entry.row.inputs) ? entry.row.inputs : []).map((cell) => (
                <Cell key={cell.code} cell={cell} nowMs={nowMs} held={heldOf(cell.code)}>{actionsFor(cell)}</Cell>
              ))}
              {entry.organ === "respiration" ? support : null}
              {entry.noteKey ? <p className="m-0 mt-1.5 text-11.5 text-mute">{t(entry.noteKey)}</p> : null}
            </OrganRow>
          ))}
        </ol>
        {heldCodes.length > 0 ? (
          <section className="mt-3">
            <h3 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("sofa.heldTitle")}</h3>
            <ul role="list" className="m-0 mt-1 list-none p-0 text-12.5">
              {heldCodes.map((code) => (
                <li key={code}>
                  {t("sofa.heldItem", { input: label(code), original: recordedOf(form, code) ?? "—", value: corrections[code].value, reason: corrections[code].reason })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </>
    );
  } else if (reading) {
    body = <p className="m-0 text-13 text-mute">{t("sofa.reading")}</p>;
  } else {
    body = (
      <div>
        <p className="m-0 text-13 font-semibold text-att-ink">
          {readError ? t("sofa.unreadable", { reason: readErrorText(t, readError) }) : t("sofa.noForm")}
        </p>
        <Button size="sm" className="mt-2" onClick={read}>{t("sofa.retry")}</Button>
      </div>
    );
  }

  // The footer: the last outcome, and BESIDE it the standing note — why she cannot sign, or what signing needs
  // first — so an absent control never loses its explanation to an outcome. Plain text, not a live region (X4):
  // the toast is what announces.
  let standing = null;
  if (shown) {
    if (!canSign) standing = { text: t("sofa.signNoRightNote"), warn: false };
    else if (minReason === null) standing = { text: t("sofa.signOldEngine"), warn: true };
    else if (preview !== null && !fresh) standing = { text: t("sofa.previewStale"), warn: true };
    else if (!fresh) standing = { text: t("sofa.previewFirst"), warn: false };
  }
  const footer = [said, standing].filter(Boolean);
  const describedBy = footer.length > 0 ? footerId : undefined;
  const busyText = busy === "chart" ? t("sofa.saving") : busy === "preview" ? t("sofa.previewing") : busy === "sign" ? t("sofa.signing") : "";

  return (
    <Modal
      open title={`${t("sofa.title")} · ${bed}`} onClose={close} busy={busy !== null}
      actions={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {footer.length > 0 ? (
            <div id={footerId} data-sofa-footer="" className="mr-auto min-w-0 flex-[1_1_14rem] text-12 font-semibold">
              {footer.map((line) => (
                <p key={line.text} className={`m-0 ${line.warn ? "text-att-ink" : "text-mute"}`}>{line.text}</p>
              ))}
            </div>
          ) : null}
          {/* The buttons are one flex item: on a phone they wrap as a group, under the sentence. */}
          <div className="ml-auto flex shrink-0 flex-wrap gap-2">
            <Button variant="ghost" onClick={close} busy={busy !== null}>{t("common.close")}</Button>
            {signable && shown ? (
              <Button icon="eye" onClick={previewIt} busy={busy !== null} aria-describedby={describedBy}>
                {t("sofa.preview")}
              </Button>
            ) : null}
            {signable && fresh ? (
              <Button variant="primary" icon="ok" onClick={signIt} busy={busy !== null} aria-disabled={arming ? "true" : undefined}
                aria-describedby={describedBy}>
                {t("sofa.sign")}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    >
      {body}
      {/* A busy Button reads only "unavailable" to a screen reader; what is happening is said once, here — and
          so is a preview that landed, which no toast says. */}
      <Announce text={busyText || (said?.spoken ? said.text : "")} />
    </Modal>
  );
}
