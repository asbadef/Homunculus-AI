// src/clinicalDemo.js — self-contained, in-browser clinical simulation for the interactive demo.
// No network, no backend: this mirrors the FastAPI engine's rules (PR#1 auth/roles, PR#2 admission,
// PR#3 escalation/snooze/break-glass) so the recorded flows can be exercised live on the static PWA.
// All data here is SYNTHETIC. The system never diagnoses — clinical text uses "…değerlendirilecek".

// --------------------------------------------------------------------------- roles & accounts
export const ROLE = {
  ATTENDING: "ATTENDING",          // Sorumlu Hekim
  CHARGE_NURSE: "CHARGE_NURSE",    // Sorumlu Hemşire
  HOSPITAL_ADMIN: "HOSPITAL_ADMIN",// Admin
  RRT: "RRT",                      // Hızlı Yanıt Ekibi (escalation tier-3 target)
};

// Demo sign-in accounts. Passwords are non-secret demo values (synthetic environment only).
export const DEMO_ACCOUNTS = [
  { email: "hekim@demo",   password: "demo1234", full_name: "Dr. Elif Yılmaz",   role: ROLE.ATTENDING },
  { email: "hemsire@demo", password: "demo1234", full_name: "Hem. Ayşe Demir",   role: ROLE.CHARGE_NURSE },
  { email: "admin@demo",   password: "demo1234", full_name: "Mehmet Kaya",       role: ROLE.HOSPITAL_ADMIN },
];

// --------------------------------------------------------------------------- alert tiers
export const TIER = { CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", INFO: "INFO" };

// Severity → shared UI severity scale (theme.js: info|low|moderate|high|critical).
export const TIER_TO_SEV = {
  CRITICAL: "critical", HIGH: "high", MEDIUM: "moderate", LOW: "low", INFO: "info",
};

// --------------------------------------------------------------------------- escalation (S-05)
// Cumulative thresholds in SECONDS for unanswered CRITICAL / HIGH alarms.
export const ESCALATION_STEP = {
  NONE: "NONE",
  TIER_1_CHARGE_NURSE: "TIER_1_CHARGE_NURSE", // 3 min → Sorumlu Hemşire
  TIER_2_PHYSICIAN: "TIER_2_PHYSICIAN",       // 5 min → Nöbetçi Hekim
  TIER_3_RRT: "TIER_3_RRT",                   // 10 min → RRT / Hızlı Yanıt Ekibi
};
export const ESCALATION_THRESHOLDS_SEC = { TIER_1_CHARGE_NURSE: 180, TIER_2_PHYSICIAN: 300, TIER_3_RRT: 600 };
const STEP_ORDER = {
  NONE: 0, TIER_1_CHARGE_NURSE: 1, TIER_2_PHYSICIAN: 2, TIER_3_RRT: 3,
};
export const STEP_TARGET_ROLE = {
  TIER_1_CHARGE_NURSE: ROLE.CHARGE_NURSE,
  TIER_2_PHYSICIAN: ROLE.ATTENDING,
  TIER_3_RRT: ROLE.RRT,
};

// Only CRITICAL and HIGH alarms escalate (mirrors backend compute_escalation_step).
export function computeEscalationStep(elapsedSeconds, tier) {
  if (tier !== TIER.CRITICAL && tier !== TIER.HIGH) return ESCALATION_STEP.NONE;
  if (elapsedSeconds >= ESCALATION_THRESHOLDS_SEC.TIER_3_RRT) return ESCALATION_STEP.TIER_3_RRT;
  if (elapsedSeconds >= ESCALATION_THRESHOLDS_SEC.TIER_2_PHYSICIAN) return ESCALATION_STEP.TIER_2_PHYSICIAN;
  if (elapsedSeconds >= ESCALATION_THRESHOLDS_SEC.TIER_1_CHARGE_NURSE) return ESCALATION_STEP.TIER_1_CHARGE_NURSE;
  return ESCALATION_STEP.NONE;
}
export const stepOrder = (step) => STEP_ORDER[step] ?? 0;

// Seconds until the next escalation step (or null once at tier-3). Used for the live countdown.
export function secondsToNextStep(elapsedSeconds, tier) {
  if (tier !== TIER.CRITICAL && tier !== TIER.HIGH) return null;
  const marks = [ESCALATION_THRESHOLDS_SEC.TIER_1_CHARGE_NURSE,
                 ESCALATION_THRESHOLDS_SEC.TIER_2_PHYSICIAN,
                 ESCALATION_THRESHOLDS_SEC.TIER_3_RRT];
  for (const m of marks) if (elapsedSeconds < m) return m - elapsedSeconds;
  return null;
}

// --------------------------------------------------------------------------- snooze (S-22)
// CRITICAL can never be snoozed (ack only, with a mandatory reason). HIGH ≤ 30 min, MEDIUM ≤ 120 min.
export const SNOOZE_MAX_MINUTES = { HIGH: 30, MEDIUM: 120 };
export const ACK_REASON_MIN_CHARS = 20; // CRITICAL acknowledge note minimum.
export function canSnooze(tier) { return tier === TIER.HIGH || tier === TIER.MEDIUM; }
export function snoozeCapMinutes(tier) { return SNOOZE_MAX_MINUTES[tier] ?? null; }

// --------------------------------------------------------------------------- break-glass (S-23)
export const BREAK_GLASS_MINUTES = 30;

// --------------------------------------------------------------------------- seed structure
// A small synthetic Adult-ICU unit so admission has real bed targets.
function seedState() {
  const beds = [
    { id: "bed-01", label: "Yatak 1", state: "AVAILABLE", patientId: null },
    { id: "bed-02", label: "Yatak 2", state: "AVAILABLE", patientId: null },
    { id: "bed-03", label: "Yatak 3", state: "AVAILABLE", patientId: null },
    { id: "bed-04", label: "Yatak 4", state: "AVAILABLE", patientId: null },
  ];
  return {
    user: null,
    clockSec: 0,          // simulated seconds since demo start
    speed: 60,            // 60× → 1 simulated minute per real second (so 3 min escalates in 3 s)
    running: true,
    structure: {
      tenant: "Demo Devlet Hastanesi",
      site: "Ana Kampüs",
      unit: { name: "Erişkin YBÜ", type: "ADULT_ICU", maxBedsPerNurse: 2 },
    },
    beds,
    patients: [],         // admitted patients (each on a bed)
    alerts: [],           // active/closed alerts
    breakGlass: null,     // { by, reason, activatedAt, expiresAt }
    seq: 1,
  };
}

// --------------------------------------------------------------------------- store
// Minimal reactive store: getState / subscribe / dispatchable actions. Framework-agnostic so the
// engine can be unit-tested without React.
export function createDemoStore(initial) {
  let state = initial || seedState();
  const listeners = new Set();
  const emit = () => { for (const l of listeners) l(state); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };
  const getState = () => state;
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  function login(email, password) {
    const acct = DEMO_ACCOUNTS.find((a) => a.email === email && a.password === password);
    if (!acct) throw new Error("Geçersiz e-posta veya parola.");
    set({ user: { email: acct.email, full_name: acct.full_name, role: acct.role } });
    return acct;
  }
  function loginAs(role) {
    const acct = DEMO_ACCOUNTS.find((a) => a.role === role);
    if (!acct) throw new Error("Rol bulunamadı.");
    return login(acct.email, acct.password);
  }
  function logout() { set({ user: null }); }

  // PR#2 admission: create + sign-off in one step for the demo. Occupies the bed and puts a
  // patient card on the board.
  function admitPatient({ displayName, sex, bedId, diagnosisText }) {
    const bed = state.beds.find((b) => b.id === bedId);
    if (!bed) throw new Error("Yatak bulunamadı.");
    if (bed.state !== "AVAILABLE") throw new Error("Seçilen yatak müsait değil.");
    const pid = `P-${String(state.seq).padStart(3, "0")}`;
    const patient = {
      patient_id: pid,
      display_name: displayName,
      sex,
      bedId,
      bedLabel: bed.label,
      admittedAtSec: state.clockSec,
      diagnosis: diagnosisText,
      admittedBy: state.user?.full_name || "—",
    };
    const beds = state.beds.map((b) => (b.id === bedId ? { ...b, state: "OCCUPIED", patientId: pid } : b));
    set({ beds, patients: [...state.patients, patient], seq: state.seq + 1 });
    return patient;
  }

  // PR#3 alert: fire an alarm for a patient. Starts the escalation clock at the current sim time.
  function fireAlert({ patientId, tier, kind, summary }) {
    const patient = state.patients.find((p) => p.patient_id === patientId);
    if (!patient) throw new Error("Hasta bulunamadı.");
    const alert = {
      id: `A-${state.seq}`,
      patientId,
      bedLabel: patient.bedLabel,
      tier,
      kind: kind || "clinical_deterioration",
      summary: summary || "Klinik kötüleşme kriterleri değerlendirilecek",
      status: "FIRED",              // FIRED | ACKNOWLEDGED | SNOOZED | CLOSED
      firedAtSec: state.clockSec,
      currentStep: ESCALATION_STEP.NONE,
      events: [],                    // { step, atSec, targetRole }
      ack: null,                     // { by, reason, note, atSec }
      snooze: null,                  // { until, reason, note, atSec }
    };
    set({ alerts: [...state.alerts, alert], seq: state.seq + 1 });
    return alert;
  }

  // Advance the escalation state for every open alarm to the given sim time. Idempotent: emits one
  // event per newly-crossed step. Also auto-expires due snoozes (re-fires the alarm, clock restarts).
  function reconcile(nowSec) {
    let changed = false;
    const alerts = state.alerts.map((a) => {
      let alert = a;
      // Snooze auto-expiry → re-fire at original tier, restart the escalation clock.
      if (alert.status === "SNOOZED" && alert.snooze && nowSec >= alert.snooze.until) {
        alert = { ...alert, status: "FIRED", firedAtSec: nowSec, currentStep: ESCALATION_STEP.NONE,
                  snooze: null };
        changed = true;
      }
      if (alert.status !== "FIRED") return alert;
      const elapsed = nowSec - alert.firedAtSec;
      const target = computeEscalationStep(elapsed, alert.tier);
      if (stepOrder(target) > stepOrder(alert.currentStep)) {
        // Emit an event for every step crossed between current and target.
        const events = [...alert.events];
        for (const step of [ESCALATION_STEP.TIER_1_CHARGE_NURSE, ESCALATION_STEP.TIER_2_PHYSICIAN,
                            ESCALATION_STEP.TIER_3_RRT]) {
          if (stepOrder(step) > stepOrder(alert.currentStep) && stepOrder(step) <= stepOrder(target)) {
            events.push({ step, atSec: nowSec, targetRole: STEP_TARGET_ROLE[step] });
          }
        }
        alert = { ...alert, currentStep: target, events };
        changed = true;
      }
      return alert;
    });
    if (changed) set({ alerts, clockSec: nowSec });
    else if (nowSec !== state.clockSec) set({ clockSec: nowSec });
  }

  // Acknowledge. CRITICAL requires a reason + a note of at least ACK_REASON_MIN_CHARS chars.
  function acknowledgeAlert(alertId, { reason, note } = {}) {
    const a = state.alerts.find((x) => x.id === alertId);
    if (!a) throw new Error("Alarm bulunamadı.");
    if (a.tier === TIER.CRITICAL) {
      if (!reason) throw new Error("Kritik alarm onayı için zorunlu gerekçe gerekir.");
      if (!note || note.trim().length < ACK_REASON_MIN_CHARS) {
        throw new Error(`Kritik alarm onayı için en az ${ACK_REASON_MIN_CHARS} karakter not gerekir.`);
      }
    }
    const alerts = state.alerts.map((x) => (x.id === alertId
      ? { ...x, status: "ACKNOWLEDGED", currentStep: ESCALATION_STEP.NONE,
          ack: { by: state.user?.full_name || "—", reason: reason || null, note: note || null,
                 atSec: state.clockSec } }
      : x));
    set({ alerts });
  }

  // Snooze (S-22). CRITICAL is rejected. HIGH ≤ 30, MEDIUM ≤ 120. Reason mandatory.
  function snoozeAlert(alertId, { minutes, reason, note } = {}) {
    const a = state.alerts.find((x) => x.id === alertId);
    if (!a) throw new Error("Alarm bulunamadı.");
    if (a.tier === TIER.CRITICAL) {
      throw new Error("Kritik alarm ertelenemez; zorunlu gerekçe ile onaylanmalı veya eskale edilmeli.");
    }
    const cap = snoozeCapMinutes(a.tier);
    if (cap === null) throw new Error(`${a.tier} seviyesi ertelemeyi desteklemiyor.`);
    if (!reason) throw new Error("Erteleme için zorunlu gerekçe gerekir.");
    if (!minutes || minutes <= 0) throw new Error("Erteleme süresi pozitif olmalı.");
    if (minutes > cap) throw new Error(`Erteleme süresi ${a.tier} için en fazla ${cap} dk olabilir.`);
    const untilSec = state.clockSec + minutes * 60;
    const alerts = state.alerts.map((x) => (x.id === alertId
      ? { ...x, status: "SNOOZED", currentStep: ESCALATION_STEP.NONE,
          snooze: { until: untilSec, minutes, reason, note: note || null, atSec: state.clockSec } }
      : x));
    set({ alerts });
  }

  // Manual escalation straight to RRT (S-06).
  function escalateToRRT(alertId) {
    const a = state.alerts.find((x) => x.id === alertId);
    if (!a) throw new Error("Alarm bulunamadı.");
    const events = [...a.events, { step: ESCALATION_STEP.TIER_3_RRT, atSec: state.clockSec,
                                   targetRole: ROLE.RRT, manual: true }];
    const alerts = state.alerts.map((x) => (x.id === alertId
      ? { ...x, status: "FIRED", currentStep: ESCALATION_STEP.TIER_3_RRT, events } : x));
    set({ alerts });
  }

  // S-06: RRT may only access a patient with an active escalation event.
  function rrtHasAccess(patientId) {
    return state.alerts.some((a) => a.patientId === patientId
      && a.status !== "CLOSED"
      && a.events.some((e) => e.step === ESCALATION_STEP.TIER_3_RRT));
  }

  // Break-glass (S-23): 30 min temporary emergency access, mandatory reason, extendable.
  function activateBreakGlass(reason) {
    if (!reason || reason.trim().length < ACK_REASON_MIN_CHARS) {
      throw new Error(`Break-glass için en az ${ACK_REASON_MIN_CHARS} karakter gerekçe gerekir.`);
    }
    const breakGlass = { by: state.user?.full_name || "—", reason, activatedAtSec: state.clockSec,
                         expiresAtSec: state.clockSec + BREAK_GLASS_MINUTES * 60 };
    set({ breakGlass });
    return breakGlass;
  }
  function extendBreakGlass() {
    if (!state.breakGlass) throw new Error("Aktif break-glass oturumu yok.");
    set({ breakGlass: { ...state.breakGlass,
      expiresAtSec: state.breakGlass.expiresAtSec + BREAK_GLASS_MINUTES * 60 } });
  }
  function breakGlassActive() {
    return !!state.breakGlass && state.clockSec < state.breakGlass.expiresAtSec;
  }

  function setSpeed(speed) { set({ speed }); }
  function setRunning(running) { set({ running }); }
  function reset() { state = seedState(); emit(); }

  return {
    getState, subscribe,
    login, loginAs, logout,
    admitPatient, fireAlert, reconcile,
    acknowledgeAlert, snoozeAlert, escalateToRRT, rrtHasAccess,
    activateBreakGlass, extendBreakGlass, breakGlassActive,
    setSpeed, setRunning, reset,
  };
}
