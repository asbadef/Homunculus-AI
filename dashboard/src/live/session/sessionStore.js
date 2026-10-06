// src/live/session/sessionStore.js — the live UI's session: who is signed in, and what the screen
// may show now. Framework-free; React reads it through SessionProvider.jsx.
//
// It talks to the real API only (backendApi.js) and never to the simulation: roadmap D1 — the
// new shell does not rest on the demo store. One phase at a time:
//
//   restoring    a stored session is being checked (a page load): no form yet, it would race it
//   signedOut    the sign-in form; `notice` says why it opened, when it matters
//   unreachable  a stored session could not be checked — the server did not answer. The tokens
//                are kept (an outage never signs a clinician out); retry, or sign out
//   mfa          the TOTP step: enrolment first when the account has no authenticator
//   password     a temporary password must be replaced (after the TOTP step)
//   ready        the shell
//   locked       the lock screen: the session lives, nothing of it is on the screen — for at most
//                the hospital's SCREEN_LOCK_SIGNOUT_HOURS, then the browser signs itself out
//
// Ending a session — any way it ends — empties everything it loaded (main's behaviour on a
// shared ward workstation, liveStore.js `endSession`), and an answer that arrives after it
// ended, or after another began, is dropped: by this store (`epoch`), and — for an answer that
// carries a new pair (a sign-in, the TOTP step, a password change, a refresh) — by backendApi,
// which never writes a pair asked for under a session that has since ended. Every ending moves
// backendApi's generation for that: `end` calls `api.logout()`, or `api.supersede()` when another
// tab has emptied storage already.
//
// The tabs of one browser share one pair of tokens. Another tab renewing the SAME account's pair (a
// refresh, a new password, a passed TOTP step) keeps this tab's session: only the copy held in
// memory is dropped (`api.forget()`), so the next request reads the new pair. Another account's
// pair, or none, ends this session here too, and its requests in flight with it
// (`api.supersede()`): those reject with `err.superseded`, which is read BEFORE `err.status` — such a
// 401 belongs to a session another tab replaced and never means "this session is over".
import { decodeJwtPayload, secretFromProvisioningUri, sessionFromToken } from "../../liveAuth.js";
import { TOKEN_KEYS } from "../../backendApi.js";
import { LOCK_KEY, clearLock, forgetUser, parseLock, readLock, rememberUser, writeLock } from "./browserState.js";
import { apiErrorKey } from "../apiErrors.js";

export const PHASE = Object.freeze({
  RESTORING: "restoring",
  SIGNED_OUT: "signedOut",
  UNREACHABLE: "unreachable",
  MFA: "mfa",
  PASSWORD: "password",
  READY: "ready",
  LOCKED: "locked",
});

/** Why the sign-in form opened (`state.notice.code`); each has an `auth.notice.*` text. */
export const NOTICE = Object.freeze({
  SIGNED_OUT: "signedOut",          // the user signed out
  SESSION_ENDED: "sessionEnded",    // the server ended it: a refused refresh, an account change
  ELSEWHERE: "signedOutElsewhere",  // another tab of this browser signed out
  LOCKED_OUT: "lockedOut",          // too many wrong passwords at the lock screen
  LOCK_EXPIRED: "lockExpired",      // locked longer than the hospital allows (SCREEN_LOCK_SIGNOUT_HOURS)
  NO_PERMISSIONS: "noPermissions",  // no tenant, or no permission at all
  NO_SCREEN: "noScreen",            // permissions, but no screen of the live UI uses them
});

/** Wrong passwords one lock takes before it signs out (the server's own limits are wider). */
export const UNLOCK_ATTEMPTS = 3;
/** Minutes, when the server does not say (an older API): lock rather than never. */
export const FALLBACK_LOCK_MINUTES = 10;
/** Hours a browser may stay locked, when the server does not say (an older API). */
export const FALLBACK_LOCK_SIGNOUT_HOURS = 12;
const HOUR_MS = 3_600_000;

const NO_STEPS = Object.freeze({ mfa: false, password: false });
const INITIAL = Object.freeze({
  phase: PHASE.SIGNED_OUT, user: null, mfa: null, notice: null, lock: null, unlockFailures: 0, error: null,
  steps: NO_STEPS,
});

/** A request another tab's change overtook (backendApi `supersede`, or a refresh that met another
 *  account's pair in storage): it says nothing about this session. Tested before `status`. */
const supersededBy = (err) => err?.superseded === true;

/** True when the server REFUSED the session (a refresh it turned down, a 401/403); anything else
 *  — a 5xx, no network, a timeout — means it did not answer, and the session may be good. */
const refused = (err) => err?.sessionEnded === true || err?.status === 401 || err?.status === 403;

const sameList = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** The profile (/auth/me) and the token's rights, as the screens read them. Rights come from the
 *  token — what the server checks this hour — and follow it as it is refreshed (`syncRights`). */
function userFrom(me, session) {
  const groups = (Array.isArray(me?.groups) ? me.groups : [])
    .filter((g) => g && typeof g.slug === "string")
    .map((g) => ({ slug: g.slug, name: typeof g.name === "string" && g.name ? g.name : g.slug }));
  const minutes = me?.lock_idle_minutes;
  const hours = me?.lock_signout_hours;
  return {
    id: String(me.id),
    username: me.username,
    fullName: me.full_name || me.username,
    email: me.email ?? null,
    authSource: me.auth_source === "ldap" ? "ldap" : "local",
    tenant: typeof me.tenant === "string" && me.tenant ? me.tenant : session.tenant,
    tenantName: typeof me.tenant_name === "string" && me.tenant_name ? me.tenant_name : null,
    groups,
    perms: session.perms,
    totpEnabled: me.totp_enabled === true,
    lockIdleMinutes: Number.isInteger(minutes) && minutes > 0 ? minutes : FALLBACK_LOCK_MINUTES,
    lockSignoutHours: Number.isInteger(hours) && hours > 0 ? hours : FALLBACK_LOCK_SIGNOUT_HOURS,
  };
}

/**
 * api: backendApi (login, verifyTotp, setupTotp, me, changePassword, reauth, accessToken, logout,
 *      forget, supersede).
 * canEnter(perms): whether the live UI has a screen for these rights (shell/routes.js).
 * events: where `storage` events arrive (window); now: the clock; setTimer/clearTimer: the end
 * of a lock that lasts too long.
 */
export function createSessionStore({
  api, canEnter = () => true, events = window, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let state = { ...INITIAL };
  let epoch = 0;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };
  const set = (patch) => { state = { ...state, ...patch }; emit(); };

  // ---------------------------------------------------------------- endings
  /** Everything this session loaded goes; the next screen starts from nothing. `keepStorage`:
   *  another tab has emptied storage already, and this tab's copy of the pair went with its
   *  requests in flight (`followTokens`): storage is not written again. */
  function end(notice, { keepStorage = false } = {}) {
    epoch += 1;
    disarm();
    if (!keepStorage) api.logout();
    clearLock();
    rightsToken = null;
    set({ ...INITIAL, notice: notice ? { code: notice } : null });
  }

  // ---------------------------------------------------------------- how long a lock may last
  // A browser locked longer than the hospital's SCREEN_LOCK_SIGNOUT_HOURS signs itself out: a ward
  // PC locked overnight does not keep yesterday's session behind its lock. Checked when the lock
  // is shown (a reload, a new tab, another tab's lock) and by a timer while it stays.
  let expiry = null;
  function disarm() {
    if (expiry !== null) clearTimer(expiry);
    expiry = null;
  }

  /** Show the lock screen for `user`, locked since `at` — or end the session if that is too long ago. */
  function showLock(user, { at, why }) {
    const left = user.lockSignoutHours * HOUR_MS - (now() - at);
    if (left <= 0) {
      end(NOTICE.LOCK_EXPIRED);
      return;
    }
    disarm();
    const mine = epoch;
    expiry = setTimer(() => {
      expiry = null;
      if (mine === epoch && state.phase === PHASE.LOCKED) end(NOTICE.LOCK_EXPIRED);
    }, left);
    set({ phase: PHASE.LOCKED, user, mfa: null, notice: null, error: null, lock: { at, why }, unlockFailures: 0 });
  }

  /** Why these rights cannot open the live UI, or null. */
  function entryProblem(session) {
    if (!session || session.tenant == null || session.perms.length === 0) return NOTICE.NO_PERMISSIONS;
    if (!canEnter(session.perms)) return NOTICE.NO_SCREEN;
    return null;
  }

  // ---------------------------------------------------------------- rights follow the token
  // backendApi refreshes the access token on a 401 and retries; a refreshed token carries the
  // CURRENT groups. After each call the store makes, the rights are read from it again, so the
  // menu follows an administrator's change within the hour without a sign-out.
  let rightsToken = null;
  function syncRights() {
    const token = api.accessToken();
    if (!state.user || !token || token === rightsToken) return;
    rightsToken = token;
    const session = sessionFromToken(token);
    if (!session) return;
    const user = state.user;
    const groups = session.groups.map((slug) => user.groups.find((g) => g.slug === slug) ?? { slug, name: slug });
    if (sameList(user.perms, session.perms) && sameList(user.groups.map((g) => g.slug), session.groups)) return;
    set({ user: { ...user, perms: session.perms, groups } });
  }

  /** Run an API call for this session: a refusal that ended it signs out here, and one that says
   *  an administrator has just given the account a temporary password (403
   *  password_change_required) takes an open shell to the password step; the rights are read again
   *  afterwards either way. A superseded request changes nothing here: another tab replaced the
   *  session, and its storage event settles where this tab goes. The error still reaches the caller. */
  async function track(call) {
    const mine = epoch;
    try {
      return await call();
    } catch (err) {
      if (supersededBy(err) || mine !== epoch) throw err;
      if (err?.sessionEnded === true && state.phase !== PHASE.SIGNED_OUT) end(NOTICE.SESSION_ENDED);
      else if (err?.status === 403 && state.phase === PHASE.READY
               && apiErrorKey(err)?.key === "errors.passwordChangeRequired") {
        set({ phase: PHASE.PASSWORD, steps: { mfa: false, password: true }, error: null });
      }
      throw err;
    } finally {
      if (mine === epoch) syncRights();
    }
  }

  // ---------------------------------------------------------------- opening a session
  /** Where a session with this profile goes next. */
  function settle(me) {
    const session = sessionFromToken(api.accessToken());
    const problem = entryProblem(session);
    if (problem) {
      end(problem);
      return;
    }
    const user = userFrom(me, session);
    rightsToken = api.accessToken();
    const mfaPending = session.mfaRequired && !session.mfaVerified;
    // The steps this sign-in takes after the password, for the "Step 2/3" line: once known, kept
    // until the session is open, so the password step after the TOTP one still counts it.
    const steps = { mfa: state.steps.mfa || mfaPending, password: state.steps.password || me.must_change_password === true };
    state = { ...state, steps };
    if (mfaPending) {
      set({ phase: PHASE.MFA, user, notice: null, error: null,
            mfa: { enrolled: me.totp_enabled === true } });
    } else if (me.must_change_password === true) {
      set({ phase: PHASE.PASSWORD, user, mfa: null, notice: null, error: null });
    } else {
      const lock = readLock();
      if (lock && lock.user === user.id) {
        showLock(user, lock);
      } else {
        if (lock) clearLock();                 // another account's lock: not this session's
        set({ phase: PHASE.READY, user, mfa: null, notice: null, error: null, lock: null });
      }
    }
  }

  /** Read the profile for the session in storage and settle it, unless superseded meanwhile. */
  async function openWithProfile(mine) {
    const me = await api.me();
    if (mine !== epoch) return;
    settle(me);
  }

  async function restore() {
    if (!api.accessToken()) {
      if (state.phase !== PHASE.SIGNED_OUT) set({ ...INITIAL });
      return;
    }
    epoch += 1;
    const mine = epoch;
    set({ phase: PHASE.RESTORING, error: null, steps: NO_STEPS });
    try {
      await openWithProfile(mine);
    } catch (err) {
      if (mine !== epoch) return;
      // Another tab replaced the session under this check: no verdict on it. The storage event
      // that follows opens what this browser holds now.
      if (supersededBy(err)) return;
      if (refused(err)) end(null);              // "you were not signed in": a state, not a fault
      else set({ phase: PHASE.UNREACHABLE, error: err });
    }
  }

  /** The password step. Resolves when the session has moved on (state.phase says where);
   *  rejects with the API's error, the form staying where it is. */
  async function signIn(login, password, { remember = false } = {}) {
    epoch += 1;
    const mine = epoch;
    state = { ...state, steps: NO_STEPS };
    let tokens;
    try {
      tokens = await api.login(login, password);
    } catch (err) {
      if (mine !== epoch) return;               // this tab moved on meanwhile: nobody waits for it
      throw err;
    }
    if (mine !== epoch) return;
    // Only a sign-in the server accepted changes this browser: a refused one (a stranger's guess,
    // a typo) neither replaces the remembered name nor lifts a lock.
    if (remember) rememberUser(login.trim());
    else forgetUser();
    clearLock();                                // a new sign-in is a new presence
    const problem = entryProblem(sessionFromToken(tokens.access_token));
    if (problem) {
      end(problem);
      return;
    }
    try {
      await openWithProfile(mine);
    } catch (err) {
      // The password was taken but the profile could not be read: nothing opened, so nothing of it
      // stays — no tokens behind a sign-in form that a reload would walk past. A superseded request
      // is another tab's doing; its storage event settles this tab.
      if (mine === epoch && !supersededBy(err)) end(null);
      throw err;
    }
  }

  /** The authenticator, minted by the API. Each call ROTATES the secret: call once per showing. */
  async function setupMfa() {
    const res = await track(() => api.setupTotp());
    return { provisioningUri: res.provisioning_uri, secret: secretFromProvisioningUri(res.provisioning_uri) };
  }

  /** The 6-digit code. A plain request (backendApi.verifyTotp): a wrong code is a 401 that must
   *  not go through refresh-and-retry. Rejects with the API's error; the step stays open. */
  async function verifyMfa(code) {
    const mine = epoch;
    try {
      await api.verifyTotp(String(code).trim());
    } catch (err) {
      if (mine !== epoch) return;               // backed out of meanwhile: its answer is nobody's
      throw err;
    }
    if (mine !== epoch) return;
    await openWithProfile(mine);
  }

  /** The user's own password; also how a temporary one is replaced. The API answers with a fresh
   *  pair (every older session ends). Rejects with the API's error. */
  async function changePassword(current, next) {
    const mine = epoch;
    try {
      await track(() => api.changePassword(current, next));
    } catch (err) {
      if (mine !== epoch) return;               // the session ended meanwhile
      throw err;
    }
    if (mine !== epoch) return;
    await openWithProfile(mine);
  }

  // ---------------------------------------------------------------- the lock
  function lock(why = "manual") {
    if (state.phase !== PHASE.READY || !state.user) return;
    const at = now();
    writeLock({ user: state.user.id, at, why });
    showLock(state.user, { at, why });
  }

  /** The session's own password. Rejects with the API's error, the lock staying; the
   *  UNLOCK_ATTEMPTS-th wrong one (403) signs out instead. Any other refusal (a 401 — reauth()
   *  says `sessionEnded`, the tokens already gone —, or a 403 such as an inactive membership) means
   *  the session itself is over; a server that did not answer (429, 503, no network) changes
   *  nothing. A superseded request is neither: the pair changed under it in another tab, and this
   *  tab follows storage as the storage event does. */
  async function unlock(password) {
    if (state.phase !== PHASE.LOCKED) return;
    const mine = epoch;
    try {
      await track(() => api.reauth(password));
    } catch (err) {
      if (mine !== epoch) throw err;
      if (supersededBy(err)) {
        followTokens();
      } else if (apiErrorKey(err)?.key === "errors.reauthRefused") {
        const failures = state.unlockFailures + 1;
        if (failures >= UNLOCK_ATTEMPTS) end(NOTICE.LOCKED_OUT);
        else set({ unlockFailures: failures });
      } else if ((err?.status === 401 || err?.status === 403) && state.phase === PHASE.LOCKED) {
        end(NOTICE.SESSION_ENDED);
      }
      throw err;
    }
    if (mine !== epoch) return;
    disarm();
    clearLock();
    set({ phase: PHASE.READY, lock: null, unlockFailures: 0 });
  }

  // ---------------------------------------------------------------- other tabs of this browser
  /** The pair in storage changed under this tab: follow it. The same account's new pair keeps the
   *  session (the copy in memory is dropped, the next request reads the new one, requests in flight
   *  carry on); another account's pair, or none, supersedes this tab's session and its requests. */
  function followTokens() {
    api.forget();                                // read storage again on the next request
    const token = api.accessToken();
    if (!token) {
      api.supersede();
      if (state.phase !== PHASE.SIGNED_OUT) end(NOTICE.ELSEWHERE, { keepStorage: true });
      return;
    }
    const sub = decodeJwtPayload(token)?.sub;
    // Another account signed in in another tab, or one did while this tab showed the form:
    // this browser now holds that session — open it here too.
    if (!state.user || String(sub) !== state.user.id) {
      api.supersede();
      epoch += 1;
      disarm();
      rightsToken = null;
      set({ ...INITIAL });
      restore();
    } else if (state.phase === PHASE.MFA || state.phase === PHASE.PASSWORD) {
      // The same account passed this step in another tab (a verified code, a new password):
      // its new token is here now — settle again instead of asking for it twice.
      restore();
    }
  }

  function onStorage(event) {
    if (event.key === TOKEN_KEYS.refresh) {
      api.forget();                              // the same pair renewed: read storage again
      return;
    }
    if (event.key === TOKEN_KEYS.access || event.key === null) {
      followTokens();
      return;
    }
    if (event.key === LOCK_KEY) {
      const other = parseLock(event.newValue);
      if (other && state.phase === PHASE.READY && state.user && other.user === state.user.id) {
        showLock(state.user, other);
      } else if (!other && state.phase === PHASE.LOCKED && api.accessToken()) {
        disarm();
        set({ phase: PHASE.READY, lock: null, unlockFailures: 0 });   // unlocked in another tab
      }
    }
  }
  events?.addEventListener?.("storage", onStorage);

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Bumped whenever a session begins or ends: data keyed to it can tell it is stale. */
    epoch: () => epoch,
    restore,
    retry: restore,
    signIn,
    setupMfa,
    verifyMfa,
    changePassword,
    lock,
    unlock,
    track,
    /** Back out of a step (MFA, a forced password change): the session ends, nothing kept. */
    cancel: () => end(null),
    signOut: () => end(NOTICE.SIGNED_OUT),
    dispose() {
      events?.removeEventListener?.("storage", onStorage);
      disarm();
      listeners.clear();
    },
  };
}
