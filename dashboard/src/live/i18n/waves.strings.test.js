// The waveform panel's words (Lane C, dalga). Completeness — four languages, the same keys, the
// Turkish placeholders — is strings.test.js's, for every namespace in the catalogue; this holds what
// is particular to these: the stamp is the spec's sentence, a stall says its age, no ECG lead is
// named, and Azerbaijani "no signal" does not use the interface's word for an alarm.
import { describe, it, expect } from "vitest";
import { DICTIONARIES, NAMESPACES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

describe("the waveform panel's words", () => {
  it("are in the catalogue, in every language", () => {
    expect(NAMESPACES.waves).toBeDefined();
    for (const lang of LANG_CODES) {
      for (const key of ["stamp", "delay", "noSignal", "stalled", "cleared", "ecg", "ecgLead"]) {
        expect(DICTIONARIES[lang][`waves.${key}`], `${lang} ${key}`).toBeTruthy();
      }
    }
  });

  it("stamp the panel with the spec's sentence (§5.1) and the delay (§4)", () => {
    expect(DICTIONARIES.tr["waves.stamp"]).toBe("Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür");
    expect(DICTIONARIES.tr["waves.delay"]).toBe("≈ 2 sn gecikmeli");
    expect(DICTIONARIES.tr["waves.noSignal"]).toBe("sinyal yok");
    expect(DICTIONARIES.tr["waves.stalled"]).toBe("akış durdu · {seconds} sn");
  });

  it("say how long a stopped stream has been silent, in every language", () => {
    for (const lang of LANG_CODES) {
      expect(DICTIONARIES[lang]["waves.stalled"], lang).toContain("{seconds}");
      expect(DICTIONARIES[lang]["waves.cleared"], lang).toContain("{seconds}");
    }
  });

  it("name no ECG lead (BED08: the live channel is not fixed by id)", () => {
    for (const lang of LANG_CODES) {
      const words = Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("waves.")).map(([, v]) => v);
      expect(words.join(" "), lang).not.toMatch(/\b(II|III|aVR|aVL|aVF|V[1-6])\b/);
    }
  });

  it("do not say 'no signal' in Azerbaijani with the word this interface uses for an alarm", () => {
    expect(DICTIONARIES.az["waves.noSignal"].toLowerCase()).not.toContain("siqnal");
  });
});
