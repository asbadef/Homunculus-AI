import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useIdleLock, WARN_SECONDS } from "./useIdleLock.js";
import { readActiveAt, writeActiveAt } from "./browserState.js";

function Probe({ minutes = 2, onIdle, enabled = true }) {
  const { secondsLeft, stay } = useIdleLock({ minutes, onIdle, enabled });
  return (
    <div>
      <p data-testid="left">{secondsLeft === null ? "-" : secondsLeft}</p>
      <button type="button" onClick={stay}>devam</button>
    </div>
  );
}

const left = () => screen.getByTestId("left").textContent;
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("the idle lock", () => {
  it("warns for the last minute, counting down, then locks", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={2} onIdle={onIdle} />);
    advance(59_000);
    expect(left()).toBe("-");
    advance(2_000);
    expect(left()).toBe(String(WARN_SECONDS - 1));
    advance(58_000);
    expect(left()).toBe("1");
    expect(onIdle).not.toHaveBeenCalled();
    advance(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(left()).toBe("-");
  });

  it("a key, a click, a touch or the wheel is activity; a moving pointer is not", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} />);
    advance(50_000);
    fireEvent.pointerMove(document);
    fireEvent.mouseMove(document);
    advance(11_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();
    // 50 s apart: one that did not count would leave 100 s without activity, past the minute.
    for (const fire of [() => fireEvent.keyDown(document, { key: "a" }), () => fireEvent.pointerDown(document),
      () => fireEvent.wheel(document), () => fireEvent.touchStart(document)]) {
      advance(25_000);
      fire();
      advance(25_000);
      expect(onIdle).not.toHaveBeenCalled();
    }
  });

  it("'stay' is activity, shared with the other tabs at once", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} />);
    advance(30_000);
    expect(left()).toBe("30");
    fireEvent.click(screen.getByText("devam"));
    expect(left()).toBe("-");
    expect(readActiveAt()).toBe(Date.now());
    advance(59_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does not lock this tab while another tab is in use", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} />);
    advance(50_000);
    writeActiveAt(Date.now());                  // someone typing in another tab
    advance(50_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onIdle = vi.fn();
    render(<Probe minutes={1} onIdle={onIdle} enabled={false} />);
    advance(120_000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
