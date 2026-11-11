// pharmacyModel.test.js — «Eczane» (G3-04, spec §3.1, §5.1, §6, D6, D12–D14): the freshness rule, the durations,
// each antibiotic state's key and tone with its past-tense twin, the vasopressor lines, and no tone on creatinine or
// the fluid balance. The model reads the server's state and never recomputes it.
import { describe, it, expect } from "vitest";
import {
  PHARMACY_FRESH_MS, antibioticCell, creatinineCell, durationParts, fluidCell, isFresh, msOf, pressorLines,
} from "./pharmacyModel.js";
import { GIVEN, LATE, MET, MIN, MISSED, NOW, RUNNING, UNMEASURED, answer, at, row } from "./eczane.testutil.js";

describe("whether the list is fresh", () => {
  it("is fresh while the last read succeeded and its answer is at most three polls old", () => {
    expect(PHARMACY_FRESH_MS).toBe(90_000);
    expect(isFresh(answer(), null, NOW)).toBe(true);
    expect(isFresh(answer(), null, NOW + 90_000)).toBe(true);
    expect(isFresh(answer(), null, NOW + 90_001)).toBe(false);
    expect(isFresh(answer(), null, NOW - 5_000)).toBe(true);          // the server's clock a little ahead of the screen's
  });

  it("is not fresh after a failed read, whatever the answer's age", () => {
    expect(isFresh(answer(), new Error("503"), NOW)).toBe(false);
  });

  it("is not fresh with no answer, an answer without its time, or no clock", () => {
    expect(isFresh(null, null, NOW)).toBe(false);
    expect(isFresh(answer({ now: null }), null, NOW)).toBe(false);
    expect(isFresh(answer({ now: "dün" }), null, NOW)).toBe(false);
    expect(isFresh(answer(), null, Number.NaN)).toBe(false);
    expect(isFresh(answer(), null, undefined)).toBe(false);
  });
});

describe("a duration", () => {
  it("counts whole minutes down, as the engine's alarm text does", () => {
    expect(durationParts(0)).toEqual({ key: "eczane.dur.under", params: {} });
    expect(durationParts(59)).toEqual({ key: "eczane.dur.under", params: {} });
    expect(durationParts(60)).toEqual({ key: "eczane.dur.min", params: { n: 1 } });
    expect(durationParts(119 * 60)).toEqual({ key: "eczane.dur.min", params: { n: 119 } });
    expect(durationParts(119 * 60 + 59)).toEqual({ key: "eczane.dur.min", params: { n: 119 } });
    expect(durationParts(120 * 60)).toEqual({ key: "eczane.dur.hm", params: { h: 2, m: 0 } });
    expect(durationParts(125 * 60 + 30)).toEqual({ key: "eczane.dur.hm", params: { h: 2, m: 5 } });
    expect(durationParts(26 * 3600)).toEqual({ key: "eczane.dur.hm", params: { h: 26, m: 0 } });
  });

  it("is never negative, and has no text when it is no number", () => {
    expect(durationParts(-30)).toEqual({ key: "eczane.dur.under", params: {} });
    for (const bad of [Number.NaN, Infinity, null, undefined, "60"]) expect(durationParts(bad), String(bad)).toBeNull();
  });
});

describe("the antibiotic cell", () => {
  it("a passed window is crit, counts from the deadline, and says no administration is recorded", () => {
    expect(antibioticCell(MISSED, NOW, true)).toEqual({
      state: "missed", key: "eczane.ab.missed", tone: "crit", duration: { key: "eczane.dur.min", params: { n: 25 } },
      timeMs: null, second: { key: "eczane.ab.noAdmin", timeMs: NOW - 85 * MIN } });
  });

  it("a running window is high and counts to the deadline — a `false` record is worded as a `null` one", () => {
    expect(RUNNING.antibiotic.given).toBe(false);
    expect(antibioticCell(RUNNING, NOW, true)).toEqual({
      state: "running", key: "eczane.ab.running", tone: "high", duration: { key: "eczane.dur.min", params: { n: 20 } },
      timeMs: null, second: { key: "eczane.ab.noAdmin", timeMs: NOW - 40 * MIN } });
  });

  it("the durations move with the screen's clock between two polls", () => {
    expect(antibioticCell(MISSED, NOW + 3 * MIN, true).duration).toEqual({ key: "eczane.dur.min", params: { n: 28 } });
    expect(antibioticCell(RUNNING, NOW + 3 * MIN, true).duration).toEqual({ key: "eczane.dur.min", params: { n: 17 } });
  });

  it("the state word is the server's: a running row past its deadline reads under a minute left, not passed", () => {
    const cell = antibioticCell(RUNNING, NOW + 21 * MIN, true);
    expect([cell.state, cell.key, cell.tone]).toEqual(["running", "eczane.ab.running", "high"]);
    expect(cell.duration).toEqual({ key: "eczane.dur.under", params: {} });
    const early = antibioticCell(MISSED, NOW - 26 * MIN, true);          // a screen clock behind the deadline
    expect([early.state, early.key]).toEqual(["missed", "eczane.ab.missed"]);
    expect(early.duration).toEqual({ key: "eczane.dur.under", params: {} });
  });

  it("falls back to the server's own remaining seconds when the deadline or the clock cannot be read", () => {
    const noDeadline = row("S-9", { antibiotic: { ...MISSED.antibiotic, deadline: null } });
    expect(antibioticCell(noDeadline, NOW, true).duration).toEqual({ key: "eczane.dur.min", params: { n: 25 } });
    expect(antibioticCell(RUNNING, Number.NaN, true).duration).toEqual({ key: "eczane.dur.min", params: { n: 20 } });
    const neither = row("S-9", { antibiotic: { ...MISSED.antibiotic, deadline: null, remaining_sec: null } });
    expect(antibioticCell(neither, NOW, true).duration).toBeNull();          // the screen prints a dash, never «<1 dk»
  });

  it("the answered clocks and a dose with no recognition carry the administration's time and no tone", () => {
    expect(antibioticCell(MET, NOW, true)).toEqual({ state: "met", key: "eczane.ab.met", tone: null, duration: null,
      timeMs: NOW - 170 * MIN, second: null });
    expect(antibioticCell(LATE, NOW, true)).toEqual({ state: "late", key: "eczane.ab.late", tone: null, duration: null,
      timeMs: NOW - 100 * MIN, second: null });
    expect(antibioticCell(GIVEN, NOW, true)).toEqual({ state: "given", key: "eczane.ab.given", tone: null, duration: null,
      timeMs: NOW - 50 * MIN, second: null });
  });

  it("no record is «Kayıt yok», whether nothing was charted or a 0 was — never a state of its own", () => {
    const none = { state: "none", key: "eczane.noRecord", tone: null, duration: null, timeMs: null, second: null };
    expect(antibioticCell(UNMEASURED, NOW, true)).toEqual(none);
    expect(antibioticCell(row("S-9", { antibiotic: { ...UNMEASURED.antibiotic, given: false } }), NOW, true)).toEqual(none);
  });

  it("a list that is not fresh stops counting: the past tense, with the deadline as its one stamp", () => {
    expect(antibioticCell(MISSED, NOW + 10 * MIN, false)).toEqual({
      state: "missed", key: "eczane.ab.staleMissed", tone: "crit", duration: null, timeMs: NOW - 25 * MIN,
      second: { key: "eczane.ab.noAdmin", timeMs: NOW - 85 * MIN } });
    expect(antibioticCell(RUNNING, NOW + 40 * MIN, false)).toEqual({
      state: "running", key: "eczane.ab.staleRunning", tone: "high", duration: null, timeMs: NOW + 20 * MIN,
      second: { key: "eczane.ab.noAdmin", timeMs: NOW - 40 * MIN } });
  });

  it("the records with their own times stand as they are when the list is not fresh", () => {
    for (const r of [MET, LATE, GIVEN, UNMEASURED]) expect(antibioticCell(r, NOW + 10 * MIN, false)).toEqual(antibioticCell(r, NOW, true));
  });

  it("a state this build does not know is printed as the server's word, never as no record", () => {
    const cell = antibioticCell(row("S-9", { antibiotic: { ...UNMEASURED.antibiotic, state: "paused" } }), NOW, true);
    expect(cell).toEqual({ state: "paused", key: "eczane.ab.unknown", tone: null, duration: null, timeMs: null, second: null });
    expect(antibioticCell({}, NOW, true).key).toBe("eczane.ab.unknown");
    expect(antibioticCell(null, NOW, true).state).toBeNull();
  });

  it("only the two open clocks have a tone, and none is ok", () => {
    const tones = [MISSED, RUNNING, MET, LATE, GIVEN, UNMEASURED].map((r) => antibioticCell(r, NOW, true).tone);
    expect(tones).toEqual(["crit", "high", null, null, null, null]);
  });
});

describe("the vasopressor lines", () => {
  it("one per charted drug in the server's order: running above 0, stopped at 0, aged while fresh", () => {
    expect(pressorLines(MET, NOW, true)).toEqual([
      { drug: "norepinephrine", drugKey: "patient.medsDrugNorepinephrine", key: "patient.medsRunning", rate: 0.12,
        at: at(20), atMs: NOW - 20 * MIN, aged: true },
      { drug: "dopamine", drugKey: "patient.medsDrugDopamine", key: "patient.medsStopped", rate: 0,
        at: at(180), atMs: NOW - 180 * MIN, aged: true },
    ]);
  });

  it("a list that is not fresh prints the charted time, not an age", () => {
    expect(pressorLines(MET, NOW + 10 * MIN, false).map((line) => line.aged)).toEqual([false, false]);
    expect(pressorLines(MET, Number.NaN, true).map((line) => line.aged)).toEqual([false, false]);
  });

  it("a rate without its time has no age, and a drug this build does not know keeps the server's word", () => {
    const odd = row("S-9", { pressors: [{ drug: "epinephrine", rate: 0.05, at: null }, { drug: "vasopressin", rate: 2, at: at(5) }] });
    expect(pressorLines(odd, NOW, true)).toEqual([
      { drug: "epinephrine", drugKey: "patient.medsDrugEpinephrine", key: "patient.medsRunning", rate: 0.05, at: null, atMs: null, aged: false },
      { drug: "vasopressin", drugKey: null, key: "patient.medsRunning", rate: 2, at: at(5), atMs: NOW - 5 * MIN, aged: true },
    ]);
  });

  it("is empty for a row with none, and leaves out a rate that is no number", () => {
    expect(pressorLines(UNMEASURED, NOW, true)).toEqual([]);
    expect(pressorLines({}, NOW, true)).toEqual([]);
    expect(pressorLines(row("S-9", { pressors: [{ drug: "dopamine", rate: null, at: at(5) }] }), NOW, true)).toEqual([]);
  });
});

describe("creatinine and the fluid balance", () => {
  it("creatinine is a value and its time, with no tone", () => {
    expect(creatinineCell(MISSED)).toEqual({ value: 2.1, atMs: NOW - 260 * MIN });
    expect(creatinineCell(MISSED)).not.toHaveProperty("tone");
    expect(creatinineCell(row("S-9", { creatinine: { value: 0, at: null } }))).toEqual({ value: 0, atMs: null });
    expect(creatinineCell(UNMEASURED)).toBeNull();
  });

  it("the fluid balance is the server's sums and the last entry's time, with no tone — positive or negative", () => {
    expect(fluidCell(MISSED)).toEqual({ balance: 350, intake: 1250, output: 900, entries: 7, lastMs: NOW - 30 * MIN });
    expect(fluidCell(RUNNING)).toEqual({ balance: -450.5, intake: 200, output: 650.5, entries: 3, lastMs: NOW - 90 * MIN });
    for (const r of [MISSED, RUNNING]) expect(fluidCell(r)).not.toHaveProperty("tone");
  });

  it("an uncharted day is no balance at all, never a zero", () => {
    expect(fluidCell(UNMEASURED)).toBeNull();
    expect(fluidCell(MET)).toBeNull();
  });
});

describe("an ISO stamp", () => {
  it("is read as milliseconds, or null when it is missing or does not parse", () => {
    expect(msOf(at(0))).toBe(NOW);
    for (const bad of [null, undefined, "", "dün", 5]) expect(msOf(bad), String(bad)).toBeNull();
  });
});
