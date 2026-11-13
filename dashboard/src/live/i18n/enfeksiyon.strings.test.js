// G4-05 «Enfeksiyon kontrol» (spec 2026-11-12 D13, D18, §5 A3, A6, M7): the page's words (strings/enfeksiyon.js) — the
// spec's own Turkish, the Sepsis-3 alarm kinds in the criteria register (never a diagnosis), none of the prototype's
// formulas or rates, never «izolasyonsuz» for a patient nobody recorded, and no suffix glued to a number, a time or a
// name.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const enfeksiyon = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("enfeksiyon."));

describe("the infection-control page's words (enfeksiyon)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["enfeksiyon.nav"], tr["enfeksiyon.navShort"], tr["enfeksiyon.title"]])
      .toEqual(["Enfeksiyon kontrol", "Enfeksiyon", "Enfeksiyon kontrol"]);
    expect(tr["enfeksiyon.intro"]).toBe("İzolasyon, şüpheli enfeksiyon, antibiyotik süresi ve sepsis alarmları");
    expect(["isolated", "freeBeds", "suspected", "clockMissed", "sepsisOpen"].map((key) => tr[`enfeksiyon.count.${key}`]))
      .toEqual(["izolasyonda kayıtlı hasta", "boş izolasyon yatağı", "şüpheli enfeksiyon işaretli hasta",
        "antibiyotik süresi aşan", "sepsis alarmı süren hasta"]);
    expect(fill(tr["enfeksiyon.count.isolationUnrecorded"], { n: 3 })).toBe("3 hastada izolasyon kaydı yok");
    expect(fill(tr["enfeksiyon.count.suspectedUnrecorded"], { n: 2 })).toBe("2 hastada işaret yok");
    expect(tr["enfeksiyon.count.sepsisOpenNote"]).toBe("yanıtlanmış ya da yanıtlanmamış");
    expect(tr["enfeksiyon.isolated.empty"]).toBe("Kapsamınızda izolasyonda kayıtlı hasta yok.");
    expect(tr["enfeksiyon.suspected.empty"])
      .toBe("Kapsamınızda şüpheli enfeksiyon işaretli ya da sepsis alarmı olan hasta yok.");
    expect(tr["enfeksiyon.beds.none"]).toBe("Kapsamınızda izolasyon odası tanımlı değil.");
    expect(tr["enfeksiyon.unit.gone"]).toBe("Seçili birim artık kapsamınızda değil.");
    // Re-review: a unit that leaves the list while the scope still grants it (closed, say) is no claim about the scope.
    expect(tr["enfeksiyon.unit.dropped"]).toBe("Seçili birim artık listede yok.");
    expect(tr["enfeksiyon.isolated.note"]).toBe("İzolasyon, bir klinisyenin hasta ekranından bu sisteme kaydettiği önlem "
      + "türleridir; sistem izolasyon önermez, türünü seçmez. “İzolasyon kaydı yok”, kayıt yapılmadığını söyler; hastanın "
      + "izolasyonda olmadığı anlamına gelmez.");
    // §5 M7: no source says what this hospital's committee does.
    expect(tr["enfeksiyon.honesty"]).toBe("Bu sayfada yok: cihaz günleri (santral kateter, üriner kateter, ventilatör), "
      + "cihaz kullanım oranı, enfeksiyon oranları, antibiyotik günü ve kültür sonuçları — hiçbirinin bu sistemde kaynak "
      + "kaydı yok; hiçbiri hesaplanmadı. Enfeksiyon tanımı ve olay sayımı bu sistemin işi değildir; sistem eşik ya da "
      + "tanım üretmez. Homunculus tanı koymaz, order vermez.");
    expect(["contact", "droplet", "airborne", "protective"].map((type) => tr[`enfeksiyon.type.${type}`]))
      .toEqual(["Temas", "Damlacık", "Solunum", "Koruyucu"]);
    expect(fill(tr["enfeksiyon.stale"], { time: "09:30" })).toBe("Enfeksiyon listesi güncel değil · son yanıt 09:30");
    expect(fill(tr["enfeksiyon.beds.tally"], { occupied: 1, free: 2 })).toBe("1 dolu · 2 boş");
    expect(DICTIONARIES.az["enfeksiyon.nav"]).toBe("İnfeksiya nəzarəti");
  });

  it("names the alarm kinds as criteria met, never as a diagnosis (CLAUDE.md hard rule 5, §5 A6)", () => {
    expect(["septicShock", "sepsis", "underResuscitated"].map((kind) => DICTIONARIES.tr[`enfeksiyon.kind.${kind}`]))
      .toEqual(["Septik şok ölçütleri karşılandı", "Sepsis ölçütleri karşılandı", "Yeterli sıvıdan önce hipoperfüzyon"]);
    const criteria = { tr: "ölçütleri", az: "meyarları", ru: "Критерии", en: "criteria" };
    for (const lang of LANG_CODES) {
      for (const kind of ["septicShock", "sepsis"]) {
        expect(DICTIONARIES[lang][`enfeksiyon.kind.${kind}`], `${lang} ${kind}`).toContain(criteria[lang]);
      }
    }
  });

  it("carries none of the prototype's formulas or rates", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of enfeksiyon(lang)) expect(value, `${lang} ${key}`).not.toMatch(/1000|‰|=|×|÷/);
    }
  });

  it("never calls a patient nobody recorded «izolasyonsuz»", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["enfeksiyon.beds.tile.unrecorded"], tr["enfeksiyon.beds.tile.not_isolated"]])
      .toEqual(["izolasyon kaydı yok", "izolasyonsuz hasta"]);
    for (const key of ["enfeksiyon.beds.tile.unrecorded", "enfeksiyon.count.isolationUnrecorded", "enfeksiyon.isolated.note"]) {
      expect(tr[key], key).not.toMatch(/izolasyonsuz/);
    }
  });

  it("glues no suffix to a number, a time or a name in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of enfeksiyon(lang)) expect(value, `${lang} ${key}`).not.toMatch(/\{\w+\}[^\s·;,.:)–]/);
    }
  });
});
