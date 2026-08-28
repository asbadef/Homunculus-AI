import { describe, it, expect } from "vitest";
import { CONNECTION, nextConnection, boardView } from "./liveConnection.js";

describe("nextConnection", () => {
  it("starts out connecting", () => {
    expect(nextConnection(undefined, { type: "start" })).toBe(CONNECTION.CONNECTING);
  });

  it("becomes live when the board loads", () => {
    expect(nextConnection(CONNECTION.CONNECTING, { type: "loaded" })).toBe(CONNECTION.LIVE);
  });

  it("degrades when the stream drops but data still arrives", () => {
    expect(nextConnection(CONNECTION.LIVE, { type: "stream-lost" })).toBe(CONNECTION.DEGRADED);
  });

  it("recovers to live when the stream reopens", () => {
    expect(nextConnection(CONNECTION.DEGRADED, { type: "stream-open" })).toBe(CONNECTION.LIVE);
  });

  it("becomes unavailable when a fetch fails", () => {
    expect(nextConnection(CONNECTION.LIVE, { type: "failed" })).toBe(CONNECTION.UNAVAILABLE);
  });

  it("keeps its current state for an unrecognised event", () => {
    expect(nextConnection(CONNECTION.LIVE, { type: "who-knows" })).toBe(CONNECTION.LIVE);
  });
});

describe("boardView", () => {
  it("shows patients when they are there", () => {
    const view = boardView(CONNECTION.LIVE, [{ patient_id: "bed-3" }]);
    expect(view.showList).toBe(true);
    expect(view.patients).toHaveLength(1);
    expect(view.notice).toBeNull();
  });

  it("says there are no patients when connected and the board is empty", () => {
    // A real answer, and it must not resemble a failure.
    const view = boardView(CONNECTION.LIVE, []);
    expect(view.showList).toBe(true);
    expect(view.notice).toMatch(/izlenen hasta yok/i);
    expect(view.isError).toBe(false);
  });

  it("SUPPRESSES the list when the backend is unreachable", () => {
    // An empty list reads as "nobody needs attention" — the most reassuring screen this system
    // can draw, and a lie at the exact moment it has stopped watching.
    const view = boardView(CONNECTION.UNAVAILABLE, []);
    expect(view.showList).toBe(false);
    expect(view.isError).toBe(true);
    expect(view.notice).toMatch(/bağlantı yok/i);
  });

  it("never yields patients it was handed while unreachable", () => {
    const view = boardView(CONNECTION.UNAVAILABLE, [{ patient_id: "stale" }]);
    expect(view.patients).toEqual([]);
  });

  it("says plainly that an unreachable board does not mean there are no patients", () => {
    // Whoever reads this screen must not walk away reassured.
    expect(boardView(CONNECTION.UNAVAILABLE, []).notice).toMatch(/anlamına gelmez/i);
  });

  it("keeps showing data while degraded, and says so", () => {
    const view = boardView(CONNECTION.DEGRADED, [{ patient_id: "bed-3" }]);
    expect(view.showList).toBe(true);
    expect(view.patients).toHaveLength(1);
    expect(view.notice).toMatch(/canlı akış/i);
    expect(view.isError).toBe(false);
  });

  it("hides the list while still connecting", () => {
    const view = boardView(CONNECTION.CONNECTING, []);
    expect(view.showList).toBe(false);
    expect(view.isError).toBe(false);
  });

  it("treats a null patient list as empty rather than crashing", () => {
    expect(boardView(CONNECTION.LIVE, null).patients).toEqual([]);
  });
});
