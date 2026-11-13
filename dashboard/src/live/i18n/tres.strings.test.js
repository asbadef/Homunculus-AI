// src/live/i18n/tres.strings.test.js — TRƏS-01: the national feed's words, where the wording itself is the thing under
// test (review of the F1 panels, 2026-11-13). The catalogue-wide rules (four languages, placeholders, az = tr reviewed)
// live in strings.test.js; here are the texts that read as the OPPOSITE of what they mean, or that spoke to the wrong
// reader. A hospital administrator reads these screens — not the planner, not the owner.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";
import { ENVIRONMENT_KEYS, REASONS, STAY_STATES, STATUSES, TYPES } from "../screens/admin/tresWords.js";

const words = (key) => Object.fromEntries(LANG_CODES.map((lang) => [lang, DICTIONARIES[lang][key]]));

describe("TRƏS strings — wording that must not read as its opposite", () => {
  it("calls a skipped row «not sent» in Azerbaijani — «Ötürüldü» reads as «was passed on», i.e. delivered", () => {
    expect(DICTIONARIES.az["tres.status.skipped"]).toBe("Göndərilmədi");
    expect(DICTIONARIES.az["tres.reason.patientUnheld"])
      .toBe("Xəstə qeydi platformada yoxdur: yatış qeydi də göndərilmədi");
    for (const [key, value] of Object.entries(DICTIONARIES.az)) {
      if (key.startsWith("tres.")) expect(value, key).not.toMatch(/ötürül/i);
    }
  });

  it("says «failed» for a refused row AND a counted server error — never «refused» alone", () => {
    expect(words("tres.status.failed")).toEqual({ tr: "Başarısız", az: "Uğursuz", ru: "Ошибка", en: "Failed" });
  });

  it("speaks of a record, not of a «source», in the ledger's subtitle", () => {
    expect(DICTIONARIES.az["tres.deliveries.sub"]).toMatch(/^Hər qeydin son vəziyyəti, /);
    expect(DICTIONARIES.tr["tres.deliveries.sub"]).toMatch(/^Her kaydın son durumu, /);
    expect(DICTIONARIES.az["tres.deliveries.sub"]).not.toMatch(/mənbə/);
    expect(DICTIONARIES.tr["tres.deliveries.sub"]).not.toMatch(/kaynak/);
  });

  it("explains the cut-off's rule to the administrator and says nothing of the owner's approval", () => {
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["tres.sendFromHint"], lang).not.toMatch(/sahib|sahip|владел|owner|təklif|öner|предлага|propos/i);
    }
    expect(DICTIONARIES.en["tres.sendFromHint"]).toBe("Only stays discharged after this moment are sent automatically; "
      + "earlier ones only with «Send now». It is set when «Send» is first chosen.");
    expect(DICTIONARIES.az["tres.sendFromHint"]).toBe("Yalnız bu andan sonra evə yazılan yatışlar avtomatik göndərilir; "
      + "daha əvvəlkilər yalnız «İndi göndər» ilə. «Göndər» ilk dəfə seçiləndə o an yazılır.");
  });

  it("says a stay that was not discharged as «no discharge» in Russian, not as a verb about a person", () => {
    expect(DICTIONARIES.ru["tres.deliveries.stillAdmitted"]).toBe("выписки нет");
  });

  it("names the practitioners' panel by what it holds in Azerbaijani, and says it the same way throughout the panel", () => {
    expect(DICTIONARIES.az["tres.practitioners.title"]).toBe("Həkimlərin şəxsiyyət məlumatları");
    expect(DICTIONARIES.az["tres.practitioners.caption"]).toBe("Həkimlərin TRƏS üçün şəxsiyyət məlumatları");
    for (const [key, value] of Object.entries(DICTIONARIES.az)) {
      if (key.startsWith("tres.practitioners.") || key === "tres.reason.identityMissing") {
        expect(value, key).not.toMatch(/identifikasiya/i);
      }
    }
  });

  it("puts every English count after its label, so no plural is ever wrong — «Failed 1», never «1 records»", () => {
    expect(DICTIONARIES.en["tres.deliveries.handled"]).toBe("Handled: {counts}");
    expect(DICTIONARIES.en["tres.deliveries.retried"]).toBe("Retried: {counts}");
    for (const lang of LANG_CODES) {
      for (const key of ["tres.deliveries.handled", "tres.deliveries.retried"]) {
        expect(DICTIONARIES[lang][key], `${lang} ${key}`).toMatch(/: \{counts\}$/);
        expect(DICTIONARIES[lang][key], `${lang} ${key}`).not.toMatch(/\{count\}/);
      }
    }
  });

  it("has words, in every language, for each state, status, reason, type and environment the screens can say", () => {
    const keys = [...STAY_STATES.values(), ...ENVIRONMENT_KEYS.map(([, key]) => key), ...STATUSES.map(([, key]) => key),
      ...TYPES.map(([, key]) => key), ...REASONS.values()];
    for (const lang of LANG_CODES) {
      for (const key of keys) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toEqual(expect.any(String));
    }
  });
});
