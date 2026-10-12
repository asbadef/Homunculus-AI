// Every key in all four languages, non-empty, with the Turkish source's placeholders — the same
// guarantee i18n.rbac.test.js gives the old workspace's rbac block.
import { describe, it, expect } from "vitest";
import { NAMESPACES, DICTIONARIES, buildDictionaries } from "./catalog.js";
import { LANG_CODES, SOURCE_LANG } from "./langs.js";

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
// Language-neutral texts: clinical abbreviations written the same in every script.
const NEUTRAL = new Set([
  "news2.missing.spo2", //        SpO2 — a clinical abbreviation, the same in every script
  // Wave 3's screens, one block per arm with a blank line either side: four parallel branches
  // adding to one Set conflict on every merge if their lines are adjacent. Each arm writes under
  // ITS OWN heading and leaves the blank lines alone. The `· neutral` suffix is what makes each
  // heading unique in this file — AZ_SAME_AS_TR below carries the same seven, suffixed `· az = tr`.
  // board (shared by the clinical screens, added with the first of them) · neutral
  "board.news2", //               NEWS2 — the score's own name, not translated anywhere
  "board.chSpo2", //              SpO2 again, on the board
  "board.unitPct", //             %   — a symbol, not a word, in every script this product speaks.
  "board.unitC", //               °C    (Russian writes mmHg and mmol/L out — "мм рт. ст.",
  //                                     "ммоль/л" — so those two are not here.)

  // G1-09 (beds) · neutral

  // G1-10 (alarms) · neutral

  // G1-11 (patient) · neutral
  "patient.sofa", //              SOFA — the same

  // admin (the frame, shared by the three tabs) · neutral
  "admin.refusedFor", //          "{subject}: {reason}"  — punctuation; the words are the halves'
  "admin.doneFor", //             "{subject} · {text}"   — the same

  // G1-12 (admin · users) · neutral
  "admin.colMfa", //              2FA — an abbreviation
  "admin.sourceLdap", //          AD — an abbreviation

  // G1-13 (admin · roles) · neutral
  "roles.cell", //                "{group} · {permission}" — punctuation; the two names are the words

  // G1-14 (admin · login source) · neutral

]);
// Azerbaijani and Turkish share many words, so an AZ text may equal its TR source — but that is
// also exactly what a forgotten translation looks like (the Turkish copied across). Each identity
// is therefore reviewed and listed here, key by key; a new one fails until someone has checked it,
// and an entry whose texts have since diverged fails until it is removed.
const AZ_SAME_AS_TR = new Set([
  "risk.critical", //        Kritik — the prototype's AZ dictionary (grafik.js gd_k_crit)
  "risk.prefix", //          Risk — the same word in Azerbaijani, Turkish and English
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
  "auth.copy", //            Kopyala — Azerbaijani imperative of "kopyalamaq"
  "auth.copied", //          Kopyalandı — its passive past
  "lock.unlock", //          Kilidi aç — the prototype's AZ dictionary (shell.js lk_open)
  "lock.critical", //        kritik — the prototype's AZ dictionary (shell.js lk_crit)
  "lock.moderate", //        orta — the prototype's AZ dictionary (shell.js lk_mid)
  "account.profile", //      Profil — the prototype's AZ dictionary (ayarlar.js st_profile)
  "account.source", //       Giriş — "sign-in" in Azerbaijani too (core.js signin: "Daxil ol" is the verb)
  "account.lock", //         Ekran kilidi — "screen lock" in Azerbaijani too (shell.js lk_title "Ekran kilidlənib")
  "nav.settings", //         Ayarlar — the prototype's AZ dictionary (core.js m_settings)
  "nav.settingsShort", //    Ayarlar — the same word
  // Wave 3's screens. Each branch adds ITS OWN lines under its own heading, so the three parallel
  // branches do not meet in the middle of this list. `· az = tr` distinguishes these headings from
  // NEUTRAL's identical seven, so each arm's anchor is unique in the file.

  // board (shared by the clinical screens) · az = tr
  "board.news2", //          NEWS2 — the score's own name
  "board.chSpo2", //         SpO2 — a clinical abbreviation
  "board.chMap", //          MAP — likewise (mean arterial pressure, written the same in AZ)
  "board.chLac", //          Laktat — the same word in Azerbaijani
  "board.unitPct", //        %      — a unit symbol, not a word (board.unitBpm is "/dəq" in AZ)
  "board.unitMmhg", //       mmHg
  "board.unitC", //          °C
  "board.unitMmol", //       mmol/L

  // G1-09 (beds) · az = tr
  "beds.viewCards", //       Kart — the prototype's AZ dictionary (screens.js, `Kart` / `Liste`)
  "beds.order", //           Sıralama — "ordering" in Azerbaijani too (sıralamaq)
  "beds.orderRisk", //       Risk sırası — the prototype's AZ section line ("risk sırasına görə")
  "beds.staleChannels", //   Gecikmiş kanal — "overdue channel" reads the same in Azerbaijani

  // G1-10 (alarms) · az = tr
  "alarms.criticalOnly", //  Yalnız kritik — the prototype's AZ dictionary (screens.js)
  "alarms.seen", //          Gördüm — the prototype's AZ dictionary (the acknowledge button)
  "alarms.seenBy", //        Gördü — the same verb, third person, in Azerbaijani too

  // G1-11 (patient) · az = tr
  "patient.sofa", //         SOFA — the score's own name
  "patient.baseline", //     Bazal SOFA — "baseline SOFA" reads the same in Azerbaijani
  "patient.seenBy", //       Gördü — the same verb as alarms.seenBy

  // admin (the frame, shared by the three tabs) · az = tr
  "admin.refusedFor", //     "{subject}: {reason}" — punctuation, no words of its own
  "admin.doneFor", //        "{subject} · {text}" — the same

  // G1-12 (admin · users) · az = tr
  "admin.filterRole", //     Rol — the prototype's AZ dictionary (admin.js)
  "admin.fieldRole", //      Rol — the same word
  "admin.colRole", //        Rol — the same word
  "admin.colName", //        Ad — "name" in Azerbaijani too
  "admin.colLastLogin", //   Son giriş — the prototype's AZ dictionary ("Son giriş")
  "admin.colMfa", //         2FA — an abbreviation
  "admin.sourceLdap", //     AD — an abbreviation
  "admin.resetMfa", //       2FA sıfırla — the abbreviation plus the same verb
  "admin.unlockSignIn", //   Girişi aç — the prototype's AZ dictionary ("Kilidi aç" family)
  "admin.fieldFullName", //  Ad soyad — the prototype's AZ dictionary (admin.js userModal)

  // G1-13 (admin · roles) · az = tr
  "roles.cell", //           "{group} · {permission}" — punctuation, no words of its own
  "roles.removed", //        "silindi." — the same past passive in Azerbaijani (the subject is doneFor's)

  // G1-14 (admin · login source) · az = tr
  "source.colName", //       Ad — "name" in Azerbaijani too (as admin.colName)
  "source.colChoose", //     Seç — the same imperative in Azerbaijani

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
