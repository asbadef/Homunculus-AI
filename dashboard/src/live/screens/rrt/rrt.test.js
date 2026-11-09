// rrt.test.js — the RRT screen's two lists from the board (G2-B5, spec D6, D7). Synthetic alarms.
import { describe, it, expect } from "vitest";
import { CONNECTION } from "../../../liveConnection.js";
import { rrtQueue } from "./rrt.js";

const alarm = (id, over = {}) => ({ id, patientId: id, kind: "k", severity: "high", urgency: "immediate",
  status: "FIRED", ack: null, rrtCall: null, escalated: false, firstSeenAtMs: 1000, ...over });
const live = (alerts) => ({ alerts, connection: CONNECTION.LIVE });

describe("the RRT queue", () => {
  it("lists the open calls, oldest call first, and the unanswered urgent alarms on their way", () => {
    const q = rrtQueue(live([
      alarm("A", { rrtCall: { by: "u1", atMs: 3000, reason: "r" } }),
      alarm("B", { rrtCall: { by: "u2", atMs: 2000, reason: "r" } }),
      alarm("C"),
      alarm("D", { urgency: "urgent" }),
      alarm("E", { ack: { by: "x" }, status: "ACKNOWLEDGED" }),
      alarm("F", { ack: { by: "x" }, status: "ACKNOWLEDGED", rrtCall: { by: "u3", atMs: 1000, reason: "r" } }),
    ]));
    expect(q.known).toBe(true);
    expect(q.called.map((a) => a.id)).toEqual(["B", "A"]);
    expect(q.waiting.map((a) => a.id)).toEqual(["C"]);
  });

  it("knows nothing when the board cannot be read", () => {
    expect(rrtQueue({ alerts: [alarm("A")], connection: CONNECTION.UNAVAILABLE }))
      .toMatchObject({ known: false, called: null, waiting: null });
  });

  // `waitingAlarms` (boardStore.js `knowing`): a DEGRADED board is what the screen last had — `stale`, not
  // `known` — and still lists; a CONNECTING one (like UNAVAILABLE) can say nothing, so its lists are null and no
  // empty list can pass for a quiet ward (Decision 18).
  it("lists what a stale board last had, marked stale and not known", () => {
    const q = rrtQueue({
      alerts: [alarm("A", { rrtCall: { by: "u1", atMs: 2000, reason: "r" } }), alarm("C")],
      connection: CONNECTION.DEGRADED,
    });
    expect(q).toMatchObject({ known: false, stale: true });
    expect(q.called.map((a) => a.id)).toEqual(["A"]);
    expect(q.waiting.map((a) => a.id)).toEqual(["C"]);
  });

  it("knows nothing while the board is still connecting", () => {
    expect(rrtQueue({ alerts: [alarm("A")], connection: CONNECTION.CONNECTING }))
      .toEqual({ known: false, stale: false, called: null, waiting: null });
  });
});
