/**
 * The audit screen shows the hospital's record, not this browser's memory of it.
 *
 * The screen already existed — filters, date range, CSV export — and read the simulation's own
 * `auditLog`. On a live ward that meant an inspection would be shown what had happened in the
 * open tab, while the engine's append-only record sat unreachable. That is worse than having no
 * page: a page implies the record is what you are looking at.
 */
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { createBackendApi } from "./backendApi.js";

const RECORDS = [
  { id: 2, ts: "2026-09-08T09:05:00+00:00", tenant: "h1", event_type: "chart",
    patient_id: "bed-3", subject: "suspected_infection",
    payload: { value: 1.0, unit: "bool", charted_by: "dr-elif" } },
  { id: 1, ts: "2026-09-08T09:00:00+00:00", tenant: "h1", event_type: "ingest",
    patient_id: "bed-3", subject: "heart_rate",
    payload: { value: 118, unit: "/min", device: "nce" } },
  { id: 3, ts: "2026-09-08T09:10:00+00:00", tenant: "h1", event_type: "ack",
    patient_id: "bed-3", subject: "news2", payload: { by: "ayse", role: "CHARGE_NURSE" } },
];

function harness({ audit } = {}) {
  const api = {
    audit: audit || vi.fn(async () => ({ records: RECORDS })),
    boardPatients: vi.fn(async () => ({ patients: [] })),
    accessToken: () => "t", me: vi.fn(async () => ({})), logout: vi.fn(),
  };
  const base = {
    getState: () => ({ patients: [], alerts: [], auditLog: [{ action: "LOCAL", atMs: 1 }] }),
    subscribe: () => () => {},
  };
  return { store: createLiveStore({ api, base }), api };
}

describe("the engine's record replaces the local one", () => {
  it("fetches and shows what the engine holds", async () => {
    const { store } = harness();
    await store.refreshAudit();
    const rows = store.getState().auditLog;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.action)).toEqual(["ingest", "chart", "ack"]);
  });

  it("replaces rather than merges", async () => {
    // Mixing browser-local events into a legal record would make it impossible to say
    // afterwards which rows the engine actually holds.
    const { store } = harness();
    await store.refreshAudit();
    expect(store.getState().auditLog.some((r) => r.action === "LOCAL")).toBe(false);
  });

  it("orders oldest first, whatever order the API returned", async () => {
    const { store } = harness();
    await store.refreshAudit();
    const times = store.getState().auditLog.map((r) => r.atMs);
    expect([...times]).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("who did it", () => {
  it("a charted fact names the clinician", async () => {
    const { store } = harness();
    await store.refreshAudit();
    const chart = store.getState().auditLog.find((r) => r.action === "chart");
    expect(chart.actor).toBe("dr-elif");
  });

  it("an acknowledgement names the person who acknowledged", async () => {
    const { store } = harness();
    await store.refreshAudit();
    expect(store.getState().auditLog.find((r) => r.action === "ack").actor).toBe("ayse");
  });

  it("a device reading names the device, not a person", async () => {
    const { store } = harness();
    await store.refreshAudit();
    expect(store.getState().auditLog.find((r) => r.action === "ingest").actor).toBe("nce");
  });

  it("the target carries the patient and the subject", async () => {
    const { store } = harness();
    await store.refreshAudit();
    expect(store.getState().auditLog[0].target).toBe("bed-3 · heart_rate");
  });

  it("the actor is not repeated in the detail column", async () => {
    const { store } = harness();
    await store.refreshAudit();
    const chart = store.getState().auditLog.find((r) => r.action === "chart");
    expect(chart.detail).not.toMatch(/charted_by/);
    expect(chart.detail).toMatch(/value=1/);
  });
});

describe("when it cannot be fetched", () => {
  it("the failure surfaces rather than falling back silently to the local log", async () => {
    const { store } = harness({ audit: vi.fn(async () => { throw new Error("401"); }) });
    await expect(store.refreshAudit()).rejects.toThrow();
    // The local log is untouched — and the screen shows a warning saying so.
    expect(store.getState().auditLog[0].action).toBe("LOCAL");
  });

  it("a store with no audit capability does nothing rather than throwing", async () => {
    const api = { boardPatients: vi.fn(async () => ({ patients: [] })),
                  accessToken: () => "t", me: vi.fn(async () => ({})), logout: vi.fn() };
    const store = createLiveStore({
      api, base: { getState: () => ({ patients: [], alerts: [] }), subscribe: () => () => {} },
    });
    await expect(store.refreshAudit()).resolves.toBeNull();
  });
});

describe("the API client", () => {
  it("asks the right endpoint and passes filters through", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ records: [] }) };
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl });
    await api.audit({ patientId: "bed-3", eventType: "chart", limit: 50 });
    expect(calls[0]).toContain("/audit?");
    expect(calls[0]).toContain("patient_id=bed-3");
    expect(calls[0]).toContain("event_type=chart");
    expect(calls[0]).toContain("limit=50");
  });

  it("asks for the whole log when given no filters", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ records: [] }) };
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl });
    await api.audit();
    expect(calls[0]).not.toContain("patient_id");
  });
});
