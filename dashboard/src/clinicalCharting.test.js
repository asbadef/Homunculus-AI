/**
 * What a clinician charts must leave the browser.
 *
 * The finding: `addMedication`, `addFluid` and `addDiagnosis` wrote to the local store and
 * stopped there. On a live ward a physician could chart noradrenaline and a fluid bolus, and
 * the engine would never see either — so SOFA's cardiovascular limb read zero on a patient on
 * pressors, and "adequate fluid resuscitation" could never become true.
 *
 * On the LDAP/RBAC branch the live store keeps refusing the simulation's medication, fluid and
 * admission actions (SIMULATION_ONLY: they wrote to the simulated ward). Main's tests of those
 * live overrides were removed in the merge; what they asked for is listed in the design
 * roadmap (docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md) for the new
 * shell, which charts through `chart()` below.
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
