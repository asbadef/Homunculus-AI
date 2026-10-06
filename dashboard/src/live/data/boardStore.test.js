import { describe, it, expect, vi } from "vitest";
import { RECONNECT_DELAY_MS, alarmCounts, createBoardStore, scopeUnits, waitingAlarms } from "./boardStore.js";
import { CONNECTION } from "../../liveConnection.js";

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
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: vi.fn(),
  });
  return { api, store, handlers, closes, timers, openStream, state: () => store.getState() };
}

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
    const { api, store, handlers, timers, state } = setup();
    await store.start();
    handlers[0].onopen();
    await vi.waitFor(() => expect(state().connection).toBe(CONNECTION.LIVE));
    handlers[0].onerror();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(state().patients).toHaveLength(2);                          // shown, flagged as maybe old
    let answer;
    api.boardPatients.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    await timers[0].fn();
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
    const { api, store, handlers, closes, timers, state } = setup();
    await store.start();
    handlers[0].onerror();
    handlers[0].onerror();
    expect(closes[0]).toHaveBeenCalled();
    expect(state().connection).toBe(CONNECTION.DEGRADED);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(RECONNECT_DELAY_MS);
    api.streamTicket.mockResolvedValue({ ticket: "t-2" });
    await timers[0].fn();
    expect(api.streamTicket).toHaveBeenCalledTimes(2);
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

describe("alarm counts and lists", () => {
  const alerts = [
    { id: "a", severity: "critical", ack: null, firstSeenAtMs: 300 },
    { id: "b", severity: "high", ack: { by: "ayse" }, firstSeenAtMs: 100 },
    { id: "c", severity: "high", ack: null, firstSeenAtMs: 200 },
    { id: "d", severity: "info", ack: null, firstSeenAtMs: null },
    { id: "e", severity: "high", ack: null, firstSeenAtMs: 50 },
  ];

  it("counts every open alarm by severity, and the ones nobody acknowledged", () => {
    expect(alarmCounts(alerts)).toEqual({
      open: { total: 5, critical: 1, high: 3, moderate: 0, low: 0, info: 1 }, waiting: 4,
    });
    expect(alarmCounts([])).toEqual({ open: { total: 0, critical: 0, high: 0, moderate: 0, low: 0, info: 0 }, waiting: 0 });
  });

  it("lists the unacknowledged ones, most severe first, oldest first within a severity", () => {
    expect(waitingAlarms(alerts).map((a) => a.id)).toEqual(["a", "e", "c", "d"]);
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
