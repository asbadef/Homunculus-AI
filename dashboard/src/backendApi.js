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

    /** The clinical board for the caller's hospital, already narrowed to the caller's scope.
     *  The response also carries `scope` and `scope_note`: a board's SIZE is not self-explaining,
     *  and an empty one has to be able to say whether the ward is quiet or the scope is wrong. */
    boardPatients() {
      return authed("/patients");
    },

    /** What the caller may see, and why. */
    myScope() {
      return authed("/scope/me");
    },

    /** Replace one user's scope. `grants` is a list of `{unit_id}` / `{bed_id}` objects.
     *  Replacement, not a diff: two administrators saving diffs concurrently would merge into
     *  the union of both — the more permissive outcome, chosen by neither. */
    setScope(userId, grants) {
      return authed(`/scope/${encodeURIComponent(userId)}`, {
        method: "PUT", body: { grants },
      });
    },

    /** How many active users hold no scope at all — the administrator's to-do counter. */
    unassignedScopes() {
      return authed("/scope/unassigned");
    },

    /** A short-lived, single-use ticket for the SSE endpoints. */
    streamTicket() {
      return authed("/stream-ticket", { method: "POST" });
    },

    acknowledge(patientId, kind, role) {
      return authed("/ack", { method: "POST",
                              body: { patient_id: patientId, kind, role } });
    },

    /**
     * Record what a clinician observed — the inputs no device produces: suspected infection,
     * weight, the pressor running, the fluid given, the antibiotic administered, a GCS.
     *
     * `entries` is `[{code, value}]`; the engine fixes the unit for each code, so a caller
     * cannot chart a pressor in the wrong scale. All-or-nothing: one rejected entry rejects
     * the request, because a half-applied chart leaves nobody able to say which half landed.
     */
    chart(patientId, entries, recordedAt = null) {
      return authed(`/clinical/${encodeURIComponent(patientId)}`, {
        method: "POST",
        body: { entries, ...(recordedAt ? { recorded_at: recordedAt } : {}) },
      });
    },

    /**
     * The patient's own normal: charted comorbidities and baseline vital ranges.
     *
     * Without it every patient is judged against the population threshold, so someone whose
     * atrial fibrillation lives at 105 bpm alarms on every measurement. The boundary is always
     * the clinician's — the system never mints one.
     */
    /**
     * The engine's append-only audit for this hospital.
     *
     * This is the record a KVKK or ministry inspection asks for, and it is deliberately
     * PHI-free: names live in the encrypted identity store and never in an audit payload, so
     * these rows can be displayed and exported without carrying a patient's identity out.
     */
    audit({ patientId = null, eventType = null, limit = 200 } = {}) {
      const query = new URLSearchParams();
      if (patientId) query.set("patient_id", patientId);
      if (eventType) query.set("event_type", eventType);
      if (limit) query.set("limit", String(limit));
      const suffix = query.toString();
      return authed(`/audit${suffix ? `?${suffix}` : ""}`);
    },

    /**
     * Has this hospital's audit log been altered? The engine recomputes every seal from the
     * genesis hash forward and names the first record that fails.
     *
     * Unfiltered on purpose: a chain can only be verified as the complete run for one tenant,
     * because a filtered slice is missing its own predecessors and would report a break that is
     * not there.
     */
    /**
     * Alarm quality: of the alarms we raised, how many did a human answer and how fast.
     *
     * Computed by the engine from the durable audit log, not from live state that a restart
     * empties — a figure quoted to a hospital has to come from the record an inspection reads.
     */
    alarmQuality(days = 7) {
      return authed(`/alarm-quality?days=${encodeURIComponent(days)}`);
    },

    /**
     * The severity form, filled from the record: each organ row scored on the WORST value of the
     * window, with the measurement and timestamp behind it.
     *
     * Not the SOFA the board shows. That one reads the latest values and asks whether the patient
     * is deteriorating now; this one reads the worst and asks how sick they were over the day.
     * The two are both correct and are not the same number.
     */
    severityForm(patientId, { score = "sofa", hours = 24 } = {}) {
      return authed(`/scores/${score}/${encodeURIComponent(patientId)}?hours=${hours}`);
    },

    /**
     * Sign the form, with the clinician's corrections.
     *
     * `overrides` is `[{code, value, reason}]`. A correction replaces the VALUE — the engine
     * re-scores the row from the band table, because a typed point value would enter quality
     * reporting unbanded. The reason is mandatory and the engine enforces its length.
     */
    signSeverityForm(patientId, { score = "sofa", hours = 24, overrides = [] } = {}) {
      return authed(`/scores/${score}/${encodeURIComponent(patientId)}?hours=${hours}`, {
        method: "POST", body: { overrides },
      });
    },

    verifyAudit(limit = 10000) {
      return authed(`/audit/verify?limit=${encodeURIComponent(limit)}`);
    },

    setProfile(patientId, { comorbidities = [], baselines = {}, baselineSofa = null } = {}) {
      return authed(`/clinical/${encodeURIComponent(patientId)}/profile`, {
        method: "PUT",
        // Sent only when charted. Omitting the key means "unchanged/not stated"; sending null
        // would be indistinguishable from a physician clearing a baseline they had entered.
        body: { comorbidities, baselines,
                ...(baselineSofa === null || baselineSofa === "" ? {} : { baseline_sofa: baselineSofa }) },
      });
    },

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
    request: authed,
  };
}

// Shared instance for the app; tests build their own with an injected fetch.
export const backendApi = createBackendApi();
