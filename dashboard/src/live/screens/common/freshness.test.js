import { describe, it, expect } from "vitest";
import { elapsed, msOf } from "./elapsed.js";
import {
  SIGNAL_KEYS, ageOf, hasMeasurement, lastMeasuredAt, neverMeasured, oldestMeasurement,
} from "./freshness.js";
import { CHANNELS } from "./feedHealth.js";
import { VITALS } from "./vitals.js";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

describe("elapsed — how long an alarm has been open", () => {
  it("writes minutes and seconds under an hour", () => {
    expect(elapsed(NOW - 0, NOW)).toBe("0:00");
    expect(elapsed(NOW - 7_000, NOW)).toBe("0:07");
    expect(elapsed(NOW - 247_000, NOW)).toBe("4:07");
    expect(elapsed(NOW - 3_599_000, NOW)).toBe("59:59");
  });

  it("never writes a minute past 59: an hour becomes h:mm:ss", () => {
    // The old workspace wrote "318:30" for five and a quarter hours. A number a clinician reads
    // as minutes when it is hours is worse than no number at all.
    expect(elapsed(NOW - 3_600_000, NOW)).toBe("1:00:00");
    expect(elapsed(NOW - 19_110_000, NOW)).toBe("5:18:30");
  });

  it("an instant that has not arrived yet is 0:00, not a negative age", () => {
    // `firstSeenAtMs` is the SERVER's instant and this subtraction uses the BROWSER's clock: a
    // ward PC running ahead of the API must not show an alarm that has not happened.
    expect(elapsed(NOW + 90_000, NOW)).toBe("0:00");
  });

  it("no instant means no age, never an invented one", () => {
    expect(elapsed(null, NOW)).toBeNull();
    expect(elapsed(undefined, NOW)).toBeNull();
    expect(elapsed(NaN, NOW)).toBeNull();
  });

  it("reads an ISO instant, and refuses anything else", () => {
    expect(msOf("2026-10-08T10:00:00Z")).toBe(NOW);
    expect(msOf("")).toBeNull();
    expect(msOf(null)).toBeNull();
    expect(msOf("bir ara")).toBeNull();
  });
});

describe("freshness — the age of a reading, and never a verdict on it", () => {
  it("lists the signals a vital bar shows, as the server names them", () => {
    expect(SIGNAL_KEYS).toContain("heart_rate");
    expect(SIGNAL_KEYS).toContain("spo2");
    expect(Object.isFrozen(SIGNAL_KEYS)).toBe(true);
  });

  it("is the one list the feed table and the channel table are both built from", () => {
    // Three modules name the server's seven published signals: this list, `feedHealth.CHANNELS`
    // and `vitals.VITALS`. Nothing made them agree, so a newly published signal needed three
    // edits in three files and two of them could silently be forgotten — the channel would then
    // appear on a card while counting for nothing in the feed chip, or the reverse.
    expect([...CHANNELS].map((c) => c.key).sort()).toEqual([...SIGNAL_KEYS].sort());
    expect([...VITALS].map((v) => v.at).sort()).toEqual([...SIGNAL_KEYS].sort());
  });

  it("says whether a card has ever been measured", () => {
    expect(hasMeasurement({ heart_rate: ago(60), spo2: null })).toBe(true);
    expect(hasMeasurement({ heart_rate: null, spo2: null })).toBe(false);
    expect(hasMeasurement({})).toBe(false);
    expect(hasMeasurement(null)).toBe(false);
    expect(hasMeasurement(undefined)).toBe(false);
  });

  it("an unreadable instant does not count as a measurement", () => {
    expect(hasMeasurement({ heart_rate: "dün" })).toBe(false);
  });

  it("the card's newest instant is its last measurement", () => {
    expect(lastMeasuredAt({ heart_rate: ago(600), spo2: ago(30) })).toBe(NOW - 30_000);
    expect(lastMeasuredAt({ heart_rate: null })).toBeNull();
  });

  it("gives one channel's age in milliseconds", () => {
    expect(ageOf(ago(90), NOW)).toBe(90_000);
    expect(ageOf(null, NOW)).toBeNull();
    expect(ageOf("dün", NOW)).toBeNull();
  });

  it("a value newer than this browser's clock is 0 old, never negative", () => {
    expect(ageOf(new Date(NOW + 5_000).toISOString(), NOW)).toBe(0);
  });

  it("counts the cards that have never been measured — a fact, with no window chosen", () => {
    const patients = [
      { patient_id: "S-001", measuredAt: { heart_rate: ago(30) } },
      { patient_id: "S-002", measuredAt: {} },
      { patient_id: "S-003", measuredAt: { heart_rate: null, spo2: null } },
    ];
    expect(neverMeasured(patients)).toBe(2);
    expect(neverMeasured([])).toBe(0);
    expect(neverMeasured(null)).toBe(0);
  });

  it("names the quietest card's last instant, and nothing about whether that is too long", () => {
    const patients = [
      { patient_id: "S-001", measuredAt: { heart_rate: ago(30) } },
      { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } },
      { patient_id: "S-003", measuredAt: {} },
    ];
    expect(oldestMeasurement(patients)).toBe(NOW - 4_000_000);
    expect(oldestMeasurement([{ patient_id: "S-004", measuredAt: {} }])).toBeNull();
    expect(oldestMeasurement([])).toBeNull();
  });
});
