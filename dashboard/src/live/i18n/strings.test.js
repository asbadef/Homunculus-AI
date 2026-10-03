// Every key in all four languages, non-empty, with the Turkish source's placeholders — the same
// guarantee i18n.rbac.test.js gives the old workspace's rbac block.
import { describe, it, expect } from "vitest";
import { NAMESPACES, DICTIONARIES, buildDictionaries } from "./catalog.js";
import { LANG_CODES, SOURCE_LANG } from "./langs.js";

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// Language-neutral texts: clinical abbreviations written the same in every script.
const NEUTRAL = new Set(["news2.missing.spo2"]);

describe("live UI dictionaries", () => {
  it("every namespace has the four languages, each with the Turkish source's keys", () => {
    for (const [ns, dict] of Object.entries(NAMESPACES)) {
      expect(Object.keys(dict).sort(), ns).toEqual([...LANG_CODES].sort());
      const flat = buildDictionaries({ [ns]: dict });
      const source = Object.keys(flat[SOURCE_LANG]).sort();
      expect(source.length, ns).toBeGreaterThan(0);
      for (const lang of LANG_CODES) expect(Object.keys(flat[lang]).sort(), `${ns} ${lang}`).toEqual(source);
    }
  });

  it("no text is empty, and each keeps the Turkish source's placeholders", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of Object.entries(DICTIONARIES[lang])) {
        expect(typeof value === "string" && value.trim() !== "", `${lang} ${key}`).toBe(true);
        expect(placeholders(value), `${lang} ${key}`).toEqual(placeholders(DICTIONARIES[SOURCE_LANG][key]));
      }
    }
  });

  it("writes Azerbaijani in Latin script and Russian in Cyrillic", () => {
    const az = Object.values(DICTIONARIES.az).join(" ");
    expect(az).not.toMatch(/[Ѐ-ӿ]/);
    expect(az).toMatch(/ə/);
    for (const [key, value] of Object.entries(DICTIONARIES.ru)) {
      if (!NEUTRAL.has(key)) expect(value, `ru ${key}`).toMatch(/[Ѐ-ӿ]/);
    }
  });

  // "Движок" is developer jargon a Russian-speaking clinician reads as a car engine; the system
  // speaks of itself as "Система" (Wave 1B review).
  it("calls the engine \"Система\" in Russian, never \"Движок\"", () => {
    expect(Object.values(DICTIONARIES.ru).join(" ")).not.toMatch(/движ/i);
    expect(DICTIONARIES.ru["news2.noEngine"]).toMatch(/^Система /);
  });

  it("names keys <namespace>.<key>, nested keys joined with dots", () => {
    expect(DICTIONARIES.az["common.close"]).toBe("Bağla");
    expect(DICTIONARIES.tr["news2.missing.respiration_rate"]).toBe("solunum hızı");
  });
});
