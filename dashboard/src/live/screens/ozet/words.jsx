// src/live/screens/ozet/words.jsx — the words «Yönetici özeti» (G4-02) and «Kalite göstergeleri» (G4-03) share: the
// period's names, a «—» with its reason, and a duration in minutes and seconds. One thing has one name on both pages.
import React from "react";

/** Each period's switch label and the phrase a card or a box names it by (`ozet.period.*`). */
export const PERIOD_KEYS = Object.freeze({
  1: { label: "ozet.period.d1", text: "ozet.period.text1" },
  7: { label: "ozet.period.d7", text: "ozet.period.text7" },
  30: { label: "ozet.period.d30", text: "ozet.period.text30" },
});

/** A duration (ozet.js `durationOf`: `{m, s}`, `m` null under a minute) in words. */
export const durationText = (t, d) => (d.m === null ? t("ozet.q.sec", { n: d.s }) : t("ozet.q.minSec", { m: d.m, s: d.s }));

/** «—» and why: what every number that is not real is, on a card, in a cell or in a box (Decision 18). */
export function Missing({ t, why, big = false }) {
  return (
    <span data-missing={why}>
      <span className={big ? "font-data text-23 font-bold" : "font-data font-bold"}>—</span>{" "}
      <span className="text-12 font-normal text-mute">{t(`ozet.why.${why}`)}</span>
    </span>
  );
}
