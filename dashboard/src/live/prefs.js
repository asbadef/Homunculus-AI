// src/live/prefs.js — the live UI's per-browser preferences: language, theme, text size.
//
// A preference is a convenience, never state the system depends on. A private window, a browser
// with site data blocked or a full quota must still render the UI — on the default. So every
// read and write is wrapped, and a stored value outside the allowed list is ignored rather than
// trusted (an older build, or the prototype, which spells languages "AZ"/"TR", may have left one).
const PREFIX = "hmc.";

export function readPref(name, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(PREFIX + name);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name, value) {
  try {
    window.localStorage.setItem(PREFIX + name, value);
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
}
