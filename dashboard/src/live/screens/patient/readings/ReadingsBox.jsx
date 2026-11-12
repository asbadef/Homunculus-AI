// src/live/screens/patient/readings/ReadingsBox.jsx — the patient screen's «Ölçüm kaydı» box (G3-05 D2, D16): what
// was measured in this stay, and by what — as the engine's record holds it (GET /patients/{id}/readings).
//
// WHAT IT PRINTS is the engine's, value for value: one row per measurement set, the newest first, over the window
// chosen (24 hours, 72 hours, 7 days); the set's time, its source — «cihaz · {device}» or «elle · {user}» — and
// «alındı {time}» where the engine marks the arrival as late (`received_late`; the box compares no two times). Each
// value is named and written as the bedside form names and writes it (vitalsFields.js); a code that form does not
// know is printed as the engine sent it. A WITHDRAWN value stays, struck through, with its reason, who and when
// (Q3): nothing measured ever disappears from this box. No score, no colour and no judgement lives here. When the
// engine's read of the window stopped at its limit (`truncated`), a neutral line says the oldest sets are not shown.
//
// WHAT IT WRITES, for a `clinical.chart` holder only — absent otherwise, never a disabled button: «Düzelt» on each
// value of the bedside set that is not withdrawn and that the engine can address (`entry`), in CorrectDialog.jsx.
// After any ending of that dialog the box reads again, and tells the screen that a value moved (`onWritten`); the
// screen has the SOFA box and the trend cards read again (PatientScreen.jsx) — the box reads itself, never twice.
//
// The shell keeps the patient screen mounted across a move to another patient (no `key`), so the box remembers
// WHOSE dialog it opened: one opened on a patient is never shown on the next (the fluid box's rule).
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../../i18n/dates.js";
import { numberText } from "../../../i18n/numbers.js";
import { readErrorText } from "../../../apiErrors.js";
import { useBoard } from "../../../data/BoardProvider.jsx";
import { Box, Button, Note, Seg } from "../../../ui/index.js";
import { isBedsideCode, specOf, valueText } from "../../bedside/vitalsFields.js";
import { CorrectDialog } from "./CorrectDialog.jsx";
import { READINGS_WINDOWS, useReadings } from "./useReadings.js";

const WINDOW_KEY = Object.freeze({ 24: "kayit.w24", 72: "kayit.w72", 168: "kayit.w168" });

const timeOf = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : null;
};

/** A set's source as the reader meets it: «cihaz · CONNEX-3A» or «elle · hem.ayse» — the bare word when the engine
 *  holds no device name or no person. */
export function sourceText(t, origin, source, recordedBy) {
  if (origin === "manual") {
    return recordedBy ? t("kayit.sourceHand", { user: recordedBy }) : t("kayit.sourceHandUnnamed");
  }
  return source ? t("kayit.sourceDevice", { device: source }) : t("kayit.sourceDeviceUnnamed");
}

/** A value's name and text: the bedside form's own for a code it knows; else the engine's code and number. The trend
 *  table's «Düzelt» dialog names a value with this too, so the dialog reads the same from either screen. */
export function wordsOf(t, lang, reading) {
  const spec = specOf(reading.code);
  if (spec) return { label: t(spec.labelKey), value: valueText(t, reading.code, reading.value, lang) };
  const number = typeof reading.value === "number" ? numberText(lang, reading.value) : "—";
  return { label: String(reading.code ?? "—"), value: [number, reading.unit].filter(Boolean).join(" ") };
}

function Reading({ reading, nowMs, onCorrect }) {
  const { t, lang } = useI18n();
  const id = useId();
  const { label, value } = wordsOf(t, lang, reading);
  const voided = reading.voided && typeof reading.voided === "object" ? reading.voided : null;
  const voidedAt = voided ? timeOf(voided.at) : null;
  const offer = onCorrect && !voided && Number.isInteger(reading.entry) && isBedsideCode(reading.code);
  return (
    <li data-reading={reading.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
      <span id={id} className="min-w-0 flex-1 text-13.5">
        <span className="font-semibold text-mute">{label}</span>{" "}
        {voided ? <s className="font-data">{value}</s> : <b className="font-data">{value}</b>}
        {voided ? (
          <span className="ml-2 text-12 text-mute">
            {t("kayit.voided", { reason: String(voided.reason ?? ""), who: String(voided.by ?? ""),
              time: voidedAt === null ? "—" : dayStamp(voidedAt, nowMs) })}
          </span>
        ) : null}
      </span>
      {offer ? (
        // The name stays «Düzelt»; the value's own words tell the buttons apart for a screen reader.
        <Button size="sm" variant="ghost" icon="edit" aria-describedby={id} onClick={() => onCorrect(reading, label, value)}>
          {t("kayit.correct")}
        </Button>
      ) : null}
    </li>
  );
}

function Sets({ data, nowMs, onCorrect }) {
  const { t } = useI18n();
  if (data.sets.length === 0) return <p className="m-0 text-13 text-mute">{t("kayit.empty")}</p>;
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" className="m-0 list-none p-0">
      {data.sets.map((set) => {
        const at = timeOf(set.observed_at);
        const received = timeOf(set.received_at);
        const source = sourceText(t, set.origin, set.source, set.recorded_by);
        return (
          <li key={`${set.observed_at}|${set.origin}|${set.source}|${set.recorded_by ?? ""}`} data-set={set.origin}
            className="border-b border-line py-2 last:border-b-0">
            <p className="m-0 text-12.5">
              <b className="font-data text-ink">{at === null ? "—" : dayStamp(at, nowMs)}</b>
              {" · "}<span className="font-semibold text-mute">{source}</span>
              {set.received_late === true && received !== null ? (
                <>{" · "}<span className="text-mute">{t("kayit.received", { time: dayStamp(received, nowMs) })}</span></>
              ) : null}
            </p>
            <ul role="list" className="m-0 mt-0.5 list-none p-0">
              {(Array.isArray(set.readings) ? set.readings : []).map((reading) => (
                <Reading key={reading.id} reading={reading} nowMs={nowMs}
                  onCorrect={onCorrect ? (r, label, value) => onCorrect(set, r, label, value, source) : null} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** `patientId` is whose record this is; `bed` names the patient in the dialog and on its toasts (never the
 *  patient's name, Decision 14); `nowMs` is the screen's clock; `canChart` (`clinical.chart`) offers «Düzelt» —
 *  absent otherwise. `onWritten(patientId)` tells the screen a value moved (it has the SOFA box and the trend cards
 *  re-read; this box has already read again itself).
 *  `reread` is `{ id, n }`: the screen's word that a write made elsewhere on it (a withdrawal or a corrected device
 *  reading in the trend table) landed for patient `id` — the record reads again, as the fluid box's `reread`. */
export function ReadingsBox({ patientId, bed, nowMs = Date.now(), canChart = false, onWritten, reread = null }) {
  const { t } = useI18n();
  const board = useBoard();
  const [hours, setHours] = useState(24);
  const { data, error, refresh } = useReadings(patientId, hours);
  // Read again after a write elsewhere on the screen for THIS patient. Not on mount, not for one count twice.
  const seenReread = useRef(reread?.n ?? 0);
  useEffect(() => {
    const n = reread?.n ?? 0;
    if (n === seenReread.current) return;
    seenReread.current = n;
    if (reread.id === patientId) refresh();
  }, [reread?.n]);
  // `{ id, what, entry }`: the value whose «Düzelt» is open, and whose patient it is.
  const [correcting, setCorrecting] = useState(null);
  useEffect(() => { setCorrecting(null); }, [patientId]);
  const open = correcting && correcting.id === patientId ? correcting : null;
  const windows = (
    <Seg label={t("kayit.windowLabel")} value={hours} onChange={setHours}
      options={READINGS_WINDOWS.map((h) => ({ value: h, label: t(WINDOW_KEY[h]) }))} />
  );
  return (
    <Box title={t("kayit.title")} icon="list" level={2} right={windows}>
      <p className="m-0 mb-2 text-11.5 text-mute">{t("kayit.intro")}</p>
      {/* A failed read keeps the last record and says so beside it — a static note: a read once a minute must not
          interrupt a screen reader each time it fails. */}
      {error ? <Note tone="warn" icon="alert" className="mb-2">{t("kayit.readFailed", { reason: readErrorText(t, error) })}</Note> : null}
      {data ? (
        <Sets data={data} nowMs={nowMs}
          onCorrect={canChart ? (set, reading, label, value, source) => setCorrecting({
            id: patientId, entry: reading.entry,
            what: { code: reading.code, label, value, source, observedMs: timeOf(set.observed_at),
              time: timeOf(set.observed_at) === null ? "—" : dayStamp(timeOf(set.observed_at), nowMs) },
          }) : null} />
      ) : error ? null : <p className="m-0 text-13 text-mute">{t("kayit.reading")}</p>}
      {/* The engine's read stopped at its limit (`truncated`, final review minor 7): the oldest sets of the window are
          not in the answer. Said where they would be, in neutral words — it describes the list, not the patient. */}
      {data?.truncated === true ? (
        <p data-readings-truncated="" className="m-0 mt-2 text-12 text-mute">{t("kayit.recordTruncated")}</p>
      ) : null}
      {open ? (
        <CorrectDialog
          bed={bed} what={open.what} nowMs={nowMs}
          onRetract={(reason) => board.store.retract(open.id, open.entry, reason)}
          onChart={(entries, at) => board.store.chart(open.id, entries, at)}
          // Every ending re-reads: the record may have changed even when the answer never came.
          onDone={() => {
            onWritten?.(open.id);
            refresh();
          }}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
    </Box>
  );
}
