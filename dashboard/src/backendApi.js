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
/** How long a call that waits on the domain controller waits (`/admin/ldap/*`). One LOOKUP answers
 *  within two LDAP deadlines — about 20 s with the API's defaults, 24 s at its cap (`DEADLINE_CAP_S`
 *  = 12) — and the client's usual 15 s would cut it off while the server was still working, leaving
 *  an administrator told "no answer" about work that then landed. 30 s: past the server's own cap
 *  for one wave of lookups, so the answer a screen shows is the server's.
 *
 *  It is NOT the bound on a whole import, which is why `LDAP_IMPORT_CHUNK` is what it is. */
export const ADMIN_LDAP_TIMEOUT_MS = 30_000;
/** The most accounts one `/admin/ldap/import` call takes (the API's own cap). */
export const LDAP_IMPORT_MAX = 50;
/**
 * How many accounts a screen sends per import call.
 *
 * An import is NOT bounded by one lookup's deadline: the server runs `IMPORT_LOOKUPS` of them at a
 * time (`ADMIN_LANE_SLOTS - 1` = 2, deliberately one fewer than the admin lane so an
 * administrator's search still finds a place), so n accounts take about
 * `ceil(n / 2) x 2 x the deadline` against a slow domain controller — up to 24 s per wave.
 *
 * Two is therefore one wave, ~24 s worst case, inside both this client's 30 s and — the limit that
 * actually binds — nginx's 60 s `proxy_read_timeout` default, which the `/admin` location does not
 * override and which no client setting can lengthen. A chunk of ten would be five waves and about
 * 120 s: nginx would answer 504 first, and the screen would report "no answer" for accounts the
 * server then created. The chunk is sized to the server's work rather than the limits raised to
 * match the chunk, because only one of the three limits is ours.
 *
 * The cost is more round trips, which is the right trade: the import is idempotent (an account
 * already here comes back under `skipped`), so a failed chunk costs only that chunk and can simply
 * be sent again, and the panel can show progress per chunk instead of one long wait.
 */
export const LDAP_IMPORT_CHUNK = 2;
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

/** The `sub` claim of a JWT access token, or null. Read for comparison only — never trusted: the
 *  server checks the signature. */
function subOf(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof claims?.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
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

  /** How far this browser's clock is from the server's, in milliseconds (server minus browser),
   *  read from the `Date` header of the last answer: positive when the browser is behind.
   *
   *  It is captured here, in the one place every request passes through, because every HTTP
   *  response already states the server's clock — RFC 9110 requires an origin server to send
   *  `Date` — so no new endpoint and no new field in the board payload is needed to know it. And
   *  it has to be known: the screens age the engine's timestamps against the BROWSER's clock, and
   *  a ward tablet whose clock is eight minutes slow draws every reading eight minutes fresher
   *  than it is. "Measured 1 min ago" is the most reassuring sentence this interface can print,
   *  and it must not be a tablet's wrong clock saying it.
   *
   *  Deliberately crude: half the round trip is not subtracted and the readings are not smoothed.
   *  This is not a time service. It exists so an age is off by the server's view instead of the
   *  browser's, and so Group 2 can warn about a badly-set device; a few hundred milliseconds of
   *  network is noise beside the minutes that would matter. `null` until an answer has been seen —
   *  which is not 0: "we do not know the skew" and "there is no skew" are different statements.
   *
   *  Hence the noise floor and the rounding, which the sentence above promises and which are not
   *  cosmetic. `Date` is second-granular, so a correctly-set device measures roughly minus the
   *  latency and minus up to a second of the header's own truncation — a non-zero reading from a
   *  clock that is right. Injected raw into `useBoardNow`, that jitter changes the instant every
   *  screen subtracts from on every answer, so a visible `m:ss` counter repeats or skips a second
   *  while nothing is wrong. Below SKEW_NOISE_MS the honest answer is 0, and above it the figure is
   *  rounded to the second it was actually measured in, because the header states no more than
   *  that. The large-skew behaviour — the case this exists for — is unchanged. */
  const SKEW_NOISE_MS = 2_000;
  let clockSkewMs = null;
  function noteServerDate(res) {
    const header = res?.headers?.get?.("Date");
    if (header) {
      const server = Date.parse(header);
      if (Number.isFinite(server)) {
        const raw = server - Date.now();
        clockSkewMs = Math.abs(raw) < SKEW_NOISE_MS ? 0 : Math.round(raw / 1000) * 1000;
      }
    }
    return res;
  }

  /** Run one request (its fetches and the reading of its answer) against the clock: past
   *  `timeoutMs` it is aborted and rejects with REQUEST_TIMEOUT — no `status`, never
   *  `sessionEnded`, so no caller mistakes it for a refusal and signs the clinician out. The
   *  SSE stream is an EventSource, not a request made here, and has no such limit.
   *
   *  `ms` overrides the client's own limit for ONE call. A route that waits on something outside
   *  this system needs it: the directory routes (`/admin/ldap/*`) may take two LDAP deadlines —
   *  about 20 s with the API's defaults, 24 s at most — so the 15 s that is right for every other
   *  route would cut them off while the server was still working. Only longer than the client's
   *  limit is honoured: a caller cannot make a route impatient, only patient. */
  function timed(run, ms) {
    const limit = Number.isFinite(ms) && ms > timeoutMs ? ms : timeoutMs;
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        const err = new Error(TIMEOUT_MESSAGE);
        err.code = REQUEST_TIMEOUT;
        reject(err);
      }, limit);
    });
    const doFetch = (input, init = {}) =>
      Promise.resolve(fetchNow(input, ctrl ? { ...init, signal: ctrl.signal } : init)).then(noteServerDate);
    return Promise.race([Promise.resolve().then(() => run(doFetch)), expired])
      .finally(() => clearTimeout(timer));
  }

  // Storage may refuse (a private window, blocked site data, a full quota): the pair then lives in
  // memory, so the session still works in this tab, and is lost with it.
  //
  // `refreshStored`: the refresh token this tab holds is the one in storage (read from it, or
  // written to it). Only then does an empty key mean that another tab removed it — signed out —
  // rather than that this browser never kept it.
  let refreshStored = false;
  const readToken = (key, field) => {
    if (mem[field] !== null) return mem[field];
    try {
      const s = storage();
      mem[field] = s ? s.getItem(key) : null;
    } catch {
      mem[field] = null;
    }
    if (field === "refresh") refreshStored = mem.refresh !== null;
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
    refreshStored = false;
    const s = storage();
    if (!s) return;
    const put = (key, value) => {
      try {
        if (value) s.setItem(key, value); else s.removeItem(key);
        return true;
      } catch {
        return false;   // refused: the memory copy above is what this tab goes on with
      }
    };
    put(ACCESS_KEY, mem.access);
    refreshStored = put(REFRESH_KEY, mem.refresh) && mem.refresh !== null;
  }

  /** The new pair of a sign-in, a TOTP step or a password change sent under generation `gen` —
   *  unless the session it was sent for ended (or was replaced) while it was on its way: a sign-out,
   *  a step backed out of, another tab's sign-out or account (`logout`, `supersede`). Such a pair
   *  belongs to nobody now; written, a reload or another tab's storage event would open it again. */
  function acceptTokens(gen, tokens) {
    if (gen !== generation) throw superseded();
    replaceTokens(tokens);
    return tokens;
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
    return timed((doFetch) => authedOnce(doFetch, path, options), options.timeoutMs);
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

  /** Has another tab removed the refresh token this tab holds from storage (signed out there)?
   *  Never for a browser that did not keep it in storage in the first place. */
  function storedRefreshGone() {
    if (!refreshStored) return false;
    try {
      const s = storage();
      return s !== null && s.getItem(REFRESH_KEY) === null;
    } catch {
      return false;
    }
  }

  /** Does storage hold an access token of the account `sent` belongs to? Both must be readable
   *  JWTs with the same `sub`: a token that cannot be read is never assumed to be the same account. */
  function storedAccessIsSameAccount(sent) {
    let stored = null;
    try {
      stored = storage()?.getItem(ACCESS_KEY) ?? null;
    } catch {
      return false;
    }
    const a = subOf(sent);
    return a !== null && a === subOf(stored);
  }

  async function authedOnce(doFetch, path, { method = "GET", body, credential = false } = {}) {
    const gen = generation;
    let sentAccess = null;
    const send = () => {
      sentAccess = accessToken();
      const headers = { Authorization: `Bearer ${sentAccess}` };
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
      // Another tab signed out while the refresh was on its way: whatever the answer — a granted
      // pair, a refusal — it is about a session that is over. Nothing is written back (a reload or
      // that tab's storage event would open the session again) and nothing is dropped twice; the
      // `storage` event ends the session here.
      if (storedRefreshGone()) throw superseded();
      // Another tab of this browser replaced the pair while the refresh was on its way (a password
      // change, a verified TOTP step, a new sign-in): the answer — a refusal of the retired refresh
      // token, or a grant of an older pair — is about the pair that is gone. Neither drop the newer
      // pair nor write the older one over it: take what storage holds and send the request once more.
      if (refreshed.status < 500 && gen === generation && storedRefreshChanged(sentRefresh)) {
        // Only for the SAME account, and never for a request that carries a credential: a retry
        // under another account's token would put this account's password to that account (for a
        // directory account, a failed bind in its chain), and a refusal would drop its pair. The
        // `storage` event that follows ends this session here; storage is left as it is.
        if (credential || !storedAccessIsSameAccount(sentAccess)) throw superseded();
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

    /** Server clock minus browser clock, in ms, from the last answer's `Date` header; `null` until
     *  one has been seen. A screen that ages a timestamp reads it through the board store. */
    serverClockSkewMs: () => clockSkewMs,

    /** `login` is a username or an e-mail (the API's `email` field is a legacy alias). */
    login(login, password) {
      return timed(async (doFetch) => {
        const gen = generation;
        const res = await post(doFetch, "/auth/login", { login, password });
        if (!res.ok) throw await failure(res, "Giriş başarısız.");
        return acceptTokens(gen, await res.json());
      });
    },

    /** Exchange the 6-digit authenticator code for MFA-verified tokens. */
    verifyTotp(code) {
      return timed(async (doFetch) => {
        const gen = generation;
        const res = await post(doFetch, "/auth/totp/verify", { code }, { auth: true });
        if (!res.ok) throw await failure(res, "Doğrulama kodu geçersiz.");
        return acceptTokens(gen, await res.json());
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
        return await authed("/auth/reauth", { method: "POST", body: { password }, credential: true });
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

    /** The actor is attributed by the API from the token; nothing about who is sent.
     *  Resolves to the patient's own board entry as it is AFTER the acknowledgement, so a screen
     *  shows the server's answer rather than its own guess at it. 404 means the alarm is no longer
     *  open (it cleared, or somebody else answered it and it resolved). */
    acknowledge(patientId, kind) {
      return authed("/ack", { method: "POST", body: { patient_id: patientId, kind } });
    },

    /** Record that a clinician opened this patient — the audit line an inspection asks for.
     *  Sent for a patient the screen actually shows: the server answers 404 for one outside the
     *  caller's scope AND for one that does not exist (deliberately the same answer), and logs
     *  the refusal as `scope_denied`, so sending it for a stale bookmark would fill the trail with
     *  refusals for views that never happened. */
    view(patientId) {
      return authed("/view", { method: "POST", body: { patient_id: patientId } });
    },

    /** The change retires every existing session; the API answers with a fresh pair. */
    async changePassword(currentPassword, newPassword) {
      const gen = generation;
      const tokens = await authed("/auth/password", {
        method: "POST", body: { current_password: currentPassword, new_password: newPassword },
        credential: true,
      });
      // Every older session (the old refresh token included) is retired by the change: a refresh
      // still on its way with it must not undo this pair (replaceTokens). And a session that ended
      // while the change was on its way does not get this pair back (acceptTokens).
      return acceptTokens(gen, tokens);
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
    /** Three more failed directory binds for this account's current run of failures. `reason` goes
     *  into the audit row and the API requires it: one line, at least one letter or digit, at most
     *  200 characters. Once per run — a second call grants nothing and says so. */
    adminUnlockSignIn(id, reason) {
      return authed(`/admin/users/${seg(id)}/unlock-sign-in`, { method: "POST", body: { reason } });
    },

    // ---- the directory (/admin/ldap, see homunculus-engine admin/ldap_router.py) ----
    // Every one of these waits on the domain controller, so they all carry ADMIN_LDAP_TIMEOUT_MS
    // instead of the client's usual limit (see `timed`). `status` and `test`, the search and the
    // group list need users.manage; importing needs users.manage; CHANGING the group mapping needs
    // the whole catalogue (the API answers 403 otherwise), so a screen shows those controls only to
    // an administrator who has it.
    /** {configured, url_host, last_test_at, last_test_ok} — never a bind DN or a password. */
    ldapStatus() { return authed("/admin/ldap/status", { timeoutMs: ADMIN_LDAP_TIMEOUT_MS }); },
    /** One service bind now: {ok, reason, checked_at}; `reason` is unreachable | timeout | tls |
     *  service_bind_rejected | protocol. */
    ldapTest() {
      return authed("/admin/ldap/test", { method: "POST", timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** [LdapUserOut] for a name fragment — each says whether it is already imported. */
    ldapSearch(query, limit = 25) {
      return authed(`/admin/ldap/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`,
        { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** [{dn, name}] — the directory's groups, for the mapping's picker. */
    ldapGroups(query = "") {
      const q = query ? `?q=${encodeURIComponent(query)}` : "";
      return authed(`/admin/ldap/groups${q}`, { timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
    },
    /** Import up to LDAP_IMPORT_MAX accounts: {imported, skipped}. Idempotent — an account already
     *  here comes back under `skipped` with the reason "exists", so a retry after a timeout is
     *  safe. A slow controller makes this the longest call in the product: the caller sends it in
     *  chunks of LDAP_IMPORT_CHUNK so one chunk's failure costs only that chunk. */
    ldapImport(externalIds, extraGroupIds = []) {
      return authed("/admin/ldap/import", {
        method: "POST", timeoutMs: ADMIN_LDAP_TIMEOUT_MS,
        body: { external_ids: externalIds, extra_group_ids: extraGroupIds },
      });
    },
    /** [LdapMappingOut] — which AD group grants which of our groups. Reading needs users.manage. */
    ldapMappings() { return authed("/admin/ldap/group-mappings", { timeoutMs: ADMIN_LDAP_TIMEOUT_MS }); },
    /** Needs EVERY permission (403 otherwise). `adGroupDn` is stored in its canonical spelling. */
    ldapCreateMapping(adGroupDn, groupId) {
      return authed("/admin/ldap/group-mappings", {
        method: "POST", timeoutMs: ADMIN_LDAP_TIMEOUT_MS,
        body: { ad_group_dn: adGroupDn, group_id: groupId },
      });
    },
    /** 204: resolves to null. Needs every permission. */
    ldapDeleteMapping(id) {
      return authed(`/admin/ldap/group-mappings/${seg(id)}`,
        { method: "DELETE", timeoutMs: ADMIN_LDAP_TIMEOUT_MS });
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
