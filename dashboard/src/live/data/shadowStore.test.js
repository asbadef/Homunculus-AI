// The shadow store (Aşama A's unvalidated monitor strip): polled only while something on screen
// shows it, never for a session that may not read it, and connected to nothing that alarms.
// Synthetic boards only (board.testutil.js) and synthetic addresses (192.0.2.x).
import { describe, it, expect, vi } from "vitest";
import { POLL_MS, SHADOW_PHASE, createShadowStore, mayReadShadow } from "./shadowStore.js";
import { alarmCounts, alarmsToSignal, createBoardStore, lockSummary, waitingAlarms } from "./boardStore.js";
import { alarm, board, entry } from "./board.testutil.js";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A timer queue the test fires by hand: what is due, and at what delay it was set. */
function manualTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => { seq += 1; pending.set(seq, { fn, ms }); return seq; },
    clearTimer: (id) => { pending.delete(id); },
    get delays() { return [...pending.values()].map((p) => p.ms); },
    async fire() {
      const due = [...pending.values()];
      pending.clear();
      for (const p of due) p.fn();
      await settle();
    },
  };
}

/** A strip answer with a linked bed whose values would raise every alarm if they were clinical. */
const SHADOW = Object.freeze({
  stage: "shadow", display_max_age_s: 15, generated_at: "2026-10-08T10:00:00+00:00",
  table: { status: "ok", reason: null, version: 1, sha256: "a".repeat(64), approved_at: "2026-10-07", site: "synthetic" },
  feed: { state: "ok", last_post_age_s: 2, collector_connected: true, posts: 3,
    devices: { total: 1, streaming: 1, standby: 0, silent: 0, waiting: 0, unsupported: 0, unknown: 0 },
    unassigned: 0, lag_ms: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  beds: [{ bed_label: "REA-01 · 2", bed_id: "REA-01-2", unit_id: "REA-01", source: "192.0.2.10", link: "one",
    patient_id: "S-001", status: "streaming", status_age_s: 2, packet_age_ms: 100,
    parameters: [{ parameter: "hr", state: "value", value: 180, unit: "bpm", age_s: 2, evidence: "screen_match_two_devices", partial: false },
      { parameter: "spo2", state: "value", value: 70, unit: "%", age_s: 2, evidence: "screen_match_two_devices", partial: false }] }],
  unassigned: [],
});

function harness({ answer = () => SHADOW, visible = true, track } = {}) {
  const timers = manualTimers();
  let shown = visible;
  const watchers = new Set();
  const clock = { t: 1_000_000 };
  const api = { shadowBoard: vi.fn(async () => answer()) };
  const store = createShadowStore({
    api, track, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => shown,
    onVisibility: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    now: () => clock.t,
  });
  const show = async (value) => {
    shown = value;
    for (const fn of watchers) fn();
    await settle();
  };
  return { api, store, timers, show, clock, watchers };
}

const NURSE = ["board.view", "alerts.ack"];

describe("the shadow store polls only while the strip is on screen", () => {
  it("fetches nothing before start(), nor after start() with nothing on screen", async () => {
    const { api, store } = harness();
    store.acquire();
    await settle();
    expect(api.shadowBoard).not.toHaveBeenCalled();
    store.release();
    store.start(NURSE);
    await settle();
    expect(api.shadowBoard).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe(SHADOW_PHASE.IDLE);
  });

  it("fetches at once on the first consumer, then every 5 s; the last release stops it", async () => {
    const { api, store, timers } = harness();
    store.start(NURSE);
    store.acquire();
    await settle();
    expect(api.shadowBoard).toHaveBeenCalledTimes(1);
    expect(timers.delays).toEqual([POLL_MS]);
    expect(POLL_MS).toBe(5000);
    await timers.fire();
    expect(api.shadowBoard).toHaveBeenCalledTimes(2);
    store.acquire();                       // a second consumer adds no poll of its own
    store.release();
    await timers.fire();
    expect(api.shadowBoard).toHaveBeenCalledTimes(3);
    store.release();
    expect(timers.delays).toEqual([]);
    await timers.fire();
    expect(api.shadowBoard).toHaveBeenCalledTimes(3);
  });

  it("pauses while the tab is hidden and fetches at once when it is shown again", async () => {
    const { api, store, timers, show } = harness();
    store.start(NURSE);
    store.acquire();
    await settle();
    await show(false);
    expect(timers.delays).toEqual([]);
    await timers.fire();
    expect(api.shadowBoard).toHaveBeenCalledTimes(1);
    await show(true);
    expect(api.shadowBoard).toHaveBeenCalledTimes(2);
    expect(timers.delays).toEqual([POLL_MS]);
  });

  it("never fetches for a session that holds neither board.view nor devices.manage", async () => {
    const { api, store } = harness();
    store.start(["audit.view"]);
    store.acquire();
    await settle();
    expect(api.shadowBoard).not.toHaveBeenCalled();
    expect(mayReadShadow(["devices.manage"])).toBe(true);
    expect(mayReadShadow(["board.view"])).toBe(true);
    expect(mayReadShadow([])).toBe(false);
    expect(mayReadShadow(undefined)).toBe(false);
  });

  it("runs its calls through the session's track", async () => {
    const track = vi.fn((call) => call());
    const { store } = harness({ track });
    store.start(NURSE);
    store.acquire();
    await settle();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("asks once at a time: a consumer arriving mid-fetch does not double it", async () => {
    let release;
    const { api, store } = harness({ answer: () => new Promise((resolve) => { release = () => resolve(SHADOW); }) });
    store.start(NURSE);
    store.acquire();
    store.release();
    store.acquire();
    await settle();
    expect(api.shadowBoard).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(store.getState().phase).toBe(SHADOW_PHASE.OK);
  });
});

describe("what it holds", () => {
  it("holds the answer and when it arrived", async () => {
    const { store, clock } = harness();
    store.start(NURSE);
    store.acquire();
    await settle();
    expect(store.getState()).toEqual({ phase: SHADOW_PHASE.OK, stage: "shadow", data: SHADOW, fetchedAtMs: clock.t });
  });

  it("holds a stage that is off as data, so a screen can draw nothing on purpose", async () => {
    const { store } = harness({ answer: () => ({ stage: "off" }) });
    store.start(NURSE);
    store.acquire();
    await settle();
    expect(store.getState()).toMatchObject({ phase: SHADOW_PHASE.OK, stage: "off", data: { stage: "off" } });
  });

  it("says a failed read is unreadable and KEEPS the last answer — ageing it is the screen's job", async () => {
    let fail = false;
    const { store, timers, clock } = harness({ answer: () => { if (fail) throw new Error("down"); return SHADOW; } });
    store.start(NURSE);
    store.acquire();
    await settle();
    const at = clock.t;
    fail = true;
    clock.t += POLL_MS;
    await timers.fire();
    expect(store.getState()).toEqual({ phase: SHADOW_PHASE.UNREADABLE, stage: "shadow", data: SHADOW, fetchedAtMs: at });
  });

  it("takes an answer that is not a strip for an unreadable one", async () => {
    for (const bad of [undefined, null, "x", [], { stage: 1 }]) {
      const { store } = harness({ answer: () => bad });
      store.start(NURSE);
      store.acquire();
      await settle();
      expect(store.getState().phase, JSON.stringify(bad)).toBe(SHADOW_PHASE.UNREADABLE);
      expect(store.getState().data).toBeNull();
    }
  });

  it("drops an answer that arrives after clear() — the session it was for has ended", async () => {
    let release;
    const { store, timers } = harness({ answer: () => new Promise((resolve) => { release = () => resolve(SHADOW); }) });
    store.start(NURSE);
    store.acquire();
    await settle();
    store.clear();
    release();
    await settle();
    expect(store.getState()).toEqual({ phase: SHADOW_PHASE.IDLE, stage: null, data: null, fetchedAtMs: null });
    expect(timers.delays).toEqual([]);
  });

  it("clear() stops the polling and the visibility watch until the next start", async () => {
    const { api, store, timers, watchers } = harness();
    store.start(NURSE);
    store.acquire();
    await settle();
    store.clear();
    expect(timers.delays).toEqual([]);
    expect(watchers.size).toBe(0);
    store.start(NURSE);                     // the consumer is still on screen
    await settle();
    expect(api.shadowBoard).toHaveBeenCalledTimes(2);
  });
});

describe("isolation: the strip never reaches what alarms", () => {
  it("ten polls of a strip full of alarming values leave the board and every alarm summary untouched", async () => {
    // The board, LIVE, with a critical and a high alarm: what the sound, the notification, the
    // bell, the rail badge and the lock screen read (alarmsToSignal, waitingAlarms, alarmCounts,
    // lockSummary). Its own timers are inert so nothing but the strip runs during the polls.
    let handlers = null;
    const boardApi = {
      boardPatients: vi.fn(async () => board([entry("S-001", [alarm("septic_shock", "critical")]),
        entry("S-002", [alarm("news2", "high")]), entry("S-003")])),
      streamTicket: vi.fn(async () => ({ ticket: "t-1" })),
      serverClockSkewMs: () => null,
    };
    const ward = createBoardStore({
      api: boardApi, openStream: (url, h) => { handlers = h; return () => {}; },
      setTimer: () => 0, clearTimer: () => {},
    });
    await ward.start();
    handlers.onopen();
    await settle();
    const before = ward.getState();
    expect(alarmCounts(before).known).toBe(true);
    const summaries = (state) => ({
      signal: alarmsToSignal(state), waiting: waitingAlarms(state), counts: alarmCounts(state), lock: lockSummary(state),
    });
    const expected = summaries(before);

    const { api, store, timers } = harness();
    store.start(NURSE);
    store.acquire();
    await settle();
    for (let i = 0; i < 9; i += 1) await timers.fire();
    expect(api.shadowBoard).toHaveBeenCalledTimes(10);
    expect(store.getState().data.beds[0].parameters[0].value).toBe(180);

    expect(ward.getState()).toBe(before);                 // the identical object
    expect(summaries(ward.getState())).toEqual(expected);
    expect(boardApi.boardPatients).toHaveBeenCalledTimes(2); // its load and the open's reload, nothing more
  });
});
