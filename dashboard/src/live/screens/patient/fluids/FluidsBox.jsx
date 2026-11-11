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
//
// WHAT IT WRITES, for a `clinical.chart` holder only — absent otherwise, never a disabled button: «Giriş/çıkış
// ekle» (FluidEntryDialog.jsx) and, on each of today's entries not yet withdrawn, «Hatalı giriş» — G3-01's
// withdrawal dialog (common/RetractDialog.jsx), the reason the clinician's, the engine rebuilding the patient
// without the volume (D4). A withdrawal the dialog reports done strikes the row at once, before the read that
// follows confirms it; the struck row takes the focus, since its button has left the page.
//
// The shell keeps the patient screen mounted across a move to another patient (no `key`), so the box remembers
// WHOSE dialog it opened: one opened on a patient is never shown on the next (the Meds box's rule).
import React, { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { dayStamp, hhmm } from "../../../i18n/dates.js";
import { numberText } from "../../../i18n/numbers.js";
import { readErrorText } from "../../../apiErrors.js";
import { useBoard } from "../../../data/BoardProvider.jsx";
import { Box, Button, FOCUS_RING, Note } from "../../../ui/index.js";
import { RetractDialog } from "../../common/RetractDialog.jsx";
import { FluidChart } from "./FluidChart.jsx";
import { FluidEntryDialog } from "./FluidEntryDialog.jsx";
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

/** Today's entries, newest first (the engine's own order is kept, then made sure of). `withdrawn` holds the
 *  entries this box saw withdrawn before a read said so; `onRetract(entry)` opens «Hatalı giriş» for one, and is
 *  null without `clinical.chart`. `rowRef(entry, node)` keeps each row for the focus a struck row takes. */
function Entries({ data, nowMs, withdrawn, onRetract, rowRef }) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const base = useId();
  const start = timeOf(data.day?.start);
  const end = timeOf(data.day?.end);
  // Today's: in the day window as the engine drew it — an entry stamped past its end (the door's skew) is tomorrow's,
  // as the engine's totals count it (review round 1).
  const today = data.entries
    .filter((e) => {
      const at = timeOf(e.at);
      return (start === null || (at ?? -Infinity) >= start) && (end === null || (at ?? -Infinity) < end);
    })
    .sort((a, b) => (timeOf(b.at) ?? 0) - (timeOf(a.at) ?? 0) || (b.entry ?? 0) - (a.entry ?? 0));
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <h3 id={headingId} className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("sivi.entries")}</h3>
      {today.length ? (
        // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
        <ul role="list" aria-labelledby={headingId} className="m-0 mt-1 list-none p-0 text-13">
          {today.map((e) => {
            const at = timeOf(e.at);
            const id = Number.isInteger(e.entry) ? e.entry : null;
            const struck = Boolean(e.retracted) || (id !== null && withdrawn.has(id));
            const volume = t("sivi.ml", { value: mlText(lang, e.value) });
            const textId = `${base}-${id ?? e.at}`;
            return (
              <li
                key={id ?? `${e.code}-${e.at}`} data-entry={id ?? ""} tabIndex={-1} ref={(node) => rowRef(id, node)}
                className={`flex flex-wrap items-center gap-2 border-b border-line py-1 outline-none last:border-b-0 ${FOCUS_RING}`}
              >
                <span id={textId} className="min-w-0 flex-1">
                  <span className="font-data text-mute">{at === null ? "—" : dayStamp(at, nowMs)}</span>
                  {" · "}{isFluidCode(e.code) ? t(labelKey(e.code)) : String(e.code ?? "—")}
                  {" · "}{struck ? <s className="font-data">{volume}</s> : <span className="font-data">{volume}</span>}
                  {e.by ? <>{" · "}<span className="text-mute">{e.by}</span></> : null}
                  {struck ? <span className="ml-2 text-12 font-semibold text-mute">{t("sivi.withdrawn")}</span> : null}
                </span>
                {onRetract && id !== null && !struck && isFluidCode(e.code) ? (
                  // The name stays «Hatalı giriş»; the row's words tell the buttons apart for a screen reader.
                  <Button size="sm" variant="ghost" icon="x" aria-describedby={textId} onClick={() => onRetract(e)}>{t("sivi.retract")}</Button>
                ) : null}
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

function Ledger({ data, nowMs, withdrawn, onRetract, rowRef }) {
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
      {/* The engine's read hit its limit and cut the oldest rows (review round 1, as trends' `manual_truncated`): a
          short total must not be read as the patient's. Static, as the failed read's note. */}
      {data.truncated === true ? <Note tone="warn" icon="alert" className="mb-2">{t("sivi.truncated")}</Note> : null}
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
      <Entries data={data} nowMs={nowMs} withdrawn={withdrawn} onRetract={onRetract} rowRef={rowRef} />
    </>
  );
}

/** `patientId` is whose ledger this is; `bed` names the patient in the dialogs and on their toasts (never the
 *  patient's name, Decision 14); `nowMs` is the screen's clock, which says which stamps are today's; `canChart`
 *  (`clinical.chart`) offers «Giriş/çıkış ekle» and «Hatalı giriş» — absent otherwise. `reread` is `{ id, n }`: the
 *  screen's word that a write made elsewhere on it landed for patient `id` (the Meds box's bolus or weight — the
 *  same bolus record, and the weight the urine rate divides by; D11, D12), as the SOFA box's `reread`. */
export function FluidsBox({ patientId, bed, nowMs = Date.now(), canChart = false, reread = null }) {
  const { t, lang } = useI18n();
  const board = useBoard();
  const { data, error, refresh } = useFluids(patientId);
  // D12: read again after a write elsewhere on the screen for this patient. Not on mount, not for one count twice.
  const seenReread = useRef(reread?.n ?? 0);
  useEffect(() => {
    const n = reread?.n ?? 0;
    if (n === seenReread.current) return;
    seenReread.current = n;
    if (reread.id === patientId) refresh();
  }, [reread?.n]);
  // `{ id, opening }`: the patient the entry dialog was opened FOR and which opening this is, or null.
  const [editing, setEditing] = useState(null);
  // `{ id, row }`: the entry whose «Hatalı giriş» is open, and whose patient it is.
  const [retracting, setRetracting] = useState(null);
  // `{ id, entries }`: entries withdrawn here before a read said so, for the patient they belong to.
  const [withdrawn, setWithdrawn] = useState({ id: patientId, entries: new Set() });
  const openings = useRef(0);
  const rows = useRef(new Map());
  const struckNow = useRef(null);
  useEffect(() => {
    setEditing(null);
    setRetracting(null);
  }, [patientId]);
  // After the commit that struck the row (and closed the dialog): the dialog's own cleanup has run by now.
  useEffect(() => {
    if (struckNow.current === null) return;
    rows.current.get(struckNow.current)?.focus();
    struckNow.current = null;
  }, [withdrawn]);
  const rowRef = (entry, node) => {
    if (entry === null) return;
    if (node) rows.current.set(entry, node);
    else rows.current.delete(entry);
  };
  const struck = withdrawn.id === patientId ? withdrawn.entries : new Set();

  function openDialog() {
    openings.current += 1;
    setEditing({ id: patientId, opening: openings.current });
  }
  const right = canChart ? <Button size="sm" icon="plus" onClick={openDialog}>{t("sivi.add")}</Button> : null;
  const open = retracting && retracting.id === patientId ? retracting : null;
  const what = open ? {
    label: t(labelKey(open.row.code)),
    value: t("sivi.ml", { value: mlText(lang, open.row.value) }),
    time: timeOf(open.row.at) === null ? "—" : dayStamp(timeOf(open.row.at), nowMs),
  } : null;

  return (
    <Box title={t("sivi.title")} icon="drop" level={2} right={right}>
      <p className="m-0 mb-2 text-11.5 text-mute">{t("sivi.intro")}</p>
      {/* A failed read keeps the last ledger and says so beside it — a static note, as the SOFA box says its own:
          a read once a minute must not interrupt a screen reader each time it fails. */}
      {error ? <Note tone="warn" icon="alert" className="mb-2">{t("sivi.readFailed", { reason: readErrorText(t, error) })}</Note> : null}
      {data ? (
        <Ledger data={data} nowMs={nowMs} withdrawn={struck} rowRef={rowRef}
          onRetract={canChart ? (row) => setRetracting({ id: patientId, row }) : null} />
      ) : error ? null : <p className="m-0 text-13 text-mute">{t("sivi.reading")}</p>}
      {/* The dialogs are the box's last children whatever it shows, so a read that lands while one is open does not
          remount it. */}
      {editing && editing.id === patientId ? (
        <FluidEntryDialog
          key={editing.opening} bed={bed}
          onChart={(entries, at) => board.store.chart(editing.id, entries, at)}
          onSaved={refresh}
          onClose={() => setEditing((current) => (current?.opening === editing.opening ? null : current))}
        />
      ) : null}
      {open ? (
        <RetractDialog
          bed={bed} what={what}
          onRetract={(reason) => board.store.retract(open.id, open.row.entry, reason)}
          // «Already» is withdrawn too; an uncertain one keeps its button — a second try is answered «already». A
          // refusal that wrote nothing (a discharged patient) sends no outcome at all. The box reads again either way.
          onDone={(outcome) => {
            if (outcome !== "uncertain") {
              struckNow.current = open.row.entry;
              setWithdrawn((current) => ({
                id: open.id,
                entries: new Set(current.id === open.id ? current.entries : []).add(open.row.entry),
              }));
            }
            refresh();
          }}
          onClose={() => setRetracting(null)}
        />
      ) : null}
    </Box>
  );
}
