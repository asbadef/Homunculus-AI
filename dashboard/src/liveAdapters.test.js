import { describe, it, expect, vi } from "vitest";
import {
  patientFromBoard, patientsFromBoard, bedsFromPatients, alertsFromPatients,
} from "./liveAdapters.js";

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

// bedsFromPatients / alertsFromPatients synthesize the simulation's `beds` and `alerts` shapes
// from live patients, so the existing BedBoard/AlarmPage components — written against the
// simulation — render real data without changing a line of component code.
describe("bedsFromPatients", () => {
  it("makes one OCCUPIED bed per live patient, keyed by patient id", () => {
    const patients = [patientFromBoard(entry), patientFromBoard({ ...entry, patient_id: "bed-4" })];

    expect(bedsFromPatients(patients)).toEqual([
      { id: "live-bed-bed-3", label: "bed-3", unitId: null, unitName: null, roomId: null,
        roomLabel: null, state: "OCCUPIED", patientId: "bed-3" },
      { id: "live-bed-bed-4", label: "bed-4", unitId: null, unitName: null, roomId: null,
        roomLabel: null, state: "OCCUPIED", patientId: "bed-4" },
    ]);
  });

  it("returns no beds for no patients", () => {
    expect(bedsFromPatients([])).toEqual([]);
  });
});

describe("alertsFromPatients", () => {
  it("flattens one entry per patient alert, id-keyed by patient and kind", () => {
    const alerts = alertsFromPatients([patientFromBoard(entry)]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("bed-3::sepsis");
    expect(alerts[0].patientId).toBe("bed-3");
    expect(alerts[0].kind).toBe("sepsis");
    expect(alerts[0].summary).toBe("NEWS2 9");
    expect(alerts[0].severity).toBe("high");
    expect(alerts[0].urgency).toBe("immediate");
    expect(alerts[0].escalated).toBe(false);
  });

  it("maps the engine's severity onto the tier the alarm UI colors by", () => {
    const critical = { ...entry, alerts: [{ ...entry.alerts[0], severity: "critical" }] };
    expect(alertsFromPatients([patientFromBoard(critical)])[0].tier).toBe("CRITICAL");
    expect(alertsFromPatients([patientFromBoard(entry)])[0].tier).toBe("HIGH"); // severity "high"
  });

  it("is FIRED while unacknowledged, with no ack and an empty escalation chain", () => {
    const alerts = alertsFromPatients([patientFromBoard(entry)]);

    expect(alerts[0].status).toBe("FIRED");
    expect(alerts[0].ack).toBeNull();
    expect(alerts[0].snooze).toBeNull();
    expect(alerts[0].mutedUntil).toBeNull();
    expect(alerts[0].currentStep).toBe("NONE");
    expect(alerts[0].events).toEqual([]);
  });

  it("switches to ACKNOWLEDGED and carries who acknowledged it, once the engine says so", () => {
    const acked = { ...entry, alerts: [{ ...entry.alerts[0], acknowledged: true,
      acknowledged_by: "nurse", acknowledged_at: "2026-08-27T10:05:00Z" }] };

    const alert = alertsFromPatients([patientFromBoard(acked)])[0];

    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.ack.by).toBe("nurse");
    expect(alert.ack.atSec).toBe(Date.parse("2026-08-27T10:05:00Z") / 1000);
  });

  it("never invents a reason or note the clinician did not enter — the backend does not store them yet", () => {
    const acked = { ...entry, alerts: [{ ...entry.alerts[0], acknowledged: true,
      acknowledged_by: "nurse", acknowledged_at: "2026-08-27T10:05:00Z" }] };

    const alert = alertsFromPatients([patientFromBoard(acked)])[0];

    expect(alert.ack.reason).toBeNull();
    expect(alert.ack.note).toBeNull();
  });

  // A real alarm's age is WALL-CLOCK time since the backend first saw it. It used to be placed on
  // the simulation's clock, which runs at 60x: a real alarm first seen 10 s ago read "elapsed
  // 310 s" five seconds later, and its escalation stages lit within seconds. The alert now carries
  // the backend's instant, and nothing on the simulation's clock.
  describe("firstSeenAtMs — the backend's first-seen instant on the wall clock", () => {
    it("carries first_seen_at as epoch milliseconds", () => {
      const patient = patientFromBoard(entry);
      const alert = alertsFromPatients([patient])[0];
      expect(alert.firstSeenAtMs).toBe(Date.parse("2026-08-27T10:00:00Z"));
    });

    it("is null when first_seen_at is missing or unreadable, rather than inventing a time", () => {
      for (const firstSeenAt of [null, undefined, "", "not a date"]) {
        const patient = patientFromBoard({
          ...entry, alerts: [{ ...entry.alerts[0], first_seen_at: firstSeenAt }],
        });
        expect(alertsFromPatients([patient])[0].firstSeenAtMs, String(firstSeenAt)).toBeNull();
      }
    });

    it("puts nothing on the simulation's clock", () => {
      const alert = alertsFromPatients([patientFromBoard(entry)], 500)[0];
      expect(alert.firedAtSec).toBeNull();
    });
  });

  it("marks every synthesized alert as device-sourced, so the UI knows the backend owns its escalation timing", () => {
    // The local escalation countdown in AlertCard is computed from the SIMULATION's own
    // thresholds. Real alerts escalate server-side, on the backend's own timing, so the UI needs
    // a way to tell a real alert apart from a simulated one and suppress that local countdown.
    const alert = alertsFromPatients([patientFromBoard(entry)])[0];
    expect(alert.source).toBe("device");
  });

  it("sets bedLabel to the same honest device identifier the bed adapter uses", () => {
    const alert = alertsFromPatients([patientFromBoard(entry)])[0];
    expect(alert.bedLabel).toBe("bed-3");
  });

  it("produces one entry per alert when a patient carries more than one", () => {
    const two = { ...entry, alerts: [entry.alerts[0],
      { ...entry.alerts[0], kind: "hypoxia", severity: "critical" }] };

    const alerts = alertsFromPatients([patientFromBoard(two)]);

    expect(alerts.map((a) => a.id).sort()).toEqual(["bed-3::hypoxia", "bed-3::sepsis"]);
  });

  it("returns no alerts for a patient with none", () => {
    const clean = { patient_id: "bed-9", risk: "stable", alerts: [], latest: {} };
    expect(alertsFromPatients([patientFromBoard(clean)])).toEqual([]);
  });

  it("returns no alerts for no patients", () => {
    expect(alertsFromPatients([])).toEqual([]);
  });
});

describe("identity on a board entry", () => {
  const withIdentity = {
    patient_id: "20239121",
    risk: "none",
    alerts: [],
    latest: { heart_rate: 84, spo2: 97 },
    identity: {
      patient_id: "20239121",
      display_name: "AYSE YILMAZ",
      bed_label: "YB 304-2",
      state: "admitted",
      source: "comed",
      updated_at: "2026-09-04T14:30:00+00:00",
    },
  };

  it("carries the name, the bed and where they came from", () => {
    const patient = patientFromBoard(withIdentity);
    expect(patient.display_name).toBe("AYSE YILMAZ");
    expect(patient.bedLabel).toBe("YB 304-2");
    expect(patient.protocolNo).toBe("20239121");
    expect(patient.source).toBe("comed");
    expect(patient.identityUpdatedAt).toBe("2026-09-04T14:30:00+00:00");
  });

  it("leaves every identity field null when the HIS has said nothing", () => {
    const patient = patientFromBoard({ ...withIdentity, identity: null });
    expect(patient.display_name).toBeNull();
    expect(patient.bedLabel).toBeNull();
    expect(patient.protocolNo).toBeNull();
    expect(patient.source).toBe("device");
  });

  it("does not treat a discharged patient as admitted", () => {
    const discharged = { ...withIdentity, identity: { ...withIdentity.identity, state: "discharged" } };
    expect(patientFromBoard(discharged).identityState).toBe("discharged");
  });
});
