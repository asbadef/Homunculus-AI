// src/live/data/waveStore.js — a monitor's live waveform blocks (Lane C, dalga), as GET
// /infinity-waves/{source} shows them to this session. Framework-free, in shadowStore's style; the
// panel (screens/common/WavePanel.jsx) reads it through `watch` and `useSyncExternalStore`.
//
// UNVALIDATED research decoding of the bedside monitor's waveform blocks, display only. The rules,
// each held by a test:
//   1. POLLED ONLY WHILE WATCHED AND VISIBLE. A monitor is fetched every WAVE_POLL_MS only while
//      something on screen watches it (`watch` -> its release) and the tab is visible. The first
//      watcher starts it, the last release stops it and forgets everything of that monitor.
//   2. NOTHING KEPT. Blocks more than WAVE_KEEP_S (device time) behind the monitor's newest are
//      dropped on every answer; nothing is written anywhere.
//   3. A REFUSAL IS A STATUS, NEVER AN EMPTY TRACE. 403, 404 and 409 drop the blocks and stop the
//      polling (denied, gone, off); anything else — a 5xx, a timeout, an answer that is not one —
//      is "unavailable": the blocks held stay, and age into "akış durdu" on screen.
//   4. NEVER INTO AN ALARM PATH (waveBoundaries.test.js).
//   5. THE CURSOR TRAVELS WITH ITS HUB PROCESS (amendment A4). Every answer names the hub process
//      its cursor counts in (`started`, 1–40 characters; an answer without one is not an answer).
//      The next poll sends both back, the first poll neither, and the API serves a cursor from
//      another hub process — a restarted hub, counting from 0 again — the whole window. That
//      answer is merged like any other (one block per wave and time, so the overlap adds nothing)
//      and its cursor and process are taken, even when the cursor went backwards.
//   6. A CLOCK SET BACK STARTS AFRESH (the hub's R5, mirrored). A block more than WAVE_ANSWER_S
//      behind the newest held means the monitor's clock went back: the hub has already cleared
//      its ring and serves the new, earlier stream. What was held is dropped rather than left to
//      hide it — kept, its newest would hold the head where the new blocks never reach (or floor
//      them out of the 20 s altogether), and the panel would stay blank for as long as the
//      set-back. A set-back of WAVE_ANSWER_S or less is not detected, as at the hub.
//   7. A FEED, NOTHING ELSE (I1). The store's one call is `getWaves(path)`, a wave feed's
//      (session/feeds.js `waveFeedFor`): a GET of an /infinity-waves/ path and nothing else, made
//      there inside the session's `track`, so a refused refresh still ends the session. This module
//      is handed that one function and never the session store or the API client, which could sign
//      out, lock, unlock or write; `waveStoreFor` keys its stores by the feed.
// The calls carry no time limit of their own: backendApi's `timed` honours only one longer than the
// client's own (15 s), so a hung poll is bounded by that. One poll per monitor is in flight at a
// time, and meanwhile the rows age into "akış durdu" on their own (R6).

export const WAVE_POLL_MS = 750;
export const WAVE_KEEP_S = 20;
export const WAVE_BLOCK_S = 0.2;          // every block is 200 ms of one wave (n = rate / 5)
// = the API's ANSWER_S (edge/infinity_waves.py): the most one answer carries behind the hub's
// newest block for a monitor, and the hub's set-back threshold (R5). No block served is older.
export const WAVE_ANSWER_S = 10;
export const WAVES_SCHEMA = "homunculus.infinity-waves.v1";
const RATES = new Set([50, 100, 200, 250, 500]);
const MAX_STARTED = 40;                   // the API's MAX_TEXT: the hub process's name, at most

export const WAVE_STATUS = Object.freeze({
  IDLE: "idle",               // nobody watches this monitor
  LOADING: "loading",         // watched; the first answer is on its way
  OK: "ok",                   // the last poll answered
  UNAVAILABLE: "unavailable", // the last poll failed (5xx, timeout, not an answer): blocks kept
  OFF: "off",                 // 409: waves or the strip are off here
  DENIED: "denied",           // 403
  GONE: "gone",               // 404: not a monitor this session may see (or none at all)
});
const POLLING = new Set([WAVE_STATUS.LOADING, WAVE_STATUS.OK, WAVE_STATUS.UNAVAILABLE]);

export const IDLE_DEVICE = Object.freeze({
  status: WAVE_STATUS.IDLE, cursor: 0, started: null, catalogue: Object.freeze({}), blocks: Object.freeze({}),
  newest: null, sample: null,
});

/** The API path for one monitor after `since`, in hub process `started` (named only when known). */
export function wavesPath(source, since, started) {
  const path = `/infinity-waves/${encodeURIComponent(String(source))}?since=${encodeURIComponent(String(since))}`;
  return typeof started === "string" && started !== "" ? `${path}&started=${encodeURIComponent(started)}` : path;
}

/** The status a refused call maps to. A 401 is the session's own business (the feed's `track` ends it). */
export function statusOf(err) {
  if (err?.status === 403) return WAVE_STATUS.DENIED;
  if (err?.status === 404) return WAVE_STATUS.GONE;
  if (err?.status === 409) return WAVE_STATUS.OFF;
  return WAVE_STATUS.UNAVAILABLE;
}

export const isWavesAnswer = (a) => Boolean(a) && typeof a === "object" && a.schema === WAVES_SCHEMA
  && Number.isInteger(a.cursor) && a.cursor >= 0 && typeof a.hub_now === "string"
  && typeof a.started === "string" && a.started.length > 0 && a.started.length <= MAX_STARTED
  && Array.isArray(a.blocks) && Boolean(a.waves) && typeof a.waves === "object" && !Array.isArray(a.waves);

const isBlock = (b) => Boolean(b) && typeof b === "object" && Number.isFinite(b.t) && Number.isInteger(b.id)
  && RATES.has(b.rate) && typeof b.recv === "string"
  && (b.samples === null || (Array.isArray(b.samples) && b.samples.length === b.rate / 5
    && b.samples.every(Number.isFinite)));

function insertAt(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How far device time `t` lies behind `newest`, in whole milliseconds. Device times are the hub's
 *  t_ms / 1000, and their difference in floating point can land a hair off (1024.4 - 10 > 1014.4). */
const msBehind = (newest, t) => Math.round((newest - t) * 1000);

/** What a monitor holds after an answer: per wave id, ordered by device time, one block per time,
 *  nothing more than WAVE_KEEP_S behind the monitor's newest block — and none of what was held
 *  when a block arrives more than WAVE_ANSWER_S behind it (rule 6). Pure: `held` is not changed. */
export function mergeBlocks(held, incoming) {
  const fresh = incoming.filter(isBlock);
  const was = newestOf(held)?.t ?? -Infinity;
  const setBack = fresh.some((block) => msBehind(was, block.t) > WAVE_ANSWER_S * 1000);
  const out = setBack ? {} : { ...held };
  const copied = new Set();
  for (const block of fresh) {
    const id = String(block.id);
    if (!copied.has(id)) {
      out[id] = [...(out[id] ?? [])];
      copied.add(id);
    }
    const list = out[id];
    const at = insertAt(list, block.t);
    if (at < list.length && list[at].t === block.t) continue;          // held already
    list.splice(at, 0, block);
  }
  let newest = -Infinity;
  for (const list of Object.values(out)) if (list.length > 0) newest = Math.max(newest, list[list.length - 1].t);
  const floor = newest - WAVE_KEEP_S;
  for (const [id, list] of Object.entries(out)) {
    const first = list.findIndex((b) => b.t >= floor);
    if (first === -1) delete out[id];
    else if (first > 0) out[id] = list.slice(first);
  }
  return out;
}

/** The monitor's newest block over every wave: `{t, recv}`, or null. */
export function newestOf(blocks) {
  let best = null;
  for (const list of Object.values(blocks)) {
    const last = list[list.length - 1];
    if (last && (best === null || last.t > best.t)) best = { t: last.t, recv: last.recv };
  }
  return best;
}

/** Where the monitor's clock stood when an answer arrived: its newest block's end plus how long
 *  before `hub_now` the worker received it — the worker's and the hub's clocks, never this
 *  browser's — paired with this browser's monotonic `perfMs` of that moment. null if unreadable. */
export function sampleOf(newest, hubNow, perfMs) {
  if (!newest) return null;
  const age = (Date.parse(hubNow) - Date.parse(newest.recv)) / 1000;
  if (!Number.isFinite(age) || !Number.isFinite(perfMs)) return null;
  return { deviceS: newest.t + WAVE_BLOCK_S + Math.max(0, age), perfMs };
}

const defaultIsVisible = () => typeof document === "undefined"
  || (document.visibilityState !== "hidden" && document.hidden !== true);
function defaultOnVisibility(fn) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}

/**
 * getWaves(path): a wave feed's one capability (session/feeds.js) — the answer to GET `path`, or
 * the refusal. The rest are injectable for the tests: the timers, the page's visibility, the
 * monotonic clock.
 */
export function createWaveStore({
  getWaves,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  isVisible = defaultIsVisible, onVisibility = defaultOnVisibility,
  perfNow = () => performance.now(),
}) {
  if (typeof getWaves !== "function") throw new TypeError("createWaveStore: getWaves is required");
  const devices = new Map();     // source -> { count, timer, inFlight, state }
  const listeners = new Set();
  let unwatch = null;
  const notify = () => { for (const fn of listeners) fn(); };
  const live = (source, entry) => devices.get(source) === entry;
  const set = (entry, patch) => {
    entry.state = Object.freeze({ ...entry.state, ...patch });
    notify();
  };

  function cancel(entry) {
    if (entry.timer !== null) clearTimer(entry.timer);
    entry.timer = null;
  }

  function schedule(source, entry) {
    cancel(entry);
    if (!live(source, entry) || !isVisible() || !POLLING.has(entry.state.status)) return;
    entry.timer = setTimer(() => {
      entry.timer = null;
      poll(source, entry).then(() => schedule(source, entry));
    }, WAVE_POLL_MS);
  }

  async function poll(source, entry) {
    if (entry.inFlight || !live(source, entry) || !isVisible()) return;
    entry.inFlight = true;
    try {
      const { cursor, started } = entry.state;
      const answer = await getWaves(wavesPath(source, cursor, started));
      if (!live(source, entry)) return;
      if (!isWavesAnswer(answer)) {
        set(entry, { status: WAVE_STATUS.UNAVAILABLE });
        return;
      }
      // An answer from another hub process (rule 5) is that hub's whole window: merged as usual;
      // one from a monitor whose clock went back (rule 6) replaces what was held.
      const blocks = mergeBlocks(entry.state.blocks, answer.blocks);
      const newest = newestOf(blocks);
      set(entry, {
        status: WAVE_STATUS.OK, cursor: answer.cursor, started: answer.started, catalogue: answer.waves, blocks, newest,
        sample: sampleOf(newest, answer.hub_now, perfNow()) ?? entry.state.sample,
      });
    } catch (err) {
      if (!live(source, entry)) return;
      const status = statusOf(err);
      set(entry, status === WAVE_STATUS.UNAVAILABLE ? { status } : { ...IDLE_DEVICE, status });
    } finally {
      entry.inFlight = false;
    }
  }

  function resume(source, entry) {
    if (!live(source, entry) || !isVisible()) {
      cancel(entry);
      return;
    }
    poll(source, entry).then(() => schedule(source, entry));
  }

  function onVisible() {
    for (const [source, entry] of devices) {
      if (isVisible() && POLLING.has(entry.state.status)) resume(source, entry);
      else cancel(entry);
    }
  }

  return {
    get: (source) => devices.get(source)?.state ?? IDLE_DEVICE,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Something on screen shows this monitor's waves. Returns its release; the last release forgets. */
    watch(source) {
      let entry = devices.get(source);
      if (!entry) {
        entry = { count: 0, timer: null, inFlight: false,
          state: Object.freeze({ ...IDLE_DEVICE, status: WAVE_STATUS.LOADING }) };
        devices.set(source, entry);
        if (!unwatch) unwatch = onVisibility(onVisible);
        notify();
      }
      entry.count += 1;
      if (entry.count === 1) resume(source, entry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.count -= 1;
        if (entry.count > 0) return;
        cancel(entry);
        devices.delete(source);
        if (devices.size === 0 && unwatch) {
          unwatch();
          unwatch = null;
        }
        notify();
      };
    },
  };
}

const perFeed = new WeakMap();

/** The feed's one wave store, made on first use from its `getWaves` alone. A session has one feed
 *  (session/feeds.js), so every panel of a session shares the subscriptions, and a panel needs
 *  nothing from LiveApp. */
export function waveStoreFor(feed) {
  if (typeof feed?.getWaves !== "function") throw new TypeError("waveStoreFor: a wave feed is required");
  let store = perFeed.get(feed);
  if (!store) {
    store = createWaveStore({ getWaves: feed.getWaves });
    perFeed.set(feed, store);
  }
  return store;
}
