// Synthetic Azerbaijani demo data. NO real patient data — fixtures only.
import {
  Appointment,
  Banner,
  Department,
  Doctor,
  Hospital,
  Invoice,
  NewsItem,
  Prescription,
  Result,
  Story,
} from "./types";

export const hospitals: Hospital[] = [
  { id: "h1", name: "Mərkəzi Klinika Bakı", distanceKm: 0.7 },
  { id: "h2", name: "Şəfa Tibb Mərkəzi", distanceKm: 3.4 },
  { id: "h3", name: "Sağlam Nəsil Klinikası", distanceKm: 6.1 },
];

export const departments: Department[] = [
  { id: "d1", name: "Kardiologiya", icon: "heart-outline" },
  { id: "d2", name: "Daxili xəstəliklər", icon: "medkit-outline" },
  { id: "d3", name: "Pediatriya", icon: "happy-outline" },
  { id: "d4", name: "Dermatologiya", icon: "hand-left-outline" },
  { id: "d5", name: "Endokrinologiya", icon: "flask-outline" },
  { id: "d6", name: "Nevrologiya", icon: "pulse-outline" },
  { id: "d7", name: "Check-up", icon: "shield-checkmark-outline" },
  { id: "d8", name: "Yenidoğan / YBŞ", icon: "body-outline" },
];

export const doctors: Doctor[] = [
  {
    id: "dr1",
    name: "Dr. Elçin Əliyev",
    specialty: "Kardiologiya",
    favorite: true,
    education: ["Azərbaycan Tibb Universiteti, 2005–2011", "Rezidentura: Kardiologiya, 2011–2014"],
    experience: ["2014–2019 Mərkəzi Klinika", "2019–bu gün Baş kardioloq"],
    memberships: ["Azərbaycan Kardiologiya Cəmiyyəti"],
    nextSlot: "Bu gün",
    times: ["13:10", "13:30", "13:50", "14:30"],
  },
  {
    id: "dr2",
    name: "Dr. Günel Məmmədova",
    specialty: "Pediatriya",
    education: ["Azərbaycan Tibb Universiteti, 2008–2014"],
    experience: ["2014–2020 Uşaq klinikası", "2020–bu gün Pediatr"],
    memberships: ["Pediatriya Assosiasiyası"],
    nextSlot: "Sabah",
    times: ["10:00", "10:20", "11:00"],
  },
  {
    id: "dr3",
    name: "Dr. Ramin Həsənov",
    specialty: "Daxili xəstəliklər",
    education: ["Tibb Universiteti, 2003–2009"],
    experience: ["2009–bu gün Terapevt"],
    memberships: [],
    nextSlot: "3 Dekabr",
    times: ["09:15", "09:45"],
  },
];

export const results: Result[] = [
  {
    id: "r1",
    type: "lab",
    title: "Tam qan sayımı",
    date: "24 Noyabr 2026",
    status: "ready",
    protocol: "50900538",
    hospital: "Mərkəzi Klinika Bakı",
    doctor: "Dr. Ramin Həsənov",
    values: [
      { name: "Hemoglobin", value: 13.8, unit: "g/dL", refLow: 12, refHigh: 16, series: [12.9, 13.2, 13.5, 13.8] },
      { name: "Leykosit", value: 11.4, unit: "10⁹/L", refLow: 4, refHigh: 10, series: [6.1, 7.0, 9.2, 11.4] },
    ],
  },
  {
    id: "r2",
    type: "radiology",
    title: "Döş qəfəsi rentgeni",
    date: "24 Noyabr 2026",
    status: "ready",
    protocol: "50828624",
    hospital: "Mərkəzi Klinika Bakı",
    doctor: "Dr. Pərvanə Əsgərova",
    values: [],
  },
  {
    id: "r3",
    type: "lab",
    title: "Vitamin D",
    date: "5 Dekabr 2026",
    status: "pending",
    protocol: "—",
    hospital: "Mərkəzi Klinika Bakı",
    doctor: "Dr. Ramin Həsənov",
    values: [],
  },
];

export const prescriptions: Prescription[] = [
  {
    id: "p1",
    name: "Amoksisilin + Klavulanat 1000 mq",
    date: "24 Noyabr 2026",
    drug: {
      barcode: "8699522095650",
      usage: "Ağızdan alınır, bütöv udulur",
      withFood: "Yeməklə birlikdə",
      warnings: ["Antibiotikdir.", "Hər gün eyni saatda qəbul edin.", "Kursu yarımçıq saxlamayın."],
    },
  },
  {
    id: "p2",
    name: "D3 vitamini 2000 BV",
    date: "24 Noyabr 2026",
    drug: {
      barcode: "8699123456789",
      usage: "Gündə 1 damcı",
      withFood: "Yeməkdən sonra",
      warnings: ["Həkimin təyin etdiyi dozanı aşmayın."],
    },
  },
];

export const appointments: Appointment[] = [
  { id: "a1", doctor: "Dr. Elçin Əliyev", specialty: "Kardiologiya", date: "28 Noyabr 2026", time: "14:30", hospital: "Mərkəzi Klinika Bakı", status: "confirmed" },
  { id: "a2", doctor: "Dr. Günel Məmmədova", specialty: "Pediatriya", date: "3 Dekabr 2026", time: "10:00", hospital: "Mərkəzi Klinika Bakı", status: "pending" },
];

export const invoices: Invoice[] = [
  { id: "i1", title: "Kardioloq müayinəsi", amount: 40, currency: "AZN", status: "unpaid", date: "24 Noyabr 2026" },
  { id: "i2", title: "Qan analizi", amount: 25, currency: "AZN", status: "paid", date: "20 Noyabr 2026" },
];

export const news: NewsItem[] = [
  { id: "n1", title: "Yeni yenidoğan mərkəzi açıldı", summary: "Müasir YBŞ xidməti indi klinikamızda", tint: "#0891b2" },
  { id: "n2", title: "Qış qripindən qorunma", summary: "5 sadə tövsiyə", tint: "#10b981" },
  { id: "n3", title: "Pulsuz check-up həftəsi", summary: "1–7 Dekabr", tint: "#f59e0b" },
];

export const stories: Story[] = [
  { id: "s1", title: "Anında həkim", tint: "#0891b2" },
  { id: "s2", title: "Beynəlxalq keyfiyyət", tint: "#6366f1" },
  { id: "s3", title: "Sağlıq kartı", tint: "#10b981" },
  { id: "s4", title: "Check-up", tint: "#f59e0b" },
];

export const banners: Banner[] = [
  { id: "b1", title: "Randevunu saniyələr içində al", subtitle: "Həkim seç, saat seç, tamam", tint: "#0891b2" },
  { id: "b2", title: "Nəticələrini anında gör", subtitle: "Analiz və görüntüləmə cibində", tint: "#0e7490" },
];
