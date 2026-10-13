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
//
// An open stream must also still be ALIVE. The server's keep-alives are SSE comments, which
// EventSource never hands to the page, so a half-open connection (a Wi-Fi drop without a reset)
// would otherwise read LIVE for ever. The server sends a named `heartbeat` event every
// HEARTBEAT_MS of silence (api/app.py `sse_board_frames`); a stream that says nothing — no frame,
// no heartbeat — for STREAM_SILENCE_MS is dropped like a failed one: DEGRADED, a reconnect, and
// LIVE again only through its open and that open's reload.
import { patientFromBoard, patientsFromBoard, alertsFromPatients } from "../../liveAdapters.js";
import { CONNECTION } from "../../liveConnection.js";

export const RECONNECT_DELAY_MS = 5000;
/** The server's heartbeat cadence (api/app.py `sse_board_frames`, keepalive=15.0). */
export const HEARTBEAT_MS = 15_000;
/** Silence after which an open stream is taken for dead: three heartbeats missed. */
export const STREAM_SILENCE_MS = 3 * HEARTBEAT_MS;
/** The heartbeat's event name; the board's frames are unnamed (`message`). */
export const HEARTBEAT_EVENT = "heartbeat";

// `loaded`: the board holds a ward it LOADED (the last whole load succeeded), whatever the stream
// is doing. It is what tells "connecting, with the first load landed" — `start` loads first and
// opens the stream after — from "connecting, nothing yet": both are CONNECTING. The alarm sound
// and the notification act on a loaded board (alarmsToSignal); the bell still waits for LIVE.
const EMPTY = Object.freeze({
  patients: [], alerts: [], connection: CONNECTION.CONNECTING, scope: null, scopeNote: null,
  clockSkewMs: null, loaded: false,
});

/** Real SSE. `ticket` is short-lived and single-use: EventSource sends no headers, and a bearer
 *  token in a URL would leak into logs, history and Referer headers. */
function defaultOpenStream(url, handlers) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(url);
  source.onopen = handlers.onopen;
  source.onmessage = handlers.onmessage;
  source.onerror = handlers.onerror;
  source.addEventListener(HEARTBEAT_EVENT, handlers.onheartbeat);
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
  // The server's clock, as of the last answer (backendApi `serverClockSkewMs`), carried with the
  // ward it came with. A screen ages a timestamp against this and not against `Date.now()` alone:
  // the engine timestamps a reading by ITS clock, so an age measured by a ward tablet's clock is
  // wrong by however wrong that tablet is — and wrong in the reassuring direction half the time.
  const skewNow = () => (typeof api?.serverClockSkewMs === "function" ? api.serverClockSkewMs() : null);
  const withPatients = (patients, patch = {}) =>
    set({ patients, alerts: alertsFromPatients(patients), clockSkewMs: skewNow(), ...patch });
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
        { scope: board?.scope ?? null, scopeNote: board?.scope_note ?? null, connection, loaded: true });
    } else {
      // An empty list with the reason, never the last one: a board that stopped updating must
      // not look like a ward that is calm.
      withPatients([], { scope: null, scopeNote: null, connection: CONNECTION.UNAVAILABLE, loaded: false });
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

  /** One board entry, from wherever it came: a stream frame, or the answer a write gave (`/ack`
   *  replies with the patient's board entry as it is AFTER the acknowledgement). Treated exactly
   *  alike, so an answer applied here is also replayed over a snapshot still on its way and
   *  cannot be undone by it — and so a board whose load failed stays empty either way: one card is
   *  not a ward, and a screen showing only the bed somebody just acknowledged would be the worst
   *  of both (it looks like a board, and it is one patient). */
  function ingest(entry) {
    const removed = entry?.removed === true;
    // It must actually BE a board entry. `applyEntry` is public, and the chart answer
    // (`{patient_id, charted, alerts}`, api/clinical.py) looks enough like one to be handed to it
    // by mistake — whereupon `patientFromBoard` reads a card with no risk and no readings, that
    // card REPLACES the real one, and the patient's open alarm leaves `state.alerts`. The bell,
    // the rail's badge and the alarms screen are then wrong until the next whole reload. No write
    // may make an open alarm disappear, so an object that states neither a verdict (`risk`) nor
    // the readings behind one (`latest`) is not applied. A `removed` frame is the one entry that
    // legitimately carries neither.
    if (!removed && !isBoardEntry(entry)) return;
    const patient = patientFromBoard(entry);
    if (patient.patient_id == null) return;
    framesSeen += 1;
    const frame = { seq: framesSeen, patient, removed };
    if (loading.size > 0) frames.push(frame);    // for the snapshot on its way
    // A board whose load failed stays empty: frames alone are not a ward, only the next whole load is.
    if (state.connection === CONNECTION.UNAVAILABLE) return;
    withPatients(applyFrame(state.patients, frame));
  }

  function onMessage(event) {
    let entry;
    try {
      entry = JSON.parse(event.data);
    } catch {
      return;                                     // a malformed frame touches nothing
    }
    ingest(entry);
  }

  function onError(mine) {
    closeSource();                                // or the browser retries with the spent ticket
    if (mine !== generation) return;
    streamOpen = false;
    quiet();
    cancelReloadRetry();                          // the reconnect's open reloads instead
    // A board whose load failed stays UNAVAILABLE (empty, and says so); any other is DEGRADED.
    if (state.connection !== CONNECTION.UNAVAILABLE) set({ connection: CONNECTION.DEGRADED });
    if (reconnect) return;
    reconnect = setTimer(() => {
      reconnect = null;
      if (mine === generation) connect(mine);
    }, RECONNECT_DELAY_MS);
  }

  /** Anything heard from the stream (its open, a frame, a heartbeat) starts its silence over. */
  let silence = null;
  function quiet() {
    if (silence) clearTimer(silence);
    silence = null;
  }
  function heard(mine) {
    quiet();
    silence = setTimer(() => {
      silence = null;
      if (mine === generation) onError(mine);    // taken for dead: closed, DEGRADED, reconnected
    }, STREAM_SILENCE_MS);
  }

  async function connect(mine) {
    try {
      const { ticket } = await track(() => api.streamTicket());
      if (mine !== generation) return;
      closeSource = openStream(`/stream?ticket=${encodeURIComponent(ticket)}`, {
        onopen: () => { if (mine === generation) { heard(mine); onOpen(); } },
        onmessage: (event) => { if (mine === generation) { heard(mine); onMessage(event); } },
        onheartbeat: () => { if (mine === generation) heard(mine); },
        onerror: () => onError(mine),
      });
      heard(mine);                                // watched from here: one that never opens is dead too
    } catch {
      if (mine === generation) onError(mine);
    }
  }

  function stopStream() {
    if (reconnect) clearTimer(reconnect);
    reconnect = null;
    quiet();
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
    /** Put a board entry the API answered with onto the board (`/ack` answers with the patient's
     *  own entry). The same path a stream frame takes, so an answer is replayed over a snapshot
     *  still in flight exactly as a frame is, and a screen never has to guess what an
     *  acknowledgement did — it shows what came back.
     *
     *  What this does NOT promise is an order. The server's own publish of that board arrives as a
     *  frame as well, and the two carry no sequence number, so which of the two lands last is
     *  whatever the network decides. They agree in practice because they describe the same board
     *  state a moment apart; they are not *guaranteed* to, and the per-entry sequence number that
     *  would guarantee it is Group 2's (deferred.md). An earlier draft of this comment claimed they
     *  "cannot disagree", which is a stronger claim than the data supports.
     *
     *  Handing it something that is NOT a board entry THROWS in the test build. The refusal itself
     *  is right either way, but as a bare `return` it was also silent to the developer who caused
     *  it: an arm writing `applyEntry(await api.chart(...))` would get a screen that simply never
     *  updates, with no clue why. The stream's own path stays silent — a `heartbeat` frame is not
     *  an entry and never was one — so the loud check lives here, on the public call, where the
     *  only way to arrive is for somebody to have written it. `null` is tolerated: a caller may
     *  pass the result of a call that resolved to nothing, and there is simply nothing to apply. */
    applyEntry(entry) {
      if (entry !== null && entry !== undefined && !isBoardEntry(entry) && entry?.removed !== true
          && isTestBuild()) {
        throw new TypeError(
          "applyEntry: not a board entry (no `risk`, no `latest`). The /clinical answer is "
          + "`{patient_id, charted, alerts}` and is NOT one — `store.chart()` reloads the board itself.",
        );
      }
      return ingest(entry);
    },
    /**
     * Acknowledge one alarm (`POST /ack {patient_id, kind}`, permission `alerts.ack`) and put the
     * board entry it answers with onto the board. Resolves with that entry; REJECTS with the API's
     * own error, having changed nothing — there is no optimistic update to roll back, because
     * nothing is written before the server has taken it. A clinical screen must not show an
     * acknowledgement that may not have happened: "seen by" is a claim about a person.
     *
     * Through `track`, like every other call the board makes, so a refused refresh ends the
     * session here too and a 403 `password_change_required` moves the shell on. An answer that
     * arrives after `clear()` (the session ended) is dropped by `ingest`'s own generation check.
     */
    async acknowledge(patientId, kind) {
      const mine = generation;
      const entry = await track(() => api.acknowledge(patientId, kind));
      if (mine !== generation) return null;
      ingest(entry);
      return entry;
    },
    /**
     * Record that a clinician opened this patient (`POST /view`, permission `board.view`) — the
     * audit line an inspection asks for. It writes a log row and nothing else, so it changes no
     * state here. The CALLER decides when: only for a patient the screen actually shows, because
     * the server logs a refusal as `scope_denied` and a stale bookmark must not fill the trail
     * with refusals for views that never happened.
     *
     * Rejects with the API's error; a screen may ignore it (a missing audit row is not something
     * a clinician at the bedside can act on, and the board request is already in the trail).
     */
    view(patientId) {
      return track(() => api.view(patientId));
    },
    /**
     * Chart what a clinician observed (`POST /clinical/{id}`, permission `clinical.chart`).
     * `entries` is `[{code, value}]` and the engine fixes the unit for each code, so a screen
     * cannot chart a value in the wrong scale (api/clinical.py `CHARTABLE`).
     *
     * It reloads the board afterwards instead of applying what came back. Two reasons. The answer
     * is not a board entry — it is `{patient_id, charted, alerts}` — and more importantly the
     * charted value may change the ENGINE's conclusion about this patient: charting a suspected
     * infection is what lets the sepsis branch run at all (`septic_shock.evaluate` returns at its
     * first line without it), so the card that comes back can carry alarms that did not exist a
     * moment ago. The server publishes that same board as a frame, which a LIVE session would
     * receive anyway; the reload is what makes the screen correct for a session that is DEGRADED
     * or still connecting, and the frame and the reload go through the same `ingest` /
     * `withPatients` path.
     *
     * Rejects with the API's own error, having written nothing locally: a clinical screen must
     * never show a charted observation that the server may have refused.
     *
     * If the WRITE succeeded and the reload then failed, this still resolves, with the answer —
     * deliberately. The observation is in the engine's record and the clinician must be told so;
     * reporting it as a failure would invite them to chart it twice. `refresh()` does not reject,
     * it empties the board and sets UNAVAILABLE, so what the screen then shows is `BoardStrip`
     * saying the list is not shown because the load failed, which is true. One limit worth
     * knowing: `refresh()` arms its own retry only under an OPEN stream, so after a failed reload
     * with the stream closed the board waits for the next thing that loads it. Widening that
     * retry is a change to Wave 2's connection policy and belongs with the screen that charts
     * (G1-11) rather than in the shared store, where no screen can yet verify it.
     */
    async chart(patientId, entries) {
      const mine = generation;
      const answer = await track(() => api.chart(patientId, entries));
      if (mine !== generation) return null;
      await refresh();
      return answer;
    },
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

// ---------------------------------------------------------------- what the shell may say of it
// Each takes the board's state ({alerts, connection}: useBoard()) and answers with Decision 18
// already applied, so no screen has to remember it: `known` only from a LIVE board — the only one
// that may say "none"; `stale` from a DEGRADED one — what it last had, to be marked "may be out of
// date" with the dot; neither (connecting, unavailable) — it cannot know, and the numbers and the
// list are null, so nothing can show a 0 or an empty bell for it. Nothing here computes anything
// clinical: these are the engine's alarms, counted and ordered by the engine's own severity.
/** The alarm-severity vocabulary, worst first, and the ONE list every surface that orders or
 *  counts alarms reads: the bell and the rail badge through `waitingAlarms`/`alarmCounts`, and the
 *  alarms screen's own `worstFirst`. A severity not in it ranks -1 and so sorts FIRST, because the
 *  UI reads one it cannot account for as possibly-the-worst.
 *
 *  It is not `ENGINE_RISKS` (ui/riskStyle.js) and must not be replaced by it: that is the PATIENT
 *  RISK vocabulary and carries `none`, which is "no alarm at all" and is never an alarm's own
 *  severity — ranking by it would sort an alarm carrying "none" to the calmest end of the list. */
export const SEVERITY_ORDER = Object.freeze(["critical", "high", "moderate", "low", "info"]);

/** Is this object a board card (api/board.py `patient_board` / `identity_only_board`)? It states
 *  the engine's verdict, or the readings behind one — an identity-only card has a `risk` and empty
 *  readings, a device-only card has `latest` and no identity, and every real card has both. What it
 *  is NOT is any other answer that happens to carry a `patient_id`: the chart answer is the one
 *  that bites (see `ingest`), and `/ack`'s answer, which IS a board entry, passes. */
const isBoardEntry = (entry) => entry !== null && typeof entry === "object"
  && ("risk" in entry || "latest" in entry);

/** Same guard `routes.js`'s `testOnly` uses, and read the same way: in the test build a mistake
 *  should stop the test that made it. */
const isTestBuild = () => {
  try {
    return import.meta.env?.MODE === "test";
  } catch {
    return false;
  }
};

function knowing(connection) {
  return { known: connection === CONNECTION.LIVE, stale: connection === CONNECTION.DEGRADED };
}

/**
 * Whether this alarm is one somebody must answer.
 *
 * An alarm the engine marked `downgraded` is NOT. The engine's own contract says so
 * (rules/patient_relative.py, the header): a finding every contributor of which the patient's
 * charted chronic normal or a recorded comorbidity explains "stays visible but does NOT alarm or
 * escalate". A patient with dementia or chronic oxygen therapy would otherwise keep a red badge on
 * the rail and a line in the bell for the whole of their stay — and a count that never goes down
 * is a count nobody reads, which is how a real one gets missed.
 *
 * It stays VISIBLE: the bed card shows it, the alarms screen lists it, and both mark it
 * chronic-expected with the engine's own explanation. What it leaves is only the arithmetic that
 * means "this needs a person": the bell, the rail's badge, the board's attention line and the lock
 * screen's counts.
 *
 * `NEVER_SUPPRESSED` is the floor under that, and it changes nothing the engine can do today:
 * `rules/patient_relative.py` sets `downgraded=True` only in the branch that also sets
 * `severity=Severity.LOW`, so a downgraded critical cannot arrive. Nothing asserted that, and if
 * the rule ever downgraded without lowering, a CRITICAL alarm would silently never reach the bell,
 * the rail or the lock screen — the quietest failure this interface has available. The
 * chronic-expected rule exists for a chronic patient's low findings; it is not a licence to
 * suppress a critical one, whatever flags arrive beside it. So the flag is honoured for the
 * severities it was written about and ignored for the two it was not.
 */
const NEVER_SUPPRESSED = new Set(["critical", "high"]);

/**
 * Is this finding one the patient's own charted normal explains — chronic-expected?
 *
 * Exported because it must be asked in exactly ONE place. Two consequences follow from the answer
 * and they have to agree: the finding does not drive the waiting queue (`needsAnswer`, below), and
 * it wears the neutral "expected for this patient's own normal" pill (`ChronicExpected`,
 * screens/common/BoardState.jsx). When each decided for itself, a downgraded CRITICAL would both
 * reach the bell — correctly, by the floor above — and be labelled as expected, which is the
 * screen contradicting its own alarm count. Unreachable today (the engine downgrades only to LOW);
 * one predicate is what keeps it unreachable.
 */
export const isChronicExpected = (a) => a?.downgraded === true && !NEVER_SUPPRESSED.has(a?.severity);

const needsAnswer = (a) => !a.ack && !isChronicExpected(a);

/** Open alarms counted: `open` is every alarm the engine still holds (seen or not, downgraded or
 *  not), by severity (`unknown`: a severity this build does not know); `waiting` those nobody has
 *  acknowledged AND that the engine has not marked chronic-expected (`needsAnswer`). */
export function alarmCounts({ alerts = [], connection } = {}) {
  const { known, stale } = knowing(connection);
  if (!known && !stale) return { known, stale, open: null, waiting: null };
  const open = { total: 0, unknown: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  let waiting = 0;
  for (const a of alerts) {
    open.total += 1;
    open[SEVERITY_ORDER.includes(a.severity) ? a.severity : "unknown"] += 1;
    if (needsAnswer(a)) waiting += 1;
  }
  return { known, stale, open, waiting };
}

/** The alarms somebody must answer (`items`, for the bell and the rail's count): a severity this
 *  build does not know first — it may be the worst —, then the most severe, then the oldest first.
 *  A chronic-expected finding is not among them (`needsAnswer`); it is still on the card and in
 *  the alarms list. */
export function waitingAlarms({ alerts = [], connection } = {}) {
  const { known, stale } = knowing(connection);
  if (!known && !stale) return { known, stale, items: null };
  return { known, stale, items: queue(alerts) };
}

/** The alarms somebody must answer (`needsAnswer`), unknown severity first, then the most severe,
 *  then the oldest. The one ordering `waitingAlarms` and `alarmsToSignal` share. */
function queue(alerts) {
  const rank = (a) => SEVERITY_ORDER.indexOf(a.severity);   // -1: unknown, first
  return alerts.filter(needsAnswer).sort((a, b) => rank(a) - rank(b)
    || (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity));
}

/** The alarms the alarm sound and the critical-alarm notification act on (signals/signals.js): the
 *  same queue as `waitingAlarms` — `needsAnswer`, the same order — but from ANY board that holds a
 *  ward it loaded (`loaded`), LIVE or not: DEGRADED (what it last had, as the previous workspace
 *  went on sounding after a dropped stream) and CONNECTING once the first load has landed (the
 *  previous workspace sounded its first load). A board that never loaded, or whose load failed,
 *  gives no items. `known` is LIVE only, as everywhere: only a LIVE board may say an alarm stopped
 *  waiting. Not for the bell or a count — those still wait for LIVE (Decision 18). */
export function alarmsToSignal({ alerts = [], connection, loaded } = {}) {
  if (loaded !== true || connection === CONNECTION.UNAVAILABLE) return { known: false, items: [] };
  return { known: connection === CONNECTION.LIVE, items: queue(alerts) };
}

/** All the lock screen may show of the ward (Decision 3): the open alarms in the session's units,
 *  counted by severity, and how many nobody has acknowledged — with `known` / `stale` as above.
 *  Numbers and flags only: no name, bed, patient or summary can reach a locked screen through it.
 *  The lock screen reads the board through this and nothing else. */
export function lockSummary(board) {
  const { known, stale, open, waiting } = alarmCounts(board);
  return Object.freeze({ known, stale, open: open && Object.freeze({ ...open }), waiting });
}

/** The units the chip may offer: the engine's own scope, when it is restricted to two or more. */
export function scopeUnits(scope) {
  if (!scope || scope.unrestricted !== false || !Array.isArray(scope.unit_ids)) return [];
  const units = scope.unit_ids.filter((u) => typeof u === "string" && u.trim());
  return units.length >= 2 ? units : [];
}
