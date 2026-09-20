/**
 * Alarm yoğunluğu: hangi yatak, hangi saat.
 *
 * Eski ısı haritası "şu an kim kötü" diyordu — yatak paneli bunu zaten söylüyor. Yöneticinin
 * sorusu başka: alarm nerede birikiyor. Sürekli öten bir yatak ya yanlış eşikle izleniyordur ya
 * da gerçekten kötüleşiyordur; ikisi de zaman içinde görünür, anlık bir renkte değil.
 */
import { describe, it, expect } from "vitest";
import { alarmDensity, bedOf, intensity, hourLabel } from "./alarmDensity.js";

const H = 3600_000;
const NOW = Date.UTC(2026, 8, 21, 12, 30);   // 12:30

function fire(bed, hoursAgo, extra = {}) {
  return { id: `AL-${bed}-${hoursAgo}`, action: "ALERT_AUTO_FIRE", atMs: NOW - hoursAgo * H,
           detail: `${bed} · CRITICAL · SpO2`, ...extra };
}

describe("yatak ayrıştırma", () => {
  it("yeni kayıtlar bedLabel alanını taşır", () => {
    expect(bedOf({ bedLabel: "105", detail: "başka bir şey" })).toBe("105");
  });
  it("eski kayıtlarda serbest metnin ilk parçası yataktır", () => {
    expect(bedOf({ detail: "101 · CRITICAL · SpO2" })).toBe("101");
  });
  it("ayrıştırılamayan kayıt atılmaz, kendi kovasına düşer", () => {
    expect(bedOf({ detail: "" })).toBe("—");
    expect(bedOf(null)).toBe("—");
  });
});

describe("yoğunluk", () => {
  const log = [
    fire("101", 1), fire("101", 1), fire("101", 5),
    fire("105", 2),
    fire("202", 30),                       // pencere dışında
    { action: "ALERT_ACK", atMs: NOW - H }, // doğuş değil
  ];

  it("yalnız alarm doğuşlarını ve yalnız pencere içini sayar", () => {
    const d = alarmDensity(log, { hours: 24, now: NOW });
    expect(d.totalAlarms).toBe(4);
    expect(d.beds.map((b) => b.bed)).toEqual(["101", "105"]);
  });

  it("en çok alarm üreten yatak başa gelir", () => {
    const d = alarmDensity(log, { hours: 24, now: NOW });
    expect(d.busiestBed.bed).toBe("101");
    expect(d.busiestBed.total).toBe(3);
  });

  it("aynı saatteki iki alarm aynı hücrede toplanır", () => {
    const d = alarmDensity(log, { hours: 24, now: NOW });
    const bed101 = d.beds.find((b) => b.bed === "101");
    expect(Math.max(...bed101.cells)).toBe(2);
    expect(d.maxCell).toBe(2);
  });

  it("kayıtta hiç alarm doğuşu yoksa bunu söyler", () => {
    const d = alarmDensity([{ action: "PATIENT_ADMIT", atMs: NOW }], { hours: 24, now: NOW });
    expect(d.hasHistory).toBe(false);
    expect(d.totalAlarms).toBe(0);
    expect(d.busiestHourIx).toBeNull();
  });

  it("boş kayıt çökmez", () => {
    expect(alarmDensity(undefined, { now: NOW }).totalAlarms).toBe(0);
  });
});

describe("renk yoğunluğu", () => {
  it("hiç alarm yoksa renk yok", () => {
    expect(intensity(0, 5)).toBe(0);
  });
  it("karekök ölçek: tek alarm da görünür kalır", () => {
    // Doğrusal ölçekte 1/9 = 0.11 ile neredeyse görünmezdi.
    expect(intensity(1, 9)).toBeCloseTo(0.333, 2);
    expect(intensity(9, 9)).toBe(1);
  });
});

describe("saat etiketi", () => {
  it("saat dilimini okunur yazar", () => {
    const ix = Math.floor(NOW / H);
    expect(hourLabel(ix)).toMatch(/^\d{2}:00$/);
  });
});
