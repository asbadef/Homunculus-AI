// The live waveform panel (Lane C, dalga): its stamp, its rows, its words for no signal and for a
// stopped stream, the statuses it shows instead of a trace — and no number and no sound. Drawn on a
// mocked 2D context with a hand-driven frame clock. Synthetic blocks only (waves.testutil.js).
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

let ctx;
beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(600);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(60);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The panel on a wave store whose API answers `reply()`; the store's clock reads 0 at every answer. */
async function show({ reply = () => answer(), collapsible = false } = {}) {
  const timers = manualTimers();
  const frames = manualFrames();
  const request = vi.fn(async () => reply());
  const store = createWaveStore({
    api: { request }, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true, onVisibility: () => () => {}, perfNow: () => 0,
  });
  render(
    <I18nProvider>
      <SessionProvider store={sessionStub()}>
        <WavePanel source={SOURCE} title="REA-01 · 2" store={store} raf={frames.raf} caf={frames.caf} collapsible={collapsible} />
      </SessionProvider>
    </I18nProvider>,
  );
  await act(async () => { await settle(); });
  const frame = (perfMs) => act(() => { frames.run(perfMs); });
  return { store, timers, frames, request, frame };
}

const STAMP = "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür";
const panel = () => screen.getByRole("region", { name: "REA-01 · 2 · Dalga formu · doğrulanmamış" });
const rowOf = (kind) => document.querySelector(`[data-wave-row="${kind}"]`);

describe("the waveform panel", () => {
  it("carries the stamp and the delay, and draws a row per wave the monitor sends, in order", async () => {
    const { frame } = await show();
    frame(0);
    expect(within(panel()).getByText(STAMP)).toBeInTheDocument();
    expect(within(panel()).getByText("≈ 2 sn gecikmeli")).toBeInTheDocument();
    expect([...document.querySelectorAll("[data-wave-row]")].map((li) => li.dataset.waveRow))
      .toEqual(["ecg", "pressure", "pleth", "resp"]);
    expect(ctx.lineTo).toHaveBeenCalled();
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
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it("freezes, fades and says 'akış durdu · N sn' when the stream stops, and clears after 10 s", async () => {
    const { frame } = await show();
    frame(0);
    expect(screen.queryByText(/akış durdu/)).toBeNull();
    frame(4000);                                   // 4.2 s after the data's end: past 2 s + 1.5 s
    expect(within(rowOf("ecg")).getByText("akış durdu · 4 sn")).toBeInTheDocument();
    expect(rowOf("ecg").querySelector("canvas")).toHaveClass("opacity-40");
    ctx.lineTo.mockClear();
    frame(10000);
    expect(within(rowOf("ecg")).getByText("akış durdu · 10 sn · iz kaldırıldı")).toBeInTheDocument();
    expect(ctx.lineTo).not.toHaveBeenCalled();
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

  it("draws nothing at all when waves are off here (409), and nothing before the first answer", async () => {
    const { store } = await show({ reply: () => { throw refusal(409); } });
    expect(store.get(SOURCE).status).toBe(WAVE_STATUS.OFF);
    expect(document.querySelector("[data-wave-panel]")).toBeNull();
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

  it("says on the device screen that waves are off, when they are", async () => {
    await show({ reply: () => { throw refusal(409); }, collapsible: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
    expect(within(panel()).getByRole("note")).toHaveTextContent("Dalga formu bu kurulumda kapalı");
  });

  it("makes no sound: no audio element, no audio context", async () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const { frame } = await show();
    frame(0);
    frame(4000);
    expect(AudioContext).not.toHaveBeenCalled();
    expect(document.querySelector("audio")).toBeNull();
    vi.unstubAllGlobals();
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
