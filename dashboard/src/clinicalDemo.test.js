import { describe, it, expect } from "vitest";
import {
  createDemoStore, buildRealisticState, computeEscalationStep, secondsToNextStep, canSnooze,
  snoozeCapMinutes, TIER, ROLE, ESCALATION_STEP,
  computeNews2, evaluateThresholds, searchIcd10, maskName, DEFAULT_THRESHOLDS, NEWS2_ALARM_THRESHOLD,
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

// ---------------------------------------------------------------- realistic seed + admin/care actions
describe("realistic environment", () => {
  it("seeds two units, ten beds and six occupied patients", () => {
    const s = createDemoStore(buildRealisticState());
    const st = s.getState();
    expect(st.structure.units).toHaveLength(2);
    expect(st.beds).toHaveLength(10);
    expect(st.patients).toHaveLength(6);
    expect(st.beds.filter((b) => b.state === "OCCUPIED")).toHaveLength(6);
  });

  it("masks national IDs for non-neonates and shows none for neonates", () => {
    const s = createDemoStore(buildRealisticState());
    const st = s.getState();
    const adult = st.patients.find((p) => !p.isNeonate);
    const baby = st.patients.find((p) => p.isNeonate);
    expect(adult.tcMasked).toMatch(/\*{3,}/);
    expect(baby.tcMasked).toBe("—");
  });

  it("transfers a patient to an available bed and frees the old one", () => {
    const s = createDemoStore(buildRealisticState());
    s.transferPatient({ patientId: "P-101", targetBedId: "bed-a103" });
    const st = s.getState();
    expect(st.beds.find((b) => b.id === "bed-a101").state).toBe("AVAILABLE");
    expect(st.beds.find((b) => b.id === "bed-a103").state).toBe("OCCUPIED");
    expect(st.patients.find((p) => p.patient_id === "P-101").bedId).toBe("bed-a103");
  });

  it("rejects a transfer onto an occupied bed", () => {
    const s = createDemoStore(buildRealisticState());
    expect(() => s.transferPatient({ patientId: "P-101", targetBedId: "bed-a102" }))
      .toThrow(/müsait değil/);
  });

  it("assigns a care team", () => {
    const s = createDemoStore(buildRealisticState());
    s.assignCareTeam({ patientId: "P-102", attendingId: "u-01", nurseId: "u-02" });
    expect(s.getState().careTeam["P-102"]).toEqual({ attendingId: "u-01", nurseId: "u-02" });
  });

  it("requires a substantial handover note", () => {
    const s = createDemoStore(buildRealisticState());
    expect(() => s.createHandover({ patientId: "P-101", toName: "X", note: "kısa" }))
      .toThrow(/karakter/);
    const h = s.createHandover({ patientId: "P-101", fromName: "A", toName: "B",
      note: "Hasta stabil, vazopresör dozu azaltıldı, gece takibi önerilir." });
    expect(h.signedAtMs).toBeGreaterThan(0);
    expect(s.getState().handovers).toHaveLength(1);
  });
});

describe("admin actions", () => {
  it("creates a user with validation", () => {
    const s = createDemoStore(buildRealisticState());
    expect(() => s.createUser({ full_name: "X", email: "bad", role: ROLE.ATTENDING }))
      .toThrow(/e-posta/);
    const u = s.createUser({ full_name: "Dr. Yeni Hekim", email: "yeni@homunculus.health",
      role: ROLE.ATTENDING });
    expect(u.id).toMatch(/^u-/);
    expect(s.getState().users.some((x) => x.email === "yeni@homunculus.health")).toBe(true);
  });

  it("adds a unit, room and bed", () => {
    const s = createDemoStore(buildRealisticState());
    const unit = s.addUnit({ name: "Koroner YBÜ", type: "ADULT_ICU" });
    const room = s.addRoom({ unitId: unit.id, label: "Oda C1" });
    const bed = s.addBed({ unitId: unit.id, roomId: room.id, label: "301" });
    const st = s.getState();
    expect(st.structure.units.some((u) => u.id === unit.id)).toBe(true);
    expect(st.beds.find((b) => b.id === bed.id).state).toBe("AVAILABLE");
    expect(st.beds.find((b) => b.id === bed.id).roomLabel).toBe("Oda C1");
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

// ================================================================ PR#6 additions
// ---------------------------------------------------------------- NEWS2 + thresholds (auto-alarm)
describe("computeNews2", () => {
  it("scores a stable patient low", () => {
    expect(computeNews2({ hr: 80, map: 88, spo2: 98, temp: 36.8, rr: 16 })).toBeLessThan(NEWS2_ALARM_THRESHOLD);
  });
  it("scores a deteriorating patient at or above the alarm threshold", () => {
    expect(computeNews2({ hr: 128, map: 58, spo2: 89, temp: 39.2, rr: 32 })).toBeGreaterThanOrEqual(NEWS2_ALARM_THRESHOLD);
  });
});

describe("evaluateThresholds", () => {
  it("reports no breaches within limits", () => {
    expect(evaluateThresholds({ hr: 80, map: 80, spo2: 97 }, DEFAULT_THRESHOLDS)).toEqual([]);
  });
  it("flags SpO2, HR and MAP breaches", () => {
    const b = evaluateThresholds({ hr: 140, map: 55, spo2: 85 }, DEFAULT_THRESHOLDS);
    expect(b).toContain("SpO2"); expect(b).toContain("HR"); expect(b).toContain("MAP");
  });
});

describe("searchIcd10 / maskName", () => {
  it("finds diagnoses by code or text and never translates the code", () => {
    const r = searchIcd10("sepsis");
    expect(r.some((x) => x.code === "A41.9")).toBe(true);
    expect(searchIcd10("J96")[0].code).toBe("J96.0");
  });
  it("masks names to first initials", () => {
    expect(maskName("Ahmet Yılmaz")).toBe("A*** Y***");
  });
});

// ---------------------------------------------------------------- automatic alarm engine (S-05)
describe("automatic alarm engine", () => {
  it("auto-fires an alarm for a patient breaching thresholds on reconcile", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    s.reconcile(1);
    const alerts = s.getState().alerts;
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.summary.includes("değerlendirilecek"))).toBe(true);
    // A critical desaturating patient (P-104, SpO2 91/MAP 58) escalates to CRITICAL.
    expect(alerts.some((a) => a.patientId === "P-104" && a.tier === TIER.CRITICAL)).toBe(true);
  });
  it("does not duplicate an alarm while one is already open", () => {
    const s = createDemoStore(buildRealisticState());
    s.reconcile(1);
    const first = s.getState().alerts.length;
    s.reconcile(2);
    expect(s.getState().alerts.length).toBe(first);
  });
  it("respects the autoAlarm off switch", () => {
    const s = createDemoStore(buildRealisticState());
    s.setAutoAlarm(false);
    s.reconcile(1);
    expect(s.getState().alerts.length).toBe(0);
  });
});

// ---------------------------------------------------------------- clinical data entry (physician)
describe("clinical data entry", () => {
  it("records ICD-10 diagnosis, medication, procedure and fluids with audit", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    s.addDiagnosis({ patientId: "P-102", code: "J44.1", text: "KOAH akut alevlenme" });
    s.addMedication({ patientId: "P-102", name: "Furosemid", dose: "40", unit: "mg" });
    s.addProcedure({ patientId: "P-102", name: "Arteriyel kateter" });
    s.addFluid({ patientId: "P-102", kind: "in", label: "IV sıvı", ml: 500 });
    s.addFluid({ patientId: "P-102", kind: "out", label: "İdrar", ml: 300 });
    const rec = s.getState().clinical["P-102"];
    expect(rec.diagnoses.at(-1).code).toBe("J44.1");
    expect(rec.medications.at(-1).name).toBe("Furosemid");
    expect(rec.procedures.at(-1).name).toBe("Arteriyel kateter");
    expect(rec.fluids.filter((f) => f.kind === "in").length).toBe(1);
    const log = s.getState().auditLog.map((e) => e.action);
    expect(log).toContain("DIAGNOSIS_ADD");
    expect(log).toContain("MEDICATION_ADD");
    expect(log).toContain("FLUID_ADD");
  });
  it("rejects a diagnosis without an ICD-10 code and a fluid with non-positive volume", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    expect(() => s.addDiagnosis({ patientId: "P-102", text: "no code" })).toThrow(/ICD-10/);
    expect(() => s.addFluid({ patientId: "P-102", kind: "in", ml: 0 })).toThrow(/pozitif/);
  });
});

// ---------------------------------------------------------------- physician thresholds
describe("physician thresholds", () => {
  it("stores per-patient limits and they influence the auto-alarm tier", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    const merged = s.setThresholds({ patientId: "P-102", thresholds: { spo2Min: 99 } });
    expect(merged.spo2Min).toBe(99);
    s.reconcile(1);
    // P-102 (SpO2 97) now breaches the tightened 99 limit → an alarm exists for it.
    expect(s.getState().alerts.some((a) => a.patientId === "P-102")).toBe(true);
  });
});

// ---------------------------------------------------------------- mute + KVKK masking + audit
describe("mute, masking and audit", () => {
  it("mutes an alarm without acknowledging it and writes an audit entry", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.CHARGE_NURSE);
    const a = s.fireAlert({ patientId: "P-101", tier: TIER.HIGH });
    s.muteAlert(a.id, 2);
    const alert = s.getState().alerts.find((x) => x.id === a.id);
    expect(alert.mutedUntil).toBeGreaterThan(0);
    expect(alert.status).toBe("FIRED"); // muting never acknowledges
    expect(s.getState().auditLog.some((e) => e.action === "ALERT_MUTE")).toBe(true);
  });
  it("toggles KVKK name masking globally", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    expect(s.getState().maskNames).toBe(false);
    s.toggleMaskNames();
    expect(s.getState().maskNames).toBe(true);
    expect(s.getState().auditLog.some((e) => e.action === "MASK_NAMES")).toBe(true);
  });
});


// ================================================================ PR#7 additions
// Fast PIN switch, staff→bed matrix, MDI device simulator, handover CRITICAL block,
// break-glass review and offline sync engine.
describe("PR#7 · fast PIN switch", () => {
  it("switches the active user by 4-digit PIN and audits it", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    const u = s.switchUserByPin("2222"); // ayse.demir · charge nurse
    expect(u.role).toBe(ROLE.CHARGE_NURSE);
    expect(s.getState().user.role).toBe(ROLE.CHARGE_NURSE);
    expect(s.getState().auditLog.some((e) => e.action === "PIN_SWITCH")).toBe(true);
  });
  it("rejects an unknown PIN", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    expect(() => s.switchUserByPin("0000")).toThrow();
  });
  it("logs in with a PIN as credential", () => {
    const s = createDemoStore(buildRealisticState());
    const u = s.login("admin@homunculus.health", "9999");
    expect(u.role).toBe(ROLE.HOSPITAL_ADMIN);
  });
});

describe("PR#7 · staff → bed matrix", () => {
  it("assigns beds to a staff member and toggles a single bed", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    s.assignStaffToBeds({ userId: "u-02", bedIds: ["bed-a101"] });
    expect(s.getState().staffAssignments["u-02"].bedIds).toContain("bed-a101");
    s.toggleStaffBed({ userId: "u-02", bedId: "bed-a102" });
    expect(s.getState().staffAssignments["u-02"].bedIds).toContain("bed-a102");
    s.toggleStaffBed({ userId: "u-02", bedId: "bed-a102" });
    expect(s.getState().staffAssignments["u-02"].bedIds).not.toContain("bed-a102");
    expect(s.getState().auditLog.some((e) => e.action === "STAFF_ASSIGN")).toBe(true);
  });
});

describe("PR#7 · MDI device simulator", () => {
  it("adds a device with IP validation and assigns it to a bed", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    expect(() => s.addDevice({ model: "N17", ip: "not-an-ip" })).toThrow();
    const dev = s.addDevice({ vendor: "Mindray", model: "BeneVision N22", ip: "192.168.9.99" });
    expect(dev.connected).toBe(false); // no bed yet
    s.assignDeviceToBed({ deviceId: dev.id, bedId: "bed-a102" });
    expect(s.getState().devices.find((d) => d.id === dev.id).connected).toBe(true);
    expect(s.getState().auditLog.some((e) => e.action === "DEVICE_ADD")).toBe(true);
    expect(s.getState().auditLog.some((e) => e.action === "DEVICE_ASSIGN")).toBe(true);
  });
  it("rejects a duplicate IP", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    s.addDevice({ model: "A", ip: "10.0.0.1" });
    expect(() => s.addDevice({ model: "B", ip: "10.0.0.1" })).toThrow();
  });
  it("jitters vitals for beds with a connected device while online", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    const before = s.getState().devices.find((d) => d.connected);
    s.reconcile(s.getState().clockSec + 1);
    const after = s.getState().devices.find((d) => d.id === before.id);
    expect(after.packets).toBeGreaterThan(before.packets);
  });
});

describe("PR#7 · handover CRITICAL block (S5)", () => {
  it("blocks a handover while an unanswered CRITICAL alarm is open", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    s.fireAlert({ patientId: "P-101", tier: TIER.CRITICAL });
    let thrown = null;
    try { s.createHandover({ patientId: "P-101", toName: "B", note: "Yeterince uzun devir notu buraya yazıldı." }); }
    catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe("HANDOVER_BLOCKED_CRITICAL");
    expect(s.getState().auditLog.some((e) => e.action === "HANDOVER_BLOCKED")).toBe(true);
  });
  it("allows the handover once the CRITICAL alarm is acknowledged", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    const a = s.fireAlert({ patientId: "P-102", tier: TIER.CRITICAL });
    s.acknowledgeAlert(a.id, { reason: "Görüldü", note: "Hasta değerlendirildi ve stabil." });
    const h = s.createHandover({ patientId: "P-102", toName: "B", note: "Devir notu yeterince uzun biçimde yazıldı." });
    expect(h.signedAtMs).toBeGreaterThan(0);
  });
});

describe("PR#7 · break-glass review", () => {
  it("approves a pending break-glass session with a note", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.ATTENDING);
    s.activateBreakGlass("Acil erişim gerekli: hasta devri sırasında kayıt görüntülenecek.");
    expect(s.getState().breakGlass.reviewStatus).toBe("pending");
    s.loginAs(ROLE.HOSPITAL_ADMIN);
    s.reviewBreakGlass({ approve: true, note: "Gerekçe uygun." });
    expect(s.getState().breakGlass.reviewStatus).toBe("approved");
    expect(s.getState().auditLog.some((e) => e.action === "BREAK_GLASS_REVIEW")).toBe(true);
  });
});

describe("PR#7 · offline sync engine (B5)", () => {
  it("queues changes offline and flushes them on reconnect", () => {
    const s = createDemoStore(buildRealisticState());
    s.loginAs(ROLE.CHARGE_NURSE);
    s.setOnline(false);
    expect(s.getState().online).toBe(false);
    s.queueOffline("ALERT_ACK", { alertId: "A-1" });
    expect(s.getState().syncQueue).toHaveLength(1);
    s.setOnline(true);
    expect(s.getState().online).toBe(true);
    expect(s.getState().syncQueue).toHaveLength(0); // flushed
    expect(s.getState().auditLog.some((e) => e.action === "SYNC_FLUSH")).toBe(true);
  });
});
