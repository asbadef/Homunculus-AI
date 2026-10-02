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
const nurseToken = tokenWith({ tenant: "t1", groups: ["nurse"], perms: ["board.view", "alerts.ack"] });

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
  it("removes an expired identity-only card from the live board", async () => {
    let handlers;
    const api = fakeApi({ boardPatients: vi.fn(async () => ({
      patients: [{ patient_id: "P-1", risk: "none", alerts: [], latest: {} }],
    })) });
    const store = createLiveStore({ api, base: fakeBase(), openStream: (_url, value) => {
      handlers = value;
      return () => {};
    } });
    const stop = await store.startLive();
    expect(store.getState().patients).toHaveLength(1);
    handlers.onmessage({ data: JSON.stringify({ patient_id: "P-1", removed: true }) });
    expect(store.getState().patients).toEqual([]);
    expect(store.getState().beds).toEqual([]);
    stop();
  });
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
    // "<patient_id>::<kind>" (see alertsFromPatients); the actor is attributed by the API from the token.
    const api = fakeApi({
      login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })),
      me: vi.fn(async () => ({ email: "n@example.com", full_name: "Hemşire" })),
    });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("n@example.com", "pw");

    await store.acknowledgeAlert("bed-3::sepsis", { reason: "clinically_reviewed", note: "ok" });

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis");
    expect(api.boardPatients).toHaveBeenCalled();
  });

  it("acknowledges without inventing an actor when nobody is signed in", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.acknowledgeAlert("bed-3::sepsis", { reason: "clinically_reviewed", note: "ok" });

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis");
  });

  it("a refused acknowledgement reaches the caller with the API's message", async () => {
    // 403 "permission required: alerts.ack" is shown to the clinician, never swallowed; nothing
    // was acknowledged, so the board is not reloaded as if it had been.
    const api = fakeApi({
      acknowledge: vi.fn(async () => { throw Object.assign(new Error("permission required: alerts.ack"), { status: 403 }); }),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await expect(store.acknowledgeAlert("bed-3::sepsis", { reason: "clinically_reviewed" }))
      .rejects.toThrow("permission required: alerts.ack");
    expect(api.boardPatients).not.toHaveBeenCalled();
  });

  it("resolves once the API took the acknowledgement, without waiting for the board to reload", async () => {
    // A slow or stalled board reload must not keep the dialog waiting on an ack already taken.
    let answerBoard;
    const api = fakeApi({
      boardPatients: vi.fn(() => new Promise((resolve) => { answerBoard = resolve; })),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.acknowledgeAlert("bed-3::sepsis");

    expect(api.acknowledge).toHaveBeenCalledWith("bed-3", "sepsis");
    expect(api.boardPatients).toHaveBeenCalledTimes(1);    // started, still in flight
    answerBoard({ patients: [] });
  });

  it("ends the session when a call finds the session ended, instead of a tokenless app", async () => {
    // backendApi marks a refresh the server refused `sessionEnded` and has already dropped the
    // tokens; the UI must go back to the login screen, not sit at "reconnecting".
    const ended = () => Object.assign(new Error("Invalid or expired refresh token"),
      { status: 401, sessionEnded: true });
    const api = fakeApi({
      login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })),
      me: vi.fn(async () => ({ id: "u-n", email: "n@example.com", full_name: "Hemşire" })),
      acknowledge: vi.fn(async () => { throw ended(); }),
    });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("n@example.com", "pw");

    await expect(store.acknowledgeAlert("bed-3::sepsis")).rejects.toThrow("refresh token");

    expect(store.getState().user).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("a board load that finds the session ended signs out too", async () => {
    const api = fakeApi({
      login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })),
      me: vi.fn(async () => ({ id: "u-n", email: "n@example.com", full_name: "Hemşire" })),
      boardPatients: vi.fn(async () => {
        throw Object.assign(new Error("Oturum süresi doldu, tekrar giriş yapın."), { status: 401, sessionEnded: true });
      }),
    });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("n@example.com", "pw");

    await store.refreshBoard();

    expect(store.getState().user).toBeNull();
    expect(store.getState().patients).toEqual([]);
  });

  it("a server that does not answer never signs the clinician out", async () => {
    const timeout = () => Object.assign(new Error("Sunucu yanıt vermedi"), { code: "REQUEST_TIMEOUT" });
    const api = fakeApi({
      login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })),
      me: vi.fn(async () => ({ id: "u-n", email: "n@example.com", full_name: "Hemşire" })),
      acknowledge: vi.fn(async () => { throw timeout(); }),
      boardPatients: vi.fn(async () => { throw timeout(); }),
    });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("n@example.com", "pw");

    await expect(store.acknowledgeAlert("bed-3::sepsis")).rejects.toThrow("yanıt vermedi");
    await store.refreshBoard();

    expect(store.getState().user).not.toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
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

  it("dates a real alert by the backend's first-seen instant, never by the simulation's clock", async () => {
    // The simulation's clock runs at 60x; a real alarm timed on it aged a minute per second.
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({
        patients: [{ patient_id: "bed-3", risk: "high",
          alerts: [{ kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
                     acknowledged: false, escalated: false, first_seen_at: "2026-09-25T10:00:00Z" }],
          latest: { heart_rate: 120 } }],
      })),
    });
    const store = createLiveStore({ api, base: fakeBase({ clockSec: 500 }) });

    await store.refreshBoard();

    expect(store.getState().alerts[0].firstSeenAtMs).toBe(Date.parse("2026-09-25T10:00:00Z"));
    expect(store.getState().alerts[0].firedAtSec).toBeNull();
  });

  it("stops the simulation's clock, its auto-alarm engine and its reconcile loop", () => {
    const reconcile = vi.fn();
    const base = { ...fakeBase({ running: true, autoAlarm: true, speed: 60, clockSec: 5 }), reconcile };
    const store = createLiveStore({ api: fakeApi(), base });
    expect(store.getState().running).toBe(false);
    expect(store.getState().autoAlarm).toBe(false);
    store.reconcile(9999);
    expect(reconcile).not.toHaveBeenCalled();
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

  it("a frame's synthesized alert is dated by its first-seen instant too", async () => {
    const api = fakeApi({
      boardPatients: vi.fn(async () => ({ patients: [boardOf("bed-3")] })),
    });
    const { openStream, calls } = fakeOpenStream();
    const store = createLiveStore({ api, base: fakeBase({ clockSec: 700 }), openStream });
    await store.startLive();

    calls[0].handlers.onmessage({ data: JSON.stringify(boardOf("bed-3", {
      alerts: [{ kind: "sepsis", severity: "high", urgency: "immediate", summary: "NEWS2 9",
                 acknowledged: false, escalated: false, first_seen_at: "2026-09-25T10:00:00Z" }],
    })) });

    expect(store.getState().alerts[0].firstSeenAtMs).toBe(Date.parse("2026-09-25T10:00:00Z"));
    expect(store.getState().alerts[0].firedAtSec).toBeNull();
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

  it("a stream ticket the server cannot give leaves the board DEGRADED, not LIVE, and retries once", async () => {
    // refreshBoard() has just set LIVE; without a ticket no stream opens and the board would
    // freeze under a LIVE indicator. 503 is what /stream-ticket answers when the scope cannot be read.
    vi.useFakeTimers();
    try {
      const unavailable = Object.assign(new Error("Kapsam okunamadı"), { status: 503 });
      const api = fakeApi({
        streamTicket: vi.fn()
          .mockRejectedValueOnce(unavailable)
          .mockResolvedValueOnce({ ticket: "t2", expires_in: 60 }),
      });
      const { openStream, calls } = fakeOpenStream();
      const store = createLiveStore({ api, base: fakeBase(), openStream });

      const close = await store.startLive();             // resolves: the failure is handled

      expect(store.getState().connection).toBe(CONNECTION.DEGRADED);
      expect(calls).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(1);                // exactly one reconnect scheduled

      await vi.advanceTimersByTimeAsync(5000);
      expect(api.streamTicket).toHaveBeenCalledTimes(2);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("ticket=t2");
      calls[0].handlers.onopen();
      expect(store.getState().connection).toBe(CONNECTION.LIVE);
      expect(vi.getTimerCount()).toBe(0);
      close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a ticket refused because the session ended signs out and schedules no reconnect", async () => {
    vi.useFakeTimers();
    try {
      const api = fakeApi({
        login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })),
        me: vi.fn(async () => ({ id: "u-n", email: "n@example.com", full_name: "Hemşire" })),
        streamTicket: vi.fn(async () => {
          throw Object.assign(new Error("Oturum süresi doldu"), { status: 401, sessionEnded: true });
        }),
      });
      const store = createLiveStore({ api, base: fakeBase(), openStream: () => () => {} });
      await store.attemptLogin("n@example.com", "pw");

      await store.startLive();

      expect(store.getState().user).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a ticket failure after close() schedules nothing and opens nothing", async () => {
    vi.useFakeTimers();
    try {
      let failTicket;
      const api = fakeApi({
        streamTicket: vi.fn()
          .mockResolvedValueOnce({ ticket: "t1", expires_in: 60 })
          .mockImplementationOnce(() => new Promise((_, reject) => { failTicket = reject; })),
      });
      const { openStream, calls } = fakeOpenStream();
      const store = createLiveStore({ api, base: fakeBase(), openStream });
      const close = await store.startLive();

      calls[0].handlers.onerror();
      await vi.advanceTimersByTimeAsync(5000);           // the reconnect asks for a ticket…
      close();                                           // …and the screen goes away meanwhile
      failTicket(Object.assign(new Error("down"), { status: 502 }));
      await vi.advanceTimersByTimeAsync(10000);

      expect(api.streamTicket).toHaveBeenCalledTimes(2);
      expect(calls).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
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
