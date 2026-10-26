// MedsChartForm.test.jsx — the form holds back what the engine would refuse, sends exactly what was
// filled with the charted time, and tells the clinician what happened — on the toast, named after the bed.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { MedsChartForm } from "./MedsChartForm.jsx";
import { checkDraft, fromLocalInput, toLocalInput } from "./medsFields.js";

const NOW = Date.parse("2026-10-26T09:00:00+04:00");
const MIN = 60_000;
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
// The fake-timer recipe of the earlier waves (common/useNow.test.jsx, auth/PasswordForm.test.jsx):
// installed BEFORE the mount, `Date` faked with them, nothing advancing on its own. `settle` yields one
// turn of the REAL event loop, so it works with the timers faked or not.
const realSetTimeout = globalThis.setTimeout;
const FAKE_TIMERS = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const draft = (over = {}) => ({ pressor: "", rate: "", bolus: "", weight: "", antibiotic: false, at: toLocalInput(NOW), ...over });

describe("checkDraft", () => {
  it("sends exactly the fields filled, with the charted time as an ISO instant", () => {
    const r = checkDraft(draft({ pressor: "norepinephrine", rate: "0,12", bolus: "500", antibiotic: true }), NOW);
    expect(r.errors).toEqual({});
    expect(r.entries).toEqual([{ code: "norepinephrine_rate", value: 0.12 }, { code: "crystalloid_bolus_ml", value: 500 }, { code: "antibiotic_administered", value: 1 }]);
    expect(Date.parse(r.recordedAt)).toBe(NOW);
  });
  it("a rate of 0 is an entry (stopped), an empty form is empty, a rate without a drug is held", () => {
    expect(checkDraft(draft({ pressor: "dopamine", rate: "0" }), NOW).entries).toEqual([{ code: "dopamine_rate", value: 0 }]);
    expect(checkDraft(draft(), NOW).empty).toBe(true);
    expect(checkDraft(draft({ rate: "0.1" }), NOW).errors.pressor.key).toBe("patient.medsRateNeedsPressor");
    expect(checkDraft(draft({ pressor: "dopamine" }), NOW).errors.rate.key).toBe("patient.medsPressorNeedsRate");
  });
  it("holds a slipped decimal before it is sent, with the door's bounds", () => {
    expect(checkDraft(draft({ pressor: "norepinephrine", rate: "25" }), NOW).errors.rate).toEqual({ key: "patient.medsOutOfRange", params: { low: 0, high: 20 } });
    expect(checkDraft(draft({ weight: "0.1" }), NOW).errors.weight.key).toBe("patient.medsOutOfRange");
    expect(checkDraft(draft({ bolus: "1e3" }), NOW).errors.bolus.key).toBe("patient.medsNotNumber");
  });
  it("refuses a future time and one older than 24 h, and tolerates a minute of skew", () => {
    expect(checkDraft(draft({ weight: "80", at: toLocalInput(NOW + 10 * 60_000) }), NOW).errors.at.key).toBe("patient.medsAtFuture");
    expect(checkDraft(draft({ weight: "80", at: toLocalInput(NOW - 25 * 3600_000) }), NOW).errors.at.key).toBe("patient.medsAtTooOld");
    expect(checkDraft(draft({ weight: "80", at: toLocalInput(NOW + 30_000) }), NOW).errors).toEqual({});
    expect(fromLocalInput("2026-10-26T09:00")).toBe(new Date("2026-10-26T09:00").getTime());
  });
  it("an empty or unreadable time is said as a time, not as a number (final review M3)", () => {
    expect(checkDraft(draft({ weight: "80", at: "" }), NOW).errors.at).toEqual({ key: "patient.medsAtInvalid" });
    expect(checkDraft(draft({ weight: "80", at: "26.10.2026 09:00" }), NOW).errors.at.key).toBe("patient.medsAtInvalid");
    expect(checkDraft(draft({ weight: "80", at: "" }), NOW).recordedAt).toBeNull();
  });
});

describe("the form", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open({ answer } = {}) {
    vi.setSystemTime(NOW);
    const onClose = vi.fn(); const onSaved = vi.fn();
    let api;
    const mounted = await mount(
      <MedsChartForm bed="REA-01 · 2" onChart={(entries, at) => api.chart("S-001", entries, at)} onClose={onClose} onSaved={onSaved} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
        setup: (a) => { api = a; a.chart.mockImplementation(answer ?? (() => Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [] }))); } });
    return { ...mounted, api, onClose, onSaved };
  }
  const dialog = () => screen.getByRole("dialog", { name: /Dərman \/ maye qeydi/ });
  const saveButton = () => within(dialog()).getByRole("button", { name: "Yadda saxla" });
  const save = () => act(async () => { fireEvent.click(saveButton()); await settle(); });
  const weight = (value) => fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value } });
  // The toast, not the dialog's title: both name the bed, and only the toast says what happened.
  const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

  it("sends the filled entries and the time, says so on the toast, and closes", async () => {
    const { api, onClose, onSaved } = await open();
    weight("80");
    await save();
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "weight_kg", value: 80 }], new Date(NOW).toISOString());
    expect(toasted("Yadda saxlanıldı: REA-01 · 2. Mühərrik bu xəstəni yenidən qiymətləndirdi.").length).toBeGreaterThan(0);
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });
  it("an empty form sends nothing and says so; a held field keeps the draft and gets the focus", async () => {
    const { api } = await open();
    // Said from the start, muted, so Save's aria-disabled has its reason before anything is pressed.
    const button = within(dialog()).getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Ən azı bir sahə doldurulmalıdır.");
    expect(within(dialog()).getByText("Ən azı bir sahə doldurulmalıdır.")).toHaveClass("text-mute");
    await save();
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(dialog()).getByText("Ən azı bir sahə doldurulmalıdır.")).toHaveClass("text-att-ink");
    fireEvent.change(within(dialog()).getByLabelText(/Sürət/), { target: { value: "0.1" } });
    await save();
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(/dərmanı seçin/i)).toBeInTheDocument();
    // A rate with no drug is the pressor's error, and the pressor is the first field wrong in the form's
    // order (weight, pressor, rate, bolus, antibiotic, at): the focus is on the select.
    expect(document.activeElement).toBe(within(dialog()).getByLabelText(/Vazopressor/));
  });
  it("a refusal goes to the toast with the server's sentence, the form stays open and the draft stays", async () => {
    const { onClose, onSaved } = await open({ answer: () => Promise.reject(Object.assign(new Error("weight_kg: 900 beklenen aralığın dışında"), { status: 400 })) });
    weight("80");
    await save();
    expect(toasted(/REA-01 · 2 üçün qeyd rədd edildi: .*beklenen aralığın dışında/).length).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    expect(within(dialog()).getByLabelText(/Çəki/)).toHaveValue("80");
  });
  it("a right taken away (403) is said in the box's words, and closes the form without a save", async () => {
    const { onClose, onSaved } = await open({ answer: () => Promise.reject(refusal(403, "permission required: clinical.chart")) });
    weight("80");
    await save();
    expect(toasted("REA-01 · 2 üçün qeyd rədd edildi: Bu hesabın qeyd etmə səlahiyyəti yoxdur.").length).toBeGreaterThan(0);
    expect(onClose).toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  });
  it("a write with no answer may have landed: said so, the box is told as for a save, and the form closes", async () => {
    // fetch() rejecting with no response at all — the request may have reached the engine (refusal.js).
    const { onClose, onSaved } = await open({ answer: () => Promise.reject(new TypeError("Failed to fetch")) });
    weight("80");
    await save();
    expect(toasted("REA-01 · 2 üçün qeyd cavab almadı; yadda saxlanılmış ola bilər — bir azdan Dərman və antibiotik qutusunu yoxlayın.").length).toBeGreaterThan(0);
    expect(toasted(/rədd edildi/)).toHaveLength(0);
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });
  it("two quick presses of Save send once", async () => {
    let release;
    const { api } = await open({ answer: () => new Promise((resolve) => { release = resolve; }) });
    weight("80");
    // Both inside one act: the second press beats the re-render that marks Save busy.
    await act(async () => { fireEvent.click(saveButton()); fireEvent.click(saveButton()); await settle(); });
    expect(api.chart).toHaveBeenCalledTimes(1);
    await act(async () => { release({ patient_id: "S-001", charted: 1, alerts: [] }); await settle(); });
    expect(api.chart).toHaveBeenCalledTimes(1);
  });
  it("a discharged number's answer (200 dropped) is not a save", async () => {
    await open({ answer: () => Promise.resolve({ patient_id: "S-001", dropped: "discharged" }) });
    weight("80");
    await save();
    expect(document.body.textContent).toMatch(/tərxis edilib/);
  });

  // Final review I2: the record time was read once, at the mount — a form opened at 14:00 and saved at
  // 15:30 charted 14:00. Until she edits it, it is the clock's: shown as it moves, and read at the press.
  describe("the record time", () => {
    const time = () => within(dialog()).getByLabelText(/Qeyd saatı/);

    it("untouched, it is the moment of saving: opened at NOW and saved 90 min later, it charts the save time", async () => {
      vi.useFakeTimers(FAKE_TIMERS);
      const { api } = await open();
      weight("80");
      act(() => { vi.setSystemTime(NOW + 90 * MIN); });      // the clock moved; no tick has run yet
      await save();
      expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "weight_kg", value: 80 }], new Date(NOW + 90 * MIN).toISOString());
    });
    it("untouched, the field shows the clock's minute as it moves", async () => {
      vi.useFakeTimers(FAKE_TIMERS);
      await open();
      expect(time()).toHaveValue(toLocalInput(NOW));
      act(() => { vi.advanceTimersByTime(MIN); });
      expect(time()).toHaveValue(toLocalInput(NOW + MIN));
    });
    it("typed, it is hers: edited to NOW − 2 h before the clock moves, it stays what was typed", async () => {
      vi.useFakeTimers(FAKE_TIMERS);
      const { api } = await open();
      weight("80");
      fireEvent.change(time(), { target: { value: toLocalInput(NOW - 120 * MIN) } });
      act(() => { vi.setSystemTime(NOW + 90 * MIN); vi.advanceTimersByTime(MIN); });   // and a tick runs
      expect(time()).toHaveValue(toLocalInput(NOW - 120 * MIN));
      await save();
      expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "weight_kg", value: 80 }], new Date(NOW - 120 * MIN).toISOString());
    });
  });
});
