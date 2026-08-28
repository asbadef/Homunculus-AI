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
// dashboard instead of holding a token it can't legally use.
import type { TokenPair } from "../store/secureTokens";
import * as secureTokens from "../store/secureTokens";

export class MfaRequiredError extends Error {
  constructor(message = "This account requires an authenticator code. Use the dashboard for now.") {
    super(message);
    this.name = "MfaRequiredError";
  }
}

export class SessionExpiredError extends Error {
  constructor(message = "Session expired. Please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

/** Matches auth/schemas.py's TokenResponse. */
interface TokenResponseBody {
  access_token: string;
  refresh_token: string;
  token_type: string;
  requires_mfa: boolean;
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
async function readDetail(res: Response, fallback: string): Promise<string> {
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
    await tokenStore.setTokens({ access: body.access_token, refresh: body.refresh_token });
  }

  /** Exchanges the stored refresh token for a new pair. Clears the session and throws
   * SessionExpiredError if the backend rejects it. */
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
