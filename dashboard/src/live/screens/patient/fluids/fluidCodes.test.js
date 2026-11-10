// src/live/screens/patient/fluids/fluidCodes.test.js — the ledger's eight codes as the door knows them (G3-03 D2).
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../../i18n/catalog.js";
import { LANG_CODES } from "../../../i18n/langs.js";
import { FLUID_CODES, INTAKE, OUTPUT, boundOf, hourTotals, isFluidCode, labelKey, mlText, signedMlText } from "./fluidCodes.js";

describe("the fluid codes", () => {
  it("lists the intake and the output in the server's order, eight in all", () => {
    expect(INTAKE).toEqual(["iv_fluid_ml", "crystalloid_bolus_ml", "enteral_ml", "blood_product_ml", "other_intake_ml"]);
    expect(OUTPUT).toEqual(["urine_output_ml", "drain_output_ml", "other_output_ml"]);
    expect(FLUID_CODES).toEqual([...INTAKE, ...OUTPUT]);
    expect(isFluidCode("drain_output_ml")).toBe(true);
    expect(isFluidCode("weight_kg")).toBe(false);
  });

  it("bounds each entry as the door does: the bolus 0–10000 mL (G2-A3), the rest 0–5000 mL", () => {
    expect(boundOf("crystalloid_bolus_ml")).toBe(10000);
    for (const code of FLUID_CODES.filter((c) => c !== "crystalloid_bolus_ml")) expect(boundOf(code), code).toBe(5000);
  });

  it("names every code in every language", () => {
    for (const lang of LANG_CODES) {
      for (const code of FLUID_CODES) expect(DICTIONARIES[lang][labelKey(code)], `${lang} ${code}`).toBeTruthy();
    }
  });

  it("writes a volume in the reader's decimal and a balance with its sign; it rounds nothing it was not sent", () => {
    expect(mlText("az", 1250)).toBe("1250");
    expect(mlText("az", 12.5)).toBe("12,5");
    expect(mlText("en", 12.5)).toBe("12.5");
    expect(mlText("tr", 0.1 + 0.2)).toBe("0,3");        // float noise from the JSON sum, not a new number
    expect(mlText("tr", null)).toBe("—");
    expect(signedMlText("tr", 430)).toBe("+430");
    expect(signedMlText("tr", -200)).toBe("−200");
    expect(signedMlText("tr", 0)).toBe("0");
  });

  it("an hour's bar is the engine's per-code volumes laid end to end (display only)", () => {
    expect(hourTotals({ in: { iv_fluid_ml: 250, enteral_ml: 100 }, out: { urine_output_ml: 120 } })).toEqual({ in: 350, out: 120 });
    expect(hourTotals({})).toEqual({ in: 0, out: 0 });
  });
});
