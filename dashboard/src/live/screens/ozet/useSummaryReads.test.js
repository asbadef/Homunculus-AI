// useSummaryReads.test.js — G4-02 «Yönetici özeti» (spec D5), the page's own reads, on a fake clock: the tree, `/tasks`
// and `/handovers/pending` read on open, every `everyMs` while the page is visible, at once when it is shown again, and
// never after it is gone; a round overtaken by a newer one never wins; the header's time stays at the last FULL round;
// an answer of the wrong shape is a failed read (plan N10). `/alarm-quality`: read on open and on a period change only,
// the newest period wins, and «Yeniden dene» reads it again. Synthetic answers only.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePeriodRead, useQuality, useSummaryReads } from "./useSummaryReads.js";

const T0 = Date.parse("2026-11-11T10:00:00Z");
const MIN = 60_000;
const TASKS = (id = "S-1") => ({ patients: [{ patient_id: id, unit_id: null, vital: null, tasks: [{ id: "t1", late: true }] }] });
const PENDING = { generated_at: "2026-11-11T10:00:00+00:00", units: [] };
const REPORT = (days) => ({ episodes: days, unanswered: 0 });
// GET /scope/me (scope/schemas.py ScopeView): an administrator's.
const ME = { user_id: "u-1", role: "hospital_admin", unrestricted: true, reason: "role", unit_ids: [], bed_ids: [],
  grants: [], own_patients: 0 };
const ALL = Object.freeze({ structure: true, tasks: true, pending: true });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** A session store as the page sees it: `track` runs the call, `api` the three reads. */
function fakeStore() {
  const api = {
    tasks: vi.fn().mockResolvedValue(TASKS()),
    pendingHandovers: vi.fn().mockResolvedValue(PENDING),
    myScope: vi.fn().mockResolvedValue(ME),
    alarmQuality: vi.fn().mockImplementation((days) => Promise.resolve(REPORT(days))),
  };
  return { api, track: (call) => call() };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
let hidden = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  hidden?.mockRestore();
  hidden = null;
  vi.useRealTimers();
});

describe("the page's own reads (useSummaryReads)", () => {
  it("reads on open, every `everyMs` while visible, not while hidden, at once when shown again, and never once gone", async () => {
    const store = fakeStore();
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const { unmount } = renderHook(() => useSummaryReads({ store, rights: ALL, reloadStructure, everyMs: 1000 }));
    await flush();
    const counts = () => [reloadStructure, store.api.tasks, store.api.pendingHandovers, store.api.myScope]
      .map((read) => read.mock.calls.length);
    expect(counts()).toEqual([1, 1, 1, 1]);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(counts()).toEqual([2, 2, 2, 2]);

    hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(counts()).toEqual([2, 2, 2, 2]);                    // hidden: no poll, and hiding is no reason to read

    hidden.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(counts()).toEqual([3, 3, 3, 3]);                    // shown again: at once

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); document.dispatchEvent(new Event("visibilitychange")); });
    expect(counts()).toEqual([3, 3, 3, 3]);
  });

  it("reads only what the session may read — and the caller's own scope, which every signed-in user may", async () => {
    const store = fakeStore();
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const rights = { structure: false, tasks: false, pending: true };
    const { result } = renderHook(() => useSummaryReads({ store, rights, reloadStructure, everyMs: 1000 }));
    await flush();
    expect(reloadStructure).not.toHaveBeenCalled();
    expect(store.api.tasks).not.toHaveBeenCalled();
    expect(result.current.pending.phase).toBe("ok");
    expect(result.current.scope).toMatchObject({ phase: "ok", data: ME });
    expect(result.current.fullAt).toBe(T0);                    // every source this session may read answered
  });

  it("counts the scope read in the full round, and refuses a scope of the wrong shape", async () => {
    const store = fakeStore();
    store.api.myScope.mockResolvedValueOnce({ unrestricted: "yes", unit_ids: [] });
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const { result } = renderHook(() => useSummaryReads({ store, rights: ALL, reloadStructure, everyMs: 60 * MIN }));
    await flush();
    expect(result.current.scope).toMatchObject({ phase: "failed", data: null });
    expect(result.current.tasks.phase).toBe("ok");
    expect(result.current.fullAt).toBeNull();
    vi.setSystemTime(T0 + MIN);
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.scope).toMatchObject({ phase: "ok", data: ME });
    expect(result.current.fullAt).toBe(T0 + MIN);
  });

  it("never lets a round overtaken by a newer one win", async () => {
    const store = fakeStore();
    const first = deferred();
    const second = deferred();
    store.api.tasks.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const { result } = renderHook(() => useSummaryReads({ store, rights: ALL, reloadStructure, everyMs: 60_000 }));
    await flush();
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { second.resolve(TASKS("S-new")); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { first.resolve(TASKS("S-old")); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.tasks.data).toEqual(TASKS("S-new"));
    expect(result.current.busy).toBe(false);
  });

  it("keeps the header's time at the last FULL round when a later one fails in part, and drops the failed answer", async () => {
    const store = fakeStore();
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const { result } = renderHook(() => useSummaryReads({ store, rights: ALL, reloadStructure, everyMs: 60 * MIN }));
    await flush();
    expect(result.current.fullAt).toBe(T0);

    vi.setSystemTime(T0 + 5 * MIN);
    store.api.tasks.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 }));
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.tasks).toMatchObject({ phase: "failed", data: null });
    expect(result.current.pending.atMs).toBe(T0 + 5 * MIN);
    expect(result.current.fullAt).toBe(T0);

    vi.setSystemTime(T0 + 10 * MIN);
    reloadStructure.mockResolvedValueOnce(null);                // the tree's read failed (StructureProvider: null)
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.fullAt).toBe(T0);

    vi.setSystemTime(T0 + 15 * MIN);
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.fullAt).toBe(T0 + 15 * MIN);
  });

  it("counts an answer of the wrong shape as a failed read, not a partial one", async () => {
    const store = fakeStore();
    store.api.tasks.mockResolvedValue({ patients: [{ patient_id: "S-1", unit_id: null, vital: null, tasks: null }] });
    store.api.pendingHandovers.mockResolvedValue({ generated_at: PENDING.generated_at,
      units: [{ unit_id: "u-1", unit_name: "Sentetik", pending: "2", oldest_outgoing_signed_at: null }] });
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const { result } = renderHook(() => useSummaryReads({ store, rights: ALL, reloadStructure, everyMs: 60_000 }));
    await flush();
    expect(result.current.tasks).toMatchObject({ phase: "failed", data: null });
    expect(result.current.pending).toMatchObject({ phase: "failed", data: null });
    expect(result.current.fullAt).toBeNull();
  });
});

describe("the alarm quality's read (useQuality)", () => {
  it("is read on open and on a period change only — never on a timer", async () => {
    const store = fakeStore();
    const { result, rerender } = renderHook(({ period }) => useQuality({ store, may: true, period }), { initialProps: { period: 7 } });
    await flush();
    expect(result.current).toMatchObject({ phase: "ok", data: REPORT(7), atMs: T0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * MIN); });
    expect(store.api.alarmQuality).toHaveBeenCalledTimes(1);
    rerender({ period: 30 });
    await flush();
    expect(store.api.alarmQuality).toHaveBeenLastCalledWith(30);
    expect(result.current.data).toEqual(REPORT(30));
  });

  it("lets the newest period win: a 7-day answer landing after the 30-day one is dropped", async () => {
    const store = fakeStore();
    const week = deferred();
    const month = deferred();
    store.api.alarmQuality.mockImplementation((days) => (days === 7 ? week.promise : month.promise));
    const { result, rerender } = renderHook(({ period }) => useQuality({ store, may: true, period }), { initialProps: { period: 7 } });
    await flush();
    rerender({ period: 30 });
    await flush();
    await act(async () => { month.resolve(REPORT(30)); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { week.resolve(REPORT(7)); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toEqual(REPORT(30));
    // …and a late failure of the older period does not overwrite the newer answer either.
    const failing = deferred();
    store.api.alarmQuality.mockImplementation((days) => (days === 1 ? failing.promise : Promise.resolve(REPORT(days))));
    rerender({ period: 1 });
    await flush();
    rerender({ period: 30 });
    await flush();
    await act(async () => { failing.reject(new Error("late")); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ phase: "ok", data: REPORT(30) });
  });

  it("reads the same period again on «Yeniden dene» after a failure", async () => {
    const store = fakeStore();
    store.api.alarmQuality.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 }));
    const { result } = renderHook(() => useQuality({ store, may: true, period: 7 }));
    await flush();
    expect(result.current.phase).toBe("failed");
    await act(async () => { result.current.retry(); await vi.advanceTimersByTimeAsync(0); });
    expect(store.api.alarmQuality).toHaveBeenCalledTimes(2);
    expect(store.api.alarmQuality).toHaveBeenLastCalledWith(7);
    expect(result.current).toMatchObject({ phase: "ok", data: REPORT(7) });
  });

  it("is not read without the right, and an answer that is not a report is a failure", async () => {
    const store = fakeStore();
    renderHook(() => useQuality({ store, may: false, period: 7 }));
    await flush();
    expect(store.api.alarmQuality).not.toHaveBeenCalled();
    store.api.alarmQuality.mockResolvedValueOnce({ episodes: "12" });
    const { result } = renderHook(() => useQuality({ store, may: true, period: 7 }));
    await flush();
    expect(result.current).toMatchObject({ phase: "failed", data: null, error: null });
  });
});

// G4-03: «Kalite göstergeleri» reads its own answer through the same hook — its own read and its own check.
describe("one read for a period (usePeriodRead)", () => {
  const READ = (api, days) => api.alarmQuality(days);
  const EVEN = (answer) => answer?.episodes % 2 === 0;

  it("reads with the read it is given, and an answer its check refuses is a failed read", async () => {
    const store = fakeStore();
    const { result, rerender } = renderHook(
      ({ period }) => usePeriodRead({ store, may: true, period, read: READ, valid: EVEN }), { initialProps: { period: 30 } });
    await flush();
    expect(result.current).toMatchObject({ phase: "ok", data: REPORT(30) });
    rerender({ period: 7 });
    await flush();
    expect(result.current).toMatchObject({ phase: "failed", data: null, error: null });
    expect(store.api.alarmQuality.mock.calls.map(([days]) => days)).toEqual([30, 7]);
  });
});
