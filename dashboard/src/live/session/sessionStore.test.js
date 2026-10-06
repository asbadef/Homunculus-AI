import { describe, it, expect, vi, afterEach } from "vitest";
import { FALLBACK_LOCK_SIGNOUT_HOURS, NOTICE, PHASE, UNLOCK_ATTEMPTS, createSessionStore } from "./sessionStore.js";
import { LOCK_KEY, readLock, writeLock } from "./browserState.js";
import { fakeApi, profile, token } from "./testTokens.testutil.js";
import { createBackendApi } from "../../backendApi.js";

const NURSE = token();
const PENDING = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true });
const VERIFIED = token({ sub: "u-kaya", groups: ["attending"], perms: ["board.view"], mfaRequired: true, mfaVerified: true });

function refusal(status, message = "x", extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/** What backendApi rejects a request with when another tab replaced the session under it
 *  (`supersede()`, or a refresh that met another account's pair in storage). */
const superseded = () => refusal(401, "Bu istek önceki oturuma aitti; sonucu uygulanmadı.",
  { superseded: true, code: "SESSION_SUPERSEDED" });

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

/** A store on a fake API; `events` is a private EventTarget standing in for window; `timers`
 *  holds what the store scheduled (the end of a long lock). */
function setup({ access = null, canEnter = () => true, now = () => NOW } = {}) {
  const api = fakeApi(vi, { access });
  const events = new EventTarget();
  const timers = [];
  const store = createSessionStore({
    api, canEnter, events, now,
    setTimer: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
    clearTimer: (id) => { timers[id].cleared = true; },
  });
  return { api, store, events, timers, state: () => store.getState() };
}

function storageEvent(events, key, newValue) {
  const event = new Event("storage");
  Object.assign(event, { key, newValue });
  events.dispatchEvent(event);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("restoring a stored session (a page load)", () => {
  it("with nothing stored, stays on the form and asks the API nothing", async () => {
    const { api, store, state } = setup();
    await store.restore();
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(api.me).not.toHaveBeenCalled();
  });

  it("opens the shell with the profile and the token's rights", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    const seen = [];
    store.subscribe(() => seen.push(store.getState().phase));
    await store.restore();
    expect(seen[0]).toBe(PHASE.RESTORING);
    expect(state().phase).toBe(PHASE.READY);
    expect(state().user).toEqual({
      id: "u-ayse", username: "ayse", fullName: "Ayşe Sentetik", email: "ayse@example.com",
      authSource: "local", tenant: "demo-hastanesi", tenantName: "Sentetik Hastane",
      groups: [{ slug: "nurse", name: "Hemşire" }], perms: ["board.view", "alerts.ack"],
      totpEnabled: false, lockIdleMinutes: 10, lockSignoutHours: 12,
    });
  });

  it("locks, and ends a long lock, when the server does not say how long (an older API)", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile({ lock_idle_minutes: undefined, lock_signout_hours: undefined }));
    await store.restore();
    expect(state().user.lockIdleMinutes).toBe(10);
    expect(state().user.lockSignoutHours).toBe(FALLBACK_LOCK_SIGNOUT_HOURS);
  });

  it("drops a session the server refuses, quietly", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockRejectedValue(refusal(401, "Oturum süresi doldu, tekrar giriş yapın.", { sessionEnded: true }));
    await store.restore();
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(state().notice).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it("keeps the tokens when the server does not answer, and retries", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockRejectedValueOnce(refusal(503, "upstream")).mockResolvedValueOnce(profile());
    await store.restore();
    expect(state().phase).toBe(PHASE.UNREACHABLE);
    expect(state().error.status).toBe(503);
    expect(api.logout).not.toHaveBeenCalled();
    await store.retry();
    expect(state().phase).toBe(PHASE.READY);
  });

  it("goes back to the TOTP step for a session that has not passed it", async () => {
    const { api, store, state } = setup({ access: PENDING });
    api.me.mockResolvedValue(profile({ id: "u-kaya", totp_enabled: true }));
    await store.restore();
    expect(state().phase).toBe(PHASE.MFA);
    expect(state().mfa).toEqual({ enrolled: true });
  });

  it("goes to the password change while a temporary password is in use", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile({ must_change_password: true }));
    await store.restore();
    expect(state().phase).toBe(PHASE.PASSWORD);
  });

  it("opens on the lock screen when this browser is locked for this user — a reload does not pass it", async () => {
    writeLock({ user: "u-ayse", at: 1_699_999_000_000, why: "idle" });
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    expect(state().phase).toBe(PHASE.LOCKED);
    expect(state().lock).toEqual({ at: 1_699_999_000_000, why: "idle" });
  });

  it("signs out a browser that has been locked longer than the hospital allows", async () => {
    writeLock({ user: "u-ayse", at: NOW - 3 * HOUR - 1, why: "idle" });
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile({ lock_signout_hours: 3 }));
    await store.restore();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null, notice: { code: NOTICE.LOCK_EXPIRED } });
    expect(api.logout).toHaveBeenCalled();
    expect(readLock()).toBeNull();
  });

  it("ignores, and clears, a lock left for another account", async () => {
    writeLock({ user: "u-baskasi", at: 1, why: "manual" });
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    expect(state().phase).toBe(PHASE.READY);
    expect(readLock()).toBeNull();
  });
});

describe("signing in", () => {
  it("changes nothing in this browser for a refused sign-in: no remembered name, the lock stays", async () => {
    localStorage.setItem("hmc.rememberUser", "ayse");
    writeLock({ user: "u-ayse", at: NOW, why: "manual" });
    const { api, store } = setup();
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    await expect(store.signIn("yabanci", "tahmin", { remember: true })).rejects.toThrow();
    await expect(store.signIn("yabanci", "tahmin", { remember: false })).rejects.toThrow();
    expect(localStorage.getItem("hmc.rememberUser")).toBe("ayse");
    expect(readLock()).toEqual({ user: "u-ayse", at: NOW, why: "manual" });
  });

  it("remembers the username when asked, and only the username", async () => {
    const { api, store } = setup();
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE, requires_mfa: false }; });
    api.me.mockResolvedValue(profile());
    await store.signIn(" ayse ", "Gizli-Sifre-1", { remember: true });
    expect(localStorage.getItem("hmc.rememberUser")).toBe("ayse");
    expect(Object.values(localStorage).join(" ")).not.toContain("Gizli-Sifre-1");
    await store.signIn("ayse", "Gizli-Sifre-1", { remember: false });
    expect(localStorage.getItem("hmc.rememberUser")).toBeNull();
  });

  it("goes through the TOTP step, then into the shell", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(PENDING); return { access_token: PENDING, requires_mfa: true, mfa_enrolled: false }; });
    api.me.mockResolvedValue(profile({ id: "u-kaya", totp_enabled: false }));
    await store.signIn("dr.kaya", "x");
    expect(state().phase).toBe(PHASE.MFA);
    expect(state().mfa).toEqual({ enrolled: false });
    api.verifyTotp.mockImplementation(async () => { api.store(VERIFIED); return { access_token: VERIFIED }; });
    await store.verifyMfa(" 123456 ");
    expect(api.verifyTotp).toHaveBeenCalledWith("123456");
    expect(state().phase).toBe(PHASE.READY);
  });

  it("keeps count of the steps: the TOTP one still counts at the password change after it", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(PENDING); return { access_token: PENDING, requires_mfa: true }; });
    api.me.mockResolvedValueOnce(profile({ id: "u-kaya", must_change_password: true }))
      .mockResolvedValueOnce(profile({ id: "u-kaya", must_change_password: true }));
    await store.signIn("dr.kaya", "Gecici-1");
    expect(state()).toMatchObject({ phase: PHASE.MFA, steps: { mfa: true, password: true } });
    api.verifyTotp.mockImplementation(async () => { api.store(VERIFIED); return { access_token: VERIFIED }; });
    await store.verifyMfa("123456");
    expect(state()).toMatchObject({ phase: PHASE.PASSWORD, steps: { mfa: true, password: true } });
    store.signOut();
    expect(state().steps).toEqual({ mfa: false, password: false });
  });

  it("goes through the forced password change, then into the shell", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE, password_change_required: true }; });
    api.me.mockResolvedValueOnce(profile({ must_change_password: true })).mockResolvedValueOnce(profile());
    await store.signIn("ayse", "Gecici-1");
    expect(state().phase).toBe(PHASE.PASSWORD);
    api.changePassword.mockResolvedValue({ access_token: NURSE });
    await store.changePassword("Gecici-1", "Kendi-Sifrem-9");
    expect(api.changePassword).toHaveBeenCalledWith("Gecici-1", "Kendi-Sifrem-9");
    expect(state().phase).toBe(PHASE.READY);
  });

  it("refuses an account with no rights, before any step, and says why", async () => {
    const empty = token({ perms: [], groups: [] });
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(empty); return { access_token: empty }; });
    await store.signIn("bos", "x");
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(state().notice).toEqual({ code: NOTICE.NO_PERMISSIONS });
    expect(api.logout).toHaveBeenCalled();
    expect(api.me).not.toHaveBeenCalled();
  });

  it("refuses rights no screen of the live UI uses (a biomedical account, until Group 4)", async () => {
    const devices = token({ perms: ["devices.manage"], groups: ["biomedical"] });
    const { api, store, state } = setup({ canEnter: (perms) => perms.includes("board.view") });
    api.login.mockImplementation(async () => { api.store(devices); return { access_token: devices }; });
    await store.signIn("biomed", "x");
    expect(state().notice).toEqual({ code: NOTICE.NO_SCREEN });
  });

  it("rejects with the API's error and stays on the form", async () => {
    const { api, store, state } = setup();
    api.login.mockRejectedValue(refusal(401, "Invalid credentials"));
    await expect(store.signIn("ayse", "yanlis")).rejects.toThrow("Invalid credentials");
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
  });

  it("drops the tokens of a sign-in whose profile could not be read: the form never stands over a session", async () => {
    const { api, store, state } = setup();
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE }; });
    api.me.mockRejectedValue(refusal(503, "upstream"));
    await expect(store.signIn("ayse", "x")).rejects.toThrow("upstream");
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null, notice: null });
    expect(api.logout).toHaveBeenCalled();
    expect(api.accessToken()).toBeNull();
  });

  it("drops a profile that arrives after the session was given up", async () => {
    const { api, store, state } = setup();
    let answer;
    api.login.mockImplementation(async () => { api.store(NURSE); return { access_token: NURSE }; });
    api.me.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const pending = store.signIn("ayse", "x");
    await vi.waitFor(() => expect(api.me).toHaveBeenCalled());
    store.signOut();
    answer(profile());
    await pending;
    expect(state().phase).toBe(PHASE.SIGNED_OUT);
    expect(state().user).toBeNull();
  });
});

describe("signing out", () => {
  it("drops the tokens, the user and this browser's lock, and says so", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    store.lock();
    store.signOut();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null, lock: null, notice: { code: NOTICE.SIGNED_OUT } });
    expect(api.logout).toHaveBeenCalled();
    expect(readLock()).toBeNull();
  });

  it("backing out of a step ends the session with no message", async () => {
    const { api, store, state } = setup({ access: PENDING });
    api.me.mockResolvedValue(profile({ id: "u-kaya" }));
    await store.restore();
    store.cancel();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: null });
  });

  it("ends a session the server refused during any tracked call", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    await expect(store.track(() => Promise.reject(refusal(401, "x", { sessionEnded: true })))).rejects.toThrow();
    expect(state().notice).toEqual({ code: NOTICE.SESSION_ENDED });
  });

  it("takes an open shell to the password step when an administrator has just reset the password", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    await expect(store.track(() => Promise.reject(refusal(403, "password_change_required")))).rejects.toThrow();
    expect(state()).toMatchObject({ phase: PHASE.PASSWORD, steps: { mfa: false, password: true } });
    expect(api.logout).not.toHaveBeenCalled();
    store.lock();                                                       // no lock from the step
    expect(state().phase).toBe(PHASE.PASSWORD);
  });
});

describe("the lock", () => {
  async function ready() {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    return s;
  }

  it("locks the browser for this user and unlocks with the password", async () => {
    const { api, store, state } = await ready();
    store.lock("idle");
    expect(state()).toMatchObject({ phase: PHASE.LOCKED, lock: { at: NOW, why: "idle" } });
    expect(readLock()).toEqual({ user: "u-ayse", at: NOW, why: "idle" });
    api.reauth.mockResolvedValue({ ok: true });
    await store.unlock("Gizli-Sifre-1");
    expect(api.reauth).toHaveBeenCalledWith("Gizli-Sifre-1");
    expect(state()).toMatchObject({ phase: PHASE.READY, lock: null });
    expect(readLock()).toBeNull();
  });

  it("signs out when the lock lasts the hospital's hours, and forgets the timer when unlocked", async () => {
    const { api, store, timers, state } = await ready();
    store.lock("idle");
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(12 * HOUR);
    api.reauth.mockResolvedValue({ ok: true });
    await store.unlock("Gizli-Sifre-1");
    expect(timers[0].cleared).toBe(true);
    store.lock("manual");
    timers[1].fn();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCK_EXPIRED } });
    expect(api.logout).toHaveBeenCalled();
  });

  it(`signs out after ${UNLOCK_ATTEMPTS} wrong passwords`, async () => {
    const { api, store, state } = await ready();
    store.lock();
    api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    for (let i = 1; i < UNLOCK_ATTEMPTS; i += 1) {
      await expect(store.unlock("yanlis")).rejects.toThrow("Parola hatalı");
      expect(state()).toMatchObject({ phase: PHASE.LOCKED, unlockFailures: i });
    }
    await expect(store.unlock("yanlis")).rejects.toThrow();
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCKED_OUT } });
    expect(api.logout).toHaveBeenCalled();
  });

  it("stays locked, counting nothing, when the server cannot check (429, 503, no network)", async () => {
    const { api, store, state } = await ready();
    store.lock();
    for (const err of [refusal(429, "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin", { retryAfter: 900 }),
      refusal(429, "Çok fazla deneme. Bir dakika sonra yeniden deneyin.", { retryAfter: 60 }),
      refusal(503, "Dizin sunucusuna ulaşılamıyor"), new Error("Failed to fetch")]) {
      api.reauth.mockRejectedValueOnce(err);
      await expect(store.unlock("Gizli")).rejects.toBe(err);
      expect(state()).toMatchObject({ phase: PHASE.LOCKED, unlockFailures: 0 });
    }
    expect(api.logout).not.toHaveBeenCalled();
  });

  // reauth() rejects a 401 that survived its one refresh-and-retry with `sessionEnded` (the tokens
  // already dropped): an AD account disabled or expired — never a wrong password, which is a 403.
  it.each([[401, "Invalid credentials", { sessionEnded: true }], [403, "Bu kurumdaki üyeliğiniz etkin değil", {}]])(
    "ends the session when the server says it is over (%i %s)", async (status, message, extra) => {
      const { api, store, state } = await ready();
      store.lock();
      api.reauth.mockRejectedValue(refusal(status, message, extra));
      await expect(store.unlock("Gizli")).rejects.toThrow();
      expect(state().notice).toEqual({ code: NOTICE.SESSION_ENDED });
    });
});

// Decision 4: 3 wrong passwords per LOCK — not per page load, not per tab. Decision 17: a lock
// lasts at most the hospital's hours, whether or not the page was awake to run its timer.
describe("the lock belongs to the browser, not to the page", () => {
  async function lockedAt(at = NOW, { now = () => NOW, me = profile() } = {}) {
    const s = setup({ access: NURSE, now });
    s.api.me.mockResolvedValue(me);
    await s.store.restore();
    writeLock({ user: "u-ayse", at, why: "idle" });
    storageEvent(s.events, LOCK_KEY, JSON.stringify({ user: "u-ayse", at, why: "idle" }));
    expect(s.state().phase).toBe(PHASE.LOCKED);
    return s;
  }

  it("a reload keeps the wrong passwords already taken", async () => {
    const a = await lockedAt();
    a.api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    await expect(a.store.unlock("yanlis-1")).rejects.toThrow();
    await expect(a.store.unlock("yanlis-2")).rejects.toThrow();
    a.store.dispose();
    const reload = setup({ access: NURSE });
    reload.api.me.mockResolvedValue(profile());
    await reload.store.restore();
    expect(reload.state()).toMatchObject({ phase: PHASE.LOCKED, unlockFailures: 2 });
    reload.api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    await expect(reload.store.unlock("yanlis-3")).rejects.toThrow();
    expect(reload.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCKED_OUT } });
    reload.store.dispose();
  });

  it("every tab counts toward the same three", async () => {
    const a = await lockedAt();
    const b = await lockedAt();
    const relay = (to) => storageEvent(to.events, LOCK_KEY, localStorage.getItem(LOCK_KEY));
    a.api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    b.api.reauth.mockRejectedValue(refusal(403, "Parola hatalı"));
    await expect(a.store.unlock("yanlis-1")).rejects.toThrow();
    relay(b);
    expect(b.state().unlockFailures).toBe(1);
    await expect(b.store.unlock("yanlis-2")).rejects.toThrow();
    relay(a);
    expect(a.state().unlockFailures).toBe(2);
    await expect(a.store.unlock("yanlis-3")).rejects.toThrow();
    expect(a.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCKED_OUT } });
    a.store.dispose();
    b.store.dispose();
  });

  it("a new lock starts a new count", async () => {
    const s = await lockedAt();
    s.api.reauth.mockRejectedValueOnce(refusal(403, "Parola hatalı")).mockResolvedValueOnce({ ok: true });
    await expect(s.store.unlock("yanlis")).rejects.toThrow();
    await s.store.unlock("Gizli-Sifre-1");
    s.store.lock("manual");
    expect(s.state().unlockFailures).toBe(0);
    expect(readLock()).toEqual({ user: "u-ayse", at: NOW, why: "manual" });
    s.store.dispose();
  });

  it("a lock past the hospital's hours does not open for the right password, timer or not", async () => {
    let t = NOW;
    const s = await lockedAt(NOW, { now: () => t });
    t = NOW + 13 * HOUR;                                               // the page slept through its timer
    s.api.reauth.mockResolvedValue({ ok: true });
    await s.store.unlock("Gizli-Sifre-1");
    expect(s.api.reauth).not.toHaveBeenCalled();
    expect(s.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null, notice: { code: NOTICE.LOCK_EXPIRED } });
    expect(readLock()).toBeNull();
    s.store.dispose();
  });

  it.each(["visibilitychange", "pageshow", "focus"])(
    "back on a page that slept past the lock's hours (%s): signed out", async (type) => {
      let t = NOW;
      const s = await lockedAt(NOW, { now: () => t });
      t = NOW + 12 * HOUR;
      s.events.dispatchEvent(new Event(type));
      expect(s.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.LOCK_EXPIRED } });
      s.store.dispose();
    });

  it("back on a page that missed the storage events: it locks, unlocks and signs out with the others", async () => {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    writeLock({ user: "u-ayse", at: NOW - 5, why: "manual", failures: 1 });   // locked elsewhere, no event
    s.events.dispatchEvent(new Event("visibilitychange"));
    expect(s.state()).toMatchObject({ phase: PHASE.LOCKED, lock: { at: NOW - 5, why: "manual" }, unlockFailures: 1 });
    localStorage.removeItem(LOCK_KEY);                                       // unlocked elsewhere
    s.events.dispatchEvent(new Event("focus"));
    expect(s.state().phase).toBe(PHASE.READY);
    s.api.store(null);                                                     // signed out elsewhere
    s.events.dispatchEvent(new Event("pageshow"));
    expect(s.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.ELSEWHERE } });
    expect(s.api.logout).not.toHaveBeenCalled();
    s.store.dispose();
  });

  it("a second unlock while one is on its way is that one: the password is sent once", async () => {
    const s = await lockedAt();
    let answer;
    s.api.reauth.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const first = s.store.unlock("Gizli-Sifre-1");
    const second = s.store.unlock("Gizli-Sifre-1");
    expect(second).toBe(first);
    answer({ ok: true });
    await first;
    expect(s.api.reauth).toHaveBeenCalledTimes(1);
    expect(s.state().phase).toBe(PHASE.READY);
    s.store.dispose();
  });

  it("a wrong password answered after another tab unlocked changes nothing", async () => {
    const s = await lockedAt();
    let refuse;
    s.api.reauth.mockImplementation(() => new Promise((_, reject) => { refuse = reject; }));
    const pending = s.store.unlock("yanlis");
    localStorage.removeItem(LOCK_KEY);
    storageEvent(s.events, LOCK_KEY, null);                                // unlocked in another tab
    expect(s.state().phase).toBe(PHASE.READY);
    refuse(refusal(403, "Parola hatalı"));
    await expect(pending).rejects.toThrow();
    expect(s.state()).toMatchObject({ phase: PHASE.READY, unlockFailures: 0, notice: null });
    expect(readLock()).toBeNull();
    expect(s.api.logout).not.toHaveBeenCalled();
    s.store.dispose();
  });

  it("an administrator's password reset behind the lock signs out — presence is not proven", async () => {
    const s = await lockedAt();
    s.api.reauth.mockRejectedValue(refusal(403, "password_change_required"));
    await expect(s.store.unlock("Gizli-Sifre-1")).rejects.toThrow();
    expect(s.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.PASSWORD_RESET } });
    expect(s.api.logout).toHaveBeenCalled();
    expect(readLock()).toBeNull();
    s.store.dispose();
  });

  it("…and so does a reload of that locked browser: the lock comes before the password step", async () => {
    writeLock({ user: "u-ayse", at: NOW - 1000, why: "idle" });
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile({ must_change_password: true }));
    await s.store.restore();
    expect(s.state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.PASSWORD_RESET } });
    expect(readLock()).toBeNull();
    s.store.dispose();
  });
});

describe("rights follow the token", () => {
  it("re-reads the rights after a call that brought a refreshed token", async () => {
    const { api, store, state } = setup({ access: NURSE });
    api.me.mockResolvedValue(profile());
    await store.restore();
    const wider = token({ groups: ["nurse", "charge_nurse"], perms: ["board.view", "alerts.ack", "shifts.manage"] });
    await store.track(async () => { api.store(wider); return null; });
    expect(state().user.perms).toEqual(["board.view", "alerts.ack", "shifts.manage"]);
    expect(state().user.groups).toEqual([{ slug: "nurse", name: "Hemşire" }, { slug: "charge_nurse", name: "charge_nurse" }]);
  });
});

describe("other tabs of this browser", () => {
  async function ready() {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    return s;
  }

  it("signs out here when another tab signed out, without touching storage again", async () => {
    const { api, store, events, state } = await ready();
    api.store(null);
    storageEvent(events, "homunculus-access-token", null);
    expect(state()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.ELSEWHERE } });
    expect(api.forget).toHaveBeenCalled();
    expect(api.supersede).toHaveBeenCalled();                          // its requests in flight are over
    expect(api.logout).not.toHaveBeenCalled();
    store.dispose();
  });

  it("opens the session another tab signed in to", async () => {
    const { api, store, events, state } = await ready();
    const other = token({ sub: "u-murad" });
    api.me.mockResolvedValue(profile({ id: "u-murad", username: "murad" }));
    api.store(other);
    storageEvent(events, "homunculus-access-token", other);
    expect(api.supersede).toHaveBeenCalled();                          // this account's requests are over
    await vi.waitFor(() => expect(state().user?.username).toBe("murad"));
    store.dispose();
  });

  it("keeps this tab signed in when the same account's tokens change in another tab (a refresh, a new password)", async () => {
    const { api, store, events, state } = await ready();
    const before = state().user;
    const renewed = token({ tv: 1 });
    api.store(renewed);
    storageEvent(events, "homunculus-access-token", renewed);
    storageEvent(events, "homunculus-refresh-token", "r-2");
    expect(state().phase).toBe(PHASE.READY);
    expect(state().user).toBe(before);
    expect(state().notice).toBeNull();
    expect(api.forget).toHaveBeenCalledTimes(2);                       // the next request reads storage again
    expect(api.supersede).not.toHaveBeenCalled();                      // requests in flight carry on
    expect(api.logout).not.toHaveBeenCalled();
    expect(api.me).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("stays locked when the same account's tokens change in another tab", async () => {
    const { api, store, events, state } = await ready();
    store.lock("idle");
    const renewed = token({ tv: 1 });
    api.store(renewed);
    storageEvent(events, "homunculus-access-token", renewed);
    expect(state()).toMatchObject({ phase: PHASE.LOCKED, lock: { at: NOW, why: "idle" } });
    expect(api.supersede).not.toHaveBeenCalled();
    store.dispose();
  });

  it("locks with another tab, and unlocks when it is unlocked there", async () => {
    const { events, state } = await ready();
    storageEvent(events, LOCK_KEY, JSON.stringify({ user: "u-ayse", at: NOW - 5, why: "manual" }));
    expect(state()).toMatchObject({ phase: PHASE.LOCKED, lock: { at: NOW - 5, why: "manual" } });
    storageEvent(events, LOCK_KEY, null);
    expect(state().phase).toBe(PHASE.READY);
  });

  it("moves on from the TOTP step when the same account passed it in another tab", async () => {
    const s = setup({ access: PENDING });
    s.api.me.mockResolvedValue(profile({ id: "u-kaya", totp_enabled: true }));
    await s.store.restore();
    expect(s.state().phase).toBe(PHASE.MFA);
    s.api.store(VERIFIED);
    storageEvent(s.events, "homunculus-access-token", VERIFIED);
    await vi.waitFor(() => expect(s.state().phase).toBe(PHASE.READY));
    expect(s.api.supersede).not.toHaveBeenCalled();
    s.store.dispose();
  });

  it("does not lock for another account's lock", async () => {
    const { events, state } = await ready();
    storageEvent(events, LOCK_KEY, JSON.stringify({ user: "u-baskasi", at: 5, why: "manual" }));
    expect(state().phase).toBe(PHASE.READY);
  });
});

// A request backendApi rejects with `superseded` belongs to a session another tab replaced: it
// says nothing about this session being over. The storage event settles where this tab goes.
describe("a request another tab superseded", () => {
  it("does not end a session being restored; the storage event settles it", async () => {
    const { api, store, events, state } = setup({ access: NURSE });
    api.me.mockRejectedValueOnce(superseded());
    await store.restore();
    expect(state().phase).not.toBe(PHASE.SIGNED_OUT);
    expect(state().phase).not.toBe(PHASE.UNREACHABLE);
    expect(api.logout).not.toHaveBeenCalled();
    const other = token({ sub: "u-murad" });
    api.store(other);
    api.me.mockResolvedValue(profile({ id: "u-murad", username: "murad" }));
    storageEvent(events, "homunculus-access-token", other);
    await vi.waitFor(() => expect(state()).toMatchObject({ phase: PHASE.READY, user: { username: "murad" } }));
    store.dispose();
  });

  it("does not end an open session, nor send it to the password step", async () => {
    const { api, store, state } = await (async () => {
      const s = setup({ access: NURSE });
      s.api.me.mockResolvedValue(profile());
      await s.store.restore();
      return s;
    })();
    const err = superseded();
    await expect(store.track(() => Promise.reject(err))).rejects.toBe(err);
    expect(state()).toMatchObject({ phase: PHASE.READY, notice: null, user: { id: "u-ayse" } });
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("at the lock: counts no wrong password, ends nothing, and stays locked for the same account", async () => {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    s.store.lock();
    s.api.store(token({ tv: 1 }));                                      // another tab refreshed this account
    const err = superseded();
    s.api.reauth.mockRejectedValueOnce(err);
    await expect(s.store.unlock("Gizli")).rejects.toBe(err);
    expect(s.state()).toMatchObject({ phase: PHASE.LOCKED, unlockFailures: 0, notice: null });
    expect(s.api.logout).not.toHaveBeenCalled();
    expect(s.api.supersede).not.toHaveBeenCalled();
    expect(s.api.forget).toHaveBeenCalled();                            // the next try reads the new pair
    s.store.dispose();
  });

  it("at the lock: follows another account that took over this browser, as the storage event would", async () => {
    const s = setup({ access: NURSE });
    s.api.me.mockResolvedValue(profile());
    await s.store.restore();
    s.store.lock();
    s.api.store(token({ sub: "u-murad" }));
    s.api.me.mockResolvedValue(profile({ id: "u-murad", username: "murad" }));
    const err = superseded();
    s.api.reauth.mockRejectedValueOnce(err);
    await expect(s.store.unlock("Gizli")).rejects.toBe(err);
    expect(s.api.supersede).toHaveBeenCalled();
    expect(s.api.logout).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(s.state()).toMatchObject({ phase: PHASE.READY, unlockFailures: 0, user: { username: "murad" } }));
    s.store.dispose();
  });
});

// The same endings on the real API client (a fake fetch, jsdom's localStorage): a pair that the
// server hands out after the session it was asked for has ended never reaches storage, so a
// reload — or another tab's storage event — does not bring the ended session back.
describe("with the real backendApi: a late pair never outlives the session's end", () => {
  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: { get: () => null } });
  const ACCESS = "homunculus-access-token";
  const REFRESH = "homunculus-refresh-token";

  /** `path` answers wait for the returned `release`; /auth/me answers `me`. */
  function slowApi(path, answer, me = profile()) {
    const gate = {};
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith("/auth/me")) return json(200, me);
      if (url.endsWith(path)) {
        await new Promise((resolve) => { gate.release = resolve; });
        return answer;
      }
      throw new Error(`unexpected ${url}`);
    });
    return { fetchImpl, gate };
  }

  it("backing out of the TOTP step while the code is checked: the verified pair is not written", async () => {
    localStorage.setItem(ACCESS, PENDING);
    localStorage.setItem(REFRESH, "r1");
    const { fetchImpl, gate } = slowApi("/auth/totp/verify", json(200, { access_token: VERIFIED, refresh_token: "r2" }),
      profile({ id: "u-kaya" }));
    const store = createSessionStore({ api: createBackendApi({ baseUrl: "", fetchImpl }), events: new EventTarget() });
    await store.restore();
    expect(store.getState().phase).toBe(PHASE.MFA);
    const verifying = store.verifyMfa("123456");
    await vi.waitFor(() => expect(gate.release).toBeTypeOf("function"));
    store.cancel();
    gate.release();
    await verifying;
    expect(store.getState()).toMatchObject({ phase: PHASE.SIGNED_OUT, user: null });
    expect(localStorage.getItem(ACCESS)).toBeNull();
    expect(localStorage.getItem(REFRESH)).toBeNull();
    const reload = createSessionStore({ api: createBackendApi({ baseUrl: "", fetchImpl }), events: new EventTarget() });
    await reload.restore();
    expect(reload.getState().phase).toBe(PHASE.SIGNED_OUT);
    store.dispose();
    reload.dispose();
  });

  it("a sign-in on its way survives the page coming back, and another tab's sign-out", async () => {
    const { fetchImpl, gate } = slowApi("/auth/login", json(200, { access_token: NURSE, refresh_token: "r1" }));
    const events = new EventTarget();
    const store = createSessionStore({ api: createBackendApi({ baseUrl: "", fetchImpl }), events });
    await store.restore();
    const signingIn = store.signIn("ayse", "Gizli-Sifre-1");
    await vi.waitFor(() => expect(gate.release).toBeTypeOf("function"));
    events.dispatchEvent(new Event("focus"));
    storageEvent(events, ACCESS, null);
    gate.release();
    await signingIn;
    expect(store.getState().phase).toBe(PHASE.READY);
    expect(localStorage.getItem(ACCESS)).toBe(NURSE);
    store.dispose();
  });

  it("signing out while a password change is on its way: the new pair is not written", async () => {
    localStorage.setItem(ACCESS, NURSE);
    localStorage.setItem(REFRESH, "r1");
    const { fetchImpl, gate } = slowApi("/auth/password", json(200, { access_token: token({ tv: 1 }), refresh_token: "r2" }));
    const store = createSessionStore({ api: createBackendApi({ baseUrl: "", fetchImpl }), events: new EventTarget() });
    await store.restore();
    const changing = store.changePassword("Eski-Sifre-1", "Kendi-Sifrem-9");
    await vi.waitFor(() => expect(gate.release).toBeTypeOf("function"));
    store.signOut();
    gate.release();
    await changing;
    expect(store.getState()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.SIGNED_OUT } });
    expect(localStorage.getItem(ACCESS)).toBeNull();
    expect(localStorage.getItem(REFRESH)).toBeNull();
    store.dispose();
  });

  it("one tab signs out while another's refresh is on its way: the refreshed pair is not written back", async () => {
    localStorage.setItem(ACCESS, NURSE);
    localStorage.setItem(REFRESH, "r1");
    const gate = {};
    let expired = true;
    const fetchB = vi.fn(async (url) => {
      if (url.endsWith("/auth/me")) return json(200, profile());
      if (url.endsWith("/patients")) {
        if (expired) { expired = false; return json(401, { detail: "expired" }); }
        return json(200, { patients: [] });
      }
      if (url.endsWith("/auth/refresh")) {
        await new Promise((resolve) => { gate.release = resolve; });
        return json(200, { access_token: token({ tv: 1 }), refresh_token: "r2" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const apiA = createBackendApi({ baseUrl: "", fetchImpl: async () => json(200, profile()) });
    const apiB = createBackendApi({ baseUrl: "", fetchImpl: fetchB });
    const eventsA = new EventTarget();
    const eventsB = new EventTarget();
    const A = createSessionStore({ api: apiA, events: eventsA });
    const B = createSessionStore({ api: apiB, events: eventsB });
    await A.restore();
    await B.restore();
    const loading = B.track(() => apiB.boardPatients()).catch((err) => err);
    await vi.waitFor(() => expect(gate.release).toBeTypeOf("function"));
    A.signOut();
    gate.release();
    expect((await loading).superseded).toBe(true);
    expect(B.getState().phase).toBe(PHASE.READY);                      // the storage event ends it here
    expect(localStorage.getItem(ACCESS)).toBeNull();
    expect(localStorage.getItem(REFRESH)).toBeNull();
    storageEvent(eventsB, ACCESS, null);
    expect(B.getState()).toMatchObject({ phase: PHASE.SIGNED_OUT, notice: { code: NOTICE.ELSEWHERE } });
    expect(A.getState().phase).toBe(PHASE.SIGNED_OUT);
    A.dispose();
    B.dispose();
  });
});
