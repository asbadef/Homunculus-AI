// The live waveform panel (Lane C, dalga): its stamp, its rows, its words for no signal and for a
// stopped stream, the statuses it shows instead of a trace — and no number and no sound. Drawn on a
// mocked 2D context per canvas (so a row's own drawing can be read) with a hand-driven frame clock.
// Synthetic blocks only (waves.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { SessionProvider } from "../../session/SessionProvider.jsx";
import { WAVE_STATUS, createWaveStore } from "../../data/waveStore.js";
import {
  SOURCE, answer, bed4, bed8, manualFrames, manualTimers, refusal, run, sessionStub, settle,
} from "../../data/waves.testutil.js";
import { WavePanel } from "./WavePanel.jsx";

/** A 2D context that keeps what it was asked to draw, in order: ["B"] beginPath, ["M", x, y], ["L", x, y];
 *  and, in `cleared`, every clearRect as the device-pixel box [x0, y0, x1, y1] it covered under the
 *  transform set at the time. */
function mockContext() {
  const ops = [];
  const cleared = [];
  let m = [1, 0, 0, 1, 0, 0];
  return {
    ops, cleared,
    setTransform: vi.fn((...next) => { m = next; }),
    clearRect: vi.fn((x, y, w, h) => {
      cleared.push([m[4] + m[0] * x, m[5] + m[3] * y, m[4] + m[0] * (x + w), m[5] + m[3] * (y + h)]);
    }),
    stroke: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    beginPath: vi.fn(() => { ops.push(["B"]); }),
    moveTo: vi.fn((x, y) => { ops.push(["M", x, y]); }),
    lineTo: vi.fn((x, y) => { ops.push(["L", x, y]); }),
  };
}

let contexts;
beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  contexts = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext() {
    if (!contexts.has(this)) contexts.set(this, mockContext());
    return contexts.get(this);
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(600);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(60);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.vibrate;
  localStorage.clear();
});

/** The panel on a wave store whose API answers `reply()`; the store's clock reads 0 at every answer.
 *  `setSource(next)` draws the same panel for another monitor. */
async function show({ reply = () => answer(), collapsible = false } = {}) {
  const timers = manualTimers();
  const frames = manualFrames();
  const request = vi.fn(async () => reply());
  const store = createWaveStore({
    api: { request }, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true, onVisibility: () => () => {}, perfNow: () => 0,
  });
  const tree = (source) => (
    <I18nProvider>
      <SessionProvider store={sessionStub()}>
        <WavePanel source={source} title="REA-01 · 2" store={store} raf={frames.raf} caf={frames.caf} collapsible={collapsible} />
      </SessionProvider>
    </I18nProvider>
  );
  const { rerender } = render(tree(SOURCE));
  await act(async () => { await settle(); });
  const frame = (perfMs) => act(() => { frames.run(perfMs); });
  const setSource = async (next) => { await act(async () => { rerender(tree(next)); await settle(); }); };
  return { store, timers, frames, request, frame, setSource };
}

const STAMP = "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür";
const panel = () => screen.getByRole("region", { name: "REA-01 · 2 · Dalga formu · doğrulanmamış" });
const rowOf = (kind) => document.querySelector(`[data-wave-row="${kind}"]`);
const ctxOf = (kind) => contexts.get(rowOf(kind).querySelector("canvas"));
const lines = (kind) => ctxOf(kind)?.lineTo.mock.calls.length ?? 0;

describe("the waveform panel", () => {
  it("carries the stamp and the delay, and draws a row per wave the monitor sends, in order", async () => {
    const { frame } = await show();
    frame(0);
    expect(within(panel()).getByText(STAMP)).toBeInTheDocument();
    expect(within(panel()).getByText("≈ 2 sn gecikmeli")).toBeInTheDocument();
    expect([...document.querySelectorAll("[data-wave-row]")].map((li) => li.dataset.waveRow))
      .toEqual(["ecg", "pressure", "pleth", "resp"]);
    // Each row draws its own trace: ECG, pleth and resp have no grid, so a line there is the wave.
    for (const kind of ["ecg", "pleth", "resp"]) expect(lines(kind), kind).toBeGreaterThan(10);
    expect(lines("pressure")).toBeGreaterThan(3);                  // more than its three grid lines
  });

  it("breaks the line at a missing block: a new path after the gap, no segment across it", async () => {
    // 8 s of ECG with the block at 1003.0 s missing. At frame 0 the row shows 1000.2–1006.2 s on
    // 600 px (100 px a second), so the gap is x 280–300.
    const missing = run(259).filter((b) => Math.abs(b.t - 1003) > 1e-9);
    const { frame } = await show({ reply: () => answer(missing) });
    frame(0);
    const { ops } = ctxOf("ecg");
    expect(ops.filter(([op]) => op === "M").length).toBeGreaterThanOrEqual(2);
    expect(ops.some(([op, x]) => op === "M" && Math.abs(x - 300) < 1e-6)).toBe(true);   // the path after the gap
    expect(ops.filter(([op, x]) => op === "L" && x > 280.5 && x < 299.5)).toEqual([]);   // nothing inside it
    let previous = null;
    const long = [];
    for (const [op, x] of ops) {
      if (op === "L" && previous !== null && x - previous > 5) long.push([previous, x]);
      if (op === "M" || op === "L") previous = x;
    }
    expect(long).toEqual([]);                                        // no stroke bridges it
  });

  it("draws in plain ink — the canvas's own text colour, never a colour of its own (R11)", async () => {
    const real = globalThis.getComputedStyle;
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation((el, pseudo) => (
      el instanceof HTMLCanvasElement ? { color: "rgb(1, 2, 3)" } : real(el, pseudo)));
    const { frame } = await show();
    frame(0);
    for (const kind of ["ecg", "pressure", "pleth", "resp"]) {
      expect(ctxOf(kind).strokeStyle, kind).toBe("rgb(1, 2, 3)");
      expect(rowOf(kind).querySelector("canvas"), kind).toHaveClass("text-ink");
    }
  });

  it("names every canvas as a picture that is not a measurement", async () => {
    await show();
    expect(screen.getAllByRole("img", { name: /yalnız görüntü, ölçüm değildir/ })).toHaveLength(4);
    expect(screen.getByRole("img", { name: "EKG dalgası — yalnız görüntü, ölçüm değildir" })).toBeInTheDocument();
  });

  it("calls the ECG row 'EKG', names no lead, and prints the monitor's own labels for the rest", async () => {
    await show();
    expect(within(rowOf("ecg")).getByText("EKG")).toBeInTheDocument();
    expect(within(rowOf("ecg")).getByText("derivasyon adı doğrulanmadı · yapısal")).toBeInTheDocument();
    expect(within(rowOf("pressure")).getByText("ART")).toBeInTheDocument();
    expect(within(rowOf("pressure")).getByText("mmHg · ölçek ekranla doğrulandı")).toBeInTheDocument();
    expect(within(rowOf("pleth")).getByText("göreli · yapısal")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent(/\bII\b/);
  });

  it("follows the live ECG channel and labels a P1 pressure 'P1', never 'ART' (BED08)", async () => {
    const { frame } = await show({ reply: () => answer(bed8()) });
    frame(0);
    const rows = [...document.querySelectorAll("[data-wave-row]")];
    expect(rows.map((li) => li.dataset.waveRow)).toEqual(["ecg", "pressure"]);
    expect(within(rows[0]).queryByText("sinyal yok")).toBeNull();          // 0x0102 is live, 0x0103 is not drawn
    expect(within(rows[1]).getByText("P1")).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("ART");
  });

  it("prints no number while the waves are live", async () => {
    const { frame } = await show();
    frame(0);
    expect(document.querySelector("[data-wave-rows]").textContent).not.toMatch(/\d/);
  });

  it("says 'sinyal yok' for a no-signal ECG and draws no line for it", async () => {
    const { frame } = await show({ reply: () => answer(run(259, { samples: null })) });
    frame(0);
    expect(within(rowOf("ecg")).getByText("sinyal yok")).toBeInTheDocument();
    expect(ctxOf("ecg")).toBeDefined();                              // it was drawn — as nothing
    expect(lines("ecg")).toBe(0);
  });

  it("freezes, fades and says 'akış durdu · N sn' when the stream stops, and clears after 10 s", async () => {
    const { frame } = await show();
    frame(0);
    expect(screen.queryByText(/akış durdu/)).toBeNull();
    ctxOf("ecg").lineTo.mockClear();
    frame(4000);                                   // 4.2 s after the data's end: past 2 s + 1.5 s
    expect(within(rowOf("ecg")).getByText("akış durdu · 4 sn")).toBeInTheDocument();
    expect(rowOf("ecg").querySelector("canvas")).toHaveClass("opacity-40");
    expect(lines("ecg")).toBeGreaterThan(10);      // frozen, not blanked: the last trace stays drawn
    ctxOf("ecg").lineTo.mockClear();
    frame(10000);
    expect(within(rowOf("ecg")).getByText("akış durdu · 10 sn · iz kaldırıldı")).toBeInTheDocument();
    expect(lines("ecg")).toBe(0);
  });

  it("clears each canvas whole, in device pixels, every frame: its last column too (walk P3)", async () => {
    // 866 CSS px at a devicePixelRatio of 1.25 is 1082.5 device px, so the backing store is 1083 wide.
    // A clear in CSS px under the 1.25 transform stops on the centre of that last column, which a
    // GPU-rastered canvas then never clears: every stroke that touched the right edge piled up there
    // as a vertical line over the trace's whole height (the walk's shot 06; reproduced in Chrome 156).
    vi.stubGlobal("devicePixelRatio", 1.25);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(866);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(56);
    const { frame } = await show();
    const kinds = ["ecg", "pressure", "pleth", "resp"];
    frame(0);
    for (const perfMs of [16, 33, 50]) {
      const before = new Map(kinds.map((kind) => [kind, ctxOf(kind).cleared.length]));
      frame(perfMs);
      for (const kind of kinds) {
        const canvas = rowOf(kind).querySelector("canvas");
        expect([canvas.width, canvas.height], kind).toEqual([1083, 70]);
        const clears = ctxOf(kind).cleared.slice(before.get(kind));
        const whole = clears.some(([x0, y0, x1, y1]) => x0 <= 0 && y0 <= 0 && x1 >= canvas.width && y1 >= canvas.height);
        expect(whole, `${kind} at ${perfMs} ms cleared ${JSON.stringify(clears)}`).toBe(true);
      }
    }
  });

  it("draws nothing on a canvas that measures 0 px, and still says what the row is", async () => {
    const width = vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(0);
    const { frame } = await show();
    frame(0);
    for (const kind of ["ecg", "pressure", "pleth", "resp"]) {
      expect(ctxOf(kind)?.ops.filter(([op]) => op !== "B") ?? [], kind).toEqual([]);   // no point piled on x 0
      expect(rowOf(kind).querySelector("canvas").dataset.state, kind).toBe("live");
    }
    width.mockReturnValue(600);
    frame(16);
    expect(lines("ecg")).toBeGreaterThan(10);
  });

  it("says 'dalga bekleniyor', not 'akış durdu', and draws nothing until its data reaches the render time (walk P2)", async () => {
    // A hub restarted 1.4 s ago holds 1006.6–1008.0 s. At frame 0 the head is 1008.2 s, so the render
    // time (head − 2 s) is 1006.2 s: before the first block, with nothing in the window to draw.
    const fresh = (id, samples) => run(id, { seconds: 1.4, samples });
    const { frame } = await show({ reply: () => answer([...fresh(259), ...fresh(769, 4000), ...fresh(6422), ...fresh(513)]) });
    frame(0);
    for (const kind of ["ecg", "pressure", "pleth", "resp"]) {
      expect(within(rowOf(kind)).getByText("dalga bekleniyor"), kind).toBeInTheDocument();
      expect(rowOf(kind).querySelector("canvas").dataset.state, kind).toBe("waiting");
      expect(lines(kind), kind).toBe(0);
    }
    expect(within(panel()).queryByText(/akış durdu/)).toBeNull();
    frame(1000);                                   // render time 1007.2: the data is on screen
    for (const kind of ["ecg", "pleth", "resp"]) expect(lines(kind), kind).toBeGreaterThan(10);
    expect(within(panel()).queryByText("dalga bekleniyor")).toBeNull();
  });

  it("keeps the trace it has and says the stream is missing when a poll fails", async () => {
    let reply = () => answer();
    const { timers, frame } = await show({ reply: () => reply() });
    reply = () => { throw refusal(503); };
    await act(async () => { await timers.fire(); });
    frame(0);
    expect(within(panel()).getByText("Dalga akışı yok")).toBeInTheDocument();
    expect(within(panel()).getByText(STAMP)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-wave-row]")).toHaveLength(4);
  });

  it.each([[404, "Bu cihazın dalga formu gösterilemiyor"], [403, "Bu cihazın dalga formunu görme yetkiniz yok"]])(
    "says why it shows no waves on a %i, never an empty trace — under the stamp", async (code, words) => {
      await show({ reply: () => { throw refusal(code); } });
      expect(within(panel()).getByRole("note")).toHaveTextContent(words);
      expect(document.querySelector("[data-wave-rows]")).toBeNull();
      expect(within(panel()).getByText(STAMP)).toBeInTheDocument();         // rule 1: whenever any of the panel is
    });

  it("draws nothing at all when waves are off here (409)", async () => {
    const { store } = await show({ reply: () => { throw refusal(409); } });
    expect(store.get(SOURCE).status).toBe(WAVE_STATUS.OFF);
    expect(document.querySelector("[data-wave-panel]")).toBeNull();
  });

  it("draws nothing before the first answer, then the panel (R10)", async () => {
    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const { request } = await show({ reply: () => first });
    expect(request).toHaveBeenCalledTimes(1);                        // asked, and waiting
    expect(document.querySelector("[data-wave-panel]")).toBeNull();
    await act(async () => { release(answer()); await settle(); });
    expect(panel()).toBeInTheDocument();
  });

  it("watches the new monitor when the source changes, and lets the old one go", async () => {
    const { request, store, timers, setSource } = await show();
    expect(request.mock.calls[0][0]).toContain("/infinity-waves/192.0.2.10?");
    await setSource("192.0.2.11");
    expect(request.mock.calls.at(-1)[0]).toContain("/infinity-waves/192.0.2.11?");
    expect(store.get(SOURCE).status).toBe(WAVE_STATUS.IDLE);         // released and forgotten
    expect(store.get("192.0.2.11").status).toBe(WAVE_STATUS.OK);
    expect(timers.delays).toHaveLength(1);                           // one monitor polls, not two
  });

  it("on the device screen waits behind a button, polls once opened and stops when hidden", async () => {
    const { request, timers } = await show({ collapsible: true });
    expect(request).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(timers.delays).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dalga formunu gizle" }));
    expect(timers.delays).toEqual([]);
    expect(screen.getByRole("button", { name: "Dalga formunu göster" })).toBeInTheDocument();
  });

  it("gives the focus to the control that replaces the one pressed, on show and on hide", async () => {
    await show({ collapsible: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dalga formunu gizle" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu gizle" })); await settle(); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dalga formunu göster" }));
  });

  it("says on the device screen that waves are off, when they are", async () => {
    await show({ reply: () => { throw refusal(409); }, collapsible: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
    expect(within(panel()).getByRole("note")).toHaveTextContent("Dalga formu bu kurulumda kapalı");
  });

  it("makes no sound: no audio element or context, no speech, no vibration", async () => {
    const AudioContext = vi.fn();
    const Audio = vi.fn();
    const speak = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    vi.stubGlobal("Audio", Audio);
    vi.stubGlobal("speechSynthesis", { speak });
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
    const { frame } = await show();
    frame(0);
    frame(4000);                                   // stalled
    frame(10000);                                  // cleared
    expect(AudioContext).not.toHaveBeenCalled();
    expect(Audio).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(document.querySelector("audio, video")).toBeNull();
  });

  it("stops drawing when it is gone", async () => {
    const { frames, frame } = await show();
    frame(0);
    expect(frames.waiting).toBe(1);
    cleanup();
    expect(frames.waiting).toBe(0);
  });

  it("draws the full set for a BED07-like monitor from four separate runs", async () => {
    const { frame } = await show({ reply: () => answer(bed4()) });
    frame(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(4);
  });
});
