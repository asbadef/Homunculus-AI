// heat.test.js — the «Alarm yoğunluğu» box's rules (G2-B6, spec 2026-11-09): UTC hour starts to local hours (D2),
// rows of masked patients with 24 counts and a total, ordered and capped (D5), the four shading steps. Synthetic ids.
import { describe, it, expect } from "vitest";
import { HEAT_DAYS, HEAT_ROWS, HOURS, heatRows, heatStep, localHour } from "./heat.js";

const at = (h) => `2026-11-09T${String(h).padStart(2, "0")}:00:00+00:00`;

describe("the local hour of a UTC hour start", () => {
  it("is the browser's own hour of that instant, or null", () => {
    expect(localHour(at(10))).toBe(new Date(Date.UTC(2026, 10, 9, 10)).getHours());
    expect(localHour("not a time")).toBeNull();
    expect(localHour(undefined)).toBeNull();
    expect(HOURS).toEqual(Array.from({ length: 24 }, (_, h) => h));
    expect(HEAT_DAYS).toBe(7);
  });
});

describe("the rows (D5)", () => {
  it("sums each patient's cells into 24 local hours and a total, highest total first, masked", () => {
    const heat = heatRows({ per_patient_hour: [
      { patient_id: "260109001111", hour: at(9), episodes: 1 },
      { patient_id: "260109004821", hour: at(10), episodes: 2 },
      { patient_id: "260109004821", hour: at(11), episodes: 1 },
    ] });
    expect(heat.rows.map((r) => r.label)).toEqual(["••••4821", "••••1111"]);
    expect(heat.rows[0].counts).toHaveLength(24);
    expect(heat.rows[0].counts[localHour(at(10))]).toBe(2);
    expect(heat.rows[0].counts[localHour(at(11))]).toBe(1);
    expect(heat.rows[0].total).toBe(3);
    expect(heat.rows[0].counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(heat).toMatchObject({ total: 2, max: 2 });
  });

  it("keeps the server's order on a tie, and skips zero and malformed cells", () => {
    const heat = heatRows({ per_patient_hour: [
      { patient_id: "260109002222", hour: at(1), episodes: 1 },
      { patient_id: "260109003333", hour: at(2), episodes: 1 },
      { patient_id: "260109004444", hour: at(3), episodes: 0 },
      { patient_id: "260109005555", hour: "garbage", episodes: 4 },
      { patient_id: "260109006666", hour: at(4), episodes: "x" },
    ] });
    expect(heat.rows.map((r) => r.label)).toEqual(["••••2222", "••••3333"]);
    expect(heat.total).toBe(2);
  });

  it("shows at most 30 patients and says how many had any", () => {
    const cells = Array.from({ length: 31 }, (_, i) => ({
      patient_id: `SYN-${String(i).padStart(4, "0")}`, hour: at(i % 24), episodes: 1 + (i === 0 ? 5 : 0),
    }));
    const heat = heatRows({ per_patient_hour: cells });
    expect(HEAT_ROWS).toBe(30);
    expect(heat.rows).toHaveLength(30);
    expect(heat.total).toBe(31);
    expect(heat.rows[0].label).toBe("••••0000");
    expect(heat.max).toBe(6);
  });

  it("reads an answer without the breakdown as unreadable, and an empty one as no rows", () => {
    expect(heatRows(undefined)).toBeNull();
    expect(heatRows({ episodes: 3 })).toBeNull();
    expect(heatRows({ per_patient_hour: [] })).toEqual({ rows: [], total: 0, max: 0 });
  });
});

describe("the shading (D5)", () => {
  it("is four steps relative to the table's largest cell, never a threshold of its own", () => {
    expect(heatStep(0, 9)).toBe(0);
    expect(heatStep(3, 9)).toBe(1);
    expect(heatStep(4, 9)).toBe(2);
    expect(heatStep(7, 9)).toBe(3);
    expect(heatStep(9, 9)).toBe(3);
    expect(heatStep(1, 0)).toBe(0);
  });
});
