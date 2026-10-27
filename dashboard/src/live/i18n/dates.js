// src/live/i18n/dates.js — the clock's and the lock screen's dates, written the prototype's way
// (core.js H.now / H.dm / H.wd): 24-hour HH:MM, dd.MM, and the weekday from the dictionary.
// Not Intl: a browser built with a reduced locale set (a headless or kiosk Chrome) answers an
// Azerbaijani request in English ("Sun"), and a ward screen must not switch language by itself.
// The browser's local time zone, which on the ward PCs is the hospital's.
export const pad2 = (n) => String(n).padStart(2, "0");

export function hhmm(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function ddmm(ms) {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

export function ddmmyyyy(ms) {
  return `${ddmm(ms)}.${new Date(ms).getFullYear()}`;
}

/** `dd.MM hh:mm` — an instant with its day and month, whatever day it is. */
export const ddmmhhmm = (ms) => `${ddmm(ms)} ${hhmm(ms)}`;

/** An instant as the reader's clock: the time alone for a moment on `nowMs`'s own LOCAL day, with its
 *  day and month for any other. A time read the morning after, written bare, looks like one from an hour
 *  ago (the Meds box's rule, final review M1). The two dates are compared as written; nothing is computed. */
export const dayStamp = (ms, nowMs) => (ddmmyyyy(ms) === ddmmyyyy(nowMs) ? hhmm(ms) : ddmmhhmm(ms));

/** The weekday's key in the `dates` namespace: dates.wd0 (Sunday) … dates.wd6. */
export const weekdayKey = (ms) => `dates.wd${new Date(ms).getDay()}`;
