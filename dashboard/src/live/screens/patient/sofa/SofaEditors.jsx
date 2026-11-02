// src/live/screens/patient/sofa/SofaEditors.jsx — the SOFA form's two small editors, each opened under the row
// it belongs to (G2-A4). They hold a draft and say what is wrong with it, in the reader's words under the
// field, with the focus taken there; the WRITE is the form's (SofaFormModal.jsx), which owns the request, the
// toast and the read that follows.
//
// COMPLETING (D3) — `ChartEntry`, for a `clinical.chart` holder: one new measurement of an input the form
// takes, with its measurement time — the support flag too: the engine scores each PaO₂/FiO₂ reading on the
// support in force at its own time (the last support entry at or before it) and the row shows the reading that
// scores the most points (D13), so an entry counts only for readings at or after its time, and a «no» timed
// before a reading takes that reading off support. It is a measurement, not a correction, so it asks for no
// reason; it goes through the door every charted value goes through (POST /clinical/{id}), and the engine
// scores it. The time field is the Meds form's (meds/MedsChartForm.jsx, final review I2; X8): it shows NOW
// until she edits it — it follows the clock (`useNow`, once a minute) — and a time she types goes up to 24 h
// back, never ahead. Unlike the Meds form, an untouched time is not sent (review 2): the server stamps the
// measurement with its own clock, so a browser clock ahead of the server's cannot chart it in the future, out
// of the read that follows. The one exception is the support entry when the row has a measured ratio
// (review 3, S-2): its time starts at that reading's (`defaultAt`), said under the field, and is sent — chart
// the ratio, then «evet», both untouched, and the support counts for that ratio rather than starting after it.
//
// CORRECTING (D5) — `CorrectionEntry`, for a `scores.sign` holder and a MEASURED input only: the value it
// should have been, and why. The reason is counted live against the engine's own `min_reason_chars`, so the
// bar is seen before it is reached; the count is read with the field, not announced on every key. Nothing is
// sent: the form holds the correction until «Önizle», where the engine re-scores the row. Points are never
// asked for — a clinician corrects the value, never the score.
//
// Both mirror the door's bounds only to hold a slipped digit back (sofaFields.js); anything they let through
// is the engine's to refuse, in its own words.
import React, { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Button, Field, Input, Select } from "../../../ui/index.js";
import { useNow } from "../../common/useNow.js";
import { dayStamp } from "../../../i18n/dates.js";
import {
  BACKDATE_MS, checkInstant, checkTime, checkValue, isFlag, labelOf, reasonCount, toLocalInput,
} from "./sofaFields.js";

/** How often an untouched measurement time is moved on to the clock: the field shows minutes. */
const CLOCK_MS = 60_000;
const PANEL = "mt-2 rounded-ctl border border-line2 bg-card2 px-3 py-2.5";

/** A label with its unit in brackets (D11: the unit is in the label as well as beside the value). */
const withUnit = (label, unit) => (unit ? <>{label} <span className="font-normal">({unit})</span></> : label);

/** One new measurement of `code` (D3). `onSave(value, recordedAt)` is the form's write — `recordedAt` the
 *  time she typed, the reading's (`defaultAt`), or null for an untouched time (the server's clock): the form
 *  closes this editor once the write is settled as a save and leaves it open — the draft kept — on a refusal.
 *  `busy` is the form's: a request is in flight, a preview's too, and the fields and the Save are held still,
 *  visibly. `defaultAt` (review 3, S-2) is the instant (ISO) the time starts from instead of the clock — the
 *  form passes the respiration row's reading for the support entry only — taken when it is within the 24-hour
 *  rule as the editor opens, and held to that rule again at the press; outside it, the time is the clock's. */
export function ChartEntry({ code, busy, onSave, onCancel, defaultAt = null }) {
  const { t } = useI18n();
  const { label, unit } = labelOf(t, code);
  const flag = isFlag(code);
  const [value, setValue] = useState("");
  const [at, setAt] = useState("");
  // False until she edits the time: until then the time is the clock's — or the reading's — not a value of the draft.
  const [atTouched, setAtTouched] = useState(false);
  // The reading's instant, decided once as the editor opens: what is shown is what is sent, or refused.
  const [fromReading] = useState(() => {
    const ms = typeof defaultAt === "string" ? Date.parse(defaultAt) : Number.NaN;
    return checkInstant(ms, Date.now()).error ? null : ms;
  });
  const [tried, setTried] = useState(false);
  const valueRef = useRef(null);
  const atRef = useRef(null);
  useNow(CLOCK_MS);                         // re-rendered on the clock, so an untouched time moves on
  const now = Date.now();
  const shownAt = atTouched ? at : toLocalInput(fromReading ?? now);
  const say = (error) => (error ? t(error.key, error.params) : undefined);
  /** The draft's time as it would be sent at `nowMs`: hers, the reading's, or none (the server's clock). */
  const timedAt = (nowMs) => {
    if (atTouched) return checkTime(at, nowMs);
    if (fromReading !== null) return checkInstant(fromReading, nowMs);
    return { recordedAt: null };
  };
  const valueError = tried ? say(checkValue(code, value).error) : undefined;
  const atError = tried ? say(timedAt(now).error) : undefined;
  const atHint = fromReading === null ? t("sofa.atHint") : (
    <>
      {t("sofa.atHint")}
      <span className="block">{t("sofa.supportAtHint", { time: dayStamp(fromReading, now) })}</span>
    </>
  );

  function save(event) {
    event.preventDefault();
    if (busy) return;
    // Checked again at the press. An untouched time is sent as none (`null`): the server stamps the
    // measurement with ITS clock (review 2) — this browser's, if ahead of the server's, would chart it in the
    // future, missing from the read that follows. A time she typed is hers, and is sent; so is the reading's
    // a support entry starts from (S-2), while it is still within 24 hours.
    const checked = checkValue(code, value);
    const timed = timedAt(Date.now());
    if (checked.error || timed.error) {
      // The error is in the DOM, tied to its field, when the focus arrives there.
      flushSync(() => setTried(true));
      (checked.error ? valueRef : atRef).current?.focus();
      return;
    }
    onSave(checked.value, timed.recordedAt);
  }

  return (
    <form noValidate onSubmit={save} aria-label={t("sofa.enterTitle", { input: label })} className={PANEL}>
      {flag ? (
        <Field label={label} hint={t("sofa.supportHint")} layout="col" error={valueError}>
          {/* A select cannot be read-only: it is disabled while the write is in flight, as the Meds form's is. */}
          <Select ref={valueRef} autoFocus value={value} onChange={(e) => setValue(e.target.value)} disabled={busy}>
            <option value="">{t("sofa.supportNone")}</option>
            <option value="1">{t("sofa.supportYes")}</option>
            <option value="0">{t("sofa.supportNo")}</option>
          </Select>
        </Field>
      ) : (
        <Field label={withUnit(label, unit)} layout="col" error={valueError}>
          <Input ref={valueRef} autoFocus inputMode="decimal" autoComplete="off" value={value}
            onChange={(e) => setValue(e.target.value)} readOnly={busy} />
        </Field>
      )}
      <Field label={t("sofa.at")} hint={atHint} layout="col" error={atError}>
        <Input
          ref={atRef} type="datetime-local" min={toLocalInput(now - BACKDATE_MS)} max={toLocalInput(now)}
          value={shownAt} onChange={(e) => { setAtTouched(true); setAt(e.target.value); }} readOnly={busy}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} busy={busy}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" size="sm" busy={busy}>{t("common.save")}</Button>
      </div>
    </form>
  );
}

/** A correction of a measured input (D5): the value the record should have held and why, kept by the form
 *  until the preview. `recorded` is what the record holds (sofaFields.js `recordedOf`); `minReason` the
 *  engine's `min_reason_chars`; `initial` a correction already held for this input, to change.
 *  `onKeep({ value, reason })` receives the trimmed reason. */
export function CorrectionEntry({ code, recorded, minReason, initial, onKeep, onCancel }) {
  const { t } = useI18n();
  const { label, unit } = labelOf(t, code);
  const [value, setValue] = useState(initial ? String(initial.value) : "");
  const [reason, setReason] = useState(initial ? initial.reason : "");
  const [tried, setTried] = useState(false);
  const valueRef = useRef(null);
  const reasonRef = useRef(null);
  const counterId = useId();
  const count = reasonCount(reason);
  const short = count < minReason;
  const checked = checkValue(code, value);
  const valueError = tried && checked.error ? t(checked.error.key, checked.error.params) : undefined;

  function keep(event) {
    event.preventDefault();
    // Checked again at the press, from the draft as it is now.
    const pressed = checkValue(code, value);
    if (pressed.error || reasonCount(reason) < minReason) {
      flushSync(() => setTried(true));
      (pressed.error ? valueRef : reasonRef).current?.focus();
      return;
    }
    onKeep({ value: pressed.value, reason: reason.trim() });
  }

  return (
    <form noValidate onSubmit={keep} aria-label={t("sofa.correctTitle", { input: label })} className={PANEL}>
      <p className="m-0 mb-2 text-12 text-mute">{t("sofa.correctIntro", { value: recorded ?? "—", unit })}</p>
      <Field label={withUnit(t("sofa.correctValue"), unit)} layout="col" error={valueError}>
        <Input ref={valueRef} autoFocus inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label={t("sofa.reason")} hint={t("sofa.reasonHint", { min: minReason })} layout="col"
        error={tried && short ? t("sofa.reasonShort", { min: minReason }) : undefined}>
        {/* The count is read with the field (aria-describedby), not announced on every key: a live region
            counting keystrokes would talk over the clinician typing her reason. */}
        <Input ref={reasonRef} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={counterId} />
      </Field>
      <p id={counterId} className={`m-0 -mt-1 mb-2.5 text-12 font-semibold ${short ? "text-att-ink" : "text-mute"}`}>
        {t("sofa.reasonCount", { count, min: minReason })}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" size="sm">{t("sofa.keep")}</Button>
      </div>
    </form>
  );
}
