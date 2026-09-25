// dashboard/src/liveStore.test.js
import { describe, it, expect, vi } from "vitest";
import { createLiveStore, SESSION_UNREACHABLE } from "./liveStore.js";
import { ROLE } from "./clinicalDemo.js";
import { accessProblem } from "./liveAuth.js";
import { PERMISSION_KEYS } from "./permissions.js";

// accessProblem is wrapped (it keeps its real behaviour) so one test can make it answer a reason
// code that does not exist yet, and prove the store refuses codes it has never heard of.
vi.mock("./liveAuth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, accessProblem: vi.fn(actual.accessProblem) };
});

/** An unsigned JWT-shaped token — the client only decodes the payload. Synthetic data only. */
function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

/** An error shaped like the ones backendApi throws: the API's message, plus the HTTP status and,
 *  when a refused refresh dropped the tokens, `sessionEnded`. */
function apiError(message, props = {}) {
  return Object.assign(new Error(message), props);
}

// The system group holds the whole catalogue (the backend's rule at token issuance).
const ADMIN_PERMS = [...PERMISSION_KEYS];
const adminToken = tokenWith({ tenant: "t1", groups: ["hospital_admin"], perms: ADMIN_PERMS });
const nurseToken = tokenWith({ tenant: "t1", groups: ["nurse"], perms: ["board.view", "alerts.ack", "admissions.admit"] });
const biomedToken = tokenWith({ tenant: "t1", groups: ["biomedical"], perms: ["devices.manage"] });
const mfaToken = tokenWith({ tenant: "t1", groups: ["hospital_admin"], perms: ADMIN_PERMS, mfa_required: true, mfa_verified: false });

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

const ME = { id: "u-admin", email: "admin@example.com", username: "admin", full_name: "Sistem Yöneticisi",
             groups: [{ slug: "hospital_admin", name: "Sistem Yöneticisi" }], totp_enabled: false };

function fakeApi({ login, me, verifyTotp, setupTotp, accessToken, changePassword } = {}) {
  return {
    login: login || vi.fn(async () => ({ access_token: adminToken, requires_mfa: false, mfa_enrolled: false })),
    me: me || vi.fn(async () => ME),
    verifyTotp: verifyTotp || vi.fn(async () => ({ access_token: adminToken, requires_mfa: false, mfa_enrolled: true })),
    setupTotp: setupTotp || vi.fn(async () => ({
      provisioning_uri: "otpauth://totp/Homunculus:admin?secret=JBSWY3DPEHPK3PXP&issuer=Homunculus",
    })),
    accessToken: accessToken || vi.fn(() => null),
    changePassword: changePassword || vi.fn(async () => ({ access_token: adminToken })),
    logout: vi.fn(),
  };
}

describe("liveStore — real authentication over the simulation", () => {
  it("opens a session carrying the token's perms and groups", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await store.attemptLogin("admin", "gizli");

    expect(api.login).toHaveBeenCalledWith("admin", "gizli");
    expect(store.getState().user).toEqual({
      id: "u-admin", email: "admin@example.com", username: "admin", full_name: "Sistem Yöneticisi",
      role: ROLE.HOSPITAL_ADMIN, perms: ADMIN_PERMS, groups: ["hospital_admin"],
      groupNames: ["Sistem Yöneticisi"], tenant: "t1",
    });
    expect(store.getState().live).toBe(true);
  });

  it("derives a display role from perms for a nurse", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: nurseToken, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("ayse", "gizli");
    expect(store.getState().user.role).toBe(ROLE.CHARGE_NURSE);
    expect(store.getState().user.perms).toContain("admissions.admit");
  });

  it("holds the session at the MFA gate and says whether the user is enrolled", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: false })) });
    const store = createLiveStore({ api, base: fakeBase() });

    const res = await store.attemptLogin("admin", "gizli");

    expect(res).toEqual({ mfaRequired: true, enrolled: false });
    expect(store.getState().user).toBeNull();
    expect(store.getState().mfaPending).toMatchObject({
      email: "admin", full_name: "Sistem Yöneticisi", enrolled: false, live: true,
      groupNames: ["Sistem Yöneticisi"],
    });
  });

  it("completes the session once the TOTP code verifies", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: true })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");

    await store.completeMfaLogin(" 123456 ");

    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
    expect(store.getState().user.perms).toEqual(ADMIN_PERMS);
    expect(store.getState().mfaPending).toBeNull();
  });

  it.each([
    [401, "Invalid TOTP code"],
    [401, "Bu kod zaten kullanıldı; yeni kodu bekleyin."],
    [429, "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin."],
  ])("a refused code (%i) keeps the gate and the tokens, and shows the API's message", async (status, detail) => {
    const api = fakeApi({
      login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: true })),
      verifyTotp: vi.fn(async () => { throw apiError(detail, { status }); }),
    });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");

    await expect(store.completeMfaLogin("000000")).rejects.toThrow(detail);

    expect(store.getState().user).toBeNull();
    expect(store.getState().mfaPending).toMatchObject({ enrolled: true, live: true });
    expect(api.logout).not.toHaveBeenCalled();     // a wrong code is not a sign-out
  });

  it("live MFA enrolment returns the provisioning URI and the manual key", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const setup = await store.setupMfa({ userId: "ignored" });
    expect(setup.provisioningUri).toMatch(/^otpauth:/);
    expect(setup.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("live MFA enrolment passes on the API's refusal to replace an authenticator", async () => {
    // An enrolled user on a pending-MFA session gets 403 mfa_reset_required: replacing the
    // authenticator needs a verified session or an administrator's MFA reset.
    const api = fakeApi({ setupTotp: vi.fn(async () => { throw apiError("mfa_reset_required", { status: 403 }); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.setupMfa()).rejects.toThrow("mfa_reset_required");
    expect(api.setupTotp).toHaveBeenCalledTimes(1);
  });

  it("cancelling the MFA gate clears the pending session and the tokens", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: mfaToken, requires_mfa: true, mfa_enrolled: true })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");

    store.cancelMfaLogin();

    expect(store.getState().mfaPending).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("REFUSES a session with no permissions and drops the tokens", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: tokenWith({ sub: "u1" }), requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.attemptLogin("bos", "gizli")).rejects.toThrow(/yetki/i);
    expect(store.getState().user).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("REFUSES a session that cannot see the board", async () => {
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: biomedToken, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.attemptLogin("ahmet", "gizli")).rejects.toThrow(/Panoya/i);
    expect(api.logout).toHaveBeenCalled();
  });

  it("REFUSES a session for a reason code it has never heard of (fails closed)", async () => {
    // A reason added to accessProblem later must not slip through for want of a message.
    accessProblem.mockReturnValueOnce("A_REASON_ADDED_LATER");
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });

    await expect(store.attemptLogin("admin", "gizli")).rejects.toThrow(/Sistem yöneticinizle/);

    expect(store.getState().user).toBeNull();
    expect(api.logout).toHaveBeenCalled();
    expect(api.me).not.toHaveBeenCalled();
  });

  it("surfaces the backend's own error message on a bad password", async () => {
    const api = fakeApi({ login: vi.fn(async () => { throw new Error("Invalid credentials"); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.attemptLogin("a", "yanlis")).rejects.toThrow(/Invalid credentials/);
  });

  it("logging out clears the session and the tokens", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("admin", "gizli");
    store.logout();
    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it("notifies subscribers when the session changes", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const seen = vi.fn();
    store.subscribe(seen);
    await store.attemptLogin("admin", "gizli");
    expect(seen).toHaveBeenCalled();
  });

  it("changing the password goes to the API", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.changePassword("eski", "yeni-parola");
    expect(api.changePassword).toHaveBeenCalledWith("eski", "yeni-parola");
  });

  it("delegates everything else to the simulation, which keeps working", () => {
    const base = fakeBase({ structure: { units: ["unit-1"] } });
    const store = createLiveStore({ api: fakeApi(), base });
    expect(store.getState().structure.units).toEqual(["unit-1"]);
    expect(store.admitPatient({})).toBe("admitted");
  });

  it("marks tenant setup complete so the wizard never gates a real clinician", () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    expect(store.getState().tenantSetup).toBe(true);
  });
});

describe("liveStore — session survives a page reload", () => {
  it("restoreSession reopens a stored session", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => adminToken) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(true);
    expect(store.getState().user.perms).toEqual(ADMIN_PERMS);
    expect(api.login).not.toHaveBeenCalled();
  });

  it("restoreSession does nothing when no token was stored", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(false);
    expect(api.me).not.toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it("restoreSession lands a pending-MFA token on the gate, not in the app", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => mfaToken) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(true);
    expect(store.getState().user).toBeNull();
    expect(store.getState().mfaPending).toMatchObject({ enrolled: false, live: true });
  });

  it("restoreSession clears stale tokens when the API refuses them", async () => {
    // A 401 that could not be refreshed: the access token is dead and nothing can renew it.
    const api = fakeApi({ accessToken: vi.fn(() => adminToken),
                          me: vi.fn(async () => { throw apiError("Invalid or missing authentication credentials", { status: 401 }); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(false);
    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
    expect(store.getState().sessionError).toBeNull();   // quietly: not signed in is a state
  });

  it("restoreSession signs out when the refresh was refused", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => adminToken),
                          me: vi.fn(async () => { throw apiError("Invalid or expired refresh token", { status: 401, sessionEnded: true }); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(false);
    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
  });

  it("restoreSession signs out quietly when the stored session can no longer see the board", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => biomedToken) });
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.restoreSession()).toBe(false);
    expect(api.logout).toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
    expect(store.getState().sessionError).toBeNull();
  });

  it.each([
    ["a server error", () => apiError("İstek başarısız (503)", { status: 503 })],
    ["a refresh the server could not answer",
     () => apiError("Sunucuya şu an ulaşılamıyor; oturumunuz açık, biraz sonra tekrar deneyin.", { status: 502 })],
    ["no network", () => new TypeError("Failed to fetch")],
  ])("restoreSession KEEPS the tokens on %s and says the server is unreachable", async (_label, makeError) => {
    // A reload during an outage must not sign the clinician out: the server did not refuse the
    // session, it did not answer.
    const api = fakeApi({ accessToken: vi.fn(() => adminToken),
                          me: vi.fn(async () => { throw makeError(); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    const seen = vi.fn();
    store.subscribe(seen);

    expect(await store.restoreSession()).toBe(false);

    expect(api.logout).not.toHaveBeenCalled();
    expect(store.getState().user).toBeNull();
    expect(store.getState().sessionError).toMatchObject({ code: SESSION_UNREACHABLE });
    expect(store.getState().sessionError.message).toMatch(/ulaşılamıyor/);
    expect(seen).toHaveBeenCalled();
  });

  it("a later restoreSession, once the server answers, opens the session and clears the error", async () => {
    const me = vi.fn()
      .mockRejectedValueOnce(apiError("İstek başarısız (503)", { status: 503 }))
      .mockResolvedValueOnce(ME);
    const api = fakeApi({ accessToken: vi.fn(() => adminToken), me });
    const store = createLiveStore({ api, base: fakeBase() });

    expect(await store.restoreSession()).toBe(false);
    expect(await store.restoreSession()).toBe(true);

    expect(store.getState().user.perms).toEqual(ADMIN_PERMS);
    expect(store.getState().sessionError).toBeNull();
  });

  it("drops its answer when someone signed in while it waited: no name from one, rights from another", async () => {
    let current = adminToken;                       // the stored session from an earlier load
    let answerRestore;
    const me = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { answerRestore = resolve; }))
      .mockResolvedValue({ ...ME, id: "u-nurse", username: "ayse", full_name: "Ayşe Demir",
                           groups: [{ slug: "nurse", name: "Hemşire" }] });
    const api = fakeApi({
      accessToken: vi.fn(() => current), me,
      login: vi.fn(async () => { current = nurseToken; return { access_token: nurseToken, requires_mfa: false }; }),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    const restoring = store.restoreSession();
    await store.attemptLogin("ayse", "gizli");
    answerRestore(ME);                              // the administrator's profile, too late

    expect(await restoring).toBe(false);
    expect(store.getState().user).toMatchObject({ id: "u-nurse", full_name: "Ayşe Demir" });
    expect(store.getState().user.perms).not.toContain("users.manage");
  });

  it("a refusal that arrives after a new sign-in does not wipe the new session's tokens", async () => {
    let current = adminToken;
    let refuse;
    const me = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }))
      .mockResolvedValue(ME);
    const api = fakeApi({
      accessToken: vi.fn(() => current), me,
      login: vi.fn(async () => { current = nurseToken; return { access_token: nurseToken, requires_mfa: false }; }),
    });
    const store = createLiveStore({ api, base: fakeBase() });

    const restoring = store.restoreSession();
    await store.attemptLogin("ayse", "gizli");
    refuse(apiError("Invalid or missing authentication credentials", { status: 401 }));

    expect(await restoring).toBe(false);
    expect(api.logout).not.toHaveBeenCalled();
    expect(store.getState().user).not.toBeNull();
    expect(store.getState().sessionError).toBeNull();
  });

  it("signing in after an outage clears the error", async () => {
    const api = fakeApi({ accessToken: vi.fn(() => adminToken),
                          me: vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(ME) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.restoreSession();
    expect(store.getState().sessionError).not.toBeNull();

    await store.attemptLogin("admin", "gizli");

    expect(store.getState().sessionError).toBeNull();
  });
});

describe("liveStore — the session's rights stay current", () => {
  const NURSE_ME = { ...ME, id: "u-nurse", username: "ayse", full_name: "Ayşe Demir",
                     groups: [{ slug: "nurse", name: "Hemşire" }] };
  const NURSE = { tenant: "t1", groups: ["nurse"], perms: ["board.view", "alerts.ack"] };
  const WIDER = { tenant: "t1", groups: ["nurse", "charge_nurse"],
                  perms: ["board.view", "alerts.ack", "admissions.admit"] };

  /** A signed-in nurse whose API hands out `current` as the access token, the way backendApi
   *  does after a transparent refresh. */
  async function signedIn(extra = {}) {
    let current = tokenWith(NURSE);
    const api = {
      ...fakeApi({
        login: vi.fn(async () => ({ access_token: current, requires_mfa: false })),
        me: vi.fn(async () => NURSE_ME),
        accessToken: vi.fn(() => current),
      }),
      boardPatients: vi.fn(async () => ({ patients: [] })),
      acknowledge: vi.fn(async () => ({})),
      ...extra,
    };
    const store = createLiveStore({ api, base: fakeBase() });
    await store.attemptLogin("ayse", "gizli");
    return { api, store, setToken: (payload) => { current = tokenWith(payload); } };
  }

  it("does not display a user manager as an administrator", async () => {
    const desk = tokenWith({ tenant: "t1", groups: ["desk"], perms: ["board.view", "users.manage", "groups.manage"] });
    const store = createLiveStore({ api: fakeApi({ login: vi.fn(async () => ({ access_token: desk })) }),
                                    base: fakeBase() });
    await store.attemptLogin("desk", "gizli");
    expect(store.getState().user.role).toBeNull();
    expect(store.getState().user.perms).toContain("users.manage");
  });

  it("re-derives the rights from a token refreshed during a call", async () => {
    const { api, store, setToken } = await signedIn();
    expect(store.getState().user.perms).toEqual(NURSE.perms);
    api.boardPatients.mockImplementationOnce(async () => { setToken(WIDER); return { patients: [] }; });
    const seen = vi.fn();
    store.subscribe(seen);

    await store.refreshBoard();

    const user = store.getState().user;
    expect(user.perms).toEqual(WIDER.perms);
    expect(user.groups).toEqual(WIDER.groups);
    expect(user.role).toBe(ROLE.CHARGE_NURSE);
    // A refreshed token names groups by slug; a name the last profile did not give stays the slug.
    expect(user.groupNames).toEqual(["Hemşire", "charge_nurse"]);
    expect(user.id).toBe("u-nurse");
    expect(seen).toHaveBeenCalled();
  });

  it("re-reads the rights after a refused call too", async () => {
    const { api, store, setToken } = await signedIn();
    api.acknowledge.mockImplementationOnce(async () => {
      setToken({ ...NURSE, perms: ["board.view"] });
      throw apiError("permission required: alerts.ack", { status: 403 });
    });
    await expect(store.acknowledgeAlert("bed-1::sepsis")).rejects.toThrow("alerts.ack");
    expect(store.getState().user.perms).toEqual(["board.view"]);
  });

  it("keeps the same user object when a refreshed token carries the same rights", async () => {
    const { api, store, setToken } = await signedIn();
    const before = store.getState().user;
    api.boardPatients.mockImplementationOnce(async () => {
      setToken({ ...NURSE, exp: 9999999999 });        // a new token, the same rights
      return { patients: [] };
    });
    await store.refreshBoard();
    expect(store.getState().user).toBe(before);
  });

  it("re-reads the rights from the fresh pair a password change returns", async () => {
    const { store, setToken } = await signedIn({
      changePassword: vi.fn(async () => { setToken(WIDER); return { access_token: "x" }; }),
    });
    await store.changePassword("eski", "yeni-parola-1");
    expect(store.getState().user.perms).toEqual(WIDER.perms);
  });

  it("refreshRights re-reads the database's rights from /auth/me", async () => {
    const { api, store } = await signedIn();
    api.me.mockResolvedValueOnce({ ...NURSE_ME, perms: WIDER.perms,
      groups: [{ slug: "nurse", name: "Hemşire" }, { slug: "charge_nurse", name: "Sorumlu Hemşire" }] });

    expect(await store.refreshRights()).toBe(true);

    const user = store.getState().user;
    expect(user.perms).toEqual(WIDER.perms);
    expect(user.groups).toEqual(["nurse", "charge_nurse"]);
    expect(user.groupNames).toEqual(["Hemşire", "Sorumlu Hemşire"]);
    expect(user.role).toBe(ROLE.CHARGE_NURSE);
  });

  it("a later call with the same token does not undo what /auth/me said", async () => {
    const { api, store } = await signedIn();
    api.me.mockResolvedValueOnce({ ...NURSE_ME, perms: WIDER.perms });
    await store.refreshRights();
    await store.refreshBoard();
    expect(store.getState().user.perms).toEqual(WIDER.perms);
  });

  it("refreshRights never rejects: on failure the rights stay as they were", async () => {
    const { api, store } = await signedIn();
    api.me.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await store.refreshRights()).toBe(false);
    expect(store.getState().user.perms).toEqual(NURSE.perms);
  });

  it("refreshRights ignores a profile without a rights list", async () => {
    const { api, store } = await signedIn();
    api.me.mockResolvedValueOnce({ ...NURSE_ME });           // no `perms`
    expect(await store.refreshRights()).toBe(false);
    expect(store.getState().user.perms).toEqual(NURSE.perms);
  });

  it("refreshRights does not reopen a session that ended while it was in flight", async () => {
    const { api, store } = await signedIn();
    let answer;
    api.me.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const pending = store.refreshRights();
    store.logout();
    answer({ ...NURSE_ME, perms: WIDER.perms });
    expect(await pending).toBe(false);
    expect(store.getState().user).toBeNull();
  });

  it("refreshRights does nothing without a session", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.refreshRights()).toBe(false);
    expect(api.me).not.toHaveBeenCalled();
  });
});
