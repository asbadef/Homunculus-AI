import { describe, it, expect } from "vitest";
import {
  createDemoStore, computeEscalationStep, secondsToNextStep, canSnooze, snoozeCapMinutes,
  TIER, ROLE, ESCALATION_STEP,
} from "./clinicalDemo.js";

// ---------------------------------------------------------------- pure escalation logic (S-05)
describe("computeEscalationStep", () => {
  it("stays NONE before 3 minutes", () => {
    expect(computeEscalationStep(179, TIER.CRITICAL)).toBe(ESCALATION_STEP.NONE);
  });
  it("hits tier-1 (charge nurse) at 3 minutes", () => {
    expect(computeEscalationStep(180, TIER.CRITICAL)).toBe(ESCALATION_STEP.TIER_1_CHARGE_NURSE);
  });
  it("hits tier-2 (physician) at 5 minutes", () => {
    expect(computeEscalationStep(300, TIER.HIGH)).toBe(ESCALATION_STEP.TIER_2_PHYSICIAN);
  });
  it("hits tier-3 (RRT) at 10 minutes", () => {
    expect(computeEscalationStep(600, TIER.CRITICAL)).toBe(ESCALATION_STEP.TIER_3_RRT);
  });
  it("does not escalate MEDIUM/LOW alarms", () => {
    expect(computeEscalationStep(9999, TIER.MEDIUM)).toBe(ESCALATION_STEP.NONE);
    expect(computeEscalationStep(9999, TIER.LOW)).toBe(ESCALATION_STEP.NONE);
  });
});

describe("secondsToNextStep", () => {
  it("counts down to the first threshold", () => {
    expect(secondsToNextStep(100, TIER.CRITICAL)).toBe(80);
  });
  it("returns null once at tier-3", () => {
    expect(secondsToNextStep(600, TIER.CRITICAL)).toBe(null);
  });
});

// ---------------------------------------------------------------- snooze policy (S-22)
describe("snooze policy", () => {
  it("never allows snoozing CRITICAL", () => expect(canSnooze(TIER.CRITICAL)).toBe(false));
  it("caps HIGH at 30 min", () => expect(snoozeCapMinutes(TIER.HIGH)).toBe(30));
  it("caps MEDIUM at 120 min", () => expect(snoozeCapMinutes(TIER.MEDIUM)).toBe(120));
});

// ---------------------------------------------------------------- store: admission (PR#2)
describe("admission flow", () => {
  it("occupies a bed and adds a patient card", () => {
    const s = createDemoStore();
    s.loginAs(ROLE.ATTENDING);
    const p = s.admitPatient({ displayName: "Sentetik Hasta", sex: "male", bedId: "bed-01",
      diagnosisText: "Sepsis kriterleri değerlendirilecek" });
    const st = s.getState();
    expect(st.patients).toHaveLength(1);
    expect(st.beds.find((b) => b.id === "bed-01").state).toBe("OCCUPIED");
    expect(p.patient_id).toMatch(/^P-/);
  });
  it("rejects admission to an occupied bed", () => {
    const s = createDemoStore();
    s.loginAs(ROLE.ATTENDING);
    s.admitPatient({ displayName: "A", sex: "female", bedId: "bed-01", diagnosisText: "x" });
    expect(() => s.admitPatient({ displayName: "B", sex: "male", bedId: "bed-01", diagnosisText: "y" }))
      .toThrow(/müsait değil/);
  });
});

// ---------------------------------------------------------------- store: escalation cycle (S-05/S-06)
function admittedStore() {
  const s = createDemoStore();
  s.loginAs(ROLE.ATTENDING);
  const p = s.admitPatient({ displayName: "Sentetik", sex: "male", bedId: "bed-01",
    diagnosisText: "Septik şok kriterleri değerlendirilecek" });
  return { s, pid: p.patient_id };
}

describe("escalation cycle", () => {
  it("advances through tier-1/2/3 and is idempotent", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "Septik şok" });
    s.reconcile(180);
    expect(s.getState().alerts[0].currentStep).toBe(ESCALATION_STEP.TIER_1_CHARGE_NURSE);
    s.reconcile(600);
    const alert = s.getState().alerts[0];
    expect(alert.currentStep).toBe(ESCALATION_STEP.TIER_3_RRT);
    // Three distinct step events crossed.
    expect(alert.events.map((e) => e.step)).toEqual([
      ESCALATION_STEP.TIER_1_CHARGE_NURSE, ESCALATION_STEP.TIER_2_PHYSICIAN, ESCALATION_STEP.TIER_3_RRT,
    ]);
    // Reconciling again emits no new events.
    s.reconcile(700);
    expect(s.getState().alerts[0].events).toHaveLength(3);
    expect(a.id).toBeDefined();
  });

  it("acknowledging a CRITICAL alert requires reason + note", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "Septik şok" });
    expect(() => s.acknowledgeAlert(a.id, {})).toThrow(/gerekçe/);
    expect(() => s.acknowledgeAlert(a.id, { reason: "clinically_reviewed", note: "kısa" }))
      .toThrow(/karakter/);
    s.acknowledgeAlert(a.id, { reason: "clinically_reviewed",
      note: "Hasta başında değerlendirildi ve gerekli müdahale yapıldı." });
    expect(s.getState().alerts[0].status).toBe("ACKNOWLEDGED");
  });

  it("acknowledging stops escalation", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "x" });
    s.reconcile(180);
    s.acknowledgeAlert(a.id, { reason: "r", note: "Yeterince uzun bir gerekçe notu buraya yazıldı." });
    s.reconcile(600);
    expect(s.getState().alerts[0].currentStep).toBe(ESCALATION_STEP.NONE);
    expect(s.getState().alerts[0].events.length).toBeLessThan(3);
  });

  it("manual escalation jumps to RRT and grants RRT access", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.HIGH, summary: "x" });
    expect(s.rrtHasAccess(pid)).toBe(false);
    s.escalateToRRT(a.id);
    expect(s.getState().alerts[0].currentStep).toBe(ESCALATION_STEP.TIER_3_RRT);
    expect(s.rrtHasAccess(pid)).toBe(true);
  });
});

// ---------------------------------------------------------------- store: snooze (S-22)
describe("snooze rules", () => {
  it("rejects snoozing CRITICAL", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.CRITICAL, summary: "x" });
    expect(() => s.snoozeAlert(a.id, { minutes: 10, reason: "r" })).toThrow(/ertelenemez/);
  });
  it("rejects HIGH snooze beyond 30 min", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.HIGH, summary: "x" });
    expect(() => s.snoozeAlert(a.id, { minutes: 31, reason: "r" })).toThrow(/en fazla 30/);
  });
  it("snoozes HIGH within cap and re-fires on expiry", () => {
    const { s, pid } = admittedStore();
    const a = s.fireAlert({ patientId: pid, tier: TIER.HIGH, summary: "x" });
    s.snoozeAlert(a.id, { minutes: 10, reason: "clinically_expected" });
    expect(s.getState().alerts[0].status).toBe("SNOOZED");
    // Before expiry: still snoozed.
    s.reconcile(300);
    expect(s.getState().alerts[0].status).toBe("SNOOZED");
    // After expiry (10 min = 600 s): re-fires.
    s.reconcile(601);
    expect(s.getState().alerts[0].status).toBe("FIRED");
  });
});

// ---------------------------------------------------------------- store: break-glass (S-23)
describe("break-glass", () => {
  it("requires a substantial reason and activates a 30-min window", () => {
    const s = createDemoStore();
    s.loginAs(ROLE.ATTENDING);
    expect(() => s.activateBreakGlass("kısa")).toThrow(/karakter/);
    s.activateBreakGlass("Acil durum: hasta başka üniteye devredildi, erişim gerekli.");
    expect(s.breakGlassActive()).toBe(true);
    s.reconcile(30 * 60 + 1);
    expect(s.breakGlassActive()).toBe(false);
    s.extendBreakGlass();
    expect(s.breakGlassActive()).toBe(true);
  });
});
