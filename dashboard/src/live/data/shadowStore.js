// src/live/data/shadowStore.js — Aşama A's unvalidated monitor strip, as the API shows it to this
// session (GET /infinity-shadow/board). Framework-free, in boardStore's style; React reads it
// through ShadowProvider.jsx.
//
// The values are research decoding of bedside-monitor traffic and are NOT observations. Three rules,
// each held by a test:
//   1. NEVER ON A LOCKED SCREEN. LiveApp starts this store only while the session is READY and
//      clears it at the lock; the lock screen imports nothing of it (boundaries.test.js).
//   2. NEVER INTO AN ALARM PATH. Nothing here touches the board store, and the sound, the
//      notification, the bell, the rail badge, the lock screen and the board store import nothing
//      of this (boundaries.test.js); a poll leaves the board's state the identical object
//      (shadowStore.test.js).
//   3. VALUES AGE ON SCREEN. A failed poll keeps the last answer and says the strip is unreadable;
//      the screens add the time since `fetchedAtMs` to every age, so a value goes "old" on time
//      whether or not the next poll comes.
//
// It polls every POLL_MS only while something on screen shows the strip (`acquire`/`release`), the
// tab is visible, and the session may read it (`board.view` or `devices.manage`, the API's own
// rule). Nothing is fetched otherwise: a strip nobody is looking at costs the ward nothing.

export const POLL_MS = 5000;

export const SHADOW_PHASE = Object.freeze({
  IDLE: "idle",               // not asked yet (or the session ended)
  LOADING: "loading",         // the first answer is on its way
  OK: "ok",                   // the last poll answered
  UNREADABLE: "unreadable",   // the last poll failed; `data` is the last answer that did not
});

const EMPTY = Object.freeze({ phase: SHADOW_PHASE.IDLE, stage: null, data: null, fetchedAtMs: null });

/** Whether these rights may read the strip: the API's own rule (board.view or devices.manage). */
export const mayReadShadow = (perms) => Array.isArray(perms)
  && (perms.includes("board.view") || perms.includes("devices.manage"));

const defaultIsVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
function defaultOnVisibility(fn) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
}

/** An answer is a strip when it is an object naming its stage; anything else is unreadable. */
const isStrip = (answer) => Boolean(answer) && typeof answer === "object" && !Array.isArray(answer)
  && typeof answer.stage === "string";

/**
 * api: backendApi (shadowBoard). track(call): the session's wrapper for its API calls.
 * The rest are injectable for the tests: the timers, the page's visibility and the wall clock.
 */
export function createShadowStore({
  api, track = (call) => call(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  isVisible = defaultIsVisible, onVisibility = defaultOnVisibility, now = () => Date.now(),
}) {
  let state = EMPTY;
  let generation = 0;            // bumped by start() and clear(): a stale answer is dropped
  let allowed = false;
  let consumers = 0;
  let timer = null;
  let inFlight = false;
  let unwatch = null;
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };

  const running = () => allowed && consumers > 0 && isVisible();

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    if (running()) timer = setTimer(tick, POLL_MS);
  }

  async function poll() {
    if (inFlight || !running()) return;
    inFlight = true;
    const mine = generation;
    if (state.phase === SHADOW_PHASE.IDLE) set({ phase: SHADOW_PHASE.LOADING });
    try {
      const answer = await track(() => api.shadowBoard());
      if (mine !== generation) return;
      if (!isStrip(answer)) throw new Error("not a strip");
      set({ phase: SHADOW_PHASE.OK, stage: answer.stage, data: answer, fetchedAtMs: now() });
    } catch {
      if (mine === generation) set({ phase: SHADOW_PHASE.UNREADABLE });
    } finally {
      if (mine === generation) inFlight = false;
    }
  }

  async function tick() {
    timer = null;
    await poll();
    schedule();
  }

  /** Begin now: an immediate poll, then the cadence. */
  function resume() {
    if (!running()) {
      cancel();
      return;
    }
    poll().then(schedule, schedule);
  }

  function onVisible() {
    if (isVisible()) resume();
    else cancel();
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** A session that may see the strip is on screen (LiveApp, phase READY). */
    start(perms) {
      generation += 1;
      inFlight = false;
      allowed = mayReadShadow(perms);
      cancel();
      if (!unwatch) unwatch = onVisibility(onVisible);
      set({ ...EMPTY });
      resume();
    },
    /** Something on screen shows the strip. The first one starts the polling. */
    acquire() {
      consumers += 1;
      if (consumers === 1) resume();
    },
    /** It is gone. The last one stops the polling. */
    release() {
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) cancel();
    },
    /** The session ended or locked: nothing of it stays, and nothing late comes back. */
    clear() {
      generation += 1;
      inFlight = false;
      allowed = false;
      cancel();
      unwatch?.();
      unwatch = null;
      set({ ...EMPTY });
    },
  };
}
