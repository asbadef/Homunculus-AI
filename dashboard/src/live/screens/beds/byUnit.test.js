import { describe, it, expect } from "vitest";
import { byUnit, withEmptyUnits } from "./BedsScreen.jsx";

const index = (units) => ({ units: new Map(units.map((u) => [u.id, { isActive: true, ...u }])), beds: new Map() });

describe("withEmptyUnits", () => {
  const groups = [{ unitId: "u1", items: [{}] }, { unitId: null, items: [{}] }];
  const idx = index([{ id: "u1" }, { id: "u2" }, { id: "u3", isActive: false }, { id: "u4" }]);

  it("adds every active unit with no card before the unplaced group", () => {
    expect(withEmptyUnits(groups, idx).map((g) => g.unitId)).toEqual(["u1", "u2", "u4", null]);
  });

  it("adds only the units the session may see, and only the chosen one under a filter", () => {
    expect(withEmptyUnits(groups, idx, ["u1", "u4"]).map((g) => g.unitId)).toEqual(["u1", "u4", null]);
    expect(withEmptyUnits([], idx, [], "u2").map((g) => g.unitId)).toEqual(["u2"]);
  });
});

describe("byUnit", () => {
  it("keeps the given order inside each unit, units in first-seen order, the unplaced last", () => {
    const list = [
      { patient_id: "a", unitId: "u2" },
      { patient_id: "b" },
      { patient_id: "c", unitId: "u1" },
      { patient_id: "d", unitId: "u2" },
    ];
    expect(byUnit(list)).toEqual([
      { unitId: "u2", items: [list[0], list[3]] },
      { unitId: "u1", items: [list[2]] },
      { unitId: null, items: [list[1]] },
    ]);
    expect(byUnit([])).toEqual([]);
  });
});
