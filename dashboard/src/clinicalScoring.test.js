// clinicalScoring.test.js — Hastalık Şiddeti Skorlama Motoru testleri
import { describe, it, expect } from "vitest";
import {
  apacheTempPoints, apacheMapPoints, apacheHrPoints, apacheCreatininePoints,
  apacheOxyPoints, computeApacheII,
  sofaRespPoints, sofaPlateletPoints, computeSofa,
  modsCardioPoints, computeMods,
  prismAgeGroup, prismSbpPoints, prismHrPoints, computePrismIII,
  snapMapPoints, snapPfPoints, computeSnappeII,
  SCORE_DEFS, UNIT_SCORES, scoresForUnitType,
} from "./clinicalScoring.js";

describe("APACHE II — alt puanlar", () => {
  it("vücut ısısı eşikleri", () => {
    expect(apacheTempPoints(37)).toBe(0);
    expect(apacheTempPoints(41)).toBe(4);
    expect(apacheTempPoints(29)).toBe(4);
    expect(apacheTempPoints(33)).toBe(2);
    expect(apacheTempPoints(null)).toBe(0);
  });
  it("ortalama kan basıncı eşikleri", () => {
    expect(apacheMapPoints(90)).toBe(0);
    expect(apacheMapPoints(45)).toBe(4);
    expect(apacheMapPoints(60)).toBe(2);
    expect(apacheMapPoints(160)).toBe(4);
  });
  it("kalp hızı eşikleri", () => {
    expect(apacheHrPoints(80)).toBe(0);
    expect(apacheHrPoints(145)).toBe(3);
    expect(apacheHrPoints(185)).toBe(4);
  });
  it("kreatinin akut böbrek yetmezliğinde ikiye katlanır", () => {
    expect(apacheCreatininePoints(2.5, false)).toBe(3);
    expect(apacheCreatininePoints(2.5, true)).toBe(6);
    expect(apacheCreatininePoints(1.0, false)).toBe(0);
  });
  it("oksijenlenme FiO2'ye göre A-aDO2 veya PaO2 kullanır", () => {
    expect(apacheOxyPoints({ fio2: 0.6, aado2: 400 })).toBe(3);
    expect(apacheOxyPoints({ fio2: 0.3, pao2: 90 })).toBe(0);
    expect(apacheOxyPoints({ fio2: 0.3, pao2: 54 })).toBe(4);
  });
});

describe("APACHE II — tam hesap", () => {
  it("normal fizyolojiyle sadece yaş puanı", () => {
    const r = computeApacheII({
      temp: 37, map: 90, hr: 80, rr: 16, oxygenation: { fio2: 0.3, pao2: 90 },
      ph: 7.4, na: 140, k: 4.0, creatinine: 1.0, hct: 40, wbc: 8, gcs: 15, age: 50,
      chronicHealth: "none",
    });
    expect(r.aps).toBe(0);
    expect(r.agePoints).toBe(2);
    expect(r.score).toBe(2);
    expect(r.missing).toHaveLength(0);
    expect(r.key).toBe("APACHE2");
  });
  it("kritik hasta yüksek skor ve mortalite", () => {
    const r = computeApacheII({
      temp: 39.5, map: 45, hr: 145, rr: 36, oxygenation: { fio2: 0.6, aado2: 400 },
      ph: 7.2, na: 155, k: 6.5, creatinine: 2.5, acuteRenalFailure: true,
      hct: 55, wbc: 25, gcs: 10, age: 70, chronicHealth: "emergency",
    });
    // APS 39 + yaş 5 + kronik 5 = 49
    expect(r.aps).toBe(39);
    expect(r.score).toBe(49);
    expect(r.mortality).toBeGreaterThan(90);
  });
  it("eksik alanlar missing listesinde raporlanır", () => {
    const r = computeApacheII({ temp: 37, age: 60 });
    expect(r.missing).toContain("map");
    expect(r.missing).toContain("wbc");
    expect(r.missing).not.toContain("temp");
  });
});

describe("SOFA", () => {
  it("solunum ventilasyona duyarlı", () => {
    expect(sofaRespPoints(150, true)).toBe(3);
    expect(sofaRespPoints(150, false)).toBe(2);
    expect(sofaRespPoints(450, false)).toBe(0);
  });
  it("trombosit eşikleri", () => {
    expect(sofaPlateletPoints(200)).toBe(0);
    expect(sofaPlateletPoints(40)).toBe(3);
    expect(sofaPlateletPoints(10)).toBe(4);
  });
  it("tam hesap", () => {
    const r = computeSofa({
      pfRatio: 150, ventilated: true, platelets: 40, bilirubin: 7,
      cardioLevel: 3, gcs: 10, creatinine: 3,
    });
    expect(r.score).toBe(16);
    expect(r.max).toBe(24);
  });
  it("normal değerlerde 0", () => {
    const r = computeSofa({ pfRatio: 450, platelets: 200, bilirubin: 0.5, cardioLevel: 0, gcs: 15, creatinine: 1 });
    expect(r.score).toBe(0);
  });
});

describe("MODS", () => {
  it("PAR hr/cvp/map'ten hesaplanır", () => {
    expect(modsCardioPoints(24)).toBe(3);
    const r = computeMods({ pfRatio: 200, creatinine: 300, bilirubin: 100, hr: 120, cvp: 12, map: 60, platelets: 60, gcs: 12 });
    expect(r.par).toBe(24);
    expect(r.score).toBe(13);
  });
  it("normal değerlerde 0", () => {
    const r = computeMods({ pfRatio: 400, creatinine: 80, bilirubin: 15, par: 8, platelets: 150, gcs: 15 });
    expect(r.score).toBe(0);
  });
});

describe("PRISM III", () => {
  it("yaş grubu sınıflandırması", () => {
    expect(prismAgeGroup(10)).toBe("neonate");
    expect(prismAgeGroup(400)).toBe("infant");
    expect(prismAgeGroup(3000)).toBe("child");
    expect(prismAgeGroup(5000)).toBe("adolescent");
  });
  it("yaşa göre katmanlı SBP ve HR", () => {
    expect(prismSbpPoints(50, "child")).toBe(7);
    expect(prismSbpPoints(70, "child")).toBe(3);
    expect(prismHrPoints(210, "child")).toBe(4);
  });
  it("tam hesap", () => {
    const r = computePrismIII({ ageDays: 3000, sbp: 50, hr: 210, temp: 41, gcs: 7, pupils: "both" });
    // sbp7 + hr4 + temp3 + mental5 + pupils11 = 30
    expect(r.score).toBe(30);
    expect(r.ageGroup).toBe("child");
    expect(r.mortality).toBeGreaterThan(80);
  });
});

describe("SNAPPE-II", () => {
  it("alt puanlar", () => {
    expect(snapMapPoints(25)).toBe(9);
    expect(snapPfPoints(0.8)).toBe(16);
  });
  it("tam hesap SNAP-II + perinatal", () => {
    const r = computeSnappeII({
      map: 25, temp: 34, pfRatio: 0.8, ph: 7.05, multiSeizure: true, urineOutput: 0.05,
      birthWeight: 700, sga: true, apgar: 5,
    });
    expect(r.snap2).toBe(93);
    expect(r.score).toBe(140);
    expect(r.max).toBe(162);
  });
});

describe("Ünite tipine göre skor seçimi", () => {
  it("erişkin YBÜ APACHE/SOFA/MODS", () => {
    expect(scoresForUnitType("ADULT_ICU")).toEqual(["APACHE2", "SOFA", "MODS"]);
  });
  it("PICU PRISM, NICU SNAPPE", () => {
    expect(scoresForUnitType("PICU")).toContain("PRISM3");
    expect(scoresForUnitType("NICU")).toEqual(["SNAPPE2"]);
  });
  it("bilinmeyen tip erişkin varsayılanına düşer", () => {
    expect(scoresForUnitType("BILINMEYEN")).toEqual(["APACHE2", "SOFA", "MODS"]);
  });
  it("SCORE_DEFS tüm skorları içerir", () => {
    expect(Object.keys(SCORE_DEFS)).toEqual(["APACHE2", "SOFA", "MODS", "PRISM3", "SNAPPE2"]);
    expect(typeof SCORE_DEFS.APACHE2.compute).toBe("function");
  });
});
