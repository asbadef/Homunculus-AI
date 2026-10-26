// src/live/screens/patient/meds/MedsBox.jsx — the patient screen's Meds box: the medication picture the
// engine publishes, and since G2-A3 the one place a `clinical.chart` holder charts it from.
//
// WHERE (D4). The charting sits on the box that shows what it charts, not on a screen of its own: the
// nurse who reads "noradrenalin 0.12 µg/kg/dəq · 04:50" and knows the pump now says 0.2 is already
// looking at the button that corrects it. It is offered only to a `clinical.chart` holder and is
// ABSENT for anyone else — never a disabled button, which would offer a control to someone who can do
// nothing with it.
//
// WHAT IT PRINTS (D5) is the engine's, word for word: each pressor's rate with the time it was charted
// (`pressors_at`) — a rate without its time cannot say whether the infusion is still the current one — a
// 0 as "stopped", and the last charted entries newest first (`charted`, the order the engine sends). The
// browser does no clinical arithmetic (Decision 1): no sum of boluses, no mL/kg, no "running for" — the
// numbers are the engine's and the times are `hhmm` of the engine's stamps. A server older than G2-A3
// sends a rate with no stamp; that rate is printed as it always was (`patient.pressors`), not given a time.
//
// THE FORM IS A DIALOG (X1, MedsChartForm.jsx). The shell keeps this screen mounted across a move to
// another patient (no `key`), so the box remembers WHOSE form it opened: a form opened on one patient
// is never shown on the next, and a late close from an earlier opening closes nothing of a new one (the
// TrendsBox rule). The Modal gives the focus back to what had it when it opened — the button, for a
// keyboard user.
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Box, Button } from "../../../ui/index.js";
import { MedsChartForm } from "./MedsChartForm.jsx";
import { ANTIBIOTIC, BOLUS, PRESSORS, WEIGHT } from "./medsFields.js";

/** An engine stamp as the reader's clock time, or a dash for one that does not parse. */
const timeOf = (ts) => {
  const ms = ts ? Date.parse(ts) : Number.NaN;
  return Number.isFinite(ms) ? hhmm(ms) : "—";
};

/** One history row's name and value, by the engine's code. The value is printed as the engine sent it,
 *  with the unit the form charts it in — a 0 rate is "0 µg/kg/dəq", literally, because the list is the
 *  record and not a reading of it. "Antibiotic given" is a sentence and has no value: the door records
 *  it as 1, and only a 1 is said to be a dose; any other value (another client may chart a 0) and a
 *  code this box does not know are printed as the engine's own code and value, never as a guess. */
function historyOf(t, row) {
  const pressor = PRESSORS.find((p) => p.code === row.code);
  if (pressor) return { name: t(pressor.labelKey), value: `${row.value} ${t("patient.medsRateUnit")}` };
  if (row.code === BOLUS.code) return { name: t("patient.medsBolus"), value: `${row.value} ${t("patient.medsBolusUnit")}` };
  if (row.code === WEIGHT.code) return { name: t("patient.medsWeight"), value: `${row.value} ${t("patient.medsWeightUnit")}` };
  if (row.code === ANTIBIOTIC.code && row.value === 1) return { name: t("patient.medsHistoryAntibiotic"), value: null };
  return { name: String(row.code ?? "—"), value: `${row.value ?? "—"}` };
}

/** The pressor lines: one sentence per drug the engine has a number for, with its charted time, a 0 said
 *  as stopped. Rates that came with no stamp (an older server) keep today's single list line. */
function pressorLines(t, meds) {
  const lines = [];
  const unstamped = [];
  for (const p of PRESSORS) {
    const rate = meds.pressors?.[p.key];
    if (typeof rate !== "number") continue;
    const stamp = meds.pressors_at?.[p.key];
    const ms = stamp ? Date.parse(stamp) : Number.NaN;
    if (!Number.isFinite(ms)) {
      unstamped.push(`${p.key} ${rate}`);
      continue;
    }
    lines.push(t(rate === 0 ? "patient.medsStopped" : "patient.medsRunning", { drug: t(p.labelKey), rate, time: hhmm(ms) }));
  }
  if (unstamped.length) lines.push(t("patient.pressors", { list: unstamped.join(", ") }));
  return lines;
}

/** The medication picture the engine publishes, with its three-valued antibiotic. `null` means
 *  nobody charted it either way; rendering that as "not given" would accuse a ward of missing a
 *  deadline it may well have met and simply not recorded here (api/board.py `_meds`). */
function Meds({ meds }) {
  const { t } = useI18n();
  const pressors = pressorLines(t, meds);
  const charted = Array.isArray(meds.charted) ? meds.charted : [];
  const clock = meds.antibiotic_clock ?? null;
  const givenAt = meds.antibiotic_at ? Date.parse(meds.antibiotic_at) : NaN;
  const deadline = clock?.deadline ? Date.parse(clock.deadline) : NaN;
  let antibiotic;
  if (meds.antibiotic_given === null || meds.antibiotic_given === undefined) antibiotic = t("patient.antibioticUnknown");
  else if (meds.antibiotic_given && Number.isFinite(givenAt)) antibiotic = t("patient.antibioticGiven", { time: hhmm(givenAt) });
  else if (Number.isFinite(deadline)) {
    antibiotic = t(clock.remaining_sec !== null && clock.remaining_sec < 0 ? "patient.antibioticOverdue" : "patient.antibioticPending", { time: hhmm(deadline) });
  } else antibiotic = t("patient.antibioticUnknown");
  return (
    <>
      <p className="m-0 text-13">{antibiotic}</p>
      {pressors.length ? (
        pressors.map((line) => <p key={line} className="m-0 mt-1 text-13 text-mute">{line}</p>)
      ) : (
        <p className="m-0 mt-1 text-13 text-mute">{t("patient.noPressors")}</p>
      )}
      {/* Plain lines, like the two above them, and NOT <KV> rows. `patient.weight` and
          `patient.creatinine` already carry their own number and unit inside one sentence, so as
          KV rows they were a <dt> with an empty <dd> — a definition list whose terms define
          nothing, which a screen reader reads as a label whose value is missing. */}
      {meds.weight_kg !== null && meds.weight_kg !== undefined ? (
        <p className="m-0 mt-1 text-13 text-mute">{t("patient.weight", { value: meds.weight_kg })}</p>
      ) : null}
      {meds.creatinine !== null && meds.creatinine !== undefined ? (
        <p className="m-0 mt-1 text-13 text-mute">{t("patient.creatinine", { value: meds.creatinine })}</p>
      ) : null}
      <div className="mt-2.5 border-t border-line pt-2.5">
        {/* One level under the box's own h2, as the boxes with sub-lists do (admin/SourceTab.jsx). */}
        <h3 className="m-0 font-text text-11 font-bold uppercase tracking-[.08em] text-mute">{t("patient.medsHistoryTitle")}</h3>
        {charted.length ? (
          // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
          <ul role="list" className="m-0 mt-1 list-none p-0 text-13">
            {charted.map((row, i) => {
              const { name, value } = historyOf(t, row);
              return (
                <li key={`${row.ts}-${row.code}-${i}`}>
                  <span className="font-data text-mute">{timeOf(row.ts)}</span>
                  {" · "}{name}
                  {value !== null ? <>{" · "}<span className="font-data">{value}</span></> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 mt-1 text-13 text-mute">{t("patient.medsHistoryNone")}</p>
        )}
      </div>
    </>
  );
}

/** The box: the picture, or the sentence saying the engine sent none — and, for a `clinical.chart`
 *  holder, the button and the form either way: a patient with no medication block yet is exactly the
 *  one whose first entry has to be charted from here.
 *
 *  `onChart(entries, recordedAt)` is the write, already bound to this patient by the screen; it
 *  resolves to the store's answer, which the form reads (`dropped`). `patientId` is whose form is open.
 *  The form is the box's LAST child whatever the picture holds, so the reload that lands while it is
 *  still open (a first entry turns "no medication information" into a picture) does not remount it. */
export function MedsBox({ meds, bed, canChart, onChart, patientId }) {
  const { t } = useI18n();
  // `{ id, opening }`: the patient the form was opened FOR and which opening this is, or null.
  const [editing, setEditing] = useState(null);
  const openings = useRef(0);
  useEffect(() => { setEditing(null); }, [patientId]);
  function openForm() {
    openings.current += 1;
    setEditing({ id: patientId, opening: openings.current });
  }
  const right = canChart ? (
    <Button size="sm" icon="plus" onClick={openForm}>{t("patient.medsChartOpen")}</Button>
  ) : null;
  return (
    <Box title={t("patient.meds")} icon="syringe" level={2} right={right}>
      {meds ? <Meds meds={meds} /> : <p className="m-0 text-13 text-mute">{t("patient.noMeds")}</p>}
      {/* No `onSaved` work of its own: a write the engine answered is followed by the store's own reload
          (`board.store.chart`), and one that landed without its answer reaching here is published on the
          board's stream by the engine (api/app.py `POST /clinical`), so the box re-renders from the board. */}
      {editing && editing.id === patientId ? (
        <MedsChartForm
          key={editing.opening} patient={{ patient_id: patientId }} bed={bed} onChart={onChart}
          onClose={() => setEditing((current) => (current?.opening === editing.opening ? null : current))}
          onSaved={() => {}}
        />
      ) : null}
    </Box>
  );
}
