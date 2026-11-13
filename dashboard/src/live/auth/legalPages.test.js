import { describe, it, expect, afterEach } from "vitest";
import { flagSvg } from "../ui/Flag.jsx";
import { openLegal } from "./legalPages.js";

describe("flags and the prototype's legal pages", () => {
  afterEach(() => { delete window.H; });

  it("draws a flag for each UI language and nothing for an unknown one", () => {
    for (const code of ["az", "tr", "ru", "en", "AZ"]) expect(flagSvg(code)).toMatch(/^<svg /);
    expect(flagSvg("de")).toBe("");
  });

  it("never lets the support form claim a report reached IT: the honest line wins over legal.js's", async () => {
    // jsdom does not run the script; the shim is what is under test.
    openLegal("support", { lang: "tr", hospital: "Klinik Hastane" }).catch(() => {});
    const H = window.H;
    H.addT({ lgl_f_thx_h: { TR: "Teşekkürler, bildiriminiz alındı" } });
    expect(H.t("lgl_f_thx_h")).toBe("Bildirim henüz gönderilmiyor");
    expect(H.state.lang).toBe("TR");
    expect(H.icon("shield")).toMatch(/^<svg [^>]*><path d="M12 22s8-4/);
  });
});
