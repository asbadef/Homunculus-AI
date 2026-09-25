// dashboard/src/liveStore.admin.test.js — the live store's administration state and actions.
// Synthetic data only.
import { describe, it, expect, vi } from "vitest";
import { createLiveStore } from "./liveStore.js";

function fakeBase() {
  const state = { user: null, mfaPending: null };
  const listeners = new Set();
  return { getState: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, logout: vi.fn() };
}

/** An unsigned JWT-shaped token — the client only decodes the payload. */
function tokenWith(payload) {
  const b64 = (o) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

/** An error shaped like the ones backendApi throws. */
const apiError = (message, status) => Object.assign(new Error(message), { status });

const USERS = [{ id: "u1", username: "ayse", full_name: "Ayşe", is_active: true, totp_enabled: false, groups: [] }];
const GROUPS = [{ id: "g1", slug: "nurse", name: "Hemşire", mfa_required: false, is_system: false, permissions: ["board.view"], member_count: 1 }];
const PERMS = [{ key: "board.view", description: "See the board" }];

function fakeApi(overrides = {}) {
  return {
    login: vi.fn(), me: vi.fn(async () => ({ id: "u-me", username: "masa", full_name: "Masa", groups: [] })),
    logout: vi.fn(), accessToken: vi.fn(() => null),
    adminUsers: vi.fn(async () => USERS),
    adminGroups: vi.fn(async () => GROUPS),
    adminPermissions: vi.fn(async () => PERMS),
    adminCreateUser: vi.fn(async () => ({})), adminUpdateUser: vi.fn(async () => ({})),
    adminSetUserGroups: vi.fn(async () => ({})), adminResetPassword: vi.fn(async () => ({ ok: true })),
    adminResetMfa: vi.fn(async () => ({ ok: true })),
    adminCreateGroup: vi.fn(async () => ({})), adminUpdateGroup: vi.fn(async () => ({})),
    adminDeleteGroup: vi.fn(async () => null),
    ...overrides,
  };
}

/** A store signed in with `perms` (a real attemptLogin over the fake API). */
async function signedInStore(perms, overrides = {}) {
  const token = tokenWith({ tenant: "t1", groups: ["x"], perms });
  const api = fakeApi({ login: vi.fn(async () => ({ access_token: token, requires_mfa: false })), ...overrides });
  const store = createLiveStore({ api, base: fakeBase() });
  await store.attemptLogin("masa", "gizli");
  return { api, store };
}

describe("liveStore — administration", () => {
  it("starts with empty admin state so the simulated staff never shows", () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    expect(store.getState().adminUsers).toEqual([]);
    expect(store.getState().adminGroups).toEqual([]);
    expect(store.getState().adminPermissions).toEqual([]);
    expect(store.getState().adminError).toBeNull();
  });

  it("loadAdmin fills users, groups and the catalogue", async () => {
    const store = createLiveStore({ api: fakeApi(), base: fakeBase() });
    const seen = vi.fn();
    store.subscribe(seen);
    await store.loadAdmin();
    const s = store.getState();
    expect(s.adminUsers[0]).toMatchObject({ username: "ayse", active: true });
    expect(s.adminGroups[0]).toMatchObject({ slug: "nurse", memberCount: 1 });
    expect(s.adminPermissions).toEqual(PERMS);
    expect(s.adminError).toBeNull();
    expect(seen).toHaveBeenCalled();
  });

  it("a refused call leaves the rest loaded and records the reason", async () => {
    const api = fakeApi({ adminGroups: vi.fn(async () => { throw apiError("permission required: groups.manage", 403); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.loadAdmin();
    expect(store.getState().adminUsers).toHaveLength(1);
    expect(store.getState().adminGroups).toEqual([]);
    expect(store.getState().adminError).toMatch(/groups.manage/);
  });

  it("a later successful load clears the recorded reason", async () => {
    const adminGroups = vi.fn()
      .mockRejectedValueOnce(apiError("İstek başarısız (503)", 503))
      .mockResolvedValue(GROUPS);
    const store = createLiveStore({ api: fakeApi({ adminGroups }), base: fakeBase() });
    await store.loadAdmin();
    expect(store.getState().adminError).toMatch(/503/);
    await store.loadAdmin();
    expect(store.getState().adminError).toBeNull();
    expect(store.getState().adminGroups).toHaveLength(1);
  });

  it("a users.manage desk is not asked for the catalogue it may not read, and sees no error", async () => {
    // GET /admin/permissions takes groups.manage; /admin/groups takes either right.
    const { api, store } = await signedInStore(["board.view", "users.manage"]);
    await store.loadAdmin();
    expect(api.adminUsers).toHaveBeenCalledTimes(1);
    expect(api.adminGroups).toHaveBeenCalledTimes(1);
    expect(api.adminPermissions).not.toHaveBeenCalled();
    expect(store.getState().adminError).toBeNull();
    expect(store.getState().adminGroups).toHaveLength(1);
  });

  it("a groups.manage desk is not asked for the users", async () => {
    const { api, store } = await signedInStore(["board.view", "groups.manage"]);
    await store.loadAdmin();
    expect(api.adminUsers).not.toHaveBeenCalled();
    expect(api.adminGroups).toHaveBeenCalledTimes(1);
    expect(api.adminPermissions).toHaveBeenCalledTimes(1);
    expect(store.getState().adminUsers).toEqual([]);
    expect(store.getState().adminError).toBeNull();
  });

  it("the session carries the user's id, for the 'not yourself' rules", async () => {
    const { store } = await signedInStore(["board.view", "users.manage"]);
    expect(store.getState().user.id).toBe("u-me");
  });

  it("saving a group creates or updates, then reloads", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.adminSaveGroup({ slug: "it", name: "BT", description: "", mfaRequired: true, permissions: ["users.manage"] });
    expect(api.adminCreateGroup).toHaveBeenCalledWith({ slug: "it", name: "BT", description: "", mfa_required: true, permissions: ["users.manage"] });
    await store.adminSaveGroup({ id: "g1", slug: "nurse", name: "Hemşire", description: "x", mfaRequired: false, permissions: ["board.view"] });
    expect(api.adminUpdateGroup).toHaveBeenCalledWith("g1", { name: "Hemşire", description: "x", mfa_required: false, permissions: ["board.view"] });
    expect(api.adminUsers).toHaveBeenCalledTimes(2);        // reloaded after each save
  });

  it("saving the system group sends only its labels: its rights and MFA rule are fixed (409)", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.adminSaveGroup({ id: "g0", slug: "hospital_admin", name: "Yönetim", description: "Kurum",
                                 isSystem: true, mfaRequired: true, permissions: ["board.view"] });
    expect(api.adminUpdateGroup).toHaveBeenCalledWith("g0", { name: "Yönetim", description: "Kurum" });
  });

  it("user actions call the API and reload", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    await store.adminSetUserGroups("u1", ["g1"]);
    await store.adminUpdateUser("u1", { is_active: false });
    await store.adminResetMfa("u1");
    await store.adminDeleteGroup("g1");
    await store.adminCreateUser({ username: "selin", full_name: "Selin", password: "Gecici-Parola-1", group_ids: [] });
    expect(api.adminSetUserGroups).toHaveBeenCalledWith("u1", ["g1"]);
    expect(api.adminUpdateUser).toHaveBeenCalledWith("u1", { is_active: false });
    expect(api.adminResetMfa).toHaveBeenCalledWith("u1");
    expect(api.adminDeleteGroup).toHaveBeenCalledWith("g1");
    expect(api.adminCreateUser).toHaveBeenCalledWith({ username: "selin", full_name: "Selin", password: "Gecici-Parola-1", group_ids: [] });
    expect(api.adminUsers).toHaveBeenCalledTimes(5);
  });

  it("a password reset calls the API and resolves to its answer (nothing on screen changes)", async () => {
    const api = fakeApi();
    const store = createLiveStore({ api, base: fakeBase() });
    expect(await store.adminResetPassword("u1", "Gecici-Parola-2")).toEqual({ ok: true });
    expect(api.adminResetPassword).toHaveBeenCalledWith("u1", "Gecici-Parola-2");
  });

  it("errors from the API propagate to the caller", async () => {
    const api = fakeApi({ adminDeleteGroup: vi.fn(async () => { throw new Error("Üyesi olan grup silinemez"); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.adminDeleteGroup("g1")).rejects.toThrow(/silinemez/);
  });

  it.each([
    ["adminSetUserGroups", ["u1", ["g0"]], 403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: groups.manage"],
    ["adminUpdateUser", ["u1", { is_active: false }], 409, "Son yönetici pasifleştirilemez"],
    ["adminUpdateUser", ["u1", { email: "x" }], 409, "Bu hesap başka bir kurumda da etkin; parola, MFA, e-posta, ad ve etkinlik buradan değiştirilemez, yalnızca bu kurumdaki grupları ayarlanabilir"],
    ["adminResetMfa", ["u-me"], 409, "Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için Hesabım > Parola değiştir'i kullanın"],
    ["adminResetPassword", ["u1", "Gecici-Parola-2"], 403, "Kendi yetkilerinizi aşan bir işlem yapılamaz: users.manage"],
    ["adminCreateUser", [{ username: "Şule" }], 422, "username: Kullanıcı adı 2-128 karakter olmalı"],
    ["adminUpdateGroup", ["g0", { permissions: [] }], 409, "Sistem grubunun izinleri ve MFA kuralı değiştirilemez"],
    ["adminDeleteGroup", ["g1"], 409, "Üyesi olan grup silinemez"],
  ])("%s %j: a %i rejects with the API's message and status, and nothing is reloaded", async (name, args, status, message) => {
    const api = fakeApi({ [name]: vi.fn(async () => { throw apiError(message, status); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    const action = name === "adminUpdateGroup" ? store.adminSaveGroup({ id: args[0], name: "x", isSystem: false, permissions: [] })
      : store[name](...args);
    const err = await action.catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(message);
    expect(err.status).toBe(status);
    expect(api.adminUsers).not.toHaveBeenCalled();
    expect(store.getState().adminError).toBeNull();          // the panel shows it, not the load banner
  });

  it("a change that went through still resolves when the reload after it fails", async () => {
    const api = fakeApi({ adminUsers: vi.fn(async () => { throw apiError("İstek başarısız (503)", 503); }) });
    const store = createLiveStore({ api, base: fakeBase() });
    await expect(store.adminResetMfa("u1")).resolves.toEqual({ ok: true });
    expect(store.getState().adminError).toMatch(/503/);
  });

  it("malformed answers load as empty lists instead of throwing", async () => {
    const api = fakeApi({ adminUsers: vi.fn(async () => null), adminGroups: vi.fn(async () => ({})) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.loadAdmin();
    expect(store.getState().adminUsers).toEqual([]);
    expect(store.getState().adminGroups).toEqual([]);
  });

  it("a slower, older load never overwrites a newer one", async () => {
    let releaseFirst;
    const adminUsers = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve([{ ...USERS[0], username: "eski" }]); }))
      .mockResolvedValue(USERS);
    const store = createLiveStore({ api: fakeApi({ adminUsers }), base: fakeBase() });
    const first = store.loadAdmin();
    await store.loadAdmin();
    releaseFirst();
    await first;
    expect(store.getState().adminUsers.map((u) => u.username)).toEqual(["ayse"]);
  });

  it("signing out clears the staff list, and a load still in flight cannot bring it back", async () => {
    let release;
    const adminUsers = vi.fn()
      .mockResolvedValueOnce(USERS)
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(USERS); }));
    const store = createLiveStore({ api: fakeApi({ adminUsers }), base: fakeBase() });
    await store.loadAdmin();
    expect(store.getState().adminUsers).toHaveLength(1);
    const pending = store.loadAdmin();
    await vi.waitFor(() => expect(adminUsers).toHaveBeenCalledTimes(2));   // the request is out
    store.logout();
    release();
    await pending;
    expect(store.getState().adminUsers).toEqual([]);
    expect(store.getState().adminGroups).toEqual([]);
    expect(store.getState().adminPermissions).toEqual([]);
    expect(store.getState().adminError).toBeNull();
  });

  it("a new sign-in starts without the previous session's staff list", async () => {
    const token = tokenWith({ tenant: "t1", groups: ["x"], perms: ["board.view", "users.manage"] });
    const api = fakeApi({ login: vi.fn(async () => ({ access_token: token, requires_mfa: false })) });
    const store = createLiveStore({ api, base: fakeBase() });
    await store.loadAdmin();
    expect(store.getState().adminUsers).toHaveLength(1);
    await store.attemptLogin("masa", "gizli");
    expect(store.getState().adminUsers).toEqual([]);
  });
});
