/// <reference types="jest" />
import { alertKey, escalatedKeys } from "../src/domain/escalation";
import type { BoardAlert, PatientBoard, Urgency } from "../src/transport/types";

const T0 = 1_000_000;
const THRESHOLD = 5 * 60 * 1000;

function alert(kind: string, urgency: Urgency, acknowledged = false): BoardAlert {
  return {
    patient_id: "bed-3", kind, severity: "critical", urgency, summary: "", clinical_reasoning: "",
    supporting_evidence: [], recommended_actions: [], confidence: "", source: "rule",
    downgraded: false, chronic_context: "", stale_inputs: [], acknowledged,
    acknowledged_by: null, acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function ward(...alerts: BoardAlert[]): PatientBoard[] {
  return [{
    patient_id: "bed-3", risk: "critical", alerts,
    latest: { heart_rate: null, map: null, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa: null },
  }];
}

describe("escalatedKeys — port of api/escalation.py", () => {
  it("escalates an unacknowledged immediate alert past the threshold", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + 6 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys).toEqual(new Set(["bed-3|septic_shock"]));
  });

  it("does not escalate an acknowledged alert", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(["bed-3|septic_shock"]),
      now: T0 + 6 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("does not escalate a non-immediate alert, however old", () => {
    const keys = escalatedKeys({
      boards: ward(alert("sepsis", "soon")),
      firstSeen: { "bed-3|sepsis": T0 },
      acknowledged: new Set(),
      now: T0 + 60 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("does not escalate before the threshold", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + (4 * 60 + 59) * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("escalates exactly at the threshold — the boundary is >=, not >", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + THRESHOLD,
      thresholdMs: THRESHOLD,
    });
    expect(keys).toEqual(new Set(["bed-3|septic_shock"]));
  });

  it("honours an acknowledgement that came from the server payload", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate", true)),
      firstSeen: { "bed-3|septic_shock": T0 },
      acknowledged: new Set(),
      now: T0 + 6 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });

  it("does not escalate an alert it has never stamped a first-seen for", () => {
    const keys = escalatedKeys({
      boards: ward(alert("septic_shock", "immediate")),
      firstSeen: {},
      acknowledged: new Set(),
      now: T0 + 60 * 60 * 1000,
      thresholdMs: THRESHOLD,
    });
    expect(keys.size).toBe(0);
  });
});

describe("alertKey", () => {
  it("joins bed and kind into one stable key", () => {
    expect(alertKey("bed-3", "septic_shock")).toBe("bed-3|septic_shock");
  });
});
