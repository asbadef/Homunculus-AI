// src/backendApi.js — client for the real Homunculus backend (FastAPI).
//
// Separate from api.js (the legacy board/ingest transport) because this one speaks the
// authenticated API: JWT login, TOTP/MFA, the account (password change), the administration API
// (/admin: users, groups, the permission catalogue — homunculus-engine admin/router.py) and —
// later — admissions, alerts and the tenant hierarchy. It holds the access/refresh pair, attaches
// the bearer header, and transparently refreshes once on a 401 so a expiring token never bounces
// the clinician to the login screen mid-shift.
//
// Every refusal rejects with the API's own message and the HTTP `status`, so a screen can show
// "Kendi yetkilerinizi aşan bir işlem yapılamaz: …" (403) or "Son yönetici yetkisi
// kaldırılamaz" (409) as the server wrote it.
//
// The base URL comes from VITE_API_URL at build time; empty means same-origin (the Vite dev
// proxy). Tokens live in localStorage so a page reload keeps the session.

const ACCESS_KEY = "homunculus-access-token";
const REFRESH_KEY = "homunculus-refresh-token";

function defaultBaseUrl() {
  try {
    return import.meta.env?.VITE_API_URL || "";
  } catch {
    return "";
  }
}

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;   // private-mode browsers can throw on access
  }
}

export function createBackendApi({ baseUrl = defaultBaseUrl(), fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const mem = { access: null, refresh: null };

  const readToken = (key, field) => {
    if (mem[field] !== null) return mem[field];
    const s = storage();
    mem[field] = s ? s.getItem(key) : null;
    return mem[field];
  };
  const accessToken = () => readToken(ACCESS_KEY, "access");
  const refreshToken = () => readToken(REFRESH_KEY, "refresh");

  function setTokens(tokens) {
    mem.access = tokens?.access_token ?? null;
    mem.refresh = tokens?.refresh_token ?? null;
    const s = storage();
    if (!s) return;
    if (mem.access) s.setItem(ACCESS_KEY, mem.access); else s.removeItem(ACCESS_KEY);
    if (mem.refresh) s.setItem(REFRESH_KEY, mem.refresh); else s.removeItem(REFRESH_KEY);
  }

  function logout() {
    setTokens(null);
  }

  async function failure(res, fallback) {
    // FastAPI reports problems as {"detail": ...}; surface it so the UI can show the real reason.
    let detail = fallback;
    let fieldErrors;
    try {
      const body = await res.json();
      if (Array.isArray(body?.detail)) {
        // A request validation error (422). Its items echo the rejected `input` — a password
        // among them — so only the field and the message are kept, never the raw detail.
        fieldErrors = validationErrors(body.detail);
        const text = fieldErrors
          .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
          .filter(Boolean).join("; ");
        if (text) detail = text;
      } else if (body?.detail) {
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      }
    } catch { /* non-JSON body — keep the fallback */ }
    // The status travels with the message, so a caller can tell a refusal (4xx) from a server
    // that could not answer (5xx) without parsing text. A network failure has no status at all.
    const err = new Error(detail);
    err.status = res.status;
    if (fieldErrors) err.fieldErrors = fieldErrors;
    return err;
  }

  function url(path) {
    return `${baseUrl}${path}`;
  }

  async function post(path, body, { auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && accessToken()) headers.Authorization = `Bearer ${accessToken()}`;
    return doFetch(url(path), { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  }

  /** Authenticated request; on a 401 it refreshes once and retries.
   *
   *  Only a 401 refreshes: a 403 (`mfa_required`, no tenant, an inactive membership, a missing
   *  permission) is something a refresh would answer with the same token, so its message goes
   *  to the caller as it is. A refresh the server REFUSES (4xx) ends the session, and the error
   *  says so (`sessionEnded`). A refresh the server could not ANSWER (5xx, or no network) keeps
   *  it: an outage never signs a clinician out, and the next request tries again. Every HTTP
   *  error carries its `status`. */
  async function authed(path, { method = "GET", body } = {}) {
    const send = () => {
      const headers = { Authorization: `Bearer ${accessToken()}` };
      const init = { method, headers };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return doFetch(url(path), init);
    };

    let res = await send();
    if (res.status === 401 && refreshToken()) {
      const refreshed = await doFetch(url("/auth/refresh"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken() }),
      });
      if (refreshed.status >= 500) {
        throw await failure(refreshed,
          "Sunucuya şu an ulaşılamıyor; oturumunuz açık, biraz sonra tekrar deneyin.");
      }
      if (!refreshed.ok) {
        logout();
        const ended = await failure(refreshed, "Oturum süresi doldu, tekrar giriş yapın.");
        ended.sessionEnded = true;   // the tokens are gone: the caller must not keep the session
        throw ended;
      }
      setTokens(await refreshed.json());
      res = await send();
    }
    if (!res.ok) throw await failure(res, `İstek başarısız (${res.status})`);
    if (res.status === 204) return null;     // DELETE answers with no body
    return res.json();
  }

  /** A path segment from an id: an id can name a record, never another route. */
  const seg = (id) => encodeURIComponent(String(id));

  return {
    accessToken,
    logout,

    /** `login` is a username or an e-mail (the API's `email` field is a legacy alias). */
    async login(login, password) {
      const res = await post("/auth/login", { login, password });
      if (!res.ok) throw await failure(res, "Giriş başarısız.");
      const tokens = await res.json();
      setTokens(tokens);
      return tokens;
    },

    /** Exchange the 6-digit authenticator code for MFA-verified tokens. */
    async verifyTotp(code) {
      const res = await post("/auth/totp/verify", { code }, { auth: true });
      if (!res.ok) throw await failure(res, "Doğrulama kodu geçersiz.");
      const tokens = await res.json();
      setTokens(tokens);
      return tokens;
    },

    /** Provisioning URI for the authenticator app (QR). */
    setupTotp() {
      return authed("/auth/totp/setup", { method: "POST" });
    },

    me() {
      return authed("/auth/me");
    },

    /** The clinical board for the caller's hospital. */
    boardPatients() {
      return authed("/patients");
    },

    /** A short-lived, single-use ticket for the SSE endpoints. */
    streamTicket() {
      return authed("/stream-ticket", { method: "POST" });
    },

    /** The actor is attributed by the API from the token; nothing about who is sent. */
    acknowledge(patientId, kind) {
      return authed("/ack", { method: "POST", body: { patient_id: patientId, kind } });
    },

    /** The change retires every existing session; the API answers with a fresh pair. */
    async changePassword(currentPassword, newPassword) {
      const tokens = await authed("/auth/password", {
        method: "POST", body: { current_password: currentPassword, new_password: newPassword },
      });
      setTokens(tokens);
      return tokens;
    },

    // ---- administration (/admin, see homunculus-engine admin/router.py) ----
    // Bodies are the admin schemas' (admin/schemas.py): GroupCreate {slug, name, description,
    // mfa_required, permissions}, GroupPatch (any of name, description, mfa_required,
    // permissions), UserCreate {username, email, full_name, password, group_ids}, UserPatch (any
    // of full_name, email — "" clears it —, is_active). Groups answer GroupOut, users UserOut.

    /** [{key, description}] — needs groups.manage. */
    adminPermissions() { return authed("/admin/permissions"); },
    /** [GroupOut] — users.manage OR groups.manage. The system group reports the whole catalogue. */
    adminGroups() { return authed("/admin/groups"); },
    adminCreateGroup(body) { return authed("/admin/groups", { method: "POST", body }); },
    adminUpdateGroup(id, body) { return authed(`/admin/groups/${seg(id)}`, { method: "PATCH", body }); },
    /** 204: resolves to null. */
    adminDeleteGroup(id) { return authed(`/admin/groups/${seg(id)}`, { method: "DELETE" }); },
    /** [UserOut] — users.manage. */
    adminUsers() { return authed("/admin/users"); },
    adminCreateUser(body) { return authed("/admin/users", { method: "POST", body }); },
    adminUpdateUser(id, body) { return authed(`/admin/users/${seg(id)}`, { method: "PATCH", body }); },
    /** Replaces the user's MANUAL memberships; directory-held ones stay. */
    adminSetUserGroups(id, groupIds) {
      return authed(`/admin/users/${seg(id)}/groups`, { method: "PUT", body: { group_ids: groupIds } });
    },
    adminResetPassword(id, password) {
      return authed(`/admin/users/${seg(id)}/reset-password`, { method: "POST", body: { password } });
    },
    adminResetMfa(id) { return authed(`/admin/users/${seg(id)}/reset-mfa`, { method: "POST" }); },

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
    request: authed,
  };
}

/** The items of a FastAPI validation error as {field, type, message}: the field is the `loc`
 *  path without "body", the message without pydantic's "Value error, " prefix. `input` and
 *  `ctx` are dropped. */
function validationErrors(detail) {
  return detail.filter((e) => e && typeof e === "object").map((e) => {
    const loc = Array.isArray(e.loc) ? e.loc.filter((p) => p !== "body") : [];
    return {
      field: loc.length ? loc.join(".") : null,
      type: typeof e.type === "string" ? e.type : null,
      message: typeof e.msg === "string" ? e.msg.replace(/^Value error, /, "") : "",
    };
  });
}

// Shared instance for the app; tests build their own with an injected fetch.
export const backendApi = createBackendApi();
