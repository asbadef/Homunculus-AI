/**
 * RRT kuyruğu: hızlı yanıt ekibi neye bakar.
 *
 * RRT'ye bir alarm ulaştığında iki kademe zaten geçilmiştir — hemşire ve hekim cevap verememiş
 * demektir. O yüzden bu listede tek sıralama ölçüsü **cevapsız geçen süre**dir; "en yeni" diye
 * bir öncelik yoktur. Ve liste boş diye ekip boşta değildir: 10. dakikayı doldurmak üzere olan
 * alarmlar birazdan onun olacak.
 */
import { describe, it, expect } from "vitest";
import { rrtQueue, reachedRrt, wasManual } from "./rrtQueue.js";
import { ESCALATION_STEP, TIER } from "./clinicalDemo.js";

const RRT = ESCALATION_STEP.TIER_3_RRT;

function alert(id, over = {}) {
  return { id, bedLabel: id, tier: TIER.CRITICAL, status: "FIRED", firedAtSec: 0,
           currentStep: ESCALATION_STEP.NONE, events: [], ...over };
}
const atRrt = (id, firedAtSec, extra = {}) =>
  alert(id, { firedAtSec, currentStep: RRT, events: [{ step: RRT, atSec: firedAtSec + 600 }], ...extra });

describe("RRT'ye ulaşma", () => {
  it("süreyle ulaşan alarm sayılır", () => {
    expect(reachedRrt(atRrt("101", 0))).toBe(true);
  });
  it("elle çağrılan alarm da sayılır ve elle olduğu görünür", () => {
    const a = alert("102", { currentStep: RRT, events: [{ step: RRT, atSec: 30, manual: true }] });
    expect(reachedRrt(a)).toBe(true);
    expect(wasManual(a)).toBe(true);
  });
  it("hekim kademesinde duran alarm RRT'nin değildir", () => {
    const a = alert("103", { currentStep: ESCALATION_STEP.TIER_2_PHYSICIAN,
                             events: [{ step: ESCALATION_STEP.TIER_2_PHYSICIAN, atSec: 300 }] });
    expect(reachedRrt(a)).toBe(false);
    expect(wasManual(a)).toBe(false);
  });
  it("boş girdi çökmez", () => {
    expect(reachedRrt(null)).toBe(false);
    expect(wasManual(undefined)).toBe(false);
  });
});

describe("kuyruk", () => {
  const state = {
    clockSec: 1000,
    alerts: [
      atRrt("101", 300),                             // 700 sn cevapsız
      atRrt("105", 0),                               // 1000 sn cevapsız — en uzun
      atRrt("110", 200, { status: "ACKNOWLEDGED" }), // cevaplanmış
      alert("202", { firedAtSec: 800 }),             // yolda: 400 sn kalmış
      alert("203", { firedAtSec: 500 }),             // yolda: 100 sn kalmış
      alert("204", { firedAtSec: 900, tier: TIER.MEDIUM }), // eskale olmaz
      atRrt("999", 0, { status: "CLOSED" }),         // kapanmış
    ],
  };

  it("en uzun cevapsız kalan başa gelir", () => {
    const q = rrtQueue(state);
    expect(q.open.map((x) => x.alert.id)).toEqual(["105", "101"]);
    expect(q.open[0].elapsed).toBe(1000);
  });

  it("cevaplanan alarm listeden düşmez, ayrı bölümde durur", () => {
    const q = rrtQueue(state);
    expect(q.handled.map((x) => x.alert.id)).toEqual(["110"]);
    expect(q.total).toBe(3);
  });

  it("kapanmış alarm kuyruğa girmez", () => {
    const q = rrtQueue(state);
    expect([...q.open, ...q.handled].some((x) => x.alert.id === "999")).toBe(false);
  });

  it("yolda olanlar 3. kademeye kalan süreye göre sıralanır", () => {
    const q = rrtQueue(state);
    expect(q.incoming.map((x) => x.alert.id)).toEqual(["203", "202"]);
    expect(q.incoming[0].etaSec).toBe(100);
  });

  it("eskale olmayan tier yolda listesine girmez", () => {
    // MEDIUM alarm hiçbir zaman RRT'ye ulaşmaz; "birazdan sende" demek yanlış olur.
    expect(rrtQueue(state).incoming.some((x) => x.alert.id === "204")).toBe(false);
  });

  it("RRT'ye ulaşmış alarm ayrıca yolda görünmez", () => {
    const q = rrtQueue(state);
    expect(q.incoming.some((x) => reachedRrt(x.alert))).toBe(false);
  });

  it("boş durum çökmez", () => {
    const q = rrtQueue({});
    expect(q.open).toEqual([]);
    expect(q.incoming).toEqual([]);
    expect(q.total).toBe(0);
  });
});
