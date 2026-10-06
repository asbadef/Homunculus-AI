// src/live/session/browserState.js — what the live UI keeps in this browser about a session.
//
// None of it is secret, and none of it opens anything by itself:
//   hmc.lock          {user, at, why, failures?}: this browser's screen is locked for that user.
//                     Shared by every tab, so a reload or a new tab opens on the lock screen too —
//                     otherwise either would walk past it with the tokens the browser still holds.
//                     `failures`, the wrong unlock passwords this lock has taken, is shared the same
//                     way: 3 per lock (Decision 4), not 3 per page load or per tab.
//   hmc.activeAt      when someone last pressed a key, clicked or touched in ANY tab (epoch ms):
//                     a tab in the background must not lock the one in use.
//   hmc.rememberUser  the username "remember my username" keeps — never a password; it fills
//                     the field and opens nothing (roadmap: loginRemember).
// Storage may be refused (a private window, blocked site data): reads answer "nothing", writes
// do nothing, and the UI goes on. The tokens themselves are backendApi.js's business.
export const LOCK_KEY = "hmc.lock";
export const ACTIVE_KEY = "hmc.activeAt";
export const REMEMBER_KEY = "hmc.rememberUser";
export const LOCK_REASONS = Object.freeze(["idle", "manual"]);

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // refused: holds for this page only
  }
}

/** The lock, or null. A value that is not a lock (junk, an older build's) is no lock; a
 *  `failures` that is not a positive whole number is none taken. */
export function parseLock(raw) {
  try {
    const lock = JSON.parse(raw);
    if (lock && typeof lock.user === "string" && lock.user && Number.isFinite(lock.at)
        && LOCK_REASONS.includes(lock.why)) {
      const failures = Number.isInteger(lock.failures) && lock.failures > 0 ? lock.failures : 0;
      return { user: lock.user, at: lock.at, why: lock.why, ...(failures ? { failures } : {}) };
    }
  } catch {
    // not JSON
  }
  return null;
}

export const readLock = () => parseLock(read(LOCK_KEY));
export const writeLock = (lock) => write(LOCK_KEY, JSON.stringify(lock));
export const clearLock = () => write(LOCK_KEY, null);

export function readActiveAt() {
  const at = Number(read(ACTIVE_KEY));
  return Number.isFinite(at) && at > 0 ? at : null;
}
export const writeActiveAt = (at) => write(ACTIVE_KEY, String(at));

export const readRememberedUser = () => read(REMEMBER_KEY) || "";
export const rememberUser = (username) => write(REMEMBER_KEY, username || null);
export const forgetUser = () => write(REMEMBER_KEY, null);
