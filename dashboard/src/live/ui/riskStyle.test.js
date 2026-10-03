// Roadmap G1-09 acceptance: the engine's risk values are mapped explicitly — moderate amber,
// none/info neutral ("no finding / not measured") — and none of them falls back to green.
import { describe, it, expect } from "vitest";
import { riskStyle, ENGINE_RISKS } from "./riskStyle.js";
import { DICTIONARIES } from "../i18n/catalog.js";
import { LANG_CODES } from "../i18n/langs.js";

describe("riskStyle", () => {
  it.each([
    ["critical", "crit", "risk.critical"],
    ["high", "high", "risk.high"],
    ["moderate", "mid", "risk.moderate"],
    ["low", "low", "risk.low"],
    ["info", "neutral", "risk.info"],
    ["none", "neutral", "risk.none"],
  ])("maps %s to the %s tone, on a measured card", (risk, tone, labelKey) => {
    expect(riskStyle(risk, { measured: true })).toMatchObject({ tone, labelKey });
  });

  it("knows exactly the engine's six levels", () => {
    expect([...ENGINE_RISKS].sort()).toEqual(["critical", "high", "info", "low", "moderate", "none"]);
  });

  it("never falls back to green", () => {
    const anything = [...ENGINE_RISKS, "stable", "ok", "", null, undefined, "CRITICAL", 3];
    for (const risk of anything) {
      expect(riskStyle(risk).tone, String(risk)).not.toBe("ok");
      expect(riskStyle(risk, { measured: false }).tone, String(risk)).not.toBe("ok");
    }
  });

  it("says 'not measured' instead of 'no finding' when nothing was measured", () => {
    expect(riskStyle("none", { measured: false })).toMatchObject({ tone: "neutral", labelKey: "risk.unmeasured" });
    expect(riskStyle("info", { measured: false })).toMatchObject({ labelKey: "risk.unmeasured" });
  });

  // Clinical safety: an identity-only card (admitted, never measured) gets risk "none" from the
  // engine. "No finding" is a claim about observations, so only a caller that has them may make it.
  it("claims 'no finding' only when told explicitly that the card was measured", () => {
    expect(riskStyle("none")).toMatchObject({ tone: "neutral", labelKey: "risk.unmeasured" });
    expect(riskStyle("none", {})).toMatchObject({ labelKey: "risk.unmeasured" });
    expect(riskStyle("info")).toMatchObject({ labelKey: "risk.unmeasured" });
    for (const measured of [undefined, null, 1, "true", "yes", {}, []]) {
      expect(riskStyle("none", { measured }).labelKey, String(measured)).toBe("risk.unmeasured");
    }
    expect(riskStyle("none", { measured: true }).labelKey).toBe("risk.none");
  });

  it("never lets 'not measured' hide a real finding", () => {
    expect(riskStyle("high", { measured: false })).toMatchObject({ tone: "high", labelKey: "risk.high" });
    for (const risk of ["critical", "high", "moderate", "low"]) {
      expect(riskStyle(risk).labelKey, risk).toBe(`risk.${risk}`);
    }
  });

  it("keeps an unrecognised value visible, with its raw text", () => {
    expect(riskStyle("stable")).toEqual({
      tone: "neutral", icon: "alert", labelKey: "risk.unknown", labelVars: { value: "stable" },
    });
  });

  it("names every label in all four languages", () => {
    const keys = [...ENGINE_RISKS.map((r) => riskStyle(r).labelKey), "risk.unmeasured", "risk.unknown"];
    for (const lang of LANG_CODES) for (const key of keys) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
  });
});
