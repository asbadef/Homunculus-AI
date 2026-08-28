import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { CONNECTION } from "./liveConnection.js";

function fakeBase() {
  const state = { patients: [{ patient_id: "SIMULATED", display_name: "Simüle Hasta" }] };
  return { getState: () => state, subscribe: () => () => {}, logout: () => {} };
}

function fakeApi(overrides = {}) {
  return {
    login: vi.fn(), verifyTotp: vi.fn(), me: vi.fn(), logout: vi.fn(),
    boardPatients: vi.fn(async () => ({ patients: [] })),
    streamTicket: vi.fn(async () => ({ ticket: "t", expires_in: 60 })),
    acknowledge: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("live store data layer", () => {
  it("replaces the simulated patients with what the API returned", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({
        patients: [{ patient_id: "bed-3", risk: "high", alerts: [],
                     latest: { heart_rate: 120 } }],
      })),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    const patients = store.getState().patients;
    expect(patients).toHaveLength(1);
    expect(patients[0].patient_id).toBe("bed-3");
    expect(patients[0].vitals.hr).toBe(120);
  });

  it("never falls back to simulated patients when the API fails", async () => {
    // The whole point: a clinician logged in with real credentials must not be shown invented
    // patients because a fetch failed.
    const api = fakeApi({ boardPatients: vi.fn(async () => { throw new Error("network"); }) });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    expect(store.getState().connection).toBe(CONNECTION.UNAVAILABLE);
    expect(store.getState().patients).toEqual([]);
    expect(JSON.stringify(store.getState().patients)).not.toContain("SIMULATED");
  });

  it("reports live with an empty board when there is genuinely nothing", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });

    await store.refreshBoard();

    expect(store.getState().connection).toBe(CONNECTION.LIVE);
    expect(store.getState().patients).toEqual([]);
  });

  it("acknowledges through the API and refreshes", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.acknowledgeAlert("bed-3", "sepsis", "nurse");

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis", "nurse");
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("asks for a fresh ticket before opening the stream", async () => {
    // The JWT must never reach the URL; the ticket is what goes there.
    const api = fakeApi();
    const opened = [];
    const store = createLiveStore({
      api, base: fakeBase(),
      openStream: (url) => { opened.push(url); return () => {}; },
    });

    await store.startLive();

    expect(api.streamTicket).toHaveBeenCalled();
    expect(opened[0]).toContain("ticket=t");
    expect(opened[0]).not.toMatch(/token=/);
  });

  it("notifies subscribers when the board changes", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const listener = vi.fn();
    store.subscribe(listener);

    await store.refreshBoard();

    expect(listener).toHaveBeenCalled();
  });

  it("starts out connecting, before anything has loaded", () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    expect(store.getState().connection).toBe(CONNECTION.CONNECTING);
  });
});
