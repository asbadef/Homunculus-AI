/// <reference types="jest" />
import { t } from "../src/i18n";
import { tr } from "../src/i18n/tr";

describe("t", () => {
  it("returns the catalogued string", () => {
    expect(t("tabs.patients")).toBe("Hastalar");
  });

  it("interpolates named variables", () => {
    expect(t("bed.label", { bed: "3" })).toBe("YB Yatak 3");
  });

  it("leaves an unsupplied placeholder visible rather than printing undefined", () => {
    expect(t("bed.label")).toBe("YB Yatak {bed}");
  });

  it("falls back to the key itself when a string is missing", () => {
    expect(t("nope.not.here" as never)).toBe("nope.not.here");
  });
});

describe("the catalogue", () => {
  it("has no empty strings", () => {
    for (const [key, value] of Object.entries(tr)) {
      expect(value.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
