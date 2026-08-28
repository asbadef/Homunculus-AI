import { describe, it, expect } from "vitest";
import { patientFromBoard, patientsFromBoard } from "./liveAdapters.js";

const entry = {
  patient_id: "bed-3",
  risk: "high",
  alerts: [
    { kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
      acknowledged: false, acknowledged_by: null, acknowledged_at: null,
      first_seen_at: "2026-08-27T10:00:00Z", escalated: false },
  ],
  latest: { heart_rate: 123, map: 61, spo2: 89, temperature: 38.4, resp_rate: 28,
            lactate: 3.1, sofa: 7 },
};

describe("patientFromBoard", () => {
  it("carries the machine-measured vitals across", () => {
    expect(patientFromBoard(entry).vitals)
      .toEqual({ hr: 123, map: 61, spo2: 89, temp: 38.4, rr: 28 });
  });

  it("keeps the patient id and the engine's risk", () => {
    const p = patientFromBoard(entry);
    expect(p.patient_id).toBe("bed-3");
    expect(p.risk).toBe("high");
  });

  it("passes the alerts through untouched", () => {
    expect(patientFromBoard(entry).alerts).toHaveLength(1);
    expect(patientFromBoard(entry).alerts[0].kind).toBe("sepsis");
  });

  it("leaves every clinician-entered field null rather than inventing one", () => {
    // An invented name, bed or national ID on a clinical board is worse than a blank one:
    // a blank prompts someone to fill it in, a plausible value gets trusted.
    const p = patientFromBoard(entry);
    for (const field of ["display_name", "tc_no", "tcMasked", "phone", "address", "mrn",
                         "protocolNo", "bedId", "bedLabel", "unitId", "diagnosis",
                         "admittedBy", "sex", "age", "ageDays"]) {
      expect(p[field], `${field} must be null until a clinician enters it`).toBeNull();
    }
  });

  it("marks the record as machine-sourced", () => {
    expect(patientFromBoard(entry).source).toBe("device");
  });

  it("renders an unmeasured vital as null, not zero", () => {
    const sparse = { patient_id: "bed-9", risk: "stable", alerts: [],
                     latest: { heart_rate: null, map: null, spo2: null,
                               temperature: null, resp_rate: null, lactate: null, sofa: null } };
    expect(patientFromBoard(sparse).vitals)
      .toEqual({ hr: null, map: null, spo2: null, temp: null, rr: null });
  });

  it("survives a payload with no latest block at all", () => {
    const p = patientFromBoard({ patient_id: "bed-1", risk: "stable", alerts: [] });
    expect(p.vitals).toEqual({ hr: null, map: null, spo2: null, temp: null, rr: null });
  });

  it("does not turn a real zero into null", () => {
    // A measured 0 is a clinical finding, not a missing value. `??` is correct here and `||`
    // would be a bug.
    const zeroed = { patient_id: "bed-2", risk: "critical", alerts: [],
                     latest: { heart_rate: 0, map: 0, spo2: 0, temperature: 0, resp_rate: 0 } };
    expect(patientFromBoard(zeroed).vitals)
      .toEqual({ hr: 0, map: 0, spo2: 0, temp: 0, rr: 0 });
  });
});

describe("patientsFromBoard", () => {
  it("maps a whole board response", () => {
    expect(patientsFromBoard({ patients: [entry, { ...entry, patient_id: "bed-4" }] }))
      .toHaveLength(2);
  });

  it("treats a missing patients array as no patients", () => {
    expect(patientsFromBoard({})).toEqual([]);
  });

  it("treats a null payload as no patients", () => {
    expect(patientsFromBoard(null)).toEqual([]);
  });
});
