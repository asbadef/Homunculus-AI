// src/live/screens/patient/trends/TrendLegend.jsx — what the big chart's marks mean, in words. Colour
// is never the only carrier (spec §7): every swatch has its name beside it, the two marks differ in
// shape, and the source of the NEWS2 rows is the one the SERVER named (`bands_source`).
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";

function Swatch({ className, dashed = false }) {
  return (
    <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" className="shrink-0">
      <rect x="0" y="0" width="18" height="10" className={className} />
      {dashed ? <line x1="0" x2="18" y1="0.5" y2="0.5" className="stroke-pri" strokeDasharray="2 3" /> : null}
    </svg>
  );
}

function Glyph({ kind, color = "", hollow = false }) {
  return (
    <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" className={`shrink-0 ${color}`}>
      {kind === "alarm" ? <path d="M3,9L9,1L15,9Z" className="fill-crit" /> : null}
      {kind === "antibiotic" ? <rect x="5" y="1" width="8" height="8" transform="rotate(45 9 5)" className="fill-pri" /> : null}
      {kind === "points" ? (
        <>
          <line x1="3" x2="15" y1="5" y2="5" stroke="currentColor" strokeDasharray="3 2" />
          <circle cx="3" cy="5" r="2.5" fill="currentColor" />
          <circle cx="15" cy="5" r="2.5" fill="currentColor" />
        </>
      ) : null}
      {kind === "dot" ? (
        <circle cx="9" cy="5" r="3" fill={hollow ? undefined : "currentColor"} className={hollow ? "fill-app" : undefined}
          stroke="currentColor" strokeWidth={hollow ? 1.5 : 0} />
      ) : null}
    </svg>
  );
}

const Item = ({ children }) => <li className="flex items-center gap-1.5">{children}</li>;
const LIST = "m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-11.5 text-mute";

/** The notes that qualify what is drawn or listed, in words — shared by the chart's legend and by the
 *  table (which has no swatches, but the same numbers and the same caveats):
 *    * a series drawn over another's NEWS2 bands (MAP on the pressure card) is not scored by NEWS2 —
 *      said in words, so nobody reads the systolic rows as MAP's thresholds. The ENGINE decides which
 *      channel has bands (`bands.news2` null for MAP and lactate); this only notices the difference;
 *    * the server's own flag: its read of the marks stopped at its limit (api/trends.py);
 *    * a channel the server thinned for drawing, and from how many. */
function NoteItems({ card, channels, truncated }) {
  const { t } = useI18n();
  const primary = channels[card.series[0].key] ?? null;
  const scored = Array.isArray(primary?.bands?.news2);
  const unbanded = scored ? card.series.slice(1).filter((s) => channels[s.key] && !Array.isArray(channels[s.key].bands?.news2)) : [];
  const thinned = card.series.filter((s) => channels[s.key]?.thinned);
  return (
    <>
      {unbanded.map((s) => (
        <Item key={`unbanded-${s.key}`}>
          {t("patient.trendsLegendNoBand", { channel: t(s.labelKey), scored: t(card.series[0].labelKey) })}
        </Item>
      ))}
      {truncated ? <Item>{t("patient.trendsLegendMarksTruncated")}</Item> : null}
      {thinned.map((s) => (
        <Item key={s.key}>
          {t("patient.trendsThinned", { channel: t(s.labelKey), kept: channels[s.key].points.length, total: channels[s.key].total_points })}
        </Item>
      ))}
    </>
  );
}

/** What the table view keeps of the legend: no swatches (the table has no bands or glyphs), but every
 *  note that says how far to trust the numbers — and what a mark row is: an alarm's FIRST detection. */
export function TrendNotes({ card, channels, truncated = false }) {
  const { t } = useI18n();
  return (
    <ul role="list" data-notes="" className={LIST}>
      <Item>{t("patient.trendsLegendAlarm")}</Item>
      <NoteItems card={card} channels={channels} truncated={truncated} />
    </ul>
  );
}

export function TrendLegend({ card, channels, source, truncated = false }) {
  const { t } = useI18n();
  const primary = channels[card.series[0].key] ?? null;
  const scored = Array.isArray(primary?.bands?.news2);
  return (
    // role="list": a list with its bullets removed (`list-none`) stops being one for VoiceOver.
    <ul role="list" data-legend="" className={LIST}>
      {scored ? (
        <Item>
          {t("patient.trendsBandNews2", { source })}:
          <Swatch className="fill-band-mid" /> {t("patient.trendsBandPoints12")}
          <Swatch className="fill-band-crit" /> {t("patient.trendsBandPoints3")}
        </Item>
      ) : null}
      {primary?.bands?.own_normal ? <Item><Swatch className="fill-band-n" dashed /> {t("patient.trendsBandOwn")}</Item> : null}
      <Item><Glyph kind="points" color={card.series[0].color} /> {t("patient.trendsLegendPoints")}</Item>
      {card.series.length > 1 ? card.series.map((s) => (
        <Item key={s.key}><Glyph kind="dot" color={s.color} hollow={s.hollow} /> {t(s.labelKey)}</Item>
      )) : null}
      {/* ▲ is a finding's FIRST DETECTION for this patient (its `first_seen` stamp), not every
          alarm episode: the engine's active alerts never clear a kind today (O17). */}
      <Item><Glyph kind="alarm" /> {t("patient.trendsLegendAlarm")}</Item>
      <Item><Glyph kind="antibiotic" /> {t("patient.trendsMarkerAntibiotic")}</Item>
      <NoteItems card={card} channels={channels} truncated={truncated} />
    </ul>
  );
}
