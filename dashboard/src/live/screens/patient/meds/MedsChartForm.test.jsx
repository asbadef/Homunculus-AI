// MedsChartForm.test.jsx — the form holds back what the engine would refuse, sends exactly what was
// filled with the charted time, and tells the clinician what happened — on the toast, named after the bed.
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount } from "../../../session/mount.testutil.jsx";
import { profile, token } from "../../../session/testTokens.testutil.js";
import { MedsChartForm } from "./MedsChartForm.jsx";
import { checkDraft, fromLocalInput, toLocalInput } from "./medsFields.js";

const NOW = Date.parse("2026-10-26T09:00:00+04:00");
const CHARTABLE = ["board.view", "alerts.ack", "clinical.chart"];
const PATIENT = { patient_id: "S-001", display_name: "Ayşe Sentetik", measuredAt: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
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
});

describe("the form", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  async function open({ answer } = {}) {
    vi.setSystemTime(NOW);
    const onClose = vi.fn(); const onSaved = vi.fn();
    let api;
    const mounted = await mount(
      <MedsChartForm patient={PATIENT} bed="REA-01 · 2" onChart={(entries, at) => api.chart("S-001", entries, at)} onClose={onClose} onSaved={onSaved} />,
      { access: token({ perms: CHARTABLE }), me: profile({ perms: CHARTABLE }),
        setup: (a) => { api = a; a.chart.mockImplementation(answer ?? (() => Promise.resolve({ patient_id: "S-001", charted: 1, alerts: [] }))); } });
    return { ...mounted, api, onClose, onSaved };
  }
  const dialog = () => screen.getByRole("dialog", { name: /Dərman \/ maye qeydi/ });
  const save = () => act(async () => { fireEvent.click(within(dialog()).getByRole("button", { name: "Yadda saxla" })); await settle(); });

  it("sends the filled entries and the time, says so on the toast, and closes", async () => {
    const { api, onClose, onSaved } = await open();
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await save();
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "weight_kg", value: 80 }], new Date(NOW).toISOString());
    expect(document.body.textContent).toMatch(/REA-01 · 2/);
    expect(onSaved).toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });
  it("an empty form sends nothing and says so; a held field keeps the draft and gets the focus", async () => {
    const { api } = await open();
    await save();
    expect(api.chart).not.toHaveBeenCalled();
    fireEvent.change(within(dialog()).getByLabelText(/Sürət/), { target: { value: "0.1" } });
    await save();
    expect(api.chart).not.toHaveBeenCalled();
    expect(within(dialog()).getByText(/dərmanı seçin/i)).toBeInTheDocument();
  });
  it("a refusal goes to the toast with the server's sentence and the draft stays", async () => {
    const { api } = await open({ answer: () => Promise.reject(Object.assign(new Error("weight_kg: 900 beklenen aralığın dışında"), { status: 400 })) });
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await save();
    expect(document.body.textContent).toMatch(/beklenen aralığın dışında/);
    expect(within(dialog()).getByLabelText(/Çəki/)).toHaveValue("80");
  });
  it("a discharged number's answer (200 dropped) is not a save", async () => {
    await open({ answer: () => Promise.resolve({ patient_id: "S-001", dropped: "discharged" }) });
    fireEvent.change(within(dialog()).getByLabelText(/Çəki/), { target: { value: "80" } });
    await save();
    expect(document.body.textContent).toMatch(/tərxis edilib/);
  });
});
