/**
 * Telling a quiet ward from a dead feed.
 *
 * A board that shows only values cannot distinguish "nothing is wrong with this patient" from
 * "nothing has arrived for this patient since 06:00". On an on-prem deployment nobody can look
 * at the bridge from here, so this judgement is the whole early-warning chain's smoke detector.
 */
import { describe, it, expect } from "vitest";
import {
  ageSeconds, channelHealth, formatAge, patientFeedHealth, wardFeedHealth, CHANNELS, STATUS,
} from "./feedHealth.js";

const NOW = new Date("2026-09-08T10:00:00Z");
const ago = (seconds) => new Date(NOW.getTime() - seconds * 1000).toISOString();

const patient = (measuredAt, over = {}) => ({
  patient_id: "bed-1", bedLabel: "YB 304-2", measuredAt, ...over,
});

/** Every monitor channel reporting a moment ago. */
const allLive = {
  heart_rate: ago(10), spo2: ago(10), sbp: ago(60), map: ago(60),
  temperature: ago(120), resp_rate: ago(30), lactate: ago(600),
};

describe("age", () => {
  it("is measured from the timestamp", () => {
    expect(ageSeconds(ago(90), NOW)).toBeCloseTo(90, 0);
  });

  it("a channel that never reported has no age, rather than an age of zero", () => {
    // Zero would read as "just arrived" — the opposite of the truth.
    expect(ageSeconds(null, NOW)).toBeNull();
    expect(ageSeconds("", NOW)).toBeNull();
  });

  it("an unreadable timestamp is treated as never, not as now", () => {
    // A bad clock must not make a dead feed look alive.
    expect(ageSeconds("dün", NOW)).toBeNull();
  });

  it("a timestamp from the future is a clock problem, not freshness", () => {
    expect(ageSeconds(new Date(NOW.getTime() + 60000).toISOString(), NOW)).toBe(0);
  });
});

describe("one channel", () => {
  const pulse = CHANNELS.find((c) => c.key === "heart_rate");

  it("inside its window is live", () => {
    expect(channelHealth(pulse, { heart_rate: ago(30) }, NOW).status).toBe(STATUS.LIVE);
  });

  it("past its window is stale, and says how far past", () => {
    const h = channelHealth(pulse, { heart_rate: ago(1800) }, NOW);
    expect(h.status).toBe(STATUS.STALE);
    expect(h.age).toBeCloseTo(1800, 0);
  });

  it("never seen is absent, which is a different problem from stale", () => {
    // Absent is a wiring problem — a bridge never connected, an option switched off.
    // Stale is a failure. They need different people.
    expect(channelHealth(pulse, {}, NOW).status).toBe(STATUS.ABSENT);
  });

  it("exactly at the window is still fresh — the boundary is inclusive", () => {
    // Stated because a test that happens to sit on the boundary otherwise reads as a bug.
    expect(channelHealth(pulse, { heart_rate: ago(pulse.freshSec) }, NOW).status).toBe(STATUS.LIVE);
    expect(channelHealth(pulse, { heart_rate: ago(pulse.freshSec + 1) }, NOW).status).toBe(STATUS.STALE);
  });

  it("each channel carries its own window — a lab is not a pulse", () => {
    const lactate = CHANNELS.find((c) => c.key === "lactate");
    expect(lactate.freshSec).toBeGreaterThan(pulse.freshSec * 10);
  });
});

describe("one bed", () => {
  it("all channels arriving is not silent and has nothing stale", () => {
    const h = patientFeedHealth(patient(allLive), NOW);
    expect(h.silent).toBe(false);
    expect(h.stale).toEqual([]);
    expect(h.live.length).toBe(CHANNELS.length);
  });

  it("today's pilot reality: respiration absent, everything else live", () => {
    const { resp_rate, ...withoutVentilator } = allLive;
    void resp_rate;
    const h = patientFeedHealth(patient(withoutVentilator), NOW);
    expect(h.absent.map((c) => c.key)).toEqual(["resp_rate"]);
    expect(h.silent).toBe(false);
  });

  it("a feed that stopped an hour ago is stale, not quiet", () => {
    // Two hours: clear of every continuous channel's window, including temperature's hour.
    const stopped = Object.fromEntries(Object.keys(allLive).map((k) => [k, ago(7200)]));
    const h = patientFeedHealth(patient(stopped), NOW);
    expect(h.silent).toBe(true);              // nothing is arriving any more
    expect(h.absent).toEqual([]);             // but it did once — this is a failure, not wiring
    expect(h.stale.length).toBeGreaterThan(0);
  });

  it("a bed that never reported anything is silent too", () => {
    const h = patientFeedHealth(patient({}), NOW);
    expect(h.silent).toBe(true);
    expect(h.absent.length).toBe(CHANNELS.length);
  });

  it("survives a patient with no timestamps at all rather than throwing", () => {
    expect(patientFeedHealth({}, NOW).silent).toBe(true);
    expect(patientFeedHealth(undefined, NOW).silent).toBe(true);
  });
});

describe("the ward, worst first", () => {
  const ward = [
    patient(allLive, { patient_id: "healthy" }),
    patient({}, { patient_id: "silent" }),
    patient({ ...allLive, spo2: ago(3600) }, { patient_id: "one-stale" }),
  ];

  it("a silent bed sorts above a stale one, and stale above healthy", () => {
    const { beds } = wardFeedHealth(ward, NOW);
    expect(beds.map((b) => b.patientId)).toEqual(["silent", "one-stale", "healthy"]);
  });

  it("counts each state so a header can say it in one line", () => {
    const h = wardFeedHealth(ward, NOW);
    expect([h.silentCount, h.staleCount, h.healthyCount]).toEqual([1, 1, 1]);
  });

  it("an empty ward is not an error", () => {
    expect(wardFeedHealth([], NOW).beds).toEqual([]);
  });
});

describe("how an age reads in a table cell", () => {
  it("seconds, then minutes, then hours", () => {
    expect(formatAge(45)).toBe("45 sn");
    expect(formatAge(600)).toBe("10 dk");
    expect(formatAge(7200)).toBe("2 sa");
  });

  it("never measured shows a dash, not a zero", () => {
    expect(formatAge(null)).toBe("—");
    expect(formatAge(undefined)).toBe("—");
  });
});

describe("a lab result must not keep a dead monitor feed looking alive", () => {
  it("monitors stopped but a recent lactate: still silent", () => {
    // The failure this module exists to catch. Lactate is drawn, not streamed, so a four-hour
    // -old one is legitimately fresh — and says nothing about whether anything is arriving.
    const h = patientFeedHealth(patient({
      heart_rate: ago(7200), spo2: ago(7200), sbp: ago(7200), map: ago(7200),
      temperature: ago(7200), resp_rate: ago(7200),
      lactate: ago(4 * 3600),
    }), NOW);
    expect(h.silent).toBe(true);
    expect(h.live.map((c) => c.key)).toEqual(["lactate"]);
  });

  it("one live monitor channel is enough not to be silent", () => {
    const h = patientFeedHealth(patient({ heart_rate: ago(30) }), NOW);
    expect(h.silent).toBe(false);
  });

  it("every continuous channel is marked as such, and the lab is not", () => {
    const byKey = Object.fromEntries(CHANNELS.map((c) => [c.key, c.continuous]));
    expect(byKey.heart_rate).toBe(true);
    expect(byKey.resp_rate).toBe(true);
    expect(byKey.lactate).toBe(false);
  });
});
