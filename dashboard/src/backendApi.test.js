import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ADMIN_LDAP_TIMEOUT_MS, LDAP_IMPORT_CHUNK, LDAP_IMPORT_MAX, REQUEST_TIMEOUT,
  createBackendApi, retryAfterSeconds,
} from "./backendApi.js";

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

/** A JWT-shaped token (unsigned): the client reads only its `sub`. */
const jwt = (sub, n = "") => ["h", btoa(JSON.stringify({ sub, n })).replace(/=/g, "").replace(/[+]/g, "-").replace(/[/]/g, "_"), "s"].join(".");
const OLD_ACC = jwt("u1", "old");
const TAB_ACC = jwt("u1", "tab");

const TOKENS = {
  access_token: "acc-1", refresh_token: "ref-1", token_type: "bearer", requires_mfa: false,
};

describe("backendApi — locked screen and other tabs", () => {
  it("unlocks with the session's password through /auth/reauth", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    expect(await api.reauth("gizli")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/auth/reauth");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
    expect(JSON.parse(init.body)).toEqual({ password: "gizli" });
  });

  it("never sends a refused unlock again: a wrong password is a 403", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "Parola hatalı" }, { ok: false, status: 403 }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await expect(api.reauth("yanlis")).rejects.toMatchObject({ status: 403, message: "Parola hatalı" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a 429's Retry-After, in seconds", async () => {
    const res = {
      ...jsonResponse({ detail: "Çok fazla giriş denemesi; bir dakika sonra tekrar deneyin" },
        { ok: false, status: 429 }),
      headers: new Headers({ "Retry-After": "60" }),
    };
    const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn().mockResolvedValue(res) });
    await expect(api.login("ayse", "x")).rejects.toMatchObject({ status: 429, retryAfter: 60 });
  });

  it("sets no retryAfter without a usable Retry-After", async () => {
    for (const headers of [undefined, new Headers(), new Headers({ "Retry-After": "soon" })]) {
      const res = { ...jsonResponse({ detail: "x" }, { ok: false, status: 429 }), headers };
      const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn().mockResolvedValue(res) });
      const err = await api.login("ayse", "x").catch((e) => e);
      expect(err.retryAfter).toBeUndefined();
    }
  });

  it("forgets the pair it holds when another tab changed storage, and reads storage again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    store.set("homunculus-access-token", "acc-1");
    expect(api.accessToken()).toBe("acc-1");
    store.set("homunculus-access-token", "acc-other-tab");
    expect(api.accessToken()).toBe("acc-1");          // the copy in memory
    api.forget();
    expect(api.accessToken()).toBe("acc-other-tab");
    expect(store.get("homunculus-access-token")).toBe("acc-other-tab");   // storage untouched
  });
});

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

  // A route that waits on the domain controller is given longer: the API allows itself two LDAP
  // deadlines (about 20 s, 24 s at its cap), and cutting it off at 15 s would tell an administrator
  // "no answer" about an import the server then completed.
  it("a directory call waits 30 s, not 15", async () => {
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock);
    fetchMock.mockImplementationOnce(hanging);

    const outcome = api.ldapImport(["e-1"]).then(() => "answered", (err) => err);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).code).toBe(REQUEST_TIMEOUT);
  });

  it("a caller may make a call more patient, never less", async () => {
    // The client's limit is the floor: a screen cannot shorten a route's wait, only lengthen it.
    const fetchMock = vi.fn();
    const api = await signedIn(fetchMock, { timeoutMs: 15_000 });
    fetchMock.mockImplementationOnce(hanging);

    const outcome = api.request("/slow", { timeoutMs: 1 }).then(() => "answered", (err) => err);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).code).toBe(REQUEST_TIMEOUT);
  });
});

describe("backendApi — what the work screens call", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };

  it("acknowledges an alarm by patient and kind, and gets the patient's new board entry", async () => {
    const entry = { patient_id: "S-001", risk: "high", alerts: [{ kind: "sepsis", acknowledged: true }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(entry));
    const api = signedIn(fetchMock);
    expect(await api.acknowledge("S-001", "sepsis")).toEqual(entry);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/ack");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ patient_id: "S-001", kind: "sepsis" });
  });

  it("reads Aşama A's monitor strip with an authed GET /infinity-shadow/board", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ stage: "off" }));
    const api = signedIn(fetchMock);
    expect(await api.shadowBoard()).toEqual({ stage: "off" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/infinity-shadow/board");
    expect(init.method || "GET").toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
  });

  it("records that a patient was opened", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = signedIn(fetchMock);
    expect(await api.view("S-001")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/view");
    expect(JSON.parse(init.body)).toEqual({ patient_id: "S-001" });
  });

  it("lifts an account's directory sign-in throttle with the administrator's reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = signedIn(fetchMock);
    await api.adminUnlockSignIn("11111111-2222-3333-4444-555555555555", "Telefonla doğrulandı");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/admin/users/11111111-2222-3333-4444-555555555555/unlock-sign-in");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ reason: "Telefonla doğrulandı" });
  });

  it("asks the directory routes the questions the login-source screen asks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = signedIn(fetchMock);
    await api.ldapStatus();
    await api.ldapTest();
    await api.ldapSearch("ayşe");
    await api.ldapGroups("YB");
    await api.ldapMappings();
    expect(fetchMock.mock.calls.map(([url, init]) => `${init.method || "GET"} ${url}`)).toEqual([
      "GET /admin/ldap/status",
      "POST /admin/ldap/test",
      // No `limit`: the route has no such parameter and FastAPI ignored the one that used to be
      // sent, so a screen could believe it had asked for ten and be handed LDAP_SEARCH_CAP.
      "GET /admin/ldap/search?q=ay%C5%9Fe",
      // `q` is REQUIRED on both searches (2-64 characters, trimmed). The group picker used to be
      // callable with nothing, which answered 422 rather than "every group".
      "GET /admin/ldap/groups?q=YB",
      "GET /admin/ldap/group-mappings",
    ]);
  });

  it("reads one user's scope, which the scope editor needs and /scope/me cannot answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ user_id: "u-1", grants: [] }));
    const api = signedIn(fetchMock);
    await api.userScope("u 1/x");
    expect(fetchMock.mock.calls[0][0]).toBe("/scope/u%201%2Fx");
    expect(fetchMock.mock.calls[0][1].method ?? "GET").toBe("GET");
  });

  it("imports the accounts it was given, with the extra groups, and maps a group to ours", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ imported: [], skipped: [] }));
    const api = signedIn(fetchMock);
    await api.ldapImport(["e-1", "e-2"], ["g-1"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body))
      .toEqual({ external_ids: ["e-1", "e-2"], extra_group_ids: ["g-1"] });

    await api.ldapCreateMapping("CN=YB-Hekim,OU=Qruplar,DC=xh,DC=local", "g-2");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body))
      .toEqual({ ad_group_dn: "CN=YB-Hekim,OU=Qruplar,DC=xh,DC=local", group_id: "g-2" });
  });

  it("imports in chunks small enough that the server finishes inside every limit", () => {
    // The arithmetic the limits have to satisfy, from the server's own bound
    // (admin/ldap_service.py: about ceil(n / IMPORT_LOOKUPS) x 2 x the LDAP deadline, with
    // IMPORT_LOOKUPS = ADMIN_LANE_SLOTS - 1 = 2 and the deadline capped at 12 s):
    //   a chunk of 10 -> 5 waves x 24 s = 120 s, four times our own limit;
    //   a chunk of  2 -> 1 wave  x 24 s =  24 s.
    // The binding limit is not ours. nginx's /admin location sets no `proxy_read_timeout`, so its
    // 60 s default answers 504 first, and no client setting can lengthen that — which is why the
    // chunk is sized to the server's work rather than the limit raised to match the chunk.
    const WAVE_S = 24;                         // 2 x the deadline cap, one wave of IMPORT_LOOKUPS
    const NGINX_DEFAULT_S = 60;
    const worstCase = Math.ceil(LDAP_IMPORT_CHUNK / 2) * WAVE_S;
    expect(worstCase * 1000).toBeLessThanOrEqual(ADMIN_LDAP_TIMEOUT_MS);
    expect(worstCase).toBeLessThan(NGINX_DEFAULT_S);
    expect(LDAP_IMPORT_CHUNK).toBeLessThanOrEqual(LDAP_IMPORT_MAX);
  });

  it("a deleted mapping answers 204, so it resolves to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => null });
    const api = signedIn(fetchMock);
    expect(await api.ldapDeleteMapping("m-1")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/admin/ldap/group-mappings/m-1");
    expect(init.method).toBe("DELETE");
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

  // The third whole-set write's compare-and-swap (`ScopeAssignment.expected_grants`): the grants the
  // editor READ, beside the list that replaces them, so the server can refuse a save built on a
  // scope another desk has changed since (409 concurrentChange). The same contract as
  // `adminSetUserGroups`'s third argument.
  const sentScope = async (...args) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(TOKENS))
      .mockResolvedValueOnce(jsonResponse({}));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.login("admin", "gizli");
    await api.setScope(...args);
    return JSON.parse(fetchMock.mock.calls[1][1].body);
  };

  it("carries the grants the editor read as `expected_grants`, beside the new `grants`, both as given", async () => {
    expect(await sentScope("u-1", [{ unit_id: "REA-01" }, { bed_id: "REA-02-1" }], [{ unit_id: "REA-01" }])).toEqual({
      grants: [{ unit_id: "REA-01" }, { bed_id: "REA-02-1" }], expected_grants: [{ unit_id: "REA-01" }],
    });
  });

  it("without an expected list the key is ABSENT — not null, not [] — so the server reads the old body", async () => {
    for (const missing of [undefined, null]) {
      // eslint-disable-next-line no-await-in-loop
      const body = await sentScope("u-1", [{ unit_id: "REA-01" }], missing);
      expect(body, String(missing)).toEqual({ grants: [{ unit_id: "REA-01" }] });
      expect("expected_grants" in body, String(missing)).toBe(false);
    }
    expect("expected_grants" in await sentScope("u-1", [{ unit_id: "REA-01" }])).toBe(false);
  });

  it("an EMPTY expected list is sent as [] — a real expectation: \"she holds no grant\"", async () => {
    const body = await sentScope("u-1", [{ unit_id: "REA-01" }], []);
    expect(body).toEqual({ grants: [{ unit_id: "REA-01" }], expected_grants: [] });
  });
});

// The two whole-set writes of the administration screens. Each REPLACES a set on the server, so
// each also says what the screen believed the set WAS (the plan's decision X1; Task 14e makes the
// server refuse a stale one with 409 concurrentChange). These pin the bodies the server's
// `UserGroupsIn` / `GroupPatch` read: a key renamed or a list re-ordered here is a compare-and-swap
// that silently compares nothing.
describe("backendApi — the administration's whole-set writes", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "https://api.test", fetchImpl: fetchMock });
  };
  const sent = (fetchMock) => {
    const [url, init] = fetchMock.mock.calls[0];
    return { url, method: init.method, body: JSON.parse(init.body), init };
  };

  it("sets a user's groups with PUT /admin/users/<id>/groups, the id one escaped path segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "u 1/x" }));
    const api = signedIn(fetchMock);
    await api.adminSetUserGroups("u 1/x", ["g-nurse"], ["g-ward"]);
    const { url, method, init } = sent(fetchMock);
    expect(url).toBe("https://api.test/admin/users/u%201%2Fx/groups");
    expect(method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("carries the groups the screen read as `expected_group_ids`, beside the new `group_ids`, both as given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.adminSetUserGroups("u-1", ["g-ward", "g-nurse"], ["g-nurse", "g-icu"]);
    expect(sent(fetchMock).body).toEqual({
      group_ids: ["g-ward", "g-nurse"], expected_group_ids: ["g-nurse", "g-icu"],
    });
  });

  it("without an expected list the key is ABSENT — not null, not [] — so a server reads the old body", async () => {
    // `null` would be a value the server has to interpret; `[]` would claim "she holds no manual
    // group" and be refused as stale for anyone who holds one.
    for (const missing of [undefined, null]) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
      const api = signedIn(fetchMock);
      // eslint-disable-next-line no-await-in-loop
      await api.adminSetUserGroups("u-1", ["g-nurse"], missing);
      const { body } = sent(fetchMock);
      expect(body, String(missing)).toEqual({ group_ids: ["g-nurse"] });
      expect("expected_group_ids" in body, String(missing)).toBe(false);
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).adminSetUserGroups("u-1", ["g-nurse"]);
    expect("expected_group_ids" in sent(fetchMock).body).toBe(false);
  });

  it("an EMPTY expected list is sent as [] — a real expectation: \"she holds no manual group\"", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.adminSetUserGroups("u-1", ["g-nurse"], []);
    const { body } = sent(fetchMock);
    expect(body).toEqual({ group_ids: ["g-nurse"], expected_group_ids: [] });
    expect(Array.isArray(body.expected_group_ids)).toBe(true);
  });

  it("an empty NEW list is sent as [] too: removing every manual group is a write, not an omission", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).adminSetUserGroups("u-1", [], ["g-nurse"]);
    expect(sent(fetchMock).body).toEqual({ group_ids: [], expected_group_ids: ["g-nurse"] });
  });

  it("updates a group with PATCH /admin/groups/<id>, carrying `permissions` and `expected_permissions` exactly as given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "g 1/x", permissions: ["board.view"] }));
    const api = signedIn(fetchMock);
    const body = {
      permissions: ["board.view", "alerts.ack", "users.manage"],
      expected_permissions: ["alerts.ack", "board.view"],
    };
    await api.adminUpdateGroup("g 1/x", body);
    const sentNow = sent(fetchMock);
    expect(sentNow.url).toBe("https://api.test/admin/groups/g%201%2Fx");
    expect(sentNow.method).toBe("PATCH");
    // Order kept, nothing added, nothing dropped: the screen sorts its expectation, the client
    // passes it through.
    expect(sentNow.body).toEqual({
      permissions: ["board.view", "alerts.ack", "users.manage"],
      expected_permissions: ["alerts.ack", "board.view"],
    });
  });

  it("passes an EMPTY expected permission list through as [] — \"this group holds nothing\"", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).adminUpdateGroup("g-1", { permissions: ["board.view"], expected_permissions: [] });
    expect(sent(fetchMock).body).toEqual({ permissions: ["board.view"], expected_permissions: [] });
  });
});

describe("backendApi — another tab, a lock screen's 401, Retry-After, storage that refuses", () => {
  const json = (status, body, headers) => ({
    ok: status >= 200 && status < 300, status, json: async () => body, headers,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** /auth/me answers 401 to the first token and 200 to the second; the refresh waits for release(). */
  function waitingRefresh() {
    let release;
    const fetchMock = vi.fn(async (url, init = {}) => {
      const auth = init.headers?.Authorization || "";
      if (url === "/auth/refresh") {
        await new Promise((resolve) => { release = resolve; });
        return json(200, { access_token: "own-fresh", refresh_token: "own-ref-2" });
      }
      return auth === `Bearer ${OLD_ACC}` ? json(401, { detail: "x" }) : json(200, { id: "me" });
    });
    store.set("homunculus-access-token", OLD_ACC);
    store.set("homunculus-refresh-token", "old-ref");
    return { api: createBackendApi({ baseUrl: "", fetchImpl: fetchMock }), release: () => release() };
  }

  it("forget() after another tab's refresh does not end a request waiting on its own refresh", async () => {
    const { api, release } = waitingRefresh();
    const pending = api.me();
    await settle();
    store.set("homunculus-access-token", TAB_ACC);     // the other tab refreshed the same session
    store.set("homunculus-refresh-token", "tab-ref");
    api.forget();
    release();
    await expect(pending).resolves.toEqual({ id: "me" });
  });

  it("supersede() ends the requests in flight: their answer belongs to a session that is gone", async () => {
    const { api, release } = waitingRefresh();
    const pending = api.me().catch((err) => err);
    await settle();
    api.supersede();
    release();
    const err = await pending;
    expect(err.superseded).toBe(true);
    expect(err.status).toBe(401);
  });

  it("supersede() also drops the copy in memory and leaves storage alone", () => {
    store.set("homunculus-access-token", "acc-1");
    const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn() });
    expect(api.accessToken()).toBe("acc-1");
    store.set("homunculus-access-token", "acc-other");
    api.supersede();
    expect(api.accessToken()).toBe("acc-other");
    expect(store.get("homunculus-access-token")).toBe("acc-other");
  });

  const retryAfterOf = async (header) => {
    const res = json(429, { detail: "x" }, header === undefined ? undefined : new Headers({ "Retry-After": header }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn().mockResolvedValue(res) });
    return (await api.login("a", "b").catch((e) => e)).retryAfter;
  };

  it("takes Retry-After as whole seconds, capped at 15 minutes", async () => {
    expect(await retryAfterOf("60")).toBe(60);
    expect(await retryAfterOf("86400")).toBe(900);
  });

  it("takes an HTTP-date as the seconds until then: capped, never negative", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
    try {
      expect(await retryAfterOf("Sun, 04 Oct 2026 12:00:30 GMT")).toBe(30);
      expect(await retryAfterOf("Sun, 04 Oct 2026 20:00:00 GMT")).toBe(900);
      expect(await retryAfterOf("Sun, 04 Oct 2026 11:00:00 GMT")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["", "soon", "-5", "0", "1.5", "12abc", "1e3"])("reads Retry-After %j as no wait", async (header) => {
    expect(await retryAfterOf(header)).toBeUndefined();
  });

  it("a 401 from the unlock after the one refresh-and-retry means the session is over", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === "/auth/refresh") return json(200, { access_token: "fresh", refresh_token: "ref-2" });
      return json(401, { detail: "Invalid credentials" });
    });
    store.set("homunculus-access-token", "old");
    store.set("homunculus-refresh-token", "ref-1");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const err = await api.reauth("x").catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.sessionEnded).toBe(true);
    expect(fetchMock.mock.calls.filter(([u]) => u === "/auth/reauth")).toHaveLength(2);
  });

  it("an expired token is refreshed and the unlock retried once, then answered", async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/auth/refresh") return json(200, { access_token: "fresh", refresh_token: "ref-2" });
      return init.headers.Authorization === "Bearer old" ? json(401, { detail: "x" }) : json(200, { ok: true });
    });
    store.set("homunculus-access-token", "old");
    store.set("homunculus-refresh-token", "ref-1");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await expect(api.reauth("gizli")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(["/auth/reauth", "/auth/refresh", "/auth/reauth"]);
  });

  it("a wrong password (403), a timeout and a superseded unlock are not 'session ended'", async () => {
    const api = createBackendApi({
      baseUrl: "", fetchImpl: vi.fn().mockResolvedValue(json(403, { detail: "Parola hatalı" })),
    });
    store.set("homunculus-access-token", "acc");
    store.set("homunculus-refresh-token", "ref");
    expect((await api.reauth("x").catch((e) => e)).sessionEnded).toBeUndefined();
  });

  it("signs in when storage refuses writes, and keeps the pair in memory for this tab", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceeded"); },
      removeItem: () => { throw new Error("SecurityError"); },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: "acc-9", refresh_token: "ref-9" }))
      .mockResolvedValueOnce(json(200, { id: "me" }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await expect(api.login("a", "b")).resolves.toMatchObject({ access_token: "acc-9" });
    expect(api.accessToken()).toBe("acc-9");
    await expect(api.me()).resolves.toEqual({ id: "me" });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer acc-9");
    expect(() => api.logout()).not.toThrow();
    expect(api.accessToken()).toBeNull();
  });
});

describe("backendApi — another tab replaced the pair while this tab's refresh was on its way", () => {
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  function setup(refreshAnswer) {
    let release;
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/auth/refresh") {
        await new Promise((resolve) => { release = resolve; });
        return refreshAnswer;
      }
      return init.headers?.Authorization === `Bearer ${TAB_ACC}` ? json(200, { id: "me" }) : json(401, { detail: "x" });
    });
    store.set("homunculus-access-token", OLD_ACC);
    store.set("homunculus-refresh-token", "old-ref");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const otherTabSignsIn = () => {
      store.set("homunculus-access-token", TAB_ACC);
      store.set("homunculus-refresh-token", "tab-ref");
    };
    return { api, fetchMock, release: () => release(), otherTabSignsIn };
  }

  it("a refusal of the old refresh token (the password was changed elsewhere) does not sign this browser out", async () => {
    const { api, fetchMock, release, otherTabSignsIn } = setup(json(401, { detail: "Invalid or expired refresh token" }));
    const pending = api.me();
    await settle();
    otherTabSignsIn();
    release();
    await expect(pending).resolves.toEqual({ id: "me" });
    expect(store.get("homunculus-access-token")).toBe(TAB_ACC);
    expect(store.get("homunculus-refresh-token")).toBe("tab-ref");
    expect(fetchMock.mock.calls.at(-1)[1].headers.Authorization).toBe(`Bearer ${TAB_ACC}`);
  });

  it("a granted refresh of the old pair (MFA verified elsewhere) does not overwrite the newer pair", async () => {
    const { api, release, otherTabSignsIn } = setup(json(200, { access_token: "unverified-acc", refresh_token: "unverified-ref" }));
    const pending = api.me();
    await settle();
    otherTabSignsIn();
    release();
    await expect(pending).resolves.toEqual({ id: "me" });
    expect(store.get("homunculus-access-token")).toBe(TAB_ACC);
    expect(store.get("homunculus-refresh-token")).toBe("tab-ref");
    expect(api.accessToken()).toBe(TAB_ACC);
  });

  it("with no other tab involved a refused refresh still ends the session", async () => {
    const { api, release } = setup(json(401, { detail: "Invalid or expired refresh token" }));
    const pending = api.me().catch((e) => e);
    await settle();
    release();
    expect((await pending).sessionEnded).toBe(true);
    expect(store.has("homunculus-refresh-token")).toBe(false);
  });

  it("retries the original request only once", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === "/auth/refresh") {
        store.set("homunculus-access-token", TAB_ACC);     // the other tab signs in meanwhile
        store.set("homunculus-refresh-token", "tab-ref");
        return json(401, { detail: "x" });
      }
      return json(401, { detail: "still no" });
    });
    store.set("homunculus-access-token", OLD_ACC);
    store.set("homunculus-refresh-token", "old-ref");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    expect((await api.me().catch((e) => e)).status).toBe(401);
    expect(fetchMock.mock.calls.filter(([u]) => u === "/auth/me")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([u]) => u === "/auth/refresh")).toHaveLength(1);
  });
});

describe("backendApi — Retry-After's date form is the strict IMF-fixdate", () => {
  it.each([
    "Later, 2030", "Sun Oct  4 12:00:30 2026", "Sunday, 04-Oct-26 12:00:30 GMT", "Sun, 4 Oct 2026 12:00:30 GMT",
    "Sun, 04 Oct 2026 12:00:30", "Sun, 04 Oct 2026 12:00:30 UTC", "Soon, 04 Oct 2026 12:00:30 GMT",
  ])("reads %j as no wait", (value) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T11:00:00Z"));
    try {
      expect(retryAfterSeconds(value)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the IMF-fixdate as seconds until then", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
    try {
      expect(retryAfterSeconds("Sun, 04 Oct 2026 12:00:30 GMT")).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("backendApi — an unlock refused with a final 401 ends the session here too", () => {
  it("drops the tokens, as every other sessionEnded path does", async () => {
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const fetchMock = vi.fn(async (url) => (url === "/auth/refresh"
      ? json(200, { access_token: "fresh", refresh_token: "ref-2" })
      : json(401, { detail: "Invalid credentials" })));
    store.set("homunculus-access-token", "old");
    store.set("homunculus-refresh-token", "ref-1");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const err = await api.reauth("x").catch((e) => e);
    expect(err.sessionEnded).toBe(true);
    expect(api.accessToken()).toBeNull();
    expect(store.has("homunculus-access-token")).toBe(false);
    expect(store.has("homunculus-refresh-token")).toBe(false);
  });

  it("a wrong password (403) leaves the session alone", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({ detail: "Parola hatalı" }),
    });
    store.set("homunculus-access-token", "acc");
    store.set("homunculus-refresh-token", "ref");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.reauth("x").catch(() => {});
    expect(store.get("homunculus-access-token")).toBe("acc");
  });
});

describe("backendApi — another ACCOUNT signed in elsewhere while this tab's refresh was on its way", () => {
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const X_ACC = jwt("user-x", "1");
  const Y_ACC = jwt("user-y", "1");

  function setup({ refreshAnswer = json(401, { detail: "Invalid or expired refresh token" }), sameAccount = false, access = X_ACC } = {}) {
    let release;
    const sent = [];
    const fetchMock = vi.fn(async (url, init = {}) => {
      sent.push([url, init.headers?.Authorization ?? null]);
      if (url === "/auth/refresh") {
        await new Promise((resolve) => { release = resolve; });
        return refreshAnswer;
      }
      return init.headers?.Authorization === `Bearer ${access}` ? json(401, { detail: "x" }) : json(200, { ok: true, id: "me" });
    });
    store.set("homunculus-access-token", access);
    store.set("homunculus-refresh-token", "x-ref");
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const otherTab = () => {
      store.set("homunculus-access-token", sameAccount ? jwt("user-x", "2") : Y_ACC);
      store.set("homunculus-refresh-token", sameAccount ? "x-ref-2" : "y-ref");
    };
    return { api, sent, release: () => release(), otherTab };
  }

  it("a read request is rejected as superseded: nothing is sent with the other account's token, storage keeps its pair", async () => {
    const { api, sent, release, otherTab } = setup();
    const pending = api.me().catch((e) => e);
    await settle();
    otherTab();
    release();
    const err = await pending;
    expect(err.superseded).toBe(true);
    expect(sent.some(([, auth]) => auth === `Bearer ${Y_ACC}`)).toBe(false);
    expect(store.get("homunculus-access-token")).toBe(Y_ACC);
    expect(store.get("homunculus-refresh-token")).toBe("y-ref");
  });

  it("a granted refresh of the old pair is not written over the other account's pair either", async () => {
    const { api, sent, release, otherTab } = setup({ refreshAnswer: json(200, { access_token: "x-fresh", refresh_token: "x-ref-9" }) });
    const pending = api.me().catch((e) => e);
    await settle();
    otherTab();
    release();
    expect((await pending).superseded).toBe(true);
    expect(sent.some(([, auth]) => auth === `Bearer ${Y_ACC}`)).toBe(false);
    expect(store.get("homunculus-refresh-token")).toBe("y-ref");
  });

  it("an unlock never takes the discard-and-retry path, even for the same account: the password is sent once", async () => {
    const { api, sent, release, otherTab } = setup({ sameAccount: true });
    const pending = api.reauth("secret").catch((e) => e);
    await settle();
    otherTab();
    release();
    const err = await pending;
    expect(err.superseded).toBe(true);
    expect(err.sessionEnded).toBeUndefined();
    expect(sent.filter(([url]) => url === "/auth/reauth")).toHaveLength(1);
    expect(store.get("homunculus-refresh-token")).toBe("x-ref-2");     // not logged out
  });

  it("neither does a password change", async () => {
    const { api, sent, release, otherTab } = setup({ sameAccount: true });
    const pending = api.changePassword("old", "newnewnew").catch((e) => e);
    await settle();
    otherTab();
    release();
    expect((await pending).superseded).toBe(true);
    expect(sent.filter(([url]) => url === "/auth/password")).toHaveLength(1);
    expect(store.get("homunculus-refresh-token")).toBe("x-ref-2");
  });

  it("a token that cannot be read is not assumed to be the same account", async () => {
    const { api, release, otherTab } = setup({ access: "opaque-token", sameAccount: true });
    const pending = api.me().catch((e) => e);
    await settle();
    otherTab();
    release();
    expect((await pending).superseded).toBe(true);
  });
});

describe("backendApi — a pair answered after its session ended is never written", () => {
  // A sign-out, a step backed out of, another tab's sign-out or sign-in: whatever ended the session
  // a sign-in, a TOTP step, a password change or a refresh was sent for, its answer arrives later
  // and must not put a pair back into a browser that has just been emptied.
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Every `path` answer waits for release(); everything else answers `ok`. */
  function waiting(path, answer) {
    let release;
    const fetchMock = vi.fn(async (url) => {
      if (url === path) {
        await new Promise((resolve) => { release = resolve; });
        return answer;
      }
      return json(200, { ok: true });
    });
    return { fetchMock, release: () => release() };
  }

  it("a sign-in answered after a sign-out", async () => {
    const { fetchMock, release } = waiting("/auth/login", json(200, { access_token: "late-acc", refresh_token: "late-ref" }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const pending = api.login("ayse", "x").catch((e) => e);
    await settle();
    api.logout();
    release();
    const err = await pending;
    expect(err.superseded).toBe(true);
    expect(store.size).toBe(0);
    expect(api.accessToken()).toBeNull();
  });

  it("a TOTP step answered after it was backed out of", async () => {
    store.set("homunculus-access-token", jwt("u1", "pending"));
    store.set("homunculus-refresh-token", "pending-ref");
    const { fetchMock, release } = waiting("/auth/totp/verify", json(200, { access_token: "verified-acc", refresh_token: "verified-ref" }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const pending = api.verifyTotp("123456").catch((e) => e);
    await settle();
    api.logout();
    release();
    expect((await pending).superseded).toBe(true);
    expect(store.size).toBe(0);
  });

  it("a password change answered after another tab's account took over (supersede)", async () => {
    store.set("homunculus-access-token", OLD_ACC);
    store.set("homunculus-refresh-token", "old-ref");
    const { fetchMock, release } = waiting("/auth/password", json(200, { access_token: "changed-acc", refresh_token: "changed-ref" }));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const pending = api.changePassword("Gecici-1", "Kendi-Sifrem-9").catch((e) => e);
    await settle();
    store.set("homunculus-access-token", TAB_ACC);       // another account signed in in another tab
    store.set("homunculus-refresh-token", "tab-ref");
    api.supersede();
    release();
    expect((await pending).superseded).toBe(true);
    expect(store.get("homunculus-access-token")).toBe(TAB_ACC);
    expect(store.get("homunculus-refresh-token")).toBe("tab-ref");
  });

  it.each([
    ["granted", json(200, { access_token: "fresh-acc", refresh_token: "fresh-ref" })],
    ["refused", json(401, { detail: "Invalid or expired refresh token" })],
  ])("a refresh %s after another tab signed out writes nothing back and ends nothing here", async (_, answer) => {
    store.set("homunculus-access-token", OLD_ACC);
    store.set("homunculus-refresh-token", "old-ref");
    let release;
    const fetchMock = vi.fn(async (url) => {
      if (url === "/auth/refresh") {
        await new Promise((resolve) => { release = resolve; });
        return answer;
      }
      return json(401, { detail: "x" });
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    const pending = api.boardPatients().catch((e) => e);
    await settle();
    store.delete("homunculus-access-token");             // the other tab signed out
    store.delete("homunculus-refresh-token");
    release();
    const err = await pending;
    expect(err.superseded).toBe(true);
    expect(err.sessionEnded).toBeUndefined();
    expect(store.size).toBe(0);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/patients")).toHaveLength(1);
  });

  it("a browser whose storage refused the pair is not taken for one signed out elsewhere", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {},
    });
    let refreshed = false;
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === "/auth/login") return json(200, { access_token: "mem-acc", refresh_token: "mem-ref" });
      if (url === "/auth/refresh") { refreshed = true; return json(200, { access_token: "mem-acc-2", refresh_token: "mem-ref-2" }); }
      return init.headers?.Authorization === "Bearer mem-acc-2" ? json(200, { id: "me" }) : json(401, { detail: "x" });
    });
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    await api.login("ayse", "x");
    await expect(api.me()).resolves.toEqual({ id: "me" });
    expect(refreshed).toBe(true);
    expect(api.accessToken()).toBe("mem-acc-2");
  });
});

// Every answer states the server's clock in its `Date` header (RFC 9110 requires it of an origin
// server), so the client can tell how far the browser's clock is out without a new endpoint and
// without a field in the board payload. It matters because the screens age the engine's timestamps:
// a tablet eight minutes behind draws every reading eight minutes fresher than it is.
describe("backendApi — the server's clock", () => {
  const dated = (body, date) => ({
    ...jsonResponse(body),
    headers: { get: (k) => (k === "Date" ? date : null) },
  });
  const signedIn = () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
  };

  it("is unknown before any answer — null, not 0", () => {
    // "We have not measured the skew" and "there is no skew" are different statements, and only
    // one of them licenses correcting an age by 0.
    const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn() });
    expect(api.serverClockSkewMs()).toBeNull();
  });

  it("reads the Date header, as server minus browser", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T10:00:00Z"));
    try {
      signedIn();
      const fetchMock = vi.fn().mockResolvedValue(dated({ ok: true }, "Thu, 08 Oct 2026 10:08:00 GMT"));
      const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(8 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a skew smaller than a couple of seconds as none at all", async () => {
    // `Date` is second-granular, so a correctly-set device measures roughly minus the latency and
    // minus up to a second of truncation. Injected raw, that jitter makes a visible m:ss counter
    // repeat or skip a second. Below the noise floor the honest answer is 0.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T10:00:00Z"));
    try {
      signedIn();
      const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn()
        .mockResolvedValueOnce(dated({ ok: true }, "Thu, 08 Oct 2026 09:59:59 GMT"))
        .mockResolvedValueOnce(dated({ ok: true }, "Thu, 08 Oct 2026 10:00:01 GMT")) });
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(0);
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rounds a real skew to the whole second it was measured in", async () => {
    // The header states seconds; reporting milliseconds off it would be precision we do not have.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T10:00:00.400Z"));
    try {
      signedIn();
      const api = createBackendApi({ baseUrl: "", fetchImpl: vi.fn()
        .mockResolvedValue(dated({ ok: true }, "Thu, 08 Oct 2026 10:08:00 GMT")) });
      await api.reauth("gizli");
      expect(api.serverClockSkewMs() % 1000).toBe(0);
      expect(api.serverClockSkewMs()).toBe(8 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps what it knew when a header is missing or unreadable — a proxy may strip it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T10:00:00Z"));
    try {
      signedIn();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(dated({ ok: true }, "Thu, 08 Oct 2026 09:55:00 GMT"))
        .mockResolvedValueOnce(jsonResponse({ ok: true }))
        .mockResolvedValueOnce(dated({ ok: true }, "not a date"));
      const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
      await api.reauth("gizli");
      expect(api.serverClockSkewMs()).toBe(-5 * 60 * 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("backendApi — the trend charts and the patient's own normal (Group 2 · slice 1)", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };

  it("reads one patient's trends with an authed GET, the window in the query", async () => {
    const answer = { patient_id: "S 1/x", hours: 72, channels: [], markers: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer));
    expect(await signedIn(fetchMock).patientTrends("S 1/x", 72)).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/patients/S%201%2Fx/trends?hours=72");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer acc-1");
  });

  it("asks for the 24-hour window when none is named", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).patientTrends("S-001");
    expect(fetchMock.mock.calls[0][0]).toBe("/patients/S-001/trends?hours=24");
  });

  it("a refused read carries the API's own message and status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ detail: "hasta bulunamadı" }, { ok: false, status: 404 }));
    await expect(signedIn(fetchMock).patientTrends("S-999", 24))
      .rejects.toMatchObject({ status: 404, message: "hasta bulunamadı" });
  });

  it("writes the patient's own normal with exactly the body it was given — no comorbidities key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ patient_id: "S-001" }));
    const body = { baselines: { heart_rate: { low: 100, high: 115 } } };
    await signedIn(fetchMock).putPatientProfile("S-001", body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/clinical/S-001/profile");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("sends a window the server does not offer as it was named — refusing it (400) is the server's job", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).patientTrends("S-001", 12);
    expect(fetchMock.mock.calls[0][0]).toBe("/patients/S-001/trends?hours=12");
  });

  it("setProfile sends comorbidities: [] and baselines: {} even when given only a baseline SOFA — why nothing new calls it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await signedIn(fetchMock).setProfile("S-001", { baselineSofa: 3 });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.comorbidities).toEqual([]);
    expect(sent.baselines).toEqual({});
    expect(sent.baseline_sofa).toBe(3);
  });

  it("a trends read that gets no answer gives up after 15 s, as every read does", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(() => new Promise(() => {}));
      const outcome = signedIn(fetchMock).patientTrends("S-001", 24).then(() => "answered", (err) => err);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(await Promise.race([outcome, Promise.resolve("pending")])).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect((await outcome).code).toBe(REQUEST_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });
});

// G2-B1a
describe("backendApi — Hasta Kabul: admission, discharge, the structure and the bed release", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };
  const sent = (fetchMock, at = 0) => {
    const [url, init] = fetchMock.mock.calls[at];
    return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) };
  };

  it("a refusal with a code carries the code beside the server's words", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { detail: { code: "bed_not_available", message: "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit." } },
      { ok: false, status: 409 }));
    await expect(signedIn(fetchMock).admit({ patient: {}, note: {} })).rejects.toMatchObject({
      status: 409, apiCode: "bed_not_available",
      message: "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
    });
  });

  // A-19, A-29: the earlier admission's number travels beside the code — and nothing else the
  // detail might hold: a name is never carried onto the error.
  it("a request_conflict carries the earlier admission's number, and only that, beside its code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: {
      code: "request_conflict", message: "This request id came before with another admission form.",
      patient_number: "H2600042", display_name: "Sentetik Hasta",
    } }, { ok: false, status: 409 }));
    const err = await signedIn(fetchMock).admit({ patient: {}, note: {} }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, apiCode: "request_conflict", patientNumber: "H2600042" });
    expect(JSON.stringify(Object.entries(err))).not.toContain("Sentetik");
    // a number that is not a string is not one
    const odd = vi.fn().mockResolvedValue(jsonResponse({ detail: { code: "request_conflict", message: "x", patient_number: 42 } },
      { ok: false, status: 409 }));
    expect((await signedIn(odd).admit({}).catch((e) => e)).patientNumber).toBeUndefined();
  });

  it("a refusal without a code has none, as before", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "Admission not found." }, { ok: false, status: 404 }));
    const err = await signedIn(fetchMock).signOffAdmission("a-1").catch((e) => e);
    expect(err.message).toBe("Admission not found.");
    expect(err.apiCode).toBeUndefined();
  });

  it("reads the structure and the admissions of the named states", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = signedIn(fetchMock);
    await api.structure();
    await api.admissions(["DRAFT", "ACTIVE"]);
    await api.admissions();
    expect(sent(fetchMock, 0)).toEqual({ url: "/tenant/structure", method: "GET", body: undefined });
    expect(sent(fetchMock, 1).url).toBe("/admissions?state=DRAFT&state=ACTIVE");
    expect(sent(fetchMock, 2).url).toBe("/admissions");
  });

  it("takes one state as a string, and null as no state at all (A-9)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = signedIn(fetchMock);
    await api.admissions("DRAFT");
    await api.admissions(null);
    expect(sent(fetchMock, 0).url).toBe("/admissions?state=DRAFT");
    expect(sent(fetchMock, 1).url).toBe("/admissions");
  });

  it("admits, signs, starts and confirms a discharge, and releases a bed, each by its own route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.admit({ patient: { display_name: "Sentetik" }, note: {} });
    await api.signOffAdmission("a 1");
    await api.startDischarge("a-1", { disposition: "HOME" });
    await api.confirmDischarge("a-1");
    await api.releaseBed("b/1");
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["POST", "/admissions"], ["POST", "/admissions/a%201/sign-off"],
      ["POST", "/admissions/a-1/discharge/initiate"], ["POST", "/admissions/a-1/discharge/confirm"],
      ["POST", "/tenant/beds/b%2F1/release"],
    ]);
    expect(sent(fetchMock, 0).body).toEqual({ patient: { display_name: "Sentetik" }, note: {} });
    expect(sent(fetchMock, 2).body).toEqual({ disposition: "HOME" });
  });

  it("builds the structure under its parents and renames, closes and reopens by PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.createSite("t-1", { name: "Ana bina" });
    await api.createUnit("s-1", { name: "Reanimasiya", unit_type: "ADULT_ICU" });
    await api.createRoom("u-1", { name: "Otaq 1" });
    await api.createBed("r-1", { label: "1" });
    await api.patchUnit("u-1", { name: "Rea" });
    await api.patchRoom("r-1", { is_active: false });
    await api.patchBed("b-1", { is_active: true });
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["POST", "/tenant/tenants/t-1/sites"], ["POST", "/tenant/sites/s-1/units"],
      ["POST", "/tenant/units/u-1/rooms"], ["POST", "/tenant/rooms/r-1/beds"],
      ["PATCH", "/tenant/units/u-1"], ["PATCH", "/tenant/rooms/r-1"], ["PATCH", "/tenant/beds/b-1"],
    ]);
    // Each write carries its own body, as given (A-9).
    expect(fetchMock.mock.calls.map((_, at) => sent(fetchMock, at).body)).toEqual([
      { name: "Ana bina" }, { name: "Reanimasiya", unit_type: "ADULT_ICU" }, { name: "Otaq 1" }, { label: "1" },
      { name: "Rea" }, { is_active: false }, { is_active: true },
    ]);
  });
});
