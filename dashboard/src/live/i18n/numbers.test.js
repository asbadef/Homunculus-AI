// A number as the active language writes it: the decimal comma for tr, az and ru, the point for en (G3-01).
import { describe, it, expect } from "vitest";
import { numberText } from "./numbers.js";
import { LANG_CODES } from "./langs.js";

describe("numberText", () => {
  it("writes the decimal comma in Turkish, Azerbaijani and Russian, and the point in English", () => {
    expect(numberText("tr", 36.8)).toBe("36,8");
    expect(numberText("az", 36.8)).toBe("36,8");
    expect(numberText("ru", 36.8)).toBe("36,8");
    expect(numberText("en", 36.8)).toBe("36.8");
  });

  it("leaves a whole number as it is, and a language it does not know on the point", () => {
    for (const lang of LANG_CODES) expect(numberText(lang, 91)).toBe("91");
    expect(numberText("xx", 36.8)).toBe("36.8");
    expect(numberText("tr", "36.5")).toBe("36,5");
    expect(numberText("tr", -0.5)).toBe("-0,5");
  });
});
