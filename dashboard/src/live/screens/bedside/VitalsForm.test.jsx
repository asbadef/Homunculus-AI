// VitalsForm.test.jsx — the bedside form sends what was entered and only that, previews before it saves, holds a
// slipped digit back under its box, and says what happened on the toast, named after the bed (G3-01).
// Synthetic values only.
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { news2 } from "../../data/board.testutil.js";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
import { SAVE_ARM_MS, VitalsForm, savedOf } from "./VitalsForm.jsx";
import { BACKDATE_MS, toLocalInput } from "./vitalsFields.js";

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

// A host as the page and the patient screen's dialog are: the saved step takes the form's place on `onSaved`, in
// the very render that clears the form's busy, and «leave» takes the form away while a request may be in flight.
function Host({ onSaved, ...props }) {
  const [step, setStep] = useState("form");
  if (step !== "form") return <p>{step}</p>;
  return (
    <>
      <VitalsForm bed={BED} nowMs={NOW} {...props} onSaved={(saved) => { onSaved(saved); setStep("saved step"); }} />
      <button type="button" onClick={() => setStep("left")}>leave</button>
    </>
  );
}

async function open({ preview = () => Promise.resolve(PREVIEW), save = () => Promise.resolve(SAVED) } = {}) {
  vi.useFakeTimers(FAKE_TIMERS);
  vi.setSystemTime(NOW);
  const onPreview = vi.fn(preview);
  const onSave = vi.fn(save);
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const onBusy = vi.fn();
  await act(async () => {
    await mount(
      <Host onPreview={onPreview} onSave={onSave} onSaved={onSaved} onCancel={onCancel} onBusy={onBusy} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }) });
    await settle();
  });
  return { onPreview, onSave, onSaved, onCancel, onBusy };
}
/** A request whose answer the test gives, when it says so. */
function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
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
// The form's own polite live region (the toasts speak from theirs, outside the form), once its delay has passed.
const heard = () => act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS); });
const spoken = () => within(document.querySelector("form")).getByRole("status");
const answer = (body) => () => Promise.resolve({ patient_id: "S-001", preview: true, at: new Date(NOW).toISOString(), news2: news2(body) });

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bedside form", () => {
  it("sends nothing from an empty form, and says why", async () => {
    const { onPreview } = await open();
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("Ən azı bir dəyər daxil edin.")).toBeInTheDocument();
    heard();                                       // no box to take the focus to: the sentence is spoken instead
    expect(spoken()).toHaveTextContent("Ən azı bir dəyər daxil edin.");
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
    expect(screen.getByText("Ölçmə vaxtı gələcəkdə ola bilməz.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ölçmə vaxtı"), { target: { value: toLocalInput(NOW - 60 * 60_000) } });
    await preview();
    expect(onPreview).toHaveBeenCalledWith([{ code: "spo2", value: 95 }], new Date(NOW - 60 * 60_000).toISOString());
  });

  // G3-01, review of Task 12: the picker's `min` is checkDraft's own edge (a day back plus the minute of skew), so the
  // oldest time the box offers is one the form takes, and the minute below it is the first the form refuses.
  it("the time box's minimum is the edge the form's own check holds, not the day itself", async () => {
    const { onPreview } = await open();
    const input = screen.getByLabelText("Ölçmə vaxtı");
    expect(input.getAttribute("min")).toBe(toLocalInput(NOW - BACKDATE_MS + 60_000));
    expect(input.getAttribute("max")).toBe(toLocalInput(NOW));
    type("SpO2", "95");
    fireEvent.change(input, { target: { value: input.getAttribute("min") } });
    await preview();
    expect(onPreview).toHaveBeenCalledWith([{ code: "spo2", value: 95 }], new Date(NOW - BACKDATE_MS + 60_000).toISOString());
    onPreview.mockClear();
    fireEvent.change(input, { target: { value: toLocalInput(NOW - BACKDATE_MS) } });
    await preview();
    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByText("Ölçmə vaxtı ən çox 24 saat geriyə çəkilə bilər.")).toBeInTheDocument();
  });

  it("a discharged patient previews as dropped, and nothing is offered to save", async () => {
    const { onPreview } = await open({ preview: () => Promise.resolve({ patient_id: "S-001", preview: true, dropped: "discharged" }) });
    type("SpO2", "95");
    await preview();
    expect(within(document.querySelector("form")).getByRole("note")).toHaveTextContent("Bu xəstə evə yazılıb; ölçmə daxil edilmir.");
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    heard();
    expect(spoken()).toHaveTextContent("Bu xəstə evə yazılıb; ölçmə daxil edilmir.");
    // «Öncədən baxın» says it is held (aria-disabled), and a press on it sends nothing again.
    expect(button("Öncədən baxın")).toHaveAttribute("aria-disabled", "true");
    await preview();
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("a re-preview that fails does not speak the old NEWS2 again", async () => {
    let calls = 0;
    await open({ preview: () => (++calls === 1 ? Promise.resolve(PREVIEW) : Promise.reject(refusal(503, "down"))) });
    type("SpO2", "91");
    await preview();
    heard();
    expect(spoken()).toHaveTextContent("Öncədən baxış hazırdır: NEWS2 5.");
    type("SpO2", "92");
    await preview();
    heard();
    expect(spoken()).not.toHaveTextContent("hazırdır");
    expect(toasted(/^REA-01 · 2: öncədən baxış alınmadı/).length).toBeGreaterThan(0);
  });

  it("a held box makes the preview old: «Yadda saxla» goes while any box has a problem", async () => {
    await open();
    type("SpO2", "91");
    await preview();
    type("Tənəffüs", "800");
    expect(screen.getByText("0–80 aralığında olmalıdır.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(panel()).toBeNull();
  });

  it("an undone change brings «Yadda saxla» back held, as when it first appeared", async () => {
    const { onSave } = await open();
    type("SpO2", "91");
    await preview();
    armed();
    type("SpO2", "92");
    type("SpO2", "91");                            // the preview is fresh again, and «Yadda saxla» is back
    await press(button("Yadda saxla"));
    expect(onSave).not.toHaveBeenCalled();
    armed();
    await press(button("Yadda saxla"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("ignores a double click's second press on «Yadda saxla», even once armed", async () => {
    const { onSave } = await open();
    type("SpO2", "95");
    await preview();
    armed();
    await act(async () => { fireEvent.click(button("Yadda saxla"), { detail: 2 }); await settle(); });
    expect(onSave).not.toHaveBeenCalled();
    await press(button("Yadda saxla"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("tells its host the request is over, even when the save's answer takes the form away", async () => {
    const save = deferred();
    const { onBusy } = await open({ save: () => save.promise });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(onBusy).toHaveBeenLastCalledWith(true);
    await act(async () => { save.resolve(SAVED); await settle(); });
    expect(screen.getByText("saved step")).toBeInTheDocument();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it("a save answered after the form was left still says so on the toast, and calls no host back", async () => {
    const save = deferred();
    const { onSaved, onCancel } = await open({ save: () => save.promise });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    await press(button("leave"));
    await act(async () => { save.resolve(SAVED); await settle(); });
    expect(toasted("REA-01 · 2: ölçmə yadda saxlanıldı.").length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("a preview refused after the form was left calls no host back and says nothing", async () => {
    const asked = deferred();
    const { onCancel } = await open({ preview: () => asked.promise });
    type("SpO2", "95");
    await preview();
    await press(button("leave"));
    await act(async () => { asked.reject(refusal(403, "Permission required: clinical.chart")); await settle(); });
    expect(onCancel).not.toHaveBeenCalled();
    expect(toasted(/^REA-01 · 2:/)).toHaveLength(0);
  });

  it("a 403 on the preview leaves the form, and says she has no right", async () => {
    const { onCancel } = await open({ preview: () => Promise.reject(refusal(403, "Permission required: clinical.chart")) });
    type("SpO2", "95");
    await preview();
    expect(toasted("REA-01 · 2: öncədən baxış alınmadı — ölçmə daxil etmək hüququnuz yoxdur").length).toBeGreaterThan(0);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a 403 on the save leaves the form, and says she has no right", async () => {
    const { onSaved, onCancel } = await open({ save: () => Promise.reject(refusal(403, "Permission required: clinical.chart")) });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(toasted("REA-01 · 2: ölçmə yadda saxlanılmadı — ölçmə daxil etmək hüququnuz yoxdur").length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a save the engine answers as dropped says the patient was discharged, and leaves the form", async () => {
    const { onSaved, onCancel } = await open({ save: () => Promise.resolve({ patient_id: "S-001", dropped: "discharged" }) });
    type("SpO2", "95");
    await preview();
    armed();
    await press(button("Yadda saxla"));
    expect(toasted("REA-01 · 2: xəstə evə yazılıb; ölçmə yadda saxlanılmadı.").length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("an answer that is not a preview is refused on the toast, and nothing is offered to save", async () => {
    await open({ preview: () => Promise.resolve({ patient_id: "S-001", charted: 1 }) });
    type("SpO2", "95");
    await preview();
    expect(toasted("REA-01 · 2: öncədən baxış alınmadı — mühərrikin cavabı öncədən baxış deyildi").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Yadda saxla" })).toBeNull();
    expect(panel()).toBeNull();
  });

  it("names what is past its window with what is missing, in NEWS2's order", async () => {
    await open({ preview: answer({ total: 1, partial: true, missing: ["pulse"], stale: ["respiration_rate"],
      breakdown: { spo2: 1 } }) });
    type("SpO2", "95");
    await preview();
    expect(within(panel()).getByText("Qismən bal: tənəffüs tezliyi, nəbz daxil edilməyib və ya cari deyil.")).toBeInTheDocument();
  });

  it("a complete score that no value brings points to says both", async () => {
    await open({ preview: answer({ total: 0, breakdown: { respiration_rate: 0, spo2: 0 } }) });
    type("SpO2", "97");
    await preview();
    expect(within(panel()).getByText("Tam bal: çatışmayan ölçmə yoxdur.")).toBeInTheDocument();
    expect(within(panel()).getByText("Heç bir dəyər bal gətirmir.")).toBeInTheDocument();
    expect(within(panel()).queryByRole("list")).toBeNull();
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
