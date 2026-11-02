// The bedside form's inputs and rules, without a screen (G3-01, D2, D4, D6, D7, X9, X12).
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { LANG_CODES } from "../../i18n/langs.js";
import { createTranslator } from "../../i18n/translate.js";
import {
  BACKDATE_MS, NEWS2_PARAMETERS, SKEW_MS, VITALS, birthYearOf, checkDraft, checkVital, draftKey, hasErrors, isBedsideCode,
  lastMeasuredMs, oldestInput, specOf, stepValue, toLocalInput, valueText,
} from "./vitalsFields.js";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const SKEW = 60_000;                      // the module's minute of clock skew
// A touched time as the form holds it: the `datetime-local` value, in this browser's zone.
const at = (ms) => ({ values: { spo2: "95" }, at: toLocalInput(ms), atTouched: true });

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

  // X22: the engine withdraws only these eight; the trend table offers «hatalı giriş» by this.
  it("name the bedside set, and no other channel is in it", () => {
    for (const code of ["resp_rate", "spo2", "supplemental_oxygen", "sbp", "map", "heart_rate", "acvpu", "temperature"]) {
      expect(isBedsideCode(code), code).toBe(true);
    }
    for (const code of ["lactate", "weight_kg", "crystalloid_bolus_ml", "constructor", ""]) expect(isBedsideCode(code), code).toBe(false);
  });

  it("say a sent value with the language's own decimal separator, and as the engine wrote it with none", () => {
    const t = createTranslator("tr", DICTIONARIES);
    expect(valueText(t, "temperature", 36.8, "tr")).toBe("36,8 °C");
    expect(valueText(t, "temperature", 36.8, "az")).toBe("36,8 °C");
    expect(valueText(t, "temperature", 36.8, "en")).toBe("36.8 °C");
    expect(valueText(t, "temperature", 36.8)).toBe("36.8 °C");
    expect(valueText(t, "spo2", 91, "tr")).toBe("91 %");
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

  // The edges themselves: a `<` written as `<=` (or `>` as `>=`) must fail one of these (G3-01 review).
  it("takes the high bound itself and refuses the next value", () => {
    const high = { key: "olcum.outOfRange" };
    expect(checkVital(specOf("heart_rate"), "300")).toEqual({ value: 300 });
    expect(checkVital(specOf("heart_rate"), "301").error).toMatchObject(high);
    expect(checkVital(specOf("spo2"), "100")).toEqual({ value: 100 });
    expect(checkVital(specOf("spo2"), "101").error).toMatchObject(high);
    expect(checkVital(specOf("temperature"), "45")).toEqual({ value: 45 });
    expect(checkVital(specOf("temperature"), "45,1").error).toMatchObject(high);
  });

  it("takes the low bound itself and refuses the value below it", () => {
    expect(checkVital(specOf("temperature"), "25")).toEqual({ value: 25 });
    expect(checkVital(specOf("temperature"), "24,9").error).toMatchObject({ key: "olcum.outOfRange", params: { low: 25, high: 45 } });
    expect(checkVital(specOf("resp_rate"), "0")).toEqual({ value: 0 });
  });

  it("reads a typed number strictly: no sign, no bare trailing point, spaces trimmed", () => {
    expect(checkVital(specOf("resp_rate"), "-1").error.key).toBe("olcum.notNumber");
    expect(checkVital(specOf("resp_rate"), "26.").error.key).toBe("olcum.notNumber");
    expect(checkVital(specOf("resp_rate"), " 26 ")).toEqual({ value: 26 });
  });

  it("counts decimals by value: a trailing zero is not a second decimal", () => {
    expect(checkVital(specOf("temperature"), "36,50")).toEqual({ value: 36.5 });
    expect(checkVital(specOf("temperature"), "36.80")).toEqual({ value: 36.8 });
    expect(checkVital(specOf("temperature"), "45.00")).toEqual({ value: 45 });
    expect(checkVital(specOf("temperature"), "36,85").error.key).toBe("olcum.oneDecimal");
    expect(checkVital(specOf("temperature"), "36.05").error.key).toBe("olcum.oneDecimal");
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

  it("takes MAP only below the systolic: equal is refused, one below is not (D6)", () => {
    expect(checkDraft({ values: { sbp: "90", map: "90" } }, NOW).errors).toEqual({ map: { key: "olcum.mapAboveSbp" } });
    expect(checkDraft({ values: { sbp: "90", map: "89" } }, NOW).errors).toEqual({});
  });

  it("takes a typed time up to a day back and never ahead (D7)", () => {
    expect(checkDraft(at(NOW - 60 * 60_000), NOW).recordedAt).toBe(new Date(Math.floor((NOW - 60 * 60_000) / 60_000) * 60_000).toISOString());
    expect(checkDraft(at(NOW + 10 * 60_000), NOW).errors.at).toEqual({ key: "olcum.atFuture" });
    expect(checkDraft(at(NOW - BACKDATE_MS - 2 * 60_000), NOW).errors.at).toEqual({ key: "olcum.atTooOld" });
    expect(checkDraft({ values: { spo2: "95" }, at: "", atTouched: true }, NOW).errors.at).toEqual({ key: "olcum.atInvalid" });
  });

  it("allows a minute of clock skew ahead and no more", () => {
    const edge = checkDraft(at(NOW + SKEW), NOW);
    expect(edge.errors).toEqual({});
    expect(edge.recordedAt).toBe(new Date(NOW + SKEW).toISOString());
    expect(checkDraft(at(NOW + 2 * SKEW), NOW).errors.at).toEqual({ key: "olcum.atFuture" });
  });

  it("holds the day-back edge a minute inside the server's, so the browser is the stricter side (D7)", () => {
    // The server refuses a time older than 24 h by ITS clock, a minute of skew from this one: the oldest this
    // form sends is 24 h back plus that minute, never the edge itself.
    const oldest = checkDraft(at(NOW - BACKDATE_MS + SKEW), NOW);
    expect(oldest.errors).toEqual({});
    expect(oldest.recordedAt).toBe(new Date(NOW - BACKDATE_MS + SKEW).toISOString());
    expect(checkDraft(at(NOW - BACKDATE_MS), NOW).errors.at).toEqual({ key: "olcum.atTooOld" });
  });

  // Review of Task 12: the time box's native `min` and checkDraft's edge are one line. On a clock that is on a minute
  // the box's minimum IS the edge; between two minutes it is the first minute the check takes (the one below is refused).
  it("offers the time box a minimum that checkDraft takes, and a minute below it is refused (D7)", () => {
    expect(SKEW_MS).toBe(SKEW);
    expect(oldestInput(NOW)).toBe(toLocalInput(NOW - BACKDATE_MS + SKEW));
    for (const now of [NOW, NOW + 1_000, NOW + 30_000, NOW + 59_999]) {
      const min = oldestInput(now);
      const minMs = new Date(min).getTime();                  // a `datetime-local` value is read as the zone's own time
      expect(minMs).toBeGreaterThanOrEqual(now - BACKDATE_MS + SKEW);
      expect(minMs - (now - BACKDATE_MS + SKEW)).toBeLessThan(60_000);
      expect(checkDraft({ values: { spo2: "95" }, at: min, atTouched: true }, now).errors, `${min} at ${now}`).toEqual({});
      expect(checkDraft(at(minMs - 60_000), now).errors.at, `${min} at ${now}`).toEqual({ key: "olcum.atTooOld" });
    }
  });

  it("reads the browser's own clock when no `now` is given", () => {
    expect(checkDraft(at(Date.now() + 60 * 60_000)).errors.at).toEqual({ key: "olcum.atFuture" });
    expect(checkDraft(at(Date.now() - 60 * 60_000)).errors).toEqual({});
  });

  it("every refusal the rules return is worded in all four languages", () => {
    const rr = specOf("resp_rate");
    const returned = [
      checkVital(rr, "abc").error, checkVital(rr, "26,5").error, checkVital(specOf("temperature"), "36,85").error,
      checkVital(rr, "81").error,
      ...Object.values(checkDraft({ values: { sbp: "90", map: "95" } }, NOW).errors),
      ...Object.values(checkDraft({ values: {} }, NOW).errors),
      ...Object.values(checkDraft({ ...at(NOW), at: "" }, NOW).errors),
      ...Object.values(checkDraft(at(NOW + 2 * SKEW), NOW).errors),
      ...Object.values(checkDraft(at(NOW - BACKDATE_MS), NOW).errors),
    ];
    const keys = [...new Set(returned.map((e) => e.key))].sort();
    expect(keys).toEqual(["olcum.atFuture", "olcum.atInvalid", "olcum.atTooOld", "olcum.mapAboveSbp", "olcum.notNumber",
      "olcum.notWhole", "olcum.nothing", "olcum.oneDecimal", "olcum.outOfRange"]);
    for (const key of keys) for (const lang of LANG_CODES) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
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

  it("step a choice never: there is no number to move (a choice has no step)", () => {
    expect(stepValue(specOf("acvpu"), "2", 1)).toBeNull();
    expect(stepValue(specOf("supplemental_oxygen"), "0", -1)).toBeNull();
  });

  it("step a whole vital from a half to the next whole number in the direction pressed", () => {
    expect(stepValue(specOf("resp_rate"), "26,5", 1)).toBe("27");
    expect(stepValue(specOf("resp_rate"), "26,5", -1)).toBe("26");
    expect(stepValue(specOf("resp_rate"), "26", -1)).toBe("25");
    expect(stepValue(specOf("resp_rate"), "80", 1)).toBe("80");
    expect(stepValue(specOf("resp_rate"), "0,5", -1)).toBe("0");
  });

  it("read the year of a birth date and the last NEWS2 measurement (X9)", () => {
    expect(birthYearOf("1970-05-05")).toBe("1970");
    expect(birthYearOf(null)).toBeNull();
    expect(lastMeasuredMs({ news2: { measured_at: { spo2: "2026-11-02T08:00:00Z", pulse: "2026-11-02T09:00:00Z", temperature: null } } }))
      .toBe(Date.parse("2026-11-02T09:00:00Z"));
    expect(lastMeasuredMs({ news2: null })).toBeNull();
  });
});
