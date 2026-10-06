// Test-only: an access token the way the API shapes it (auth/service.py `issue_tokens`), unsigned —
// liveAuth.js reads claims for display and gating only, the server checks the signature. Synthetic.
function b64url(obj) {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(obj))) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function token({
  sub = "u-ayse", tenant = "demo-hastanesi", groups = ["nurse"], perms = ["board.view", "alerts.ack"],
  mfaRequired = false, mfaVerified = false, tv = 0,
} = {}) {
  const claims = { sub, type: "access", tenant, groups, perms, mfa_required: mfaRequired, mfa_verified: mfaVerified, tv };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.signature`;
}

/** The /auth/me answer for a synthetic nurse, with overrides. */
export function profile(over = {}) {
  return {
    id: "u-ayse", username: "ayse", email: "ayse@example.com", full_name: "Ayşe Sentetik",
    auth_source: "local", totp_enabled: false, is_active: true, created_at: "2026-10-01T08:00:00Z",
    tenant: "demo-hastanesi", tenant_name: "Sentetik Hastane",
    groups: [{ slug: "nurse", name: "Hemşire" }], perms: ["alerts.ack", "board.view"],
    must_change_password: false, lock_idle_minutes: 10, lock_signout_hours: 12, ...over,
  };
}

/** A backendApi stand-in: one stored access token, every call a vi.fn the test sets up. */
export function fakeApi(vi, { access = null } = {}) {
  let stored = access;
  const api = {
    accessToken: vi.fn(() => stored),
    logout: vi.fn(() => { stored = null; }),
    forget: vi.fn(),
    supersede: vi.fn(),
    login: vi.fn(),
    verifyTotp: vi.fn(),
    setupTotp: vi.fn(),
    me: vi.fn(),
    changePassword: vi.fn(),
    reauth: vi.fn(),
    boardPatients: vi.fn(),
    streamTicket: vi.fn(),
    /** What the API's own token handling would do: store a new pair. */
    store(next) { stored = next; },
  };
  return api;
}
