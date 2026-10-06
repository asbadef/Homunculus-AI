// Every key in all four languages, non-empty, with the Turkish source's placeholders — the same
// guarantee i18n.rbac.test.js gives the old workspace's rbac block.
import { describe, it, expect } from "vitest";
import { NAMESPACES, DICTIONARIES, buildDictionaries } from "./catalog.js";
import { LANG_CODES, SOURCE_LANG } from "./langs.js";

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// Language-neutral texts: clinical abbreviations written the same in every script.
const NEUTRAL = new Set(["news2.missing.spo2"]);
// Azerbaijani and Turkish share many words, so an AZ text may equal its TR source — but that is
// also exactly what a forgotten translation looks like (the Turkish copied across). Each identity
// is therefore reviewed and listed here, key by key; a new one fails until someone has checked it,
// and an entry whose texts have since diverged fails until it is removed.
const AZ_SAME_AS_TR = new Set([
  "risk.critical", //        Kritik — the prototype's AZ dictionary (grafik.js gd_k_crit)
  "risk.moderate", //        Orta — the prototype's AZ dictionary (ceviri-sozluk "ORTA")
  "prefs.theme", //          Tema — the prototype's AZ dictionary
  "prefs.sizeNormal", //     Normal — the prototype's AZ dictionary (mobil.js fs_1)
  "prefs.lang", //           Dil — the prototype's AZ dictionary (legal.js lgl_lang)
  "news2.missing.spo2", //   SpO2 — a clinical abbreviation, the same in every language
  "gallery.seen", //         Gördüm — the prototype's AZ dictionary
  "gallery.criticalOnly", // Yalnız kritik — the prototype's AZ dictionary
  "gallery.lastLogin", //    Son giriş — the prototype's AZ dictionary
  "shell.fullscreen", //     Tam ekran — the prototype's AZ dictionary (shell.js tb_full)
  "shell.keyFull", //        Tam ekran — the same (shell.js tb_k_full)
]);

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

  it("an Azerbaijani text equals its Turkish source only where that was reviewed", () => {
    const { tr, az } = DICTIONARIES;
    for (const key of Object.keys(tr)) {
      if (az[key] === tr[key]) expect(AZ_SAME_AS_TR.has(key), `az ${key} = tr "${tr[key]}": review, then list it`).toBe(true);
    }
    for (const key of AZ_SAME_AS_TR) {
      // A deleted key would pass the next line (undefined === undefined): it must still exist.
      expect(key in tr, `${key} is listed but no longer exists`).toBe(true);
      expect(az[key], `${key} is listed but az differs from tr now`).toBe(tr[key]);
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
  // speaks of itself as "Система" (Wave 1B review). Only the forms of "движок" are banned —
  // "движение" (movement) and its kin are ordinary words a clinical text may need.
  const ENGINE_WORD = /движ(?:ок|к)/i;
  it("calls the engine \"Система\" in Russian, never \"Движок\"", () => {
    for (const form of ["Движок", "движка", "движку", "движком", "движке", "движки", "движков"]) {
      expect(form, form).toMatch(ENGINE_WORD);
    }
    for (const word of ["движение", "Движения", "подвижность"]) expect(word, word).not.toMatch(ENGINE_WORD);
    expect(Object.values(DICTIONARIES.ru).join(" ")).not.toMatch(ENGINE_WORD);
    expect(DICTIONARIES.ru["news2.noEngine"]).toMatch(/^Система /);
  });

  it("names keys <namespace>.<key>, nested keys joined with dots", () => {
    expect(DICTIONARIES.az["common.close"]).toBe("Bağla");
    expect(DICTIONARIES.tr["news2.missing.respiration_rate"]).toBe("solunum hızı");
  });
});
