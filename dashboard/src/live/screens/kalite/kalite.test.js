// kalite.test.js — G4-03 «Kalite göstergeleri» (spec D4, D5): the answer as the page reads it — its shape (one bad
// figure makes the whole read a failure), the rows in order with «Birimi belli olmayan» and «Toplam», a row's figures,
// a rate and a median over nothing, a selection, and the snooze reasons' words. Synthetic answers (kalite.testutil.js).
import { describe, it, expect, vi } from "vitest";
import { SNOOZE_REASONS } from "../../data/snooze.js";
import { WHY, noSource, okSource } from "../ozet/ozet.js";
import { REASON_KEYS as DIALOG_REASON_KEYS } from "../alarms/SnoozeDialog.jsx";
import { REASON_KEYS, TOTAL, UNPLACED, isQualityAnswer, qualityPage, readQuality, selectionOf } from "./kalite.js";
import { ANSWER, NEO, NOTHING, REA, SCOPED } from "./kalite.testutil.js";

describe("the answer this page reads", () => {
  it("is the engine's shape — and one malformed figure makes the whole read a failure", () => {
    for (const answer of [ANSWER, SCOPED, NOTHING]) expect(isQualityAnswer(answer)).toBe(true);
    const [neo] = ANSWER.units;
    const broken = [
      { ...ANSWER, days: 2 }, { ...ANSWER, scoped: undefined }, { ...ANSWER, generated_at: "dün" },
      { ...ANSWER, window_from: null }, { ...ANSWER, coverage: { episodes: 9, placed: 7 } },
      { ...ANSWER, units: [{ ...neo, unit_id: " " }] },
      { ...ANSWER, units: [{ ...neo, alarms: { ...neo.alarms, answered_rate: 1.2 } }] },
      { ...ANSWER, units: [{ ...neo, alarms: { ...neo.alarms, per_kind: [{ kind: "news2", episodes: "1" }] } }] },
      { ...ANSWER, units: [{ ...neo, handovers: undefined }] },
      { ...ANSWER, unplaced: { ...ANSWER.unplaced, snoozes: { ...ANSWER.unplaced.snoozes, by_reason: { OTHER: 1 } } } },
      { ...ANSWER, hospital: { ...ANSWER.hospital, rrt: { count: -1 } } },
      null, [], "{}",
    ];
    for (const answer of broken) expect(isQualityAnswer(answer), JSON.stringify(answer)?.slice(0, 90)).toBe(false);
  });

  it("is read with GET /quality for the period", () => {
    const api = { qualityIndicators: vi.fn().mockReturnValue("read") };
    expect(readQuality(api, 30)).toBe("read");
    expect(api.qualityIndicators).toHaveBeenCalledWith(30);
  });
});

describe("the page", () => {
  it("has no number while there is no answer — only why", () => {
    expect(qualityPage(noSource(WHY.loading))).toEqual({ ok: false, why: "loading" });
    expect(qualityPage(noSource(WHY.noRight))).toEqual({ ok: false, why: "noRight" });
  });

  it("draws the units in the answer's order, then the unplaced row, then the total", () => {
    const page = qualityPage(okSource(ANSWER));
    expect(page.rows.map((row) => [row.key, row.name])).toEqual([[NEO, "Neonatal"], [REA, "Reanimasiya"]]);
    expect([page.unplaced.key, page.unplaced.handovers, page.total.key]).toEqual([UNPLACED, null, TOTAL]);
    expect(page).toMatchObject({ ok: true, scoped: false, truncated: false, coverage: { episodes: 9, placed: 7, unplaced: 2 },
      generatedAtMs: Date.parse(ANSWER.generated_at), windowFromMs: Date.parse(ANSWER.window_from) });
  });

  it("gives a row's figures: a whole percent, minutes and seconds, the self-resolved apart", () => {
    const rea = qualityPage(okSource(ANSWER)).rows[1];
    expect(rea.alarms).toMatchObject({ episodes: 6, answered: 3, settled: 5, pct: 60, median: { m: 3, s: 0 },
      p90: { m: 10, s: 0 }, escalated: 1, unanswered: 2, selfResolved: 1, pending: 1 });
    expect(rea.alarms.perKind[1]).toEqual({ kind: "spo2_low", episodes: 2, answered: 0, escalated: 0, unanswered: 2, median: null });
    expect(rea.snoozes.byReason.map((r) => r.reason)).toEqual([...SNOOZE_REASONS]);
    expect(rea.snoozes).toMatchObject({ count: 2, high: 1, moderate: 1, medianMinutes: 12.5 });
    expect(rea.rrt).toBe(1);
    expect(rea.handovers).toEqual({ opened: 6, countersigned: 2, waiting: 1, expired: 2, median: { m: 10, s: 0 },
      p90: { m: 15, s: 0 } });
  });

  it("says nothing settled and nothing answered as null, never 0", () => {
    const { total } = qualityPage(okSource(NOTHING));
    expect(total.alarms).toMatchObject({ episodes: 0, pct: null, median: null, p90: null });
    expect(total.handovers).toMatchObject({ opened: 0, median: null, p90: null });
    expect(total.snoozes.medianMinutes).toBeNull();
  });

  it("selects a unit, the unplaced row or the total; a key the answer no longer holds is the total", () => {
    const page = qualityPage(okSource(ANSWER));
    expect(selectionOf(page, REA).name).toBe("Reanimasiya");
    expect(selectionOf(page, UNPLACED).key).toBe(UNPLACED);
    expect(selectionOf(page, TOTAL).key).toBe(TOTAL);
    expect(selectionOf(page, "gone").key).toBe(TOTAL);
    expect(selectionOf(qualityPage(okSource(SCOPED)), UNPLACED).key).toBe(TOTAL);
    expect(selectionOf(qualityPage(noSource(WHY.loading)), TOTAL)).toBeNull();
  });

  it("names the snooze reasons with the alarm screen's own words", () => {
    expect(REASON_KEYS).toEqual(DIALOG_REASON_KEYS);
    expect(Object.keys(REASON_KEYS).sort()).toEqual([...SNOOZE_REASONS].sort());
  });
});
