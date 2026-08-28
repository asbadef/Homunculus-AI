/// <reference types="jest" />
import { riskRank, riskTone, topAlert, sortWard } from "../src/domain/risk";
import type { BoardAlert, PatientBoard, Risk, Severity, Urgency } from "../src/transport/types";

function alert(kind: string, severity: Severity, urgency: Urgency = "soon"): BoardAlert {
  return {
    patient_id: "bed-1", kind, severity, urgency, summary: kind, clinical_reasoning: "",
    supporting_evidence: [], recommended_actions: [], confidence: "", source: "rule",
    downgraded: false, chronic_context: "", stale_inputs: [], acknowledged: false,
    acknowledged_by: null, acknowledged_at: null, first_seen_at: null, escalated: false,
  };
}

function board(id: string, risk: Risk, alerts: BoardAlert[] = []): PatientBoard {
  return { patient_id: id, risk, alerts, latest: { heart_rate: null, map: null, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa: null } };
}

describe("riskRank", () => {
  it("orders none below every severity and critical above all", () => {
    expect(riskRank("none")).toBeLessThan(riskRank("low"));
    expect(riskRank("critical")).toBeGreaterThan(riskRank("high"));
  });
});

describe("riskTone", () => {
  it("collapses six risks onto four tones", () => {
    expect(riskTone("critical")).toBe("critical");
    expect(riskTone("high")).toBe("warning");
    expect(riskTone("moderate")).toBe("warning");
    expect(riskTone("low")).toBe("safe");
    expect(riskTone("none")).toBe("muted");
  });
});

describe("topAlert", () => {
  it("returns null when there are no alerts", () => {
    expect(topAlert(board("bed-5", "none"))).toBeNull();
  });

  it("picks the most severe, breaking ties on urgency", () => {
    const b = board("bed-3", "critical", [
      alert("sepsis", "high", "soon"),
      alert("septic_shock", "critical", "immediate"),
    ]);
    expect(topAlert(b)!.kind).toBe("septic_shock");
  });
});

describe("sortWard", () => {
  it("orders by risk, then unacknowledged first, then bed", () => {
    const stable = board("bed-5", "none");
    const highAcked = board("bed-9", "high", [{ ...alert("sepsis", "high"), acknowledged: true }]);
    const highOpen = board("bed-7", "high", [alert("sepsis", "high")]);
    const critical = board("bed-3", "critical", [alert("septic_shock", "critical", "immediate")]);

    const order = sortWard([stable, highAcked, highOpen, critical], new Set()).map((b) => b.patient_id);
    expect(order).toEqual(["bed-3", "bed-7", "bed-9", "bed-5"]);
  });

  it("treats a locally acknowledged key as acknowledged", () => {
    const a = board("bed-7", "high", [alert("sepsis", "high")]);
    const b = board("bed-9", "high", [alert("sepsis", "high")]);
    const order = sortWard([a, b], new Set(["bed-7|sepsis"])).map((x) => x.patient_id);
    expect(order).toEqual(["bed-9", "bed-7"]);
  });
});
