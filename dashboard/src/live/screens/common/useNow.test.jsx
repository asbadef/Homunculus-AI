// The fake-timer recipe the earlier waves settled on (amendments, `useRetryHold`): install the
// timers BEFORE the mount, fake `Date` with them, and no `shouldAdvanceTime` — so nothing moves
// except what the test moves.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { useNow } from "./useNow.js";

const AT = Date.parse("2026-10-08T10:00:00Z");

function Clock({ ms }) {
  const now = useNow(ms);
  return <output>{String(now)}</output>;
}

const shown = () => Number(screen.getByRole("status").textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(AT);
});
afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("starts at the clock's reading", () => {
    render(<Clock ms={1_000} />);
    expect(shown()).toBe(AT);
  });

  it("re-reads the clock on its cadence", () => {
    render(<Clock ms={1_000} />);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(shown()).toBe(AT + 1_000);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(shown()).toBe(AT + 3_000);
  });

  it("lines up on the cadence, not on the mount, so every card changes at the same moment", () => {
    vi.setSystemTime(AT + 700);                     // mounted three tenths before the next second
    render(<Clock ms={1_000} />);
    act(() => { vi.advanceTimersByTime(299); });
    expect(shown()).toBe(AT + 700);
    act(() => { vi.advanceTimersByTime(1); });
    expect(shown()).toBe(AT + 1_000);
  });

  it("does not re-read while the page is hidden, and does the moment it comes back", () => {
    // A ward PC left open overnight should not wake once a second to repaint the same digits.
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<Clock ms={1_000} />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(shown()).toBe(AT);
    spy.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(shown()).toBe(AT + 5_000);
    spy.mockRestore();
  });

  it("reads once and arms nothing when it is given no cadence", () => {
    render(<Clock ms={null} />);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(shown()).toBe(AT);
  });

  it("leaves no timer behind when it goes", () => {
    const { unmount } = render(<Clock ms={1_000} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
