// useShiftEnd.test.js — G4-04 «İş yükü» review 7: one timer at the shift's end on the server's clock (the board's skew),
// which reads the page again; a new window re-arms it, and nothing fires once the page is gone. Fake timers.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PAST_THE_END_MS, useShiftEnd } from "./useShiftEnd.js";

const T0 = Date.parse("2026-11-12T19:50:00Z");
const MIN = 60_000;
const END = Date.parse("2026-11-12T20:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); });

describe("the refresh at the shift's end (useShiftEnd)", () => {
  it("fires once just past the end on the server's clock — two minutes ahead of this browser's here", async () => {
    const onEnd = vi.fn();
    renderHook(() => useShiftEnd({ endMs: END, skewMs: 2 * MIN, onEnd }));
    await act(async () => { await vi.advanceTimersByTimeAsync(8 * MIN - 1); });
    expect(onEnd).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_THE_END_MS + 1); });
    expect(onEnd).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * MIN); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("reads the browser's clock when the skew is not known", async () => {
    const onEnd = vi.fn();
    renderHook(() => useShiftEnd({ endMs: END, skewMs: null, onEnd }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * MIN); });
    expect(onEnd).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_THE_END_MS); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("re-arms for a new window, drops the old timer, calls the newest callback, and stops once gone", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook((props) => useShiftEnd(props),
      { initialProps: { endMs: END, skewMs: 0, onEnd: first } });
    rerender({ endMs: END + 12 * 60 * MIN, skewMs: 0, onEnd: second });     // the next window, read before the end
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * MIN + PAST_THE_END_MS); });
    expect([first, second].map((fn) => fn.mock.calls.length)).toEqual([0, 0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(12 * 60 * MIN); });
    expect(second).toHaveBeenCalledTimes(1);
    rerender({ endMs: END + 24 * 60 * MIN, skewMs: 0, onEnd: second });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * MIN); });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("arms nothing without a window, and fires at once for one already over", async () => {
    const onEnd = vi.fn();
    const { rerender } = renderHook((props) => useShiftEnd(props), { initialProps: { endMs: null, skewMs: 0, onEnd } });
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 60 * MIN); });
    expect(onEnd).not.toHaveBeenCalled();
    rerender({ endMs: Date.now() - MIN, skewMs: 0, onEnd });
    await act(async () => { await vi.advanceTimersByTimeAsync(PAST_THE_END_MS); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
