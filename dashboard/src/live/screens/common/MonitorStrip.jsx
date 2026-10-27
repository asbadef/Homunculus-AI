// src/live/screens/common/MonitorStrip.jsx — Aşama A's monitor strip and its feed chip.
//
// UNVALIDATED research decoding of the bedside monitor's network broadcast, shown to clinicians,
// fed to nothing (data/shadowStore.js). The look says so before the words do (Decision 14):
//   * a DASHED border and an amber DOĞRULANMAMIŞ tag — in this interface amber means "the screen
//     cannot vouch for this" (BoardState.jsx's RAIL note), which is exactly the claim;
//   * values in plain `ink`, never in the vital identity colours (`text-v-hr`…), so a monitor value
//     is never dressed as an engine vital; no risk pill, no rail, no green, nothing coloured by a
//     value;
//   * every value with its age; an old one is a dash and "eski", never a number; NBP with the time
//     its value last changed, written "≤" because the cuff measured then or earlier — or, while no
//     change has been seen, the monitor's current NBP with «ölçüm zamanı bilinmiyor» in amber, and
//     no "≤" and no age (NBP-2, D4);
//   * NO live region and no alert: values change every 5 s and a live region would talk over
//     everything. The feed's trouble is a static `Note`, as BoardStrip's DEGRADED is.
// The lock screen never shows any of this (boundaries.test.js).
import React, { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { Note, Pill, StatusPill, Tag } from "../../ui/index.js";
import {
  DISPLAY_MAX_AGE_S, PARAM_ORDER, STATUS_KEY, UNIT_KEY, ageText, cellOf, chipCounts, feedSentenceKey, lastSeenMs,
  readAgeS,
} from "./monitor.js";

const KNOWN = new Set(PARAM_ORDER);

/** NBP's numbers and the time its value last changed — an upper bound of the measurement ("≤"). */
function NbpValue({ cell, unit }) {
  const { t } = useI18n();
  const { systolic, diastolic, mean } = cell;
  const time = hhmm(cell.changedAtMs);
  const age = ageText(t, cell.measuredAgeS);
  return (
    <>
      {/* The numbers and the unit never break; the measured words may wrap, but their "≤" stays with the time (a no-break space in the string). */}
      <span aria-hidden="true" className="whitespace-nowrap">{`${systolic}/${diastolic} (${mean})`}</span>
      <small aria-hidden="true" className="ml-0.5 whitespace-nowrap font-text text-10.5 font-semibold text-mute">{unit}</small>
      <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-mute">
        {t("monitor.nbpMeasured", { time, age })}
      </small>
      <span className="sr-only">{t("monitor.nbpSaid", { systolic, diastolic, mean, unit, time, age })}</span>
    </>
  );
}

/** NBP the monitor shows now, whose change the hub has not seen (NBP-2, D4): the numbers and the unit
 *  as the timed form draws them, and «ölçüm zamanı bilinmiyor» in the attention tone — this interface's
 *  "cannot vouch" (Decision 14) — rather than the muted one. No "≤", no time and no age: there is no
 *  measurement time to bound, and the packet's age would read as the measurement's. */
function NbpUntimedValue({ cell, unit }) {
  const { t } = useI18n();
  const { systolic, diastolic, mean } = cell;
  return (
    <>
      <span aria-hidden="true" className="whitespace-nowrap">{`${systolic}/${diastolic} (${mean})`}</span>
      <small aria-hidden="true" className="ml-0.5 whitespace-nowrap font-text text-10.5 font-semibold text-mute">{unit}</small>
      <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-att-ink">{t("monitor.nbpUntimed")}</small>
      <span className="sr-only">{t("monitor.nbpUntimedSaid", { systolic, diastolic, mean, unit })}</span>
    </>
  );
}

function Cell({ param, nowMs, fetchedAtMs, maxAgeS, feedOk, full }) {
  const { t } = useI18n();
  const cell = cellOf(param, { nowMs, fetchedAtMs, maxAgeS, feedOk });
  const label = t(`monitor.p.${param.parameter}`);
  const unit = UNIT_KEY[param.unit] ? t(UNIT_KEY[param.unit]) : param.unit;
  const age = ageText(t, cell.ageS);
  const said = age ? <span className="sr-only">{` ${t("monitor.age", { age })}`}</span> : null;
  const nbp = param.parameter === "nbp";
  return (
    // NBP's line is two cells wide: three numbers, a unit and the time they changed.
    <div className={nbp ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="flex flex-wrap items-center gap-1 font-text text-10 font-bold uppercase leading-[normal] tracking-[.06em] text-mute">
        {label}
        {param.partial ? <StatusPill tone="neutral">{t("monitor.partial")}</StatusPill> : null}
      </dt>
      <dd className="m-0 font-data text-14 font-bold text-ink">
        {cell.kind === "nbp" ? (
          <NbpValue cell={cell} unit={unit} />
        ) : cell.kind === "nbp_untimed" ? (
          <NbpUntimedValue cell={cell} unit={unit} />
        ) : cell.kind === "value" ? (
          <>
            {cell.value}
            <small className="ml-0.5 font-text text-10.5 font-semibold text-mute">{unit}</small>
            {age ? <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-mute">{age}</small> : null}
            {said}
          </>
        ) : cell.kind === "invalid" ? (
          <>
            <span aria-hidden="true">***</span>
            <span className="sr-only">{t("monitor.invalid")}</span>
            {age ? <small aria-hidden="true" className="ml-1 font-text text-10.5 font-semibold text-mute">{age}</small> : null}
            {said}
          </>
        ) : nbp && cell.lastAt === null ? (
          <>
            <span aria-hidden="true">—</span>
            <small className="ml-1 font-text text-10.5 font-semibold text-mute">{t("monitor.nbpWaiting")}</small>
          </>
        ) : (
          <>
            <span aria-hidden="true">—</span>
            <small className="ml-1 font-text text-10.5 font-semibold text-att-ink">{t("monitor.old", { age: age ?? "—" })}</small>
          </>
        )}
      </dd>
      {full && param.evidence ? (
        <dd className="m-0 font-text text-10.5 text-mute">{t(`monitor.ev.${param.evidence}`)}</dd>
      ) : null}
    </div>
  );
}

/** What a device is doing, when that replaces its values. A status this build does not know is
 *  read as "unknown": its values are not drawn (the server's word for a device that may not be
 *  sending, read the safe way). */
function statusSentence(t, entry) {
  if (entry.status === "streaming") return null;
  const key = STATUS_KEY[entry.status] ?? STATUS_KEY.unknown;
  if (entry.status !== "silent") return t(key);
  const seen = lastSeenMs(entry);
  return seen === null ? t("monitor.silentNoTime") : t("monitor.silent", { time: hhmm(seen) });
}

/**
 * One device's strip. `entry`: a bed monitor card or an unassigned card from the board answer.
 * `variant`: "compact" (a bed card: the short note) or "full" (the patient and device screens: the
 * whole note and the evidence per parameter). `nowMs`/`fetchedAtMs` age every value on screen;
 * `feedOk` false (the forwarder silent, the collector gone) shows every cell as a dash.
 * `title` replaces the heading ("{bed} · monitor"), which always carries the "unvalidated" word.
 * `unreadable`: the strip's last poll failed or its answer is too old — said in words on the strip
 * itself, while the values it still holds age out.
 * `stage`: the board answer's stage. At Aşama B's «rules» the whole note is `monitor.fullRules` — the
 * shadow engine computes an advisory score from these values, so «no score is produced» would be false;
 * at any other stage (and when it is not given) it is `monitor.full`. The short note does not change.
 */
export function MonitorStrip({
  entry, variant = "compact", nowMs, fetchedAtMs, maxAgeS = DISPLAY_MAX_AGE_S, feedOk = true, title, level = 3,
  unreadable = false, stage, className = "", children,
}) {
  const { t } = useI18n();
  const id = useId();
  if (!entry) return null;
  const full = variant === "full";
  const Heading = `h${Math.min(6, Math.max(2, level))}`;
  const sentence = statusSentence(t, entry);
  const params = (entry.parameters ?? []).filter((p) => KNOWN.has(p.parameter));
  return (
    <section aria-labelledby={id} data-monitor-strip="" className={`relative rounded-ctl border border-dashed border-line2 px-2.5 py-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Heading id={id} className="m-0 font-text text-11.5 font-bold leading-[normal] text-ink">
          {title ? `${title} · ${t("monitor.title")}` : t("monitor.title")}
        </Heading>
        <Tag tone="warn">{t("monitor.tag")}</Tag>
      </div>
      {children}
      {unreadable ? <p className="m-0 mt-1 text-11.5 font-semibold text-att-ink">{t("monitor.unreadable")}</p> : null}
      {sentence ? (
        <p className="m-0 mt-1.5 text-12.5 font-semibold text-mute">{sentence}</p>
      ) : params.length > 0 ? (
        <dl className="m-0 mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1.5 min-[641px]:grid-cols-[repeat(auto-fill,minmax(92px,1fr))]">
          {params.map((p) => (
            <Cell key={p.parameter} param={p} nowMs={nowMs} fetchedAtMs={fetchedAtMs} maxAgeS={maxAgeS}
              feedOk={feedOk} full={full} />
          ))}
        </dl>
      ) : (
        <p className="m-0 mt-1.5 text-12.5 font-semibold text-mute">{t("monitor.noValues")}</p>
      )}
      <p className="m-0 mt-1.5 text-10.5 leading-[normal] text-mute">{t(full ? fullNoteKey(stage) : "monitor.short")}</p>
    </section>
  );
}

/** The whole note's key for a board answer's stage: at «rules» the shadow engine scores the values (advice,
 *  alarm off), and the note says so; anywhere else, that nothing is scored. The Settings legend reads it too. */
export const fullNoteKey = (stage) => (stage === "rules" ? "monitor.fullRules" : "monitor.full");

/** Whether a board answer is a strip that is on — the only one a screen draws anything for. `rules` is
 *  Aşama B's running stage (the route overwrites board_view's "shadow" with it): the same strip, plus
 *  the shadow engine's answer on the patient cards. */
export const stripOn = (data) => data?.stage === "shadow" || data?.stage === "rules";

/** Whether the strip's state cannot be vouched for now: the last poll failed, or the answer it
 *  holds is older than the display limit (a poll that hangs, a hidden tab, a sleeping PC), or its
 *  age is unknown. A screen then says "cannot read" and still lets the values it has age out. */
export function readUnknown({ phase, fetchedAtMs }, nowMs, maxAgeS = DISPLAY_MAX_AGE_S) {
  if (phase === "unreadable") return true;
  const age = readAgeS(nowMs, fetchedAtMs);
  return age === null || age > maxAgeS;
}

/**
 * The beds screen's monitor chip, beside FeedHealth and separately labelled. Counts only from a
 * read it can vouch for: the last poll answered, no longer ago than `maxAgeS`, and the feed is ok.
 * Otherwise its sentence — "cannot read the strip", "no monitor data arriving", "the collector is
 * not connected" — and never a count of the last answer. A first read that failed says it cannot
 * read the strip; a strip that is off, or not yet read, draws nothing: nothing is being claimed.
 */
export function MonitorFeedChip({ data, phase, nowMs, fetchedAtMs, maxAgeS = DISPLAY_MAX_AGE_S, className = "" }) {
  const { t } = useI18n();
  if (!data && phase === "unreadable") return <Note className={className}>{t("monitor.unreadable")}</Note>;
  if (!stripOn(data)) return null;
  if (readUnknown({ phase, fetchedAtMs }, nowMs, maxAgeS)) return <Note className={className}>{t("monitor.unreadable")}</Note>;
  const feedKey = feedSentenceKey(data.feed?.state);
  const last = Date.parse(data.feed?.last_post_at ?? "");
  const tableNote = data.table?.status && data.table.status !== "ok"
    ? <Note className={className}>{t("monitor.tableMissing")}</Note> : null;
  if (feedKey) {
    return (
      <>
        <Note className={className}>{t(feedKey, { time: Number.isFinite(last) ? hhmm(last) : "—" })}</Note>
        {tableNote}
      </>
    );
  }
  const counts = chipCounts(data);
  if (!counts) return tableNote;
  const parts = [
    t("monitor.chipCounts", { streaming: counts.streaming, total: counts.total }),
    counts.silent > 0 ? t("monitor.chipSilent", { count: counts.silent }) : null,
    counts.standby > 0 ? t("monitor.chipStandby", { count: counts.standby }) : null,
    counts.unassigned > 0 ? t("monitor.chipUnassigned", { count: counts.unassigned }) : null,
  ].filter(Boolean);
  return (
    <>
      {/* Wraps: the az and ru counts are wider than a 390 px screen on one line. */}
      <Pill icon="wifi" className={`!whitespace-normal ${className}`}>
        <span className="sr-only">{`${t("monitor.chipTitle")}: `}</span>
        {parts.join(" · ")}
      </Pill>
      {tableNote}
    </>
  );
}
