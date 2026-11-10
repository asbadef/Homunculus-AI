// src/live/screens/patient/fluids/fluidCodes.test.js — the ledger's eight codes as the door knows them (G3-03 D2).
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../../i18n/catalog.js";
import { LANG_CODES } from "../../../i18n/langs.js";
import { toLocalInput } from "../meds/medsFields.js";
import { FLUID_CODES, INTAKE, OUTPUT, boundOf, checkRow, groupByTime, hourTotals, isFluidCode, labelKey, mlText, signedMlText } from "./fluidCodes.js";

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

describe("a dialog row, checked as the door would", () => {
  const NOW_MS = Date.parse("2026-10-08T10:00:00Z");
  const row = (over = {}) => ({ code: "urine_output_ml", ml: "120", at: toLocalInput(NOW_MS), ...over });

  it("sends a plain decimal with at most one place, a comma read as a point, at the row's own minute", () => {
    expect(checkRow(row(), NOW_MS)).toEqual({ errors: {}, entry: { code: "urine_output_ml", value: 120 }, atIso: "2026-10-08T10:00:00.000Z" });
    expect(checkRow(row({ ml: "12,5" }), NOW_MS).entry).toEqual({ code: "urine_output_ml", value: 12.5 });
    expect(checkRow(row({ ml: "0" }), NOW_MS).entry).toEqual({ code: "urine_output_ml", value: 0 });
  });

  it("holds back an empty, a negative, a two-place or an out-of-bounds volume, naming the code's own ceiling", () => {
    for (const ml of ["", "-1", "12.55", "abc", "5001"]) {
      expect(checkRow(row({ ml }), NOW_MS).errors.ml, ml).toEqual({ key: "sivi.invalidMl", params: { max: 5000 } });
    }
    expect(checkRow(row({ code: "crystalloid_bolus_ml", ml: "10000" }), NOW_MS).errors).toEqual({});
    expect(checkRow(row({ code: "crystalloid_bolus_ml", ml: "10001" }), NOW_MS).errors.ml).toEqual({ key: "sivi.invalidMl", params: { max: 10000 } });
  });

  it("holds back a time more than 24 hours back, ahead of the clock, or not a time at all", () => {
    const H = 3_600_000;
    expect(checkRow(row({ at: toLocalInput(NOW_MS - 23 * H) }), NOW_MS).errors).toEqual({});
    for (const at of [toLocalInput(NOW_MS - 25 * H), toLocalInput(NOW_MS + 10 * 60_000), "", "dün"]) {
      expect(checkRow(row({ at }), NOW_MS).errors.at, at).toEqual({ key: "sivi.invalidAt" });
    }
  });

  it("groups the rows by their time, in the order they were written: one request per distinct time", () => {
    const a = { entry: { code: "urine_output_ml", value: 120 }, atIso: "2026-10-08T10:00:00.000Z" };
    const b = { entry: { code: "iv_fluid_ml", value: 250 }, atIso: "2026-10-08T08:00:00.000Z" };
    const c = { entry: { code: "drain_output_ml", value: 40 }, atIso: "2026-10-08T10:00:00.000Z" };
    expect(groupByTime([a, b, c])).toEqual([
      { atIso: a.atIso, entries: [a.entry, c.entry], rows: [0, 2] },
      { atIso: b.atIso, entries: [b.entry], rows: [1] },
    ]);
  });
});
