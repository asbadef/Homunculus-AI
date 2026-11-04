// Synthetic Azerbaijani demo data. NO real patient data — fixtures only.
import {
  Appointment,
  Banner,
  Branch,
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

// Mirror of HBYS units (H.allUnits), patient-bookable subset only (per panel: outpatient /
// policlinic / day units; inpatient/ICU/emergency are not open to patient booking). Real ids.
export const departments: Department[] = [
  { id: "pol", name: "Poliklinikalar", icon: "business-outline" },
  { id: "dax", name: "Daxili Xəstəliklər Servisi", icon: "medkit-outline" },
  { id: "cer", name: "Cərrahiyyə Servisi", icon: "cut-outline" },
  { id: "usq", name: "Uşaq Servisi", icon: "happy-outline" },
  { id: "kem", name: "Kimya Terapiyası", icon: "flask-outline" },
  { id: "gun", name: "Günübirlik Xidmət", icon: "sunny-outline" },
  { id: "ivf", name: "IVF Günübirlik Xidmət", icon: "heart-circle-outline" },
];

// Patient-facing branches: what a patient actually chooses when booking. Each maps to a
// doctor specialty (for filtering) and to an HBYS unit (`unitId`, kept for M1). Only
// patient-bookable outpatient branches appear here — anaesthesia/emergency are excluded.
export const branches: Branch[] = [
  { id: "b-alqologiya", name: "Alqologiya", specialty: "Anesteziologiya-reanimatologiya", unitId: "gun", icon: "body-outline" },
  { id: "b-cerrahiyye", name: "Cərrahiyyə", specialty: "Cərrahiyyə", unitId: "cer", icon: "cut-outline" },
  { id: "b-daxili", name: "Daxili xəstəliklər", specialty: "Daxili xəstəliklər", unitId: "dax", icon: "medkit-outline" },
  { id: "b-dermatologiya", name: "Dermatologiya", specialty: "Dermatologiya", unitId: "pol", icon: "hand-left-outline" },
  { id: "b-dietologiya", name: "Dietologiya", specialty: "Dietologiya", unitId: "pol", icon: "nutrition-outline" },
  { id: "b-endokrinologiya", name: "Endokrinologiya", specialty: "Endokrinologiya", unitId: "dax", icon: "flask-outline" },
  { id: "b-kardioloji", name: "Kardiologiya", specialty: "Kardiologiya", unitId: "pol", icon: "heart-outline" },
  { id: "b-neonatoloji", name: "Neonatologiya", specialty: "Neonatologiya", unitId: "usq", icon: "heart-circle-outline" },
  { id: "b-nevrologiya", name: "Nevrologiya", specialty: "Nevrologiya", unitId: "dax", icon: "pulse-outline" },
  { id: "b-oftalmologiya", name: "Oftalmologiya (Göz)", specialty: "Oftalmologiya", unitId: "pol", icon: "eye-outline" },
  { id: "b-stomatologiya", name: "Stomatologiya (Diş)", specialty: "Stomatologiya", unitId: "pol", icon: "happy-outline" },
  { id: "b-usaq", name: "Uşaq xəstəlikləri", specialty: "Pediatriya", unitId: "usq", icon: "balloon-outline" },
];

// Doctors with department assignments. The 4 real HBYS doctors (per panel) plus demo
// doctors so every department has someone; the appointment wizard filters by department.
export const doctors: Doctor[] = [
  {
    id: "dr1", name: "Dr. Kamran Rzayev", specialty: "Anesteziologiya-reanimatologiya", departmentIds: ["gun","kem"], favorite: true,
    education: ["Azərbaycan Tibb Universiteti, 2004–2010", "Rezidentura: Anesteziologiya, 2010–2013"],
    experience: ["2013–bu gün Reanimasiya (Böyüklər), KVC Reanimasiyası"],
    memberships: ["Azərbaycan Anesteziologiya Cəmiyyəti"],
    publications: ["Kritik vəziyyətli xəstələrdə sedasiya, 2022"],
    nextSlot: "Bu gün", times: ["09:00", "09:30", "10:00", "10:30"],
  },
  {
    id: "dr2", name: "Dr. Emil Nəsirov", specialty: "Təcili tibb", departmentIds: ["dax","cer","usq"],
    education: ["Azərbaycan Tibb Universiteti, 2006–2012"],
    experience: ["2012–bu gün Təcili Yardım, Daxili və Cərrahiyyə servisləri"],
    memberships: [], publications: [],
    nextSlot: "Sabah", times: ["08:30", "09:00", "11:00"],
  },
  {
    id: "dr3", name: "Dr. Aynur Cəfərli", specialty: "Daxili xəstəliklər", departmentIds: ["dax","pol"],
    education: ["Azərbaycan Tibb Universiteti, 2008–2014"],
    experience: ["2014–bu gün Daxili Xəstəliklər Servisi"],
    memberships: [], publications: ["Diabetin ambulator idarəsi, 2021"],
    nextSlot: "Bu gün", times: ["13:10", "13:30", "14:00"],
  },
  {
    id: "dr4", name: "Dr. Samir Quliyev", specialty: "Cərrahiyyə", departmentIds: ["cer","ivf"],
    education: ["Azərbaycan Tibb Universiteti, 2003–2009"],
    experience: ["2009–bu gün Cərrahiyyə Servisi"],
    memberships: ["Azərbaycan Cərrahlar Birliyi"], publications: ["Laparoskopik cərrahiyyə təcrübəsi, 2020"],
    nextSlot: "3 Dekabr", times: ["09:15", "09:45", "10:15"],
  },
  {
    id: "dr5", name: "Dr. Elçin Əliyev", specialty: "Kardiologiya", departmentIds: ["pol"],
    education: ["Azərbaycan Tibb Universiteti, 2005–2011", "Rezidentura: Kardiologiya, 2011–2014"],
    experience: ["2014–bu gün Baş kardioloq"],
    memberships: ["Azərbaycan Kardiologiya Cəmiyyəti"], publications: ["Hipertoniyanın erkən müalicəsi, 2023"],
    nextSlot: "Bu gün", times: ["10:00", "10:30", "11:00", "14:30"],
  },
  {
    id: "dr6", name: "Dr. Günel Məmmədova", specialty: "Pediatriya", departmentIds: ["usq"],
    education: ["Azərbaycan Tibb Universiteti, 2008–2014"],
    experience: ["2014–bu gün Uşaq və Yenidoğan xidməti"],
    memberships: ["Pediatriya Assosiasiyası"], publications: [],
    nextSlot: "Sabah", times: ["10:00", "10:20", "11:00"],
  },
  {
    id: "dr7", name: "Dr. Nigar Əlizadə", specialty: "Kardiologiya", departmentIds: ["pol"],
    education: ["Azərbaycan Tibb Universiteti, 2010–2016"],
    experience: ["2016–bu gün Kardioloq"],
    memberships: [], publications: [],
    nextSlot: "4 Dekabr", times: ["12:00", "12:30", "13:00"],
  },
  {
    id: "dr8", name: "Dr. Validə Qasımova", specialty: "Neonatologiya", departmentIds: ["usq"],
    education: ["Azərbaycan Tibb Universiteti, 2007–2013"],
    experience: ["2013–bu gün Yenidoğan (YBŞ)"],
    memberships: ["Neonatologiya Cəmiyyəti"], publications: ["Erkən doğulanların qidalanması, 2021"],
    nextSlot: "Bu gün", times: ["09:30", "10:00", "10:30"],
  },
  {
    id: "dr9", name: "Dr. Leyla Hüseynova", specialty: "Dermatologiya", departmentIds: ["pol"],
    education: ["Azərbaycan Tibb Universiteti, 2009–2015", "Rezidentura: Dermatologiya, 2015–2018"],
    experience: ["2018–bu gün Dermatoloq, estetik dermatologiya"],
    memberships: ["Dermatologiya Assosiasiyası"], publications: [],
    nextSlot: "Bu gün", times: ["11:00", "11:30", "12:00", "15:00"],
  },
  {
    id: "dr10", name: "Dr. Rəşad Məmmədli", specialty: "Endokrinologiya", departmentIds: ["dax"],
    education: ["Azərbaycan Tibb Universiteti, 2006–2012"],
    experience: ["2012–bu gün Endokrinoloq (diabet, tiroid)"],
    memberships: ["Endokrinologiya Cəmiyyəti"], publications: ["Tip 2 diabetdə müasir müalicə, 2022"],
    nextSlot: "Sabah", times: ["09:00", "09:40", "10:20"],
  },
  {
    id: "dr11", name: "Dyt. Aysel Rəhimova", specialty: "Dietologiya", departmentIds: ["pol"],
    education: ["Qida və Dietologiya, 2011–2015"],
    experience: ["2015–bu gün Klinik dietoloq"],
    memberships: [], publications: [],
    nextSlot: "Bu gün", times: ["13:00", "13:30", "14:00"],
  },
  {
    id: "dr12", name: "Dr. Elvin Qədirov", specialty: "Nevrologiya", departmentIds: ["dax"],
    education: ["Azərbaycan Tibb Universiteti, 2005–2011", "Rezidentura: Nevrologiya, 2011–2014"],
    experience: ["2014–bu gün Nevroloq"],
    memberships: ["Nevrologiya Cəmiyyəti"], publications: [],
    nextSlot: "4 Dekabr", times: ["10:00", "10:30", "11:00"],
  },
  {
    id: "dr13", name: "Dr. Nərmin Əsgərova", specialty: "Oftalmologiya", departmentIds: ["pol"],
    education: ["Azərbaycan Tibb Universiteti, 2008–2014"],
    experience: ["2014–bu gün Göz həkimi"],
    memberships: ["Oftalmologiya Assosiasiyası"], publications: [],
    nextSlot: "Sabah", times: ["09:30", "10:00", "10:30", "11:30"],
  },
  {
    id: "dr14", name: "Dr. Tural Babayev", specialty: "Stomatologiya", departmentIds: ["pol"],
    education: ["Diş Həkimliyi Fakültəsi, 2010–2015"],
    experience: ["2015–bu gün Stomatoloq (ağız-diş sağlamlığı)"],
    memberships: ["Diş Həkimləri Birliyi"], publications: [],
    nextSlot: "Bu gün", times: ["09:00", "09:30", "10:00", "14:00"],
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
  {
    id: "n1", title: "Yeni yenidoğan mərkəzi açıldı", summary: "Müasir YBŞ xidməti indi klinikamızda", tint: "#0891b2",
    date: "2 Noyabr 2026",
    body: "Klinikamızda müasir avadanlıqla təchiz olunmuş yeni Yenidoğan İntensiv Baxış şöbəsi (YBŞ) fəaliyyətə başladı. Şöbə 24/7 neonatoloq nəzarəti, inkubator dəstəyi və erkən doğulmuş körpələr üçün xüsusi baxış imkanları təklif edir. Randevu üçün tətbiq üzərindən Neonatologiya bölməsini seçə bilərsiniz.",
  },
  {
    id: "n2", title: "Qış qripindən qorunma", summary: "5 sadə tövsiyə", tint: "#10b981",
    date: "28 Oktyabr 2026",
    body: "Qış aylarında qripdən qorunmaq üçün: 1) Əllərinizi tez-tez yuyun. 2) İl mövsümündə qrip peyvəndini vurdurun. 3) Çox su için və balanslı qidalanın. 4) İzdihamlı yerlərdə maska taxın. 5) Simptom varsa evdə qalın və həkimlə əlaqə saxlayın. Peyvənd üçün tətbiqdən randevu ala bilərsiniz.",
  },
  {
    id: "n3", title: "Pulsuz check-up həftəsi", summary: "1–7 Dekabr", tint: "#f59e0b",
    date: "1 Dekabr 2026",
    body: "1–7 Dekabr tarixlərində əsas check-up paketləri pulsuzdur: qan təzyiqi, qan şəkəri, xolesterol və ümumi müayinə. Kampaniyadan yararlanmaq üçün tətbiqdən Check-up bölməsini seçib randevu alın. Yerlər məhduddur.",
  },
];

export const stories: Story[] = [
  { id: "s1", title: "Anında həkim", tint: "#0891b2", route: "/randevu-al/tip" },
  { id: "s2", title: "Beynəlxalq keyfiyyət", tint: "#6366f1", route: "/kampanyalar" },
  { id: "s3", title: "Sağlıq kartı", tint: "#10b981", route: "/saglik-karti" },
  { id: "s4", title: "Check-up həftəsi", tint: "#f59e0b", route: "/check-up" },
  { id: "s5", title: "Ürək sağlamlığı", tint: "#ef4444", route: "/haber/n2" },
  { id: "s6", title: "Peyvənd təqvimi", tint: "#0ea5e9", route: "/asi-karti" },
  { id: "s7", title: "Qış kampaniyası", tint: "#8b5cf6", route: "/kampanyalar" },
  { id: "s8", title: "Yenidoğan mərkəzi", tint: "#14b8a6", route: "/haber/n1" },
];

export const banners: Banner[] = [
  { id: "b1", title: "Randevunu saniyələr içində al", subtitle: "Həkim seç, saat seç, tamam", tint: "#0891b2" },
  { id: "b2", title: "Nəticələrini anında gör", subtitle: "Analiz və görüntüləmə cibində", tint: "#0e7490" },
];
