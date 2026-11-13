import { describe, it, expect } from "vitest";
import { byUnit } from "./BedsScreen.jsx";

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
