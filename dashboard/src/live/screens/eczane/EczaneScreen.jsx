// src/live/screens/eczane/EczaneScreen.jsx — «Eczane» (G3-04): the pharmacist's ward page. Every patient in the
// caller's scope in one table — vasopressors, the antibiotic state, creatinine, today's fluid balance — with the
// antibiotic clocks that are running or passed first. Read-only: it charts nothing and orders nothing.
//
// THE SERVER DECIDES, THE SCREEN FORMATS (spec D4). The rows come in the server's order with the server's state
// word; the four counters are the server's numbers. The page sums, sorts and judges nothing (pharmacyModel.js): it
// writes times in the reader's clock and, while the answer is fresh, the two durations no payload can carry.
//
// ITS SOURCE IS ITS OWN READ, not the board store: no `BoardStrip` is drawn (the board's stream is not what this
// page shows), and its `ScopeNote` reads the answer's own `scope` / `scope_note` (spec §5). The only thing it takes
// from the board is the clock's skew, when the board has one; a session without `board.view` has no board store
// behind it, and its clock is corrected by the skew of the page's own answers (`clockSkewOf`, usePharmacy).
//
// A LIST THAT IS NOT FRESH NEVER READS AS TODAY'S (spec D18, §6): a failed read keeps the last answer under a crit
// alert with the time of that answer, the durations stop counting, and nothing is called empty; with no answer at
// all there is no counter and no table — never zeros. Only a fresh answer may say that no patient is in view.
//
// «KAYIT YOK» IS NEVER «VERİLMEDİ» (spec D8): the note that says what the words mean is on the page in every state.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, FOCUS_RING, Note, StatusPill, Table } from "../../ui/index.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { ScopeNote, nameOf } from "../common/BoardState.jsx";
import { useNow } from "../common/useNow.js";
import { bedNameOf } from "../beds/order.js";
import { ageText } from "../patient/ageText.js";
import { mlText, signedMlText } from "../patient/fluids/fluidCodes.js";
import { antibioticCell, clockSkewOf, creatinineCell, fluidCell, isFresh, msOf, pressorLines } from "./pharmacyModel.js";
import { usePharmacy } from "./usePharmacy.js";

/** The one window and source the page's source sentence states (spec D9). An answer that names another window or
 *  another source is printed with the server's own numbers instead — the sentence is never left saying something
 *  the server did not. */
const WINDOW_MIN = 60;
const WINDOW_SOURCE = "surviving-sepsis-campaign-2026";

/** The four counters (spec D11): the server's field, the tile's label, and the tone its number takes when it is
 *  above 0 — the engine's severities for a passed and a running window (D14); the other two are neutral. */
const TILES = [
  { field: "clock_running", label: "eczane.count.running", tone: "text-high-ink" },
  { field: "clock_missed", label: "eczane.count.missed", tone: "text-crit-ink" },
  { field: "on_pressor", label: "eczane.count.onPressor", tone: "text-ink" },
  { field: "recognized", label: "eczane.count.recognized", tone: "text-ink", second: "recognized_no_record" },
];

/** A count as the server sent it, or a dash for one that is no whole number — never a 0 the server did not send. */
const countText = (value) => (Number.isInteger(value) ? String(value) : "—");

function Counters({ counts, asOf }) {
  const { t } = useI18n();
  return (
    <div data-counters>
      <div className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-4">
        {TILES.map((tile) => (
          <div key={tile.field} className="rounded-box border border-line bg-card px-3 py-2">
            <b data-testid={`count-${tile.field}`} className={`block font-data text-23 ${counts?.[tile.field] > 0 ? tile.tone : "text-ink"}`}>
              {countText(counts?.[tile.field])}
            </b>
            <span className="block text-12 text-mute">{t(tile.label)}</span>
            {tile.second ? (
              <span data-testid={`count-${tile.second}`} className="block text-12 text-mute">
                {t("eczane.count.noRecord", { n: countText(counts?.[tile.second]) })}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {asOf ? <p data-as-of className="m-0 mt-1 text-12 text-mute">{asOf}</p> : null}
    </div>
  );
}

/** `fluidCut`: the day's fluid read had to cut (`fluid_truncated`). The cut loses the day's OLDEST rows, so a balance
 *  may be understated and a `fluid: null` may be a patient WITH entries: neither a number nor «Bugün kayıt yok» may be
 *  printed as if it were known — every row's fluid cell is a dash, and the note above the table says why. */
function Row({ row, nowMs, fresh, canOpen, fluidCut }) {
  const { t, lang } = useI18n();
  const stamp = (ms) => (ms === null ? "—" : dayStamp(ms, nowMs));
  const bed = bedNameOf({ bedLabel: row.bed_label, patient_id: row.patient_id });
  const who = (
    <>
      <span className="block font-data text-13.5 font-bold text-ink">{bed}</span>
      <span className="block text-12.5 font-normal text-mute">{nameOf(row, t)}</span>
    </>
  );
  const antibiotic = antibioticCell(row, nowMs, fresh);
  const state = t(antibiotic.key, {
    duration: antibiotic.duration ? t(antibiotic.duration.key, antibiotic.duration.params) : "—",
    time: stamp(antibiotic.timeMs),
    state: String(antibiotic.state ?? "—"),
  });
  const pressors = pressorLines(row, nowMs, fresh);
  const creatinine = creatinineCell(row);
  const fluid = fluidCell(row);
  return (
    <tr data-patient={row.patient_id} data-state={String(antibiotic.state ?? "")}>
      <th scope="row" className="!normal-case !tracking-normal">
        {canOpen
          ? <a href={`#/patients/${encodeURIComponent(row.patient_id ?? "")}`} className={`block rounded-md ${FOCUS_RING}`}>{who}</a>
          : who}
      </th>
      <td data-cell="pressors">
        {pressors.length === 0 ? <span className="text-mute">{t("eczane.noRecord")}</span> : pressors.map((line) => (
          <span key={line.drug} className="block">
            {t(line.key, {
              drug: line.drugKey ? t(line.drugKey) : line.drug,
              rate: line.rate,
              time: line.aged ? (ageText(t, line.at, nowMs) ?? "—") : stamp(line.atMs),
            })}
          </span>
        ))}
      </td>
      <td data-cell="antibiotic">
        {antibiotic.tone
          ? <StatusPill tone={antibiotic.tone}>{state}</StatusPill>
          : <span className={antibiotic.state === "none" ? "text-mute" : ""}>{state}</span>}
        {antibiotic.second ? (
          <span className="mt-0.5 block text-12 text-mute">{t(antibiotic.second.key, { time: stamp(antibiotic.second.timeMs) })}</span>
        ) : null}
      </td>
      <td data-cell="creatinine" className="font-data">
        {creatinine
          ? t("eczane.creatinine", { value: creatinine.value, time: stamp(creatinine.atMs) })
          : <span className="font-text text-mute">{t("eczane.noRecord")}</span>}
      </td>
      <td data-cell="fluid">
        {fluidCut ? <span className="text-mute">{"—"}</span> : fluid ? (
          <>
            <span className="block font-data font-bold">{t("eczane.fluid.balance", { value: signedMlText(lang, fluid.balance) })}</span>
            <span className="block text-12 text-mute">
              {t("eczane.fluid.detail", { intake: mlText(lang, fluid.intake), output: mlText(lang, fluid.output), time: stamp(fluid.lastMs) })}
            </span>
          </>
        ) : <span className="text-mute">{t("eczane.fluid.none")}</span>}
      </td>
    </tr>
  );
}

export function EczaneScreen() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { data, error, skewMs } = usePharmacy(store);
  // The page's clock is the server's for every session: the board's skew for a `board.view` holder (`useBoardNow`'s
  // own rule, unchanged), else the skew of this page's own answers — the board store never starts for a session
  // that holds `pharmacy.view` alone, and a raw workstation clock would misjudge both the minutes and the freshness.
  const { clockSkewMs } = useBoard();
  const nowMs = useNow(10_000) + clockSkewOf(clockSkewMs, skewMs);
  const canOpen = user?.perms?.includes("board.view") ?? false;
  const fresh = isFresh(data, error, nowMs);
  const rows = data?.rows ?? [];
  const fluidCut = Boolean(data?.fluid_truncated);
  const fluidDayStart = msOf(data?.fluid_day?.start);
  const answeredAt = msOf(data?.now);
  const answered = answeredAt === null ? "—" : dayStamp(answeredAt, nowMs);
  const reason = error ? (error.malformed ? t("eczane.malformed") : readErrorText(t, error)) : null;
  const standard = data?.antibiotic_window_min === WINDOW_MIN && data?.antibiotic_window_source === WINDOW_SOURCE;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("eczane.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("eczane.intro")}</p>
      </div>
      {!data && !error ? <Note tone="info" icon="clock">{t("eczane.loading")}</Note> : null}
      {!data && error ? <Alert tone="crit"><p className="m-0">{t("eczane.readFailed", { reason })}</p></Alert> : null}
      {data && !fresh ? (
        <Alert tone="crit">
          <p className="m-0">{t("eczane.stale", { time: answered })}</p>
          {reason ? <p className="m-0 mt-1 font-normal">{reason}</p> : null}
        </Alert>
      ) : null}
      {data && (fresh || rows.length > 0) ? <ScopeNote scope={data.scope} scopeNote={data.scope_note} /> : null}
      {/* §6: a list that is not fresh with no rows says only that it is not fresh — four «0» tiles would read as a quiet ward. */}
      {data && (fresh || rows.length > 0) ? <Counters counts={data.counts} asOf={fresh ? null : t("eczane.asOf", { time: answered })} /> : null}
      <Note tone="info" icon="pill">{t("eczane.note")}</Note>
      {fluidCut ? <Note tone="warn" icon="alert">{t("eczane.truncated")}</Note> : null}
      {data && rows.length > 0 ? (
        <Table caption={t("eczane.caption", { n: countText(data.counts?.patients) })}>
          <thead>
            <tr>
              <th>{t("eczane.col.patient")}</th>
              <th>{t("eczane.col.pressors")}</th>
              <th>{t("eczane.col.antibiotic")}</th>
              <th>{t("eczane.col.creatinine")}</th>
              <th>
                {t("eczane.col.fluid")}
                {/* «Today» is the ward's fluid day: it began at the first shift's start, and the heading says when. */}
                {fluidDayStart !== null ? (
                  <span data-fluid-day className="block font-normal normal-case tracking-normal">
                    {t("eczane.col.fluidDay", { time: dayStamp(fluidDayStart, nowMs) })}
                  </span>
                ) : null}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <Row key={row.patient_id} row={row} nowMs={nowMs} fresh={fresh} canOpen={canOpen} fluidCut={fluidCut} />)}
          </tbody>
        </Table>
      ) : null}
      {data && fresh && rows.length === 0 ? <Note tone="info" icon="bed">{t("eczane.empty")}</Note> : null}
      {data ? (
        <p data-source className="m-0 text-12.5 text-mute">
          {standard
            ? t("eczane.source")
            : t("eczane.sourceOther", { minutes: countText(data.antibiotic_window_min), source: String(data.antibiotic_window_source ?? "—") })}
        </p>
      ) : null}
      <p data-footer className="m-0 text-12.5 text-mute">{t("eczane.footer")}</p>
    </div>
  );
}
