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

/** A backendApi stand-in: one stored access token, every call a vi.fn the test sets up.
 *
 *  Every call the live UI makes is listed, whether or not the test under way uses it — a screen
 *  that reaches for a call this object does not have fails with "not a function" instead of with
 *  the thing the test was about, and a `vi.fn()` that nobody set up resolves to `undefined`, which
 *  is what a screen must survive anyway. Wave 3's calls are grouped by the screen that makes them.
 */
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
    // the beds, alarms and patient screens (G1-09 … G1-11)
    acknowledge: vi.fn(),
    view: vi.fn(),
    // the users and units screen (G1-12)
    adminUsers: vi.fn(),
    adminCreateUser: vi.fn(),
    adminUpdateUser: vi.fn(),
    adminSetUserGroups: vi.fn(),
    adminResetPassword: vi.fn(),
    adminResetMfa: vi.fn(),
    adminUnlockSignIn: vi.fn(),
    myScope: vi.fn(),
    setScope: vi.fn(),
    unassignedScopes: vi.fn(),
    // the roles and permissions screen (G1-13)
    adminPermissions: vi.fn(),
    adminGroups: vi.fn(),
    adminCreateGroup: vi.fn(),
    adminUpdateGroup: vi.fn(),
    adminDeleteGroup: vi.fn(),
    // the login-source screen (G1-14)
    ldapStatus: vi.fn(),
    ldapTest: vi.fn(),
    ldapSearch: vi.fn(),
    ldapGroups: vi.fn(),
    ldapImport: vi.fn(),
    ldapMappings: vi.fn(),
    ldapCreateMapping: vi.fn(),
    ldapDeleteMapping: vi.fn(),
    /** What the API's own token handling would do: store a new pair. */
    store(next) { stored = next; },
  };
  return api;
}
