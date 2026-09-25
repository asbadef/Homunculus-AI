import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBackendApi } from "./backendApi.js";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const TOKENS = {
  access_token: "acc-1", refresh_token: "ref-1", token_type: "bearer", requires_mfa: false,
};

describe("backendApi — auth", () => {
  it("logs in against /auth/login and keeps the tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(TOKENS));
    const api = createBackendApi({ baseUrl: "https://api.test", fetchImpl: fetchMock });

    const res = await api.login("admin@demo.local", "gizli");

    expect(res.requires_mfa).toBe(false);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/auth/login");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ email: "admin@demo.local", password: "gizli" });
    expect(api.accessToken()).toBe("acc-1");
  });

  it("reports when MFA is required so the UI can show the TOTP gate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...TOKENS, requires_mfa: true }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    expect((await api.login("a@b.c", "x")).requires_mfa).toBe(true);
  });

  it("verifies a TOTP code and upgrades the stored tokens", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...TOKENS, requires_mfa: true }))
      .mockResolvedValueOnce(jsonResponse({ ...TOKENS, access_token: "acc-mfa", requires_mfa: false }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    await api.verifyTotp("123456");

    expect(fetchMock.mock.calls[1][0]).toBe("/auth/totp/verify");
    expect(api.accessToken()).toBe("acc-mfa");
  });

  it("sends the bearer token on authenticated calls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({ email: "admin@demo.local", full_name: "Yönetici" }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("admin@demo.local", "gizli");
    const me = await api.me();

    expect(me.email).toBe("admin@demo.local");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer acc-1");
  });

  it("refreshes once on a 401 and retries the original call", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))                                   // login
      .mockResolvedValueOnce(jsonResponse({ detail: "expired" }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ...TOKENS, access_token: "acc-2" }))     // refresh
      .mockResolvedValueOnce(jsonResponse({ email: "admin@demo.local" }));           // retry
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("admin@demo.local", "gizli");
    const me = await api.me();

    expect(me.email).toBe("admin@demo.local");
    expect(fetchMock.mock.calls[2][0]).toBe("/auth/refresh");
    expect(api.accessToken()).toBe("acc-2");
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer acc-2");
  });

  it("gives up (and clears the session) when the refresh itself fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }));   // refresh fails
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    await expect(api.me()).rejects.toThrow();
    expect(api.accessToken()).toBeNull();      // session cleared, UI must send the user to login
  });

  it("also clears the session when the refresh is forbidden", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403 }));   // refresh refused
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    await expect(api.me()).rejects.toThrow();
    expect(api.accessToken()).toBeNull();
  });

  it("KEEPS the session when the refresh fails with a server error", async () => {
    // An outage is not a sign-out (spec §4): the server could not answer, it did not refuse.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new SyntaxError("html"); } });
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    await expect(api.me()).rejects.toThrow(/oturumunuz açık/);
    expect(api.accessToken()).toBe("acc-1");
    expect(store.get("homunculus-refresh-token")).toBe("ref-1");
  });

  it("KEEPS the session when the refresh cannot reach the server", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));              // refresh: no network
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    await expect(api.me()).rejects.toThrow();
    expect(api.accessToken()).toBe("acc-1");
    expect(store.get("homunculus-refresh-token")).toBe("ref-1");
  });

  it.each([
    "mfa_required",
    "Hesabınıza kurum tanımlanmamış",
    "Bu kurumdaki üyeliğiniz etkin değil",
    "permission required: board.view",
  ])("never refreshes on a 403 (%s) and shows its message", async (detail) => {
    // A refresh cannot finish an MFA step, name a tenant or grant a right: it would mint the
    // same token. The session stays; the UI shows why.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({ detail }, { ok: false, status: 403 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    await expect(api.me()).rejects.toThrow(detail);
    expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain("/auth/refresh");
    expect(api.accessToken()).toBe("acc-1");
  });

  it("says the session ended when the refresh is refused", async () => {
    // The caller (restoreSession) signs out on this, and only on a refusal like it.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid or expired refresh token" }, { ok: false, status: 401 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    const err = await api.me().catch((e) => e);

    expect(err.message).toBe("Invalid or expired refresh token");
    expect(err.sessionEnded).toBe(true);
    expect(err.status).toBe(401);
  });

  it("does NOT say the session ended when the refresh could not be answered", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    const err = await api.me().catch((e) => e);

    expect(err.sessionEnded).toBeUndefined();
    expect(err.status).toBe(503);
  });

  it("an error carries the HTTP status next to the API's message", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({ detail: "permission required: alerts.ack" }, { ok: false, status: 403 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    const err = await api.acknowledge("bed-3", "sepsis").catch((e) => e);

    expect(err.message).toBe("permission required: alerts.ack");
    expect(err.status).toBe(403);
    expect(err.sessionEnded).toBeUndefined();
  });

  it.each([
    [401, "Invalid TOTP code"],
    [401, "Bu kod zaten kullanıldı; yeni kodu bekleyin."],
    [429, "Çok fazla hatalı kod. 5 dakika sonra tekrar deneyin."],
  ])("a refused TOTP code (%i) is never retried through refresh, and the session stays", async (status, detail) => {
    // /auth/totp/setup ends every earlier refresh token: a refresh here would spend a dead one
    // and sign the user out for typing a wrong code.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...TOKENS, requires_mfa: true }))
      .mockResolvedValueOnce(jsonResponse({ detail }, { ok: false, status }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("a@b.c", "x");
    const err = await api.verifyTotp("000000").catch((e) => e);

    expect(err.message).toBe(detail);
    expect(err.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain("/auth/refresh");
    expect(api.accessToken()).toBe("acc-1");
  });

  it("throws a useful error when the backend rejects the login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "Incorrect email or password" }, { ok: false, status: 401 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await expect(api.login("a@b.c", "yanlis")).rejects.toThrow(/Incorrect email or password/);
  });

  it("restores a session from storage and clears it on logout", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(TOKENS));
    const first = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await first.login("a@b.c", "x");

    const restored = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    expect(restored.accessToken()).toBe("acc-1");     // survived a page reload

    restored.logout();
    expect(restored.accessToken()).toBeNull();
    expect(createBackendApi({ baseUrl: "", fetchImpl: fetchMock }).accessToken()).toBeNull();
  });
});
