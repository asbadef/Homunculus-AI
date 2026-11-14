import { describe, it, expect } from "vitest";
import { withEmptyUnits } from "./BedsScreen.jsx";

const index = (units) => ({ units: new Map(units.map((u) => [u.id, { isActive: true, ...u }])) });

describe("the board's units in the hospital's order (Tur 1)", () => {
  it("orders by the unit's code, then its floor, whatever the patients — the group without a unit last", () => {
    const idx = index([
      { id: "rea", code: "2411", floor: 4 }, { id: "aci", code: "1101", floor: 0 },
      { id: "dax", code: "2201", floor: 2 }, { id: "old", code: null, floor: null },
    ]);
    const groups = [{ unitId: "rea", items: [{}] }, { unitId: null, items: [{}] }];
    expect(withEmptyUnits(groups, idx).map((g) => g.unitId)).toEqual(["aci", "dax", "rea", "old", null]);
  });

  it("keeps the order units came in when none has a code or a floor", () => {
    const idx = index([{ id: "b" }, { id: "a" }]);
    expect(withEmptyUnits([{ unitId: "b", items: [{}] }], idx).map((g) => g.unitId)).toEqual(["b", "a"]);
  });
});
