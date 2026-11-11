// snooze.test.js — «Ertele»'s rules on the dashboard (G2-B5b, spec D1, D4). Synthetic alarms.
import { describe, it, expect } from "vitest";
import {
  OTHER, OTHER_MIN_CHARS, REASON_TEXT_MAX, SNOOZE_CAP_MINUTES, SNOOZE_CHOICES, SNOOZE_REASONS, isSnoozed, maySnooze,
  nextSnoozeEnd,
} from "./snooze.js";

const alarm = (over = {}) => ({ id: "a", severity: "high", status: "FIRED", ack: null, snooze: null, ...over });

describe("the owner's rules, as the dialog offers them", () => {
  it("offers durations within the cap, the shortest first, and the engine's reasons", () => {
    expect(SNOOZE_CHOICES).toEqual({ high: [5, 10, 15, 30], moderate: [15, 30, 60, 120] });
    expect(SNOOZE_REASONS).toEqual(["CLINICAL_DECISION_MADE", "ARTEFACT_OR_SIGNAL_NOISE", "PROCEDURE_IN_PROGRESS",
      "PATIENT_BASELINE", "OTHER"]);
    expect([OTHER, OTHER_MIN_CHARS, REASON_TEXT_MAX]).toEqual(["OTHER", 15, 500]);
  });

  it("offers «Ertele» on an unanswered, firing high or moderate alarm only", () => {
    expect(maySnooze(alarm())).toBe(true);
    expect(maySnooze(alarm({ severity: "moderate" }))).toBe(true);
    for (const severity of ["critical", "low", "info", "unheard_of", "constructor"]) {
      expect(maySnooze(alarm({ severity })), severity).toBe(false);
    }
    expect(maySnooze(alarm({ status: "ACKNOWLEDGED", ack: { by: "x" } }))).toBe(false);
    expect(maySnooze(alarm({ severity: "critical", status: "RESOLVED" }))).toBe(false);
    expect(maySnooze(null)).toBe(false);
  });
});

describe("whether an alarm is snoozed now", () => {
  it("is while its until is ahead of the board's clock, and is not from that instant on", () => {
    const a = alarm({ snooze: { atMs: 0, untilMs: 5_000 } });
    expect(isSnoozed(a, 4_999)).toBe(true);
    expect(isSnoozed(a, 5_000)).toBe(false);
  });

  it("is never without a clock, without an until, or on a severity that is never snoozed", () => {
    expect(isSnoozed(alarm({ snooze: { atMs: 0, untilMs: 5_000 } }), undefined)).toBe(false);
    expect(isSnoozed(alarm({ snooze: { atMs: 0, untilMs: null } }), 0)).toBe(false);
    expect(isSnoozed(alarm(), 0)).toBe(false);
    expect(isSnoozed(alarm({ severity: "critical", snooze: { atMs: 0, untilMs: 5_000 } }), 0)).toBe(false);
  });

  // Review (G2-B5b): a snooze is honoured on a firing alarm only. A latched one (RESOLVED) and an answered one wait
  // for nothing the snooze could hold back, and a card that names no status is not taken for a firing one.
  it("is never on an alarm that is not firing", () => {
    const snooze = { atMs: 0, untilMs: 5_000 };
    for (const status of ["RESOLVED", "ACKNOWLEDGED", undefined]) {
      expect(isSnoozed(alarm({ status, snooze }), 0), String(status)).toBe(false);
    }
  });

  // Review (G2-B5b): the client never honours more than the owner's cap (D1), whatever a card carries — a moderate
  // alarm's 120 minutes stop holding it back the moment it is high (plan note 1) — nor a snooze whose start it
  // cannot read, since that one cannot be held to the cap.
  it("honours no snooze longer than the owner's cap for the alarm's severity, nor one with no start", () => {
    const MIN = 60_000;
    expect(isSnoozed(alarm({ snooze: { atMs: 0, untilMs: 30 * MIN } }), 0)).toBe(true);
    expect(isSnoozed(alarm({ snooze: { atMs: 0, untilMs: 30 * MIN + 1 } }), 0)).toBe(false);
    expect(isSnoozed(alarm({ severity: "moderate", snooze: { atMs: 0, untilMs: 120 * MIN } }), 0)).toBe(true);
    expect(isSnoozed(alarm({ severity: "moderate", snooze: { atMs: 0, untilMs: 120 * MIN + 1 } }), 0)).toBe(false);
    expect(isSnoozed(alarm({ severity: "high", snooze: { atMs: 0, untilMs: 120 * MIN } }), 0)).toBe(false);
    expect(isSnoozed(alarm({ snooze: { atMs: null, untilMs: 5_000 } }), 0)).toBe(false);
    expect(SNOOZE_CAP_MINUTES).toEqual({ high: 30, moderate: 120 });
  });

  it("knows when the next snooze on the board ends", () => {
    const alerts = [alarm({ id: "x", snooze: { atMs: 0, untilMs: 9_000 } }),
      alarm({ id: "y", snooze: { atMs: 0, untilMs: 7_000 } }), alarm({ id: "z" })];
    expect(nextSnoozeEnd(alerts, 1_000)).toBe(7_000);
    expect(nextSnoozeEnd(alerts, 7_000)).toBe(9_000);
    expect(nextSnoozeEnd(alerts, 9_000)).toBeNull();
    expect(nextSnoozeEnd(undefined, 0)).toBeNull();
  });
});
