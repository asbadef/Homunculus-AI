/// <reference types="jest" />
import { createReplayTransport } from "../src/transport/replayTransport";
import type { PatientBoard, Recording } from "../src/transport/types";

function board(id: string, sofa: number): PatientBoard {
  return {
    patient_id: id, risk: "none", alerts: [],
    latest: { heart_rate: null, map: null, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa },
  };
}

const recording: Recording = {
  scenario: "test",
  step_seconds: 1,
  frames: [
    { t: 0, boards: [board("bed-3", 0), board("bed-5", 0)], notifications: [] },
    { t: 1, boards: [board("bed-3", 2)], notifications: [] },
    {
      t: 2,
      boards: [board("bed-3", 6)],
      notifications: [{
        tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
        urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
        body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
      }],
    },
  ],
};

/** Deterministic scheduler: no real timers, no waiting. */
function fakeClock() {
  let time = 0;
  let nextId = 1;
  let queue: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      queue.push({ id, at: time + ms, fn });
      return id;
    },
    clearTimer: (id: number) => {
      queue = queue.filter((entry) => entry.id !== id);
    },
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        time = next.at;
        next.fn();
      }
      time = target;
    },
  };
}

function harness(speed = 1) {
  const clock = fakeClock();
  const boards: PatientBoard[] = [];
  const notes: string[] = [];
  let loops = 0;
  const transport = createReplayTransport({
    recording, speed,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  const unsubscribe = transport.subscribe({
    onBoard: (b) => boards.push(b),
    onNotification: (n) => notes.push(n.kind),
    onLoop: () => { loops += 1; },
  });
  return { clock, transport, boards, notes, unsubscribe, loops: () => loops };
}

describe("createReplayTransport", () => {
  it("emits every board of the first frame as soon as it starts", () => {
    const h = harness();
    h.transport.start();
    expect(h.boards.map((b) => b.patient_id)).toEqual(["bed-3", "bed-5"]);
  });

  it("emits the next frame one step later", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(1000);
    expect(h.boards.at(-1)!.latest.sofa).toBe(2);
  });

  it("emits the frame's notifications with it", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(2000);
    expect(h.notes).toEqual(["septic_shock"]);
  });

  it("halves the interval at double speed", () => {
    const h = harness(2);
    h.transport.start();
    h.clock.advance(500);
    expect(h.boards.at(-1)!.latest.sofa).toBe(2);
  });

  it("loops back to the first frame after the last", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(3000);
    expect(h.loops()).toBe(1);
    expect(h.boards.at(-1)!.latest.sofa).toBe(0);
  });

  it("stops emitting while paused and resumes on play", () => {
    const h = harness();
    h.transport.start();
    h.transport.pause();
    const count = h.boards.length;
    h.clock.advance(5000);
    expect(h.boards.length).toBe(count);
    h.transport.play();
    h.clock.advance(1000);
    expect(h.boards.length).toBeGreaterThan(count);
  });

  it("restarts from the first frame and reports the loop", () => {
    const h = harness();
    h.transport.start();
    h.clock.advance(1000);
    h.transport.restart();
    expect(h.loops()).toBe(1);
    expect(h.boards.at(-1)!.latest.sofa).toBe(0);
  });

  it("delivers nothing after unsubscribe", () => {
    const h = harness();
    h.transport.start();
    h.unsubscribe();
    const count = h.boards.length;
    h.clock.advance(1000);
    expect(h.boards.length).toBe(count);
  });

  it("resolves ack without a server", async () => {
    const h = harness();
    await expect(h.transport.ack("bed-3", "septic_shock", "nurse")).resolves.toBeUndefined();
  });
});
