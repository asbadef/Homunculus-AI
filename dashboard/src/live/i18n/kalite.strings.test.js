// G4-03 «Kalite göstergeleri» (spec 2026-11-11 D5): the quality page's words (strings/kalite.js) — the spec's own
// Turkish, none of the prototype's figures that have no source, no suffix glued to a number, the period named on the
// cards and the selection on the kinds.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const kalite = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("kalite."));

describe("the quality page's words (kalite)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["kalite.nav"], tr["kalite.title"], tr["kalite.motto"]])
      .toEqual(["Kalite göstergeleri", "Kalite göstergeleri", "Süreç ölçülür, kişi değil"]);
    expect(fill(tr["kalite.coverage"], { episodes: 40, placed: 31 }))
      .toBe("Bu dönemde 40 alarm olayından 31 tanesi bir birime bağlanabildi.");
    expect(tr["kalite.coverageWhy"]).toBe(
      "Birime bağlanamayanlar: bu sistemde kabul kaydı olmayan (HBYS'den gelen ya da kimliği olmayan monitör) hastalar.");
    expect(tr["kalite.coverageScoped"]).toMatch(/^Yalnız kapsamınızdaki birimler/);
    expect(fill(tr["kalite.cards.selfResolved"], { n: 2 })).toBe("2 tanesi kendiliğinden düzeldi");
    expect([tr["kalite.units.unplaced"], tr["kalite.units.total"], tr["kalite.noReach"]])
      .toEqual(["Birimi belli olmayan", "Toplam", "Kapsamınızda birim yok."]);
    expect(tr["kalite.units.colUnanswered"]).toBe("Yanıtsız (kendiliğinden düzelen)");
    expect(tr["kalite.units.colHandovers"]).toBe("Devir (açılan / karşı imzalı / bekleyen)");
    expect(fill(tr["kalite.pct"], { pct: 82 })).toBe("%82");
  });

  it("leaves out the prototype's figures that have no source", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of kalite(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\b3 (dk|dəq|мин|min)\b|Hatalı|Səhv|Ошибочн|Güvenlik olay|İncelenecek|Rapor al|30 dk içinde/i);
      }
    }
  });

  it("glues no suffix to a number, a time or a date in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of kalite(lang)) {
        expect(value, `${lang} ${key}`)
          .not.toMatch(/\{(n|pct|episodes|placed|answered|settled|high|moderate|from|period|unit|reason|why)\}[^\s·;,.:)%]/);
      }
    }
  });

  it("names the period on the cards and the selection on the kinds, in every language", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["kalite.cards.title", "kalite.cards.titleScoped"]) {
        expect(DICTIONARIES[lang][key], `${lang} ${key}`).toContain("{period}");
      }
      expect(DICTIONARIES[lang]["kalite.kinds.title"], lang).toContain("{unit}");
    }
  });
});
