// Per-patient demo data, keyed by FİN. Login resolves the patient by FİN; screens
// then read the "current" patient's slices through transport. NO real patient data —
// demo only. Real HBYS demo patients will be mirrored here in M1 (see design doc §5).
import { Appointment, Invoice, Prescription, Result } from "./types";

export type DemoPatient = {
  id: string;
  fin: string;
  name: string;
  birthYear: string;
  phone: string;
  appointments: Appointment[];
  results: Result[];
  prescriptions: Prescription[];
  invoices: Invoice[];
};

// Ozan Sunkur — the demo patient the owner tests with (placeholder records until the
// HBYS demo data is mirrored).
// Synthetic set provided by the HBYS session (aligned with panel conventions: SAMHI, ₼,
// adult lab references). NOT real PHI — the owner's own name for demo testing.
const ozan: DemoPatient = {
  id: "p-ozan",
  fin: "6449004", // panel test hastasıyla eşleşir (yalnız kimlik: FİN/ad/yıl/telefon tutulur)
  name: "Ozan Sunkur",
  birthYear: "1996",
  phone: "+994 51 207 60 41",
  appointments: [
    { id: "a1", doctor: "Dr. Elçin Əliyev", specialty: "Kardiologiya", date: "28 Noyabr 2026", time: "14:30", hospital: "Mərkəzi Klinika Bakı", status: "confirmed" },
    { id: "a2", doctor: "Dr. Günel Məmmədova", specialty: "Daxili Xəstəliklər", date: "5 Dekabr 2026", time: "10:00", hospital: "Mərkəzi Klinika Bakı", status: "pending" },
    { id: "a3", doctor: "Dr. Ramin Həsənov", specialty: "Terapiya", date: "12 Oktyabr 2026", time: "09:30", hospital: "Mərkəzi Klinika Bakı", status: "completed" },
    { id: "a4", doctor: "Dr. Pərvanə Əsgərova", specialty: "Radiologiya", date: "20 İyul 2026", time: "16:00", hospital: "Mərkəzi Klinika Bakı", status: "cancelled" },
  ],
  results: [
    {
      id: "r1", type: "lab", title: "Biokimya paneli", date: "24 Noyabr 2026", status: "ready", protocol: "50900538",
      hospital: "Mərkəzi Klinika Bakı", doctor: "Dr. Elçin Əliyev",
      values: [
        { name: "Qlükoza", value: 96, unit: "mg/dL", refLow: 70, refHigh: 100, series: [92, 98, 95, 96] },
        { name: "Hemoglobin", value: 15.2, unit: "g/dL", refLow: 13.5, refHigh: 17.5, series: [14.6, 14.9, 15.0, 15.2] },
        { name: "TSH", value: 2.1, unit: "mIU/L", refLow: 0.4, refHigh: 4.0, series: [2.4, 2.2, 2.0, 2.1] },
        { name: "LDL xolesterol", value: 142, unit: "mg/dL", refLow: 0, refHigh: 130, series: [120, 128, 135, 142] },
      ],
    },
    { id: "r2", type: "radiology", title: "Döş qəfəsi rentgeni", date: "22 Noyabr 2026", status: "ready", protocol: "50828624", hospital: "Mərkəzi Klinika Bakı", doctor: "Dr. Pərvanə Əsgərova", values: [] },
    { id: "r3", type: "lab", title: "Vitamin D", date: "5 Dekabr 2026", status: "pending", protocol: "—", hospital: "Mərkəzi Klinika Bakı", doctor: "Dr. Elçin Əliyev", values: [] },
    {
      id: "r4", type: "pathology", title: "Biopsiya nəticəsi", date: "18 Noyabr 2026", status: "ready", protocol: "50830211",
      hospital: "Mərkəzi Klinika Bakı", doctor: "Dr. Nigar Əlizadə", values: [],
      body: "Makroskopik: 1.2 sm ölçüdə toxuma nümunəsi. Mikroskopik: xoşxassəli dəyişikliklər, bədxassəli hüceyrə aşkar edilmədi. Nəticə: benign.",
    },
    {
      id: "r5", type: "epicrisis", title: "Kardioloji epikriz", date: "24 Noyabr 2026", status: "ready", protocol: "50900540",
      hospital: "Mərkəzi Klinika Bakı", doctor: "Dr. Elçin Əliyev", values: [],
      body: "Şikayət: döş qəfəsində təzyiq hissi. Müayinə: EKQ normal, LDL yüksək (142 mg/dL). Diaqnoz: hiperlipidemiya. Müalicə: Atorvastatin 20 mq, axşam. İzləmə: 1 ay sonra lipid profili təkrar.",
    },
  ],
  prescriptions: [
    { id: "p1", name: "Atorvastatin 20 mq", date: "24 Noyabr 2026", drug: { barcode: "8699546334455", usage: "Gündə 1 dəfə, axşam", withFood: "Yeməkdən asılı deyil", warnings: ["30 gün istifadə.", "Kolesterol dərmanıdır.", "Həkim nəzarətində davam edin."] } },
    { id: "p2", name: "D vitamini 1000 BV", date: "24 Noyabr 2026", drug: { barcode: "8699123456789", usage: "Gündə 1 dəfə", withFood: "Yeməkdən sonra", warnings: ["60 gün istifadə."] } },
  ],
  invoices: [
    { id: "i1", title: "Kardioloji müayinə", amount: 60, currency: "₼", status: "paid", date: "24 Noyabr 2026" },
    { id: "i2", title: "Laboratoriya paneli", amount: 45, currency: "₼", status: "unpaid", date: "24 Noyabr 2026" },
  ],
};

const aysel: DemoPatient = {
  id: "p-aysel", fin: "5AYSEL1", name: "Aysel Hüseynova", birthYear: "1992", phone: "+994 55 987 65 43",
  appointments: [{ id: "a1", doctor: "Dr. Günel Məmmədova", specialty: "Pediatriya", date: "2 Dekabr 2026", time: "11:00", hospital: "Şəfa Tibb Mərkəzi", status: "confirmed" }],
  results: [{ id: "r1", type: "lab", title: "Dəmir (Fe)", date: "20 Noyabr 2026", status: "ready", protocol: "50811002", hospital: "Şəfa Tibb Mərkəzi", doctor: "Dr. Ramin Həsənov", values: [{ name: "Dəmir", value: 48, unit: "µg/dL", refLow: 60, refHigh: 170, series: [72, 65, 55, 48] }] }],
  prescriptions: [{ id: "p1", name: "D3 vitamini 2000 BV", date: "20 Noyabr 2026", drug: { barcode: "8699123456789", usage: "Gündə 1 damcı", withFood: "Yeməkdən sonra", warnings: ["Təyin olunan dozanı aşmayın."] } }],
  invoices: [{ id: "i1", title: "Pediatriya müayinəsi", amount: 35, currency: "AZN", status: "unpaid", date: "20 Noyabr 2026" }],
};

// Child account linked to Ozan's family (viewed via "family member switch").
const nurlan: DemoPatient = {
  id: "p-nurlan", fin: "CHILD-NURLAN", name: "Nurlan Sunkur", birthYear: "2022", phone: "+994 51 207 60 41",
  appointments: [
    { id: "a1", doctor: "Dr. Günel Məmmədova", specialty: "Pediatriya", date: "6 Dekabr 2026", time: "11:30", hospital: "Mərkəzi Klinika Bakı", status: "confirmed" },
  ],
  results: [
    { id: "r1", type: "lab", title: "Tam qan sayımı", date: "20 Noyabr 2026", status: "ready", protocol: "50900771", hospital: "Mərkəzi Klinika Bakı", doctor: "Dr. Günel Məmmədova", values: [{ name: "Hemoglobin", value: 12.4, unit: "g/dL", refLow: 11, refHigh: 14, series: [11.8, 12.0, 12.2, 12.4] }] },
  ],
  prescriptions: [
    { id: "p1", name: "D3 vitamini 400 BV", date: "20 Noyabr 2026", drug: { barcode: "8699123456789", usage: "Gündə 1 damcı", withFood: "Yeməkdən sonra", warnings: ["Uşaq dozası.", "Təyin olunan dozanı aşmayın."] } },
  ],
  invoices: [],
};

export const patients: DemoPatient[] = [ozan, aysel, nurlan];

// Default to Ozan so the app opens on the owner's test patient even before login.
let currentId = ozan.id;

// Returns the registered patient for this FİN, or null when nobody matches —
// only registered patients can sign in.
export function resolvePatientByFin(fin: string): DemoPatient | null {
  const f = (fin || "").trim().toUpperCase();
  return patients.find((p) => p.fin.toUpperCase() === f) ?? null;
}
export function isRegistered(fin: string): boolean {
  return resolvePatientByFin(fin) !== null;
}
export function setCurrentPatient(id: string) {
  if (patients.some((p) => p.id === id)) currentId = id;
}
export function currentPatient(): DemoPatient {
  return patients.find((p) => p.id === currentId) ?? ozan;
}

export function maskFin(fin: string): string {
  if (fin.length <= 3) return fin;
  return fin.slice(0, 2) + "••••" + fin.slice(-1);
}
