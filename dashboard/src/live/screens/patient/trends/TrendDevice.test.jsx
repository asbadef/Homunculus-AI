// TrendDevice.test.jsx — G3-05 (D16): the big chart's table names a device reading «cihaz» and offers «Düzelt» on
// it; a withdrawn device reading is listed struck through, as a withdrawn hand entry is. Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { RETRACT_ARM_MS } from "../../common/RetractDialog.jsx";
import { CARDS } from "./cards.js";
import { TrendModal } from "./TrendModal.jsx";
import { TrendsBox } from "./TrendsBox.jsx";
import { deviceEntryOf, entriesOfPoints, parseDevice, parseManual, parsePoints } from "./trendGeometry.js";
import { answering, channel, dev, hand, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const BED = "REA-01 · 2";
const WHY = "manşet yanlış koldaydı, yeniden ölçüldü";
const CHARTABLE = ["board.view", "clinical.chart"];
// Three pulse readings: a device's at −120 min (entry 71), a hand entry at −60 min (entry 41), a device's at −30 min
// that was withdrawn (entry 72: gone from the drawn points, listed in `device` with its withdrawal).
const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 96, 1)], {
  manual: [hand(41, 60, 96)],
  device: [dev(71, 120, 84), dev(72, 30, 188, { retracted: { reason: "manşet yanlış koldaydı", minutesAgo: 20 } })],
})], { hours }));

async function open(answer = MIXED, props = {}, cardId = "heart_rate") {
  vi.setSystemTime(NOW);
  const card = CARDS.find((c) => c.id === cardId);
  const mounted = await mount(<TrendModal card={card} patient={PATIENT} bed={BED} onClose={() => {}} {...props} />, {
    access: token(), me: profile(), setup: (api) => api.patientTrends.mockImplementation(answer),
  });
  await act(async () => { await settle(); });
  await act(async () => { fireEvent.click(within(screen.getAllByRole("dialog")[0]).getByRole("button", { name: "Cədvəl" })); await settle(); });
  return mounted;
}
const table = () => screen.getAllByRole("dialog")[0].querySelector("table");
const row = (selector) => table().querySelector(selector);
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the device readings of a channel (trendGeometry)", () => {
  it("parses `device`, dropping an entry it cannot read", () => {
    const parsed = parseDevice([dev(71, 120, 84), { entry: "x", at: "bad", value: 1 }, dev(72, 30, 188, { retracted: { reason: "r", minutesAgo: 20 } })]);
    expect(parsed.map((d) => [d.entry, d.value, d.source, d.retracted === null])).toEqual([[71, 84, "CONNEX-3A", true], [72, 188, "CONNEX-3A", false]]);
    expect(parsed[1].retracted).toMatchObject({ reason: "r", by: "hem.ayse" });
    expect(parseDevice(undefined)).toEqual([]);
  });

  it("finds the device reading a drawn point is — not a withdrawn one, at its instant, with its value", () => {
    const parsed = parseDevice([dev(71, 120, 84), dev(72, 30, 188, { retracted: { reason: "r", minutesAgo: 20 } })]);
    expect(deviceEntryOf(parsed, { ms: parsed[0].ms, value: 84 })?.entry).toBe(71);
    expect(deviceEntryOf(parsed, { ms: parsed[0].ms, value: 85 })).toBeNull();
    expect(deviceEntryOf(parsed, { ms: parsed[1].ms, value: 188 })).toBeNull();
    expect(deviceEntryOf(undefined, { ms: 1, value: 1 })).toBeNull();
  });

  describe("entriesOfPoints — each trail entry is given to one point", () => {
    const pts = (...rows) => parsePoints(rows);
    const ids = (given) => given.map((g) => [g.hand?.entry ?? null, g.device?.entry ?? null]);

    it("gives two readings of one instant and value to two devices' entries, each its own", () => {
      const given = entriesOfPoints(pts(point(120, 84), point(120, 84)), [], parseDevice([dev(71, 120, 84), dev(73, 120, 84, { source: "CONNEX-3B" })]));
      expect(ids(given)).toEqual([[null, 71], [null, 73]]);
    });

    it("gives a hand entry to one of two points that fit it, and the device's reading to the other", () => {
      const given = entriesOfPoints(pts(point(60, 96), point(60, 96)), parseManual([hand(41, 60, 96)]), parseDevice([dev(71, 60, 96)]));
      expect(ids(given)).toEqual([[41, null], [null, 71]]);
    });

    it("leaves a point beyond the entries without one, skips a withdrawn entry, and matches nothing at another value or instant", () => {
      const withdrawn = parseDevice([dev(71, 60, 96, { retracted: { reason: "r", minutesAgo: 5 } }), dev(72, 61, 96), dev(73, 60, 97)]);
      expect(ids(entriesOfPoints(pts(point(60, 96), point(60, 96)), [], withdrawn))).toEqual([[null, null], [null, null]]);
      expect(ids(entriesOfPoints(pts(point(60, 96), point(60, 96)), [], parseDevice([dev(74, 60, 96)])))).toEqual([[null, 74], [null, null]]);
    });

    it("answers for no points, no entries and an unreadable point", () => {
      expect(entriesOfPoints(undefined, undefined, undefined)).toEqual([]);
      expect(ids(entriesOfPoints(pts(point(60, 96)), undefined, undefined))).toEqual([[null, null]]);
      expect(ids(entriesOfPoints([{ ms: Number.NaN, value: 1 }, { ms: 1, value: Number.NaN }], parseManual([hand(41, 60, 96)]), []))).toEqual([[null, null], [null, null]]);
    });
  });
});

describe("the trend table and the device", () => {
  it("says «cihaz» on a device reading and «elle» on a hand entry", async () => {
    await open();
    expect(row("tr[data-value='84']")).toHaveTextContent("cihazdan");
    expect(row("tr[data-value='84']")).not.toHaveTextContent("əl ilə");
    expect(row("tr[data-value='96']")).toHaveTextContent("əl ilə");
    expect(row("tr[data-value='96']")).not.toHaveTextContent("cihazdan");
  });

  it("lists a withdrawn device reading struck through, as the device's, with its reason", async () => {
    await open();
    const struck = row("tr[data-withdrawn='72']");
    expect(struck.querySelector("s")).toHaveTextContent("188");
    expect(struck).toHaveTextContent("cihazdan");
    expect(struck).toHaveTextContent("səhv qeyd — manşet yanlış koldaydı · hem.ayse");
    expect(struck).not.toHaveTextContent("əl ilə");
  });

  it("offers «Düzelt» on a device reading only to a clinical.chart holder with both writes", async () => {
    await open();
    expect(within(table()).queryByRole("button", { name: "Düzəlt" })).toBeNull();
    cleanup();
    await open(MIXED, { canRetract: true, onRetract: vi.fn(), onChart: vi.fn() });
    expect(within(row("tr[data-value='84']")).getByRole("button", { name: "Düzəlt" })).toBeInTheDocument();
    // the hand entry keeps its own button, and gets no «Düzelt»
    expect(within(row("tr[data-value='96']")).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
    expect(within(row("tr[data-value='96']")).queryByRole("button", { name: "Düzəlt" })).toBeNull();
  });

  it("«Düzelt» withdraws the device reading and charts the right value at its own time, then reads again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRetract = vi.fn(() => Promise.resolve({ retracted: 71, code: "heart_rate", alerts: [] }));
    const onChart = vi.fn(() => Promise.resolve({ charted: 1 }));
    const { api } = await open(MIXED, { canRetract: true, onRetract, onChart });
    const reads = api.patientTrends.mock.calls.length;
    await press(within(row("tr[data-value='84']")).getByRole("button", { name: "Düzəlt" }));
    const dialog = screen.getAllByRole("dialog").at(-1);
    expect(dialog).toHaveTextContent("Nəbz: 84 /dəq");
    expect(dialog).toHaveTextContent("cihazdan · CONNEX-3A");
    await act(async () => { vi.advanceTimersByTime(RETRACT_ARM_MS + 1); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: WHY } }); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Düzgün dəyər/), { target: { value: "78" } }); await settle(); });
    await press(within(dialog).getByRole("button", { name: "Düzəlt" }));
    expect(onRetract).toHaveBeenCalledWith(71, WHY);
    expect(onChart).toHaveBeenCalledWith([{ code: "heart_rate", value: 78 }], new Date(NOW - 120 * 60_000).toISOString());
    expect(api.patientTrends.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);              // only the chart's dialog is left
  });

  it("a window with only a withdrawn device reading says so instead of «no measurement»", async () => {
    const only = answering((pid, hours) => trends(pid, [channel("heart_rate", [], {
      device: [dev(72, 30, 188, { retracted: { reason: "manşet yanlış koldaydı", minutesAgo: 20 } })] })], { hours }));
    await open(only);
    const dialog = screen.getAllByRole("dialog")[0];
    expect(dialog.querySelector("[data-only-withdrawn]")).not.toBeNull();
    expect(dialog.querySelector("[data-no-data]")).toBeNull();
  });

  it("says «cihaz» on a device reading of a channel the bedside form does not chart, and offers no «Düzelt» on it", async () => {
    const lactate = answering((pid, hours) => trends(pid, [channel("lactate", [point(30, 2.1)], {
      device: [dev(81, 30, 2.1, { source: "LAB" })] })], { hours }));
    await open(lactate, { canRetract: true, onRetract: vi.fn(), onChart: vi.fn() }, "lactate");
    expect(row("tr[data-value='2.1']")).toHaveTextContent("cihazdan");
    expect(within(row("tr[data-value='2.1']")).queryByRole("button")).toBeNull();
  });

  it("names the value in «Düzelt» as the record box does: the locale's number and the bedside form's unit", async () => {
    const warm = answering((pid, hours) => trends(pid, [channel("temperature", [point(90, 36.8)], { device: [dev(91, 90, 36.8)] })], { hours }));
    await open(warm, { canRetract: true, onRetract: vi.fn(), onChart: vi.fn() }, "temperature");
    await press(within(row("tr[data-value='36.8']")).getByRole("button", { name: "Düzəlt" }));
    expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent("Bədən hərarəti: 36,8 °C");
  });
});

describe("two points that share an instant and a value — each row names its own entry", () => {
  // The points carry no id: each row must be given ONE entry, or the second is unreachable and «Düzelt» on either
  // would withdraw the first.
  const rowsAt = (value) => [...table().querySelectorAll(`tr[data-value='${value}']`)];

  /** The whole walk of one row's «Düzelt» with no right value typed: the dialog's text before it is sent. */
  async function correctOne(el) {
    await press(within(el).getByRole("button", { name: "Düzəlt" }));
    const dialog = screen.getAllByRole("dialog").at(-1);
    const said = dialog.textContent;
    await act(async () => { vi.advanceTimersByTime(RETRACT_ARM_MS + 1); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: WHY } }); await settle(); });
    await press(within(dialog).getByRole("button", { name: "Düzəlt" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    return said;
  }

  it("two devices' readings: «Düzelt» on each row withdraws that row's own device's entry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRetract = vi.fn(() => Promise.resolve({ retracted: 0, code: "heart_rate", alerts: [] }));
    const twins = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(120, 84, 0)], {
      device: [dev(71, 120, 84, { source: "CONNEX-3A" }), dev(73, 120, 84, { source: "CONNEX-3B" })] })], { hours }));
    await open(twins, { canRetract: true, onRetract, onChart: vi.fn() });
    expect(rowsAt(84)).toHaveLength(2);
    rowsAt(84).forEach((r) => expect(r).toHaveTextContent("cihazdan"));
    const first = await correctOne(rowsAt(84)[0]);
    const second = await correctOne(rowsAt(84)[1]);
    const entries = onRetract.mock.calls.map(([entry]) => entry);
    expect(new Set(entries)).toEqual(new Set([71, 73]));                     // two rows, two entries — never one twice
    const sourceOf = { 71: "CONNEX-3A", 73: "CONNEX-3B" };
    expect(first).toContain(`cihazdan · ${sourceOf[entries[0]]}`);           // and the dialog names that entry's device
    expect(second).toContain(`cihazdan · ${sourceOf[entries[1]]}`);
  });

  it("a hand entry beside a device's reading: one row says «elle» and is the hand entry's, the other says «cihaz» and is the device's", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRetract = vi.fn(() => Promise.resolve({ retracted: 0, code: "heart_rate", alerts: [] }));
    const beside = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(60, 96, 1), point(60, 96, 1)], {
      manual: [hand(41, 60, 96)], device: [dev(71, 60, 96)] })], { hours }));
    await open(beside, { canRetract: true, onRetract, onChart: vi.fn() });
    const byHand = rowsAt(96).filter((r) => r.textContent.includes("əl ilə"));
    const byDevice = rowsAt(96).filter((r) => r.textContent.includes("cihazdan"));
    expect(rowsAt(96)).toHaveLength(2);
    expect(byHand).toHaveLength(1);
    expect(byDevice).toHaveLength(1);
    expect(byHand[0]).not.toBe(byDevice[0]);
    expect(byHand[0]).not.toHaveTextContent("cihazdan");
    expect(byDevice[0]).not.toHaveTextContent("əl ilə");
    // each keeps its own button: «Hatalı giriş» for the hand entry, «Düzelt» for the device's
    expect(within(byHand[0]).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
    expect(within(byHand[0]).queryByRole("button", { name: "Düzəlt" })).toBeNull();
    expect(within(byDevice[0]).getByRole("button", { name: "Düzəlt" })).toBeInTheDocument();
    expect(within(byDevice[0]).queryByRole("button", { name: "Səhv qeyd" })).toBeNull();
    // and «Düzelt» on the device's row aims at the device's entry, not the hand entry that shares its instant
    expect(await correctOne(byDevice[0])).toContain("cihazdan · CONNEX-3A");
    expect(onRetract).toHaveBeenCalledWith(71, WHY);
    expect(onRetract).toHaveBeenCalledTimes(1);
  });
});

describe("the trends box, correcting a device reading", () => {
  it("charts the right value through the board's store at the reading's own time, tells the screen after each write, and reads the box again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    const onWritten = vi.fn();
    const { api } = await mount(<TrendsBox patient={PATIENT} bed={BED} nowMs={NOW} onWritten={onWritten} />, {
      access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
      setup: (a) => {
        a.patientTrends.mockImplementation(MIXED);
        a.retractEntry.mockResolvedValue({ retracted: 71, code: "heart_rate", alerts: [] });
        a.chart.mockResolvedValue({ patient_id: "S-001", charted: 1, alerts: [], entries: [{ code: "heart_rate", entry: 501 }] });
      },
    });
    await act(async () => { await settle(); });
    await press(screen.getByRole("button", { name: /Nəbz: böyük qrafiki aç/ }));
    const chartDialog = screen.getAllByRole("dialog")[0];
    await press(within(chartDialog).getByRole("button", { name: "6 saat" }));   // the dialog reads its own window; the box keeps its 24 hours
    await press(within(chartDialog).getByRole("button", { name: "Cədvəl" }));
    const day = () => api.patientTrends.mock.calls.filter(([, hours]) => hours === 24).length;
    const before = day();
    await press(within(row("tr[data-value='84']")).getByRole("button", { name: "Düzəlt" }));
    const dialog = screen.getAllByRole("dialog").at(-1);
    await act(async () => { vi.advanceTimersByTime(RETRACT_ARM_MS + 1); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Səbəb/), { target: { value: WHY } }); await settle(); });
    await act(async () => { fireEvent.change(within(dialog).getByLabelText(/^Düzgün dəyər/), { target: { value: "78" } }); await settle(); });
    await press(within(dialog).getByRole("button", { name: "Düzəlt" }));
    expect(api.retractEntry).toHaveBeenCalledWith("S-001", 71, WHY);
    expect(api.chart).toHaveBeenCalledTimes(1);
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "heart_rate", value: 78 }], new Date(NOW - 120 * 60_000).toISOString());
    // The screen is told once for the withdrawal and once for the right value — the second only after the chart answered.
    expect(onWritten).toHaveBeenCalledTimes(2);
    expect(onWritten).toHaveBeenNthCalledWith(1, "S-001");
    expect(onWritten).toHaveBeenNthCalledWith(2, "S-001");
    expect(api.chart.mock.invocationCallOrder[0]).toBeLessThan(onWritten.mock.invocationCallOrder[1]);
    expect(day()).toBe(before + 2);                       // and the box's own 24 hours were read again after each write
  });
});
