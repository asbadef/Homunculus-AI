import { describe, it, expect } from "vitest";
import { ORDERS, VIEWS, bedNameOf, inUnit, matching, norm, orderBeds } from "./order.js";

const bed = (id, over = {}) => ({ patient_id: id, bedLabel: id, unitId: "REA-01", risk: "none", display_name: null, ...over });

describe("orderBeds", () => {
  it("bed order compares numbers as numbers", () => {
    const list = [bed("REA-10"), bed("REA-2"), bed("REA-1")];
    expect(orderBeds(list, "yatak").map((p) => p.patient_id)).toEqual(["REA-1", "REA-2", "REA-10"]);
  });

  it("bed order groups by unit, and puts a card the bed table does not place last", () => {
    const list = [
      bed("X-1", { unitId: null }),
      bed("N-1", { unitId: "NICU-01" }),
      bed("R-1", { unitId: "REA-01" }),
    ];
    expect(orderBeds(list, "yatak").map((p) => p.patient_id)).toEqual(["N-1", "R-1", "X-1"]);
  });

  it("leaves the caller's array alone", () => {
    const list = [bed("REA-2"), bed("REA-1")];
    orderBeds(list, "yatak");
    expect(list.map((p) => p.patient_id)).toEqual(["REA-2", "REA-1"]);
  });

  it("risk order follows the engine's own severity list", () => {
    const list = [
      bed("b-none", { risk: "none" }), bed("b-info", { risk: "info" }),
      bed("b-low", { risk: "low" }), bed("b-mod", { risk: "moderate" }),
      bed("b-high", { risk: "high" }), bed("b-crit", { risk: "critical" }),
    ];
    expect(orderBeds(list, "risk").map((p) => p.patient_id))
      .toEqual(["b-crit", "b-high", "b-mod", "b-low", "b-info", "b-none"]);
  });

  it("risk order puts what it cannot vouch for ABOVE critical", () => {
    // A risk the engine did not send, or one this build does not know, may be the worst.
    const list = [bed("b-crit", { risk: "critical" }), bed("b-null", { risk: null }), bed("b-new", { risk: "extreme" })];
    const ids = orderBeds(list, "risk").map((p) => p.patient_id);
    expect(ids.indexOf("b-crit")).toBe(2);
    expect(ids.slice(0, 2).sort()).toEqual(["b-new", "b-null"]);
  });

  it("risk order breaks a tie by bed, so the list is stable within a level", () => {
    const list = [bed("REA-10", { risk: "high" }), bed("REA-2", { risk: "high" })];
    expect(orderBeds(list, "risk").map((p) => p.patient_id)).toEqual(["REA-2", "REA-10"]);
  });

  it("an unknown order is the bed order", () => {
    expect(orderBeds([bed("REA-2"), bed("REA-1")], "nonsense").map((p) => p.patient_id))
      .toEqual(["REA-1", "REA-2"]);
    expect(orderBeds(null)).toEqual([]);
  });

  it("names the two views and the two orders", () => {
    expect(VIEWS).toEqual(["kart", "liste"]);
    expect(ORDERS).toEqual(["yatak", "risk"]);
  });
});

describe("bedNameOf", () => {
  it("prefers the hospital's bed label and falls back to the feed's own id", () => {
    expect(bedNameOf({ bedLabel: "REA-01 · 2", patient_id: "S-001" })).toBe("REA-01 · 2");
    expect(bedNameOf({ bedLabel: null, patient_id: "S-001" })).toBe("S-001");
    expect(bedNameOf(null)).toBe("");
  });
});

describe("norm — matching what someone typed", () => {
  it("ignores case and diacritics", () => {
    expect(norm("Ayşe ÇAĞLA")).toBe("ayse cagla");
    expect(norm("Ünal")).toBe("unal");
  });

  it("folds the two letters the ward's keyboards disagree about", () => {
    expect(norm("Əliyev")).toBe("eliyev");
    expect(norm("Işık")).toBe("isik");
  });

  it("trims, and survives nothing at all", () => {
    expect(norm("  REA-01  ")).toBe("rea-01");
    expect(norm(null)).toBe("");
    expect(norm(undefined)).toBe("");
  });
});

describe("inUnit", () => {
  it("keeps the cards of one unit", () => {
    const list = [bed("a"), bed("b", { unitId: "NICU-01" })];
    expect(inUnit(list, "REA-01").map((p) => p.patient_id)).toEqual(["a"]);
  });

  it("no unit chosen keeps every card", () => {
    const list = [bed("a"), bed("b", { unitId: null })];
    expect(inUnit(list, null)).toHaveLength(2);
    expect(inUnit(list, "")).toHaveLength(2);
  });

  it("a card the bed table does not place is hidden by any unit filter", () => {
    expect(inUnit([bed("x", { unitId: null })], "REA-01")).toEqual([]);
  });
});

describe("matching", () => {
  it("matches a bed, an id or the HIS name", () => {
    const list = [
      bed("S-001", { bedLabel: "REA-01 · 2", display_name: "Ayşe Sentetik" }),
      bed("S-002", { bedLabel: "NICU-01 · 1", display_name: null }),
    ];
    expect(matching(list, "ayse").map((p) => p.patient_id)).toEqual(["S-001"]);
    expect(matching(list, "nicu").map((p) => p.patient_id)).toEqual(["S-002"]);
    expect(matching(list, "s-00").map((p) => p.patient_id)).toEqual(["S-001", "S-002"]);
  });

  it("an empty query matches everything", () => {
    const list = [bed("a"), bed("b")];
    expect(matching(list, "")).toHaveLength(2);
    expect(matching(list, "   ")).toHaveLength(2);
  });
});
