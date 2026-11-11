// G3-04 «Eczane» (spec 2026-11-11 D8, D9, D19, D20, §3.1, §5.1, §6): the pharmacy page's words (strings/eczane.js) —
// the spec's own Turkish, word for word; the register (no state, tile or cell says «verilmedi», suggests a dose or
// gives an order); the source named with both halves; no suffix glued to a number, a time or a duration.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const eczane = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("eczane."));

describe("the pharmacy page's words (eczane)", () => {
  // The sweeps below read every key of the namespace: on an empty namespace they would pass having read nothing.
  it("has its 43 keys in every language", () => {
    for (const lang of LANG_CODES) expect(eczane(lang), lang).toHaveLength(43);
  });

  it("says the spec's Turkish, word for word", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["eczane.nav"], tr["eczane.navShort"], tr["eczane.title"]]).toEqual(["Eczane", "Eczane", "Eczane"]);
    expect(tr["eczane.intro"]).toBe("Bu ekran izleme içindir; doz önermez, order vermez.");
    expect(tr["eczane.note"]).toBe("“Kayıt yok” ve “uygulama kaydı yok”, bu sisteme antibiyotik uygulaması kaydedilmediğini söyler; verilmediği anlamına gelmez.");
    expect(tr["eczane.source"]).toBe("Antibiyotik süresi: motorun sepsis ya da septik şok kuralının ilk tetiklendiği andan itibaren 1 saat — Surviving Sepsis Campaign 2026 (güçlü öneri, çok düşük kesinlikte kanıt).");
    expect(tr["eczane.footer"]).toBe("Bu sayfada yok: order'lar, alerjiler, kültür sonuçları, ilaç etkileşim sorgusu, antibiyotik tedavi günü, doz önerisi. Homunculus tanı koymaz, order vermez.");
    expect(tr["eczane.truncated"]).toBe("Sıvı toplamları eksik olabilir: günün kayıtları okuma sınırını aştı.");
    expect(tr["eczane.empty"]).toBe("Görünümünüzde yatan hasta yok.");
    expect(fill(tr["eczane.stale"], { time: "09:30" })).toBe("Eczane listesi güncel değil · son yanıt 09:30");
    expect(fill(tr["eczane.asOf"], { time: "09:30" })).toBe("son yanıt 09:30 itibarıyla");
    expect(fill(tr["eczane.readFailed"], { reason: "neden" })).toBe("Eczane listesi okunamadı: neden");
  });

  it("names the four counters and the part of the fourth", () => {
    const tr = DICTIONARIES.tr;
    expect(["running", "missed", "onPressor", "recognized"].map((k) => tr[`eczane.count.${k}`]))
      .toEqual(["Süre işliyor", "Süre aştı", "Vazopresör / inotrop alan", "Sepsis tanınan"]);
    expect(fill(tr["eczane.count.noRecord"], { n: 2 })).toBe("antibiyotik kaydı yok: 2");
  });

  it("words the six states, the second line and the two past-tense twins as the spec does", () => {
    const tr = DICTIONARIES.tr;
    const minutes = (n) => fill(tr["eczane.dur.min"], { n });
    expect(fill(tr["eczane.ab.running"], { duration: minutes(35) })).toBe("Süre işliyor · 35 dk kaldı");
    expect(fill(tr["eczane.ab.missed"], { duration: minutes(25) })).toBe("Süre aştı · 25 dk");
    expect(fill(tr["eczane.ab.met"], { time: "08:40" })).toBe("Karşılandı · 08:40");
    expect(fill(tr["eczane.ab.late"], { time: "09:40" })).toBe("Geç verildi · 09:40");
    expect(fill(tr["eczane.ab.given"], { time: "08:40" })).toBe("Verildi · 08:40");
    expect(tr["eczane.noRecord"]).toBe("Kayıt yok");
    expect(fill(tr["eczane.ab.noAdmin"], { time: "08:05" })).toBe("tanınma 08:05 · uygulama kaydı yok");
    expect(fill(tr["eczane.ab.staleRunning"], { time: "09:05" })).toBe("Son yanıtta süre işliyordu · bitiş 09:05");
    expect(fill(tr["eczane.ab.staleMissed"], { time: "09:05" })).toBe("Son yanıtta süre aşılmıştı · bitiş 09:05");
  });

  it("writes a duration and the two numbers with their times as the spec does", () => {
    const tr = DICTIONARIES.tr;
    expect(tr["eczane.dur.under"]).toBe("<1 dk");
    expect(fill(tr["eczane.dur.min"], { n: 119 })).toBe("119 dk");
    expect(fill(tr["eczane.dur.hm"], { h: 2, m: 5 })).toBe("2 sa 5 dk");
    expect(fill(tr["eczane.creatinine"], { value: 1.4, time: "06:10" })).toBe("1.4 mg/dL · 06:10");
    expect(tr["eczane.fluid.none"]).toBe("Bugün kayıt yok");
    expect(fill(tr["eczane.fluid.balance"], { value: "+350" })).toBe("+350 mL");
  });

  // D8, the carried rule: «kayıt yok»u «verilmedi» diye göstermez. The one place the page may say the word is the note
  // that says the absence of a record does NOT mean it — so every other text is held to never saying it.
  it("never says «not given»: only the note names the word, to deny it", () => {
    const NOT_GIVEN = /verilmedi|verilmədi|verilməyib|не вводил|не введ|not given|wasn't given|was not given/i;
    for (const lang of LANG_CODES) {
      for (const [key, value] of eczane(lang)) {
        if (key === "eczane.note") expect(value, `${lang} ${key}`).toMatch(NOT_GIVEN);
        else expect(value, `${lang} ${key}`).not.toMatch(NOT_GIVEN);
      }
    }
  });

  // Hard rule 5 and D19: the page suggests no dose and gives no order. The intro and the footer say so; no other text
  // may speak of a dose, an order, a target or a recommendation to act.
  it("suggests no dose and gives no order outside the two sentences that say it does not", () => {
    const ADVICE = /\bdoz|\bdoza|доз|\bdose|order|təyinat|назначен|önerilir|tövsiyə olunur|рекомендуется|should|hedef|hədəf|целев|target/i;
    for (const lang of LANG_CODES) {
      for (const [key, value] of eczane(lang)) {
        if (key === "eczane.intro" || key === "eczane.footer") expect(value, `${lang} ${key}`).toMatch(ADVICE);
        else if (key !== "eczane.source" && key !== "eczane.sourceOther") expect(value, `${lang} ${key}`).not.toMatch(ADVICE);
      }
    }
  });

  // D9, [[antimicrobial-timing-sepsis]]: the strength and the certainty are two different things, and time zero is said.
  it("names the window's source with both halves and its time zero, in every language", () => {
    const BOTH = { tr: ["güçlü öneri", "çok düşük kesinlikte kanıt"], az: ["güclü tövsiyə", "çox aşağı əminlikli sübut"],
      ru: ["сильная рекомендация", "очень низкая достоверность доказательств"],
      en: ["strong recommendation", "very low certainty of evidence"] };
    for (const lang of LANG_CODES) {
      const text = DICTIONARIES[lang]["eczane.source"];
      expect(text, lang).toContain("Surviving Sepsis Campaign 2026");
      for (const half of BOTH[lang]) expect(text, `${lang}: ${half}`).toContain(half);
      expect(text, lang).toMatch(/sepsis|сепсис/i);
      expect(DICTIONARIES[lang]["eczane.sourceOther"], lang).not.toContain("Surviving Sepsis Campaign");
    }
  });

  it("glues no suffix to a number, a time or a duration in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of eczane(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\{(time|n|h|m|duration|value|intake|output|minutes|reason|state|source)\}[^\s·;,.:)]/);
      }
    }
  });

  it("nothing on the page is called green, safe or normal", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of eczane(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\bnormal\b|güvenli|təhlükəsiz|безопасн|\bsafe\b|uygun\b|в норме/i);
      }
    }
  });
});
