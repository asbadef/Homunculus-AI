// useSnoozeClock.test.jsx — the board's clock for the waiting queue (G2-B5b, spec D4): one timer at the next snooze's
// end, not a tick. Synthetic alarms.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { BoardProvider } from "./BoardProvider.jsx";
import { useSnoozeClock } from "./useSnoozeClock.js";

const NOW = Date.parse("2026-11-10T10:00:00Z");
const storeOf = (state) => ({ subscribe: () => () => {}, getState: () => state });
const snoozed = (untilMs) => ({ id: `x${untilMs}`, severity: "high", status: "FIRED", ack: null, snooze: { untilMs } });

function Probe() {
  return <p data-testid="now">{useSnoozeClock()}</p>;
}
const shown = () => Number(screen.getByTestId("now").textContent);

afterEach(() => vi.useRealTimers());

describe("the board's clock for the waiting queue", () => {
  it("is read again the moment the next snooze ends — one timer, not a tick", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
    render(<BoardProvider store={storeOf({ alerts: [], clockSkewMs: 5_000 })}><Probe /></BoardProvider>);
    expect(shown()).toBe(NOW + 5_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
