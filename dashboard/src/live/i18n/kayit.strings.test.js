// G3-05 «Cihaz ölçüm kaydı» (spec D13, D16, D17, Q1–Q4): the words of the patient screen's «Ölçüm kaydı» box, the
// «Düzelt» dialog and the bedside page's «Eşleşmeyen ölçümler» step (strings/kayit.js), and the two words the trend
// table gains (strings/olcum.js). What every language must keep: a value is never lost — a withdrawn one stays,
// struck through, with its reason; a rejected or unmatched one keeps its value; the screens give no order.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const kayit = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("kayit."));

describe("the measurement record's words (kayit)", () => {
  // The sweeps below read every key of the namespace: on an empty namespace they would pass having read nothing.
  it("has its 72 keys in every language", () => {
    for (const lang of LANG_CODES) expect(kayit(lang), lang).toHaveLength(72);
  });

  it("says the spec's Turkish for the box, the two sources and the list", () => {
    const tr = DICTIONARIES.tr;
    expect(tr["kayit.title"]).toBe("Ölçüm kaydı");
    expect(fill(tr["kayit.sourceDevice"], { device: "CONNEX-3A" })).toBe("cihaz · CONNEX-3A");
    expect(fill(tr["kayit.sourceHand"], { user: "hem.ayse" })).toBe("elle · hem.ayse");
    expect(fill(tr["kayit.received"], { time: "09:40" })).toBe("alındı 09:40");
    expect(tr["kayit.correct"]).toBe("Düzelt");
    expect(tr["kayit.umTitle"]).toBe("Eşleşmeyen ölçümler");
    expect(tr["kayit.umReasonDischarged"]).toBe("taburcu edilmiş hastanın numarası");
    expect([tr["kayit.w24"], tr["kayit.w72"], tr["kayit.w168"]]).toEqual(["24 saat", "72 saat", "7 gün"]);
    expect([tr["olcum.device"], tr["olcum.hand"]]).toEqual(["cihaz", "elle"]);
  });

  it("the correction says the wrong value stays, struck through, and the right one is written by hand at that time", () => {
    const STAYS = { tr: "üstü çizili", az: "üstündən xətt çəkilmiş", ru: "зачёркнутым", en: "struck through" };
    const BY_HAND = { tr: "«elle»", az: "«əl ilə»", ru: "«вручную»", en: "“by hand”" };
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["kayit.correctIntro"], lang).toContain(STAYS[lang]);
      expect(DICTIONARIES[lang]["kayit.correctIntro"], lang).toContain(BY_HAND[lang]);
    }
  });

  it("a partial correction says which half happened", () => {
    for (const lang of LANG_CODES) {
      const said = fill(DICTIONARIES[lang]["kayit.correctPartial"], { subject: "REA-01 · 2", reason: "x" });
      expect(said.startsWith("REA-01 · 2: "), `${lang}: ${said}`).toBe(true);
      expect(said, lang).toContain("x");
    }
    expect(DICTIONARIES.tr["kayit.correctPartial"]).toContain("yanlış değer işaretlendi");
    expect(DICTIONARIES.tr["kayit.correctPartial"]).toContain("doğru değer kaydedilmedi");
  });

  it("the list says the values are not lost, and a rejection says they are kept", () => {
    const KEPT = { tr: "kaybolmadı", az: "itməyib", ru: "не потеряны", en: "are not lost" };
    const STAY = { tr: "kayıtta kalır", az: "qeyddə qalır", ru: "остаются в записи", en: "stay in the record" };
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["kayit.umIntro"], lang).toContain(KEPT[lang]);
      expect(DICTIONARIES[lang]["kayit.umRejectIntro"], lang).toContain(STAY[lang]);
    }
  });

  it("every refusal and every toast names its subject first", () => {
    const named = ["correctDone", "correctWithdrawn", "correctPartial", "correctRefused", "correctMayHaveLanded",
      "umLinked", "umLinkRefused", "umLinkMayHaveLanded", "umRejected", "umRejectRefused"];
    for (const lang of LANG_CODES) {
      for (const key of named) expect(DICTIONARIES[lang][`kayit.${key}`], `${lang} ${key}`).toMatch(/^\{subject\}: /);
    }
  });

  // Hard rule 5: the screens describe and record; they never tell a clinician what to do to a patient.
  it("gives no order and suggests no treatment", () => {
    const ORDER = /\b(verin|uygulayın|başlayın|verilməlidir|назначьте|введите препарат|administer|start (?:the )?(?:drug|treatment))\b/i;
    for (const lang of LANG_CODES) {
      for (const [key, text] of kayit(lang)) expect(text, `${lang} ${key}`).not.toMatch(ORDER);
    }
  });

  it("the unmatched list's refusals have their texts by code", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["notUnmatched", "setMixed", "tooOld", "targetDischarged", "reasonLength", "hours", "person"]) {
        expect(DICTIONARIES[lang][`kayit.err.${key}`], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});
