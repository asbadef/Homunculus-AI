import { describe, it, expect, vi } from "vitest";
import { createTranslator, interpolate } from "./translate.js";

const DICTS = {
  az: { "a.hello": "Salam, {name}" },
  tr: { "a.hello": "Merhaba, {name}", "a.trOnly": "yalnız Türkçe" },
  ru: {},
  en: {},
};

describe("createTranslator", () => {
  it("returns the language's own text, with its variables", () => {
    expect(createTranslator("az", DICTS)("a.hello", { name: "Leyla" })).toBe("Salam, Leyla");
  });

  it("falls back to the Turkish source text, and reports it", () => {
    const onMissing = vi.fn();
    const t = createTranslator("ru", DICTS, onMissing);
    expect(t("a.trOnly")).toBe("yalnız Türkçe");
    expect(onMissing).toHaveBeenCalledWith({ key: "a.trOnly", lang: "ru", found: "tr" });
  });

  it("shows the key itself when no language has it, and reports it", () => {
    const onMissing = vi.fn();
    expect(createTranslator("tr", DICTS, onMissing)("a.nowhere")).toBe("a.nowhere");
    expect(onMissing).toHaveBeenCalledWith({ key: "a.nowhere", lang: "tr", found: null });
  });

  it("speaks Azerbaijani for a language it does not have (roadmap D2)", () => {
    expect(createTranslator("de", DICTS)("a.hello", { name: "X" })).toBe("Salam, X");
  });

  it("inserts variables verbatim and never translates them", () => {
    const t = createTranslator("az", DICTS);
    expect(t("a.hello", { name: "a.trOnly" })).toBe("Salam, a.trOnly");
    expect(t("a.hello", { name: "$& {name}" })).toBe("Salam, $& {name}");
  });

  it("leaves a placeholder it was not given visible", () => {
    expect(createTranslator("az", DICTS)("a.hello")).toBe("Salam, {name}");
  });
});

describe("interpolate", () => {
  it("writes numbers as text", () => {
    expect(interpolate("{n} yatak", { n: 3 })).toBe("3 yatak");
  });
});
