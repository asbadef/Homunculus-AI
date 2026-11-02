// The full-screen single-bed view (Lane C, dalga; spec W5): opened from the panel's ⤢, black, the
// stamp at full size, the strip's numbers beside the waves; Escape, × or leaving browser full screen
// close it and give the focus back. Synthetic blocks and strip (waves.testutil.js, shadow.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { SessionProvider } from "../../session/SessionProvider.jsx";
import { ShadowProvider } from "../../data/ShadowProvider.jsx";
import { createWaveStore } from "../../data/waveStore.js";
import { bed as stripBed, param, strip } from "../../data/shadow.testutil.js";
import {
  SOURCE, answer, manualFrames, manualTimers, refusal, sessionStub, settle,
} from "../../data/waves.testutil.js";
import { WavePanel } from "./WavePanel.jsx";
import { cardOf } from "./WaveFullscreen.jsx";

const STAMP = "Dalga · doğrulanmamış · yalnız görüntü — birincil alarm başucu monitörüdür";
let fullscreenElement = null;

beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  HTMLElement.prototype.requestFullscreen = vi.fn(function request() { fullscreenElement = this; return Promise.resolve(); });
  document.exitFullscreen = vi.fn(() => { fullscreenElement = null; return Promise.resolve(); });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete HTMLElement.prototype.requestFullscreen;
  delete document.exitFullscreen;
  delete document.fullscreenElement;
  localStorage.clear();
});

/** The strip as its store would hold it: one bed card for SOURCE with a made-up HR. */
function shadowStub(data = strip({ beds: [stripBed("REA-01 · 2", [param("hr", 72)], { source: SOURCE })] })) {
  const state = { phase: "ok", stage: data.stage, data, fetchedAtMs: Date.now() };
  return { acquire() {}, release() {}, subscribe: () => () => {}, getState: () => state };
}

/** `data`: the strip answer the shadow store holds (shadowStub's one HR card when not given).
 *  `reply`: what the wave API answers, read at every poll. */
async function openFull({ data, reply = () => answer() } = {}) {
  const timers = manualTimers();
  const frames = manualFrames();
  const store = createWaveStore({
    api: { request: vi.fn(async () => reply()) }, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true, onVisibility: () => () => {}, perfNow: () => 0,
  });
  render(
    <I18nProvider>
      <SessionProvider store={sessionStub()}>
        <ShadowProvider store={shadowStub(data)}>
          <WavePanel source={SOURCE} title="REA-01 · 2" store={store} raf={frames.raf} caf={frames.caf} />
        </ShadowProvider>
      </SessionProvider>
    </I18nProvider>,
  );
  await act(async () => { await settle(); });
  const opener = screen.getByRole("button", { name: "Tam ekran görünüm" });
  await act(async () => { fireEvent.click(opener); await settle(); });
  return { opener, timers, dialog: screen.getByRole("dialog", { name: "REA-01 · 2 · Dalga formu · doğrulanmamış" }) };
}

const numbersIn = (dialog) => within(dialog).getByRole("region", { name: "REA-01 · 2 · Monitör · doğrulanmamış" });

describe("the full-screen view", () => {
  it("fills the screen on black, asks the browser for full screen, and keeps the stamp at full size", async () => {
    const { dialog } = await openFull();
    expect(dialog).toHaveClass("bg-black", "fixed", "inset-0");
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBe(dialog);
    expect(within(dialog).getByText(STAMP)).toHaveClass("text-17");
    expect(within(dialog).getAllByRole("img")).toHaveLength(4);
    expect(document.querySelector("[data-wave-panel] [data-wave-rows]")).toBeNull();   // the panel's rows wait
  });

  it("shows the strip's own numbers beside the waves", async () => {
    const { dialog } = await openFull();
    expect(numbersIn(dialog)).toHaveTextContent("72");
  });

  // After the HR/PLS swap on main (70e45e9) the strip's `hr` is the ECG rate and `pls` the SpO₂
  // pulse. The full screen prints the strip's card through the strip itself, so its labels are the
  // strip's — never words of its own beside a wave.
  it("labels each number as the strip does: HR is the strip's HR, PLS the strip's PLS", async () => {
    const { dialog } = await openFull({ data: strip({
      beds: [stripBed("REA-01 · 2", [param("hr", 72), param("pls", 71)], { source: SOURCE })],
    }) });
    const numbers = numbersIn(dialog);
    expect(within(numbers).getByText("HR").parentElement).toHaveTextContent(/^HR72/);
    expect(within(numbers).getByText("PLS").parentElement).toHaveTextContent(/^PLS71/);
  });

  // Aşama B: at «rules» it is the same strip, and its whole note says the shadow engine scores
  // these values — the strip's own note for its own stage, as the patient and device screens pass it.
  it("finds the card at Aşama B's «rules» too, and carries the strip's note for that stage", async () => {
    const data = { ...strip({ beds: [stripBed("REA-01 · 2", [param("hr", 72)], { source: SOURCE })] }), stage: "rules" };
    expect(cardOf(data, SOURCE).bed_label).toBe("REA-01 · 2");
    const { dialog } = await openFull({ data });
    expect(numbersIn(dialog)).toHaveTextContent("tavsiye niteliğinde bir gölge skor");
  });

  // The panel, and the note in it, are behind the black: the full screen says what the panel would.
  it.each([[503, "Dalga akışı yok"], [404, "Bu cihazın dalga formu gösterilemiyor"]])(
    "says why the stream is missing on a %i while it is open, as the panel does", async (code, words) => {
      let reply = () => answer();
      const { dialog, timers } = await openFull({ reply: () => reply() });
      expect(within(dialog).queryByText(words)).toBeNull();
      reply = () => { throw refusal(code); };
      await act(async () => { await timers.fire(); });
      expect(within(dialog).getByText(words)).toBeInTheDocument();
      expect(within(dialog).getByText(STAMP)).toBeInTheDocument();
    });

  it("closes on Escape, leaves browser full screen and gives the focus back to ⤢", async () => {
    const { opener } = await openFull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tam ekrandan çık" }));
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.exitFullscreen).toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on ×, and when the browser leaves full screen by itself", async () => {
    await openFull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tam ekrandan çık" })); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tam ekran görünüm" })); await settle(); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fullscreenElement = null;
    await act(async () => { document.dispatchEvent(new Event("fullscreenchange")); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab on its one control", async () => {
    await openFull();
    const close = screen.getByRole("button", { name: "Tam ekrandan çık" });
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("finds the strip's card by address, and none while the strip is off", () => {
    const data = strip({ beds: [stripBed("REA-01 · 2", [], { source: SOURCE })] });
    expect(cardOf(data, SOURCE).bed_label).toBe("REA-01 · 2");
    expect(cardOf(data, "192.0.2.99")).toBeNull();
    expect(cardOf({ stage: "off" }, SOURCE)).toBeNull();
  });
});
