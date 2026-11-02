// The wave store (Lane C, dalga): polled only while watched and visible, with the cursor and the
// hub process it counts in, keeping at most 20 s, and turning every refusal into a status — never
// into an empty trace. Synthetic blocks only (waves.testutil.js), synthetic addresses (192.0.2.x).
import { describe, it, expect, vi } from "vitest";
import {
  IDLE_DEVICE, WAVE_ANSWER_S, WAVE_KEEP_S, WAVE_POLL_MS, WAVE_STATUS, createWaveStore, isWavesAnswer, mergeBlocks,
  newestOf, sampleOf, statusOf, waveStoreFor, wavesPath,
} from "./waveStore.js";
import {
  HUB_NOW, SOURCE, STARTED, T_END, answer, bed4, manualTimers, refusal, run, settle, wblock,
} from "./waves.testutil.js";

const RESTARTED = "2026-10-27T10:00:00.500Z";      // another hub process: the hub restarted

function harness({ reply = () => answer(), visible = true } = {}) {
  const timers = manualTimers();
  let shown = visible;
  const watchers = new Set();
  const clock = { perf: 5000 };
  const getWaves = vi.fn(async () => reply());
  const store = createWaveStore({
    getWaves, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => shown,
    onVisibility: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    perfNow: () => clock.perf,
  });
  const show = async (value) => {
    shown = value;
    for (const fn of watchers) fn();
    await settle();
  };
  return { getWaves, store, timers, show, clock, watchers };
}

const pathOf = (since, started) =>
  `/infinity-waves/${SOURCE}?since=${since}${started ? `&started=${encodeURIComponent(started)}` : ""}`;

describe("the wave store's polling", () => {
  it("asks for nothing until a monitor is watched, then for that monitor from cursor 0", async () => {
    const { getWaves, store } = harness();
    await settle();
    expect(getWaves).not.toHaveBeenCalled();
    store.watch(SOURCE);
    await settle();
    // the path alone: a hung poll is bounded by the API client's own limit (backendApi's `timed`
    // honours only a longer one), and the rows age into "akış durdu" meanwhile (R6)
    expect(getWaves.mock.calls).toEqual([[`/infinity-waves/${SOURCE}?since=0`]]);
  });

  it("polls every 750 ms with the cursor of the last answer", async () => {
    const { getWaves, store, timers } = harness({ reply: () => answer(undefined, { cursor: 41 }) });
    store.watch(SOURCE);
    await settle();
    expect(timers.delays).toEqual([WAVE_POLL_MS]);
    await timers.fire();
    expect(getWaves).toHaveBeenLastCalledWith(pathOf(41, STARTED));
    expect(store.get(SOURCE).cursor).toBe(41);
  });

  it("shares one poll between two watchers of a monitor, and the last release forgets it", async () => {
    const { getWaves, store, timers, watchers } = harness();
    const first = store.watch(SOURCE);
    const second = store.watch(SOURCE);
    await settle();
    expect(getWaves).toHaveBeenCalledTimes(1);
    first();
    first();                                   // a release is idempotent
    expect(timers.delays).toEqual([WAVE_POLL_MS]);
    second();
    expect(timers.delays).toEqual([]);
    expect(store.get(SOURCE)).toBe(IDLE_DEVICE);
    expect(watchers.size).toBe(0);
  });

  it("does not poll a hidden tab, and catches up at once when it is shown again", async () => {
    const { getWaves, store, timers, show } = harness({ visible: false });
    store.watch(SOURCE);
    await settle();
    expect(getWaves).not.toHaveBeenCalled();
    expect(timers.delays).toEqual([]);
    await show(true);
    expect(getWaves).toHaveBeenCalledTimes(1);
    expect(timers.delays).toEqual([WAVE_POLL_MS]);
    await show(false);
    expect(timers.delays).toEqual([]);
  });

  it("is made of a feed's getWaves alone, and refuses to be made without one (I1)", () => {
    expect(() => createWaveStore({})).toThrow(TypeError);
    // The shape it had before I1 — the session's client and `track` — is no longer one it takes.
    expect(() => createWaveStore({ api: { request: vi.fn() }, track: (call) => call() })).toThrow(TypeError);
  });

  it.each([
    ["an answer", (late) => late.resolve(answer(undefined, { cursor: 999, started: RESTARTED }))],
    ["a refusal", (late) => late.reject(refusal(403))],
  ])("drops %s that lands after its monitor was released, even once it is watched again", async (_name, land) => {
    const calls = [];
    const { store } = harness({ reply: () => new Promise((resolve, reject) => { calls.push({ resolve, reject }); }) });
    const release = store.watch(SOURCE);
    await settle();
    release();
    store.watch(SOURCE);                       // a new watch of the same monitor, its own first poll in flight
    await settle();
    expect(calls).toHaveLength(2);
    const notified = vi.fn();
    store.subscribe(notified);
    land(calls[0]);                            // the released watch's poll comes back last
    await settle();
    expect(notified).not.toHaveBeenCalled();
    const device = store.get(SOURCE);
    expect(device.status).toBe(WAVE_STATUS.LOADING);
    expect(device.cursor).toBe(0);
    expect(device.started).toBeNull();
    expect(device.blocks).toEqual({});
  });
});

describe("the wave store and the hub process (amendment A4)", () => {
  it("names no hub process on its first poll", async () => {
    const { getWaves, store } = harness();
    store.watch(SOURCE);
    await settle();
    expect(getWaves.mock.calls[0][0]).toBe(pathOf(0));
    expect(getWaves.mock.calls[0][0]).not.toContain("started");
  });

  it("sends back the last answer's cursor and hub process on the next poll", async () => {
    const cursors = [41, 57];
    const { getWaves, store, timers } = harness({ reply: () => answer(undefined, { cursor: cursors.shift() ?? 57 }) });
    store.watch(SOURCE);
    await settle();
    expect(store.get(SOURCE).started).toBe(STARTED);
    await timers.fire();
    expect(getWaves).toHaveBeenLastCalledWith(pathOf(41, STARTED));
    await timers.fire();
    expect(getWaves).toHaveBeenLastCalledWith(pathOf(57, STARTED));
  });

  it("takes a restarted hub's cursor and process, and its whole window adds no block twice", async () => {
    let reply = () => answer(bed4(), { cursor: 400 });
    const { getWaves, store, timers } = harness({ reply: () => reply() });
    store.watch(SOURCE);
    await settle();
    const before = store.get(SOURCE).blocks;
    // The restarted hub counts from 0 again and serves its whole window: the blocks held, and one newer.
    reply = () => answer([...bed4(), wblock(259, T_END)], { cursor: 12, started: RESTARTED });
    await timers.fire();
    const device = store.get(SOURCE);
    expect(device.status).toBe(WAVE_STATUS.OK);
    expect(device.cursor).toBe(12);
    expect(device.started).toBe(RESTARTED);
    expect(device.blocks["259"]).toHaveLength(before["259"].length + 1);
    for (const id of ["513", "769", "6422"]) expect(device.blocks[id]).toHaveLength(before[id].length);
    // merged, not started afresh: 7.8 s behind is no set-back, so the blocks held are the ones kept
    for (const id of ["259", "513", "769", "6422"]) expect(device.blocks[id][0]).toBe(before[id][0]);
    for (const list of Object.values(device.blocks)) expect(new Set(list.map((b) => b.t)).size).toBe(list.length);
    await timers.fire();
    expect(getWaves).toHaveBeenLastCalledWith(pathOf(12, RESTARTED));
  });

  it.each([
    ["without a hub process", (a) => Object.fromEntries(Object.entries(a).filter(([key]) => key !== "started"))],
    ["with an empty hub process", (a) => ({ ...a, started: "" })],
  ])("an answer %s is unavailable, and the blocks, cursor and process held stay", async (_name, spoil) => {
    let reply = () => answer(undefined, { cursor: 41 });
    const { getWaves, store, timers } = harness({ reply: () => reply() });
    store.watch(SOURCE);
    await settle();
    const before = store.get(SOURCE).blocks;
    reply = () => spoil(answer(undefined, { cursor: 99, started: RESTARTED }));
    await timers.fire();
    const device = store.get(SOURCE);
    expect(device.status).toBe(WAVE_STATUS.UNAVAILABLE);
    expect(device.blocks).toBe(before);
    expect(device.cursor).toBe(41);
    expect(device.started).toBe(STARTED);
    await timers.fire();
    expect(getWaves).toHaveBeenLastCalledWith(pathOf(41, STARTED));
  });

  it("takes a hub process of 1 to 40 characters, the API's own bound, and nothing else", () => {
    expect(isWavesAnswer(answer(undefined, { started: "x" }))).toBe(true);
    expect(isWavesAnswer(answer(undefined, { started: "x".repeat(40) }))).toBe(true);
    expect(isWavesAnswer(answer(undefined, { started: "x".repeat(41) }))).toBe(false);
    expect(isWavesAnswer(answer(undefined, { started: "" }))).toBe(false);
    expect(isWavesAnswer(answer(undefined, { started: null }))).toBe(false);
    expect(isWavesAnswer(answer(undefined, { started: 7 }))).toBe(false);
  });

  it("adds the hub process to its path only when there is one", () => {
    expect(wavesPath("192.0.2.10", 7, STARTED))
      .toBe("/infinity-waves/192.0.2.10?since=7&started=2026-10-27T09%3A00%3A00.000Z");
    expect(wavesPath("192.0.2.10", 7, "")).toBe("/infinity-waves/192.0.2.10?since=7");
    expect(wavesPath("192.0.2.10", 7, null)).toBe("/infinity-waves/192.0.2.10?since=7");
    expect(wavesPath("192.0.2.10", 7, "a&b=c")).toBe("/infinity-waves/192.0.2.10?since=7&started=a%26b%3Dc");
  });
});

describe("the wave store's statuses", () => {
  it("keeps the blocks of an answer, the catalogue and where the monitor's clock stood", async () => {
    const { store } = harness();
    store.watch(SOURCE);
    await settle();
    const device = store.get(SOURCE);
    expect(device.status).toBe(WAVE_STATUS.OK);
    expect(Object.keys(device.blocks).sort()).toEqual(["259", "513", "6422", "769"]);
    expect(device.catalogue["769"].label).toBe("ART");
    expect(device.newest).toEqual({ t: T_END - 0.2, recv: "2026-10-27T10:00:00.800Z" });
    // the newest block's end (T_END) plus the 0.2 s between the worker's receipt and the hub's now
    expect(device.sample.deviceS).toBeCloseTo(T_END + 0.2, 6);
    expect(device.sample.perfMs).toBe(5000);
  });

  it.each([[403, WAVE_STATUS.DENIED], [404, WAVE_STATUS.GONE], [409, WAVE_STATUS.OFF]])(
    "a %i drops the blocks, the cursor and the process, and stops polling (%s)", async (code, status) => {
      let reply = () => answer(undefined, { cursor: 41 });
      const { getWaves, store, timers, show } = harness({ reply: () => reply() });
      store.watch(SOURCE);
      await settle();
      reply = () => { throw refusal(code); };
      await timers.fire();
      const device = store.get(SOURCE);
      expect(device.status).toBe(status);
      expect(device.blocks).toEqual({});
      expect(device.cursor).toBe(0);
      expect(device.started).toBeNull();
      expect(timers.delays).toEqual([]);
      const asked = getWaves.mock.calls.length;
      await show(false);
      await show(true);                        // the tab shown again does not wake a refused monitor
      expect(getWaves).toHaveBeenCalledTimes(asked);
      expect(timers.delays).toEqual([]);
    });

  it.each([["a 503", () => { throw refusal(503); }], ["a network failure", () => { throw new TypeError("fetch"); }],
    ["an answer that is not one", () => ({ stage: "off" })]])(
    "%s keeps the blocks, says unavailable and keeps polling", async (_name, failing) => {
      let reply = () => answer();
      const { store, timers } = harness({ reply: () => reply() });
      store.watch(SOURCE);
      await settle();
      const before = store.get(SOURCE).blocks;
      reply = failing;
      await timers.fire();
      expect(store.get(SOURCE).status).toBe(WAVE_STATUS.UNAVAILABLE);
      expect(store.get(SOURCE).blocks).toBe(before);
      expect(timers.delays).toEqual([WAVE_POLL_MS]);
    });

  it("maps a refusal to a status by its HTTP status only", () => {
    expect(statusOf(refusal(403))).toBe(WAVE_STATUS.DENIED);
    expect(statusOf(refusal(404))).toBe(WAVE_STATUS.GONE);
    expect(statusOf(refusal(409))).toBe(WAVE_STATUS.OFF);
    expect(statusOf(refusal(401))).toBe(WAVE_STATUS.UNAVAILABLE);
    expect(statusOf(new Error("no status"))).toBe(WAVE_STATUS.UNAVAILABLE);
  });
});

describe("what the wave store holds", () => {
  it("keeps one block per wave and time, in device-time order", () => {
    const held = mergeBlocks({}, [wblock(259, 1000.4), wblock(259, 1000.0), wblock(259, 1000.2)]);
    const again = mergeBlocks(held, [wblock(259, 1000.2), wblock(259, 1000.6)]);
    expect(again["259"].map((b) => b.t)).toEqual([1000, 1000.2, 1000.4, 1000.6]);
    expect(held["259"]).toHaveLength(3);                      // the old object is not changed
  });

  it("keeps nothing more than 20 s behind the monitor's newest block", () => {
    const held = mergeBlocks({}, [...run(259, { end: 1000, seconds: 2 }), wblock(513, 1000 + WAVE_KEEP_S + 5)]);
    expect(held["259"]).toBeUndefined();
    expect(held["513"]).toHaveLength(1);
  });

  it("refuses a block that is not one", () => {
    const held = mergeBlocks({}, [{ ...wblock(259, 1000), samples: [1, 2] }, { ...wblock(259, 1000.2), rate: 300 },
      { ...wblock(259, 1000.4), t: Number.NaN }, null, wblock(259, 1000.6)]);
    expect(held["259"].map((b) => b.t)).toEqual([1000.6]);
  });

  it("dates the head by the worker's and the hub's clocks, never this browser's", () => {
    const newest = newestOf({ 259: [wblock(259, 1000)], 513: [wblock(513, 1001)] });
    expect(newest.t).toBe(1001);
    expect(sampleOf(newest, HUB_NOW, 12).deviceS).toBeCloseTo(1001.4, 6);
    expect(sampleOf(newest, "not a time", 12)).toBeNull();
    expect(sampleOf(null, HUB_NOW, 12)).toBeNull();
  });

  it("builds its path with the address encoded", () => {
    expect(wavesPath("192.0.2.10", 7)).toBe("/infinity-waves/192.0.2.10?since=7");
    expect(wavesPath("a/b", 0)).toBe("/infinity-waves/a%2Fb?since=0");
  });

  it("gives a feed one store, made of its getWaves alone, and another feed another (I1)", async () => {
    const feed = Object.freeze({ getWaves: vi.fn(async () => answer()) });
    const store = waveStoreFor(feed);
    expect(waveStoreFor(feed)).toBe(store);
    expect(waveStoreFor(Object.freeze({ getWaves: feed.getWaves }))).not.toBe(store);
    const release = store.watch(SOURCE);
    await settle();
    expect(feed.getWaves.mock.calls).toEqual([[`/infinity-waves/${SOURCE}?since=0`]]);
    release();
    // Nothing but a feed: not nothing, and not a session's client and `track`.
    expect(() => waveStoreFor(undefined)).toThrow(TypeError);
    expect(() => waveStoreFor({ api: { request: vi.fn() }, track: (call) => call() })).toThrow(TypeError);
  });
});

describe("a monitor clock set back (the hub's R5, in the browser)", () => {
  it("starts afresh when the new stream is far behind, and dates the head by it", async () => {
    let reply = () => answer(bed4(), { cursor: 160 });                       // held: up to 1008
    const { store, timers } = harness({ reply: () => reply() });
    store.watch(SOURCE);
    await settle();
    expect(store.get(SOURCE).newest.t).toBe(1007.8);
    // The hub cleared its ring and serves the monitor's new, earlier stream: 940 … 948.
    const back = [...run(259, { end: 948 }), ...run(513, { end: 948 })];
    reply = () => answer(back, { cursor: 240 });
    await timers.fire();
    const device = store.get(SOURCE);
    expect(device.status).toBe(WAVE_STATUS.OK);
    expect(Object.keys(device.blocks).sort()).toEqual(["259", "513"]);
    expect(device.blocks["259"]).toEqual(back.filter((b) => b.id === 259));
    expect(device.newest.t).toBe(947.8);
    expect(device.sample.deviceS).toBeCloseTo(948.2, 6);
  });

  it("starts afresh on a set-back inside the 20 s it keeps, too; a block that is not one resets nothing", () => {
    const held = mergeBlocks({}, run(259));                                  // 1000.0 … 1007.8
    expect(mergeBlocks(held, [{ ...wblock(513, 900), rate: 300 }])).toEqual(held);
    const merged = mergeBlocks(held, run(513, { end: 993 }));                // 15 s back: 985.0 … 992.8
    expect(Object.keys(merged)).toEqual(["513"]);
    expect(merged["513"]).toHaveLength(40);
    expect(newestOf(merged).t).toBe(992.8);
  });

  it("does not start afresh at exactly 10 s behind, counted in whole milliseconds", () => {
    expect(WAVE_ANSWER_S).toBe(10);                                          // the API's ANSWER_S
    const held = mergeBlocks({}, [wblock(259, 1024.4)]);
    // 1024.4 - 10 in floating point is a hair above 1014.4: compared naively, this would reset.
    expect(Object.keys(mergeBlocks(held, [wblock(513, 1014.4)])).sort()).toEqual(["259", "513"]);
    expect(Object.keys(mergeBlocks(held, [wblock(513, 1014.399)]))).toEqual(["513"]);
  });
});
