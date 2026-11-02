// Test-only: synthetic answers of GET /infinity-waves/{source} (Lane C, dalga), in the API's own
// shape (homunculus-engine api/infinity_waves.py `answer`), and the hand-driven timers, frames and
// session the wave tests use.
//
// NO PATIENT DATA, EVER (CLAUDE.md, hard rule 6), and no capture: addresses are 192.0.2.x
// (TEST-NET-1), device times are round numbers, and every sample is a made-up integer pattern.
//
//     wblock(259, 1000.2, ramp)            one 200 ms block of ECG channel 0x0103, a made-up pattern
//     wblock(259, 1000.2, null)            a "no signal" block (the hub's all-0x0001)
//     run(769, { samples: 4000 })          8 s of ART at a flat 100 mmHg, ending at T_END
//     answer([...run(259), ...run(513)])   the API's answer carrying them, from hub process STARTED

export const SOURCE = "192.0.2.10";
export const T_END = 1008;                               // device seconds: the end of the newest block
export const RECV = "2026-10-27T10:00:00.800Z";          // when the worker received every block
export const HUB_NOW = "2026-10-27T10:00:01.000Z";       // 0.2 s later, on the hub's clock
export const STARTED = "2026-10-27T09:00:00.000Z";       // the hub process the answers come from (A4)

const ENTRY = (kind, label, rate, unit = null, scale = null, evidence = "structural") =>
  ({ kind, label, rate, unit, scale, evidence });
const ECG = (evidence) => ENTRY("ecg", null, 200, null, null, evidence);
const PRESSURE = (label, rate) => ENTRY("pressure", label, rate, "mmHg", 0.025, "screen_scale");

/** The API's catalogue, as api/infinity_waves.py sends it (ids as decimal strings): five ECG
 *  channels with no lead name, two pressure waves (0x0301 "ART", 0x0e01 "P1"), pleth, resp. */
export const CATALOGUE = Object.freeze({
  258: ECG("structural"), 259: ECG("structural"), 260: ECG("unverified"), 290: ECG("unverified"),
  292: ECG("unverified"), 513: ENTRY("resp", "RESP", 50), 769: PRESSURE("ART", 100), 3585: PRESSURE("P1", 100),
  6422: ENTRY("pleth", "Pleth", 100),
});
const RATE = { 258: 200, 259: 200, 260: 200, 290: 200, 292: 200, 513: 50, 769: 100, 3585: 100, 6422: 100 };

/** A made-up pattern, well inside the ECG row's ±1200 counts. */
export const ramp = (i) => ((i * 53) % 801) - 400;

const round = (x) => Math.round(x * 1000) / 1000;

/** One block of wave `id` at device time `t`: `samples` a function of the index, a number for a
 *  flat block, or null for "no signal". */
export function wblock(id, t, samples = ramp, { recv = RECV } = {}) {
  const rate = RATE[id] ?? 100;
  const n = rate / 5;
  const values = samples === null ? null
    : Array.from({ length: n }, (_, i) => (typeof samples === "function" ? samples(i) : samples));
  return { t: round(t), recv, id, rate, samples: values };
}

/** `seconds` of contiguous blocks of wave `id` ending at `end`. */
export function run(id, { end = T_END, seconds = 8, samples = ramp, recv = RECV } = {}) {
  const out = [];
  for (let k = Math.round(seconds / 0.2); k >= 1; k -= 1) out.push(wblock(id, end - k * 0.2, samples, { recv }));
  return out;
}

/** A bed like BED07: ECG live on 0x0103, ART (a flat 100 mmHg), pleth and resp. */
export const bed4 = () => [...run(259), ...run(769, { samples: 4000 }), ...run(6422), ...run(513)];

/** A bed like BED08: ECG live on 0x0102 with 0x0103 and 0x0104 "no signal", and P1 (0x0e01). */
export const bed8 = () => [...run(258), ...run(259, { samples: null }), ...run(260, { samples: null }),
  ...run(3585, { samples: 3600 })];

/** The API's answer. `started` names the hub process its cursor counts in (amendment A4). */
export function answer(blocks = bed4(), {
  cursor = blocks.length, hub_now = HUB_NOW, device_id = SOURCE, started = STARTED,
} = {}) {
  return { schema: "homunculus.infinity-waves.v1", device_id, cursor, hub_now, started, blocks, waves: CATALOGUE };
}

/** A refusal as backendApi throws it: an Error with the HTTP status. */
export const refusal = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

export const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A timer queue the test fires by hand (shadowStore.test.js's). */
export function manualTimers() {
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

/** requestAnimationFrame by hand: `run(perfMs)` calls every frame due with that timestamp. */
export function manualFrames() {
  let seq = 0;
  const pending = new Map();
  return {
    raf: (fn) => { seq += 1; pending.set(seq, fn); return seq; },
    caf: (id) => { pending.delete(id); },
    get waiting() { return pending.size; },
    run(perfMs) {
      const due = [...pending.values()];
      pending.clear();
      for (const fn of due) fn(perfMs);
    },
  };
}

const READY = Object.freeze({ phase: "ready", user: null });

/** The least a session needs to make a wave feed of (session/feeds.js `waveFeedFor`): a client
 *  with `request`, and `track`. It also stands in a <SessionProvider> (`subscribe`, `getState`),
 *  though no wave module reads one (I1). */
export function sessionStub(api = {}) {
  return { subscribe: () => () => {}, getState: () => READY, api, track: (call) => call() };
}
