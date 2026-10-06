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
/** Where the pair is stored: another tab's change to either is a `storage` event on that key. */
export const TOKEN_KEYS = Object.freeze({ access: ACCESS_KEY, refresh: REFRESH_KEY });

/** `err.code` of a request the server did not answer in time. */
export const REQUEST_TIMEOUT = "REQUEST_TIMEOUT";
/** How long a request waits for an answer by default. A Wi-Fi drop without a TCP reset can
 *  otherwise leave a request, and the dialog waiting on it, hanging for minutes. */
export const DEFAULT_TIMEOUT_MS = 15_000;
const TIMEOUT_MESSAGE = "Sunucu yanıt vermedi. İşlem gerçekleşmiş olabilir; listeyi kontrol edip gerekirse tekrar deneyin.";

/** `err.code` (and `err.superseded`) of a request whose session was replaced or ended while it
 *  waited for a token refresh: its answer belongs to the old session and is not applied. */
export const SESSION_SUPERSEDED = "SESSION_SUPERSEDED";
const SUPERSEDED_MESSAGE = "Bu istek önceki oturuma aitti; sonucu uygulanmadı.";

/** The longest wait a `Retry-After` can make a screen hold its button (15 minutes: the longest lock
 *  the API itself sets). */
export const RETRY_AFTER_MAX_S = 900;

// The one date shape HTTP servers send (RFC 9110 IMF-fixdate); Date.parse alone takes far too much.
const IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** `Retry-After` as seconds: whole digits, or an HTTP-date (seconds until then). Capped at
 *  RETRY_AFTER_MAX_S; anything else, and a date already past, is `undefined`. */
export function retryAfterSeconds(raw) {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  let seconds;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else if (IMF_FIXDATE.test(value)) seconds = Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, RETRY_AFTER_MAX_S) : undefined;
}

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

export function createBackendApi({ baseUrl = defaultBaseUrl(), fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fetchNow = fetchImpl || ((...args) => fetch(...args));
  const mem = { access: null, refresh: null };

  /** Run one request (its fetches and the reading of its answer) against the clock: past
   *  `timeoutMs` it is aborted and rejects with REQUEST_TIMEOUT — no `status`, never
   *  `sessionEnded`, so no caller mistakes it for a refusal and signs the clinician out. The
   *  SSE stream is an EventSource, not a request made here, and has no such limit. */
  function timed(run) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        const err = new Error(TIMEOUT_MESSAGE);
        err.code = REQUEST_TIMEOUT;
        reject(err);
      }, timeoutMs);
    });
    const doFetch = (input, init = {}) => fetchNow(input, ctrl ? { ...init, signal: ctrl.signal } : init);
    return Promise.race([Promise.resolve().then(() => run(doFetch)), expired])
      .finally(() => clearTimeout(timer));
  }

  // Storage may refuse (a private window, blocked site data, a full quota): the pair then lives in
  // memory, so the session still works in this tab, and is lost with it.
  const readToken = (key, field) => {
    if (mem[field] !== null) return mem[field];
    try {
      const s = storage();
      mem[field] = s ? s.getItem(key) : null;
    } catch {
      mem[field] = null;
    }
    return mem[field];
  };
  const accessToken = () => readToken(ACCESS_KEY, "access");
  const refreshToken = () => readToken(REFRESH_KEY, "refresh");

  // Bumped whenever the token pair is REPLACED rather than refreshed: a sign-in, the MFA step, a
  // password change (each retires or supersedes the old pair) and a sign-out. A refresh that was
  // sent under an older generation belongs to a session that is gone: whatever the server says to
  // it, the current tokens are left alone. Parallel requests of one session may each refresh (the
  // refresh token is not single-use), so a refresh does not bump it.
  let generation = 0;

  /** The pair of a new or changed session. */
  function replaceTokens(tokens) {
    generation += 1;
    setTokens(tokens);
  }

  function superseded() {
    const err = new Error(SUPERSEDED_MESSAGE);
    err.code = SESSION_SUPERSEDED;
    err.superseded = true;
    err.status = 401;
    return err;
  }

  function setTokens(tokens) {
    mem.access = tokens?.access_token ?? null;
    mem.refresh = tokens?.refresh_token ?? null;
    const s = storage();
    if (!s) return;
    const put = (key, value) => {
      try {
        if (value) s.setItem(key, value); else s.removeItem(key);
      } catch { /* refused: the memory copy above is what this tab goes on with */ }
    };
    put(ACCESS_KEY, mem.access);
    put(REFRESH_KEY, mem.refresh);
  }

  function logout() {
    generation += 1;
    setTokens(null);
  }

  /** Drop the copy of the pair held in memory, so the next request reads storage again. For a
   *  `storage` event on TOKEN_KEYS whose pair is the SAME session's (another tab refreshed it):
   *  requests in flight go on and are not rejected. Storage itself is not touched. */
  function forget() {
    mem.access = null;
    mem.refresh = null;
  }

  /** `forget()`, and the requests in flight are over: each rejects with `err.superseded === true`
   *  (and `code` SESSION_SUPERSEDED, `status` 401) — their answer belongs to a session that is gone.
   *  For when another tab signed in as someone else (the token's `sub` changed) or the tokens are
   *  gone. Callers checking an error test `err.superseded` BEFORE `err.status`. */
  function supersede() {
    generation += 1;
    forget();
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
    // A 429 says how long to wait (nginx's sign-in limit sends Retry-After: 60): whole seconds,
    // kept so a screen can hold its button that long instead of letting it be pressed again.
    const retryAfter = retryAfterSeconds(res.headers?.get?.("Retry-After"));
    if (retryAfter !== undefined) err.retryAfter = retryAfter;
    return err;
  }

  function url(path) {
    return `${baseUrl}${path}`;
  }

  function post(doFetch, path, body, { auth = false } = {}) {
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
   *  error carries its `status`. The whole exchange, refresh included, is one timed request. */
  function authed(path, options = {}) {
    return timed((doFetch) => authedOnce(doFetch, path, options));
  }

  /** Does storage now hold a refresh token other than `sent`? (Not the memory copy: that is this
   *  tab's own, and is what the other tab's `storage` event has not reached yet.) */
  function storedRefreshChanged(sent) {
    try {
      const stored = storage()?.getItem(REFRESH_KEY) ?? null;
      return stored !== null && stored !== sent;
    } catch {
      return false;
    }
  }

  async function authedOnce(doFetch, path, { method = "GET", body } = {}) {
    const gen = generation;
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
    if (res.status === 401 && gen !== generation) throw superseded();
    if (res.status === 401 && !refreshToken()) {
      // Nothing can renew this session: it has ended. Said so, so the caller signs out instead of
      // keeping a tokenless app that only ever says "reconnecting".
      logout();
      const ended = await failure(res, "Oturum süresi doldu, tekrar giriş yapın.");
      ended.sessionEnded = true;
      throw ended;
    }
    if (res.status === 401) {
      const sentRefresh = refreshToken();
      const refreshed = await doFetch(url("/auth/refresh"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: sentRefresh }),
      });
      // Another tab of this browser replaced the pair while the refresh was on its way (a password
      // change, a verified TOTP step, a new sign-in): the answer — a refusal of the retired refresh
      // token, or a grant of an older pair — is about the pair that is gone. Neither drop the newer
      // pair nor write the older one over it: take what storage holds and send the request once more.
      if (refreshed.status < 500 && gen === generation && storedRefreshChanged(sentRefresh)) {
        forget();
        res = await send();
        if (!res.ok) throw await failure(res, `İstek başarısız (${res.status})`);
        return res.status === 204 ? null : res.json();
      }
      if (refreshed.status >= 500) {
        throw await failure(refreshed,
          "Sunucuya şu an ulaşılamıyor; oturumunuz açık, biraz sonra tekrar deneyin.");
      }
      if (!refreshed.ok) {
        const ended = await failure(refreshed, "Oturum süresi doldu, tekrar giriş yapın.");
        // Signed in again (or out) while this refresh was on its way: the refusal is the old
        // session's, and the newer tokens stay.
        if (gen !== generation) throw superseded();
        logout();
        ended.sessionEnded = true;   // the tokens are gone: the caller must not keep the session
        throw ended;
      }
      const tokens = await refreshed.json();
      // Likewise a GRANTED refresh of an old session never puts its pair over a newer one.
      if (gen !== generation) throw superseded();
      setTokens(tokens);
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
    forget,
    supersede,

    /** `login` is a username or an e-mail (the API's `email` field is a legacy alias). */
    login(login, password) {
      return timed(async (doFetch) => {
        const res = await post(doFetch, "/auth/login", { login, password });
        if (!res.ok) throw await failure(res, "Giriş başarısız.");
        const tokens = await res.json();
        replaceTokens(tokens);
        return tokens;
      });
    },

    /** Exchange the 6-digit authenticator code for MFA-verified tokens. */
    verifyTotp(code) {
      return timed(async (doFetch) => {
        const res = await post(doFetch, "/auth/totp/verify", { code }, { auth: true });
        if (!res.ok) throw await failure(res, "Doğrulama kodu geçersiz.");
        const tokens = await res.json();
        replaceTokens(tokens);
        return tokens;
      });
    },

    /** Provisioning URI for the authenticator app (QR). */
    setupTotp() {
      return authed("/auth/totp/setup", { method: "POST" });
    },

    me() {
      return authed("/auth/me");
    },

    /** Unlock a locked screen with the session's own password. Through the refresh-and-retry
     *  path on purpose: a 401 here is the access token's (it expired while the screen was
     *  locked), answered before the password is looked at, so the retry is the first check. A
     *  wrong password is a 403 and is never retried. A 401 that survives that one refresh-and-retry
     *  (a superseded request aside, which carries `superseded`) means the session itself is over —
     *  an AD account disabled, expired or without an external id (Decision 4): the error carries
     *  `sessionEnded = true` and the tokens are dropped (as on every other sessionEnded path); it
     *  is not a wrong password. Resolves to {ok: true}. */
    async reauth(password) {
      try {
        return await authed("/auth/reauth", { method: "POST", body: { password } });
      } catch (err) {
        if (err?.status === 401 && !err.superseded) {
          if (!err.sessionEnded) logout();   // the other sessionEnded paths have dropped the tokens already
          err.sessionEnded = true;
        }
        throw err;
      }
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

    /** The actor is attributed by the API from the token; nothing about who is sent. */
    acknowledge(patientId, kind) {
      return authed("/ack", { method: "POST", body: { patient_id: patientId, kind } });
    },

    /** The change retires every existing session; the API answers with a fresh pair. */
    async changePassword(currentPassword, newPassword) {
      const tokens = await authed("/auth/password", {
        method: "POST", body: { current_password: currentPassword, new_password: newPassword },
      });
      // Every older session (the old refresh token included) is retired by the change: a refresh
      // still on its way with it must not undo this pair.
      replaceTokens(tokens);
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

    /**
     * Has this hospital's audit log been altered? The engine recomputes every seal from the
     * genesis hash forward and names the first record that fails.
     *
     * Unfiltered on purpose: a chain can only be verified as the complete run for one tenant,
     * because a filtered slice is missing its own predecessors and would report a break that is
     * not there.
     */
    verifyAudit(limit = 10000) {
      return authed(`/audit/verify?limit=${encodeURIComponent(limit)}`);
    },

    /**
     * The patient's own normal: charted comorbidities and baseline vital ranges.
     *
     * Without it every patient is judged against the population threshold, so someone whose
     * atrial fibrillation lives at 105 bpm alarms on every measurement. The boundary is always
     * the clinician's — the system never mints one.
     */
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
