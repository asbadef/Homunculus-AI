// src/live/screens/patient/trends/TrendCard.jsx — one trend card: the latest value of each of its
// channels, how it moved since the previous measurement, how long ago, and (Task 11) a 24-hour mini
// chart.
//
// The frame and its badge are the ENGINE'S NEWS2 points for the latest value (spec D2), through
// `news2Tone` — never a judgement made here: a card handed `news2_points: 3` frames red whatever the
// number reads. The pill is the engine's `within_own_normal` (D3): it never silences the frame and
// the frame never hides it. The delta is the engine's, printed with an arrow for its sign.
//
// A button only when it can open the big chart (`onOpen`).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Pill, Tag } from "../../../ui/index.js";
import { FOCUS_RING } from "../../../ui/focus.js";
import { ageText } from "../ageText.js";
import { cardTitle } from "./cards.js";
import { news2Tone } from "./news2Tone.js";

const FRAME = { none: "border border-line", mid: "border-2 border-mid", crit: "border-2 border-crit" };
const BADGE = { mid: "warn", crit: "crit" };

/** The engine's delta as the card prints it: "↑ +6", "↓ −3", "→ 0"; null for no number. */
export function deltaText(delta) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (delta > 0) return `↑ +${delta}`;
  if (delta < 0) return `↓ −${Math.abs(delta)}`;
  return "→ 0";
}

function Reading({ series, channel, nowMs, named }) {
  const { t } = useI18n();
  const latest = channel?.latest ?? null;
  if (!latest) return null;
  const delta = deltaText(latest.delta);
  const age = ageText(t, latest.ts, nowMs);
  return (
    <span className="mt-1 block" data-series={series.key}>
      {named ? <span className="mr-1.5 text-11 font-semibold text-mute">{t(series.labelKey)}</span> : null}
      <b className={`font-data text-20 font-bold ${series.color}`}>{latest.value}</b>
      <small className="ml-1 text-11 font-semibold text-mute">{t(series.unitKey)}</small>
      <span className="ml-2 font-data text-12 font-semibold text-ink">
        {delta ? t("patient.trendsDelta", { delta }) : t("patient.trendsSingle")}
      </span>
      {age ? <span className="ml-2 text-11 text-mute">{age}</span> : null}
    </span>
  );
}

export function TrendCard({ card, channels, nowMs, onOpen }) {
  const { t } = useI18n();
  const primary = channels?.[card.series[0].key] ?? null;
  const points = primary?.latest?.news2_points ?? null;
  const tone = news2Tone(points);
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
          <span className={`text-10.5 font-bold uppercase leading-[normal] tracking-[.06em] ${card.series[0].color}`}>{title}</span>
          {tone ? <Tag tone={BADGE[tone]}>{t("patient.trendsFrameBadge", { points })}</Tag> : null}
          {primary?.latest?.within_own_normal === true ? <Pill icon="user">{t("patient.trendsOwnNormalPill")}</Pill> : null}
        </span>
        {measured ? (
          card.series.map((s) => (
            <Reading key={s.key} series={s} channel={channels?.[s.key]} nowMs={nowMs} named={card.series.length > 1} />
          ))
        ) : (
          <span className="mt-1 block text-12.5 text-mute">{t("patient.trendsNoData")}</span>
        )}
        {onOpen ? <span className="sr-only">{t("patient.trendsOpen", { channel: title })}</span> : null}
      </Wrapper>
    </li>
  );
}
