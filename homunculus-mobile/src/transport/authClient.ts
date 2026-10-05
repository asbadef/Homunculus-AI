// Client for homunculus-engine's /auth/* routes (see auth/router.py, auth/schemas.py).
//
// Mirrors dashboard/src/backendApi.js's shape — injected fetch, injected token store, refresh
// -once-and-retry on a 401 — but tokens live in expo-secure-store (see ../store/secureTokens),
// not localStorage: they authorise clinical data on a device that can be lost or stolen.
//
// Login is password-only for M2. The backend's TokenResponse always carries a `requires_mfa`
// flag (true when the account has TOTP enabled — see issue_tokens() in auth/service.py); the
// access token it ships alongside that flag has mfa_verified=False and cannot be used for
// anything beyond MFA verification. Since the mobile app has no TOTP step yet, a `requires_mfa:
// true` response throws MfaRequiredError and stores nothing — the UI sends the clinician to the
// dashboard instead of holding a token it can't legally use. Likewise `password_change_required:
// true` (a temporary password an administrator gave, migration 0011): every route but the
// password change answers 403 until it is replaced, and the app has no such form — it throws
// PasswordChangeRequiredError, stores nothing, and the clinician changes it on the dashboard.
// A session that is already open meets the same rule later (migration 0011 flags accounts whose
// phones are signed in; an administrator resets a password): a 403 `password_change_required`
// from any call, or a refresh that says `password_change_required: true`, clears the stored
// tokens and throws PasswordChangeRequiredError — final, like SessionExpiredError. No retry can
// repair it, and retrying would only keep a ward phone polling a server that will never answer.
import type { TokenPair } from "../store/secureTokens";
import * as secureTokens from "../store/secureTokens";

export class MfaRequiredError extends Error {
  constructor(message = "This account requires an authenticator code. Use the dashboard for now.") {
    super(message);
    this.name = "MfaRequiredError";
  }
}

export class PasswordChangeRequiredError extends Error {
  constructor(message = "This account's temporary password must be changed first. Use the dashboard for now.") {
    super(message);
    this.name = "PasswordChangeRequiredError";
  }
}

export class SessionExpiredError extends Error {
  constructor(message = "Session expired. Please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** auth/dependencies.py's PASSWORD_CHANGE_REQUIRED: the 403 detail while a temporary password
 * is still in place (the board's resolver in api/prodserver.py answers the same). */
export const PASSWORD_CHANGE_REQUIRED = "password_change_required";

/** Matches auth/schemas.py's TokenResponse. */
interface TokenResponseBody {
  access_token: string;
  refresh_token: string;
  token_type: string;
  requires_mfa: boolean;
  /** Absent from an API older than migration 0011. */
  password_change_required?: boolean;
}

/** The slice of secureTokens.ts that the client depends on — injected so tests never touch
 * the real keychain/keystore. */
export interface TokenStore {
  getTokens(): Promise<TokenPair | null>;
  setTokens(pair: TokenPair): Promise<void>;
  clearTokens(): Promise<void>;
}

export interface AuthClientOptions {
  baseUrl: string;
  /** Default: expo/fetch's streaming-capable fetch. Tests always inject a fake. */
  fetchImpl?: typeof fetch;
  /** Default: the real secure store. Tests inject an in-memory fake. */
  tokenStore?: TokenStore;
}

export interface AuthClient {
  login(email: string, password: string): Promise<void>;
  /** Attaches the bearer token; on a 401 it refreshes once and retries. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>;
  logout(): Promise<void>;
  hasSession(): Promise<boolean>;
}

/** FastAPI reports problems as {"detail": ...}; surface it so the UI can show the real reason. */
export async function readDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.detail) {
      return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    }
  } catch {
    // non-JSON body — keep the fallback
  }
  return fallback;
}

/** The string `detail` of a FastAPI error body, or null. */
function detailOf(text: string): string | null {
  try {
    const detail = (JSON.parse(text) as { detail?: unknown } | null)?.detail;
    return typeof detail === "string" ? detail : null;
  } catch {
    return null;
  }
}

function defaultFetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  // Imported lazily: pulling in "expo/fetch" at module load time drags in its native streaming
  // polyfill, which has no Jest-safe implementation and breaks the test module graph. Tests
  // never reach this branch — they always inject fetchImpl — so the require only happens at
  // runtime in the app.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { fetch: expoFetch } = require("expo/fetch") as { fetch: typeof fetch };
  return expoFetch(...args);
}

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const { baseUrl } = options;
  const doFetch = options.fetchImpl ?? defaultFetch;
  const tokenStore: TokenStore = options.tokenStore ?? secureTokens;

  const url = (path: string) => `${baseUrl}${path}`;

  async function login(email: string, password: string): Promise<void> {
    const res = await doFetch(url("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(await readDetail(res, `Login failed (${res.status})`));
    }
    const body = (await res.json()) as TokenResponseBody;
    if (body.requires_mfa) {
      throw new MfaRequiredError();
    }
    if (body.password_change_required) {
      throw new PasswordChangeRequiredError();
    }
    await tokenStore.setTokens({ access: body.access_token, refresh: body.refresh_token });
  }

  /** Exchanges the stored refresh token for a new pair. Clears the session and throws
   * SessionExpiredError if the backend rejects it, PasswordChangeRequiredError if the account
   * must replace its temporary password first (the new pair would only meet 403s). */
  async function refresh(): Promise<TokenPair> {
    const current = await tokenStore.getTokens();
    if (!current) throw new SessionExpiredError();

    const res = await doFetch(url("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refresh }),
    });
    if (!res.ok) {
      await tokenStore.clearTokens();
      throw new SessionExpiredError();
    }
    const body = (await res.json()) as TokenResponseBody;
    if (body.password_change_required) {
      await tokenStore.clearTokens();
      throw new PasswordChangeRequiredError();
    }
    const pair: TokenPair = { access: body.access_token, refresh: body.refresh_token };
    await tokenStore.setTokens(pair);
    return pair;
  }

  async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const send = (access: string | undefined): ReturnType<typeof fetch> => {
      const headers = new Headers(init.headers);
      if (access) headers.set("Authorization", `Bearer ${access}`);
      return doFetch(url(path), { ...init, headers });
    };

    const tokens = await tokenStore.getTokens();
    let res = await send(tokens?.access);
    if (res.status === 401) {
      // Single-flight: refresh at most once per call. If the retry is also a 401 (or anything
      // else), that response goes straight back to the caller — there is no third attempt.
      const pair = await refresh();
      res = await send(pair.access);
    }
    if (res.status === 403) {
      // The body is read here to tell this 403 from the others; expo/fetch has no
      // Response.clone(), so any other 403 goes back as a rebuilt Response with the same body.
      const text = await res.text();
      if (detailOf(text) === PASSWORD_CHANGE_REQUIRED) {
        await tokenStore.clearTokens();
        throw new PasswordChangeRequiredError();
      }
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return res;
  }

  async function logout(): Promise<void> {
    await tokenStore.clearTokens();
  }

  async function hasSession(): Promise<boolean> {
    return (await tokenStore.getTokens()) !== null;
  }

  return { login, authedFetch, logout, hasSession };
}
