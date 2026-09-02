import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";
import { ROLE } from "./clinicalDemo.js";

function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

const adminToken = tokenWith({ roles: { t1: "HOSPITAL_ADMIN" } });
const nurseToken = tokenWith({ roles: { t1: "CHARGE_NURSE" } });
const auditorToken = tokenWith({ roles: { t1: "AUDITOR" } });

/** Minimal stand-in for the simulation store the live store wraps. */
function fakeBase(extra = {}) {
  let state = { user: null, mfaPending: null, beds: ["bed-1"], ...extra };
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    admitPatient: vi.fn(() => "admitted"),
    logout: vi.fn(() => { state = { ...state, user: null }; }),
  };
}

function fakeApi({ login, me, verifyTotp } = {}) {
  return {
    login: login || vi.fn(async () => ({ access_token: adminToken, requires_mfa: false })),
    me: me || vi.fn(async () => ({ email: "admin@example.com", full_name: "Sistem Yöneticisi" })),
    verifyTotp: verifyTotp || vi.fn(async () => ({ access_token: adminToken, requires_mfa: false })),
    logout: vi.fn(),
  };
}

describe("liveStore — real authentication over the simulation", () => {
  it("opens a session from the backend and maps the role for the UI", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.attemptLogin("admin@example.com", "gizli");

    expect(api.login).toHaveBeenCalledWith("admin@example.com", "gizli");
    expect(store.getState().user).toEqual({
      email: "admin@example.com", full_name: "Sistem Yöneticisi", role: ROLE.HOSPITAL_ADMIN,
    });
  });

  it("maps a nurse account onto the nurse panel", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });

    await store.attemptLogin("hemsire@example.com", "gizli");

    expect(store.getState().user.role).toBe(ROLE.CHARGE_NURSE);
  });

  it("holds the session at the MFA gate when the backend demands it", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: adminToken, requires_mfa: true })) });
    const store = createLiveStore({ api, base: fakeBase() });

    const res = await store.attemptLogin("admin@example.com", "gizli");

    expect(res.mfaRequired).toBe(true);
    expect(store.getState().user).toBeNull();          // not signed in yet
    expect(store.getState().mfaPending).toMatchObject({ email: "admin@example.com" });
    expect(api.me).not.toHaveBeenCalled();
  });

  it("completes the session once the TOTP code verifies", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: adminToken, requires_mfa: true })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin@example.com", "gizli");

    await store.completeMfaLogin("123456");

    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
    expect(store.getState().user.role).toBe(ROLE.HOSPITAL_ADMIN);
    expect(store.getState().mfaPending).toBeNull();
  });

  it("REFUSES a role the UI cannot safely represent, and drops the tokens", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: auditorToken, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });

    await expect(store.attemptLogin("denetci@example.com", "gizli")).rejects.toThrow(/desteklenmiyor/i);
    expect(store.getState().user).toBeNull();
    expect(api.logout).toHaveBeenCalled();             // no half-open session left behind
  });

  it("refuses an account with no tenant role at all", async () => {
    const noRole = tokenWith({ sub: "u1" });
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: noRole, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });

    await expect(store.attemptLogin("bos@example.com", "gizli")).rejects.toThrow(/yetki/i);
    expect(store.getState().user).toBeNull();
  });

  it("surfaces the backend's own error message on a bad password", async () => {
    const api = fakeApi({
      login: vi.fn(async () => { throw new Error("Incorrect email or password"); }),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    await expect(store.attemptLogin("a@b.co", "yanlis")).rejects.toThrow(/Incorrect email or password/);
  });

  it("logging out clears the session and the tokens", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin@example.com", "gizli");

    store.logout();

    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it("notifies subscribers when the session changes", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const seen = vi.fn();
    store.subscribe(seen);

    await store.attemptLogin("admin@example.com", "gizli");

    expect(seen).toHaveBeenCalled();
  });

  it("delegates everything else to the simulation, which keeps working", async () => {
    // beds/alerts/devices/patients are deliberately NOT simulation passthrough (the overlay seeds
    // and owns them — see the "never shows the simulated ward" test in liveStore.live.test.js), so
    // this checks passthrough via a field the overlay never touches.
    const base = fakeBase({ structure: { units: ["unit-1"] } });
    const store = createLiveStore({ api: fakeApi(), base });

    expect(store.admitPatient({ name: "x" })).toBe("admitted");
    expect(base.admitPatient).toHaveBeenCalled();
    expect(store.getState().structure).toEqual({ units: ["unit-1"] }); // simulation state still visible
  });
});

describe("liveStore — session survives a page refresh", () => {
  it("restores the session from stored tokens instead of logging out", async () => {
    const api = fakeApi();
    api.accessToken = () => adminToken;
    const store = createLiveStore({ api, base: fakeBase() });

    const restored = await store.restoreSession();

    expect(restored).toBe(true);
    expect(api.login).not.toHaveBeenCalled();          // no password re-entry
    expect(store.getState().user).toMatchObject({ email: "admin@example.com" });
  });

  it("does nothing when no token was stored", async () => {
    const api = fakeApi();
    api.accessToken = () => null;
    const store = createLiveStore({ api, base: fakeBase() });

    expect(await store.restoreSession()).toBe(false);
    expect(api.me).not.toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it("clears stale tokens quietly when the backend refuses them", async () => {
    const api = fakeApi({ me: vi.fn(async () => { throw new Error("401"); }) });
    api.accessToken = () => adminToken;
    const store = createLiveStore({ api, base: fakeBase() });

    expect(await store.restoreSession()).toBe(false);
    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });
});

describe("liveStore — no setup theatre on a live deployment", () => {
  it("marks tenant setup complete so the wizard never gates a real clinician", () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });

    expect(store.getState().tenantSetup).toBe(true);
  });
});
