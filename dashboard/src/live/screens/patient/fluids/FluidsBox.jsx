// src/live/screens/patient/fluids/FluidsBox.jsx — the patient screen's «Sıvı» box (G3-03 D7–D12): the nurse's
// intake/output ledger, as the engine adds it up (GET /patients/{id}/fluids).
//
// WHAT IT PRINTS is the engine's, number for number (G2-A3 Decision 1): today's intake, output and signed balance
// since the fluid day began (Görevlerim's first shift start, D5); the two shift subtotals under their own times;
// the last complete day's intake, output and balance with its 24-hour urine, how many of its hours carry a urine
// entry, and beside them the Sepsis-3 SOFA renal row as a REFERENCE (D8) — the system awards no points, colours
// nothing, and an incomplete chart understates the total, so the hours covered are said with it. The urine rate in
// mL/kg/h is a number with its window, never coloured: the vault holds no oliguria threshold (D9, O3).
//
// The hourly chart (FluidChart.jsx) and today's entries, newest first — a withdrawn one struck through and said as
// such. The box reads on mount, once a minute and after a write or a withdrawal on this patient (useFluids.js).
import React, { useId } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { dayStamp, hhmm } from "../../../i18n/dates.js";
import { numberText } from "../../../i18n/numbers.js";
import { readErrorText } from "../../../apiErrors.js";
import { Box, Button, Note } from "../../../ui/index.js";
import { FluidChart } from "./FluidChart.jsx";
import { isFluidCode, labelKey, mlText, signedMlText } from "./fluidCodes.js";
import { useFluids } from "./useFluids.js";

const timeOf = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isFinite(ms) ? ms : null;
};

/** One window's intake, output and balance, named by `label`. `big` for today's: the numbers read first. */
function Totals({ label, totals, big = false, children }) {
  const { t, lang } = useI18n();
  const id = useId();
  const number = big ? "font-data text-20 font-bold text-ink" : "font-data text-14 font-bold text-ink";
  const cell = (key, text) => (
    <div>
      <dt className="text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] text-mute">{t(key)}</dt>
      <dd className="m-0"><b className={number}>{text}</b></dd>
    </div>
  );
  return (
    <div role="group" aria-labelledby={id} className="rounded-ctl border border-line bg-card px-2.5 py-2">
      <p id={id} className="m-0 text-12 font-semibold text-mute">{label}</p>
      <dl className="m-0 mt-1 grid grid-cols-3 gap-2">
        {cell("sivi.intake", t("sivi.ml", { value: mlText(lang, totals?.in) }))}
        {cell("sivi.output", t("sivi.ml", { value: mlText(lang, totals?.out) }))}
        {cell("sivi.balance", t("sivi.ml", { value: signedMlText(lang, totals?.balance) }))}
      </dl>
      {children}
    </div>
  );
}

/** Today's entries, newest first (the engine's own order is kept, then made sure of). */
function Entries({ data, nowMs }) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const start = timeOf(data.day?.start);
  const today = data.entries
    .filter((e) => start === null || (timeOf(e.at) ?? -Infinity) >= start)
    .sort((a, b) => (timeOf(b.at) ?? 0) - (timeOf(a.at) ?? 0) || (b.entry ?? 0) - (a.entry ?? 0));
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <h3 id={headingId} className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("sivi.entries")}</h3>
      {today.length ? (
        // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
        <ul role="list" aria-labelledby={headingId} className="m-0 mt-1 list-none p-0 text-13">
          {today.map((e) => {
            const at = timeOf(e.at);
            const struck = Boolean(e.retracted);
            const volume = t("sivi.ml", { value: mlText(lang, e.value) });
            return (
              <li key={e.entry ?? `${e.code}-${e.at}`} data-entry={e.entry ?? ""} className="py-0.5">
                <span className="font-data text-mute">{at === null ? "—" : dayStamp(at, nowMs)}</span>
                {" · "}{isFluidCode(e.code) ? t(labelKey(e.code)) : String(e.code ?? "—")}
                {" · "}{struck ? <s className="font-data">{volume}</s> : <span className="font-data">{volume}</span>}
                {e.by ? <>{" · "}<span className="text-mute">{e.by}</span></> : null}
                {struck ? <span className="ml-2 text-12 font-semibold text-mute">{t("sivi.withdrawn")}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 mt-1 text-13 text-mute">{t("sivi.entriesEmpty")}</p>
      )}
    </div>
  );
}

function Ledger({ data, nowMs }) {
  const { t, lang } = useI18n();
  const dayStart = timeOf(data.day?.start);
  const [shiftA, shiftB] = Array.isArray(data.shifts) ? data.shifts : [];
  const shiftLabel = (shift) => {
    const from = timeOf(shift?.start);
    const to = timeOf(shift?.end);
    return t("sivi.shift", { start: from === null ? "—" : hhmm(from), end: to === null ? "—" : hhmm(to) });
  };
  const rate = data.urine_ml_kg_h_last_6h;
  return (
    <>
      <Totals label={t("sivi.today", { start: dayStart === null ? "—" : hhmm(dayStart) })} totals={data.totals.today} big />
      <div className="mt-2 grid gap-2 min-[861px]:grid-cols-2">
        <Totals label={shiftLabel(shiftA)} totals={data.totals.shift_a} />
        <Totals label={shiftLabel(shiftB)} totals={data.totals.shift_b} />
      </div>
      <div className="mt-2">
        <Totals label={t("sivi.lastDay")} totals={data.totals.last_day}>
          <p className="m-0 mt-1.5 text-13 text-ink">{t("sivi.urineLastDay", { ml: mlText(lang, data.urine_last_day_ml) })}</p>
          <p className="m-0 mt-0.5 text-12.5 text-mute">{t("sivi.urineHours", { n: data.hours_with_urine_last_day ?? "—" })}</p>
          {/* A reference, as text: no points are given here and nothing is coloured (D8). */}
          <p className="m-0 mt-0.5 text-12 text-mute">{t("sivi.sofaRef")}</p>
        </Totals>
      </div>
      {/* A number with its window, never a colour: the vault has no oliguria threshold (D9). */}
      <p className="m-0 mt-2 text-13 text-ink">
        {typeof rate === "number" && Number.isFinite(rate) ? t("sivi.rate", { rate: numberText(lang, rate) }) : t("sivi.rateNone")}
      </p>
      <FluidChart day={data.day} hours={data.hours} />
      <Entries data={data} nowMs={nowMs} />
    </>
  );
}

/** `patientId` is whose ledger this is; `bed` names the patient in the dialog and on its toasts (never the
 *  patient's name, Decision 14); `nowMs` is the screen's clock, which says which stamps are today's; `canChart`
 *  (`clinical.chart`) offers «Giriş/çıkış ekle» — absent otherwise, never a disabled button. */
export function FluidsBox({ patientId, bed, nowMs = Date.now(), canChart = false }) {
  const { t } = useI18n();
  const { data, error } = useFluids(patientId);
  const right = canChart ? <Button size="sm" icon="plus">{t("sivi.add")}</Button> : null;
  return (
    <Box title={t("sivi.title")} icon="drop" level={2} right={right}>
      <p className="m-0 mb-2 text-11.5 text-mute">{t("sivi.intro")}</p>
      {/* A failed read keeps the last ledger and says so beside it — a static note, as the SOFA box says its own:
          a read once a minute must not interrupt a screen reader each time it fails. */}
      {error ? <Note tone="warn" icon="alert" className="mb-2">{t("sivi.readFailed", { reason: readErrorText(t, error) })}</Note> : null}
      {data ? <Ledger data={data} nowMs={nowMs} /> : error ? null : <p className="m-0 text-13 text-mute">{t("sivi.reading")}</p>}
    </Box>
  );
}
