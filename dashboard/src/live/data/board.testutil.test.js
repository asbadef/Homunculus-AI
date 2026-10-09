// The shared fixtures are themselves tested, because three parallel arms build every screen test
// on them and a fixture that quietly does not hold what it was asked to hold makes a screen test
// assert against a card the engine could never send. It had never been exercised at all.
import { describe, it, expect } from "vitest";
import { alarm, ago, board, entry, identity, measured, news2, reading, riskOf, scopedTo, NOW } from "./board.testutil.js";
import { alertsFromPatients, patientsFromBoard } from "../../liveAdapters.js";
import { hasMeasurement } from "../screens/common/freshness.js";
import { measuredVitals } from "../screens/common/vitals.js";

describe("the convention, so copying the nearest example cannot go quietly wrong", () => {
  it("takes the alarms as the second argument", () => {
    const card = entry("S-001", [alarm("news2", "high")]);
    expect(card.alerts).toHaveLength(1);
    expect(card.alerts[0].kind).toBe("news2");
  });

  it("refuses an override where the alarm array belongs, instead of dropping the alarms", () => {
    // What used to happen silently: the object was spread where an array was expected, so the card
    // came out with `alerts: []` and a junk "0" key, and the test's alarm was simply not there.
    expect(() => entry("S-001", { alerts: [alarm()] })).toThrow(/second argument is the alarm ARRAY/);
    expect(() => alarm("news2", { acknowledged: true })).toThrow(/severity is a string/);
  });

  it("derives the card's risk from its alarms, so no fixture says 'no finding' beside a high one", () => {
    expect(entry("S-001").risk).toBe("none");
    expect(entry("S-001", [alarm("news2", "high")]).risk).toBe("high");
    expect(entry("S-001", [alarm("news2", "low"), alarm("sepsis", "critical")]).risk).toBe("critical");
    expect(riskOf([])).toBe("none");
    expect(riskOf(null)).toBe("none");
    expect(riskOf([{ severity: "not-a-severity" }])).toBe("none");
  });

  it("still lets a test state a risk the alarms do not imply, on purpose", () => {
    // The engine CAN send a low risk with a high-scoring parameter (the patient-relative layer),
    // so the override has to stay — it just has to be asked for.
    expect(entry("S-001", [alarm("news2", "high")], { risk: "low" }).risk).toBe("low");
  });
});

describe("a fixture's readings and their ages cannot disagree", () => {
  it("gives a timestamp to exactly the channels that have a value", () => {
    const { vitals, at } = reading({ heart_rate: 96, spo2: 91 }, 30);
    expect(Object.keys(vitals).sort()).toEqual(Object.keys(at).sort());
    expect(at.heart_rate).toBe(ago(30));
  });

  it("builds a card whose numbers and whose ages are the same channels", () => {
    const card = entry("S-001", [], reading({ heart_rate: 96, spo2: 91 }));
    const [patient] = patientsFromBoard(board([card]));
    expect(hasMeasurement(patient.measuredAt)).toBe(true);
    expect(measuredVitals(patient).map((v) => v.at)).toEqual(["heart_rate", "spo2"]);
    for (const v of measuredVitals(patient)) expect(v.at_, v.at).not.toBeNull();
  });

  it("says in its own name that `measured` carries instants and no values", () => {
    // A real state, and not the one a screen test usually means — so it is worth one assertion
    // that says which it is, rather than a reader discovering it from an empty vital row.
    const card = entry("S-001", [], { at: measured(30) });
    const [patient] = patientsFromBoard(board([card]));
    expect(hasMeasurement(patient.measuredAt)).toBe(true);
    expect(measuredVitals(patient)).toEqual([]);
  });
});

describe("a fixture survives the trip the real payload makes", () => {
  it("comes out of the adapter as the card and the alarms a screen will read", () => {
    const payload = board([
      entry("S-001", [alarm("news2", "high", { downgraded: false })],
        { identity: identity(), score: news2({ total: 6 }), ...reading({ heart_rate: 118, spo2: 91 }) }),
      entry("S-002"),
    ], { scope: scopedTo(["REA-01"]), scope_note: "1 birim" });

    const patients = patientsFromBoard(payload);
    expect(patients.map((p) => p.patient_id)).toEqual(["S-001", "S-002"]);

    const [first, second] = patients;
    expect(first.display_name).toBe("Ayşe Sentetik");
    expect(first.bedId).toBe("REA-01-2");
    expect(first.unitId).toBe("REA-01");
    expect(first.bedMatched).toBe(true);
    expect(first.risk).toBe("high");
    expect(first.vitals.hr).toBe(118);
    expect(first.news2.total).toBe(6);
    // The identity-less card: no name, no bed, and nothing that reads as a finding.
    expect(second.display_name).toBeNull();
    expect(second.bedId).toBeNull();
    expect(second.risk).toBe("none");
    expect(hasMeasurement(second.measuredAt)).toBe(false);

    const alerts = alertsFromPatients(patients);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("high");
    expect(alerts[0].ack).toBeNull();
    expect(alerts[0].firstSeenAtMs).toBe(NOW - 247_000);
  });

  it("carries an acknowledgement through as the alarms row will read it", () => {
    const acked = alarm("sepsis", "critical", {
      acknowledged: true, acknowledged_by: "ayse", acknowledged_at: ago(60),
    });
    const [alert] = alertsFromPatients(patientsFromBoard(board([entry("S-001", [acked])])));
    expect(alert.ack).not.toBeNull();
    expect(alert.ackBy).toBe("ayse");
    expect(alert.ackAtMs).toBe(NOW - 60_000);
  });

  it("holds no patient data — synthetic ids, units and names only", () => {
    // CLAUDE.md hard rule 6, asserted rather than trusted to a header comment.
    const payload = board([entry("S-001", [alarm()], { identity: identity() })]);
    const text = JSON.stringify(payload);
    expect(text).toMatch(/S-001/);
    expect(text).toMatch(/Ayşe Sentetik/);
    expect(text).toMatch(/REA-01/);
  });
});
