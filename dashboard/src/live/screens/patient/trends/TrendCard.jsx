// src/live/screens/patient/trends/TrendCard.jsx — one trend card: the latest value of each of its
// channels, how it moved since the previous measurement, how long ago, and (Task 11) a 24-hour mini
// chart.
//
// The frame and its badge are the ENGINE'S NEWS2 points for the latest value (spec D2), through
// `news2Tone` — never a judgement made here: a card handed `news2_points: 3` frames red whatever the
// number reads. The pill is the engine's `within_own_normal` (D3): it never silences the frame and
// the frame never hides it. The delta is the engine's, printed with an arrow for its sign.
//
// The badge belongs to a READING, not to the card: it sits on the first channel's row (systolic's,
// on the pressure card), so the reader sees whose points they are; MAP's row never carries one and
// MAP never frames the card. A NEWS2 channel (the engine sent it bands) whose latest value arrived
// with no points says so — "NEWS2: —", in attention tone, with the reason for a screen reader — and
// frames nothing: a card must not read as calm because the engine's answer was missing.
//
// VALUES ARE PRINTED IN INK. The channel's identity colour stays on the title (and, from Task 11,
// on the line); daylight's `--v-map` equals `--crit`, and a calm pressure card must not show
// critical-red numbers (the bed card and the measured-values box print in ink for the same reason).
//
// `nowMs` is required: the patient screen's `useBoardNow` instant. Without a finite one no age is
// printed — never the browser's clock (X7; `ageText`).
//
// The frame is `border-2` in every tone, so nothing moves by a pixel when the tone changes.
//
// A button only when it can open the big chart (`onOpen`).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Pill, Tag } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { ageText } from "../ageText.js";
import { cardTitle } from "./cards.js";
import { news2Tone } from "./news2Tone.js";

const FRAME = { none: "border-2 border-line", mid: "border-2 border-mid", crit: "border-2 border-crit" };
const BADGE = { mid: "warn", crit: "crit" };

/** The engine's delta in its parts — the arrow it is drawn with, the signed number, and the word a
 *  screen reader gets in place of the arrow; null for no number. Formatting only: the sign picks the
 *  arrow, nothing is computed from the value. */
function deltaParts(delta) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta > 0) return { arrow: "↑", number: `+${delta}`, word: "patient.trendsDeltaUp" };
  if (delta < 0) return { arrow: "↓", number: `−${Math.abs(delta)}`, word: "patient.trendsDeltaDown" };
  return { arrow: "→", number: "0", word: "patient.trendsDeltaSame" };
}

/** The engine's delta as the card prints it: "↑ +6", "↓ −3", "→ 0"; null for no number. */
export function deltaText(delta) {
  const parts = deltaParts(delta);
  return parts ? `${parts.arrow} ${parts.number}` : null;
}

/** The delta as a screen reader gets it: "rose +6 (vs the previous)", "unchanged (vs the previous)". */
function Delta({ delta }) {
  const { t } = useI18n();
  const parts = deltaParts(delta);
  if (!parts) return null;
  const spoken = parts.word === "patient.trendsDeltaSame" ? t(parts.word) : `${t(parts.word)} ${parts.number}`;
  return (
    <span className="ml-1 font-data text-12 font-semibold text-ink">
      <span aria-hidden="true">{t("patient.trendsDelta", { delta: deltaText(delta) })}</span>
      <span className="sr-only">{t("patient.trendsDelta", { delta: spoken })}</span>
    </span>
  );
}

/** "NEWS2 +3" for the engine's points, "NEWS2: —" for a NEWS2 channel it sent none for. */
function Badge({ tone, points, unscored }) {
  const { t } = useI18n();
  if (tone) return <Tag tone={BADGE[tone]}>{t("patient.trendsFrameBadge", { points })}</Tag>;
  if (!unscored) return null;
  return (
    <Tag tone="warn">
      <span aria-hidden="true">{t("patient.trendsPointsUnknown")}</span>
      <span className="sr-only">{t("patient.trendsPointsUnknownSr")}</span>
    </Tag>
  );
}

function Reading({ series, channel, nowMs, named, badge }) {
  const { t } = useI18n();
  const latest = channel?.latest ?? null;
  if (!latest) return null;
  const age = ageText(t, latest.ts, nowMs);
  return (
    <span className="mt-1 block" data-series={series.key}>
      {named ? <><span className="text-11 font-semibold text-mute">{t(series.labelKey)}</span>{" "}</> : null}
      <b className="font-data text-20 font-bold text-ink">{latest.value}</b>{" "}
      <small className="text-11 font-semibold text-mute">{t(series.unitKey)}</small>
      {/* No previous measurement is `null`; any other non-number is printed as nothing at all. */}
      {latest.delta === null ? (
        <>{" "}<span className="ml-1 font-data text-12 font-semibold text-ink">{t("patient.trendsSingle")}</span></>
      ) : <>{" "}<Delta delta={latest.delta} /></>}
      {age ? <>{" "}<span className="ml-1 text-11 text-mute">{age}</span></> : null}
      {badge ? <>{" "}{badge}</> : null}
    </span>
  );
}

export function TrendCard({ card, channels, nowMs, onOpen }) {
  const { t } = useI18n();
  const primary = channels?.[card.series[0].key] ?? null;
  const latest = primary?.latest ?? null;
  const points = latest?.news2_points ?? null;
  const tone = news2Tone(points);
  // A NEWS2 channel is one the engine sent bands for; "scored" is a number it sent, whatever it is.
  const scored = typeof points === "number" && Number.isFinite(points);
  const unscored = Boolean(latest) && Array.isArray(primary.bands?.news2) && !scored;
  const measured = card.series.some((s) => channels?.[s.key]?.latest);
  const title = cardTitle(t, card);
  const Wrapper = onOpen ? "button" : "div";
  return (
    <li className="min-w-0">
      <Wrapper
        type={onOpen ? "button" : undefined}
        onClick={onOpen}
        data-frame={tone ?? "none"}
        className={`block w-full min-w-0 rounded-box bg-card px-3 py-2.5 text-left ${FRAME[tone ?? "none"]} ${onOpen ? FOCUS_RING : ""}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <span data-title="" className={`text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] ${card.series[0].color}`}>{title}</span>
          {latest?.within_own_normal === true ? <Pill icon="user">{t("patient.trendsOwnNormalPill")}</Pill> : null}
        </span>
        {measured ? (
          card.series.map((s, i) => (
            <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1}
              badge={i === 0 && (tone || unscored) ? <Badge tone={tone} points={points} unscored={unscored} /> : null} />
          ))
        ) : (
          <span className="mt-1 block text-12.5 text-mute">{t("patient.trendsNoData")}</span>
        )}
        {onOpen ? <>{" "}<span className="sr-only">{t("patient.trendsOpen", { channel: title })}</span></> : null}
      </Wrapper>
    </li>
  );
}
