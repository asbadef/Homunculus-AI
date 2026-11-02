// The wave panel's own error boundary (Lane A finding I3): a wave panel that throws must not take
// the live app down with it — above all not the alarm sound and the critical-alarm notification,
// which sit in the same tree (LiveApp.jsx: AlarmSignals wraps the screens that show the waves).
// Each failure below is a synthetic throw; no sample, no patient.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React, { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { mount } from "../../session/mount.testutil.jsx";
import { alarm, board, entry, identity } from "../../data/board.testutil.js";
import { fakeAudio, fakeNotifications, onPage } from "../../signals/fakeAudio.testutil.js";
import { useAlarmSignals } from "../../signals/AlarmSignals.jsx";
import { WaveErrorBoundary } from "./WaveErrorBoundary.jsx";

const UNAVAILABLE = "Dalga akışı yok";
const HEADING = "REA-01 · 2 · Dalga formu · doğrulanmamış";

let warn;
beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  // React reports a caught error on console.error, and jsdom reports it once more: kept off the output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The boundary as the panel's caller would put it, for one monitor (`resetKey`). */
const guarded = (children, { resetKey = "monitor-A", title = "REA-01 · 2", className } = {}) => (
  <I18nProvider>
    <WaveErrorBoundary resetKey={resetKey} title={title} className={className}>{children}</WaveErrorBoundary>
  </I18nProvider>
);

/** The fallback: the panel's frame, named by its heading, holding the panel's own note. */
function fallback(name = HEADING) {
  const frame = screen.getByRole("region", { name });
  expect(within(frame).getByRole("note")).toHaveTextContent(UNAVAILABLE);
  return frame;
}

function RenderThrow() {
  throw new TypeError("synthetic render failure");
}

/** A wave stand-in that draws until `tripWave()` makes it throw while rendering. */
let tripWave = null;
function TrippableWave() {
  const [broken, setBroken] = useState(false);
  tripWave = () => setBroken(true);
  if (broken) throw new TypeError("synthetic draw failure");
  return <canvas data-testid="trace" />;
}

describe("a wave panel that throws", () => {
  it("while rendering: the panel's frame says «Dalga akışı yok» — no trace, no blank box, no error text", () => {
    render(guarded(<><canvas data-testid="trace" /><RenderThrow /></>));
    const frame = fallback();
    expect(document.querySelector("canvas")).toBeNull();
    expect(frame).not.toHaveTextContent(/synthetic|TypeError|RenderThrow/);
  });

  it.each([
    ["useEffect", useEffect],
    ["useLayoutEffect", useLayoutEffect],
  ])("inside %s: the same frame and note, and the trace drawn before it is gone", (_, useHook) => {
    function EffectThrow() {
      useHook(() => { throw new RangeError("synthetic effect failure"); }, []);
      return <canvas data-testid="trace" />;
    }
    render(guarded(<EffectThrow />));
    const frame = fallback();
    expect(document.querySelector("canvas")).toBeNull();
    expect(frame).not.toHaveTextContent(/synthetic|RangeError/);
  });

  it("inside a portal (the full screen): caught all the same, and the portal's content goes", () => {
    function FullScreen() {
      return createPortal(
        <div data-testid="full"><canvas /><RenderThrow /></div>,
        document.body,
      );
    }
    render(guarded(<><canvas data-testid="trace" /><FullScreen /></>));
    fallback();
    expect(screen.queryByTestId("full")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("after it has drawn: the trace is replaced by the frame and its note", () => {
    render(guarded(<TrippableWave />));
    expect(screen.getByTestId("trace")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    act(() => { tripWave(); });
    fallback();
    expect(screen.queryByTestId("trace")).toBeNull();
  });

  it("names the frame with the waves' own heading when no title is given, in the reader's language", () => {
    localStorage.setItem("hmc.lang", "en");
    render(guarded(<RenderThrow />, { title: null }));
    const frame = screen.getByRole("region", { name: "Waveforms · unvalidated" });
    expect(within(frame).getByRole("note")).toHaveTextContent("No waveform stream");
  });

  it("keeps the panel's frame and the caller's layout class", () => {
    render(guarded(<RenderThrow />, { className: "mt-3" }));
    const frame = fallback();
    expect(frame).toHaveAttribute("data-wave-panel");
    expect(frame).toHaveClass("border-dashed", "mt-3");
  });

  it("warns once, naming only the error's type — never its message, which could carry what was drawn", () => {
    function Leaky() {
      useEffect(() => { throw new RangeError("sample 0.731 mV at 12:00:01"); }, []);
      return null;
    }
    // Two effects failing in one commit are one failure: one line on the console.
    render(guarded(<><Leaky /><Leaky /></>));
    fallback();
    expect(warn).toHaveBeenCalledTimes(1);
    const said = warn.mock.calls[0].map((part) => String(part)).join(" ");
    expect(said).toContain("RangeError");
    expect(said).not.toMatch(/0\.731|12:00:01|sample|mV/);
  });

  it("says a thrown non-error by its JavaScript type, not by its content", () => {
    function ThrowsText() {
      throw "sample 0.42";   // eslint-disable-line no-throw-literal
    }
    render(guarded(<ThrowsText />));
    fallback();
    expect(warn).toHaveBeenCalledTimes(1);
    const said = warn.mock.calls[0].map((part) => String(part)).join(" ");
    expect(said).toContain("string");
    expect(said).not.toMatch(/0\.42|sample/);
  });
});

describe("the boundary while nothing fails", () => {
  it("stays out of the way: the children, as they are, and no frame of its own", () => {
    const { container } = render(guarded(<canvas data-testid="trace" />));
    expect(container.firstChild).toBe(screen.getByTestId("trace"));
    expect(screen.queryByRole("note")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("trying again", () => {
  let healthy;
  let renders;
  function Flaky() {
    renders += 1;
    if (!healthy) throw new TypeError("synthetic failure");
    return <canvas data-testid="trace" />;
  }
  beforeEach(() => {
    healthy = false;
    renders = 0;
  });

  it("does not happen by itself: the same monitor stays on the note, its children not even rendered", () => {
    const { rerender } = render(guarded(<Flaky />, { resetKey: "monitor-A" }));
    fallback();
    healthy = true;
    const before = renders;
    rerender(guarded(<Flaky />, { resetKey: "monitor-A" }));
    rerender(guarded(<Flaky />, { resetKey: "monitor-A" }));
    expect(renders).toBe(before);
    fallback();
    expect(screen.queryByTestId("trace")).toBeNull();
  });

  it("happens for another monitor (a new resetKey): a healthy child draws again", () => {
    const { rerender } = render(guarded(<Flaky />, { resetKey: "monitor-A" }));
    fallback();
    healthy = true;
    rerender(guarded(<Flaky />, { resetKey: "monitor-B" }));
    expect(screen.getByTestId("trace")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("for another monitor that fails too: the note again, a bounded number of renders, one more warning", () => {
    const { rerender } = render(guarded(<Flaky />, { resetKey: "monitor-A" }));
    fallback();
    expect(warn).toHaveBeenCalledTimes(1);
    const before = renders;
    rerender(guarded(<Flaky />, { resetKey: "monitor-B" }));
    fallback();
    // One attempt, never a loop. React 18 renders a failing child up to four times for it in
    // development: it replays each failed render, and retries the update once synchronously.
    expect(renders - before).toBeGreaterThan(0);
    expect(renders - before).toBeLessThanOrEqual(4);
    expect(warn).toHaveBeenCalledTimes(2);
    // And it holds there.
    const settled = renders;
    rerender(guarded(<Flaky />, { resetKey: "monitor-B" }));
    expect(renders).toBe(settled);
  });
});

describe("the alarm path beside a failing wave panel", () => {
  it("a sibling standing in for AlarmSignals stays mounted, keeps its state and still updates", () => {
    let mounts = 0;
    let unmounts = 0;
    function AlarmStub() {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounts += 1;
        return () => { unmounts += 1; };
      }, []);
      return <button type="button" onClick={() => setCount((c) => c + 1)}>{`alarm ${count}`}</button>;
    }
    render(
      <I18nProvider>
        <AlarmStub />
        <WaveErrorBoundary resetKey="monitor-A" title="REA-01 · 2"><TrippableWave /></WaveErrorBoundary>
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "alarm 0" }));
    const stub = screen.getByRole("button", { name: "alarm 1" });
    act(() => { tripWave(); });
    fallback();
    expect(screen.getByRole("button", { name: "alarm 1" })).toBe(stub);   // the same node: never remounted
    expect([mounts, unmounts]).toEqual([1, 0]);
    fireEvent.click(stub);
    expect(stub).toHaveTextContent("alarm 2");
  });

  describe("the real AlarmSignals, the wave panel inside it as LiveApp nests them", () => {
    const realSetTimeout = globalThis.setTimeout;
    const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));
    const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
    const reaBed = (id, alarms) => entry(id, alarms, { identity: identity({ patient_id: id, bed_label: "REA-01 · 2" }) });
    let page = null;
    afterEach(() => {
      cleanup();
      page?.undo();
      page = null;
      vi.useRealTimers();
    });

    function SignalsProbe() {
      const { sound, notify } = useAlarmSignals();
      return <p data-testid="signals">{`${sound} ${notify}`}</p>;
    }

    it("goes on sounding, sounds a new critical alarm and notifies it, after the wave panel has thrown", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      localStorage.setItem("hmc.alarmSound", "on");
      const audio = fakeAudio();
      const notes = fakeNotifications("granted");
      page = onPage({ AudioContext: audio.AudioContext, Notification: notes.Notification });
      const view = await mount(
        <>
          <SignalsProbe />
          <WaveErrorBoundary resetKey="monitor-A" title="REA-01 · 2"><TrippableWave /></WaveErrorBoundary>
        </>,
        { setup: (api) => {
          api.boardPatients.mockResolvedValue(board([reaBed("S-001", [alarm("news2", "high")])]));
          api.streamTicket.mockResolvedValue({ ticket: "t-1" });
        } },
      );
      await act(async () => { view.board.start(); });
      await flush();
      await act(async () => { view.stream.open(); });
      await flush();
      fireEvent.click(document.body);   // the gesture a browser wants before it plays audio
      await flush();
      const probe = screen.getByTestId("signals");
      expect(probe).toHaveTextContent("on granted");
      expect(audio.pulses()).toEqual([640, 640, 640]);

      act(() => { tripWave(); });
      fallback();
      expect(screen.getByTestId("signals")).toBe(probe);   // the alarm signals were never remounted
      expect(probe).toHaveTextContent("on granted");
      expect(audio.audible().length).toBeGreaterThan(0);  // an unmount closes the engine and cuts these

      // A critical alarm arriving after the failure is sounded, and repeated.
      act(() => { view.stream.frame(reaBed("S-002", [alarm("septic_shock", "critical")])); });
      expect(audio.pulses().filter((f) => f === 960)).toHaveLength(10);
      tick(2500);
      expect(audio.pulses().filter((f) => f === 960)).toHaveLength(20);

      // And notified once the page is in the background.
      expect(notes.shown).toHaveLength(0);
      act(() => { page.setHidden(true); });
      expect(notes.shown).toHaveLength(1);
      expect(notes.shown[0].body).toContain("REA-01 · 2");
    });
  });
});
