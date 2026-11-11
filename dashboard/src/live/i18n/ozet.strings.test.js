// G4-02 «Yönetici özeti» (spec 2026-11-11 D5): the summary page's words (strings/ozet.js) — the spec's own Turkish,
// none of the prototype's numbers that have no source, a reason for every «—», and no suffix glued to a number.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const ozet = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("ozet."));
const WHY = ["loading", "failed", "stale", "noRight", "chain", "unknown", "stripOff", "stripStale"];

describe("the summary page's words (ozet)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["ozet.nav"], tr["ozet.title"], tr["ozet.cards.title"], tr["ozet.q.title"], tr["ozet.units.title"]])
      .toEqual(["Yönetici özeti", "Yönetici özeti", "Unutulan işler", "Alarm kalitesi", "Birimler"]);
    expect(fill(tr["ozet.asOf"], { time: "10:42" })).toBe("10:42 itibarıyla");
    expect(tr["ozet.refresh"]).toBe("Yenile");
    expect(fill(tr["ozet.cards.unansweredTitle"], { period: tr["ozet.period.text7"] })).toBe("Yanıtsız kalan alarm · son 7 gün");
    expect(tr["ozet.cards.pendingTitle"]).toBe("Karşı imzası bekleyen devir");
    expect(fill(tr["ozet.cards.pendingOldest"], { age: fill(tr["ozet.age.day"], { n: 2 }) })).toBe("en eskisi 2 gün önce");
    expect(tr["ozet.cards.lateTitle"]).toBe("Geciken iş");
    expect(tr["ozet.cards.silentTitle"]).toBe("Sessiz monitör");
    expect(fill(tr["ozet.cards.silentLongest"], { for: fill(tr["ozet.for.minutes"], { n: 12 }) })).toBe("en uzunu 12 dk");
    expect([tr["ozet.period.d1"], tr["ozet.period.d7"], tr["ozet.period.d30"]]).toEqual(["Bugün", "7 gün", "30 gün"]);
    expect(tr["ozet.q.daily"]).toBe("Günlük alarm sayısı");
    expect(tr["ozet.q.unsettled"]).toBe("henüz yerleşen yok");
    expect(tr["ozet.units.unplaced"]).toBe("Birimi belli olmayan");
    expect(WHY.map((w) => tr[`ozet.why.${w}`])).toEqual([
      "okunuyor…", "okunamadı", "pano güncel değil", "yetki yok", "veri zinciri kesik", "bilinmiyor", "monitör şeridi kapalı",
      "monitör verisi güncel değil",
    ]);
    // Review fixes: a scoped caller's cards, a truncated count, the tree still loading, a report of the wrong shape.
    expect(tr["ozet.cards.scoped"]).toBe("yalnız kapsamınızdakiler, hastanenin tamamı değil");
    expect(tr["ozet.cards.scopeUnknown"]).toBe("kapsamınız okunamadı: hastanenin tamamı olmayabilir");
    expect(tr["ozet.cards.truncated"]).toBe("eksik okuma: yalnız en yeni kayıtlar sayıldı");
    expect(tr["ozet.units.loading"]).toBe("Birimler okunuyor…");
    expect(tr["ozet.q.unreadable"]).toBe("Alarm kalitesi okunamadı.");
  });

  it("says why a number is missing with a word of its own, in every language", () => {
    for (const lang of LANG_CODES) {
      const words = WHY.map((w) => DICTIONARIES[lang][`ozet.why.${w}`]);
      expect(new Set(words).size, lang).toBe(WHY.length);
      for (const word of words) expect(word, lang).not.toMatch(/^\s*0\s*$/);
    }
  });

  it("leaves out the prototype's numbers that have no source", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of ozet(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/3 (dk|dəq|мин|min)\b|Hatalı|Səhv|Ошибочн|Marked as false|1 saatten|1 saatdan|более часа|over an hour|geçen hafta|keçən həftə|прошлой неделе|last week/i);
      }
    }
  });

  it("glues no suffix to a number, a time or a date in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of ozet(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\{(time|n|m|s|age|for|from|date|pct|critical|high|period|why)\}[^\s·;,.:)%]/);
      }
    }
  });

  it("names the period in the card that depends on it and in the quality box", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["ozet.cards.unansweredTitle", "ozet.q.intro"]) expect(DICTIONARIES[lang][key], `${lang} ${key}`).toContain("{period}");
    }
  });
});
