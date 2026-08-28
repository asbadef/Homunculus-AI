import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { CONNECTION } from "./liveConnection.js";

function fakeBase(extra = {}) {
  const state = { patients: [{ patient_id: "SIMULATED", display_name: "Simüle Hasta" }], ...extra };
  return { getState: () => state, subscribe: () => () => {}, logout: () => {} };
}

/** Builds a JWT-shaped (unsigned — the store only ever decodes, never verifies, client-side)
 *  access token so a test can drive a real attemptLogin() and land a real role in overlay.user. */
function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}
const nurseToken = tokenWith({ roles: { t1: "NURSE" } });

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

  it("acknowledges through the API using the id AckModal actually sends, and refreshes", async () => {
    // AckModal calls store.acknowledgeAlert(alert.id, {reason, note}) and must not change — the
    // live store has to speak that call, not the other way round. The id round-trips
    // "<patient_id>::<kind>" (see alertsFromPatients); the role comes from the signed-in user.
    const api = fakeApi({
      login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })),
      me: vi.fn(async () => ({ email: "n@example.com", full_name: "Hemşire" })),
    });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("n@example.com", "pw");

    await store.acknowledgeAlert("bed-3::sepsis", { reason: "clinically_reviewed", note: "ok" });

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis", "CHARGE_NURSE");
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("acknowledges with role \"unknown\" rather than inventing one when nobody is signed in", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.acknowledgeAlert("bed-3::sepsis", { reason: "clinically_reviewed", note: "ok" });

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis", "unknown");
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

  it("never shows the simulated ward's beds/alerts/devices before the first refresh resolves", () => {
    // getState() spreads the overlay over the base's (simulated) state. Until the overlay seeds
    // its own beds/alerts/devices, the base's fabricated ward shows through for a moment right
    // after login — a clinician briefly sees a fake ward before the real board loads.
    const base = fakeBase({
      beds: ["SIMULATED-BED"], alerts: ["SIMULATED-ALERT"], devices: ["SIMULATED-DEVICE"],
    });
    const store = createLiveStore({ api: fakeApi(), base });

    expect(store.getState().beds).toEqual([]);
    expect(store.getState().alerts).toEqual([]);
    expect(store.getState().devices).toEqual([]);
  });

  it("synthesizes beds and alerts from the board on refresh, and clears the simulated devices", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({
        patients: [{ patient_id: "bed-3", risk: "high",
          alerts: [{ kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
                     acknowledged: false, escalated: false }],
          latest: { heart_rate: 120 } }],
      })),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    const state = store.getState();
    expect(state.beds).toEqual([{ id: "live-bed-bed-3", label: "bed-3", unitId: null,
      unitName: null, roomId: null, roomLabel: null, state: "OCCUPIED", patientId: "bed-3" }]);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].id).toBe("bed-3::sepsis");
    expect(state.devices).toEqual([]);
  });

  it("synthesizes alert firedAtSec using the simulation's own clockSec, not a raw Unix timestamp", async () => {
    // AlertCard computes elapsed against the SIMULATION's local clock (clockSec), not wall time —
    // the store has to hand alertsFromPatients that clock so a real alert's elapsed time and
    // next-step countdown read correctly instead of as a huge negative number.
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({
        patients: [{ patient_id: "bed-3", risk: "high",
          alerts: [{ kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
                     acknowledged: false, escalated: false, first_seen_at: null }],
          latest: { heart_rate: 120 } }],
      })),
    });
    const store = createLiveStore({ api, base: fakeBase({ clockSec: 500 }) });

    await store.refreshBoard();

    expect(store.getState().alerts[0].firedAtSec).toBe(500);
  });

  it("marks synthesized alerts as device-sourced", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({
        patients: [{ patient_id: "bed-3", risk: "high",
          alerts: [{ kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
                     acknowledged: false, escalated: false }],
          latest: { heart_rate: 120 } }],
      })),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    expect(store.getState().alerts[0].source).toBe("device");
  });

  it("empties beds and alerts along with patients when the board is unavailable", async () => {
    const api = fakeApi({ boardPatients: vi.fn(async () => { throw new Error("network"); }) });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.refreshBoard();

    const state = store.getState();
    expect(state.beds).toEqual([]);
    expect(state.alerts).toEqual([]);
    expect(state.devices).toEqual([]);
  });
});

describe("live store — SSE stream", () => {
  const boardOf = (patientId, extra = {}) => ({
    patient_id: patientId, risk: "stable", alerts: [], latest: { heart_rate: 80 }, ...extra,
  });

  /** A test double for `openStream` that records every call so a test can drive the handlers an
   *  EventSource would normally call — jsdom has no real SSE transport to fire them for us. */
  function fakeOpenStream() {
    const calls = [];
    const openStream = (url, handlers) => {
      const close = vi.fn();
      calls.push({ url, handlers, close });
      return close;
    };
    return { openStream, calls };
  }

  it("opening the stream moves the connection to LIVE via nextConnection, on onopen", async () => {
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api: fakeApi(), base: fakeBase(), openStream });

    await store.startLive();
    calls[0].handlers.onopen();

    expect(store.getState().connection).toBe(CONNECTION.LIVE);
  });

  it("a frame for a known patient updates that patient in place", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({ patients: [boardOf("bed-3", { latest: { heart_rate: 80 } })] })),
    });
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api, base: fakeBase(), openStream });
    await store.startLive();

    calls[0].handlers.onmessage({ data: JSON.stringify(boardOf("bed-3", { latest: { heart_rate: 140 } })) });

    const patients = store.getState().patients;
    expect(patients).toHaveLength(1);
    expect(patients[0].vitals.hr).toBe(140);
  });

  it("a frame for a new patient appends it, and refreshes the synthesized beds/alerts", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({ patients: [boardOf("bed-3")] })),
    });
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api, base: fakeBase(), openStream });
    await store.startLive();

    calls[0].handlers.onmessage({ data: JSON.stringify(boardOf("bed-9")) });

    const state = store.getState();
    expect(state.patients.map((p) => p.patient_id).sort()).toEqual(["bed-3", "bed-9"]);
    expect(state.beds.map((b) => b.patientId).sort()).toEqual(["bed-3", "bed-9"]);
  });

  it("a frame's synthesized alert also uses the simulation's clockSec for firedAtSec", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({ patients: [boardOf("bed-3")] })),
    });
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api, base: fakeBase({ clockSec: 700 }), openStream });
    await store.startLive();

    calls[0].handlers.onmessage({ data: JSON.stringify(boardOf("bed-3", {
      alerts: [{ kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
                 acknowledged: false, escalated: false, first_seen_at: null }],
    })) });

    expect(store.getState().alerts[0].firedAtSec).toBe(700);
  });

  it("a malformed frame does not crash and does not clear the board", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({ patients: [boardOf("bed-3")] })),
    });
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api, base: fakeBase(), openStream });
    await store.startLive();

    expect(() => calls[0].handlers.onmessage({ data: "not json" })).not.toThrow();

    const patients = store.getState().patients;
    expect(patients).toHaveLength(1);
    expect(patients[0].patient_id).toBe("bed-3");
  });

  it("a frame with no patient id is dropped rather than added as a phantom row", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({ patients: [boardOf("bed-3")] })),
    });
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api, base: fakeBase(), openStream });
    await store.startLive();

    calls[0].handlers.onmessage({ data: JSON.stringify({}) });

    expect(store.getState().patients).toHaveLength(1);
  });

  it("onerror moves the connection to DEGRADED", async () => {
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api: fakeApi(), base: fakeBase(), openStream });
    await store.startLive();

    calls[0].handlers.onerror();

    expect(store.getState().connection).toBe(CONNECTION.DEGRADED);
  });

  it("closes the dropped stream immediately on error, before scheduling the reconnect", async () => {
    // A native EventSource auto-retries on its own, with its original — already spent — single-use
    // ticket. Leaving it open means an abandoned connection keeps hitting /stream with a dead
    // ticket (401 noise, a held connection) alongside the new one that actually works.
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api: fakeApi(), base: fakeBase(), openStream });
    await store.startLive();

    calls[0].handlers.onerror();

    expect(calls[0].close).toHaveBeenCalled();
  });

  it("reconnects ~5s after an error by requesting a brand-new ticket", async () => {
    // Tickets are single-use: the old stream URL can never work again, so a reconnect MUST fetch
    // a fresh ticket rather than retry the same EventSource url.
    vi.useFakeTimers();
    try {
      const api = fakeApi({
        streamTicket: vi.fn()
          .mockResolvedValueOnce({ ticket: "t1", expires_in: 60 })
          .mockResolvedValueOnce({ ticket: "t2", expires_in: 60 }),
      });
      const { openStream, calls } = fakeOpenStream();
      const store = createLiveStore({ api, base: fakeBase(), openStream });
      await store.startLive();
      expect(api.streamTicket).toHaveBeenCalledTimes(1);
      expect(calls[0].url).toContain("ticket=t1");

      calls[0].handlers.onerror();
      await vi.advanceTimersByTimeAsync(5000);

      expect(api.streamTicket).toHaveBeenCalledTimes(2);
      expect(calls).toHaveLength(2);
      expect(calls[1].url).toContain("ticket=t2");
      expect(calls[1].url).not.toBe(calls[0].url);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closing what startLive() returns cancels a pending reconnect", async () => {
    vi.useFakeTimers();
    try {
      const api = fakeApi();
      const { openStream, calls } = fakeOpenStream();
      const store = createLiveStore({ api, base: fakeBase(), openStream });
      const close = await store.startLive();

      calls[0].handlers.onerror();
      close();
      await vi.advanceTimersByTimeAsync(5000);

      expect(api.streamTicket).toHaveBeenCalledTimes(1); // no reconnect after close
      expect(calls[0].close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
