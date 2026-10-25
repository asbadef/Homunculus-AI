import { describe, it, expect, vi } from "vitest";
import {
  patientFromBoard, patientsFromBoard, bedsFromPatients, alertsFromPatients,
  ageFromBirthDate, awaitingLocalAdmission,
} from "./liveAdapters.js";

const entry = {
  patient_id: "bed-3",
  risk: "high",
  alerts: [
    { kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
      acknowledged: false, acknowledged_by: null, acknowledged_at: null,
      first_seen_at: "2026-08-27T10:00:00Z", escalated: false },
  ],
  latest: { heart_rate: 123, map: 61, sbp: 96, spo2: 89, temperature: 38.4, resp_rate: 28,
            lactate: 3.1, sofa: 7,
            news2: { total: 9, partial: false, missing: [], red_param: true, breakdown: {} } },
};

describe("patientFromBoard", () => {
  it("carries the machine-measured vitals across", () => {
    expect(patientFromBoard(entry).vitals)
      .toEqual({ hr: 123, map: 61, sbp: 96, spo2: 89, temp: 38.4, rr: 28 });
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
                     latest: { heart_rate: null, map: null, sbp: null, spo2: null,
                               temperature: null, resp_rate: null, lactate: null, sofa: null } };
    expect(patientFromBoard(sparse).vitals)
      .toEqual({ hr: null, map: null, sbp: null, spo2: null, temp: null, rr: null });
  });

  it("survives a payload with no latest block at all", () => {
    const p = patientFromBoard({ patient_id: "bed-1", risk: "stable", alerts: [] });
    expect(p.vitals).toEqual({ hr: null, map: null, sbp: null, spo2: null, temp: null, rr: null });
  });

  it("does not turn a real zero into null", () => {
    // A measured 0 is a clinical finding, not a missing value. `??` is correct here and `||`
    // would be a bug.
    const zeroed = { patient_id: "bed-2", risk: "critical", alerts: [],
                     latest: { heart_rate: 0, map: 0, sbp: 0, spo2: 0, temperature: 0, resp_rate: 0 } };
    expect(patientFromBoard(zeroed).vitals)
      .toEqual({ hr: 0, map: 0, sbp: 0, spo2: 0, temp: 0, rr: 0 });
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

// bedsFromPatients / alertsFromPatients synthesize the old workspace's `beds` and `alerts` shapes
// from live patients — its BedBoard/AlarmPage were written against the simulation. That workspace
// went in G1-16; the live board store reads alertsFromPatients.
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

  // G2-A1 (O17): a critical whose rule stopped before anyone acknowledged it stays on the board,
  // `resolved_at` set, until someone does.
  it("is RESOLVED when its rule stopped before anyone acknowledged it, with the instant it stopped", () => {
    const latched = { ...entry, alerts: [{ ...entry.alerts[0], severity: "critical",
      resolved_at: "2026-08-27T10:04:00Z" }] };
    const alert = alertsFromPatients([patientFromBoard(latched)])[0];
    expect(alert.status).toBe("RESOLVED");
    expect(alert.resolvedAtMs).toBe(Date.parse("2026-08-27T10:04:00Z"));
    expect(alert.ack).toBeNull();
    const firing = alertsFromPatients([patientFromBoard(entry)])[0];
    expect([firing.status, firing.resolvedAtMs]).toEqual(["FIRED", null]);
  });

  // A latched alarm that someone then acknowledged is ACKNOWLEDGED, not RESOLVED: the answer wins,
  // so it leaves the waiting queue whether or not the engine still sends `resolved_at`.
  it("is ACKNOWLEDGED, not RESOLVED, once someone acknowledged it — whatever `resolved_at` says", () => {
    const answered = { ...entry, alerts: [{ ...entry.alerts[0], severity: "critical",
      resolved_at: "2026-08-27T10:04:00Z", acknowledged: true, acknowledged_by: "ayse",
      acknowledged_at: "2026-08-27T10:06:00Z" }] };
    const alert = alertsFromPatients([patientFromBoard(answered)])[0];
    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.ackBy).toBe("ayse");
  });

  it("names the episode by its first-seen instant: an alarm that cleared and came back is a new one", () => {
    const again = { ...entry, alerts: [{ ...entry.alerts[0], first_seen_at: "2026-08-27T11:30:00Z" }] };
    const [first] = alertsFromPatients([patientFromBoard(entry)]);
    const [second] = alertsFromPatients([patientFromBoard(again)]);
    expect(first.episode).toBe("bed-3::sepsis::2026-08-27T10:00:00Z");
    expect(second.episode).not.toBe(first.episode);
    expect(second.id).toBe(first.id);                 // the alarm itself is the same one
  });

  it("switches to ACKNOWLEDGED and carries who acknowledged it, once the engine says so", () => {
    const acked = { ...entry, alerts: [{ ...entry.alerts[0], acknowledged: true,
      acknowledged_by: "nurse", acknowledged_at: "2026-08-27T10:05:00Z" }] };

    const alert = alertsFromPatients([patientFromBoard(acked)])[0];

    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.ack.by).toBe("nurse");
    // The instant is `ackAtMs`, in milliseconds. `ack` also carried it in SECONDS (`atSec`) for
    // the old workspace's time-to-acknowledge; `elapsed(ack.atSec)` would have aged it by about 56
    // years without an error. That workspace went in G1-16, and the second unit with it.
    expect(alert.ack).not.toHaveProperty("atSec");
    expect(alert.ackAtMs).toBe(Date.parse("2026-08-27T10:05:00Z"));
  });

  it("never invents a reason or note the clinician did not enter — the backend does not store them yet", () => {
    const acked = { ...entry, alerts: [{ ...entry.alerts[0], acknowledged: true,
      acknowledged_by: "nurse", acknowledged_at: "2026-08-27T10:05:00Z" }] };

    const alert = alertsFromPatients([patientFromBoard(acked)])[0];

    expect(alert.ack.reason).toBeNull();
    expect(alert.ack.note).toBeNull();
  });

  // The engine's own reasoning travels with the alarm (reco/engine.py Alert): the patient screen
  // shows it, and nothing here rewrites it.
  describe("why the engine raised it", () => {
    const reasoned = { ...entry, alerts: [{ ...entry.alerts[0],
      clinical_reasoning: "SOFA rose by 3 over the charted baseline.",
      supporting_evidence: ["sepsis-3-jama-2016", "surviving-sepsis-campaign-2021"],
      recommended_actions: ["Review the patient and the supporting evidence."],
      confidence: "Sepsis-3 organ-dysfunction criterion (consensus definition).",
      downgraded: false, chronic_context: "", stale_inputs: ["lactate"] }] };

    it("carries the reasoning, the sources, the actions and the certainty", () => {
      const alert = alertsFromPatients([patientFromBoard(reasoned)])[0];
      expect(alert.clinicalReasoning).toBe("SOFA rose by 3 over the charted baseline.");
      expect(alert.evidence).toEqual(["sepsis-3-jama-2016", "surviving-sepsis-campaign-2021"]);
      expect(alert.actions).toEqual(["Review the patient and the supporting evidence."]);
      expect(alert.confidence).toBe("Sepsis-3 organ-dysfunction criterion (consensus definition).");
      expect(alert.staleInputs).toEqual(["lactate"]);
    });

    it("says when the patient's own charted normal lowered it, and why", () => {
      const lowered = { ...entry, alerts: [{ ...entry.alerts[0], severity: "low",
        downgraded: true, chronic_context: "Chronic oxygen therapy explains the SpO2." }] };
      const alert = alertsFromPatients([patientFromBoard(lowered)])[0];
      expect(alert.downgraded).toBe(true);
      expect(alert.chronicContext).toBe("Chronic oxygen therapy explains the SpO2.");
    });

    it("carries no reasoning rather than an invented one", () => {
      const alert = alertsFromPatients([patientFromBoard(entry)])[0];
      expect(alert.clinicalReasoning).toBeNull();
      expect(alert.confidence).toBeNull();
      expect(alert.chronicContext).toBeNull();
      expect(alert.evidence).toEqual([]);
      expect(alert.actions).toEqual([]);
      expect(alert.staleInputs).toEqual([]);
      expect(alert.downgraded).toBe(false);
    });

    it("carries the acknowledgement as a bare name and instant too", () => {
      // What a list row shows: who, and when on the wall clock. `ack` is the presence flag the
      // board store's waiting queue tests; these two are what a screen prints.
      const acked = { ...entry, alerts: [{ ...entry.alerts[0], acknowledged: true,
        acknowledged_by: "ayse", acknowledged_at: "2026-08-27T10:05:00Z" }] };
      const alert = alertsFromPatients([patientFromBoard(acked)])[0];
      expect(alert.ackBy).toBe("ayse");
      expect(alert.ackAtMs).toBe(Date.parse("2026-08-27T10:05:00Z"));
      const open = alertsFromPatients([patientFromBoard(entry)])[0];
      expect(open.ackBy).toBeNull();
      expect(open.ackAtMs).toBeNull();
    });
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
    // The old workspace's AlertCard computed a local escalation countdown from the SIMULATION's
    // own thresholds. Real alerts escalate server-side, on the backend's own timing, so a real
    // alert says so rather than leave a screen to guess.
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

  // The bed and unit the SERVER resolved the card onto (api/board.py `_bed_resolution`). These are
  // the keys the server's own scope filter matches (`sees_patient`), so a screen that filters by
  // unit, or explains why a board is the size it is, has to read the same ones.
  const resolved = {
    ...withIdentity,
    identity: { ...withIdentity.identity, bed_id: "REA-01-2", unit_id: "REA-01",
                bed_matched: true, bed_key: "YB^304^2" },
  };

  it("carries the bed and unit the board resolved, and that it matched", () => {
    const patient = patientFromBoard(resolved);
    expect(patient.bedId).toBe("REA-01-2");
    expect(patient.unitId).toBe("REA-01");
    expect(patient.bedMatched).toBe(true);
    expect(patient.bedKey).toBe("YB^304^2");
  });

  it("keeps the unmatched location's key, and says it did not match", () => {
    // A location the site's table does not cover: the patient still has a card (never dropped),
    // but belongs to no unit — which is why a scoped session cannot see it at all. The key is
    // what an operator adds to the table, so it is kept verbatim.
    const patient = patientFromBoard({
      ...withIdentity,
      identity: { ...withIdentity.identity, bed_id: null, unit_id: null,
                  bed_matched: false, bed_key: "YB^999^9" },
    });
    expect(patient.bedId).toBeNull();
    expect(patient.unitId).toBeNull();
    expect(patient.bedMatched).toBe(false);
    expect(patient.bedKey).toBe("YB^999^9");
  });

  it("a card with no identity at all is on no bed and no unit, and says so", () => {
    const patient = patientFromBoard({ patient_id: "S-001", risk: "none", alerts: [] });
    expect(patient.bedId).toBeNull();
    expect(patient.unitId).toBeNull();
    expect(patient.bedMatched).toBe(false);
    expect(patient.bedKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Adapter contracts that came from main inside tests of main's ClinicalDemo screens
// (admissionFromHis, news2Source, pharmacyView). Those screen tests were removed in the merge
// (roadmap D1: the demo goes, the new shell is rebuilt); the adapter stays, so its contracts
// stay tested here.

describe("HIS admission data on the card (from admissionFromHis)", () => {
  const hisEntry = (over = {}) => ({
    patient_id: "20239121", risk: "none", alerts: [],
    latest: { heart_rate: null, map: null, sbp: null, spo2: null, temperature: null,
              resp_rate: null, lactate: null, sofa: null, news2: null },
    identity: {
      patient_id: "20239121", display_name: "AYSE YILMAZ", bed_label: "YB 304-2",
      state: "admitted", source: "comed", updated_at: null,
      bed_id: null, bed_matched: false, bed_key: "YB^304^2",
      birth_date: "1967-04-17", sex: "female",
      diagnoses: [{ code: "A41.9", text: "Sepsis, unspecified", system: "I10", kind: "A" }],
      ...over,
    },
  });

  it("age is computed from the date of birth", () => {
    expect(ageFromBirthDate("1967-04-17", new Date("2026-09-08"))).toBe(59);
    expect(ageFromBirthDate("1967-12-31", new Date("2026-09-08"))).toBe(58);   // birthday not yet
  });

  it("a missing, unreadable or future date of birth is null, not a confident number", () => {
    // Zero would render as a newborn on a clinical card.
    expect(ageFromBirthDate("")).toBeNull();
    expect(ageFromBirthDate(null)).toBeNull();
    expect(ageFromBirthDate("not-a-date")).toBeNull();
    expect(ageFromBirthDate("2030-01-01", new Date("2026-09-08"))).toBeNull();
  });

  it("sex and date of birth travel; an unknown sex arrives as null", () => {
    const p = patientFromBoard(hisEntry());
    expect(p.sex).toBe("female");
    expect(p.birthDate).toBe("1967-04-17");
    expect(p.age).toBeGreaterThan(50);
    expect(patientFromBoard(hisEntry({ sex: "unknown" })).sex).toBeNull();
  });

  it("the admitting diagnoses travel with their codes", () => {
    expect(patientFromBoard(hisEntry()).hisDiagnoses[0].code).toBe("A41.9");
  });

  it("an empty diagnosis list stays empty; a card with no identity still answers with a list", () => {
    expect(patientFromBoard(hisEntry({ diagnoses: [] })).hisDiagnoses).toEqual([]);
    expect(patientFromBoard({ patient_id: "bed-1", risk: "none", alerts: [], latest: {} }).hisDiagnoses)
      .toEqual([]);
  });

  describe("who is waiting to be taken onto a bed here", () => {
    const fromHis = { patient_id: "1", source: "comed", bedId: null, identityState: "admitted" };

    it("a HIS admission with no local bed is waiting", () => {
      expect(awaitingLocalAdmission([fromHis])).toHaveLength(1);
    });

    it("one on a bed here, a discharged one, or one entered by hand is not offered", () => {
      expect(awaitingLocalAdmission([{ ...fromHis, bedId: "bed-a1" }])).toEqual([]);
      expect(awaitingLocalAdmission([{ ...fromHis, identityState: "discharged" }])).toEqual([]);
      expect(awaitingLocalAdmission([{ ...fromHis, source: "manuel" }])).toEqual([]);
    });

    it("an empty board is not an error", () => {
      expect(awaitingLocalAdmission()).toEqual([]);
    });
  });
});

describe("the engine's NEWS2 reaches the UI intact (from news2Source)", () => {
  const latest = {
    heart_rate: 118, map: 61, sbp: 96, spo2: 92, temperature: 38.6, resp_rate: 25,
    lactate: 3.1, sofa: 7,
    news2: { total: 13, partial: false, missing: [], red_param: true, breakdown: {} },
  };

  it("carries the engine's score and the systolic pressure the real NEWS2 needs", () => {
    const p = patientFromBoard({ patient_id: "bed-3", risk: "critical", alerts: [], latest });
    expect(p.news2).toEqual(latest.news2);
    expect(p.vitals.sbp).toBe(96);
  });

  it("a card with no observation yet has no score at all, rather than a zero", () => {
    const p = patientFromBoard({
      patient_id: "bed-9", risk: "none", alerts: [],
      latest: { ...latest, heart_rate: null, map: null, sbp: null, spo2: null, temperature: null,
                resp_rate: null, lactate: null, sofa: null, news2: null },
    });
    expect(p.news2).toBeNull();
  });

  it("a partial score keeps its flag and what is missing, because it can only understate", () => {
    const p = patientFromBoard({
      patient_id: "bed-4", risk: "high", alerts: [],
      latest: { ...latest, resp_rate: null,
                news2: { total: 10, partial: true, missing: ["respiration_rate"],
                         red_param: true, breakdown: {} } },
    });
    expect(p.news2.partial).toBe(true);
    expect(p.news2.missing).toContain("respiration_rate");
  });
});

describe("the medication block (from pharmacyView)", () => {
  const clock = {
    recognized_at: "2026-09-08T09:00:00+00:00", deadline: "2026-09-08T10:00:00+00:00",
    remaining_sec: 1500, elapsed_sec: 2100, met: null,
  };
  const withMeds = (meds) => patientFromBoard({ patient_id: "bed-1", risk: "high", alerts: [], latest: {}, meds });

  it("carries the antibiotic clock through the adapter rather than dropping it", () => {
    const p = withMeds({ pressors: {}, on_pressor: false, antibiotic_given: null,
                         antibiotic_clock: clock, creatinine: 2.4, weight_kg: 72 });
    expect(p.meds.antibiotic_clock.remaining_sec).toBe(1500);
    expect(p.meds.creatinine).toBe(2.4);
  });

  it("a board entry with no meds block leaves it null rather than an empty regimen", () => {
    expect(patientFromBoard({ patient_id: "bed-1" }).meds).toBeNull();
  });

  it("keeps nothing charted, not given and given apart", () => {
    expect(withMeds({ antibiotic_given: null, antibiotic_clock: clock, pressors: {} }).meds.antibiotic_given)
      .toBeNull();
    expect(withMeds({ antibiotic_given: false, antibiotic_clock: clock, pressors: {} }).meds.antibiotic_given)
      .toBe(false);
    expect(withMeds({ antibiotic_given: true, antibiotic_clock: { ...clock, met: true }, pressors: {} })
      .meds.antibiotic_given).toBe(true);
  });
});
