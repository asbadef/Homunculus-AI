// src/clinicalDemo.js — self-contained, in-browser clinical engine for the workspace.
// No network, no backend: this mirrors the FastAPI engine's rules (PR#1 auth/roles, PR#2 admission,
// PR#3 escalation/snooze/break-glass) so the flows can be exercised live on the static PWA.
// All data here is SYNTHETIC (fake people, masked IDs) but rendered at production fidelity.
// The system never diagnoses — machine-generated alert text uses "…kriterleri değerlendirilecek".

// --------------------------------------------------------------------------- roles & accounts
export const ROLE = {
  ATTENDING: "ATTENDING",          // Sorumlu Hekim
  CHARGE_NURSE: "CHARGE_NURSE",    // Sorumlu Hemşire
  HOSPITAL_ADMIN: "HOSPITAL_ADMIN",// Sistem Yöneticisi
  RRT: "RRT",                      // Hızlı Yanıt Ekibi (escalation tier-3 target)
};

// Sign-in accounts (synthetic environment; a single shared non-secret password for all).
export const DEMO_PASSWORD = "Homunculus2025";
export const DEMO_ACCOUNTS = [
  { email: "dr.elif.yilmaz@homunculus.health", password: DEMO_PASSWORD, full_name: "Dr. Elif Yılmaz", role: ROLE.ATTENDING },
  { email: "ayse.demir@homunculus.health",     password: DEMO_PASSWORD, full_name: "Ayşe Demir",      role: ROLE.CHARGE_NURSE },
  { email: "admin@homunculus.health",          password: DEMO_PASSWORD, full_name: "Mehmet Kaya",     role: ROLE.HOSPITAL_ADMIN },
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

// --------------------------------------------------------------------------- helpers
// A synthetic, masked national-ID string. Real national IDs never enter the system; only the first
// two and last two digits are ever shown (KVKK data-minimisation).
function maskTc() {
  const d = () => Math.floor(Math.random() * 10);
  return `${d()}${d()}*******${d()}${d()}`;
}

// --------------------------------------------------------------------------- seed structure
// Minimal seed used by the unit tests: one Adult-ICU unit with four empty beds. Kept intentionally
// small and stable so the engine can be exercised deterministically.
function seedState() {
  const beds = [
    { id: "bed-01", label: "Yatak 1", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "AVAILABLE", patientId: null },
    { id: "bed-02", label: "Yatak 2", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "AVAILABLE", patientId: null },
    { id: "bed-03", label: "Yatak 3", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "AVAILABLE", patientId: null },
    { id: "bed-04", label: "Yatak 4", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "AVAILABLE", patientId: null },
  ];
  return {
    user: null,
    clockSec: 0,          // simulated seconds since demo start
    speed: 60,            // 60× → 1 simulated minute per real second (so 3 min escalates in 3 s)
    running: true,
    structure: {
      tenant: "Homunculus Şehir Hastanesi",
      site: "Merkez Kampüs",
      units: [
        { id: "unit-adult", name: "Erişkin YBÜ", type: "ADULT_ICU", maxBedsPerNurse: 2,
          rooms: [{ id: "room-a1", label: "Oda A1" }] },
      ],
    },
    users: [],
    careTeam: {},         // patientId → { attendingId, nurseId }
    handovers: [],        // { id, patientId, fromName, toName, note, signedAtMs }
    beds,
    patients: [],         // admitted patients (each on a bed)
    alerts: [],           // active/closed alerts
    breakGlass: null,     // { by, reason, activatedAt, expiresAt }
    seq: 1,
  };
}

// --------------------------------------------------------------------------- realistic seed
// A production-fidelity synthetic environment used by the live workspace UI. All identities are
// FAKE and every national ID is masked; nothing here is real patient data.
export function buildRealisticState() {
  const now = Date.now();
  const hrs = (h) => now - h * 3600 * 1000;

  const users = [
    { id: "u-01", full_name: "Dr. Elif Yılmaz", email: "dr.elif.yilmaz@homunculus.health", role: ROLE.ATTENDING,    active: true, mfa: true },
    { id: "u-02", full_name: "Ayşe Demir",      email: "ayse.demir@homunculus.health",     role: ROLE.CHARGE_NURSE,  active: true, mfa: true },
    { id: "u-03", full_name: "Mehmet Kaya",     email: "admin@homunculus.health",          role: ROLE.HOSPITAL_ADMIN, active: true, mfa: true },
    { id: "u-04", full_name: "Dr. Can Öztürk",  email: "dr.can.ozturk@homunculus.health",  role: ROLE.ATTENDING,    active: true, mfa: false },
    { id: "u-05", full_name: "Selin Arslan",    email: "selin.arslan@homunculus.health",   role: ROLE.CHARGE_NURSE, active: true, mfa: true },
  ];

  const structure = {
    tenant: "Homunculus Şehir Hastanesi",
    site: "Merkez Kampüs",
    units: [
      { id: "unit-adult", name: "Erişkin YBÜ", type: "ADULT_ICU", maxBedsPerNurse: 2,
        rooms: [{ id: "room-a1", label: "Oda A1" }, { id: "room-a2", label: "Oda A2" }] },
      { id: "unit-nicu", name: "Yenidoğan YBÜ", type: "NICU", maxBedsPerNurse: 3,
        rooms: [{ id: "room-n1", label: "Oda N1" }] },
    ],
  };

  const beds = [
    { id: "bed-a101", label: "101", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "OCCUPIED", patientId: "P-101" },
    { id: "bed-a102", label: "102", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "OCCUPIED", patientId: "P-102" },
    { id: "bed-a103", label: "103", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a1", roomLabel: "Oda A1", state: "AVAILABLE", patientId: null },
    { id: "bed-a104", label: "104", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a2", roomLabel: "Oda A2", state: "OCCUPIED", patientId: "P-103" },
    { id: "bed-a105", label: "105", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a2", roomLabel: "Oda A2", state: "OCCUPIED", patientId: "P-104" },
    { id: "bed-a106", label: "106", unitId: "unit-adult", unitName: "Erişkin YBÜ", roomId: "room-a2", roomLabel: "Oda A2", state: "AVAILABLE", patientId: null },
    { id: "bed-n201", label: "201", unitId: "unit-nicu", unitName: "Yenidoğan YBÜ", roomId: "room-n1", roomLabel: "Oda N1", state: "OCCUPIED", patientId: "P-105" },
    { id: "bed-n202", label: "202", unitId: "unit-nicu", unitName: "Yenidoğan YBÜ", roomId: "room-n1", roomLabel: "Oda N1", state: "OCCUPIED", patientId: "P-106" },
    { id: "bed-n203", label: "203", unitId: "unit-nicu", unitName: "Yenidoğan YBÜ", roomId: "room-n1", roomLabel: "Oda N1", state: "AVAILABLE", patientId: null },
    { id: "bed-n204", label: "204", unitId: "unit-nicu", unitName: "Yenidoğan YBÜ", roomId: "room-n1", roomLabel: "Oda N1", state: "AVAILABLE", patientId: null },
  ];

  const patients = [
    { patient_id: "P-101", display_name: "Ahmet Yıldız", sex: "male", age: 67, isNeonate: false,
      tcMasked: "12*******34", mrn: "MRN-104821", protocolNo: "2025/0004821",
      bedId: "bed-a101", bedLabel: "101", unitId: "unit-adult", admittedAtMs: hrs(52), admittedBy: "Dr. Elif Yılmaz",
      diagnosis: "Toplum kökenli pnömoni, akut solunum yetmezliği", risk: "high", source: "emergency",
      vitals: { hr: 112, map: 68, spo2: 89, temp: 38.4, rr: 28 } },
    { patient_id: "P-102", display_name: "Fatma Kaya", sex: "female", age: 54, isNeonate: false,
      tcMasked: "27*******06", mrn: "MRN-104822", protocolNo: "2025/0004822",
      bedId: "bed-a102", bedLabel: "102", unitId: "unit-adult", admittedAtMs: hrs(20), admittedBy: "Dr. Can Öztürk",
      diagnosis: "Postoperatif takip (majör abdominal cerrahi)", risk: "stable", source: "or",
      vitals: { hr: 82, map: 88, spo2: 97, temp: 36.8, rr: 16 } },
    { patient_id: "P-103", display_name: "Mehmet Demir", sex: "male", age: 72, isNeonate: false,
      tcMasked: "45*******19", mrn: "MRN-104823", protocolNo: "2025/0004823",
      bedId: "bed-a104", bedLabel: "104", unitId: "unit-adult", admittedAtMs: hrs(76), admittedBy: "Dr. Elif Yılmaz",
      diagnosis: "Akut böbrek hasarı, elektrolit dengesizliği", risk: "high", source: "ward",
      vitals: { hr: 96, map: 72, spo2: 94, temp: 37.1, rr: 20 } },
    { patient_id: "P-104", display_name: "Zeynep Şahin", sex: "female", age: 61, isNeonate: false,
      tcMasked: "63*******88", mrn: "MRN-104824", protocolNo: "2025/0004824",
      bedId: "bed-a105", bedLabel: "105", unitId: "unit-adult", admittedAtMs: hrs(6), admittedBy: "Dr. Elif Yılmaz",
      diagnosis: "Sepsis şüphesi, hipotansiyon", risk: "critical", source: "emergency",
      vitals: { hr: 128, map: 58, spo2: 91, temp: 39.2, rr: 32 } },
    { patient_id: "P-105", display_name: "Bebek Aydın", sex: "male", age: 0, isNeonate: true, ageDays: 3,
      tcMasked: "—", mrn: "MRN-104825", protocolNo: "2025/0004825",
      bedId: "bed-n201", bedLabel: "201", unitId: "unit-nicu", admittedAtMs: hrs(70), admittedBy: "Dr. Can Öztürk",
      diagnosis: "Prematürite (32 hafta), respiratuar destek", risk: "high", source: "delivery",
      vitals: { hr: 158, map: 42, spo2: 92, temp: 36.5, rr: 52 } },
    { patient_id: "P-106", display_name: "Bebek Çelik", sex: "female", age: 0, isNeonate: true, ageDays: 8,
      tcMasked: "—", mrn: "MRN-104826", protocolNo: "2025/0004826",
      bedId: "bed-n202", bedLabel: "202", unitId: "unit-nicu", admittedAtMs: hrs(30), admittedBy: "Dr. Can Öztürk",
      diagnosis: "Yenidoğan sarılığı, fototerapi", risk: "low", source: "delivery",
      vitals: { hr: 140, map: 48, spo2: 97, temp: 36.9, rr: 44 } },
  ];

  const careTeam = {
    "P-101": { attendingId: "u-01", nurseId: "u-02" },
    "P-104": { attendingId: "u-01", nurseId: "u-02" },
    "P-105": { attendingId: "u-04", nurseId: "u-05" },
  };

  return {
    user: null,
    clockSec: 0,
    speed: 60,
    running: true,
    structure,
    users,
    careTeam,
    handovers: [],
    beds,
    patients,
    alerts: [],
    breakGlass: null,
    seq: 200,             // above the pre-seeded P-1xx range so generated IDs never collide
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

  // PR#2 admission: create + sign-off in one step. Occupies the bed and puts a patient card on the
  // board. Accepts optional production fields (age, source, risk, vitals…) — all default safely so
  // the minimal test-driven signature keeps working.
  function admitPatient({ displayName, sex, bedId, diagnosisText, age, isNeonate, ageDays,
                          source, risk, vitals } = {}) {
    const bed = state.beds.find((b) => b.id === bedId);
    if (!bed) throw new Error("Yatak bulunamadı.");
    if (bed.state !== "AVAILABLE") throw new Error("Seçilen yatak müsait değil.");
    const pid = `P-${String(state.seq).padStart(3, "0")}`;
    const patient = {
      patient_id: pid,
      display_name: displayName,
      sex,
      age: age ?? null,
      isNeonate: !!isNeonate,
      ageDays: ageDays ?? null,
      tcMasked: isNeonate ? "—" : maskTc(),
      mrn: `MRN-${100000 + state.seq}`,
      protocolNo: `2025/${String(4000 + state.seq).padStart(7, "0")}`,
      bedId,
      bedLabel: bed.label,
      unitId: bed.unitId || null,
      admittedAtMs: Date.now(),
      admittedAtSec: state.clockSec,
      diagnosis: diagnosisText,
      admittedBy: state.user?.full_name || "—",
      risk: risk || "stable",
      source: source || "external",
      vitals: vitals || { hr: null, map: null, spo2: null, temp: null, rr: null },
    };
    const beds = state.beds.map((b) => (b.id === bedId ? { ...b, state: "OCCUPIED", patientId: pid } : b));
    set({ beds, patients: [...state.patients, patient], seq: state.seq + 1 });
    return patient;
  }

  // Transfer a patient to another available bed (frees the old bed, occupies the new one).
  function transferPatient({ patientId, targetBedId }) {
    const patient = state.patients.find((p) => p.patient_id === patientId);
    if (!patient) throw new Error("Hasta bulunamadı.");
    const target = state.beds.find((b) => b.id === targetBedId);
    if (!target) throw new Error("Hedef yatak bulunamadı.");
    if (target.state !== "AVAILABLE") throw new Error("Seçilen yatak müsait değil.");
    const beds = state.beds.map((b) => {
      if (b.id === patient.bedId) return { ...b, state: "AVAILABLE", patientId: null };
      if (b.id === targetBedId) return { ...b, state: "OCCUPIED", patientId: patientId };
      return b;
    });
    const patients = state.patients.map((p) => (p.patient_id === patientId
      ? { ...p, bedId: targetBedId, bedLabel: target.label, unitId: target.unitId || p.unitId } : p));
    set({ beds, patients });
    return patients.find((p) => p.patient_id === patientId);
  }

  // Care-team assignment (S-04): attach an attending physician and/or a nurse to a patient.
  function assignCareTeam({ patientId, attendingId, nurseId }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    const prev = state.careTeam[patientId] || {};
    const careTeam = { ...state.careTeam,
      [patientId]: { attendingId: attendingId ?? prev.attendingId ?? null,
                     nurseId: nurseId ?? prev.nurseId ?? null } };
    set({ careTeam });
    return careTeam[patientId];
  }

  // Shift handover with a mandatory signed note (S-14).
  function createHandover({ patientId, fromName, toName, note }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    if (!note || note.trim().length < ACK_REASON_MIN_CHARS) {
      throw new Error(`Devir-teslim notu en az ${ACK_REASON_MIN_CHARS} karakter olmalıdır.`);
    }
    const handover = { id: `H-${state.seq}`, patientId,
      fromName: fromName || state.user?.full_name || "—", toName: toName || "—",
      note: note.trim(), signedAtMs: Date.now() };
    set({ handovers: [...state.handovers, handover], seq: state.seq + 1 });
    return handover;
  }

  // --------------------------------------------------------------- admin: users & structure (S-01/02)
  function createUser({ full_name, email, role }) {
    if (!full_name || !full_name.trim()) throw new Error("Ad Soyad zorunludur.");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Geçerli bir e-posta gerekir.");
    if (!role) throw new Error("Rol seçimi zorunludur.");
    if (state.users.some((u) => u.email === email)) throw new Error("Bu e-posta zaten kayıtlı.");
    const user = { id: `u-${String(state.seq).padStart(2, "0")}`, full_name: full_name.trim(),
      email: email.trim(), role, active: true, mfa: false };
    set({ users: [...state.users, user], seq: state.seq + 1 });
    return user;
  }

  function addUnit({ name, type }) {
    if (!name || !name.trim()) throw new Error("Ünite adı zorunludur.");
    const id = `unit-${state.seq}`;
    const unit = { id, name: name.trim(), type: type || "ADULT_ICU",
      maxBedsPerNurse: type === "NICU" ? 3 : 2, rooms: [] };
    set({ structure: { ...state.structure, units: [...state.structure.units, unit] }, seq: state.seq + 1 });
    return unit;
  }

  function addRoom({ unitId, label }) {
    if (!label || !label.trim()) throw new Error("Oda adı zorunludur.");
    const id = `room-${state.seq}`;
    const units = state.structure.units.map((u) => (u.id === unitId
      ? { ...u, rooms: [...(u.rooms || []), { id, label: label.trim() }] } : u));
    set({ structure: { ...state.structure, units }, seq: state.seq + 1 });
    return { id, label: label.trim(), unitId };
  }

  function addBed({ unitId, roomId, label }) {
    if (!label || !label.trim()) throw new Error("Yatak etiketi zorunludur.");
    const unit = state.structure.units.find((u) => u.id === unitId);
    if (!unit) throw new Error("Ünite bulunamadı.");
    const room = (unit.rooms || []).find((r) => r.id === roomId);
    const bed = { id: `bed-${state.seq}`, label: label.trim(), unitId, unitName: unit.name,
      roomId: roomId || null, roomLabel: room?.label || null, state: "AVAILABLE", patientId: null };
    set({ beds: [...state.beds, bed], seq: state.seq + 1 });
    return bed;
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
    admitPatient, transferPatient, assignCareTeam, createHandover,
    createUser, addUnit, addRoom, addBed,
    fireAlert, reconcile,
    acknowledgeAlert, snoozeAlert, escalateToRRT, rrtHasAccess,
    activateBreakGlass, extendBreakGlass, breakGlassActive,
    setSpeed, setRunning, reset,
  };
}
