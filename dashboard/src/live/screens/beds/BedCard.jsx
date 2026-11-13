// src/live/screens/beds/BedCard.jsx — one bed, as the board shows it (the prototype's `.bed`).
//
// Everything on this card is the engine's or the hospital's. The card computes nothing clinical:
// no score, no band, no colour that depends on a value, no risk of its own. What it does do is
// state absence out loud, which is where every honesty rule on it comes from:
//
//   * The risk pill is given `measured` from the card's OWN timestamps, so risk "none" reads "no
//     finding" on a card that has observations and "not measured" on one that has none
//     (ui/riskStyle.js's rule, and the reason it refuses to assume it).
//   * A channel that was never measured is NOT printed as a dash. The old wall board learned this:
//     "on a live ward three of the five channels are empty, so half the row became '—'. Show what
//     was measured; if nothing was, say that once." So the row carries the measured channels only,
//     and a card with none says so in a sentence.
//   * The name is the HIS's or it is missing. A device's raw patient number does not stand in for
//     a person's name — the bed label already carries that identifier, so this slot says what is
//     missing instead (the wall board's rule; the old bed card did the opposite and printed the id
//     twice).
//   * NEWS2 is the engine's or it is "—" with the reason. A browser-side NEWS2 scores an
//     unmeasured parameter as 0 and showed a calm green "0" on patients nobody had scored.
//   * `red_param` is shown as the FACT the engine sent, and does not change the level. The engine
//     can legitimately send "low" with `red_param` true — `rules/patient_relative.py` lowers a
//     NEWS2 alert when the patient's charted chronic normal explains every contributor. Whether a
//     charted baseline may override the red-parameter floor is a clinical decision (roadmap "User
//     decisions", 9), so the screen reports both and overrides neither.
//   * Colour is never the only signal: the left rail's tone always travels with the pill's icon
//     and word.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Icon, RiskPill, StatusPill, Tag, riskStyle } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import { hasMeasurement, lastMeasuredAt } from "../common/freshness.js";
import { patientFeedHealth } from "../common/feedHealth.js";
import { VITALS, measuredVitals } from "../common/vitals.js";
import { useTrends, measuredKeyOf } from "../patient/trends/useTrends.js";
import { channelsOf } from "../patient/trends/cards.js";
import { parsePoints } from "../patient/trends/trendGeometry.js";
import { ChronicExpected, News2, boardKnown, nameOf, pillRisk, railOf, summaryOf } from "../common/BoardState.jsx";
import { MonitorStrip } from "../common/MonitorStrip.jsx";
import { ageText } from "../patient/ageText.js";
import { newestInputAt } from "../patient/shadow/shadowVitals.js";

/** Where this card's identity came from, and what state the HIS says it is in. */
function Provenance({ patient }) {
  const { t } = useI18n();
  const source = patient?.source;
  const key = source === "comed" ? "beds.sourceComed"
    : source === "device" || !source ? "beds.sourceDevice" : "beds.sourceManual";
  // A card with no identity block at all has nothing to say but that: the engine never sent one,
  // so there is no instant and no state either.
  const stamp = patient?.identityUpdatedAt ? Date.parse(patient.identityUpdatedAt) : NaN;
  return (
    <>
      <span>{t(key)}</span>
      {Number.isNaN(stamp) ? null : <span>{` · ${hhmm(stamp)}`}</span>}
      {patient?.identityState === "discharged" ? <span>{` · ${t("beds.discharged")}`}</span> : null}
    </>
  );
}

/** Age and sex as the HIS sent them, in the prototype's short form («52y E»); a part the HIS did
 *  not send is left out, never guessed. */
function AgeSex({ patient }) {
  const { t } = useI18n();
  const parts = [
    Number.isInteger(patient?.age) ? t("beds.ageYears", { age: patient.age }) : null,
    patient?.sex === "female" || patient?.sex === "male" ? t(`beds.sexShort.${patient.sex}`) : null,
  ].filter(Boolean);
  return parts.length ? <span className="mt-0.5 block text-12.5 text-mute">{parts.join(" ")}</span> : null;
}

// The prototype's five columns (.vrow), in its order and with its short names. A channel not
// measured on a card that has others reads «—»; a card with none says so once instead.
const ROW = [
  ["heart_rate", "HR"], ["map", "MAP"], ["spo2", "SpO₂"], ["resp_rate", "RR"], ["temperature", null],
];

function Vitals({ patient }) {
  const { t } = useI18n();
  const shown = measuredVitals(patient);
  if (shown.length === 0) {
    return <p className="m-0 mt-3 text-12.5 text-mute">{t("beds.noVitals")}</p>;
  }
  const byKey = new Map(shown.map((v) => [v.at, v]));
  const meta = new Map(VITALS.map((v) => [v.at, v]));
  return (
    <dl className="m-0 mt-3 grid grid-cols-5 gap-x-2">
      {ROW.map(([key, short]) => {
        const v = byKey.get(key);
        return (
          <div key={key} className="min-w-0">
            <dt className={`text-10 font-bold leading-[normal] ${meta.get(key)?.color ?? "text-mute"}`}>{short ?? t("beds.tempShort")}</dt>
            <dd className={`m-0 font-data text-20 font-bold leading-tight ${v ? "text-ink" : "text-mute"}`}>
              {v ? v.value : "—"}
              {v ? null : <span className="sr-only">{` ${t("board.notMeasured")}`}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The heart rate of the last hours as one line (the prototype's .spark), from the engine's own
 *  trend read — never drawn from anything else. Too few readings: no line. */
function Spark({ patient, tone }) {
  const { data } = useTrends(patient?.patient_id, SPARK_HOURS, measuredKeyOf(patient?.measuredAt));
  const pts = parsePoints(channelsOf(data).heart_rate?.points).filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.value));
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.ms);
  const vs = pts.map((p) => p.value);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [lo, hi] = [Math.min(...vs), Math.max(...vs)];
  const line = pts.map((p) => `${(((p.ms - x0) / (x1 - x0 || 1)) * 100).toFixed(1)},${(20 - ((p.value - lo) / (hi - lo || 1)) * 16).toFixed(1)}`).join(" ");
  return (
    <svg aria-hidden="true" viewBox="0 0 100 22" preserveAspectRatio="none" className={`mt-1.5 block h-6 w-full ${railOf(tone).replace(/\bbg-/g, "text-")}`}>
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
// The widest window the trends endpoint serves: a ward whose monitors paused still shows its
// last readings' shape (owner, 2026-11-14).
const SPARK_HOURS = 72;

/** The shadow tag's words: the score with its newest input's age, «none» from a live board only. */
function shadowTagText(t, shadow, known, nowMs) {
  if (!shadow.findings?.length) return t(known ? "shadow.cardNone" : "shadow.cardUnknown");
  const total = shadow.news2?.total ?? "—";
  const newest = newestInputAt(shadow);
  const age = newest ? ageText(t, newest, nowMs) : null;
  return age ? t("shadow.cardTag", { total, age }) : t("shadow.cardTagNoAge", { total });
}

/**
 * `patient`: one record from `liveAdapters.patientsFromBoard`.
 * `alerts`: that patient's alarms from `boardStore`'s `alerts` (already flattened).
 * `nowMs`: the instant the board was last painted — passed in so one clock serves every card and
 *   a test can fix it.
 * `connection`: the board's own state, and NOT a nicety. The overdue-channel count below is the
 *   snapshot's timestamps aged against a clock that keeps moving, while off LIVE the snapshot is
 *   never reloaded — so through an outage every card would grow an amber "N overdue channels" and
 *   go on growing it, reporting OUR lost connection as the ward's dead monitors. `FeedHealth`
 *   suppresses the ward chip off LIVE for exactly this reason (screens/common/BoardState.jsx);
 *   this is the same rule per card. `BoardStrip` is what speaks about the connection.
 * `monitor`: Aşama A's unvalidated strip for this patient — given ONLY when the API links this
 *   patient's bed to one monitor (`link: "one"`), as `{entry, nowMs, fetchedAtMs, maxAgeS, feedOk}`.
 *   Drawn after the card's link, outside it: a monitor value is never part of what opening the
 *   patient reads out, and nothing on the card above it (risk, alarms, NEWS2) reads it.
 * `draft` (G2-B1a, X61): the admission behind this card waits for the physician's signature — a
 *   badge under the name, and the same words in the link's accessible name, after the bed it
 *   names: the link's `aria-label` replaces what is inside it, so a badge only drawn would be
 *   silent to a screen reader.
 *
 * `patient.shadow` (Aşama B, D7): the shadow engine's picture of a monitor-linked patient, or null.
 *   When there is one, the slot carries one amber tag under the strip — «gölge öneri · NEWS2 n · 3 dk
 *   önce» when the shadow has a finding (the age of the newest input it read, on the card's clock: the
 *   API republishes a patient only when a sample is taken or a link ends, so a held score would otherwise
 *   stand undated; no input, no age), «gölge öneri yok» when it has none — said only from a LIVE board,
 *   the rule `connection` already carries for the overdue count: off it the tag reads «gölge öneri ·
 *   bilinmiyor», never «none». It is a tag and nothing more: no risk pill, no rail, no alarm row, nothing
 *   in the link; the card's risk, alarms and NEWS2 above read none of it. The slot is drawn for the
 *   shadow alone too (the strip may be momentarily unreadable), the strip part staying conditional on
 *   its own entry.
 */
export function BedCard({ patient, alerts = [], nowMs, connection, monitor, draft = false, spark = false }) {
  const { t } = useI18n();
  const measured = hasMeasurement(patient?.measuredAt);
  const style = riskStyle(patient?.risk, { measured });
  const bed = patient?.bedLabel || patient?.patient_id || "—";
  const last = lastMeasuredAt(patient?.measuredAt);
  // Only a LIVE board may be aged: same rule and same reason as `FeedHealth`'s own `connection`.
  const stale = boardKnown(connection) ? patientFeedHealth(patient, nowMs).stale.length : 0;
  const open = alerts.filter((a) => a.status !== "ACKNOWLEDGED");
  return (
    <li className="relative overflow-hidden rounded-box border border-line bg-card">
      {/* The rail is the pill's tone again as a 4 px stripe — never the only signal. */}
      <span aria-hidden="true" data-rail={style.tone} className={`absolute inset-y-0 left-0 w-1 ${railOf(style.tone)}`} />
      <a
        href={`#/patients/${encodeURIComponent(patient?.patient_id ?? "")}`}
        aria-label={draft ? `${t("beds.openPatient", { bed })} · ${t("kabul.badgeDraft")}` : t("beds.openPatient", { bed })}
        className={`block pb-3 pl-[18px] pr-3.5 pt-3 ${FOCUS_RING}`}
      >
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            {/* The prototype's head line: the bed code in the brand colour, then the name. */}
            <p className="m-0 flex min-w-0 items-baseline gap-2">
              <b className="shrink-0 font-data text-15 font-bold text-pri">{bed}</b>
              <span className={`truncate font-display text-15 font-bold ${patient?.display_name ? "text-ink" : "italic text-mute"}`}>
                {nameOf(patient, t)}
              </span>
            </p>
            <AgeSex patient={patient} />
            {draft ? <Tag tone="warn" icon="edit" className="mt-1">{t("kabul.badgeDraft")}</Tag> : null}
          </div>
          <RiskPill risk={patient?.risk} measured={measured} />
        </div>

        {open.length > 0 ? (
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-1 p-0">
            {open.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <RiskPill risk={pillRisk(a.severity)} measured />
                {/* The engine writes its summaries in English (reco/engine.py); marked so a
                    screen reader pronounces them as English rather than with Azerbaijani
                    phonetics. The card says once, at its foot, that they are English. */}
                <span lang="en" className="min-w-0 flex-1 text-12.5 text-ink">{summaryOf(a) ?? t("board.findingUnnamed")}</span>
                {/* G2-A1 (O17): a critical whose condition passed waits here, but the card's risk
                    (computed from the alarms that still fire) is calm — the badge, the alarms
                    screen's own, says why this line is still red. */}
                {a.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
                <ChronicExpected alarm={a} />
              </li>
            ))}
          </ul>
        ) : null}

        {open.length > 0 ? (
          <p className="m-0 mt-1 text-10.5 text-mute">{t("board.engineEnglish")}</p>
        ) : null}

        <Vitals patient={patient} />
        {/* `spark`: the board turns it on; it reads trends through the session. */}
        {spark ? <Spark patient={patient} tone={style.tone} /> : null}

        {/* The prototype's foot line: the score on the left, the last reading on the right. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-11.5 text-mute">
          <span>
            {typeof patient?.news2?.total === "number"
              ? `${t("board.news2")} ${patient.news2.total}${patient.news2.partial ? ` · ${t("board.news2Partial").toLocaleLowerCase()}` : ""}`
              : t("beds.noScore")}
          </span>
          {stale > 0 ? <><span aria-hidden="true">·</span><span className="text-att-ink">{t("beds.staleChannels", { count: stale })}</span></> : null}
          <span className="ml-auto flex items-center gap-1">
            {last !== null ? `${t("board.measuredAt", { time: hhmm(last) })} · ` : `${t("beds.lastNone")} · `}
            <Provenance patient={patient} />
          </span>
        </div>
        {patient?.bedKey && !patient?.bedMatched ? (
          <p className="m-0 mt-1.5 text-11 font-semibold text-att-ink">
            {t("beds.unmatchedBed", { key: patient.bedKey })}
          </p>
        ) : null}
      </a>
      {/* Everything the engine adds beyond the prototype's card — the NEWS2 caveats, the monitor's
          unvalidated strip, the shadow — kept one click away, never dropped. */}
      <details className="group border-t border-line pb-2 pl-[18px] pr-3.5 pt-1.5">
        <summary className={`flex cursor-pointer list-none items-center gap-1 rounded text-11.5 font-semibold text-mute hover:text-ink ${FOCUS_RING}`}>
          <Icon name="chevR" size={13} className="transition-transform group-open:rotate-90" />
          {t("beds.details")}        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {/* G2-A2 (D10): the card's clock, so a stale input's age is the server's. */}
          <News2 news2={patient?.news2} nowMs={nowMs} />
          {monitor?.entry || patient?.shadow ? (
            <div data-monitor-slot="">
              {monitor?.entry ? (
                <MonitorStrip variant="compact" entry={monitor.entry} nowMs={monitor.nowMs} fetchedAtMs={monitor.fetchedAtMs}
                  maxAgeS={monitor.maxAgeS} feedOk={monitor.feedOk} unreadable={monitor.unreadable} />
              ) : null}
              {patient?.shadow ? (
                <div data-shadow-tag="" className={monitor?.entry ? "mt-1.5" : ""}>
                  {/* Wraps: the ru words are wider than a 390 px card on one line in a large type size. */}
                  <Tag tone="warn" className="!whitespace-normal">
                    {shadowTagText(t, patient.shadow, boardKnown(connection), nowMs)}
                  </Tag>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}
