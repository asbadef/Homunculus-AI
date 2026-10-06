// src/live/data/boardStore.js — the ward as the API shows it to this session: patients, their
// open alarms, the connection's state and the scope the engine applied. Framework-free; React
// reads it through BoardProvider.jsx. The screens of Wave 3 (beds, alarms, patient) read it; the
// shell reads it for the bell and the lock screen's counts.
//
// Ported from liveStore.js's live half (refreshBoard / startLive), without the simulation under
// it (roadmap D1). The rules it keeps:
//   - a failed load EMPTIES the list and says UNAVAILABLE — never yesterday's patients, never a
//     simulated ward (liveConnection.js);
//   - the stream opens with a single-use ticket, never a token in a URL, and a dropped stream gets
//     ONE scheduled reconnect with a fresh ticket;
//   - an answer that arrives after `clear()` (the session ended) is dropped.
// And one it adds: LIVE means "the stream is open AND the board was loaded since it opened" —
// nothing less. An open stream says nothing about a load that failed, and a stream that comes
// back after a drop may have missed changes: every open reloads the board, and only that load
// makes it LIVE. Until then a board that has data is DEGRADED (shown, possibly out of date), one
// whose load failed stays UNAVAILABLE. The shell treats only LIVE as known (the bell, the lock
// screen's counts): "no alarms" is never said of a board that is not.
import { patientFromBoard, patientsFromBoard, alertsFromPatients } from "../../liveAdapters.js";
import { CONNECTION } from "../../liveConnection.js";

export const RECONNECT_DELAY_MS = 5000;

const EMPTY = Object.freeze({
  patients: [], alerts: [], connection: CONNECTION.CONNECTING, scope: null, scopeNote: null,
});

/** Real SSE. `ticket` is short-lived and single-use: EventSource sends no headers, and a bearer
 *  token in a URL would leak into logs, history and Referer headers. */
function defaultOpenStream(url, handlers) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(url);
  source.onopen = handlers.onopen;
  source.onmessage = handlers.onmessage;
  source.onerror = handlers.onerror;
  return () => source.close();
}

function upsert(patients, patient) {
  const at = patients.findIndex((p) => p.patient_id === patient.patient_id);
  if (at === -1) return [...patients, patient];
  const next = patients.slice();
  next[at] = patient;
  return next;
}

/**
 * api: backendApi (boardPatients, streamTicket). track(call): the session's wrapper for its API
 * calls (sessionStore.track: a refused refresh ends the session, rights follow the token).
 */
export function createBoardStore({
  api, track = (call) => call(), openStream = defaultOpenStream,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let state = { ...EMPTY };
  let generation = 0;               // bumped by start() and clear(): a stale answer is dropped
  let closeSource = () => {};
  let reconnect = null;
  let reloadRetry = null;           // a reload that failed under an open stream, tried again
  let opened = 0;                   // the stream's opens so far: a load counts for the one it began in
  let streamOpen = false;
  let loadsBegun = 0;               // a load overtaken by a later one that landed first is dropped
  let loadLanded = 0;
  // A load's snapshot is taken by the server when the request arrives; a frame that comes while
  // the load is on its way may be newer than it. Such frames are kept (`frames`, numbered by
  // `framesSeen`) and played again over the snapshot when it lands, so a newer alarm is never
  // undone by an older whole board that then reads LIVE. `loading`: load -> frames seen when sent.
  let framesSeen = 0;
  let frames = [];
  const loading = new Map();
  const listeners = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };
  const withPatients = (patients, patch = {}) => set({ patients, alerts: alertsFromPatients(patients), ...patch });
  const applyFrame = (patients, frame) => (frame.removed
    ? patients.filter((p) => p.patient_id !== frame.patient.patient_id)
    : upsert(patients, frame.patient));

  /** Frames no load on its way still needs are let go. */
  function trimFrames() {
    if (loading.size === 0) frames = [];
    else {
      const oldest = Math.min(...loading.values());
      frames = frames.filter((f) => f.seq > oldest);
    }
  }

  function cancelReloadRetry() {
    if (reloadRetry) clearTimer(reloadRetry);
    reloadRetry = null;
  }

  async function refresh() {
    const mine = generation;
    loadsBegun += 1;
    const seq = loadsBegun;
    const during = streamOpen ? opened : -1;     // began while the stream was open: which open
    loading.set(seq, framesSeen);
    let board = null;
    let patients = null;
    try {
      board = await track(() => api.boardPatients());
      patients = patientsFromBoard(board);
    } catch {
      // patients stays null: the load failed
    }
    const sentAt = loading.get(seq);
    loading.delete(seq);
    if (mine !== generation) return;
    const newer = frames.filter((f) => f.seq > sentAt);
    trimFrames();
    if (seq < loadLanded) return;
    loadLanded = seq;
    if (patients) {
      cancelReloadRetry();
      // LIVE only for a load that began after the stream (still) open had opened; otherwise the
      // data is shown but not vouched for: still connecting at the start, DEGRADED after.
      const live = streamOpen && during === opened;
      const connection = live ? CONNECTION.LIVE
        : state.connection === CONNECTION.CONNECTING ? CONNECTION.CONNECTING : CONNECTION.DEGRADED;
      withPatients(newer.reduce(applyFrame, patients),
        { scope: board?.scope ?? null, scopeNote: board?.scope_note ?? null, connection });
    } else {
      // An empty list with the reason, never the last one: a board that stopped updating must
      // not look like a ward that is calm.
      withPatients([], { scope: null, scopeNote: null, connection: CONNECTION.UNAVAILABLE });
      // Under an open stream nothing else would load it again (the open's reload was this one,
      // and frames alone are no ward): try again after a pause, for as long as it fails.
      if (streamOpen && !reloadRetry) {
        reloadRetry = setTimer(() => {
          reloadRetry = null;
          if (mine === generation && streamOpen) refresh();
        }, RECONNECT_DELAY_MS);
      }
    }
  }

  /** The stream opened: reload, so the board it updates is a whole one (LIVE once that lands). */
  function onOpen() {
    streamOpen = true;
    opened += 1;
    cancelReloadRetry();
    refresh();
  }

  function onMessage(event) {
    let patient;
    let removed;
    try {
      const entry = JSON.parse(event.data);
      removed = entry.removed === true;
      patient = patientFromBoard(entry);
    } catch {
      return;                                     // a malformed frame touches nothing
    }
    if (patient.patient_id == null) return;
    framesSeen += 1;
    const frame = { seq: framesSeen, patient, removed };
    if (loading.size > 0) frames.push(frame);    // for the snapshot on its way
    // A board whose load failed stays empty: frames alone are not a ward, only the next whole load is.
    if (state.connection === CONNECTION.UNAVAILABLE) return;
    withPatients(applyFrame(state.patients, frame));
  }

  function onError(mine) {
    closeSource();                                // or the browser retries with the spent ticket
    if (mine !== generation) return;
    streamOpen = false;
    cancelReloadRetry();                          // the reconnect's open reloads instead
    // A board whose load failed stays UNAVAILABLE (empty, and says so); any other is DEGRADED.
    if (state.connection !== CONNECTION.UNAVAILABLE) set({ connection: CONNECTION.DEGRADED });
    if (reconnect) return;
    reconnect = setTimer(() => {
      reconnect = null;
      if (mine === generation) connect(mine);
    }, RECONNECT_DELAY_MS);
  }

  async function connect(mine) {
    try {
      const { ticket } = await track(() => api.streamTicket());
      if (mine !== generation) return;
      closeSource = openStream(`/stream?ticket=${encodeURIComponent(ticket)}`, {
        onopen: () => { if (mine === generation) onOpen(); },
        onmessage: (event) => { if (mine === generation) onMessage(event); },
        onerror: () => onError(mine),
      });
    } catch {
      if (mine === generation) onError(mine);
    }
  }

  function stopStream() {
    if (reconnect) clearTimer(reconnect);
    reconnect = null;
    cancelReloadRetry();
    closeSource();
    closeSource = () => {};
    streamOpen = false;
    loading.clear();
    frames = [];
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    refresh,
    /** Load, then stream (LIVE once the stream has opened and its reload landed). Resolves once
     *  the first load and the first ticket are done. */
    async start() {
      stopStream();
      generation += 1;
      const mine = generation;
      set({ ...EMPTY });
      await refresh();
      if (mine === generation) await connect(mine);
    },
    /** The session ended: nothing of it stays, and nothing late comes back. */
    clear() {
      generation += 1;
      stopStream();
      set({ ...EMPTY });
    },
  };
}

/** Open alarms in the board, counted. `open` is every alarm the engine still holds (seen or not),
 *  by severity; `waiting` those nobody has acknowledged yet. Numbers only: the lock screen shows
 *  these and nothing else of the ward. */
const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

export function alarmCounts(alerts) {
  const open = { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  let waiting = 0;
  for (const a of alerts) {
    open.total += 1;
    if (SEVERITY_ORDER.includes(a.severity)) open[a.severity] += 1;
    if (!a.ack) waiting += 1;
  }
  return { open, waiting };
}

/** The alarms nobody has acknowledged, most severe first, then the oldest first. */
export function waitingAlarms(alerts) {
  const rank = (a) => {
    const at = SEVERITY_ORDER.indexOf(a.severity);
    return at === -1 ? SEVERITY_ORDER.length : at;
  };
  return alerts.filter((a) => !a.ack).sort((a, b) => rank(a) - rank(b)
    || (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity));
}

/** The units the chip may offer: the engine's own scope, when it is restricted to two or more. */
export function scopeUnits(scope) {
  if (!scope || scope.unrestricted !== false || !Array.isArray(scope.unit_ids)) return [];
  const units = scope.unit_ids.filter((u) => typeof u === "string" && u.trim());
  return units.length >= 2 ? units : [];
}
