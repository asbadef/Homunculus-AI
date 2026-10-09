// The old workspace's feedHealth tests, carried over with the module (src/feedHealth.test.js) and
// extended for what changed: `ageParts` in place of the Turkish `formatAge`, and keys in place of
// the Turkish labels.
import { describe, it, expect } from "vitest";
import {
  CHANNELS, STATUS, ageParts, ageSeconds, channelHealth, patientFeedHealth, wardFeedHealth,
} from "./feedHealth.js";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();
const hr = CHANNELS.find((c) => c.key === "heart_rate");
const lac = CHANNELS.find((c) => c.key === "lactate");

describe("ageSeconds", () => {
  it("counts the seconds since a timestamp", () => {
    expect(ageSeconds(ago(90), NOW)).toBe(90);
  });

  it("a channel that never reported has no age", () => {
    expect(ageSeconds(null, NOW)).toBeNull();
    expect(ageSeconds(undefined, NOW)).toBeNull();
    expect(ageSeconds("", NOW)).toBeNull();
  });

  it("an unparseable timestamp reads as never, not as now", () => {
    // A bad clock must not make a dead feed look alive.
    expect(ageSeconds("dün akşam", NOW)).toBeNull();
  });

  it("a timestamp in the future is clamped to 0 — a clock problem, not a stale feed", () => {
    expect(ageSeconds(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
  });
});

describe("channelHealth", () => {
  it("is live inside its window and stale outside it", () => {
    expect(channelHealth(hr, { heart_rate: ago(120) }, NOW).status).toBe(STATUS.LIVE);
    expect(channelHealth(hr, { heart_rate: ago(300) }, NOW).status).toBe(STATUS.LIVE);
    expect(channelHealth(hr, { heart_rate: ago(301) }, NOW).status).toBe(STATUS.STALE);
  });

  it("is absent when the channel never arrived", () => {
    const health = channelHealth(hr, {}, NOW);
    expect(health.status).toBe(STATUS.ABSENT);
    expect(health.age).toBeNull();
  });

  it("keeps the channel's own window, naming and cadence flag", () => {
    expect(channelHealth(lac, { lactate: ago(7200) }, NOW))
      .toMatchObject({ key: "lactate", labelKey: "board.chLac", freshSec: 21_600, continuous: false, status: STATUS.LIVE });
  });
});

describe("patientFeedHealth", () => {
  it("splits live, stale and absent — a wiring problem is not a failure", () => {
    const patient = {
      patient_id: "S-001",
      measuredAt: { heart_rate: ago(60), spo2: ago(4_000), lactate: ago(600) },
    };
    const health = patientFeedHealth(patient, NOW);
    expect(health.live.map((c) => c.key)).toEqual(["heart_rate", "lactate"]);
    expect(health.stale.map((c) => c.key)).toEqual(["spo2"]);
    expect(health.absent.map((c) => c.key)).toEqual(["sbp", "map", "temperature", "resp_rate"]);
  });

  it("a bed is silent when no CONTINUOUS channel is arriving", () => {
    const quiet = { patient_id: "S-002", measuredAt: { heart_rate: ago(4_000) } };
    expect(patientFeedHealth(quiet, NOW).silent).toBe(true);
  });

  it("a fresh lactate does not keep a bed whose monitors stopped looking connected", () => {
    // The failure the `continuous` flag exists to catch.
    const labOnly = { patient_id: "S-003", measuredAt: { lactate: ago(3_600) } };
    const health = patientFeedHealth(labOnly, NOW);
    expect(health.live.map((c) => c.key)).toEqual(["lactate"]);
    expect(health.silent).toBe(true);
  });

  it("one arriving continuous channel is enough not to be silent", () => {
    expect(patientFeedHealth({ patient_id: "S-004", measuredAt: { spo2: ago(10) } }, NOW).silent).toBe(false);
  });

  it("a card with nothing at all is silent", () => {
    expect(patientFeedHealth({ patient_id: "S-005", measuredAt: {} }, NOW).silent).toBe(true);
    expect(patientFeedHealth(null, NOW).silent).toBe(true);
  });
});

describe("wardFeedHealth", () => {
  it("counts the ward and orders it worst first", () => {
    const patients = [
      { patient_id: "S-001", measuredAt: { heart_rate: ago(10), spo2: ago(10), sbp: ago(10), map: ago(10), temperature: ago(10), resp_rate: ago(10) } },
      { patient_id: "S-002", measuredAt: {} },
      { patient_id: "S-003", measuredAt: { heart_rate: ago(10), spo2: ago(4_000) } },
    ];
    const ward = wardFeedHealth(patients, NOW);
    expect(ward.beds.map((b) => b.patientId)).toEqual(["S-002", "S-003", "S-001"]);
    expect(ward.silentCount).toBe(1);
    expect(ward.staleCount).toBe(1);
    expect(ward.healthyCount).toBe(1);
  });

  it("an empty ward counts nothing", () => {
    expect(wardFeedHealth([], NOW)).toMatchObject({ silentCount: 0, staleCount: 0, healthyCount: 0 });
    expect(wardFeedHealth(null, NOW).beds).toEqual([]);
  });
});

describe("ageParts — the number and the unit, kept apart", () => {
  it("picks seconds, minutes or hours", () => {
    expect(ageParts(12)).toEqual({ unit: "s", value: 12 });
    expect(ageParts(89)).toEqual({ unit: "s", value: 89 });
    expect(ageParts(90)).toEqual({ unit: "m", value: 2 });
    expect(ageParts(3_000)).toEqual({ unit: "m", value: 50 });
    expect(ageParts(5_400)).toEqual({ unit: "h", value: 2 });
    expect(ageParts(7_200)).toEqual({ unit: "h", value: 2 });
  });

  it("no age has no parts — the caller writes the dash", () => {
    expect(ageParts(null)).toBeNull();
    expect(ageParts(undefined)).toBeNull();
  });
});
