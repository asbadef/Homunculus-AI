// snooze.test.js — «Ertele»'s rules on the dashboard (G2-B5b, spec D1, D4). Synthetic alarms.
import { describe, it, expect } from "vitest";
import {
  OTHER, OTHER_MIN_CHARS, REASON_TEXT_MAX, SNOOZE_CHOICES, SNOOZE_REASONS, isSnoozed, maySnooze, nextSnoozeEnd,
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
    const a = alarm({ snooze: { untilMs: 5_000 } });
    expect(isSnoozed(a, 4_999)).toBe(true);
    expect(isSnoozed(a, 5_000)).toBe(false);
  });

  it("is never without a clock, without an until, or on a severity that is never snoozed", () => {
    expect(isSnoozed(alarm({ snooze: { untilMs: 5_000 } }), undefined)).toBe(false);
    expect(isSnoozed(alarm({ snooze: { untilMs: null } }), 0)).toBe(false);
    expect(isSnoozed(alarm(), 0)).toBe(false);
    expect(isSnoozed(alarm({ severity: "critical", snooze: { untilMs: 5_000 } }), 0)).toBe(false);
  });

  it("knows when the next snooze on the board ends", () => {
    const alerts = [alarm({ id: "x", snooze: { untilMs: 9_000 } }), alarm({ id: "y", snooze: { untilMs: 7_000 } }),
      alarm({ id: "z" })];
    expect(nextSnoozeEnd(alerts, 1_000)).toBe(7_000);
    expect(nextSnoozeEnd(alerts, 7_000)).toBe(9_000);
    expect(nextSnoozeEnd(alerts, 9_000)).toBeNull();
    expect(nextSnoozeEnd(undefined, 0)).toBeNull();
  });
});
