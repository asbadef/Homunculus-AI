// clinicalScoring.js — Hastalık Şiddeti Skorlama Motoru (Homunculus AI)
// -----------------------------------------------------------------------------
// Doğrulanmış klinik skorlama sistemlerinin saf (side-effect'siz) hesaplama fonksiyonları.
// Kaynaklar (formül teyidi):
//   • APACHE II  : Knaus 1985 — Merck Manuals / clincalc APS + yaş + kronik sağlık; mortalite logit
//   • SOFA       : Vincent 1996 — 6 organ sistemi, 0–24
//   • MODS       : Marshall 1995 — 6 organ sistemi, 0–24 (kreatinin/bilirubin µmol/L)
//   • PRISM III  : Pollack 1996 — yaşa göre katmanlı fizyolojik değişkenler
//   • SNAPPE-II  : Richardson 2001 — 6 fizyolojik (SNAP-II) + 3 perinatal
//
// ÖNEMLİ: Bu motor bir KARAR DESTEK aracıdır, tanı koymaz. Tüm skorlar hekim tarafından
// doğrulanmalıdır. Girilmeyen (null/undefined) alanlar 0 puan sayılır ve `missing` listesinde
// raporlanır; böylece kullanıcı eksik veriyle hesaplandığını görür.
// -----------------------------------------------------------------------------

// Bir sayısal değerin geçerli (sonlu sayı) olup olmadığını kontrol eder.
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------------
// APACHE II
// -----------------------------------------------------------------------------
export function apacheTempPoints(t) {
  if (t == null) return 0;
  if (t >= 41) return 4;
  if (t >= 39) return 3;
  if (t >= 38.5) return 1;
  if (t >= 36) return 0;
  if (t >= 34) return 1;
  if (t >= 32) return 2;
  if (t >= 30) return 3;
  return 4;
}
export function apacheMapPoints(m) {
  if (m == null) return 0;
  if (m >= 160) return 4;
  if (m >= 130) return 3;
  if (m >= 110) return 2;
  if (m >= 70) return 0;
  if (m >= 50) return 2;
  return 4;
}
export function apacheHrPoints(h) {
  if (h == null) return 0;
  if (h >= 180) return 4;
  if (h >= 140) return 3;
  if (h >= 110) return 2;
  if (h >= 70) return 0;
  if (h >= 55) return 2;
  if (h >= 40) return 3;
  return 4;
}
export function apacheRrPoints(r) {
  if (r == null) return 0;
  if (r >= 50) return 4;
  if (r >= 35) return 3;
  if (r >= 25) return 1;
  if (r >= 12) return 0;
  if (r >= 10) return 1;
  if (r >= 6) return 2;
  return 4;
}
// Oksijenlenme: FiO2 ≥ 0.5 ise A-aDO2, < 0.5 ise PaO2.
export function apacheOxyPoints({ fio2, aado2, pao2 }) {
  const f = num(fio2);
  if (f != null && f >= 0.5) {
    const a = num(aado2);
    if (a == null) return 0;
    if (a >= 500) return 4;
    if (a >= 350) return 3;
    if (a >= 200) return 2;
    return 0;
  }
  const p = num(pao2);
  if (p == null) return 0;
  if (p > 70) return 0;
  if (p >= 61) return 1;
  if (p >= 55) return 3;
  return 4;
}
export function apachePhPoints(ph) {
  if (ph == null) return 0;
  if (ph >= 7.7) return 4;
  if (ph >= 7.6) return 3;
  if (ph >= 7.5) return 1;
  if (ph >= 7.33) return 0;
  if (ph >= 7.25) return 2;
  if (ph >= 7.15) return 3;
  return 4;
}
export function apacheNaPoints(na) {
  if (na == null) return 0;
  if (na >= 180) return 4;
  if (na >= 160) return 3;
  if (na >= 155) return 2;
  if (na >= 150) return 1;
  if (na >= 130) return 0;
  if (na >= 120) return 2;
  if (na >= 111) return 3;
  return 4;
}
export function apacheKPoints(k) {
  if (k == null) return 0;
  if (k >= 7) return 4;
  if (k >= 6) return 3;
  if (k >= 5.5) return 1;
  if (k >= 3.5) return 0;
  if (k >= 3) return 1;
  if (k >= 2.5) return 2;
  return 4;
}
// Kreatinin (mg/dL). Akut böbrek yetmezliğinde puan 2 katına çıkar.
export function apacheCreatininePoints(cr, acuteRenalFailure) {
  if (cr == null) return 0;
  let pts;
  if (cr >= 3.5) pts = 4;
  else if (cr >= 2) pts = 3;
  else if (cr >= 1.5) pts = 2;
  else if (cr >= 0.6) pts = 0;
  else pts = 2;
  return acuteRenalFailure ? pts * 2 : pts;
}
export function apacheHctPoints(h) {
  if (h == null) return 0;
  if (h >= 60) return 4;
  if (h >= 50) return 2;
  if (h >= 46) return 1;
  if (h >= 30) return 0;
  if (h >= 20) return 2;
  return 4;
}
export function apacheWbcPoints(w) {
  if (w == null) return 0;
  if (w >= 40) return 4;
  if (w >= 20) return 2;
  if (w >= 15) return 1;
  if (w >= 3) return 0;
  if (w >= 1) return 2;
  return 4;
}
export function apacheAgePoints(age) {
  if (age == null) return 0;
  if (age >= 75) return 6;
  if (age >= 65) return 5;
  if (age >= 55) return 3;
  if (age >= 45) return 2;
  return 0;
}
// Kronik sağlık: 'elective' (elektif postop) → 2; 'emergency'|'nonoperative' → 5; 'none' → 0.
export function apacheChronicPoints(chronic) {
  if (chronic === "elective") return 2;
  if (chronic === "emergency" || chronic === "nonoperative") return 5;
  return 0;
}

export function computeApacheII(inp = {}) {
  const gcs = num(inp.gcs);
  const rows = {
    temp: apacheTempPoints(num(inp.temp)),
    map: apacheMapPoints(num(inp.map)),
    hr: apacheHrPoints(num(inp.hr)),
    rr: apacheRrPoints(num(inp.rr)),
    oxy: apacheOxyPoints(inp.oxygenation || {}),
    ph: apachePhPoints(num(inp.ph)),
    na: apacheNaPoints(num(inp.na)),
    k: apacheKPoints(num(inp.k)),
    creatinine: apacheCreatininePoints(num(inp.creatinine), !!inp.acuteRenalFailure),
    hct: apacheHctPoints(num(inp.hct)),
    wbc: apacheWbcPoints(num(inp.wbc)),
    gcs: gcs == null ? 0 : Math.max(0, 15 - gcs),
  };
  const aps = Object.values(rows).reduce((a, b) => a + b, 0);
  const agePts = apacheAgePoints(num(inp.age));
  const chronicPts = apacheChronicPoints(inp.chronicHealth);
  const total = aps + agePts + chronicPts;

  // Mortalite: ln(R/(1-R)) = -3.517 + 0.146*skor + 0.603(acil cerrahi) + tanı ağırlığı
  const dxWeight = num(inp.diagnosisWeight) || 0;
  const logit = -3.517 + 0.146 * total + (inp.emergencySurgery ? 0.603 : 0) + dxWeight;
  const mortality = Math.exp(logit) / (1 + Math.exp(logit));

  const missing = [];
  ["temp", "map", "hr", "rr", "ph", "na", "k", "creatinine", "hct", "wbc"].forEach((key) => {
    if (num(inp[key]) == null) missing.push(key);
  });
  if (gcs == null) missing.push("gcs");
  if (num(inp.age) == null) missing.push("age");

  return { key: "APACHE2", score: total, aps, agePoints: agePts, chronicPoints: chronicPts,
    rows, mortality: Math.round(mortality * 1000) / 10, missing, max: 71 };
}

// -----------------------------------------------------------------------------
// SOFA (0–24)
// -----------------------------------------------------------------------------
export function sofaRespPoints(ratio, ventilated) {
  if (ratio == null) return 0;
  if (ratio >= 400) return 0;
  if (ratio >= 300) return 1;
  if (ratio >= 200) return 2;
  if (ratio >= 100) return ventilated ? 3 : 2;
  return ventilated ? 4 : 2;
}
export function sofaPlateletPoints(p) {
  if (p == null) return 0;
  if (p >= 150) return 0;
  if (p >= 100) return 1;
  if (p >= 50) return 2;
  if (p >= 20) return 3;
  return 4;
}
export function sofaBilirubinPoints(b) {
  if (b == null) return 0;
  if (b < 1.2) return 0;
  if (b < 2) return 1;
  if (b < 6) return 2;
  if (b < 12) return 3;
  return 4;
}
// Kardiyovasküler seviye: 0=MAP≥70, 1=MAP<70, 2=düşük doz dopamin/dobutamin,
// 3=orta doz vazopresör, 4=yüksek doz vazopresör.
export function sofaCardioPoints(level) {
  const l = num(level);
  if (l == null) return 0;
  return Math.max(0, Math.min(4, Math.round(l)));
}
export function sofaGcsPoints(g) {
  if (g == null) return 0;
  if (g >= 15) return 0;
  if (g >= 13) return 1;
  if (g >= 10) return 2;
  if (g >= 6) return 3;
  return 4;
}
export function sofaRenalPoints(cr) {
  if (cr == null) return 0;
  if (cr < 1.2) return 0;
  if (cr < 2) return 1;
  if (cr < 3.5) return 2;
  if (cr < 5) return 3;
  return 4;
}
export function computeSofa(inp = {}) {
  const rows = {
    resp: sofaRespPoints(num(inp.pfRatio), !!inp.ventilated),
    coag: sofaPlateletPoints(num(inp.platelets)),
    liver: sofaBilirubinPoints(num(inp.bilirubin)),
    cardio: sofaCardioPoints(inp.cardioLevel),
    cns: sofaGcsPoints(num(inp.gcs)),
    renal: sofaRenalPoints(num(inp.creatinine)),
  };
  const score = Object.values(rows).reduce((a, b) => a + b, 0);
  const missing = [];
  if (num(inp.pfRatio) == null) missing.push("pfRatio");
  if (num(inp.platelets) == null) missing.push("platelets");
  if (num(inp.bilirubin) == null) missing.push("bilirubin");
  if (num(inp.cardioLevel) == null) missing.push("cardioLevel");
  if (num(inp.gcs) == null) missing.push("gcs");
  if (num(inp.creatinine) == null) missing.push("creatinine");
  // Yaklaşık mortalite bantları (literatür): 0-6 <%10, 7-9 ~%15-20, 10-12 ~%40-50, 13-14 ~%50-60, ≥15 >%80
  let mortality = 0;
  if (score >= 15) mortality = 85; else if (score >= 13) mortality = 55;
  else if (score >= 10) mortality = 45; else if (score >= 7) mortality = 18; else mortality = 8;
  return { key: "SOFA", score, rows, mortality, missing, max: 24 };
}

// -----------------------------------------------------------------------------
// MODS (0–24) — kreatinin & bilirubin µmol/L
// -----------------------------------------------------------------------------
export function modsRespPoints(ratio) {
  if (ratio == null) return 0;
  if (ratio > 300) return 0;
  if (ratio >= 226) return 1;
  if (ratio >= 151) return 2;
  if (ratio >= 76) return 3;
  return 4;
}
export function modsRenalPoints(cr) {
  if (cr == null) return 0;
  if (cr <= 100) return 0;
  if (cr <= 200) return 1;
  if (cr <= 350) return 2;
  if (cr <= 500) return 3;
  return 4;
}
export function modsHepaticPoints(b) {
  if (b == null) return 0;
  if (b <= 20) return 0;
  if (b <= 60) return 1;
  if (b <= 120) return 2;
  if (b <= 240) return 3;
  return 4;
}
// PAR = KH × (CVP / MAP)
export function modsCardioPoints(par) {
  if (par == null) return 0;
  if (par <= 10) return 0;
  if (par <= 15) return 1;
  if (par <= 20) return 2;
  if (par <= 30) return 3;
  return 4;
}
export function modsHematoPoints(p) {
  if (p == null) return 0;
  if (p > 120) return 0;
  if (p >= 81) return 1;
  if (p >= 51) return 2;
  if (p >= 21) return 3;
  return 4;
}
export function modsNeuroPoints(g) {
  if (g == null) return 0;
  if (g >= 15) return 0;
  if (g >= 13) return 1;
  if (g >= 10) return 2;
  if (g >= 7) return 3;
  return 4;
}
export function computeMods(inp = {}) {
  // PAR hesaplanabiliyorsa hesapla
  let par = num(inp.par);
  if (par == null) {
    const hr = num(inp.hr), cvp = num(inp.cvp), map = num(inp.map);
    if (hr != null && cvp != null && map != null && map > 0) par = hr * (cvp / map);
  }
  const rows = {
    resp: modsRespPoints(num(inp.pfRatio)),
    renal: modsRenalPoints(num(inp.creatinine)),
    hepatic: modsHepaticPoints(num(inp.bilirubin)),
    cardio: modsCardioPoints(par),
    hemato: modsHematoPoints(num(inp.platelets)),
    neuro: modsNeuroPoints(num(inp.gcs)),
  };
  const score = Object.values(rows).reduce((a, b) => a + b, 0);
  const missing = [];
  if (num(inp.pfRatio) == null) missing.push("pfRatio");
  if (num(inp.creatinine) == null) missing.push("creatinine");
  if (num(inp.bilirubin) == null) missing.push("bilirubin");
  if (par == null) missing.push("par");
  if (num(inp.platelets) == null) missing.push("platelets");
  if (num(inp.gcs) == null) missing.push("gcs");
  // Yaklaşık mortalite (Marshall): 0 ~%0, 9-12 ~%25, 13-16 ~%50, 17-20 ~%75, 21-24 ~%100
  let mortality = 0;
  if (score >= 21) mortality = 100; else if (score >= 17) mortality = 75;
  else if (score >= 13) mortality = 50; else if (score >= 9) mortality = 25;
  else if (score >= 5) mortality = 10; else mortality = 2;
  return { key: "MODS", score, rows, par: par == null ? null : Math.round(par * 10) / 10,
    mortality, missing, max: 24 };
}

// -----------------------------------------------------------------------------
// PRISM III — yaşa göre katmanlı (Pollack 1996 standart eşikleri)
// -----------------------------------------------------------------------------
// ageDays'ten yaş grubunu döndürür.
export function prismAgeGroup(ageDays) {
  const d = num(ageDays);
  if (d == null) return "child";
  if (d <= 30) return "neonate";
  if (d <= 730) return "infant";       // 31 gün – 2 yıl
  if (d <= 4380) return "child";       // 2 – 12 yıl
  return "adolescent";
}
export function prismSbpPoints(sbp, group) {
  if (sbp == null) return 0;
  const t = { neonate: [40, 55], infant: [45, 65], child: [55, 75], adolescent: [65, 85] }[group] || [55, 75];
  if (sbp < t[0]) return 7;
  if (sbp < t[1]) return 3;
  return 0;
}
export function prismHrPoints(hr, group) {
  if (hr == null) return 0;
  const t = { neonate: [215, 225], infant: [215, 225], child: [185, 205], adolescent: [145, 155] }[group] || [185, 205];
  if (hr > t[1]) return 4;
  if (hr >= t[0]) return 3;
  return 0;
}
export function prismTempPoints(t) {
  if (t == null) return 0;
  return (t < 33 || t > 40) ? 3 : 0;
}
export function prismMentalPoints(gcs) {
  if (gcs == null) return 0;
  return gcs < 8 ? 5 : 0;
}
// pupils: 'both' (ikisi de sabit >3mm) → 11, 'one' → 7, 'reactive'/null → 0
export function prismPupilPoints(pupils) {
  if (pupils === "both") return 11;
  if (pupils === "one") return 7;
  return 0;
}
export function prismAcidosisPoints(ph, tco2) {
  const p = num(ph), c = num(tco2);
  if (p == null && c == null) return 0;
  if ((p != null && p < 7.0) || (c != null && c < 5)) return 6;
  if ((p != null && p >= 7.0 && p <= 7.28) || (c != null && c >= 5 && c <= 16.9)) return 2;
  return 0;
}
export function prismPhAlkPoints(ph) {
  if (ph == null) return 0;
  if (ph > 7.55) return 3;
  if (ph >= 7.48) return 2;
  return 0;
}
export function prismPco2Points(pco2) {
  if (pco2 == null) return 0;
  if (pco2 > 75) return 3;
  if (pco2 >= 50) return 1;
  return 0;
}
export function prismTco2Points(tco2) {
  if (tco2 == null) return 0;
  return tco2 > 34 ? 4 : 0;
}
export function prismPao2Points(pao2) {
  if (pao2 == null) return 0;
  if (pao2 < 42) return 6;
  if (pao2 < 50) return 3;
  return 0;
}
export function prismGlucosePoints(g) {
  if (g == null) return 0;
  return g > 200 ? 2 : 0;
}
export function prismPotassiumPoints(k) {
  if (k == null) return 0;
  return k > 6.9 ? 3 : 0;
}
export function prismCreatininePoints(cr, group) {
  if (cr == null) return 0;
  const t = { neonate: 0.85, infant: 0.90, child: 0.90, adolescent: 1.30 }[group] || 0.90;
  return cr > t ? 2 : 0;
}
export function prismBunPoints(bun, group) {
  if (bun == null) return 0;
  const t = group === "neonate" ? 11.9 : 14.9;
  return bun > t ? 3 : 0;
}
export function prismWbcPoints(w) {
  if (w == null) return 0;
  return w < 3 ? 4 : 0; // w x10^3/µL, <3000/µL
}
export function prismPlateletPoints(p) {
  if (p == null) return 0;
  if (p < 50) return 5;
  if (p < 100) return 4;
  if (p <= 200) return 2;
  return 0;
}
export function prismCoagPoints(pt, ptt, group) {
  const p = num(pt), t = num(ptt);
  if (p == null && t == null) return 0;
  const pttMax = group === "neonate" ? 85 : 57;
  if ((p != null && p > 22) || (t != null && t > pttMax)) return 3;
  return 0;
}
export function computePrismIII(inp = {}) {
  const group = prismAgeGroup(inp.ageDays);
  const rows = {
    sbp: prismSbpPoints(num(inp.sbp), group),
    hr: prismHrPoints(num(inp.hr), group),
    temp: prismTempPoints(num(inp.temp)),
    mental: prismMentalPoints(num(inp.gcs)),
    pupils: prismPupilPoints(inp.pupils),
    acidosis: prismAcidosisPoints(inp.ph, inp.tco2),
    phAlk: prismPhAlkPoints(num(inp.ph)),
    pco2: prismPco2Points(num(inp.pco2)),
    tco2: prismTco2Points(num(inp.tco2)),
    pao2: prismPao2Points(num(inp.pao2)),
    glucose: prismGlucosePoints(num(inp.glucose)),
    potassium: prismPotassiumPoints(num(inp.potassium)),
    creatinine: prismCreatininePoints(num(inp.creatinine), group),
    bun: prismBunPoints(num(inp.bun), group),
    wbc: prismWbcPoints(num(inp.wbc)),
    platelets: prismPlateletPoints(num(inp.platelets)),
    coag: prismCoagPoints(inp.pt, inp.ptt, group),
  };
  const score = Object.values(rows).reduce((a, b) => a + b, 0);
  // PRISM III mortalite logit (yaklaşık): -6.71 + 0.47*skor (temel model)
  const logit = -6.71 + 0.47 * score;
  const mortality = Math.exp(logit) / (1 + Math.exp(logit));
  const missing = [];
  ["sbp", "hr", "temp", "gcs"].forEach((k) => { if (num(inp[k]) == null) missing.push(k); });
  return { key: "PRISM3", score, rows, ageGroup: group,
    mortality: Math.round(mortality * 1000) / 10, missing, max: 74 };
}

// -----------------------------------------------------------------------------
// SNAPPE-II (neonatal) — SNAP-II (6 fizyolojik) + 3 perinatal
// -----------------------------------------------------------------------------
export function snapMapPoints(m) {
  if (m == null) return 0;
  if (m < 20) return 19;
  if (m < 30) return 9;
  return 0;
}
export function snapTempPoints(t) {
  if (t == null) return 0;
  if (t < 35) return 15;
  if (t < 35.6) return 8;
  return 0;
}
export function snapPfPoints(ratio) {
  if (ratio == null) return 0;
  if (ratio < 1.0) return 16;
  if (ratio < 2.5) return 5;
  return 0;
}
export function snapPhPoints(ph) {
  if (ph == null) return 0;
  if (ph < 7.10) return 16;
  if (ph < 7.20) return 7;
  return 0;
}
export function snapSeizurePoints(multiSeizure) {
  return multiSeizure ? 19 : 0;
}
export function snapUrinePoints(u) {
  if (u == null) return 0;
  if (u < 0.1) return 18;
  if (u < 1.0) return 5;
  return 0;
}
export function snapBirthWeightPoints(bw) {
  if (bw == null) return 0;
  if (bw < 750) return 17;
  if (bw < 1000) return 10;
  return 0;
}
export function snapSgaPoints(sga) {
  return sga ? 12 : 0;
}
export function snapApgarPoints(apgar) {
  if (apgar == null) return 0;
  return apgar < 7 ? 18 : 0;
}
export function computeSnappeII(inp = {}) {
  const physio = {
    map: snapMapPoints(num(inp.map)),
    temp: snapTempPoints(num(inp.temp)),
    pf: snapPfPoints(num(inp.pfRatio)),
    ph: snapPhPoints(num(inp.ph)),
    seizure: snapSeizurePoints(!!inp.multiSeizure),
    urine: snapUrinePoints(num(inp.urineOutput)),
  };
  const perinatal = {
    birthWeight: snapBirthWeightPoints(num(inp.birthWeight)),
    sga: snapSgaPoints(!!inp.sga),
    apgar: snapApgarPoints(num(inp.apgar)),
  };
  const snap2 = Object.values(physio).reduce((a, b) => a + b, 0);
  const snappe2 = snap2 + Object.values(perinatal).reduce((a, b) => a + b, 0);
  const rows = { ...physio, ...perinatal };
  const missing = [];
  if (num(inp.map) == null) missing.push("map");
  if (num(inp.temp) == null) missing.push("temp");
  if (num(inp.ph) == null) missing.push("ph");
  // SNAPPE-II mortalite (yaklaşık bantlar): <20 ~%1, 20-39 ~%10, 40-59 ~%30, 60-79 ~%55, ≥80 ~%80
  let mortality = 0;
  if (snappe2 >= 80) mortality = 80; else if (snappe2 >= 60) mortality = 55;
  else if (snappe2 >= 40) mortality = 30; else if (snappe2 >= 20) mortality = 10; else mortality = 1;
  return { key: "SNAPPE2", score: snappe2, snap2, rows, mortality, missing, max: 162 };
}

// -----------------------------------------------------------------------------
// Skor kayıt tipi seçimi — ünite tipine göre uygulanabilir skorlar
// -----------------------------------------------------------------------------
export const SCORE_DEFS = {
  APACHE2: { key: "APACHE2", label: "APACHE II", compute: computeApacheII },
  SOFA: { key: "SOFA", label: "SOFA", compute: computeSofa },
  MODS: { key: "MODS", label: "MOD", compute: computeMods },
  PRISM3: { key: "PRISM3", label: "PRISM III", compute: computePrismIII },
  SNAPPE2: { key: "SNAPPE2", label: "SNAP-II / SNAPPE-II", compute: computeSnappeII },
};

// Ünite tipi → uygulanabilir skorlama sistemleri (formdaki sekmelere karşılık gelir).
export const UNIT_SCORES = {
  ADULT_ICU: ["APACHE2", "SOFA", "MODS"],
  CVICU: ["APACHE2", "SOFA", "MODS"],
  CORONARY: ["APACHE2", "SOFA", "MODS"],
  EMERGENCY: ["APACHE2", "SOFA", "MODS"],
  SURGICAL: ["APACHE2", "SOFA", "MODS"],
  PALLIATIVE: ["SOFA", "MODS"],
  PICU: ["PRISM3", "SOFA"],
  NICU: ["SNAPPE2"],
};

export function scoresForUnitType(type) {
  return UNIT_SCORES[type] || UNIT_SCORES.ADULT_ICU;
}
