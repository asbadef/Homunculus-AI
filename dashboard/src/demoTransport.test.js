import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeDemoTransport } from "./demoTransport.js";

const timeline = {
  scenario: "t", step_seconds: 0.01,
  frames: [
    { t: 0, boards: [{ patient_id: "bed-3", risk: "none", latest: { sofa: 0 }, alerts: [] }], notifications: [] },
    { t: 1, boards: [{ patient_id: "bed-3", risk: "critical", latest: { sofa: 8 },
        alerts: [{ kind: "septic_shock", severity: "critical", urgency: "immediate", summary: "Septik şok",
                   clinical_reasoning: "r", supporting_evidence: ["s"], recommended_actions: ["Review."],
                   confidence: "c", acknowledged: false, escalated: false, stale_inputs: [] }] }],
      notifications: [{ patient_id: "bed-3", kind: "septic_shock", audience: "nurse", trigger: "new",
                        title: "Yeni uyarı", body: "bed-3: Septik şok", ts: "t" }] },
  ],
  notification_history: [{ id: 1, ts: "t", patient_id: "bed-3", subject: "septic_shock",
                           payload: { trigger: "new", audience: "nurse" } }],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("demoTransport", () => {
  it("fetchBoard returns the first frame's boards", async () => {
    const t = makeDemoTransport(timeline);
    expect(await t.fetchBoard()).toEqual(timeline.frames[0].boards);
  });

  it("openStream emits later frames on the timer", () => {
    const t = makeDemoTransport(timeline);
    const updates = [];
    t.openStream("tok", (b) => updates.push(b), () => {});
    vi.advanceTimersByTime(1000);
    expect(updates.some((b) => b.risk === "critical")).toBe(true);
  });

  it("openNotifications filters by role", () => {
    const t = makeDemoTransport(timeline);
    const nurse = [];
    t.openNotifications("tok", "nurse", (n) => nurse.push(n));
    t.openNotifications("tok", "doctor", () => { throw new Error("doctor should get none here"); });
    vi.advanceTimersByTime(1000);
    expect(nurse).toHaveLength(1);
  });

  it("ackAlert flips acknowledged client-side", async () => {
    const t = makeDemoTransport(timeline);
    await t.fetchBoard();
    t.openStream("tok", () => {}, () => {});
    vi.advanceTimersByTime(1000);
    const board = await t.ackAlert("tok", "bed-3", "septic_shock", "doctor");
    const a = board.alerts.find((x) => x.kind === "septic_shock");
    expect(a.acknowledged).toBe(true);
    expect(a.acknowledged_by).toBe("doctor");
  });

  it("fetchAudit returns the notification history", async () => {
    const t = makeDemoTransport(timeline);
    expect(await t.fetchAudit("tok", { eventType: "notification" })).toEqual(timeline.notification_history);
  });
});
