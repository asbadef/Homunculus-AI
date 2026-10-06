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
  PASSWORD_RESET: "passwordReset",  // an administrator reset the password behind the lock screen
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
 * events: where `storage` events arrive (window), and `visibilitychange` / `pageshow` / `focus` —
 * a page coming back, which reads the lock and the tokens again (a frozen or bfcache page missed
 * its storage events and its timer); now: the clock; setTimer/clearTimer: the end of a lock that
 * lasts too long.
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
   *  storage holds no pair of this session — another tab emptied it, and this tab's copy went with
   *  its requests in flight (`api.supersede()`), or there was none — and is not written again. */
  function end(notice, { keepStorage = false } = {}) {
    epoch += 1;
    disarm();
    if (!keepStorage) api.logout();
    clearLock();
    rightsToken = null;
    stepClaims = null;
    set({ ...INITIAL, notice: notice ? { code: notice } : null });
  }

  // ---------------------------------------------------------------- the lock, kept by the browser
  // The lock lives in `hmc.lock` (browserState.js), shared by every tab and every reload: when it
  // began, why, and the wrong unlock passwords it has taken (3 per lock, Decision 4).
  //
  // A browser locked longer than the hospital's SCREEN_LOCK_SIGNOUT_HOURS signs itself out: a ward
  // PC locked overnight does not keep yesterday's session behind its lock (Decision 17). Checked
  // when the lock is shown (a reload, a new tab, another tab's lock), by a timer while it stays,
  // when a page comes back (`resync`: a sleeping or frozen page never ran its timer), and before
  // an unlock is sent — the right password never reopens a lock past its hours.
  let expiry = null;
  function disarm() {
    if (expiry !== null) clearTimer(expiry);
    expiry = null;
  }

  const lockLeft = (user, at) => user.lockSignoutHours * HOUR_MS - (now() - at);

  /** Show the lock screen for `user`, locked since `at` with `failures` wrong passwords taken — or
   *  end the session if that is too long ago, or the tries are spent. */
  function showLock(user, { at, why, failures = 0 }) {
    const left = lockLeft(user, at);
    if (left <= 0) {
      end(NOTICE.LOCK_EXPIRED);
      return;
    }
    if (failures >= UNLOCK_ATTEMPTS) {
      end(NOTICE.LOCKED_OUT);
      return;
    }
    disarm();
    const mine = epoch;
    expiry = setTimer(() => {
      expiry = null;
      if (mine === epoch && state.phase === PHASE.LOCKED) end(NOTICE.LOCK_EXPIRED);
    }, left);
    set({ phase: PHASE.LOCKED, user, mfa: null, notice: null, error: null, lock: { at, why }, unlockFailures: failures });
  }

  /** This session's lock as storage holds it now (another tab's lock, its count, or its unlock):
   *  follow it. Another account's lock is not this session's. */
  function syncLock(stored) {
    if (!state.user || (state.phase !== PHASE.READY && state.phase !== PHASE.LOCKED)) return;
    const mine = stored && stored.user === state.user.id ? stored : null;
    if (mine) {
      // The same lock keeps the higher count (a write of this tab's may not be there yet).
      const same = state.phase === PHASE.LOCKED && state.lock?.at === mine.at;
      const failures = Math.max(mine.failures ?? 0, same ? state.unlockFailures : 0);
      showLock(state.user, { ...mine, failures });
    } else if (!stored && state.phase === PHASE.LOCKED && api.accessToken()) {
      disarm();
      set({ phase: PHASE.READY, lock: null, unlockFailures: 0 });     // unlocked in another tab
    }
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
    stepClaims = claimsOf(rightsToken);
    const mfaPending = session.mfaRequired && !session.mfaVerified;
    // The steps this sign-in takes after the password, for the "Step 2/3" line: once known, kept
    // until the session is open, so the password step after the TOTP one still counts it.
    const steps = { mfa: state.steps.mfa || mfaPending, password: state.steps.password || me.must_change_password === true };
    state = { ...state, steps };
    if (mfaPending) {
      set({ phase: PHASE.MFA, user, notice: null, error: null,
            mfa: { enrolled: me.totp_enabled === true } });
      return;
    }
    // The lock before the password step: a locked browser whose password an administrator has
    // just reset proves no presence by reaching the step — it signs out, as its unlock would.
    const lock = readLock();
    if (lock && lock.user === user.id) {
      if (me.must_change_password === true) end(NOTICE.PASSWORD_RESET);
      else showLock(user, lock);
      return;
    }
    if (lock) clearLock();                     // another account's lock: not this session's
    if (me.must_change_password === true) {
      set({ phase: PHASE.PASSWORD, user, mfa: null, notice: null, error: null });
    } else {
      set({ phase: PHASE.READY, user, mfa: null, notice: null, error: null, lock: null });
    }
  }

  /** Read the profile for the session in storage and settle it, unless superseded meanwhile. */
  async function openWithProfile(mine) {
    const me = await api.me();
    if (mine !== epoch) return;
    settle(me);
  }

  /** Check the session this browser holds (a page load, a retry) and open it. Also starts the
   *  store: it listens to other tabs and to the page coming back from here until `dispose()` —
   *  attached once however often it runs (StrictMode runs the effect that calls it twice). */
  async function restore() {
    attach();
    if (!api.accessToken()) {
      // Nothing stored: nothing of a session may stay either — a lock left behind, a timer. The
      // reason the form shows, if any, stays; storage holds no pair to drop.
      end(state.notice?.code ?? null, { keepStorage: true });
      return;
    }
    epoch += 1;
    const mine = epoch;
    set({ phase: PHASE.RESTORING, error: null, steps: NO_STEPS });
    try {
      await openWithProfile(mine);
    } catch (err) {
      if (mine !== epoch) return;
      // Another tab replaced the session under this check: no verdict on it. Check what storage
      // holds now instead of waiting on a storage event.
      if (supersededBy(err)) recheck();
      else if (refused(err)) end(null);         // "you were not signed in": a state, not a fault
      else set({ phase: PHASE.UNREACHABLE, error: err });
    }
  }

  /** A check overtaken by another tab's change: none stored now — signed out elsewhere; a pair —
   *  check that one. Never left waiting in RESTORING. */
  function recheck() {
    api.forget();
    if (api.accessToken()) {
      restore();
      return;
    }
    api.supersede();
    end(NOTICE.ELSEWHERE, { keepStorage: true });
  }

  /** The same session, settled again where it stands — no RESTORING in between, so a step on screen
   *  (the TOTP enrolment's QR) is not remounted. For another tab's change that moves this session
   *  on: a passed TOTP step, a new password. A profile that cannot be read leaves the step as it is. */
  let settling = 0;
  async function resettle() {
    const mine = epoch;
    settling += 1;
    const seq = settling;
    try {
      const me = await api.me();
      if (mine === epoch && seq === settling) settle(me);
    } catch (err) {
      if (mine !== epoch || seq !== settling) return;
      if (supersededBy(err)) recheck();
      else if (err?.sessionEnded === true) end(NOTICE.SESSION_ENDED);
    }
  }

  /** The password step. Resolves when the session has moved on (state.phase says where);
   *  rejects with the API's error, the form staying where it is. One sign-in at a time: a second
   *  call while one is on its way is that one (a double submit would be answered twice — the
   *  first pair written, the second refused as superseded: an error over a valid pair). The page
   *  coming back meanwhile does not re-read storage (`resync`): the sign-in itself settles it. */
  function signIn(login, password, options) {
    if (!signingIn) signingIn = trySignIn(login, password, options).finally(() => { signingIn = null; });
    return signingIn;
  }
  let signingIn = null;

  async function trySignIn(login, password, { remember = false } = {}) {
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
   *  UNLOCK_ATTEMPTS-th wrong one (403) of this lock — in any tab, before any reload — signs out
   *  instead. A 403 password_change_required (an administrator reset the password behind the lock)
   *  signs out with its own notice: presence is not proven, so not the password step. Any other
   *  refusal (a 401 — reauth() says `sessionEnded`, the tokens already gone —, or a 403 such as an
   *  inactive membership) means the session itself is over; a server that did not answer (429,
   *  503, no network) changes nothing. A superseded request is neither: the pair changed under it
   *  in another tab, and this tab follows storage as the storage event does. A lock past the
   *  hospital's hours signs out before anything is sent. One unlock at a time: a second call
   *  while one is on its way is that one (the password is sent once). */
  function unlock(password) {
    if (state.phase !== PHASE.LOCKED) return Promise.resolve();
    if (!unlocking) unlocking = tryUnlock(password).finally(() => { unlocking = null; });
    return unlocking;
  }
  let unlocking = null;

  async function tryUnlock(password) {
    if (lockLeft(state.user, state.lock.at) <= 0) {
      end(NOTICE.LOCK_EXPIRED);
      return;
    }
    const mine = epoch;
    // An answer for a lock that is no longer on screen (unlocked or ended in another tab, or
    // meanwhile) changes nothing: a late wrong password must not sign out an unlocked session.
    const current = () => mine === epoch && state.phase === PHASE.LOCKED;
    try {
      await track(() => api.reauth(password));
    } catch (err) {
      if (!current()) throw err;
      if (supersededBy(err)) followTokens();
      else if (apiErrorKey(err)?.key === "errors.reauthRefused") countWrongPassword();
      else if (err?.status === 403 && apiErrorKey(err)?.key === "errors.passwordChangeRequired") end(NOTICE.PASSWORD_RESET);
      else if (err?.status === 401 || err?.status === 403) end(NOTICE.SESSION_ENDED);
      throw err;
    }
    if (!current()) return;
    disarm();
    clearLock();
    set({ phase: PHASE.READY, lock: null, unlockFailures: 0 });
  }

  /** One more wrong password for this lock, counted where every tab and reload reads it. */
  function countWrongPassword() {
    const { user, lock: shown } = state;
    const stored = readLock();
    const same = stored && stored.user === user.id && stored.at === shown.at ? stored : null;
    const failures = Math.max(state.unlockFailures, same?.failures ?? 0) + 1;
    if (failures >= UNLOCK_ATTEMPTS) {
      end(NOTICE.LOCKED_OUT);
      return;
    }
    // Only over this lock: one gone from storage was unlocked or ended elsewhere, and its storage
    // event is on its way — writing it back would lock that tab again.
    if (same) writeLock({ user: user.id, at: shown.at, why: shown.why, failures });
    set({ unlockFailures: failures });
  }

  // ---------------------------------------------------------------- other tabs of this browser
  /** The pair in storage changed under this tab: follow it. The same account's new pair keeps the
   *  session (the copy in memory is dropped, the next request reads the new one, requests in flight
   *  carry on); another account's pair, or none, supersedes this tab's session and its requests. */
  function followTokens() {
    api.forget();                                // read storage again on the next request
    const token = api.accessToken();
    if (!token) {
      // Only a session ends: on the sign-in form there is none, and a sign-in on its way here is
      // a new presence that another tab's sign-out says nothing about.
      if (state.phase !== PHASE.SIGNED_OUT) {
        api.supersede();
        end(NOTICE.ELSEWHERE, { keepStorage: true });
      }
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
    } else if ((state.phase === PHASE.MFA || state.phase === PHASE.PASSWORD) && stepPassedIn(token)) {
      // The same account passed this step in another tab (a verified code; a new password, which
      // retires the old pair: `tv`): its new token is here now — settle again instead of asking
      // for it twice. A plain refresh changes neither, and the step stays as it is.
      resettle();
    }
  }

  /** The claims that tell a step was passed, as the token this session last settled on had them. */
  let stepClaims = null;
  const claimsOf = (token) => {
    const claims = decodeJwtPayload(token);
    return { mfaVerified: claims?.mfa_verified === true, tv: claims?.tv ?? null };
  };
  function stepPassedIn(token) {
    const next = claimsOf(token);
    return !stepClaims || next.mfaVerified !== stepClaims.mfaVerified || next.tv !== stepClaims.tv;
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
    if (event.key === LOCK_KEY) syncLock(parseLock(event.newValue));
  }

  /** The page came back (shown again, restored from the back-forward cache, focused): a page that
   *  was frozen or asleep missed its storage events and its lock timer. Read the tokens and the
   *  lock again, as those events would have. Not while a stored session is being checked, nor
   *  while a sign-in is on its way: each reads them itself, and a re-read in between would take
   *  the pair the sign-in has just stored for another tab's and check it twice. */
  function resync() {
    if (state.phase === PHASE.RESTORING || signingIn) return;
    const before = epoch;
    followTokens();
    if (before === epoch) syncLock(readLock());
  }

  // Listening starts with restore() and stops with dispose(), each undoing the other: React's
  // StrictMode runs LiveApp's effect (restore … dispose) twice, and the store must hear other tabs
  // after the second run as after the first.
  const RESYNC_EVENTS = ["visibilitychange", "pageshow", "focus"];
  let attached = false;
  function attach() {
    if (attached || !events?.addEventListener) return;
    attached = true;
    events.addEventListener("storage", onStorage);
    for (const type of RESYNC_EVENTS) events.addEventListener(type, resync);
  }
  function detach() {
    if (!attached) return;
    attached = false;
    events.removeEventListener("storage", onStorage);
    for (const type of RESYNC_EVENTS) events.removeEventListener(type, resync);
  }

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
    /** Stop what restore() started: other tabs, the page coming back, the lock's timer. The
     *  subscribers are React's own to remove (useSyncExternalStore unsubscribes on unmount). */
    dispose() {
      detach();
      disarm();
    },
  };
}
