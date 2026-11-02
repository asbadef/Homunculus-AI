// The bedside form's inputs and rules, without a screen (G3-01, D2, D4, D6, D7, X9, X12).
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import {
  BACKDATE_MS, NEWS2_PARAMETERS, VITALS, birthYearOf, checkDraft, checkVital, draftKey, hasErrors, lastMeasuredMs,
  specOf, stepValue, toLocalInput,
} from "./vitalsFields.js";

const NOW = Date.parse("2026-11-02T10:00:00Z");

describe("the inputs", () => {
  it("are the prototype's eight, in its order, each label and unit in every language", () => {
    expect(VITALS.map((s) => s.code)).toEqual(
      ["resp_rate", "spo2", "supplemental_oxygen", "sbp", "map", "heart_rate", "acvpu", "temperature"]);
    for (const spec of VITALS) {
      const keys = [spec.labelKey, spec.unitKey, ...(spec.options ?? []).map((o) => o.labelKey)].filter(Boolean);
      for (const key of keys) for (const lang of LANG_CODES) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
    }
    for (const p of NEWS2_PARAMETERS) {
      expect(DICTIONARIES.az[p.labelKey], p.name).toBeTruthy();
      if (p.missingKey) expect(DICTIONARIES.az[p.missingKey], p.name).toBeTruthy();
    }
    expect(NEWS2_PARAMETERS.filter((p) => p.missingKey).map((p) => p.name))
      .toEqual(["respiration_rate", "spo2", "systolic_bp", "pulse", "temperature"]);
  });

  it("mirror the door's slip bounds", () => {
    expect([specOf("resp_rate").min, specOf("resp_rate").max]).toEqual([0, 80]);
    expect([specOf("spo2").min, specOf("spo2").max]).toEqual([0, 100]);
    expect([specOf("sbp").max, specOf("map").max, specOf("heart_rate").max]).toEqual([300, 300, 300]);
    expect([specOf("temperature").min, specOf("temperature").max]).toEqual([25, 45]);
    expect(specOf("constructor")).toBeNull();
  });
});

describe("one value", () => {
  it("an empty box is not measured and is not sent (D4)", () => {
    expect(checkVital(specOf("resp_rate"), "")).toEqual({ skip: true });
    expect(checkVital(specOf("acvpu"), "")).toEqual({ skip: true });
  });

  it("a counted vital is whole; a temperature takes one decimal, with a comma too", () => {
    expect(checkVital(specOf("resp_rate"), "26")).toEqual({ value: 26 });
    expect(checkVital(specOf("resp_rate"), "26,5").error.key).toBe("olcum.notWhole");
    expect(checkVital(specOf("temperature"), "36,8")).toEqual({ value: 36.8 });
    expect(checkVital(specOf("temperature"), "36,85").error.key).toBe("olcum.oneDecimal");
    expect(checkVital(specOf("spo2"), "abc").error.key).toBe("olcum.notNumber");
  });

  it("a slipped digit is held back with the bounds in the sentence", () => {
    expect(checkVital(specOf("heart_rate"), "800").error).toEqual({ key: "olcum.outOfRange", params: { low: 0, high: 300 } });
  });

  it("a choice takes one of its values", () => {
    expect(checkVital(specOf("supplemental_oxygen"), "1")).toEqual({ value: 1 });
    expect(checkVital(specOf("acvpu"), "4")).toEqual({ value: 4 });
    expect(checkVital(specOf("acvpu"), "9").error.key).toBe("olcum.notNumber");
  });
});

describe("the draft", () => {
  it("sends only what was entered, in the inputs' order, with no time when it was not touched (X12)", () => {
    const checked = checkDraft({ values: { spo2: "91", resp_rate: "26", acvpu: "" } }, NOW);
    expect(checked).toEqual({ entries: [{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }], recordedAt: null, errors: {} });
    expect(hasErrors(checked)).toBe(false);
  });

  it("asks for at least one value", () => {
    expect(checkDraft({ values: {} }, NOW).errors).toEqual({ form: { key: "olcum.nothing" } });
  });

  it("holds MAP below the systolic in one form (D6)", () => {
    expect(checkDraft({ values: { sbp: "90", map: "95" } }, NOW).errors.map).toEqual({ key: "olcum.mapAboveSbp" });
    expect(checkDraft({ values: { sbp: "90", map: "65" } }, NOW).errors).toEqual({});
  });

  it("takes a typed time up to a day back and never ahead (D7)", () => {
    const at = (ms) => ({ values: { spo2: "95" }, at: toLocalInput(ms), atTouched: true });
    expect(checkDraft(at(NOW - 60 * 60_000), NOW).recordedAt).toBe(new Date(Math.floor((NOW - 60 * 60_000) / 60_000) * 60_000).toISOString());
    expect(checkDraft(at(NOW + 10 * 60_000), NOW).errors.at).toEqual({ key: "olcum.atFuture" });
    expect(checkDraft(at(NOW - BACKDATE_MS - 2 * 60_000), NOW).errors.at).toEqual({ key: "olcum.atTooOld" });
    expect(checkDraft({ values: { spo2: "95" }, at: "", atTouched: true }, NOW).errors.at).toEqual({ key: "olcum.atInvalid" });
  });

  it("keys a draft by what it would send", () => {
    const a = checkDraft({ values: { spo2: "95" } }, NOW);
    const b = checkDraft({ values: { spo2: "95,0" } }, NOW);
    expect(draftKey(a)).toBe(draftKey(b));
    expect(draftKey(a)).not.toBe(draftKey(checkDraft({ values: { spo2: "96" } }, NOW)));
  });
});

describe("the helpers", () => {
  it("step a value inside its bounds, and nothing from an empty box", () => {
    expect(stepValue(specOf("resp_rate"), "26", 1)).toBe("27");
    expect(stepValue(specOf("spo2"), "100", 1)).toBe("100");
    expect(stepValue(specOf("temperature"), "36,8", 1)).toBe("36.9");
    expect(stepValue(specOf("heart_rate"), "", 1)).toBeNull();
  });

  it("read the year of a birth date and the last NEWS2 measurement (X9)", () => {
    expect(birthYearOf("1970-05-05")).toBe("1970");
    expect(birthYearOf(null)).toBeNull();
    expect(lastMeasuredMs({ news2: { measured_at: { spo2: "2026-11-02T08:00:00Z", pulse: "2026-11-02T09:00:00Z", temperature: null } } }))
      .toBe(Date.parse("2026-11-02T09:00:00Z"));
    expect(lastMeasuredMs({ news2: null })).toBeNull();
  });
});
