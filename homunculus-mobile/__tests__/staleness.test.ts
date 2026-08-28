/// <reference types="jest" />
import { localizeStaleInput, staleLabel, ageLabel } from "../src/domain/staleness";

describe("localizeStaleInput", () => {
  it("translates the engine's labels", () => {
    expect(localizeStaleInput("creatinine")).toBe("kreatinin");
    expect(localizeStaleInput("MAP")).toBe("OAB");
  });

  it("passes an unknown label through untouched rather than guessing", () => {
    expect(localizeStaleInput("procalcitonin")).toBe("procalcitonin");
  });

  it("translates NEWS2's vital labels too", () => {
    expect(localizeStaleInput("systolic BP")).toBe("sistolik KB");
  });
});

describe("ageLabel", () => {
  it("reads in minutes below an hour and hours above it", () => {
    expect(ageLabel(45 * 60 * 1000)).toBe("45 dk");
    expect(ageLabel(4 * 60 * 60 * 1000)).toBe("4 sa");
    expect(ageLabel(90 * 60 * 1000)).toBe("1 sa");
  });

  it("switches to hours exactly at the hour", () => {
    expect(ageLabel(59 * 60 * 1000)).toBe("59 dk");
    expect(ageLabel(60 * 60 * 1000)).toBe("1 sa");
  });
});

describe("staleLabel", () => {
  it("is null when nothing is stale, so the badge never renders empty", () => {
    expect(staleLabel([])).toBeNull();
  });

  it("joins the localized names in the order the engine gave them (oldest first)", () => {
    expect(staleLabel(["creatinine", "MAP"])).toBe("kreatinin, OAB");
  });

  it("appends an age only where one is supplied", () => {
    expect(staleLabel(["creatinine"], { creatinine: 14 * 60 * 60 * 1000 })).toBe("kreatinin · 14 sa");
  });
});
