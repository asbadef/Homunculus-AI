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
// Each account also carries a 4-digit quick-PIN used on shared tablet/nurse-station screens for
// the 3-second Fast Switcher (see switchUserByPin). PINs are synthetic and non-secret.
export const DEMO_PASSWORD = "Homunculus2025";
export const DEMO_ACCOUNTS = [
  { email: "dr.elif.yilmaz@homunculus.health", password: DEMO_PASSWORD, pin: "1111", full_name: "Dr. Elif Yılmaz", role: ROLE.ATTENDING },
  { email: "ayse.demir@homunculus.health",     password: DEMO_PASSWORD, pin: "2222", full_name: "Ayşe Demir",      role: ROLE.CHARGE_NURSE },
  { email: "admin@homunculus.health",          password: DEMO_PASSWORD, pin: "9999", full_name: "Mehmet Kaya",     role: ROLE.HOSPITAL_ADMIN },
  { email: "dr.can.ozturk@homunculus.health",  password: DEMO_PASSWORD, pin: "3333", full_name: "Dr. Can Öztürk",  role: ROLE.ATTENDING },
  { email: "selin.arslan@homunculus.health",   password: DEMO_PASSWORD, pin: "4444", full_name: "Selin Arslan",    role: ROLE.CHARGE_NURSE },
];

// --------------------------------------------------------------------------- alert tiers
export const TIER = { CRITICAL: "CRITICAL", HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", INFO: "INFO" };

// Severity → shared UI severity scale (theme.js: info|low|moderate|high|critical).
export const TIER_TO_SEV = {
  CRITICAL: "critical", HIGH: "high", MEDIUM: "moderate", LOW: "low", INFO: "info",
};

// --------------------------------------------------------------------------- bed operational states (PR#8 §4)
// A bed is more than Available/Occupied. Admins can flag it out of the clinical pool for housekeeping,
// technical faults or decommissioning. OCCUPIED is patient-driven (set by admit/transfer, never manually).
export const BED_STATES = {
  AVAILABLE: "AVAILABLE",           // Müsait
  OCCUPIED: "OCCUPIED",             // Dolu (hasta atanmış)
  HOUSEKEEPING: "HOUSEKEEPING",     // Dezenfeksiyonda
  FAULTY: "FAULTY",                 // Teknik Arızalı
  OUT_OF_SERVICE: "OUT_OF_SERVICE", // Kullanım Dışı
};
// States an admin may set manually (OCCUPIED is excluded — only admission occupies a bed).
export const BED_ADMIN_STATES = [
  BED_STATES.AVAILABLE, BED_STATES.HOUSEKEEPING, BED_STATES.FAULTY, BED_STATES.OUT_OF_SERVICE,
];
// Turkish fallback labels for audit-trail detail lines (UI uses i18n).
export const BED_STATE_LABEL = {
  AVAILABLE: "Müsait", OCCUPIED: "Dolu", HOUSEKEEPING: "Dezenfeksiyonda",
  FAULTY: "Teknik Arızalı", OUT_OF_SERVICE: "Kullanım Dışı",
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

// --------------------------------------------------------------------------- ICD-10 catalog
// A small curated set of common ICU diagnoses. ICD-10 codes are an international standard and are
// NEVER translated — only the human-readable description is localised at render time if needed.
export const ICD10_CATALOG = [
  { code: "J96.0", tr: "Akut solunum yetmezliği", en: "Acute respiratory failure" },
  { code: "J18.9", tr: "Pnömoni, tanımlanmamış", en: "Pneumonia, unspecified" },
  { code: "A41.9", tr: "Sepsis, tanımlanmamış", en: "Sepsis, unspecified" },
  { code: "R65.21", tr: "Septik şok", en: "Septic shock" },
  { code: "N17.9", tr: "Akut böbrek yetmezliği", en: "Acute kidney failure" },
  { code: "I21.4", tr: "Akut subendokardiyal miyokart enfarktüsü", en: "Acute NSTEMI" },
  { code: "I50.9", tr: "Kalp yetmezliği, tanımlanmamış", en: "Heart failure, unspecified" },
  { code: "J44.1", tr: "KOAH akut alevlenme", en: "COPD with acute exacerbation" },
  { code: "K92.2", tr: "Gastrointestinal kanama", en: "Gastrointestinal hemorrhage" },
  { code: "I63.9", tr: "Serebral enfarktüs (inme)", en: "Cerebral infarction (stroke)" },
  { code: "S06.9", tr: "Kafa içi yaralanma", en: "Intracranial injury" },
  { code: "E87.6", tr: "Hipokalemi", en: "Hypokalemia" },
  { code: "P22.0", tr: "Yenidoğan respiratuar distres sendromu", en: "Neonatal RDS" },
  { code: "P59.9", tr: "Yenidoğan sarılığı", en: "Neonatal jaundice" },
  { code: "P07.3", tr: "Prematürite", en: "Preterm newborn" },
  { code: "T81.4", tr: "Cerrahi alan enfeksiyonu", en: "Post-procedural infection" },
];
export function searchIcd10(q) {
  const s = (q || "").trim().toLowerCase();
  if (!s) return ICD10_CATALOG.slice(0, 8);
  return ICD10_CATALOG.filter((x) =>
    x.code.toLowerCase().includes(s) || x.tr.toLowerCase().includes(s) || x.en.toLowerCase().includes(s)
  ).slice(0, 8);
}

// --------------------------------------------------------------------------- medication catalog
// Common ICU infusions/drugs. Active-ingredient names follow international INN and are not translated.
export const MED_CATALOG = [
  { name: "Noradrenalin", unit: "mcg/kg/dk", kind: "infusion" },
  { name: "Adrenalin", unit: "mcg/kg/dk", kind: "infusion" },
  { name: "Dopamin", unit: "mcg/kg/dk", kind: "infusion" },
  { name: "Dobutamin", unit: "mcg/kg/dk", kind: "infusion" },
  { name: "Propofol", unit: "mg/kg/sa", kind: "infusion" },
  { name: "Midazolam", unit: "mg/sa", kind: "infusion" },
  { name: "Fentanil", unit: "mcg/sa", kind: "infusion" },
  { name: "Insülin", unit: "IU/sa", kind: "infusion" },
  { name: "Meropenem", unit: "mg", kind: "bolus" },
  { name: "Piperasilin-Tazobaktam", unit: "mg", kind: "bolus" },
  { name: "Furosemid", unit: "mg", kind: "bolus" },
  { name: "Pantoprazol", unit: "mg", kind: "bolus" },
];

// --------------------------------------------------------------------------- ICU procedures
export const PROCEDURE_CATALOG = [
  "Endotrakeal entübasyon", "Mekanik ventilasyon", "Santral venöz kateter",
  "Arteriyel kateter", "Hemodiyaliz / CRRT", "Bronkoskopi", "Torasentez",
  "Nazogastrik sonda", "İdrar sondası", "Trakeostomi",
];

// --------------------------------------------------------------------------- NEWS2 (synthetic)
// A simplified NEWS2-style aggregate score for demo auto-alarm triggering. Uses RR, SpO2, Temp, HR
// and MAP (as a proxy for systolic BP). This is illustrative, not a validated clinical calculator.
export function computeNews2(v) {
  if (!v) return 0;
  let s = 0;
  const rr = v.rr, spo2 = v.spo2, t = v.temp, hr = v.hr, map = v.map;
  if (rr != null) { if (rr <= 8) s += 3; else if (rr <= 11) s += 1; else if (rr <= 20) s += 0; else if (rr <= 24) s += 2; else s += 3; }
  if (spo2 != null) { if (spo2 <= 91) s += 3; else if (spo2 <= 93) s += 2; else if (spo2 <= 95) s += 1; }
  if (t != null) { if (t <= 35) s += 3; else if (t <= 36) s += 1; else if (t <= 38) s += 0; else if (t <= 39) s += 1; else s += 2; }
  if (hr != null) { if (hr <= 40) s += 3; else if (hr <= 50) s += 1; else if (hr <= 90) s += 0; else if (hr <= 110) s += 1; else if (hr <= 130) s += 2; else s += 3; }
  if (map != null) { if (map <= 55) s += 3; else if (map <= 65) s += 2; else if (map <= 75) s += 1; }
  return s;
}
export const NEWS2_ALARM_THRESHOLD = 7;

// Default per-patient alarm thresholds (physician-adjustable in the settings modal).
export const DEFAULT_THRESHOLDS = { spo2Min: 90, hrMin: 45, hrMax: 130, mapMin: 60, mapMax: 110 };
// Returns the list of breached limits for a set of vitals given thresholds (empty = within limits).
export function evaluateThresholds(v, th) {
  const t = { ...DEFAULT_THRESHOLDS, ...(th || {}) };
  const breaches = [];
  if (v?.spo2 != null && v.spo2 < t.spo2Min) breaches.push("SpO2");
  if (v?.hr != null && (v.hr < t.hrMin || v.hr > t.hrMax)) breaches.push("HR");
  if (v?.map != null && (v.map < t.mapMin || v.map > t.mapMax)) breaches.push("MAP");
  return breaches;
}

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
    staffAssignments: {}, // userId → { bedIds:[], unitIds:[] }  (staff→bed matrix)
    devices: [],          // { id, vendor, model, ip, bedId, connected, lastPacketMs, packets }
    handovers: [],        // { id, patientId, fromName, toName, note, signedAtMs }
    beds,
    patients: [],         // admitted patients (each on a bed)
    alerts: [],           // active/closed alerts
    breakGlass: null,     // { by, reason, activatedAt, expiresAt, reviewStatus, reviewedBy }
    clinical: {},         // patientId → { diagnoses, medications, procedures, fluids, thresholds, vitalHistory }
    auditLog: [],         // { id, atMs, actor, action, target, detail }
    maskNames: false,     // KVKK name-masking toggle (global)
    autoAlarm: true,      // automatic alarm engine on/off
    online: true,         // PWA connectivity flag (offline resilience)
    syncQueue: [],        // actions captured while offline
    seq: 1,
  };
}

// Blank clinical record scaffold for a patient (diagnoses / meds / procedures / fluids / thresholds).
function emptyClinical() {
  return { diagnoses: [], medications: [], procedures: [], fluids: [],
           thresholds: { ...DEFAULT_THRESHOLDS }, vitalHistory: [] };
}

// Mask a display name → first letter + asterisks per word ("Ahmet Yılmaz" → "A*** Y***").
export function maskName(name) {
  if (!name) return name;
  return String(name).split(/\s+/).map((w) => (w ? w[0] + "***" : w)).join(" ");
}

// --------------------------------------------------------------------------- realistic seed
// A production-fidelity synthetic environment used by the live workspace UI. All identities are
// FAKE and every national ID is masked; nothing here is real patient data.
export function buildRealisticState() {
  const now = Date.now();
  const hrs = (h) => now - h * 3600 * 1000;

  const users = [
    { id: "u-01", full_name: "Dr. Elif Yılmaz", email: "dr.elif.yilmaz@homunculus.health", role: ROLE.ATTENDING,    active: true, mfa: true,  mfaRequired: true,  pin: "1111", unitIds: ["unit-adult"] },
    { id: "u-02", full_name: "Ayşe Demir",      email: "ayse.demir@homunculus.health",     role: ROLE.CHARGE_NURSE,  active: true, mfa: true,  mfaRequired: false, pin: "2222", unitIds: ["unit-adult"] },
    { id: "u-03", full_name: "Mehmet Kaya",     email: "admin@homunculus.health",          role: ROLE.HOSPITAL_ADMIN, active: true, mfa: true, mfaRequired: true,  pin: "9999", unitIds: ["unit-adult", "unit-nicu"] },
    { id: "u-04", full_name: "Dr. Can Öztürk",  email: "dr.can.ozturk@homunculus.health",  role: ROLE.ATTENDING,    active: true, mfa: false, mfaRequired: true,  pin: "3333", unitIds: ["unit-nicu"] },
    { id: "u-05", full_name: "Selin Arslan",    email: "selin.arslan@homunculus.health",   role: ROLE.CHARGE_NURSE, active: true, mfa: true,  mfaRequired: false, pin: "4444", unitIds: ["unit-adult", "unit-nicu"] },
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
    "P-102": { attendingId: "u-04", nurseId: "u-02" },
    "P-103": { attendingId: "u-01", nurseId: "u-05" },
    "P-104": { attendingId: "u-01", nurseId: "u-02" },
    "P-105": { attendingId: "u-04", nurseId: "u-05" },
    "P-106": { attendingId: "u-04", nurseId: "u-05" },
  };

  // Personel → yatak-grubu atama matrisi (C1/C3/B3). Bir hemşire birden çok yatağı üstlenir; nöbetçi
  // hekim tüm üniteyi kapsayabilir. bedIds = doğrudan yatak; unitIds = tüm ünite ("nöbetçi hekim").
  const staffAssignments = {
    "u-01": { bedIds: [], unitIds: ["unit-adult"] },                 // Nöbetçi hekim · tüm Erişkin YBÜ
    "u-02": { bedIds: ["bed-a101", "bed-a102", "bed-a104"], unitIds: [] }, // Ayşe → 101,102,104
    "u-04": { bedIds: [], unitIds: ["unit-nicu"] },                  // Nöbetçi hekim · tüm Yenidoğan YBÜ
    "u-05": { bedIds: ["bed-a105", "bed-n201", "bed-n202"], unitIds: [] }, // Selin → 105,201,202
  };

  // Mindray/GE hasta-başı monitör simülatörü (B4). Her cihaz bir yatağa atanır ve arka planda canlı
  // HL7/IEEE 11073 paketleri üretiyormuş gibi vital verisi besler (reconcile içinde jitter uygulanır).
  const devices = [
    { id: "dev-01", vendor: "Mindray", model: "BeneVision N17", ip: "192.168.1.50", port: 6002, protocol: "HL7 / IEEE 11073", serial: "MR-N17-000421", bedId: "bed-a101", connected: true, lastPacketMs: now, packets: 18432 },
    { id: "dev-02", vendor: "Mindray", model: "BeneVision N12", ip: "192.168.1.51", port: 6002, protocol: "HL7 / IEEE 11073", serial: "MR-N12-001188", bedId: "bed-a104", connected: true, lastPacketMs: now, packets: 9210 },
    { id: "dev-03", vendor: "GE",      model: "CARESCAPE B650", ip: "192.168.1.60", port: 3001, protocol: "HL7 / IEEE 11073", serial: "GE-B650-774510", bedId: "bed-a105", connected: true, lastPacketMs: now, packets: 4120 },
    { id: "dev-04", vendor: "GE",      model: "CARESCAPE B450", ip: "192.168.1.61", port: 3001, protocol: "HL7 / IEEE 11073", serial: "GE-B450-338097", bedId: "bed-n201", connected: true, lastPacketMs: now, packets: 22890 },
    { id: "dev-05", vendor: "Mindray", model: "BeneVision N1",  ip: "192.168.1.52", port: 6002, protocol: "HL7 / IEEE 11073", serial: "MR-N1-050933",  bedId: null,       connected: false, lastPacketMs: null, packets: 0 },
  ];

  // Build a plausible recent vital-trend history (last N samples) around each patient's current vitals.
  const trend = (base, n = 12) => {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const j = (Math.random() - 0.5);
      out.push({
        tMs: now - i * 30 * 60 * 1000,
        hr: Math.round(base.hr + j * 8),
        map: Math.round(base.map + j * 6),
        spo2: Math.min(100, Math.round(base.spo2 + j * 3)),
        temp: Math.round((base.temp + j * 0.4) * 10) / 10,
        rr: Math.round(base.rr + j * 3),
      });
    }
    return out;
  };

  const clinical = {
    "P-101": { ...emptyClinical(),
      diagnoses: [{ id: "d1", code: "J18.9", text: "Pnömoni, tanımlanmamış", atMs: hrs(52), by: "Dr. Elif Yılmaz" },
                  { id: "d2", code: "J96.0", text: "Akut solunum yetmezliği", atMs: hrs(50), by: "Dr. Elif Yılmaz" }],
      medications: [{ id: "m1", name: "Noradrenalin", dose: "0.08", unit: "mcg/kg/dk", startMs: hrs(48), endMs: null, by: "Dr. Elif Yılmaz" },
                    { id: "m2", name: "Meropenem", dose: "1000", unit: "mg", startMs: hrs(46), endMs: null, by: "Dr. Elif Yılmaz" }],
      procedures: [{ id: "pr1", name: "Endotrakeal entübasyon", atMs: hrs(48), by: "Dr. Elif Yılmaz" },
                   { id: "pr2", name: "Mekanik ventilasyon", atMs: hrs(48), by: "Dr. Elif Yılmaz" },
                   { id: "pr3", name: "Santral venöz kateter", atMs: hrs(47), by: "Dr. Can Öztürk" }],
      fluids: [{ id: "f1", kind: "in", label: "IV sıvı", ml: 1200, atMs: hrs(12) },
               { id: "f2", kind: "in", label: "Enteral beslenme", ml: 600, atMs: hrs(10) },
               { id: "f3", kind: "out", label: "İdrar", ml: 900, atMs: hrs(11) },
               { id: "f4", kind: "out", label: "Drenaj", ml: 150, atMs: hrs(8) }],
      thresholds: { spo2Min: 92, hrMin: 50, hrMax: 120, mapMin: 65, mapMax: 105 },
      vitalHistory: trend(patients[0].vitals) },
    "P-104": { ...emptyClinical(),
      diagnoses: [{ id: "d1", code: "A41.9", text: "Sepsis, tanımlanmamış", atMs: hrs(6), by: "Dr. Elif Yılmaz" },
                  { id: "d2", code: "R65.21", text: "Septik şok", atMs: hrs(5), by: "Dr. Elif Yılmaz" }],
      medications: [{ id: "m1", name: "Noradrenalin", dose: "0.35", unit: "mcg/kg/dk", startMs: hrs(5), endMs: null, by: "Dr. Elif Yılmaz" },
                    { id: "m2", name: "Piperasilin-Tazobaktam", dose: "4500", unit: "mg", startMs: hrs(5), endMs: null, by: "Dr. Elif Yılmaz" }],
      procedures: [{ id: "pr1", name: "Arteriyel kateter", atMs: hrs(5), by: "Dr. Elif Yılmaz" }],
      fluids: [{ id: "f1", kind: "in", label: "Resüsitasyon sıvısı", ml: 2000, atMs: hrs(5) },
               { id: "f2", kind: "out", label: "İdrar", ml: 300, atMs: hrs(4) }],
      thresholds: { ...DEFAULT_THRESHOLDS },
      vitalHistory: trend(patients[3].vitals) },
    "P-105": { ...emptyClinical(),
      diagnoses: [{ id: "d1", code: "P07.3", text: "Prematürite", atMs: hrs(70), by: "Dr. Can Öztürk" },
                  { id: "d2", code: "P22.0", text: "Yenidoğan RDS", atMs: hrs(70), by: "Dr. Can Öztürk" }],
      medications: [{ id: "m1", name: "Fentanil", dose: "1.5", unit: "mcg/sa", startMs: hrs(68), endMs: null, by: "Dr. Can Öztürk" }],
      procedures: [{ id: "pr1", name: "Mekanik ventilasyon", atMs: hrs(70), by: "Dr. Can Öztürk" }],
      fluids: [{ id: "f1", kind: "in", label: "TPN", ml: 180, atMs: hrs(6) },
               { id: "f2", kind: "out", label: "İdrar", ml: 120, atMs: hrs(6) }],
      thresholds: { spo2Min: 88, hrMin: 100, hrMax: 180, mapMin: 35, mapMax: 60 },
      vitalHistory: trend(patients[4].vitals) },
  };
  for (const p of patients) if (!clinical[p.patient_id]) clinical[p.patient_id] = { ...emptyClinical(), vitalHistory: trend(p.vitals) };

  return {
    user: null,
    clockSec: 0,
    speed: 60,
    running: true,
    structure,
    users,
    careTeam,
    staffAssignments,
    devices,
    handovers: [],
    beds,
    patients,
    alerts: [],
    breakGlass: null,
    clinical,
    auditLog: [{ id: "AL-1", atMs: hrs(52), actor: "Dr. Elif Yılmaz", action: "PATIENT_ADMIT", target: "P-101", detail: "Erişkin YBÜ · Yatak 101" }],
    maskNames: false,
    autoAlarm: true,
    online: true,         // PWA connectivity flag (offline resilience B5)
    syncQueue: [],        // actions captured while offline, flushed on reconnect
    seq: 200,             // above the pre-seeded P-1xx range so generated IDs never collide
  };
}

// --------------------------------------------------------------------------- executive analytics (PR#8 §3)
// Pure, side-effect-free derivation of operational KPIs from a store snapshot. Reused by the UI
// dashboard and by CSV/PDF export, and unit-tested directly.
export function computeAnalytics(state, nowMs = Date.now()) {
  const beds = state.beds || [];
  const patients = state.patients || [];
  const units = state.structure?.units || [];
  const alerts = state.alerts || [];
  const devices = state.devices || [];
  const audit = state.auditLog || [];

  // ---- Unit occupancy: occupied / (total usable) per unit.
  const occupancyByUnit = units.map((u) => {
    const unitBeds = beds.filter((b) => b.unitId === u.id);
    const occupied = unitBeds.filter((b) => b.state === "OCCUPIED").length;
    const outOfPool = unitBeds.filter((b) => b.state === "FAULTY" || b.state === "OUT_OF_SERVICE" || b.state === "HOUSEKEEPING").length;
    const total = unitBeds.length;
    const usable = total - outOfPool;
    return { unitId: u.id, unitName: u.name, total, occupied, outOfPool,
      available: unitBeds.filter((b) => b.state === "AVAILABLE").length,
      occupancyPct: usable > 0 ? Math.round((occupied / usable) * 100) : 0 };
  });
  const totalBeds = beds.length;
  const totalOccupied = beds.filter((b) => b.state === "OCCUPIED").length;
  const overallOccupancyPct = totalBeds > 0 ? Math.round((totalOccupied / totalBeds) * 100) : 0;

  // ---- Average length of stay (admitted patients, hours).
  const losHours = patients
    .filter((p) => p.admittedAtMs)
    .map((p) => (nowMs - p.admittedAtMs) / 3600000);
  const avgLosHours = losHours.length ? Math.round((losHours.reduce((a, b) => a + b, 0) / losHours.length) * 10) / 10 : 0;

  // ---- Admissions / discharges in the last 24h (from the append-only audit trail).
  const dayAgo = nowMs - 24 * 3600 * 1000;
  const admitsToday = audit.filter((e) => e.action === "PATIENT_ADMIT" && (e.atMs || 0) >= dayAgo).length;
  const dischargesToday = audit.filter((e) => /DISCHARGE/.test(e.action || "") && (e.atMs || 0) >= dayAgo).length;

  // ---- Alarm quality: average time-to-acknowledge (sec) and escalation cascade counts.
  const acked = alerts.filter((a) => a.ack && a.ack.atSec != null && a.firedAtSec != null);
  const ttaSamples = acked.map((a) => a.ack.atSec - a.firedAtSec).filter((s) => s >= 0);
  const avgTimeToAckSec = ttaSamples.length ? Math.round(ttaSamples.reduce((a, b) => a + b, 0) / ttaSamples.length) : 0;
  // Count how many alarms reached each escalation tier (from emitted events).
  const escalationCounts = { tier1: 0, tier2: 0, tier3: 0 };
  for (const a of alerts) {
    for (const ev of a.events || []) {
      if (ev.step === "TIER_1_CHARGE_NURSE") escalationCounts.tier1 += 1;
      else if (ev.step === "TIER_2_PHYSICIAN") escalationCounts.tier2 += 1;
      else if (ev.step === "TIER_3_RRT") escalationCounts.tier3 += 1;
    }
  }
  const openAlerts = alerts.filter((a) => a.status === "FIRED" || a.status === "SNOOZED").length;
  const criticalOpen = alerts.filter((a) => a.tier === "CRITICAL" && (a.status === "FIRED" || a.status === "SNOOZED")).length;

  // ---- Device & data-flow health. A connected device is "stale" if it hasn't emitted a packet
  // in the last 30 s of wall-clock time (mimicking a lost HL7/IEEE 11073 feed).
  const STALE_MS = 30000;
  let online = 0, offline = 0, stale = 0;
  const deviceRows = devices.map((d) => {
    const isStale = d.connected && d.lastPacketMs != null && (nowMs - d.lastPacketMs) > STALE_MS;
    if (!d.connected) offline += 1;
    else if (isStale) stale += 1;
    else online += 1;
    const bed = beds.find((b) => b.id === d.bedId);
    return { id: d.id, vendor: d.vendor, model: d.model, ip: d.ip, port: d.port,
      bedId: d.bedId, bedLabel: bed?.label || d.bedId || "—", connected: !!d.connected, stale: isStale,
      status: !d.connected ? "offline" : (isStale ? "stale" : "online") };
  });

  return {
    occupancyByUnit, overallOccupancyPct, totalBeds, totalOccupied,
    avgLosHours, admitsToday, dischargesToday,
    avgTimeToAckSec, escalationCounts, openAlerts, criticalOpen, totalAlerts: alerts.length,
    deviceHealth: { online, offline, stale, total: devices.length }, deviceRows,
    generatedAtMs: nowMs,
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

  // Immutable append-only audit trail (S-15). Every security/clinical action lands here with actor,
  // timestamp and target. Never mutated or deleted in the UI.
  function audit(action, target, detail) {
    const entry = { id: `AL-${state.seq}`, atMs: Date.now(), atSec: state.clockSec,
      actor: state.user?.full_name || "—", role: state.user?.role || null,
      action, target: target || null, detail: detail || null };
    state = { ...state, auditLog: [...state.auditLog, entry], seq: state.seq + 1 };
    return entry;
  }
  // Ensure a clinical record exists for a patient (lazy-init for beds admitted via the minimal path).
  function ensureClinical(pid) {
    if (!state.clinical[pid]) state = { ...state, clinical: { ...state.clinical, [pid]: emptyClinical() } };
    return state.clinical[pid];
  }
  const patchClinical = (pid, patch) => {
    const cur = state.clinical[pid] || emptyClinical();
    set({ clinical: { ...state.clinical, [pid]: { ...cur, ...patch } } });
  };

  // Kurumsal e-posta + PIN girişi. Rol DB'den (users listesi) gelir; UI paneli role göre otomatik
  // yönlendirir (dışarıdan kayıt yok). E-posta + parola girişi de (eski akış) desteklenmeye devam eder.
  function login(email, credential) {
    const clean = String(credential || "");
    // Canlı kullanıcı kaydı (yönetici tarafından düzenlenebilir: parola/PIN/geçici PIN/pasiflik).
    const liveUser = (state.users || []).find((u) => u.email === email);
    // Yönetici bir kullanıcıyı pasife aldıysa giriş engellenir (hesap askıya alınmış).
    if (liveUser && liveUser.active === false) {
      throw new Error("Bu hesap pasif durumda; sistem yöneticinizle görüşün.");
    }
    const acct = DEMO_ACCOUNTS.find((a) => a.email === email
      && (a.password === clean || a.pin === clean));
    // Canlı kullanıcı kaydındaki (yönetici tarafından atanmış) parola / PIN / geçici PIN de kabul edilir.
    const liveMatch = liveUser && (liveUser.password === clean || liveUser.pin === clean
      || (liveUser.tempPin && liveUser.tempPin === clean));
    if (!acct && !liveMatch) throw new Error("Geçersiz e-posta veya PIN/parola.");
    const who = acct || liveUser;
    set({ user: { email: who.email, full_name: who.full_name, role: who.role } });
    audit("LOGIN", who.email, who.role);
    return who;
  }
  function loginAs(role) {
    const acct = DEMO_ACCOUNTS.find((a) => a.role === role);
    if (!acct) throw new Error("Rol bulunamadı.");
    return login(acct.email, acct.password);
  }
  function logout() { set({ user: null }); }

  // 3 saniyede Hızlı PIN ile nöbet/kullanıcı geçişi (ortak tablet/banko ekranları). 4 haneli PIN'e
  // karşılık gelen kullanıcıya anında geçiş yapar ve nöbet devrini denetim izine yazar (PIN_SWITCH).
  function switchUserByPin(pin) {
    const clean = String(pin || "").trim();
    if (!/^\d{4}$/.test(clean)) throw new Error("PIN 4 haneli olmalıdır.");
    // Önce canlı kullanıcı listesinden (DB), yoksa demo hesaplarından eşle.
    const u = (state.users || []).find((x) => x.pin === clean && x.active)
      || DEMO_ACCOUNTS.find((a) => a.pin === clean);
    if (!u) throw new Error("PIN eşleşmedi.");
    const prev = state.user?.full_name || null;
    set({ user: { email: u.email, full_name: u.full_name, role: u.role } });
    audit("PIN_SWITCH", u.email, prev ? `${prev} → ${u.full_name}` : u.full_name);
    return u;
  }

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
    set({ beds, patients: [...state.patients, patient], seq: state.seq + 1,
      clinical: { ...state.clinical, [pid]: emptyClinical() } });
    audit("PATIENT_ADMIT", pid, `${bed.unitName || ""} · Yatak ${bed.label}`);
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

  // Yanıtlanmamış (açık, onaylanmamış) CRITICAL alarmı olan hastaları döndürür. Vardiya devir-teslim
  // imzasını bloke eden kural (S5) bunu kullanır: kritik alarm açıkken devir imzalanamaz.
  function openCriticalAlerts(patientId) {
    return state.alerts.filter((a) => a.tier === TIER.CRITICAL
      && (patientId ? a.patientId === patientId : true)
      && (a.status === "FIRED" || a.status === "SNOOZED"));
  }

  // Shift handover with a mandatory signed note (S-14). Blocked if the patient (or, for a unit-wide
  // handover, any patient) has an unanswered CRITICAL alarm (S5).
  function createHandover({ patientId, fromName, toName, note }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    const blocking = openCriticalAlerts(patientId);
    if (blocking.length > 0) {
      const err = new Error("Yanıtlanmamış KRİTİK alarm varken vardiya devir-teslimi imzalanamaz.");
      err.code = "HANDOVER_BLOCKED_CRITICAL";
      err.alerts = blocking;
      audit("HANDOVER_BLOCKED", patientId, `${blocking.length} açık KRİTİK alarm`);
      throw err;
    }
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
      email: email.trim(), role, active: true, mfa: false, mfaRequired: true, unitIds: [] };
    set({ users: [...state.users, user], seq: state.seq + 1 });
    audit("USER_CREATE", user.id, `${user.full_name} · ${role}`);
    return user;
  }

  // --------------------------------------------------------------- admin: user & security management (PR#8 §2)
  const _findUser = (userId) => {
    const u = state.users.find((x) => x.id === userId);
    if (!u) throw new Error("Kullanıcı bulunamadı.");
    return u;
  };
  const _patchUser = (userId, patch) => {
    const users = state.users.map((u) => (u.id === userId ? { ...u, ...patch } : u));
    set({ users });
    return users.find((u) => u.id === userId);
  };
  // Parola sıfırlama: yönetici yeni bir parola belirler (canlı kullanıcı kaydına yazılır, login kabul eder).
  function setUserPassword({ userId, password }) {
    const u = _findUser(userId);
    if (!password || String(password).length < 6) throw new Error("Parola en az 6 karakter olmalıdır.");
    const next = _patchUser(userId, { password: String(password), tempPin: null });
    audit("USER_PASSWORD_RESET", userId, u.full_name);
    return next;
  }
  // Geçici 6 haneli PIN üret: ilk girişte kullanılmak üzere yöneticiye bir kez gösterilir.
  function resetUserPin({ userId } = {}) {
    const u = _findUser(userId);
    const tempPin = String(Math.floor(100000 + Math.random() * 900000)); // 6 hane
    _patchUser(userId, { tempPin });
    audit("USER_PIN_RESET", userId, `${u.full_name} · geçici PIN atandı`);
    return tempPin;
  }
  // Hesabı aktif/pasif yap. Pasif kullanıcı giriş yapamaz (login engeller).
  function toggleUserActive(userId) {
    const u = _findUser(userId);
    const next = _patchUser(userId, { active: !u.active });
    audit("USER_ACTIVE_TOGGLE", userId, `${u.full_name} · ${next.active ? "AKTİF" : "PASİF"}`);
    return next;
  }
  // MFA (çok adımlı doğrulama) kaydını sıfırla — kullanıcı bir sonraki girişte yeniden kaydolur.
  function resetUserMfa(userId) {
    const u = _findUser(userId);
    const next = _patchUser(userId, { mfa: false });
    audit("MFA_RESET", userId, `${u.full_name} · MFA sıfırlandı`);
    return next;
  }
  // MFA zorunluluğunu aç/kapat (kurumsal politika).
  function setUserMfaRequired({ userId, required }) {
    const u = _findUser(userId);
    const next = _patchUser(userId, { mfaRequired: !!required });
    audit("MFA_ENFORCE", userId, `${u.full_name} · MFA ${next.mfaRequired ? "zorunlu" : "isteğe bağlı"}`);
    return next;
  }
  // Kullanıcının erişebileceği üniteleri (YBÜ'ler) belirle — çoklu seçim.
  function setUserUnits({ userId, unitIds }) {
    const u = _findUser(userId);
    const ids = Array.isArray(unitIds) ? unitIds.filter((id) => state.structure.units.some((un) => un.id === id)) : [];
    const next = _patchUser(userId, { unitIds: ids });
    const names = ids.map((id) => state.structure.units.find((un) => un.id === id)?.name || id).join(", ");
    audit("USER_UNITS", userId, `${u.full_name} · ${ids.length ? names : "ünite yok"}`);
    return next;
  }

  // --------------------------------------------------------------- admin: bed operational state (PR#8 §4)
  // Bir yatağı klinik havuzun dışına al (dezenfeksiyon / arıza / kullanım dışı) veya tekrar müsait yap.
  // Dolu (hasta atanmış) yatak manuel olarak değiştirilemez; önce taburcu/nakil gerekir.
  function setBedState({ bedId, state: nextState, reason }) {
    const bed = state.beds.find((b) => b.id === bedId);
    if (!bed) throw new Error("Yatak bulunamadı.");
    if (!BED_ADMIN_STATES.includes(nextState)) throw new Error("Geçersiz yatak durumu.");
    if (bed.patientId || bed.state === BED_STATES.OCCUPIED) {
      throw new Error("Dolu yatağın durumu değiştirilemez; önce hasta taburcu/nakil edilmeli.");
    }
    const beds = state.beds.map((b) => (b.id === bedId ? { ...b, state: nextState } : b));
    set({ beds });
    const label = BED_STATE_LABEL[nextState] || nextState;
    audit("BED_STATE", bedId, `Yatak ${bed.label} · ${label}${reason ? " · " + reason : ""}`);
    return beds.find((b) => b.id === bedId);
  }

  // --------------------------------------------------------------- admin: edit device connection (PR#8 §4)
  // Cihazın ağ ayarlarını düzenle: IP, Port, Protokol (HL7 / IEEE 11073) ve seri numarası.
  function updateDevice({ deviceId, vendor, model, ip, port, protocol, serial }) {
    const dev = state.devices.find((d) => d.id === deviceId);
    if (!dev) throw new Error("Cihaz bulunamadı.");
    const patch = {};
    if (vendor != null) patch.vendor = String(vendor).trim() || dev.vendor;
    if (model != null) {
      if (!String(model).trim()) throw new Error("Cihaz modeli zorunludur.");
      patch.model = String(model).trim();
    }
    if (ip != null) {
      const ipv = String(ip).trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv)) throw new Error("Geçerli bir IP adresi girin (ör. 192.168.1.50).");
      if (state.devices.some((d) => d.id !== deviceId && d.ip === ipv)) throw new Error("Bu IP adresi başka bir cihazda kayıtlı.");
      patch.ip = ipv;
    }
    if (port != null && port !== "") {
      const p = Number(port);
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("Port 1-65535 aralığında olmalıdır.");
      patch.port = p;
    }
    if (protocol != null) patch.protocol = String(protocol).trim() || dev.protocol;
    if (serial != null) patch.serial = String(serial).trim();
    const devices = state.devices.map((d) => (d.id === deviceId ? { ...d, ...patch } : d));
    set({ devices });
    audit("DEVICE_UPDATE", deviceId, `${patch.model || dev.model} · ${patch.ip || dev.ip}:${patch.port || dev.port || "—"}`);
    return devices.find((d) => d.id === deviceId);
  }

  // --------------------------------------------------------------- notification test (PR#8 §1)
  // "Bildirim Sistemini Test Et": denetim izine bir test-bildirim kaydı düşer (UI ayrıca Web Push tetikler).
  function recordTestPush(detail) {
    audit("NOTIFY_TEST", null, detail || "Test bildirimi gönderildi");
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

  // --------------------------------------------------------------- staff → bed assignment matrix (C1/C3/B3)
  // Bir personele bir yatak grubu ve/veya tüm bir üniteyi atar. Görsel matris bu haritayı yazar.
  function assignStaffToBeds({ userId, bedIds, unitIds }) {
    const u = state.users.find((x) => x.id === userId);
    if (!u) throw new Error("Personel bulunamadı.");
    const next = { bedIds: Array.isArray(bedIds) ? bedIds : (state.staffAssignments[userId]?.bedIds || []),
                   unitIds: Array.isArray(unitIds) ? unitIds : (state.staffAssignments[userId]?.unitIds || []) };
    set({ staffAssignments: { ...state.staffAssignments, [userId]: next } });
    audit("STAFF_ASSIGN", userId, `${u.full_name} · ${next.bedIds.length} yatak${next.unitIds.length ? " · " + next.unitIds.length + " ünite" : ""}`);
    return next;
  }
  // Tek bir hücreyi (personel × yatak) aç/kapat — görsel matris tıklaması için.
  function toggleStaffBed({ userId, bedId }) {
    const u = state.users.find((x) => x.id === userId);
    if (!u) throw new Error("Personel bulunamadı.");
    const cur = state.staffAssignments[userId] || { bedIds: [], unitIds: [] };
    const has = cur.bedIds.includes(bedId);
    const bedIds = has ? cur.bedIds.filter((b) => b !== bedId) : [...cur.bedIds, bedId];
    return assignStaffToBeds({ userId, bedIds, unitIds: cur.unitIds });
  }

  // --------------------------------------------------------------- MDI device simulator (B4)
  // "Cihaz Ekle & Yatağa Ata": arka planda gerçek hasta-başı monitörü ağa bağlıymış gibi canlı
  // HL7/IEEE 11073 paketleri üreten bir simülatör kaydı oluşturur.
  function addDevice({ vendor, model, ip, port, protocol, serial, bedId } = {}) {
    if (!model || !model.trim()) throw new Error("Cihaz modeli zorunludur.");
    if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())) throw new Error("Geçerli bir IP adresi girin (ör. 192.168.1.50).");
    if (state.devices.some((d) => d.ip === ip.trim())) throw new Error("Bu IP adresi zaten kayıtlı.");
    let portNum = 6002;
    if (port != null && String(port).trim() !== "") {
      portNum = parseInt(port, 10);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) throw new Error("Port 1-65535 aralığında olmalıdır.");
    }
    const dev = { id: `dev-${state.seq}`, vendor: vendor || "Mindray", model: model.trim(),
      ip: ip.trim(), port: portNum, protocol: protocol || "HL7 / IEEE 11073",
      serial: (serial || "").trim(),
      bedId: bedId || null, connected: !!bedId, lastPacketMs: bedId ? Date.now() : null, packets: 0 };
    set({ devices: [...state.devices, dev], seq: state.seq + 1 });
    audit("DEVICE_ADD", dev.id, `${dev.vendor} ${dev.model} · ${dev.ip}:${dev.port}`);
    return dev;
  }
  function assignDeviceToBed({ deviceId, bedId }) {
    const dev = state.devices.find((d) => d.id === deviceId);
    if (!dev) throw new Error("Cihaz bulunamadı.");
    // Aynı yatağa bağlı başka cihaz varsa onu boşa çıkar (tek monitör/yatak).
    const devices = state.devices.map((d) => {
      if (d.id === deviceId) return { ...d, bedId: bedId || null, connected: !!bedId, lastPacketMs: bedId ? Date.now() : null };
      if (bedId && d.bedId === bedId) return { ...d, bedId: null, connected: false, lastPacketMs: null };
      return d;
    });
    set({ devices });
    const bed = state.beds.find((b) => b.id === bedId);
    audit("DEVICE_ASSIGN", deviceId, bedId ? `${dev.model} → Yatak ${bed?.label || bedId}` : `${dev.model} → (bağlantı kesildi)`);
    return devices.find((d) => d.id === deviceId);
  }
  const deviceForBed = (bedId) => state.devices.find((d) => d.bedId === bedId && d.connected) || null;

  // --------------------------------------------------------------- break-glass review (C2/B2)
  // Yönetici inceleme akışı: aktif/geçmiş break-glass oturumunu onaylar veya reddeder.
  function reviewBreakGlass({ approve, note } = {}) {
    if (!state.breakGlass) throw new Error("İncelenecek break-glass oturumu yok.");
    const reviewStatus = approve ? "approved" : "rejected";
    const breakGlass = { ...state.breakGlass, reviewStatus, reviewNote: note || null,
      reviewedBy: state.user?.full_name || "—", reviewedAtSec: state.clockSec };
    set({ breakGlass });
    audit("BREAK_GLASS_REVIEW", null, `${approve ? "ONAY" : "RED"}${note ? " · " + note : ""}`);
    return breakGlass;
  }

  // --------------------------------------------------------------- offline resilience & sync (B5)
  // Bağlantı durumunu değiştirir. Çevrimdışıyken yazma işlemleri syncQueue'ya alınır; çevrimiçi
  // olununca flushSyncQueue ile "sunucuya" eşitlenmiş sayılır (denetim izine yazılır).
  function setOnline(online) {
    const wasOffline = state.online === false;
    set({ online: !!online });
    audit(online ? "NET_ONLINE" : "NET_OFFLINE", null, online ? "Bağlantı geri geldi" : "Bağlantı kesildi (yerel önbellek)");
    if (online && wasOffline) return flushSyncQueue();
    return null;
  }
  // Çevrimdışıyken bir işlemi yerel kuyruğa (IndexedDB benzeri) yaz.
  function queueOffline(kind, payload) {
    const entry = { id: `SQ-${state.seq}`, kind, payload: payload || null, atSec: state.clockSec, atMs: Date.now() };
    set({ syncQueue: [...state.syncQueue, entry], seq: state.seq + 1 });
    audit("SYNC_QUEUED", null, `${kind} · sırada ${state.syncQueue.length + 1}`);
    return entry;
  }
  // Bağlantı gelince kuyruğu "sunucuya" gönder (demo: kuyruğu temizle + denetim izine yaz).
  function flushSyncQueue() {
    const n = state.syncQueue.length;
    if (n === 0) return { flushed: 0 };
    set({ syncQueue: [] });
    audit("SYNC_FLUSH", null, `${n} işlem sunucuya eşitlendi`);
    return { flushed: n };
  }

  // --------------------------------------------------------------- clinical data entry (physician)
  // ICD-10 diagnosis. Codes are the international standard and stored verbatim.
  function addDiagnosis({ patientId, code, text }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    if (!code) throw new Error("ICD-10 kodu zorunludur.");
    ensureClinical(patientId);
    const rec = state.clinical[patientId] || emptyClinical();
    const entry = { id: `d-${state.seq}`, code, text: text || code, atMs: Date.now(),
      by: state.user?.full_name || "—" };
    patchClinical(patientId, { diagnoses: [...rec.diagnoses, entry] });
    set({ seq: state.seq + 1 });
    audit("DIAGNOSIS_ADD", patientId, `${code} · ${text || ""}`.trim());
    return entry;
  }
  // Drug / infusion. Active-ingredient name + dose + unit + start/end timestamps.
  function addMedication({ patientId, name, dose, unit, startMs, endMs }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    if (!name) throw new Error("Etken madde zorunludur.");
    if (dose == null || dose === "") throw new Error("Dozaj zorunludur.");
    ensureClinical(patientId);
    const rec = state.clinical[patientId] || emptyClinical();
    const entry = { id: `m-${state.seq}`, name, dose: String(dose), unit: unit || "",
      startMs: startMs || Date.now(), endMs: endMs || null, by: state.user?.full_name || "—" };
    patchClinical(patientId, { medications: [...rec.medications, entry] });
    set({ seq: state.seq + 1 });
    audit("MEDICATION_ADD", patientId, `${name} ${dose}${unit ? " " + unit : ""}`);
    return entry;
  }
  function stopMedication({ patientId, medId }) {
    const rec = state.clinical[patientId]; if (!rec) throw new Error("Kayıt bulunamadı.");
    const medications = rec.medications.map((m) => (m.id === medId ? { ...m, endMs: Date.now() } : m));
    patchClinical(patientId, { medications });
    audit("MEDICATION_STOP", patientId, medId);
  }
  // Timestamped ICU procedure.
  function addProcedure({ patientId, name }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    if (!name) throw new Error("Prosedür zorunludur.");
    ensureClinical(patientId);
    const rec = state.clinical[patientId] || emptyClinical();
    const entry = { id: `pr-${state.seq}`, name, atMs: Date.now(), by: state.user?.full_name || "—" };
    patchClinical(patientId, { procedures: [...rec.procedures, entry] });
    set({ seq: state.seq + 1 });
    audit("PROCEDURE_ADD", patientId, name);
    return entry;
  }
  // Intake/Output fluid entry (kind: "in" | "out").
  function addFluid({ patientId, kind, label, ml }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    if (kind !== "in" && kind !== "out") throw new Error("Sıvı tipi 'in' veya 'out' olmalı.");
    const n = Number(ml);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Miktar (mL) pozitif olmalı.");
    ensureClinical(patientId);
    const rec = state.clinical[patientId] || emptyClinical();
    const entry = { id: `f-${state.seq}`, kind, label: label || (kind === "in" ? "Giren" : "Çıkan"),
      ml: n, atMs: Date.now() };
    patchClinical(patientId, { fluids: [...rec.fluids, entry] });
    set({ seq: state.seq + 1 });
    audit("FLUID_ADD", patientId, `${kind === "in" ? "Giren" : "Çıkan"} ${n} mL`);
    return entry;
  }
  // Physician per-patient alarm thresholds (S-05 personalisation).
  function setThresholds({ patientId, thresholds }) {
    if (!state.patients.some((p) => p.patient_id === patientId)) throw new Error("Hasta bulunamadı.");
    ensureClinical(patientId);
    const rec = state.clinical[patientId] || emptyClinical();
    const merged = { ...DEFAULT_THRESHOLDS, ...rec.thresholds, ...thresholds };
    patchClinical(patientId, { thresholds: merged });
    audit("THRESHOLDS_SET", patientId,
      `SpO2≥${merged.spo2Min} HR ${merged.hrMin}-${merged.hrMax} MAP ${merged.mapMin}-${merged.mapMax}`);
    return merged;
  }
  // KVKK name-masking toggle (global). When on, the UI renders "A*** Y***" everywhere.
  function toggleMaskNames(on) {
    const v = on == null ? !state.maskNames : !!on;
    set({ maskNames: v });
    audit("MASK_NAMES", null, v ? "on" : "off");
    return v;
  }
  function setAutoAlarm(on) { set({ autoAlarm: !!on }); audit("AUTO_ALARM", null, on ? "on" : "off"); }

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
    let working = state.alerts;
    let seq = state.seq;
    const newAudit = [];

    // -------- MDI device simulator (B4): connected monitors emit live packets. When online, every
    // bed with a connected device gets a small physiologic jitter on its vitals (mimicking a real
    // HL7/IEEE 11073 feed). Offline → no fresh packets (frozen last-known values).
    if (state.online !== false && state.devices?.some((d) => d.connected && d.bedId)) {
      const bedToDev = {};
      for (const d of state.devices) if (d.connected && d.bedId) bedToDev[d.bedId] = d;
      let touched = false;
      const patients = state.patients.map((p) => {
        const dev = bedToDev[p.bedId];
        if (!dev || !p.vitals) return p;
        touched = true;
        const j = () => (Math.random() - 0.5);
        const v = p.vitals;
        return { ...p, vitals: {
          hr:  v.hr  != null ? Math.max(20, Math.round(v.hr  + j() * 3)) : v.hr,
          map: v.map != null ? Math.max(20, Math.round(v.map + j() * 2)) : v.map,
          spo2:v.spo2!= null ? Math.min(100, Math.max(50, Math.round(v.spo2 + j() * 1.5))) : v.spo2,
          temp:v.temp!= null ? Math.round((v.temp + j() * 0.1) * 10) / 10 : v.temp,
          rr:  v.rr  != null ? Math.max(4, Math.round(v.rr + j() * 2)) : v.rr,
        } };
      });
      if (touched) {
        const devices = state.devices.map((d) => (d.connected && d.bedId
          ? { ...d, lastPacketMs: Date.now(), packets: (d.packets || 0) + 1 } : d));
        state = { ...state, patients, devices };
        changed = true;
      }
    }

    // -------- Automatic alarm engine (S-05): device-driven vitals → auto-generated alarms.
    // For every occupied patient with no open alarm, evaluate NEWS2 and the physician's thresholds.
    // A breach auto-fires a CRITICAL/HIGH alarm (machine text never diagnoses).
    if (state.autoAlarm) {
      for (const p of state.patients) {
        const hasOpen = working.some((a) => a.patientId === p.patient_id && a.status !== "CLOSED");
        if (hasOpen) continue;
        const th = state.clinical[p.patient_id]?.thresholds;
        const news2 = computeNews2(p.vitals);
        const breaches = evaluateThresholds(p.vitals, th);
        if (news2 >= NEWS2_ALARM_THRESHOLD || breaches.length > 0) {
          const critical = news2 >= 9 || (p.vitals?.spo2 != null && p.vitals.spo2 <= 90)
            || (p.vitals?.map != null && p.vitals.map <= 58);
          const tier = critical ? TIER.CRITICAL : TIER.HIGH;
          const metric = breaches.length ? breaches.join(", ") : `NEWS2 ${news2}`;
          working = [...working, {
            id: `A-${seq}`, patientId: p.patient_id, bedLabel: p.bedLabel, tier,
            kind: "auto_deterioration", auto: true, trigger: metric,
            summary: "Klinik kötüleşme kriterleri değerlendirilecek",
            status: "FIRED", firedAtSec: nowSec, currentStep: ESCALATION_STEP.NONE,
            events: [], ack: null, snooze: null,
          }];
          newAudit.push({ id: `AL-${seq}`, atMs: Date.now(), atSec: nowSec, actor: "Otomatik Alarm Motoru",
            role: null, action: "ALERT_AUTO_FIRE", target: `A-${seq}`, detail: `${p.bedLabel} · ${tier} · ${metric}` });
          seq += 1;
          changed = true;
        }
      }
    }

    const alerts = working.map((a) => {
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
    if (changed) set({ alerts, clockSec: nowSec, seq,
      auditLog: newAudit.length ? [...state.auditLog, ...newAudit] : state.auditLog });
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
    audit("ALERT_ACK", alertId, `${a.tier} · ${a.bedLabel}${reason ? " · " + reason : ""}`);
  }

  // Mute (silence) an alarm for a fixed window without resetting the escalation clock (S-05). Audible
  // signalling is suppressed but the alarm stays visible and keeps escalating.
  function muteAlert(alertId, minutes = 2) {
    const a = state.alerts.find((x) => x.id === alertId);
    if (!a) throw new Error("Alarm bulunamadı.");
    const untilSec = state.clockSec + minutes * 60;
    const alerts = state.alerts.map((x) => (x.id === alertId
      ? { ...x, mutedUntil: untilSec } : x));
    set({ alerts });
    audit("ALERT_MUTE", alertId, `${minutes} dk · ${a.bedLabel}`);
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
    audit("ALERT_SNOOZE", alertId, `${minutes} dk · ${reason}`);
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
    audit("ALERT_ESCALATE_RRT", alertId, a.bedLabel);
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
    const breakGlass = { by: state.user?.full_name || "—", role: state.user?.role || null,
                         reason, activatedAtSec: state.clockSec,
                         expiresAtSec: state.clockSec + BREAK_GLASS_MINUTES * 60,
                         reviewStatus: "pending", reviewedBy: null, reviewNote: null };
    set({ breakGlass });
    audit("BREAK_GLASS_ACTIVATE", null, reason);
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
    login, loginAs, logout, switchUserByPin,
    admitPatient, transferPatient, assignCareTeam, createHandover, openCriticalAlerts,
    createUser, addUnit, addRoom, addBed,
    setUserPassword, resetUserPin, toggleUserActive, resetUserMfa, setUserMfaRequired, setUserUnits,
    setBedState, updateDevice, recordTestPush,
    assignStaffToBeds, toggleStaffBed,
    addDevice, assignDeviceToBed, deviceForBed,
    reviewBreakGlass,
    setOnline, queueOffline, flushSyncQueue,
    addDiagnosis, addMedication, stopMedication, addProcedure, addFluid, setThresholds,
    toggleMaskNames, setAutoAlarm,
    fireAlert, reconcile,
    acknowledgeAlert, muteAlert, snoozeAlert, escalateToRRT, rrtHasAccess,
    activateBreakGlass, extendBreakGlass, breakGlassActive,
    setSpeed, setRunning, reset,
  };
}
