// src/live/screens/gorevler/taskModel.test.js — the pure helpers of Görevlerim (G3-02)
import { describe, it, expect } from "vitest";
import { counters, handStateOf, hourIndex, items, keep, myRole, sortItems } from "./taskModel.js";

const START = Date.parse("2026-11-09T04:00:00Z");           // 08:00 Baku
const NOW = Date.parse("2026-11-09T10:00:00Z");
const SETTINGS = { grace_min: 30, intervals: { b0: 720 } };
const P = {
  patient_id: "S-001", bed_key: "REA^01^2", unit_id: "REA-01",
  vital: { state: "late", anchor_at: "2026-11-08T20:00:00Z", due_at: "2026-11-09T08:00:00Z", band: "b0", interval_min: 720,
           partial: false, skipped_until: null, entries: ["2026-11-09T05:10:00Z"] },
  tasks: [
    { id: "t1", title: "Pansuman", due_at: "2026-11-09T06:00:00Z", target_role: "nurse", state: "open", late: true, claimed_by: null },
    { id: "t2", title: "Konsültasyon", due_at: "2026-11-09T12:00:00Z", target_role: "physician", state: "open", late: false, claimed_by: null },
    { id: "t3", title: "Yara", due_at: "2026-11-09T07:00:00Z", target_role: "any", state: "done", late: false, claimed_by: "hem.ayse" },
  ],
};

describe("taskModel", () => {
  it("buckets an instant into the shift's hour columns", () => {
    expect(hourIndex("2026-11-09T04:00:00Z", START)).toBe(0);
    expect(hourIndex("2026-11-09T05:59:00Z", START)).toBe(1);
    expect(hourIndex("2026-11-10T03:59:00Z", START)).toBe(23);
    expect(hourIndex("2026-11-10T04:00:00Z", START)).toBe(24);
  });
  it("derives a hand task's state from the server's flags and the clock", () => {
    expect(handStateOf(P.tasks[0], NOW, SETTINGS.grace_min)).toBe("late");
    expect(handStateOf(P.tasks[1], NOW, SETTINGS.grace_min)).toBe("plan");
    expect(handStateOf({ ...P.tasks[1], due_at: "2026-11-09T09:50:00Z" }, NOW, SETTINGS.grace_min)).toBe("due");
    expect(handStateOf(P.tasks[2], NOW, SETTINGS.grace_min)).toBe("done");
  });
  it("turns a patient's answer into items: the vital's entries as done, the vital itself, every hand task", () => {
    const got = items(P, NOW, SETTINGS.grace_min);
    expect(got.map((x) => [x.kind, x.state, hourIndex(x.at, START)])).toEqual([
      ["vital", "done", 1], ["vital", "late", 4], ["hand", "late", 2], ["hand", "plan", 8], ["hand", "done", 3],
    ].map(([k, s]) => [k, s, expect.any(Number)]));
  });
  it("counts this shift and filters by kind, lateness and role", () => {
    const got = items(P, NOW, SETTINGS.grace_min);
    expect(counters(got)).toEqual({ late: 2, due: 0, plan: 1, done: 2 });
    expect(got.filter((x) => keep(x, { kind: "hand", onlyLate: true, onlyMine: false }, "nurse")).map((x) => x.task.id)).toEqual(["t1"]);
    expect(got.filter((x) => keep(x, { kind: "all", onlyLate: false, onlyMine: true }, "nurse")).map((x) => x.kind + ":" + (x.task?.id ?? "v"))).toEqual(["vital:v", "vital:v", "hand:t1", "hand:t3"]);
    expect(sortItems(got.filter((x) => x.state !== "done")).map((x) => x.state)).toEqual(["late", "late", "plan"]);
  });
  it("reads the session's role from its default-group slugs", () => {
    expect(myRole([{ slug: "nurse" }])).toBe("nurse");
    expect(myRole([{ slug: "charge_nurse" }, { slug: "rapid_response" }])).toBe("nurse");
    expect(myRole([{ slug: "attending" }])).toBe("physician");
    expect(myRole([{ slug: "auditor" }])).toBe(null);
  });
});
