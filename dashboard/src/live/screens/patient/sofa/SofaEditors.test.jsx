// SofaEditors.test.jsx — a completion's time is the clock's until she edits it and is read again at the press
// (the Meds form's rule, its final review I2); a correction's reason is counted live against the engine's
// length, trimmed, and a value outside the door's bounds is held with the focus on it (G2-A4, D3, D5, X7, X8).
// Synthetic values; the az texts.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { NOW } from "../../../data/board.testutil.js";
import { ChartEntry, CorrectionEntry } from "./SofaEditors.jsx";
import { toLocalInput } from "./sofaFields.js";
import { WHY } from "./sofa.testutil.js";

const MIN = 60_000;
// The fake-timer recipe of the earlier waves (meds/MedsChartForm.test.jsx): installed BEFORE the mount, `Date`
// faked with them, nothing advancing on its own; `settle` yields one turn of the REAL event loop.
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

describe("ChartEntry (D3)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open() {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(NOW);
    const onSave = vi.fn();
    await mount(<ChartEntry code="gcs" busy={false} onSave={onSave} onCancel={vi.fn()} />, { access: token(), me: profile() });
    return { onSave };
  }
  const entry = () => screen.getByRole("form", { name: "GCS (Qlazqo koma şkalası) — yeni ölçmə" });
  const time = () => within(entry()).getByLabelText("Ölçmə saatı");
  const value = (v) => fireEvent.change(within(entry()).getByLabelText(/GCS/), { target: { value: v } });
  const save = () => act(async () => { fireEvent.click(within(entry()).getByRole("button", { name: "Yadda saxla" })); await settle(); });

  // Review 2: an untouched time is the server's to stamp. A browser clock ahead of the server's would chart the
  // measurement in the future, and the read that follows would not hold it.
  it("untouched, no time is sent: opened at NOW and saved 90 min later, the server stamps it with its own clock", async () => {
    const { onSave } = await open();
    value("11");
    act(() => { vi.setSystemTime(NOW + 90 * MIN); });          // the clock moved; no tick has run yet
    await save();
    expect(onSave).toHaveBeenCalledWith(11, null);
  });

  it("GCS is a whole number: 14,5 is held with the focus on it, 14 is sent", async () => {
    const { onSave } = await open();
    value("14,5");
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(within(entry()).getByText("Tam ədəd olmalıdır.")).toBeInTheDocument();
    expect(document.activeElement).toBe(within(entry()).getByLabelText(/GCS/));
    value("14");
    await save();
    expect(onSave).toHaveBeenCalledWith(14, null);
  });

  it("untouched, the field shows the clock's minute as it moves; typed, it is hers and nothing moves it", async () => {
    const { onSave } = await open();
    expect(time()).toHaveValue(toLocalInput(NOW));
    act(() => { vi.advanceTimersByTime(MIN); });
    expect(time()).toHaveValue(toLocalInput(NOW + MIN));
    fireEvent.change(time(), { target: { value: toLocalInput(NOW - 120 * MIN) } });
    act(() => { vi.setSystemTime(NOW + 90 * MIN); vi.advanceTimersByTime(MIN); });
    expect(time()).toHaveValue(toLocalInput(NOW - 120 * MIN));
    value("11");
    await save();
    expect(onSave).toHaveBeenCalledWith(11, new Date(NOW - 120 * MIN).toISOString());
  });
});

describe("CorrectionEntry (D5)", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open({ initial = null } = {}) {
    vi.setSystemTime(NOW);
    const onKeep = vi.fn();
    await mount(
      <CorrectionEntry code="platelets" recorded={45} minReason={20} initial={initial} onKeep={onKeep} onCancel={vi.fn()} />,
      { access: token(), me: profile() });
    return { onKeep };
  }
  const entry = () => screen.getByRole("form", { name: "Trombosit sayı — düzəliş" });
  const valueField = () => within(entry()).getByLabelText(/Düzgün dəyər/);
  const reasonField = () => within(entry()).getByLabelText("Əsaslandırma");
  const keep = () => act(async () => { fireEvent.click(within(entry()).getByRole("button", { name: "Düzəlişi saxlayın" })); await settle(); });

  it("says the recorded value, counts the trimmed reason against the engine's length, and keeps the trimmed reason", async () => {
    const { onKeep } = await open();
    expect(entry()).toHaveTextContent("Qeyddəki dəyər: 45 ×10³/mkl.");
    fireEvent.change(reasonField(), { target: { value: "   " } });
    expect(within(entry()).getByText("0 / 20 simvol")).toBeInTheDocument();
    expect(reasonField()).toHaveAccessibleDescription(/0 \/ 20 simvol/);
    fireEvent.change(valueField(), { target: { value: "38" } });
    fireEvent.change(reasonField(), { target: { value: "qısa" } });
    await keep();
    expect(onKeep).not.toHaveBeenCalled();
    expect(within(entry()).getByText("Əsaslandırma ən azı 20 simvol olmalıdır.")).toBeInTheDocument();
    expect(document.activeElement).toBe(reasonField());
    fireEvent.change(reasonField(), { target: { value: `  ${WHY}  ` } });
    expect(within(entry()).getByText(`${[...WHY].length} / 20 simvol`)).toBeInTheDocument();
    await keep();
    expect(onKeep).toHaveBeenCalledWith({ value: 38, reason: WHY });
  });

  it("holds a value outside the door's bounds, with the focus on it (X7)", async () => {
    const { onKeep } = await open();
    fireEvent.change(valueField(), { target: { value: "6000" } });
    fireEvent.change(reasonField(), { target: { value: WHY } });
    await keep();
    expect(onKeep).not.toHaveBeenCalled();
    expect(within(entry()).getByText("Gözlənilən aralıqdan (0–5000) kənardadır — vahid və ya onluq vergül səhvi ola bilər.")).toBeInTheDocument();
    expect(document.activeElement).toBe(valueField());
  });

  it("opens a correction already held with its value and its reason", async () => {
    await open({ initial: { value: 80, reason: WHY } });
    expect(valueField()).toHaveValue("80");
    expect(reasonField()).toHaveValue(WHY);
    expect(within(entry()).getByText(`${[...WHY].length} / 20 simvol`)).toBeInTheDocument();
  });
});
