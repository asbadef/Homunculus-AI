/// <reference types="jest" />
import {
  createAuthClient,
  MfaRequiredError,
  PasswordChangeRequiredError,
  SessionExpiredError,
  type TokenStore,
} from "../src/transport/authClient";
import type { TokenPair } from "../src/store/secureTokens";

function fakeTokenStore(initial: TokenPair | null = null): TokenStore & {
  getTokens: jest.Mock<Promise<TokenPair | null>, []>;
  setTokens: jest.Mock<Promise<void>, [TokenPair]>;
  clearTokens: jest.Mock<Promise<void>, []>;
} {
  let pair = initial;
  return {
    getTokens: jest.fn(async () => pair),
    setTokens: jest.fn(async (next: TokenPair) => {
      pair = next;
    }),
    clearTokens: jest.fn(async () => {
      pair = null;
    }),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const BASE_URL = "https://engine.example.test";

describe("createAuthClient", () => {
  it("login POSTs /auth/login and stores the token pair", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: false,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await client.login("nurse@example.test", "hunter2");

    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE_URL}/auth/login`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "nurse@example.test", password: "hunter2" }),
      })
    );
    expect(tokenStore.setTokens).toHaveBeenCalledWith({ access: "access-1", refresh: "refresh-1" });
  });

  it("throws MfaRequiredError and stores nothing when the backend requires MFA", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: true,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await expect(client.login("doctor@example.test", "hunter2")).rejects.toBeInstanceOf(
      MfaRequiredError
    );
    expect(tokenStore.setTokens).not.toHaveBeenCalled();
  });

  it("throws PasswordChangeRequiredError and stores nothing while a temporary password is in use", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: false,
        password_change_required: true,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await expect(client.login("nurse@example.test", "Gecici-1")).rejects.toBeInstanceOf(
      PasswordChangeRequiredError
    );
    expect(tokenStore.setTokens).not.toHaveBeenCalled();
  });

  it("asks for the authenticator first when both are due", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: true,
        password_change_required: true,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await expect(client.login("doctor@example.test", "Gecici-1")).rejects.toBeInstanceOf(
      MfaRequiredError
    );
    expect(tokenStore.setTokens).not.toHaveBeenCalled();
  });

  it("throws a plain error carrying the server's detail on a 401 login", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () => jsonResponse(401, { detail: "Invalid credentials" }));
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    let caught: unknown;
    try {
      await client.login("nurse@example.test", "wrong-password");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(MfaRequiredError);
    expect(caught).not.toBeInstanceOf(SessionExpiredError);
    expect((caught as Error).message).toBe("Invalid credentials");
    expect(tokenStore.setTokens).not.toHaveBeenCalled();
  });

  it("authedFetch attaches Authorization: Bearer <access>", async () => {
    const tokenStore = fakeTokenStore({ access: "access-1", refresh: "refresh-1" });
    const fetchImpl = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { ok: true })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await client.authedFetch("/patients");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(`${BASE_URL}/patients`);
    const headers = new Headers(calledInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-1");
  });

  it("on a 401 it refreshes, stores the new pair, retries once, and returns the retry's response", async () => {
    const tokenStore = fakeTokenStore({ access: "stale-access", refresh: "refresh-1" });
    const calls: string[] = [];
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      calls.push(path);
      if (path === `${BASE_URL}/patients`) {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === "Bearer fresh-access") {
          return jsonResponse(200, { patients: [] });
        }
        return jsonResponse(401, { detail: "Invalid or missing authentication credentials" });
      }
      if (path === `${BASE_URL}/auth/refresh`) {
        expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: "refresh-1" });
        return jsonResponse(200, {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          token_type: "bearer",
          requires_mfa: false,
        });
      }
      throw new Error(`unexpected fetch: ${path}`);
    });
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    const res = await client.authedFetch("/patients");

    expect(calls).toEqual([`${BASE_URL}/patients`, `${BASE_URL}/auth/refresh`, `${BASE_URL}/patients`]);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ patients: [] });
    expect(tokenStore.setTokens).toHaveBeenCalledWith({ access: "fresh-access", refresh: "fresh-refresh" });
  });

  it("does not loop when the retry after a refresh is also a 401", async () => {
    const tokenStore = fakeTokenStore({ access: "stale-access", refresh: "refresh-1" });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === `${BASE_URL}/auth/refresh`) {
        return jsonResponse(200, {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          token_type: "bearer",
          requires_mfa: false,
        });
      }
      // /patients always 401s, even with the fresh token.
      return jsonResponse(401, { detail: "still unauthorized" });
    });
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    const res = await client.authedFetch("/patients");

    // Exactly one attempt, one refresh, one retry — never a second refresh or third attempt.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(401);
  });

  it("clears both tokens and throws SessionExpiredError when refresh itself fails", async () => {
    const tokenStore = fakeTokenStore({ access: "stale-access", refresh: "dead-refresh" });
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === `${BASE_URL}/auth/refresh`) {
        return jsonResponse(401, { detail: "Invalid or expired refresh token" });
      }
      return jsonResponse(401, { detail: "Invalid or missing authentication credentials" });
    });
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    await expect(client.authedFetch("/patients")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(tokenStore.clearTokens).toHaveBeenCalled();
    expect(await tokenStore.getTokens()).toBeNull();
  });

  it("hasSession is true after login and false after logout", async () => {
    const tokenStore = fakeTokenStore();
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        token_type: "bearer",
        requires_mfa: false,
      })
    );
    const client = createAuthClient({ baseUrl: BASE_URL, fetchImpl, tokenStore });

    expect(await client.hasSession()).toBe(false);
    await client.login("nurse@example.test", "hunter2");
    expect(await client.hasSession()).toBe(true);

    await client.logout();

    expect(await client.hasSession()).toBe(false);
    expect(tokenStore.clearTokens).toHaveBeenCalled();
  });
});
