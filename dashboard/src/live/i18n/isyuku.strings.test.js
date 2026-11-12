// G4-04 «İş yükü» (spec 2026-11-12 D6, §5): the workload page's words (strings/isyuku.js) — the spec's own Turkish,
// none of the prototype's figures that have no source, no suffix glued to a number, a time or a name, and the unit named
// in the nurse cards' and the form's titles.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const isyuku = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("isyuku."));

describe("the workload page's words (isyuku)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["isyuku.nav"], tr["isyuku.title"], tr["isyuku.motto"]])
      .toEqual(["İş yükü", "İş yükü", "Sayım, puan değil · kişiler sıralanmaz"]);
    expect(fill(tr["isyuku.shift.current"], { from: "08:00", to: "20:00" })).toBe("Bu nöbet · 08:00–20:00");
    expect(fill(tr["isyuku.shift.next"], { from: "20:00", to: "08:00" })).toBe("Sonraki nöbet · 20:00–08:00");
    expect(["colPatients", "colNurses", "colRatio", "colUnassigned", "colLate", "colRemaining", "colWaiting"]
      .map((key) => tr[`isyuku.units.${key}`])).toEqual(["Hasta", "Hemşire", "Hemşire başına hasta", "Atanmamış hasta",
      "Geciken iş", "Kalan iş", "Yanıt bekleyen alarm"]);
    expect(fill(tr["isyuku.units.ratio"], { patients: 3, nurses: 2 })).toBe("3 hasta / 2 hemşire");
    expect(tr["isyuku.units.noAssignment"]).toBe("Bu nöbet için atama yok");
    expect(tr["isyuku.units.otherRows"]).toBe("Nöbet saatleri değişti; bu nöbetin ataması yeniden yapılmalı.");
    expect(tr["isyuku.why.shiftChanged"]).toBe("nöbet değişti, yenileniyor");
    expect(tr["isyuku.nurses.note"]).toBe("Alfabetik; sıralama değildir");
    expect([tr["isyuku.form.current"], tr["isyuku.form.next"], tr["isyuku.form.save"]])
      .toEqual(["Bu nöbet", "Sonraki nöbet", "Kaydet"]);
    expect(tr["isyuku.err.conflict"]).toBe("Bu arada başka biri değiştirdi — liste yenilendi; yeniden bakın.");
    expect([tr["isyuku.form.unreached"], tr["isyuku.form.gone"]]).toEqual(["bu birimi göremez", "artık atanamaz"]);
    expect(fill(tr["isyuku.form.refused"], { reason: "x" })).toBe("Kaydedilmedi: x");
    expect(DICTIONARIES.az["isyuku.units.noAssignment"]).toBe("Bu növbə üçün təyinat yoxdur");
  });

  it("leaves out the prototype's figures that have no source", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of isyuku(lang)) {
        expect(value, `${lang} ${key}`)
          .not.toMatch(/Yeniden dağıtım|Yenidən bölgü|перераспредел|redistribut|yüksek risk|yüksək risk|высокий риск|high risk|saat başına|по часам|per hour|ortalamanın|× от среднего|the mean ×/i);
      }
    }
  });

  it("glues no suffix to a number, a time or a name in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of isyuku(lang)) {
        expect(value, `${lang} ${key}`).not.toMatch(/\{\w+\}[^\s·;,.:)–]/);
      }
    }
  });

  it("names the unit in the nurse cards' and the form's titles, in every language", () => {
    for (const lang of LANG_CODES) {
      for (const key of ["isyuku.nurses.title", "isyuku.form.title"]) {
        expect(DICTIONARIES[lang][key], `${lang} ${key}`).toContain("{unit}");
      }
    }
  });
});
