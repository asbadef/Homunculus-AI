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
import { deviceEntryOf, parseDevice } from "./trendGeometry.js";
import { answering, channel, dev, hand, point, trends } from "./trends.testutil.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const BED = "REA-01 · 2";
const WHY = "manşet yanlış koldaydı, yeniden ölçüldü";
// Three pulse readings: a device's at −120 min (entry 71), a hand entry at −60 min (entry 41), a device's at −30 min
// that was withdrawn (entry 72: gone from the drawn points, listed in `device` with its withdrawal).
const MIXED = answering((pid, hours) => trends(pid, [channel("heart_rate", [point(120, 84, 0), point(60, 96, 1)], {
  manual: [hand(41, 60, 96)],
  device: [dev(71, 120, 84), dev(72, 30, 188, { retracted: { reason: "manşet yanlış koldaydı", minutesAgo: 20 } })],
})], { hours }));

async function open(answer = MIXED, props = {}) {
  vi.setSystemTime(NOW);
  const card = CARDS.find((c) => c.id === "heart_rate");
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
});
