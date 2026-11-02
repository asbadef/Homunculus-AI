// The full-screen single-bed view (Lane C, dalga; spec W5): opened from the panel's ⤢, black, the
// stamp at full size and always in view, the strip's numbers beside the waves; Escape, × or leaving
// browser full screen close it and give the focus back. The browser's full screen is the page's:
// asked for only when the page is not in it already, and handed back only by the view that asked.
// Synthetic blocks and strip (waves.testutil.js, shadow.testutil.js).
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
const TITLE = "REA-01 · 2 · Dalga formu · doğrulanmamış";
let fullscreenElement = null;

// As a browser does it: the request answers later, and the change is announced after it is made.
const announce = () => document.dispatchEvent(new Event("fullscreenchange"));
beforeEach(() => {
  localStorage.setItem("hmc.lang", "tr");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fullscreenElement = null;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  HTMLElement.prototype.requestFullscreen = vi.fn(function request() {
    const el = this;
    return Promise.resolve().then(() => { fullscreenElement = el; announce(); });
  });
  document.exitFullscreen = vi.fn(() => Promise.resolve().then(() => { fullscreenElement = null; announce(); }));
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

/** The panel, not yet in full screen. `data`: the strip answer the shadow store holds. `reply`: what
 *  the wave API answers, read at every poll. `collapsible`: the device screen's panel (opened here).
 *  `wrap`: around the whole tree (StrictMode). */
async function mount({ data, reply = () => answer(), collapsible = false, wrap = (ui) => ui } = {}) {
  const timers = manualTimers();
  const frames = manualFrames();
  const store = createWaveStore({
    api: { request: vi.fn(async () => reply()) }, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    isVisible: () => true, onVisibility: () => () => {}, perfNow: () => 0,
  });
  const shadow = shadowStub(data);
  const tree = (source) => wrap(
    <I18nProvider>
      <SessionProvider store={sessionStub()}>
        <ShadowProvider store={shadow}>
          <WavePanel source={source} title="REA-01 · 2" store={store} raf={frames.raf} caf={frames.caf} collapsible={collapsible} />
        </ShadowProvider>
      </SessionProvider>
    </I18nProvider>,
  );
  const { rerender } = render(tree(SOURCE));
  await act(async () => { await settle(); });
  if (collapsible) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dalga formunu göster" })); await settle(); });
  }
  const opener = () => screen.getByRole("button", { name: "Tam ekran görünüm" });
  const open = async () => {
    await act(async () => { fireEvent.click(opener()); await settle(); });
    return screen.getByRole("dialog", { name: TITLE });
  };
  const setSource = async (next) => { await act(async () => { rerender(tree(next)); await settle(); }); };
  return { timers, opener, open, setSource };
}

async function openFull(options) {
  const view = await mount(options);
  const opener = view.opener();
  const dialog = await view.open();
  return { ...view, opener, dialog };
}

/** Every document listener added and not yet removed (a capture listener counted apart). */
function listenerLedger() {
  const live = [];
  const add = document.addEventListener;
  const remove = document.removeEventListener;
  const capture = (o) => (typeof o === "boolean" ? o : Boolean(o?.capture));
  vi.spyOn(document, "addEventListener").mockImplementation(function spyAdd(type, fn, o) {
    live.push({ type, fn, capture: capture(o) });
    return add.call(this, type, fn, o);
  });
  vi.spyOn(document, "removeEventListener").mockImplementation(function spyRemove(type, fn, o) {
    const at = live.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture(o));
    if (at !== -1) live.splice(at, 1);
    return remove.call(this, type, fn, o);
  });
  const count = () => ({
    keydown: live.filter((l) => l.type === "keydown").length,
    fullscreenchange: live.filter((l) => l.type === "fullscreenchange").length,
  });
  return { count };
}

const numbersIn = (dialog) => within(dialog).getByRole("region", { name: "REA-01 · 2 · Monitör · doğrulanmamış" });
const closeButton = () => screen.getByRole("button", { name: "Tam ekrandan çık" });

describe("the full-screen view", () => {
  it("fills the window on black under the app's alarms and warnings, takes the page to full screen, and keeps the stamp at full size", async () => {
    const { dialog } = await openFull();
    expect(dialog).toHaveClass("bg-black", "fixed", "inset-0");
    // Under the toasts (z-120), the idle warning (z-200) and the alarm holder (z-210): the page's
    // full screen, not this view's, so they stay on screen while someone watches the waves.
    expect(dialog).toHaveClass("z-[110]");
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBe(document.documentElement);
    expect(within(dialog).getByText(STAMP)).toHaveClass("text-17");
    expect(within(dialog).getAllByRole("img")).toHaveLength(4);
    expect(document.querySelector("[data-wave-panel] [data-wave-rows]")).toBeNull();   // the panel's rows wait
  });

  it("draws its waves in white ink on the black (R11)", async () => {
    const { dialog } = await openFull();
    for (const canvas of within(dialog).getAllByRole("img", { name: /ölçüm değildir/ })) {
      expect(canvas).toHaveClass("text-white");
      expect(canvas).not.toHaveClass("text-ink");
    }
  });

  it("keeps the header and the stamp in view while the rest scrolls", async () => {
    const { dialog } = await openFull();
    const head = within(dialog).getByText(STAMP).closest("[data-wave-head]");
    expect(head).toHaveClass("sticky", "top-0", "z-10", "bg-black");
    expect(head).toContainElement(closeButton());
    expect(head).toContainElement(within(dialog).getByRole("heading", { name: TITLE }));
  });

  it("stays open when the browser announces that it entered full screen", async () => {
    await openFull();
    expect(fullscreenElement).toBe(document.documentElement);        // entered, and announced (beforeEach)
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
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
  it("says the stream is missing when a poll fails while it is open, and keeps the rows it has", async () => {
    let reply = () => answer();
    const { dialog, timers } = await openFull({ reply: () => reply() });
    expect(within(dialog).queryByText("Dalga akışı yok")).toBeNull();
    reply = () => { throw refusal(503); };
    await act(async () => { await timers.fire(); });
    expect(within(dialog).getByText("Dalga akışı yok")).toBeInTheDocument();
    expect(within(dialog).getByText(STAMP)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("img")).toHaveLength(4);
  });

  // A refusal drops the blocks: there is nothing left to show in full screen. It closes, the panel
  // says why, and the focus lands in the panel — ⤢ went with the rows — not on <body>.
  it.each([
    [false, () => screen.getByRole("heading", { name: TITLE })],
    [true, () => screen.getByRole("button", { name: "Dalga formunu gizle" })],
  ])("closes on a 404 while it is open (device screen: %s), says why in the panel and keeps the focus there", async (collapsible, target) => {
    let reply = () => answer();
    const { timers } = await openFull({ reply: () => reply(), collapsible });
    expect(document.activeElement).toBe(closeButton());
    reply = () => { throw refusal(404); };
    await act(async () => { await timers.fire(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Bu cihazın dalga formu gösterilemiyor");
    expect(document.activeElement).toBe(target());
  });

  it("closes on Escape, leaves the full screen it entered and gives the focus back to ⤢", async () => {
    const { opener } = await openFull();
    expect(document.activeElement).toBe(closeButton());
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves the page in the full screen it was already in (the top bar's), on open and on close", async () => {
    fullscreenElement = document.documentElement;
    const { dialog } = await openFull();
    expect(HTMLElement.prototype.requestFullscreen).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    await act(async () => { fireEvent.click(closeButton()); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(fullscreenElement).toBe(document.documentElement);
  });

  it("closes on ×, and when the browser leaves full screen by itself", async () => {
    await openFull();
    await act(async () => { fireEvent.click(closeButton()); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tam ekran görünüm" })); await settle(); });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fullscreenElement = null;
    await act(async () => { announce(); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("brings Tab back to its one control from anywhere, and keeps it from the page behind", async () => {
    const { opener } = await openFull();
    opener.focus();                                                  // the panel's ⤢, behind the black
    expect(document.activeElement).toBe(opener);
    const passed = fireEvent.keyDown(opener, { key: "Tab" });
    expect(passed).toBe(false);                                      // defaultPrevented
    expect(document.activeElement).toBe(closeButton());
  });

  it("takes its listeners away when it closes, and when the page goes", async () => {
    const ledger = listenerLedger();
    const view = await mount();
    const before = ledger.count();
    await view.open();
    expect(ledger.count().keydown).toBe(before.keydown + 1);
    expect(ledger.count().fullscreenchange).toBe(before.fullscreenchange + 1);
    await act(async () => { fireEvent.click(closeButton()); await settle(); });
    expect(ledger.count()).toEqual(before);
    await view.open();
    expect(ledger.count()).not.toEqual(before);
    cleanup();
    expect(ledger.count()).toEqual({ keydown: 0, fullscreenchange: 0 });
  });

  it("is a window-filling overlay when the browser throws at the request, and leaks no listener", async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn(() => { throw new TypeError("refused"); });
    const ledger = listenerLedger();
    const view = await mount();
    const before = ledger.count();
    const dialog = await view.open();
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveClass("fixed", "inset-0");
    expect(within(dialog).getByText(STAMP)).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(ledger.count()).toEqual(before);
    expect(document.querySelector("[data-wave-panel]")).toBeInTheDocument();
  });

  it("closes cleanly when the browser throws at leaving full screen", async () => {
    document.exitFullscreen = vi.fn(() => { throw new TypeError("refused"); });
    const { opener } = await openFull();
    await act(async () => { fireEvent.click(closeButton()); await settle(); });
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[data-wave-panel]")).toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("survives StrictMode's rehearsal: one full screen, kept while open, handed back once", async () => {
    const { dialog } = await openFull({ wrap: (ui) => <React.StrictMode>{ui}</React.StrictMode> });
    await act(async () => { await settle(); });
    expect(HTMLElement.prototype.requestFullscreen).toHaveBeenCalledTimes(1);   // the rehearsal asks no second time
    expect(fullscreenElement).toBe(document.documentElement);
    expect(dialog).toBeInTheDocument();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(closeButton()); await settle(); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBeNull();
  });

  it("closes when the panel turns to another monitor, and does not come back on its first answer", async () => {
    const { setSource } = await openFull();
    await setSource("192.0.2.11");                                   // the store answers at once
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Tam ekran görünüm" })).toBeInTheDocument();   // its rows are drawn
  });

  it("finds the strip's card by address, and none while the strip is off", () => {
    const data = strip({ beds: [stripBed("REA-01 · 2", [], { source: SOURCE })] });
    expect(cardOf(data, SOURCE).bed_label).toBe("REA-01 · 2");
    expect(cardOf(data, "192.0.2.99")).toBeNull();
    expect(cardOf({ stage: "off" }, SOURCE)).toBeNull();
  });

  // The device screen draws its cards without a patient (DevicesScreen's `withoutPatient`); the full
  // screen opens from both screens, so it takes the stricter rule everywhere.
  it("hands the strip no patient: the link and the patient id are dropped", async () => {
    const data = strip({
      beds: [stripBed("REA-01 · 2", [param("hr", 72)], { source: SOURCE, link: "one", patient_id: "S-001", link_reason: "admitted" })],
    });
    expect(cardOf(data, SOURCE)).toMatchObject({ patient_id: null, link: "hidden", link_reason: null, bed_label: "REA-01 · 2" });
    expect(data.beds[0].patient_id).toBe("S-001");                  // the strip's own answer is not changed
    const { dialog } = await openFull({ data });
    expect(dialog).not.toHaveTextContent("S-001");
  });
});
