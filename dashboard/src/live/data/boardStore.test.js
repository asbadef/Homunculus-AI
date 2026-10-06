import { describe, it, expect, vi, afterEach } from "vitest";
import {
  HEARTBEAT_MS, RECONNECT_DELAY_MS, STREAM_SILENCE_MS, alarmCounts, createBoardStore, lockSummary, scopeUnits, waitingAlarms,
} from "./boardStore.js";
import { CONNECTION } from "../../liveConnection.js";
import { alertsFromPatients, patientsFromBoard } from "../../liveAdapters.js";

// Synthetic board entries, in the API's /patients shape (api/board.py). No real data.
const entry = (id, alerts = [], extra = {}) => ({
  patient_id: id, risk: "moderate", vitals: {}, alerts, last_update: "2026-10-04T08:00:00Z", ...extra,
});
const alert = (kind, severity, extra = {}) => ({
  kind, severity, summary: `${kind} ölçütü karşılandı`, first_seen_at: "2026-10-04T07:58:00Z",
  acknowledged: false, ...extra,
});
const BOARD = {
  patients: [entry("P-001", [alert("news2", "high")]), entry("P-002")],
  scope: { unrestricted: false, unit_ids: ["REA", "NICU"] }, scope_note: "2 birim",
};

function setup({ board = BOARD } = {}) {
  const handlers = [];
  const closes = [];
  const timers = [];
  const api = {
    boardPatients: vi.fn().mockResolvedValue(board),
    streamTicket: vi.fn().mockResolvedValue({ ticket: "t-1" }),
  };
  const openStream = vi.fn((url, h) => {
    handlers.push(h);
    const close = vi.fn();
    closes.push(close);
    return close;
  });
  const store = createBoardStore({
    api, openStream,
    setTimer: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimer: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
  });
  /** The timers of this length still pending. */
  const due = (ms) => timers.filter((t) => t.ms === ms && !t.cleared);
  /** Run the last pending timer of this length, as the clock would. */
  const fire = (ms) => {
    const timer = due(ms).at(-1);
    timer.cleared = true;
    return timer.fn();
  };
  return { api, store, handlers, closes, timers, due, fire, openStream, state: () => store.getState() };
}

/** Let every answer already given land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the board store", () => {
  it("loads the board, then streams with a ticket — never a token in the URL", async () => {
    const { api, store, openStream, handlers, state } = setup();
    await store.start();
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002"]);
    expect(state().alerts).toHaveLength(1);
    expect(state().scope).toEqual(BOARD.scope);
    expect(state().scopeNote).toBe("2 birim");
    expect(openStream).toHaveBeenCalledWith("/stream?ticket=t-1", expect.any(Object));
    expect(state().connection).toBe(CONNECTION.CONNECTING);          // the stream is not open yet
    handlers[0].onopen();
    expect(api.boardPatients).toHaveBeenCalledTimes(2);                // the open reloads the board
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
  });

  it("is never LIVE over a load that failed — an open stream vouches for nothing", async () => {
    const { api, store, handlers, state } = setup();
    api.boardPatients.mockRejectedValue(new Error("Failed to fetch"));
    await store.start();
    expect(state()).toMatchObject({ patients: [], connection: CONNECTION.UNAVAILABLE });
    handlers[0].onopen();
    await vi.waitFor(() => expect(api.boardPatients).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    handlers[0].onmessage({ data: JSON.stringify(entry("P-003", [alert("sepsis", "critical")])) });
    expect(state()).toMatchObject({ patients: [], alerts: [], connection: CONNECTION.UNAVAILABLE });
    handlers[0].onerror();
    expect(state().connection).toBe(CONNECTION.UNAVAILABLE);
  });

  it("reloads at every reopen, and is LIVE again only once that load has landed", async () => {
    const { api, store, handlers, fire, state } = setup();
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    handlers[0].onerror();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(state().patients).toHaveLength(2);                          // shown, flagged as maybe old
    let answer;
    api.boardPatients.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await fire(RECONNECT_DELAY_MS);
    handlers[1].onopen();
    expect(api.boardPatients).toHaveBeenCalledTimes(3);
    expect(state().connection).toBe(CONNECTION.DEGRADED);              // open, not reloaded yet
    answer({ ...BOARD, patients: [entry("P-002")] });
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-002"]);
  });

  it("drops a load that a later one overtook", async () => {
    const { api, store, handlers, state } = setup();
    await store.start();
    let early;
    api.boardPatients.mockImplementationOnce(() => new Promise((resolve) => { early = resolve; }));
    const overtaken = store.refresh();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    early({ ...BOARD, patients: [] });
    await overtaken;
    expect(state()).toMatchObject({ connection: CONNECTION.LIVE });
    expect(state().patients).toHaveLength(2);
  });

  it("on a failed load shows nothing and says UNAVAILABLE — never the previous list", async () => {
    const { api, store, state } = setup();
    await store.start();
    api.boardPatients.mockRejectedValue(new Error("Failed to fetch"));
    await store.refresh();
    expect(state()).toMatchObject({ patients: [], alerts: [], scope: null, connection: CONNECTION.UNAVAILABLE });
  });

  it("merges stream frames, and takes a removed patient off", async () => {
    const { store, handlers, state } = setup();
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    handlers[0].onmessage({ data: JSON.stringify(entry("P-003", [alert("sepsis", "critical")])) });
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002", "P-003"]);
    handlers[0].onmessage({ data: JSON.stringify({ ...entry("P-001"), removed: true }) });
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-002", "P-003"]);
    handlers[0].onmessage({ data: "{not json" });
    expect(state().patients).toHaveLength(2);
  });

  it("closes a dropped stream and reconnects ONCE, with a fresh ticket", async () => {
    const { api, store, handlers, closes, due, fire, state } = setup();
    await store.start();
    handlers[0].onerror();
    handlers[0].onerror();
    expect(closes[0]).toHaveBeenCalled();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(due(RECONNECT_DELAY_MS)).toHaveLength(1);
    api.streamTicket.mockResolvedValue({ ticket: "t-2" });
    await fire(RECONNECT_DELAY_MS);
    expect(api.streamTicket).toHaveBeenCalledTimes(2);
  });

  it("tries again a reload that failed under an open stream — a healthy stream does not leave it UNAVAILABLE", async () => {
    const { api, store, handlers, due, fire, state } = setup();
    await store.start();
    api.boardPatients.mockRejectedValueOnce(Object.assign(new Error("upstream"), { status: 503 }));
    handlers[0].onopen();
    await settle();
    expect(state()).toMatchObject({ patients: [], alerts: [], connection: CONNECTION.UNAVAILABLE });
    handlers[0].onmessage({ data: JSON.stringify(entry("P-001", [alert("sepsis", "critical")])) });
    expect(state()).toMatchObject({ patients: [], connection: CONNECTION.UNAVAILABLE });   // frames alone are no ward
    expect(due(RECONNECT_DELAY_MS)).toHaveLength(1);
    await fire(RECONNECT_DELAY_MS);
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    expect(api.boardPatients).toHaveBeenCalledTimes(3);
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002"]);
  });

  it("keeps trying while the reload keeps failing, and stops when the stream drops or the board is cleared", async () => {
    const { api, store, handlers, due, fire, state } = setup();
    await store.start();
    api.boardPatients.mockRejectedValue(new Error("Failed to fetch"));
    handlers[0].onopen();
    await settle();
    await fire(RECONNECT_DELAY_MS);
    await settle();
    expect(due(RECONNECT_DELAY_MS)).toHaveLength(1);                  // tried, failed, scheduled again
    expect(state().connection).toBe(CONNECTION.UNAVAILABLE);
    handlers[0].onerror();                                             // the stream's reconnect takes over
    expect(due(RECONNECT_DELAY_MS)).toHaveLength(1);
    store.clear();
    expect(due(RECONNECT_DELAY_MS)).toHaveLength(0);
  });

  it("a frame that arrives while a reload is on its way outlives the older snapshot", async () => {
    const { api, store, handlers, state } = setup();
    await store.start();
    let answer;
    api.boardPatients.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    handlers[0].onopen();                                              // the reload: its snapshot is taken now
    handlers[0].onmessage({ data: JSON.stringify(entry("P-001", [alert("sepsis", "critical")])) });
    handlers[0].onmessage({ data: JSON.stringify({ ...entry("P-002"), removed: true }) });
    expect(state().alerts).toHaveLength(1);
    answer(BOARD);                                                     // older than both frames
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001"]);
    expect(state().alerts).toEqual([expect.objectContaining({ patientId: "P-001", kind: "sepsis", severity: "critical" })]);
  });

  it("frames that came while a failed board reloaded land on its snapshot", async () => {
    const { api, store, handlers, fire, state } = setup();
    await store.start();
    api.boardPatients.mockRejectedValueOnce(new Error("Failed to fetch"));
    handlers[0].onopen();
    await settle();
    expect(state().connection).toBe(CONNECTION.UNAVAILABLE);
    let answer;
    api.boardPatients.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    await fire(RECONNECT_DELAY_MS);
    handlers[0].onmessage({ data: JSON.stringify(entry("P-003", [alert("news2", "high")])) });
    expect(state().patients).toEqual([]);                               // still no ward shown
    answer(BOARD);
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    expect(state().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002", "P-003"]);
  });

  it("forgets everything on clear(), and drops an answer that arrives afterwards", async () => {
    const { api, store, state } = setup();
    let answer;
    api.boardPatients.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const started = store.start();
    store.clear();
    answer(BOARD);
    await started;
    expect(state()).toMatchObject({ patients: [], alerts: [], scope: null, connection: CONNECTION.CONNECTING });
    expect(api.streamTicket).not.toHaveBeenCalled();
  });
});

// The server's keep-alives are SSE comments, which EventSource never hands to the page: a
// half-open connection (a Wi-Fi drop without a reset) would read LIVE for ever. The server sends a
// named `heartbeat` event on the same cadence; a stream that says nothing — no frame, no heartbeat
// — for three of them is taken for dead, and LIVE comes back only through a reopen and its reload.
describe("a stream that has gone silent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is dropped after three heartbeats' silence, and LIVE again only after the reopen's reload", async () => {
    const { store, handlers, closes, due, fire, state } = setup();
    expect(STREAM_SILENCE_MS).toBe(3 * HEARTBEAT_MS);
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    expect(due(STREAM_SILENCE_MS)).toHaveLength(1);
    fire(STREAM_SILENCE_MS);
    expect(closes[0]).toHaveBeenCalled();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(state().patients).toHaveLength(2);                          // shown, flagged as maybe old
    await fire(RECONNECT_DELAY_MS);
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    handlers[1].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
  });

  it("is kept by a heartbeat or a frame, which each start the silence over", async () => {
    const { store, handlers, due, state } = setup();
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    const before = due(STREAM_SILENCE_MS)[0];
    handlers[0].onheartbeat();
    expect(before.cleared).toBe(true);
    expect(due(STREAM_SILENCE_MS)).toHaveLength(1);
    const afterHeartbeat = due(STREAM_SILENCE_MS)[0];
    handlers[0].onmessage({ data: JSON.stringify(entry("P-003")) });
    expect(afterHeartbeat.cleared).toBe(true);
    expect(due(STREAM_SILENCE_MS)).toHaveLength(1);
    expect(state()).toMatchObject({ connection: CONNECTION.LIVE });
    expect(state().patients).toHaveLength(3);                          // a heartbeat is no frame
  });

  it("is watched from the moment it is opened: one that never answers is dropped too", async () => {
    const { store, due, fire, state } = setup();
    await store.start();
    expect(due(STREAM_SILENCE_MS)).toHaveLength(1);
    fire(STREAM_SILENCE_MS);
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(due(RECONNECT_DELAY_MS)).toHaveLength(1);
  });

  it("stops being watched when the board is cleared", async () => {
    const { store, handlers, due } = setup();
    await store.start();
    handlers[0].onopen();
    store.clear();
    expect(due(STREAM_SILENCE_MS)).toHaveLength(0);
  });

  it("hears the server's named heartbeat through a real EventSource, and never takes it for a patient", async () => {
    // EventSource as the HTML spec has it: a named event is dispatched under its own type and
    // never reaches `onmessage`, which hears only unnamed (`message`) events.
    const sources = [];
    class FakeEventSource extends EventTarget {
      constructor(url) { super(); this.url = url; sources.push(this); }
      close() { this.closed = true; }
      emit(type, data) {
        const event = new MessageEvent(type, { data });
        this.dispatchEvent(event);
        if (type === "message") this.onmessage?.(event);
        if (type === "open") this.onopen?.(event);
      }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const timers = [];
    const api = { boardPatients: vi.fn().mockResolvedValue(BOARD), streamTicket: vi.fn().mockResolvedValue({ ticket: "t-1" }) };
    const store = createBoardStore({
      api,
      setTimer: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
      clearTimer: (id) => { timers[id - 1].cleared = true; },
    });
    await store.start();
    expect(sources[0].url).toBe("/stream?ticket=t-1");
    sources[0].emit("open");
    await vi.waitFor(() => expect(store.getState().connection).toBe(CONNECTION.LIVE));
    const watching = () => timers.filter((t) => t.ms === STREAM_SILENCE_MS && !t.cleared);
    const before = watching()[0];
    sources[0].emit("heartbeat", "{}");
    expect(before.cleared).toBe(true);
    expect(watching()).toHaveLength(1);
    expect(store.getState().patients.map((p) => p.patient_id)).toEqual(["P-001", "P-002"]);
    sources[0].emit("message", "{}");                                  // a heartbeat's data mis-delivered
    expect(store.getState().patients).toHaveLength(2);
    store.clear();
    expect(sources[0].closed).toBe(true);
  });
});

describe("alarm counts and lists", () => {
  const alerts = [
    { id: "a", severity: "critical", ack: null, firstSeenAtMs: 300 },
    { id: "b", severity: "high", ack: { by: "ayse" }, firstSeenAtMs: 100 },
    { id: "c", severity: "high", ack: null, firstSeenAtMs: 200 },
    { id: "d", severity: "info", ack: null, firstSeenAtMs: null },
    { id: "e", severity: "high", ack: null, firstSeenAtMs: 50 },
  ];

  const NONE = { total: 0, unknown: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 };

  it("counts every open alarm by severity, and the ones nobody acknowledged — known, from a LIVE board", () => {
    expect(alarmCounts({ alerts, connection: CONNECTION.LIVE })).toEqual({
      known: true, stale: false,
      open: { ...NONE, total: 5, critical: 1, high: 3, info: 1 }, waiting: 4,
    });
    expect(alarmCounts({ alerts: [], connection: CONNECTION.LIVE })).toEqual({ known: true, stale: false, open: NONE, waiting: 0 });
  });

  it("lists the unacknowledged ones, most severe first, oldest first within a severity", () => {
    expect(waitingAlarms({ alerts, connection: CONNECTION.LIVE })).toEqual({
      known: true, stale: false, items: [alerts[0], alerts[4], alerts[2], alerts[3]],
    });
  });

  it("puts a severity it does not know first, and counts it apart — it may be the worst", () => {
    const odd = [...alerts, { id: "x", severity: "extreme", ack: null, firstSeenAtMs: 900 },
      { id: "y", severity: null, ack: null, firstSeenAtMs: 800 }];
    expect(waitingAlarms({ alerts: odd, connection: CONNECTION.LIVE }).items.map((a) => a.id))
      .toEqual(["y", "x", "a", "e", "c", "d"]);
    expect(alarmCounts({ alerts: odd, connection: CONNECTION.LIVE }).open).toMatchObject({ total: 7, unknown: 2 });
  });

  // Decision 18, said by the store so that no screen has to remember it: only a LIVE board knows
  // (and may say "none"); a DEGRADED one shows what it last had, stale; any other cannot know —
  // no number, no list, so nothing can show a 0 or an empty bell for it.
  it("is stale from a DEGRADED board, and nothing at all from one connecting or unavailable", () => {
    expect(alarmCounts({ alerts, connection: CONNECTION.DEGRADED })).toMatchObject({ known: false, stale: true, waiting: 4 });
    expect(waitingAlarms({ alerts, connection: CONNECTION.DEGRADED })).toMatchObject({ known: false, stale: true });
    for (const connection of [CONNECTION.CONNECTING, CONNECTION.UNAVAILABLE, undefined]) {
      expect(alarmCounts({ alerts, connection })).toEqual({ known: false, stale: false, open: null, waiting: null });
      expect(waitingAlarms({ alerts, connection })).toEqual({ known: false, stale: false, items: null });
    }
  });

  it("gives the lock screen numbers and nothing else of the ward", () => {
    const named = alertsFromPatients(patientsFromBoard({
      patients: [entry("P-001", [alert("sepsis", "critical")], { identity: { bed_label: "REA-01", display_name: "Sentetik Hasta" } })],
    }));
    const summary = lockSummary({ alerts: named, connection: CONNECTION.LIVE, patients: [{ patient_id: "P-001" }] });
    expect(summary).toEqual({ known: true, stale: false, open: { ...NONE, total: 1, critical: 1 }, waiting: 1 });
    expect(JSON.stringify(summary)).not.toMatch(/P-001|REA-01|Sentetik|sepsis/);
    expect(Object.isFrozen(summary) && Object.isFrozen(summary.open)).toBe(true);
    expect(lockSummary({ alerts: named, connection: CONNECTION.UNAVAILABLE })).toEqual({ known: false, stale: false, open: null, waiting: null });
  });
});

describe("the units the chip offers", () => {
  it("are the engine's restricted scope, from two units up", () => {
    expect(scopeUnits({ unrestricted: false, unit_ids: ["REA", "NICU"] })).toEqual(["REA", "NICU"]);
    expect(scopeUnits({ unrestricted: false, unit_ids: ["REA"] })).toEqual([]);
    expect(scopeUnits({ unrestricted: true, unit_ids: [] })).toEqual([]);
    expect(scopeUnits(null)).toEqual([]);
    expect(scopeUnits({ unrestricted: false, unit_ids: ["REA", " ", 3] })).toEqual([]);
  });
});
