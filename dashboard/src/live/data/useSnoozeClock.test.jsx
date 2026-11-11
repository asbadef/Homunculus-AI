// useSnoozeClock.test.jsx — the board's clock for the waiting queue (G2-B5b, spec D4): one timer at the next snooze's
// end, not a tick. Synthetic alarms.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { CONNECTION } from "../../liveConnection.js";
import { BoardProvider, useBoard } from "./BoardProvider.jsx";
import { waitingAlarms } from "./boardStore.js";
import { useSnoozeClock } from "./useSnoozeClock.js";

const NOW = Date.parse("2026-11-10T10:00:00Z");
const MIN = 60_000;
const storeOf = (state) => ({ subscribe: () => () => {}, getState: () => state });
/** A store a test can change, as a stream frame or a new skew would. */
function storeWith(initial) {
  let state = initial;
  const subscribers = new Set();
  return {
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
    getState: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of subscribers) fn(); },
  };
}
const snoozed = (untilMs) => ({ id: `x${untilMs}`, severity: "high", status: "FIRED", ack: null,
  snooze: { atMs: untilMs - 5 * MIN, untilMs } });
const LIVE = { connection: CONNECTION.LIVE, clockSkewMs: null };

function Probe() {
  return <p data-testid="now">{useSnoozeClock()}</p>;
}
/** The clock, and the waiting queue as the bell reads it with that clock. */
function QueueProbe() {
  const board = useBoard();
  const nowMs = useSnoozeClock();
  return (
    <>
      <p data-testid="now">{nowMs}</p>
      <p data-testid="waiting">{waitingAlarms({ ...board, nowMs }).items?.length ?? "?"}</p>
    </>
  );
}
const shown = () => Number(screen.getByTestId("now").textContent);
const waiting = () => Number(screen.getByTestId("waiting").textContent);
const fake = () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the board's clock for the waiting queue", () => {
  it("is read again the moment the next snooze ends — one timer, not a tick", () => {
    fake();
    const state = { alerts: [snoozed(NOW + 60_000), snoozed(NOW + 120_000)], clockSkewMs: null };
    render(<BoardProvider store={storeOf(state)}><Probe /></BoardProvider>);
    expect(shown()).toBe(NOW);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(59_000); });
    expect(shown()).toBe(NOW);
    act(() => { vi.advanceTimersByTime(1_100); });
    expect(shown()).toBeGreaterThanOrEqual(NOW + 60_000);
    expect(vi.getTimerCount()).toBe(1);   // armed again, for the next one
  });

  it("sets no timer when nothing is snoozed, and corrects by the server's skew", () => {
    fake();
    render(<BoardProvider store={storeOf({ alerts: [], clockSkewMs: 5_000 })}><Probe /></BoardProvider>);
    expect(shown()).toBe(NOW + 5_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sets no timer for a snooze whose until has already passed, and counts its alarm as waiting", () => {
    fake();
    render(<BoardProvider store={storeOf({ ...LIVE, alerts: [snoozed(NOW - 1)] })}><QueueProbe /></BoardProvider>);
    expect(vi.getTimerCount()).toBe(0);
    expect(waiting()).toBe(1);
  });

  it("clears its timer when it unmounts", () => {
    fake();
    const { unmount } = render(<BoardProvider store={storeOf({ ...LIVE, alerts: [snoozed(NOW + MIN)] })}>
      <QueueProbe /></BoardProvider>);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Review (G2-B5b): a timer is never set for longer than a minute, so one the browser fired late, or lost, holds
  // the queue back by a minute at most.
  it("waits a minute at most before it reads the clock again, however far the snooze's end", () => {
    fake();
    render(<BoardProvider store={storeOf({ ...LIVE, alerts: [snoozed(NOW + 20 * MIN)] })}><QueueProbe /></BoardProvider>);
    expect(waiting()).toBe(0);
    act(() => { vi.advanceTimersByTime(MIN); });
    expect(shown()).toBe(NOW + MIN);
    expect(waiting()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("is armed again when the server's skew changes, on the corrected clock", () => {
    fake();
    const store = storeWith({ ...LIVE, clockSkewMs: 0, alerts: [snoozed(NOW + MIN)] });
    render(<BoardProvider store={store}><QueueProbe /></BoardProvider>);
    act(() => { store.set({ clockSkewMs: 30_000 }); });   // the server is 30 s ahead: the snooze ends 30 s sooner here
    expect(shown()).toBe(NOW + 30_000);
    expect(waiting()).toBe(0);
    act(() => { vi.advanceTimersByTime(30_100); });
    expect(waiting()).toBe(1);
  });

  it("is armed for a snooze that arrives long after it mounted, and wakes at its end", () => {
    fake();
    const store = storeWith({ ...LIVE, alerts: [] });
    render(<BoardProvider store={store}><QueueProbe /></BoardProvider>);
    vi.setSystemTime(NOW + 10 * MIN);                       // ten minutes with nothing snoozed: no timer ran
    act(() => { store.set({ alerts: [snoozed(NOW + 11 * MIN)] }); });
    expect(waiting()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(MIN + 100); });
    expect(waiting()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Review (G2-B5b): a card that arrives with a snooze already over is judged on the clock as it is NOW, never on a
  // read from before it came — not even for the instant until a timer would have caught up.
  it("never hides an alarm whose snooze is already over when its card arrives", () => {
    fake();
    const store = storeWith({ ...LIVE, alerts: [] });
    render(<BoardProvider store={store}><QueueProbe /></BoardProvider>);
    vi.setSystemTime(NOW + 10 * MIN);
    act(() => { store.set({ alerts: [snoozed(NOW + 5 * MIN)] }); });
    expect(shown()).toBe(NOW + 10 * MIN);
    expect(waiting()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Review (G2-B5b): a browser may round `Date.now()` (a guard against timing attacks), so two reads can return the
  // same value. The re-read is counted, not stored as that value, so the timer is armed again and the clock wakes.
  it("still wakes on a coarse clock that reads the same value twice", () => {
    fake();
    const exact = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => Math.floor(exact.call(Date) / 100) * 100);
    render(<BoardProvider store={storeOf({ ...LIVE, alerts: [snoozed(NOW + 30)] })}><QueueProbe /></BoardProvider>);
    expect(waiting()).toBe(0);
    act(() => { vi.advanceTimersByTime(80); });             // fires at +80 ms, which this clock still reads as +0
    expect(waiting()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);                     // armed again all the same
    act(() => { vi.advanceTimersByTime(100); });
    expect(waiting()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Review (G2-B5b): as `useNow` does, the page's return reads the clock again — a background tab's timer may have
  // been held back, or lost.
  it("reads the clock again when the page is shown or focused, while a snooze runs", () => {
    fake();
    render(<BoardProvider store={storeOf({ ...LIVE, alerts: [snoozed(NOW + MIN)] })}><QueueProbe /></BoardProvider>);
    vi.clearAllTimers();                                    // the timer is lost
    vi.setSystemTime(NOW + 2 * MIN);
    expect(waiting()).toBe(0);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(waiting()).toBe(1);
  });

  it("reads the clock again on visibilitychange too", () => {
    fake();
    render(<BoardProvider store={storeOf({ ...LIVE, alerts: [snoozed(NOW + MIN)] })}><QueueProbe /></BoardProvider>);
    vi.clearAllTimers();
    vi.setSystemTime(NOW + 2 * MIN);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(waiting()).toBe(1);
  });
});
