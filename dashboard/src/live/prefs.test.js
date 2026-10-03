import { describe, it, expect, vi, afterEach } from "vitest";
import { readPref, writePref } from "./prefs.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("live UI preferences", () => {
  it("reads back what was written, under the hmc. prefix", () => {
    writePref("theme", "gun");
    expect(localStorage.getItem("hmc.theme")).toBe("gun");
    expect(readPref("theme", ["gece", "gun"], "gece")).toBe("gun");
  });

  it("falls back to the default when nothing is stored", () => {
    expect(readPref("theme", ["gece", "gun"], "gece")).toBe("gece");
  });

  it("ignores a stored value it does not recognise", () => {
    localStorage.setItem("hmc.lang", "TR"); // the prototype's spelling, not ours
    expect(readPref("lang", ["az", "tr", "ru", "en"], "az")).toBe("az");
    localStorage.setItem("hmc.lang", "de");
    expect(readPref("lang", ["az", "tr", "ru", "en"], "az")).toBe("az");
  });

  it("falls back to the default when storage refuses to be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readPref("theme", ["gece", "gun"], "gece")).toBe("gece");
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writePref("theme", "gun")).not.toThrow();
  });
});
