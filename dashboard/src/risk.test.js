import { describe, it, expect } from "vitest";
import { riskLabel, riskColor } from "./risk.js";

describe("risk", () => {
  it("maps each risk level to a Turkish label", () => {
    expect(riskLabel("critical")).toBe("Kritik");
    expect(riskLabel("high")).toBe("Yüksek");
    expect(riskLabel("moderate")).toBe("Orta");
    expect(riskLabel("none")).toBe("Stabil");
  });
  it("maps high and critical to red, moderate to amber, none to green", () => {
    expect(riskColor("critical")).toBe("#c0392b");
    expect(riskColor("high")).toBe("#c0392b");
    expect(riskColor("moderate")).toBe("#e0a800");
    expect(riskColor("none")).toBe("#2e7d32");
  });
});
