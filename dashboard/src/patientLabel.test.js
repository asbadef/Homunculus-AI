/**
 * Barkod etiketi — kodlamanın yapısal doğrulaması ve "uydurma alan basma" kuralı.
 *
 * Bir barkod tablosu veri olduğu için gözle doğrulanamaz; ama Code 128'in iki değişmezi
 * tablodaki bir yazım hatasını neredeyse kesin yakalar: her desen 11 modüldür (STOP 13) ve
 * hiçbir desen bir başkasıyla aynı olamaz. Checksum ayrıca bilinen bir örnekle sınanır.
 */
import { describe, it, expect, vi } from "vitest";
import {
  CODE128_PATTERNS, CODE128_START_B, CODE128_STOP,
  code128Values, code128Svg, code128Encodable,
  labelLines, labelSafetyChips, formatBirthDate, printPatientLabel,
} from "./patientLabel.js";

const S = {
  pr19: {
    labelProtocolNo: "Protokol No", labelPatientNo: "Hasta No", labelName: "Adı Soyadı",
    labelStamp: "Protokol Tarihi", labelBirthDate: "Doğum Tarihi", labelDepartment: "Bölüm",
    labelPhysician: "Doktor", labelBed: "Yatak", labelTitle: "Hasta Etiketi",
    allergies: "Alerjiler", bloodType: "Kan Grubu",
    isoContact: "Temas İzolasyonu", isoDroplet: "Damlacık İzolasyonu", isoAirborne: "Solunum İzolasyonu",
    codeDnr: "DNR (Resüsitasyon Yok)", codeLimited: "Sınırlı Girişim",
  },
};

describe("Code 128 tablosu", () => {
  it("107 desen içerir (0–102 veri, 103–105 start, 106 stop)", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it("her desen 11 modüldür; STOP 13 modüldür", () => {
    CODE128_PATTERNS.forEach((pattern, value) => {
      const modules = [...pattern].reduce((a, c) => a + Number(c), 0);
      const elements = pattern.length;
      if (value === CODE128_STOP) {
        expect({ value, modules, elements }).toEqual({ value, modules: 13, elements: 7 });
      } else {
        expect({ value, modules, elements }).toEqual({ value, modules: 11, elements: 6 });
      }
    });
  });

  it("hiçbir desen tekrarlanmaz", () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length);
  });

  it("START B ve STOP standarttaki desenlerdir", () => {
    expect(CODE128_PATTERNS[CODE128_START_B]).toBe("211214");
    expect(CODE128_PATTERNS[CODE128_STOP]).toBe("2331112");
  });
});

describe("code128Values", () => {
  it("bilinen örnek: CODE128 → kontrol karakteri 26", () => {
    const v = code128Values("CODE128");
    expect(v[0]).toBe(CODE128_START_B);
    expect(v.at(-1)).toBe(CODE128_STOP);
    expect(v.at(-2)).toBe(26);
    expect(v.slice(1, -2)).toEqual([35, 47, 36, 37, 17, 18, 24]);
  });

  it("protokol numarasının bölü işaretini kodlayabilir", () => {
    expect(code128Encodable("2025/0004821")).toBe(true);
    expect(code128Values("2025/0004821")).not.toBeNull();
  });

  it("kodlanamayan karakterde barkod üretmez — yanlış barkod basmaktansa hiç basmaz", () => {
    // Türkçe 'İ' Code 128 B'de yoktur; zorlanırsa tarayıcı başka bir karakter okur.
    expect(code128Values("İK-1")).toBeNull();
    expect(code128Svg("İK-1")).toBeNull();
    expect(code128Values("")).toBeNull();
  });

  it("SVG üretir ve sessiz alanı korur", () => {
    const svg = code128Svg("P-001", { module: 2, height: 40, quiet: 10 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('<rect x="10"');   // ilk bar sessiz alandan sonra başlar
  });
});

describe("labelLines", () => {
  const patient = {
    protocolNo: "2025/0004821", mrn: "MRN-100012", display_name: "Bərxudar Zeynalov",
    admittedAtMs: Date.UTC(2026, 8, 16, 12, 2), birthDate: "1963-10-22", bedLabel: "ICU-07",
  };

  it("hastane etiketindeki sırayı korur", () => {
    const lines = labelLines(patient, { S, unitName: "Anesteziyoloji ve YBÜ", attendingName: "Dr. Təranə Göyüşova" });
    expect(lines.map((l) => l.label)).toEqual([
      "Protokol No", "Hasta No", "Adı Soyadı", "Protokol Tarihi", "Doğum Tarihi", "Bölüm", "Doktor", "Yatak",
    ]);
    expect(lines.find((l) => l.label === "Doğum Tarihi").value).toBe("22.10.1963");
  });

  it("bilinmeyen alan satırıyla birlikte düşer — boş değer 'yok' diye basılmaz", () => {
    const lines = labelLines({ ...patient, birthDate: null }, { S, unitName: null, attendingName: null });
    const labels = lines.map((l) => l.label);
    expect(labels).not.toContain("Doğum Tarihi");
    expect(labels).not.toContain("Doktor");
    expect(labels).not.toContain("Bölüm");
    expect(labels).toContain("Protokol No");
  });

  it("ayrıştırılamayan doğum tarihi basılmaz", () => {
    expect(formatBirthDate("bilinmiyor")).toBeNull();
    expect(formatBirthDate(null)).toBeNull();
  });
});

describe("labelSafetyChips", () => {
  it("yalnızca girilmiş güvenlik bilgisini gösterir", () => {
    const chips = labelSafetyChips(
      { allergies: "Penisilin", isolation: "contact", codeStatus: "dnr", bloodType: "A Rh+" }, { S });
    expect(chips.map((c) => c.kind)).toEqual(["allergy", "isolation", "code", "blood"]);
    expect(chips[0].text).toBe("Alerjiler: Penisilin");
  });

  it("boş alerji kutusu 'alerji yok' anlamına gelmez — hiç basılmaz", () => {
    const chips = labelSafetyChips({ allergies: "  ", isolation: "none", codeStatus: "full" }, { S });
    expect(chips).toEqual([]);
  });
});

describe("printPatientLabel", () => {
  it("adı maskelemeden basar — maskeli bileklik yanlış hasta riskini azaltmaz", () => {
    let html = "";
    const doc = { write: (s) => { html += s; }, close: vi.fn() };
    const win = { open: () => ({ document: doc, focus: vi.fn(), print: vi.fn() }) };
    const ok = printPatientLabel({
      S, win, lang: "tr", unitName: "Erişkin YBÜ", attendingName: "Dr. Ada Yılmaz",
      patient: { protocolNo: "2025/0004821", display_name: "Bərxudar Zeynalov", bedLabel: "ICU-07",
                 admittedAtMs: Date.now(), allergies: "Penisilin" },
    });
    expect(ok).toBe(true);
    expect(html).toContain("Bərxudar Zeynalov");
    expect(html).toContain("<svg");
    expect(html).toContain("Penisilin");
  });

  it("açılır pencere engellendiğinde sessizce başarısız olur", () => {
    expect(printPatientLabel({ S, win: { open: () => null }, patient: { protocolNo: "X" } })).toBe(false);
  });
});
