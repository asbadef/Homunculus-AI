// Which waiting alarm sounds, and which raises a notification — the ONE copy of that mapping
// (amendments, (e)). What the previous workspace did is the reference (ClinicalDemo.jsx and
// liveAdapters.js at e4cdf15): an unacknowledged alarm sounded by its tier — critical, high and
// moderate each with their own pattern, low and info never — and only a critical one raised a
// notification. Synthetic patients only.
import { describe, it, expect } from "vitest";
import { CONNECTION } from "../../liveConnection.js";
import { alertsFromPatients, patientsFromBoard } from "../../liveAdapters.js";
import { alarm, board, entry } from "../data/board.testutil.js";
import { PATTERNS, notifyFor, patternOf, soundFor } from "./signals.js";

/** The board's state as `useBoard()` gives it: each alarm on its own synthetic patient. `loaded`:
 *  the board holds a ward it loaded (boardStore.js) — false for one whose load failed or never ran. */
const ward = (alarms, connection = CONNECTION.LIVE, loaded = true) => ({
  alerts: alertsFromPatients(patientsFromBoard(board(alarms.map((a, i) => entry(`S-00${i + 1}`, [a]))))),
  connection,
  loaded,
});

describe("the pattern an alarm asks for", () => {
  it("maps the engine's severity as the previous workspace did: three patterns, low and info silent", () => {
    expect(PATTERNS).toEqual(["critical", "high", "moderate"]);
    expect(patternOf({ severity: "critical" })).toBe("critical");
    expect(patternOf({ severity: "high" })).toBe("high");
    expect(patternOf({ severity: "moderate" })).toBe("moderate");
    expect(patternOf({ severity: "low" })).toBeNull();
    expect(patternOf({ severity: "info" })).toBeNull();
  });

  // The previous workspace was silent here (its tier was null). This build reads a severity it
  // cannot account for as possibly the worst — SEVERITY_ORDER sorts it first, the bell counts it —
  // and a ward PC that stays quiet for a possibly-critical alarm is the worse failure of the two.
  it("sounds a severity this build does not know, or none, as critical", () => {
    expect(patternOf({ severity: "catastrophic" })).toBe("critical");
    expect(patternOf({ severity: null })).toBe("critical");
    expect(patternOf({})).toBe("critical");
  });
});

describe("what the page plays", () => {
  it("plays the worst pattern among the alarms nobody has answered", () => {
    expect(soundFor(ward([alarm("a", "moderate"), alarm("b", "high")]))).toBe("high");
    expect(soundFor(ward([alarm("a", "high"), alarm("b", "critical"), alarm("c", "low")]))).toBe("critical");
    expect(soundFor(ward([alarm("a", "low"), alarm("b", "info")]))).toBeNull();
  });

  it("is silent for an acknowledged alarm — and for a chronic-expected low one", () => {
    expect(soundFor(ward([alarm("a", "critical", { acknowledged: true, acknowledged_by: "ayse" })]))).toBeNull();
    expect(soundFor(ward([alarm("a", "moderate", { downgraded: true })]))).toBeNull();
  });

  it("still sounds a downgraded critical or high: the waiting queue's floor", () => {
    expect(soundFor(ward([alarm("a", "critical", { downgraded: true })]))).toBe("critical");
    expect(soundFor(ward([alarm("a", "high", { downgraded: true })]))).toBe("high");
  });

  // The previous workspace's store KEPT its alarms when the stream dropped, and went on sounding
  // them; it emptied them only when a load failed or the session ended. The same here: a DEGRADED
  // board plays what it last had, a board that cannot say what is open plays nothing.
  it("plays on a board whose stream dropped, and nothing on one that cannot say what is open", () => {
    const open = [alarm("a", "critical")];
    expect(soundFor(ward(open, CONNECTION.DEGRADED))).toBe("critical");
    expect(soundFor(ward(open, CONNECTION.CONNECTING, false))).toBeNull();
    expect(soundFor(ward(open, CONNECTION.UNAVAILABLE, false))).toBeNull();
    expect(soundFor({})).toBeNull();
  });

  // The previous workspace sounded its first load. This board loads first and opens its stream
  // after (boardStore.js `start`): until the stream's own reload lands it is still CONNECTING —
  // one round trip, or up to 45 s when the stream never opens — with a ward it did load.
  it("plays a board still connecting once its first load has landed", () => {
    expect(soundFor(ward([alarm("a", "critical")], CONNECTION.CONNECTING))).toBe("critical");
    const { known, items } = notifyFor(ward([alarm("a", "critical")], CONNECTION.CONNECTING));
    expect(known).toBe(false);
    expect(items).toHaveLength(1);
  });

  // Escalation (the engine's own, server-side) is not an answer: the old build sounded an escalated
  // alarm nobody had acknowledged, and so does this one.
  it("sounds and notifies an escalated alarm nobody has answered", () => {
    const escalated = ward([alarm("a", "critical", { escalated: true })]);
    expect(soundFor(escalated)).toBe("critical");
    expect(notifyFor(escalated).items.map((a) => a.id)).toEqual(["S-001::a"]);
  });

  // G2-A1 (O17): a critical whose rule stopped before anyone acknowledged it still waits for its
  // answer, but it rings no more — the sound and the vibration stop at resolve (D11).
  it("is silent for a RESOLVED alarm that still waits, and plays what still fires", () => {
    const passed = alarm("a", "critical", { resolved_at: "2026-10-08T09:59:00Z" });
    expect(soundFor(ward([passed]))).toBeNull();
    expect(soundFor(ward([passed, alarm("b", "moderate")]))).toBe("moderate");
  });
});

describe("what raises a notification", () => {
  it("only a waiting alarm whose pattern is critical, each by its own id", () => {
    const { items, known } = notifyFor(ward([
      alarm("a", "critical"), alarm("b", "high"), alarm("c", "critical", { acknowledged: true }), alarm("d", "mystery"),
    ]));
    expect(known).toBe(true);
    expect(items.map((a) => a.id)).toEqual(["S-004::d", "S-001::a"]);
  });

  it("names nothing it cannot know, and says whether the board is LIVE", () => {
    expect(notifyFor(ward([alarm("a", "critical")], CONNECTION.UNAVAILABLE, false))).toEqual({ known: false, items: [], ringing: [] });
    const stale = notifyFor(ward([alarm("a", "critical")], CONNECTION.DEGRADED));
    expect(stale.known).toBe(false);
    expect(stale.items).toHaveLength(1);
  });

  it("keeps a RESOLVED alarm among those that wait, but raises no new notification for it", () => {
    const { items, ringing } = notifyFor(ward([
      alarm("a", "critical", { resolved_at: "2026-10-08T09:59:00Z" }), alarm("b", "critical"),
    ]));
    // Same severity and age: the one that still fires comes first (boardStore `queue`).
    expect(items.map((a) => a.id)).toEqual(["S-002::b", "S-001::a"]);
    expect(ringing.map((a) => a.id)).toEqual(["S-002::b"]);
  });
});
