import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBackendApi, REQUEST_TIMEOUT } from "./backendApi.js";

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
    // `login` takes a username or an e-mail; `email` is only the backend's legacy alias.
    expect(JSON.parse(opts.body)).toEqual({ login: "admin@demo.local", password: "gizli" });
    expect(api.accessToken()).toBe("acc-1");
  });

  it("signs in with a username as the login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(TOKENS));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });

    await api.login("selin.arslan", "gizli");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ login: "selin.arslan", password: "gizli" });
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

describe("backendApi — a server that does not answer", () => {
  // A Wi-Fi drop without a TCP reset can leave a request hanging for minutes. Every request gives
  // up after `timeoutMs` (15 s by default) with REQUEST_TIMEOUT: translated for the clinician,
  // and never a sign-out, because the server did not refuse anything.
  const hanging = () => new Promise(() => {});
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function signedIn(fetchMock, options = {}) {
    fetchMock.mockResolvedValueOnce(jsonResponse(TOKENS));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock, ...options });
    await api.login("admin", "gizli");
    return api;
  }

  it("gives up after 15 s by default, aborts the request and keeps the tokens", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockImplementationOnce(hanging);

    const call = api.me();
    const outcome = call.then(() => "answered", (err) => err);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);

    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(REQUEST_TIMEOUT);
    expect(err.status).toBeUndefined();
    expect(err.sessionEnded).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(api.accessToken()).toBe("acc-1");
  });

  it("a refresh that does not answer does not sign out either", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "token_version" }, { ok: false, status: 401 }))
      .mockImplementationOnce(hanging);

    const outcome = api.me().catch((err) => err);
    await vi.advanceTimersByTimeAsync(15_000);

    expect((await outcome).code).toBe(REQUEST_TIMEOUT);
    expect(api.accessToken()).toBe("acc-1");
  });

  it("covers the sign-in and the MFA code too", async () => {
    const fetchMock = vi.fn(hanging);
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock, timeoutMs: 1_000 });
    const login = api.login("admin", "gizli").catch((err) => err);
    const code = api.verifyTotp("123456").catch((err) => err);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await login).code).toBe(REQUEST_TIMEOUT);
    expect((await code).code).toBe(REQUEST_TIMEOUT);
  });

  it("an answer in time leaves no timer behind", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "u" }));
    await expect(api.me()).resolves.toEqual({ id: "u" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("backendApi — a newer session's tokens are never another session's to drop", () => {
  // A page loads with a stale session whose refresh the server will refuse; while that refresh is
  // in flight, someone else signs in. The late refusal belongs to the OLD session: it must not
  // drop the new session's tokens, nor put the old session's refreshed pair over them.
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  function setup({ refreshAnswer }) {
    let release;
    const fetchMock = vi.fn(async (url, init = {}) => {
      const auth = init.headers?.Authorization || "";
      if (url === "/auth/login") {
        const { login } = JSON.parse(init.body);
        return login === "a"
          ? json(200, { access_token: "A-EXPIRED", refresh_token: "A-REFRESH" })
          : json(200, { access_token: "B-ACCESS", refresh_token: "B-REFRESH" });
      }
      if (url === "/auth/refresh") {
        await new Promise((resolve) => { release = resolve; });
        return refreshAnswer;
      }
      if (url === "/auth/me") {
        return auth === "Bearer B-ACCESS" || auth === "Bearer A-FRESH"
          ? json(200, { id: auth.includes("B") ? "B" : "A" })
          : json(401, { detail: "token_version" });
      }
      return json(404, { detail: "nf" });
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    return { api, fetchMock, release: () => release() };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("a refused refresh for the old session leaves the new session's tokens in place", async () => {
    const { api, release } = setup({ refreshAnswer: json(401, { detail: "Invalid or expired refresh token" }) });
    await api.login("a", "x");
    const stale = api.me().catch((err) => err);
    await settle();
    await api.login("b", "y");                          // B signs in while A's refresh waits
    release();

    const err = await stale;
    expect(err.sessionEnded).not.toBe(true);             // A's end is not B's
    expect(err.superseded).toBe(true);
    expect(api.accessToken()).toBe("B-ACCESS");
    await expect(api.me()).resolves.toEqual({ id: "B" });
  });

  it("a granted refresh for the old session does not put its pair over the new one", async () => {
    const { api, release } = setup({ refreshAnswer: json(200, { access_token: "A-FRESH", refresh_token: "A-REFRESH-2" }) });
    await api.login("a", "x");
    const stale = api.me().catch((err) => err);
    await settle();
    await api.login("b", "y");
    release();

    expect((await stale).superseded).toBe(true);
    expect(api.accessToken()).toBe("B-ACCESS");
  });

  it("parallel requests of one session may each refresh, and all go through", async () => {
    // Refresh tokens are not single-use: requests that all met an expired token refresh side by
    // side, and none of them is "another session".
    let refreshes = 0;
    const fetchMock = vi.fn(async (url, init = {}) => {
      const auth = init.headers?.Authorization || "";
      if (url === "/auth/login") return json(200, { access_token: "OLD", refresh_token: "R" });
      if (url === "/auth/refresh") {
        refreshes += 1;
        return json(200, { access_token: `NEW-${refreshes}`, refresh_token: "R" });
      }
      return auth.startsWith("Bearer NEW") ? json(200, { ok: true }) : json(401, { detail: "token_version" });
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.login("n", "x");
    const answers = await Promise.all([api.me(), api.boardPatients(), api.adminUsers()]);
    expect(answers).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBeGreaterThan(0);
  });

  it("a 401 with no refresh token left ends the session", async () => {
    const fetchMock = vi.fn(async (url) => (url === "/auth/login"
      ? json(200, { access_token: "ONLY-ACCESS" })                    // no refresh token
      : json(401, { detail: "Invalid or missing authentication credentials" })));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.login("n", "x");

    const err = await api.boardPatients().catch((e) => e);

    expect(err.status).toBe(401);
    expect(err.sessionEnded).toBe(true);
    expect(api.accessToken()).toBeNull();
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain("/auth/refresh");
  });
});

describe("backendApi — scope assignment (until G1-12 rebuilds the screen)", () => {
  it("replaces one user's scope with PUT /scope/<id> and the grants as ScopeAssignment wants them", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({ user_id: "u-1", unrestricted: false, reason: "assigned" }));
    const api = createBackendApi({ baseUrl: "https://api.test", fetchImpl: fetchMock });
    await api.login("admin", "gizli");

    // scope/schemas.py: ScopeAssignment {grants: [ScopeGrantIn]}, each grant naming exactly one
    // of unit_id / bed_id (the other defaults to "").
    const grants = [{ unit_id: "unit-adult" }, { bed_id: "bed-a1" }];
    await api.setScope("u 1/x", grants);

    const [url, opts] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.test/scope/u%201%2Fx");   // the id is one path segment
    expect(opts.method).toBe("PUT");
    expect(opts.headers.Authorization).toBe("Bearer acc-1");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ grants: [{ unit_id: "unit-adult" }, { bed_id: "bed-a1" }] });
  });

  it("an empty list is sent as an empty scope, not left out", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.login("admin", "gizli");

    await api.setScope("u-1", []);

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ grants: [] });
  });
});
