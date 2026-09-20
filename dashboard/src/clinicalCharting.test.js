/**
 * What a clinician charts must leave the browser.
 *
 * The finding: `addMedication`, `addFluid` and `addDiagnosis` wrote to the local store and
 * stopped there. On a live ward a physician could chart noradrenaline and a fluid bolus, and
 * the engine would never see either — so SOFA's cardiovascular limb read zero on a patient on
 * pressors, and "adequate fluid resuscitation" could never become true.
 */
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { createBackendApi } from "./backendApi.js";

/** A store whose API records what it was asked to send. */
function harness({ base = {} } = {}) {
  const sent = [];
  const api = {
    chart: vi.fn(async (patientId, entries) => {
      sent.push({ patientId, entries });
      return { patient_id: patientId, charted: entries.length, alerts: [] };
    }),
    boardPatients: vi.fn(async () => ({ patients: [] })),
    accessToken: () => "t",
    me: vi.fn(async () => ({ email: "a@b.com", full_name: "A" })),
    logout: vi.fn(),
  };
  const listeners = new Set();
  const baseStore = {
    getState: () => ({ patients: [], alerts: [] }),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    ...base,
  };
  return { store: createLiveStore({ api, base: baseStore }), api, sent };
}

describe("charting reaches the engine", () => {
  it("suspected infection is sent — the flag the whole sepsis branch waits on", async () => {
    const { store, sent } = harness();
    await store.setSuspectedInfection("bed-3", true);
    expect(sent).toEqual([{ patientId: "bed-3", entries: [{ code: "suspected_infection", value: 1 }] }]);
  });

  it("clearing it sends a zero rather than sending nothing", async () => {
    const { store, sent } = harness();
    await store.setSuspectedInfection("bed-3", false);
    expect(sent[0].entries[0].value).toBe(0);
  });

  it("a noradrenaline dose becomes the rate the rules score", async () => {
    const { store, sent } = harness();
    await store.addMedication({ patientId: "bed-3", name: "Noradrenalin", dose: 0.08 });
    expect(sent).toEqual([
      { patientId: "bed-3", entries: [{ code: "norepinephrine_rate", value: 0.08 }] },
    ]);
  });

  it("the drug name is matched regardless of how it was typed", async () => {
    const { store, sent } = harness();
    await store.addMedication({ patientId: "bed-3", name: "  DOPAMİN".replace("İ", "I"), dose: 6 });
    expect(sent[0].entries[0].code).toBe("dopamine_rate");
  });

  it("a drug the rules do not score is charted locally and not invented into a signal", async () => {
    const addMedication = vi.fn();
    const { store, sent } = harness({ base: { addMedication } });
    await store.addMedication({ patientId: "bed-3", name: "Parasetamol", dose: 1000 });
    expect(sent).toEqual([]);
    expect(addMedication).toHaveBeenCalled();
  });

  it("fluid IN is sent; fluid OUT is not — the rule asks what was given", async () => {
    const { store, sent } = harness();
    await store.addFluid({ patientId: "bed-3", kind: "in", ml: 1500 });
    await store.addFluid({ patientId: "bed-3", kind: "out", ml: 400 });
    expect(sent).toEqual([
      { patientId: "bed-3", entries: [{ code: "crystalloid_bolus_ml", value: 1500 }] },
    ]);
  });

  it("the local store still updates, so the screen answers immediately", async () => {
    const addFluid = vi.fn();
    const { store } = harness({ base: { addFluid } });
    await store.addFluid({ patientId: "bed-3", kind: "in", ml: 1500 });
    expect(addFluid).toHaveBeenCalledWith({ patientId: "bed-3", kind: "in", ml: 1500 });
  });

  it("the board is refreshed after charting, so the effect is visible", async () => {
    const { store, api } = harness();
    await store.setSuspectedInfection("bed-3", true);
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("an empty chart is not sent at all", async () => {
    const { store, api } = harness();
    await store.chart("bed-3", []);
    await store.chart("", [{ code: "gcs", value: 11 }]);
    expect(api.chart).not.toHaveBeenCalled();
  });
});

describe("the API client speaks the charting endpoint", () => {
  it("posts entries to /clinical/{id}", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ charted: 1 }) };
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl });
    await api.chart("bed 3", [{ code: "gcs", value: 11 }]);
    expect(calls[0].url).toContain("/clinical/bed%203");   // the id is escaped
    expect(calls[0].body).toEqual({ entries: [{ code: "gcs", value: 11 }] });
  });

  it("passes a recorded_at through when one is given", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl });
    await api.chart("bed-3", [{ code: "gcs", value: 11 }], "2026-09-08T09:00:00+00:00");
    expect(calls[0].recorded_at).toBe("2026-09-08T09:00:00+00:00");
  });
});

describe("admission carries weight and chronic conditions to the engine", () => {
  function admissionHarness({ setProfile, chartFn } = {}) {
    const sent = [];
    const profiles = [];
    const api = {
      chart: chartFn || vi.fn(async (patientId, entries) => { sent.push({ patientId, entries }); return {}; }),
      setProfile: setProfile || vi.fn(async (patientId, body) => { profiles.push({ patientId, body }); return {}; }),
      boardPatients: vi.fn(async () => ({ patients: [] })),
      accessToken: () => "t",
      me: vi.fn(async () => ({})),
      logout: vi.fn(),
    };
    const base = {
      getState: () => ({ patients: [], alerts: [] }),
      subscribe: () => () => {},
      admitPatient: vi.fn(() => ({ patient_id: "P-001", protocolNo: "PR-1" })),
    };
    return { store: createLiveStore({ api, base }), api, base, sent, profiles };
  }

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("stays synchronous — the form reads the protocol number on the same tick", () => {
    const { store } = admissionHarness();
    const p = store.admitPatient({ weight: 78 });
    expect(p.protocolNo).toBe("PR-1");   // not a Promise
  });

  it("a bed error still throws synchronously, so the form can show it", () => {
    const { store, base } = admissionHarness();
    base.admitPatient.mockImplementation(() => { throw new Error("Yatak bulunamadı."); });
    expect(() => store.admitPatient({})).toThrow("Yatak bulunamadı.");
  });

  it("weight becomes an observation — nothing can evaluate 30 mL/kg without it", async () => {
    const { store, sent } = admissionHarness();
    store.admitPatient({ weight: 78 });
    await settle();
    expect(sent).toEqual([{ patientId: "P-001", entries: [{ code: "weight_kg", value: 78 }] }]);
  });

  it("free-text chronic conditions become the patient's profile", async () => {
    const { store, profiles } = admissionHarness();
    store.admitPatient({ comorbidities: "DM, HT; KOAH" });
    await settle();
    expect(profiles).toEqual([
      { patientId: "P-001", body: { comorbidities: ["DM", "HT", "KOAH"] } },
    ]);
  });

  it("an empty comorbidity box sends no profile at all", async () => {
    const { store, api } = admissionHarness();
    store.admitPatient({ comorbidities: "   " });
    await settle();
    expect(api.setProfile).not.toHaveBeenCalled();
  });

  it("a failed side channel never undoes the admission", async () => {
    // The admission is the clinician's and has already succeeded; a POST that did not must
    // not take it back, and both of these can be charted again from the patient's screen.
    const { store } = admissionHarness({
      setProfile: vi.fn(async () => { throw new Error("network"); }),
      chartFn: vi.fn(async () => { throw new Error("network"); }),
    });
    const p = store.admitPatient({ weight: 78, comorbidities: "KOAH" });
    await settle();
    expect(p.protocolNo).toBe("PR-1");
  });
});
