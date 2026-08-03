// src/backendApi.js — client for the real Homunculus backend (FastAPI).
//
// Separate from api.js (the legacy board/ingest transport) because this one speaks the
// authenticated API: JWT login, TOTP/MFA, and — later — admissions, alerts and the tenant
// hierarchy. It holds the access/refresh pair, attaches the bearer header, and transparently
// refreshes once on a 401 so a expiring token never bounces the clinician to the login screen
// mid-shift.
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
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* non-JSON body — keep the fallback */ }
    return new Error(detail);
  }

  function url(path) {
    return `${baseUrl}${path}`;
  }

  async function post(path, body, { auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && accessToken()) headers.Authorization = `Bearer ${accessToken()}`;
    return doFetch(url(path), { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  }

  /** Authenticated request; on a 401 it refreshes once and retries, else clears the session. */
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
      if (!refreshed.ok) {
        logout();
        throw await failure(refreshed, "Oturum süresi doldu, tekrar giriş yapın.");
      }
      setTokens(await refreshed.json());
      res = await send();
    }
    if (!res.ok) throw await failure(res, `İstek başarısız (${res.status})`);
    return res.json();
  }

  return {
    accessToken,
    logout,

    async login(email, password) {
      const res = await post("/auth/login", { email, password });
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

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
    request: authed,
  };
}

// Shared instance for the app; tests build their own with an injected fetch.
export const backendApi = createBackendApi();
