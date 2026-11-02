// SavedStep.test.jsx — «Kaydedildi»: what was saved, each value with a «hatalı giriş», and a withdrawn row kept,
// struck through and said as such (G3-01, D13). Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { hhmm } from "../../i18n/dates.js";
import { RETRACT_ARM_MS } from "../common/RetractDialog.jsx";
import { SavedStep } from "./SavedStep.jsx";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const CHARTABLE = ["board.view", "clinical.chart"];
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const SAVED = { atMs: NOW, rows: [
  { code: "resp_rate", value: 26, entry: 41 },
  { code: "supplemental_oxygen", value: 1, entry: 42 },
  { code: "spo2", value: 91, entry: null },          // an older engine answered no id for it
] };

async function open() {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onRetract = vi.fn(() => Promise.resolve({ retracted: 41, code: "resp_rate", alerts: [] }));
  await act(async () => {
    await mount(<SavedStep bed="REA-01 · 2" saved={SAVED} nowMs={NOW} onRetract={onRetract}><button type="button">next</button></SavedStep>,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onRetract };
}
const row = (code) => document.querySelector(`[data-row="${code}"]`);
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the saved step", () => {
  it("lists what was saved with its time, and a «Səhv qeyd» for each value that has a row", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 2, name: `Yadda saxlanıldı · ${hhmm(NOW)}` })).toBeInTheDocument();
    expect(row("resp_rate")).toHaveTextContent("Tənəffüs 26 /dəq");
    expect(row("supplemental_oxygen")).toHaveTextContent("Əlavə oksigen Əlavə oksigen alır");
    expect(within(row("resp_rate")).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
    expect(within(row("spo2")).queryByRole("button")).toBeNull();
    expect(screen.getByRole("button", { name: "next" })).toBeInTheDocument();
  });

  it("keeps a withdrawn row, struck through and said as such, with no second button", async () => {
    const { onRetract } = await open();
    await press(within(row("resp_rate")).getByRole("button", { name: "Səhv qeyd" }));
    const dialog = screen.getByRole("dialog", { name: "Səhv qeyd · REA-01 · 2" });
    expect(dialog).toHaveTextContent(`Tənəffüs: 26 /dəq · ölçmə ${hhmm(NOW)}`);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "yazım hatası, 16 idi" } });
    act(() => { vi.advanceTimersByTime(RETRACT_ARM_MS); });
    await press(within(dialog).getByRole("button", { name: "Səhv qeyd kimi işarələ" }));
    expect(onRetract).toHaveBeenCalledWith(41, "yazım hatası, 16 idi");
    expect(row("resp_rate").querySelector("s")).toHaveTextContent("26 /dəq");
    expect(row("resp_rate")).toHaveTextContent("səhv qeyd kimi işarələndi");
    expect(within(row("resp_rate")).queryByRole("button")).toBeNull();
    expect(within(row("supplemental_oxygen")).getByRole("button", { name: "Səhv qeyd" })).toBeInTheDocument();
  });
});
