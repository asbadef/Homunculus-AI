// VitalsForm.test.jsx — the bedside form sends what was entered and only that, previews before it saves, holds a
// slipped digit back under its box, and says what happened on the toast, named after the bed (G3-01).
// Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { news2 } from "../../data/board.testutil.js";
import { SAVE_ARM_MS, VitalsForm, savedOf } from "./VitalsForm.jsx";
import { toLocalInput } from "./vitalsFields.js";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const BED = "REA-01 · 2";
const CHARTABLE = ["board.view", "clinical.chart"];
// The fake-timer recipe of the SOFA and Meds forms: installed BEFORE the mount, `Date` faked with them, nothing
// advancing on its own — so «Yadda saxla»'s arming window is crossed only when a test says so.
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const PREVIEW = {
  patient_id: "S-001", preview: true, at: new Date(NOW).toISOString(),
  news2: news2({ total: 5, partial: true, missing: ["systolic_bp", "pulse", "temperature"],
    breakdown: { respiration_rate: 3, spo2: 2, air_or_oxygen: 0 } }),
};
const SAVED = { patient_id: "S-001", charted: 2, alerts: [],
  entries: [{ code: "resp_rate", entry: 41 }, { code: "spo2", entry: 42 }] };

async function open({ preview = () => Promise.resolve(PREVIEW), save = () => Promise.resolve(SAVED) } = {}) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onPreview = vi.fn(preview);
  const onSave = vi.fn(save);
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  await act(async () => {
    await mount(
      <VitalsForm bed={BED} nowMs={NOW} onPreview={onPreview} onSave={onSave} onSaved={onSaved} onCancel={onCancel} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onPreview, onSave, onSaved, onCancel };
}
// A box by its label: the label carries the unit after the name ("Nəbz (/dəq)"); its − and + are buttons.
const box = (name) => screen.getByRole("textbox", { name: new RegExp(`^${name}`) });
const type = (name, value) => fireEvent.change(box(name), { target: { value } });
const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
const button = (name) => screen.getByRole("button", { name });
const preview = () => press(button("Öncədən baxın"));
const armed = () => act(() => { vi.advanceTimersByTime(SAVE_ARM_MS); });
const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);
const panel = () => document.querySelector("[data-preview]");

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bedside form", () => {
  it("sends nothing from an empty form, and says why", async () => {
    const { onPreview } = await open();
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("Ən azı bir dəyər daxil edin.")).toBeInTheDocument();
  });

  it("holds a slipped digit under its box, with the bounds, and takes the focus there", async () => {
    const { onPreview } = await open();
    type("Tənəffüs", "22");
    type("Nəbz", "800");
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("0–300 aralığında olmalıdır.")).toBeInTheDocument();
    expect(document.activeElement).toBe(box("Nəbz"));
  });

  it("steps a value inside its bounds, and never invents a first one", async () => {
    await open();
    type("Tənəffüs", "26");
    await press(button("Tənəffüs: artır"));
    expect(box("Tənəffüs")).toHaveValue("27");
    type("SpO2", "100");
    await press(button("SpO2: artır"));
    expect(box("SpO2")).toHaveValue("100");
    await press(button("Nəbz: azalt"));
    expect(box("Nəbz")).toHaveValue("");
  });

  it("previews exactly what was entered, with no time, and draws the engine's answer", async () => {
    const { onPreview } = await open();
    type("Tənəffüs", "26");
    type("SpO2", "91");
    await press(button("Əlavə oksigen alır"));
    await preview();
    expect(onPreview).toHaveBeenCalledWith(
      [{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }, { code: "supplemental_oxygen", value: 1 }], null);
    expect(panel()).toHaveTextContent("NEWS2 (öncədən baxış):");
    expect(panel()).toHaveTextContent("Qismən bal: sistolik AT, nəbz, temperatur daxil edilməyib və ya cari deyil.");
    expect(within(panel()).getByText("Tənəffüs: +3 bal")).toBeInTheDocument();
    expect(within(panel()).getByText("SpO2: +2 bal")).toBeInTheDocument();
    expect(within(panel()).queryByText(/Əlavə oksigen: \+/)).toBeNull();      // 0 points is not listed
    expect(screen.queryByRole("button", { name: "Öncədən baxın" })).toBeNull();
    expect(button("Yadda saxla")).toBeInTheDocument();
  });

  it("holds «Yadda saxla» for SAVE_ARM_MS, then saves what was previewed and hands over its rows", async () => {
    const { onSave, onSaved } = await open();
    type("Tənəffüs", "26");
    type("SpO2", "91");
    await preview();
    await press(button("Yadda saxla"));           // a double click's second press on «Öncədən baxın»
    expect(onSave).not.toHaveBeenCalled();
    armed();
    await press(button("Yadda saxla"));
    expect(onSave).toHaveBeenCalledWith([{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }], null);
    // An untouched time is the press's instant: the faked clock moved on with the arming window.
    expect(onSaved).toHaveBeenCalledWith({ atMs: NOW + SAVE_ARM_MS, rows: [
      { code: "resp_rate", value: 26, entry: 41 }, { code: "spo2", value: 91, entry: 42 }] });
    expect(toasted("REA-01 · 2: ölçmə yadda saxlanıldı.").length).toBeGreaterThan(0);
  });

  it("a change after the preview makes it old: «Yadda saxla» goes until it is previewed again", async () => {
    const { onPreview } = await open();
    type("SpO2", "91");
    await preview();
    type("SpO2", "92");
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(screen.getByText("Dəyərlər dəyişdi — yenidən öncədən baxın.")).toBeInTheDocument();
    expect(panel()).toBeNull();
    await preview();
    expect(onPreview).toHaveBeenCalledTimes(2);
  });

  it("sends a typed time as a UTC instant, and holds one ahead of the clock", async () => {
    const { onPreview } = await open();
    type("SpO2", "95");
    fireEvent.change(screen.getByLabelText("Ölçmə vaxtı"), { target: { value: toLocalInput(NOW + 10 * 60_000) } });
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("Ölçmə vaxtı irəlidə ola bilməz.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ölçmə vaxtı"), { target: { value: toLocalInput(NOW - 60 * 60_000) } });
    await preview();
    expect(onPreview).toHaveBeenCalledWith([{ code: "spo2", value: 95 }], new Date(NOW - 60 * 60_000).toISOString());
  });

  it("a discharged patient previews as dropped, and nothing is offered to save", async () => {
    await open({ preview: () => Promise.resolve({ patient_id: "S-001", preview: true, dropped: "discharged" }) });
    type("SpO2", "95");
    await preview();
    expect(screen.getByText("Bu xəstə evə yazılıb; ölçmə daxil edilmir.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
  });

  it("the engine's refusal of a save is on the toast, named after the bed, and the form stays", async () => {
    const { onSaved, onCancel } = await open({ save: () => Promise.reject(refusal(400, "entries[0]: bilinmeyen kod")) });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(toasted("REA-01 · 2: ölçmə yadda saxlanılmadı — entries[0]: bilinmeyen kod").length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(box("SpO2")).toHaveValue("95");
  });

  it("a save that got no answer may have landed: she is told to check, and the form is left", async () => {
    const { onSaved, onCancel } = await open({ save: () => Promise.reject(refusal(503, "down")) });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(toasted(/^REA-01 · 2: cavab gəlmədi/).length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("pairs each saved value with the row the door answered, and with none when an older engine answers none", () => {
    const asked = { entries: [{ code: "resp_rate", value: 26 }, { code: "spo2", value: 91 }], recordedAt: "2026-11-02T09:00:00.000Z" };
    expect(savedOf(asked, SAVED, NOW)).toEqual({ atMs: Date.parse("2026-11-02T09:00:00.000Z"),
      rows: [{ code: "resp_rate", value: 26, entry: 41 }, { code: "spo2", value: 91, entry: 42 }] });
    expect(savedOf({ ...asked, recordedAt: null }, { charted: 2 }, NOW))
      .toEqual({ atMs: NOW, rows: [{ code: "resp_rate", value: 26, entry: null }, { code: "spo2", value: 91, entry: null }] });
  });
});
