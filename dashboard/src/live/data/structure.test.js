// The ward's structure, read (Group 2 · B1a): every unit and bed by name, never by UUID, and only
// an open, AVAILABLE bed offered to an admission.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../i18n/catalog.js";
import { createTranslator } from "../i18n/translate.js";
import { admissible, bedLabel, indexStructure, isUuid, unavailableKey, unitLabel } from "./structure.js";
import { BED, NEO, REA, structure } from "../screens/kabul/kabul.testutil.js";

const az = createTranslator("az", DICTIONARIES);

describe("the structure's index", () => {
  const index = indexStructure(structure());

  it("finds every unit, room and bed with its parents' names", () => {
    expect(index.units.get(REA)).toMatchObject({ name: "Reanimasiya", unitType: "ADULT_ICU", isActive: true, siteName: "Ana bina" });
    expect(index.beds.get(BED(5))).toMatchObject({ label: "5", roomName: "Otaq 2", unitName: "Reanimasiya", open: true });
    expect(index.beds.size).toBe(6);
  });

  it("finds an id whatever its case, as the engine compares ids", () => {
    expect(index.units.get(REA.toUpperCase().toLowerCase())).toBeDefined();
    expect(unitLabel(az, index, REA.toUpperCase())).toBe("Reanimasiya");
  });

  it("calls a bed open only when it, its room and its unit are open", () => {
    expect(index.beds.get(BED(4)).open).toBe(false);          // the bed is closed
    expect(index.beds.get(BED(6)).open).toBe(false);          // its unit is closed
    expect(index.beds.get(BED(1)).open).toBe(true);
  });

  it("is empty for an answer that is not a tree", () => {
    for (const answer of [null, undefined, {}, { sites: "x" }]) expect(indexStructure(answer).beds.size).toBe(0);
  });
});

describe("a unit's name", () => {
  const index = indexStructure(structure());

  it("is the structure's name", () => {
    expect(unitLabel(az, index, NEO)).toBe("Neonatal");
  });

  it("is never a UUID: an id the tree does not hold reads «unknown unit»", () => {
    const label = unitLabel(az, index, "99999999-9999-4999-8999-999999999999");
    expect(label).toBe(az("kabul.unitUnknown"));
    expect(isUuid(label)).toBe(false);
  });

  it("keeps a key someone wrote by hand (an old free-text grant): it is no UUID", () => {
    expect(unitLabel(az, index, "unit-adult")).toBe("unit-adult");
  });
});

describe("which bed an admission may take", () => {
  const index = indexStructure(structure());

  it("only an open, AVAILABLE one", () => {
    expect(admissible(index.beds.get(BED(1)))).toBe(true);
    for (const n of [2, 3, 4, 6]) expect(admissible(index.beds.get(BED(n))), n).toBe(false);
  });

  it("says why each other one is not offered, closed before its state", () => {
    expect(unavailableKey(index.beds.get(BED(1)))).toBeNull();
    expect(unavailableKey(index.beds.get(BED(2)))).toBe("kabul.state.OCCUPIED");
    expect(unavailableKey(index.beds.get(BED(3)))).toBe("kabul.state.HOUSEKEEPING");
    expect(unavailableKey(index.beds.get(BED(4)))).toBe("kabul.bedClosed");
    expect(unavailableKey(index.beds.get(BED(6)))).toBe("kabul.bedClosed");
  });

  it("names a bed by its label and its unit", () => {
    expect(bedLabel(index, BED(5))).toBe("5 · Reanimasiya");
    expect(bedLabel(index, "nope")).toBeNull();
  });
});
