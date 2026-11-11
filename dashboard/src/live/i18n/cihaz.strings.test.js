// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): the device page's words (strings/cihaz.js) — the spec's own
// Turkish, one duration phrase for every sentence that has one, and the words that must not collide with the
// strip's below them (DevicesScreen.test.jsx finds those by text) or with the az word for an alarm.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));

describe("the device page's words (cihaz)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    const forOf = (n) => (n === 0 ? tr["cihaz.forUnderMinute"] : fill(tr["cihaz.forMinutes"], { n }));
    expect(tr["cihaz.title"]).toBe("Cihaz & Veri Akışı");
    expect([tr["cihaz.verdictTitle"], tr["cihaz.silentTitle"], tr["cihaz.staleTitle"], tr["cihaz.chainTitle"], tr["cihaz.neverTitle"]])
      .toEqual(["Veri geliyor mu?", "Sessiz monitörler", "Eskiyen kanallar", "Veri zinciri", "Tabloda var, hiç görülmedi"]);
    expect(fill(tr["cihaz.verdictForwarder"], { for: forOf(4) })).toBe("Veri gelmiyor: aktarıcı 4 dk'dır sessiz");
    expect(tr["cihaz.verdictCollector"]).toBe("Veri gelmiyor: toplayıcı bağlı değil");
    expect(tr["cihaz.verdictNever"]).toBe("Henüz hiç veri gelmedi");
    expect(fill(tr["cihaz.verdictFlowing"], { streaming: 3, total: 5 })).toBe("Veri akıyor · 3/5 monitör veri gönderiyor");
    expect(fill(tr["cihaz.watchingSince"], { time: "10:42" })).toBe("İzleme 10:42'den beri; sistem yeniden başlayınca sıfırlanır");
    expect(fill(tr["cihaz.silentFor"], { for: forOf(4), time: "10:42" })).toBe("4 dk'dır veri yok · son veri 10:42");
    expect(fill(tr["cihaz.silentFor"], { for: forOf(0), time: "10:42" })).toBe("<1 dk'dır veri yok · son veri 10:42");
    expect(tr["cihaz.vanished"]).toBe("hub artık bildirmiyor");
    expect([tr["cihaz.silentNone"], tr["cihaz.staleNone"]]).toEqual(["Sessiz monitör yok", "Eskiyen kanal yok"]);
    expect(fill(tr["cihaz.staleChannel"], { channel: "SpO₂", for: forOf(4) })).toBe("SpO₂ · 4 dk'dır değer yok");
    expect(fill(tr["cihaz.staleLongCount"], { n: 2 })).toBe("2 kanal 1 saatten uzun süredir değer göndermiyor (çıkarılmış olabilir)");
    expect(fill(tr["cihaz.notFresh"], { time: "10:42" })).toBe("Pano güncel değil · 10:42");
  });

  it("never says the data flows on a zero, and says why a list cannot be drawn rather than calling it empty", () => {
    const tr = DICTIONARIES.tr;
    expect(tr["cihaz.verdictNoneSending"]).toBe("Zincir çalışıyor, ama hiçbir monitör veri göndermiyor");
    expect(tr["cihaz.verdictNoMonitors"]).toBe("Hub hiç monitör bildirmiyor");
    expect(tr["cihaz.verdictCountsUnknown"]).toBe("Zincir çalışıyor; monitör sayıları okunamıyor");
    expect(tr["cihaz.listNoLedger"]).toBe("Bu sürüm «ne zamandan beri» bilgisini vermiyor");
    for (const lang of LANG_CODES) {
      const d = DICTIONARIES[lang];
      // A reason is never the «none» sentence of the list it stands in for.
      for (const key of ["cihaz.listUnknown", "cihaz.listNoMonitors", "cihaz.listNoLedger", "cihaz.listNoClock", "cihaz.chainBlocks"]) {
        expect(d[key], `${lang} ${key}`).toBeTruthy();
        expect([d["cihaz.silentNone"], d["cihaz.staleNone"]], `${lang} ${key}`).not.toContain(d[key]);
      }
    }
  });

  it("carries a duration as one phrase, in every language", () => {
    for (const lang of LANG_CODES) {
      const d = DICTIONARIES[lang];
      for (const key of ["cihaz.verdictForwarder", "cihaz.silentFor", "cihaz.staleChannel"]) expect(d[key], `${lang} ${key}`).toContain("{for}");
      expect(d["cihaz.forMinutes"], lang).toContain("{n}");
      expect(d["cihaz.staleLongCount"], lang).toContain("{n}");          // the closing count of D4's amendment
      expect(d["cihaz.forUnderMinute"], lang).toMatch(/^<1 /);
    }
  });

  it("leaves the strip's own words to the strip, and never calls the az heartbeat «siqnal»", () => {
    const az = DICTIONARIES.az;
    expect(az["cihaz.verdictFlowing"]).not.toMatch(/məlumat göndərir/);      // the strip's chip (DevicesScreen.test.jsx)
    expect(az["cihaz.chainRejected"]).not.toMatch(/rədd edilən oxunuş/i);    // the strip's monitor.feedRejected
    expect(az["cihaz.chainForwarder"]).not.toMatch(/Alınan göndəriş/);       // the strip's monitor.feedPosts
    for (const key of ["cihaz.chainCollector", "cihaz.chainCollectorNone"]) expect(az[key]).not.toMatch(/siqnal/i);
  });

  it("names the rail entry «Cihazlar», and every text that names the screen follows it", () => {
    expect(LANG_CODES.map((lang) => DICTIONARIES[lang]["nav.devices"])).toEqual(
      LANG_CODES.map((lang) => ({ tr: "Cihazlar", az: "Cihazlar", ru: "Устройства", en: "Devices" })[lang]));
    for (const lang of LANG_CODES) {
      const d = DICTIONARIES[lang];
      expect(d["nav.devicesShort"], lang).toBe(d["nav.devices"]);
      for (const key of ["kabul.err.bedHasMonitor", "perms.devices.map_beds"]) {
        expect(d[key], `${lang} ${key}`).toContain(d["nav.devices"]);
        expect(d[key], `${lang} ${key}`).not.toMatch(/Monitörler|Monitorlar|Мониторы|Monitors/);
      }
      // devices.manage opens a screen now: the login screen's «only device management» example is gone.
      expect(d["auth.notice.noScreen"], lang).not.toMatch(/cihaz|устройств|device/i);
    }
  });
});
