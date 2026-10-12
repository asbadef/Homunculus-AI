// dashboard/src/backendApi.admin.test.js — the administration and account calls of backendApi.
// Paths, bodies and answers follow homunculus-engine admin/router.py and admin/schemas.py.
// Synthetic data only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBackendApi } from "./backendApi.js";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A fetch stand-in that records calls and answers from `handler(url, init)`. */
function fakeFetch(handler) {
  return vi.fn(async (url, init = {}) => {
    const r = handler(url, init) || { status: 200, body: {} };
    return {
      ok: r.status < 400, status: r.status,
      json: async () => {
        if (r.body === undefined) throw new SyntaxError("Unexpected end of JSON input");
        return r.body;
      },
    };
  });
}

async function signedIn(handler) {
  const fetchImpl = fakeFetch((url, init) => {
    if (url === "/auth/login") return { status: 200, body: { access_token: "A", refresh_token: "R" } };
    return handler(url, init);
  });
  const api = createBackendApi({ baseUrl: "", fetchImpl });
  await api.login("admin", "pw");
  return { api, fetchImpl };
}

const lastCall = (fetchImpl) => fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
const urls = (fetchImpl) => fetchImpl.mock.calls.map(([u]) => u);

const BEYOND = "Kendi yetkilerinizi aşan bir işlem yapılamaz: groups.manage, users.manage";

describe("backendApi — admin and account calls", () => {
  it("acknowledge sends only the patient and the kind", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: {} }));
    await api.acknowledge("bed-3", "sepsis");
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/ack");
    expect(JSON.parse(init.body)).toEqual({ patient_id: "bed-3", kind: "sepsis" });
    expect(init.headers.Authorization).toBe("Bearer A");
  });

  it("acknowledge ignores a third argument: the actor comes from the token", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: {} }));
    await api.acknowledge("bed-3", "sepsis", "HOSPITAL_ADMIN");
    expect(JSON.parse(lastCall(fetchImpl)[1].body)).toEqual({ patient_id: "bed-3", kind: "sepsis" });
  });

  it("setUserGroups PUTs the group ids", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: { id: "u1" } }));
    await api.adminSetUserGroups("u1", ["g1", "g2"]);
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/admin/users/u1/groups");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ group_ids: ["g1", "g2"] });
  });

  it("a 204 from DELETE resolves to null instead of failing on an empty body", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 204, body: undefined }));
    expect(await api.adminDeleteGroup("g1")).toBeNull();
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/admin/groups/g1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("changePassword posts both passwords and keeps the fresh tokens it gets back", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: { access_token: "A2", refresh_token: "R2" } }));
    await api.changePassword("eski", "yeni-parola");
    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe("/auth/password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ current_password: "eski", new_password: "yeni-parola" });
    expect(api.accessToken()).toBe("A2");      // the change retired the old pair
  });

  it("the other admin calls hit the documented paths", async () => {
    const seen = [];
    const { api } = await signedIn((url, init) => { seen.push(`${init.method || "GET"} ${url}`); return { status: 200, body: [] }; });
    await api.adminPermissions(); await api.adminGroups(); await api.adminUsers();
    await api.adminCreateGroup({ slug: "x" }); await api.adminUpdateGroup("g", { name: "y" });
    await api.adminCreateUser({ username: "u" }); await api.adminUpdateUser("u", { is_active: false });
    await api.adminResetPassword("u", "p"); await api.adminResetMfa("u");
    expect(seen).toEqual([
      "GET /admin/permissions", "GET /admin/groups", "GET /admin/users",
      "POST /admin/groups", "PATCH /admin/groups/g",
      "POST /admin/users", "PATCH /admin/users/u",
      "POST /admin/users/u/reset-password", "POST /admin/users/u/reset-mfa",
    ]);
  });

  it("sends the bodies the admin schemas expect", async () => {
    const bodies = [];
    const { api } = await signedIn((url, init) => {
      bodies.push([url, init.body === undefined ? undefined : JSON.parse(init.body)]);
      return { status: 200, body: {} };
    });
    const group = { slug: "it_destek", name: "BT", description: "", mfa_required: true, permissions: ["users.manage"] };
    const user = { username: "selin.arslan", email: null, full_name: "Selin Arslan", password: "Gecici-Parola-1", group_ids: ["g2"] };
    await api.adminCreateGroup(group);
    await api.adminUpdateGroup("g1", { name: "Hemşire" });
    await api.adminCreateUser(user);
    await api.adminUpdateUser("u1", { email: "" });
    await api.adminResetPassword("u1", "Gecici-Parola-2");
    await api.adminResetMfa("u1");
    expect(bodies).toEqual([
      ["/admin/groups", group],
      ["/admin/groups/g1", { name: "Hemşire" }],
      ["/admin/users", user],
      ["/admin/users/u1", { email: "" }],
      ["/admin/users/u1/reset-password", { password: "Gecici-Parola-2" }],
      ["/admin/users/u1/reset-mfa", undefined],          // no body: the route takes none
    ]);
  });

  it("encodes ids into the path, so an id can never reach another route", async () => {
    const { api, fetchImpl } = await signedIn(() => ({ status: 200, body: {} }));
    await api.adminUpdateUser("../groups/x", { is_active: false });
    expect(lastCall(fetchImpl)[0]).toBe("/admin/users/..%2Fgroups%2Fx");
  });
});

describe("backendApi — admin refusals reach the caller as the API wrote them", () => {
  it.each([
    [403, BEYOND],
    [403, "permission required: users.manage"],
    [409, "Son yönetici yetkisi kaldırılamaz"],
    [409, "Kendi parolanızı veya MFA'nızı buradan sıfırlayamazsınız; parola için Hesabım > Parola değiştir'i kullanın"],
    [409, "Sistem grubunun izinleri ve MFA kuralı değiştirilemez"],
    [404, "User not found"],
  ])("%i %s: the message and the status, no refresh, the session kept", async (status, detail) => {
    const { api, fetchImpl } = await signedIn(() => ({ status, body: { detail } }));
    const err = await api.adminResetMfa("u1").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(detail);
    expect(err.status).toBe(status);
    expect(err.sessionEnded).toBeUndefined();
    expect(urls(fetchImpl)).not.toContain("/auth/refresh");
    expect(api.accessToken()).toBe("A");
  });

  it("a 422 names each field and message, and never echoes what was sent", async () => {
    // FastAPI's validation detail carries `input`: here, the temporary password itself.
    const detail = [
      { type: "value_error", loc: ["body", "username"], input: "Şule",
        msg: "Value error, Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.",
        ctx: { error: {} } },
      { type: "string_too_short", loc: ["body", "password"], input: "kisa-pw",
        msg: "String should have at least 8 characters", ctx: { min_length: 8 } },
    ];
    const { api } = await signedIn(() => ({ status: 422, body: { detail } }));
    const err = await api.adminCreateUser({ username: "Şule", password: "kisa-pw" }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe(
      "username: Kullanıcı adı 2-128 karakter olmalı; yalnızca a-z, 0-9 ve . _ @ - kullanılabilir. " +
      "Türkçe/Azerbaycanca harfleri Latin karşılığıyla yazın: ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, ə→e.; " +
      "password: String should have at least 8 characters");
    // Of `ctx`, the two numbers pydantic's own length checks state are kept — a refusal can then
    // say "at least 8 characters" in the reader's language instead of pydantic's English — and
    // nothing else of it: the value_error's `ctx.error` is gone, and so is every `input`.
    expect(err.fieldErrors).toEqual([
      { field: "username", type: "value_error", message: detail[0].msg.replace("Value error, ", "") },
      { field: "password", type: "string_too_short", message: "String should have at least 8 characters", ctx: { min_length: 8 } },
    ]);
    expect(JSON.stringify({ m: err.message, f: err.fieldErrors })).not.toContain("kisa-pw");
    expect(err.detail).toBeUndefined();
  });

  it("a 422 from the service (a plain string) stays as it is", async () => {
    const { api } = await signedIn(() => ({ status: 422, body: { detail: "unknown group for this tenant" } }));
    const err = await api.adminSetUserGroups("u1", ["g-other"]).catch((e) => e);
    expect(err.message).toBe("unknown group for this tenant");
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toBeUndefined();
  });

  it("a queued request refused as token_version refreshes once and retries with the new claims", async () => {
    // The caller was demoted while the request waited: 401 token_version, a refresh mints the
    // current rights, and the retry is judged on them (here, now refused).
    let adminCalls = 0;
    const { api, fetchImpl } = await signedIn((url, init) => {
      if (url === "/auth/refresh") return { status: 200, body: { access_token: "A2", refresh_token: "R2" } };
      adminCalls += 1;
      if (adminCalls === 1) return { status: 401, body: { detail: "token_version" } };
      return init.headers.Authorization === "Bearer A2"
        ? { status: 403, body: { detail: BEYOND } }
        : { status: 401, body: { detail: "token_version" } };
    });
    const err = await api.adminSetUserGroups("u1", ["g1"]).catch((e) => e);
    expect(urls(fetchImpl)).toEqual(["/auth/login", "/admin/users/u1/groups", "/auth/refresh", "/admin/users/u1/groups"]);
    expect(err.message).toBe(BEYOND);
    expect(err.status).toBe(403);
    expect(api.accessToken()).toBe("A2");
  });
});
