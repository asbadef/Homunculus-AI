// src/live/signals/AlarmSignals.jsx — the alarm sound and the critical-alarm notification, on the
// page. Ported (G1-16) from the previous workspace's ClinicalDemo.jsx and clinicalAudio.js before
// they were deleted (readable at e4cdf15); the VM's build behaves as those do.
//
// What the previous workspace did, and what this keeps:
//   * The sound is OPT-IN (it was a top-bar button, off on every page load). Here the choice is in
//     Settings and is kept in this browser (`hmc.alarmSound`) — a ward PC is the alarm station,
//     not a person's — so a reload does not quietly turn it off. A browser still starts audio only
//     after a click or a key press: until one happens a wanted sound is "waiting", and a button on
//     every screen, the lock screen included, says so (and is announced) and starts it.
//   * It plays the worst pattern among the alarms nobody has answered (signals.js), until they are
//     answered — the old one also honoured a snooze, which the live system does not have. It acts
//     on any board that holds a ward it loaded: from the first load on (the old one sounded its
//     first load), and, when the stream has dropped, on what the board last had (the old store kept
//     its alarms then); on a board that never loaded, or whose load failed, it plays nothing.
//   * A notification is raised for each critical alarm while the page is in the background
//     (`document.hidden`), once per alarm, staying until dismissed (`requireInteraction`), with the
//     old vibration pattern and, as the old one, a `tag` per alarm, so that two tabs of the same
//     browser replace each other's rather than stack. Its text names the alarm's bed — the HIS bed
//     label, else the patient id (liveAdapters.js `bedLabel`), exactly as the old one did (the
//     user's decision, 13.10).
// What is new, because the old workspace had no lock screen and never ended a sound at sign-out:
//   * It sits OUTSIDE the phases (LiveApp.jsx): the shell is unmounted when the screen locks, and a
//     locked ward PC must still alert. The board runs while locked (`seesBoard`), so does the sound.
//   * While locked a notification names nothing (`signals.notifyBodyLocked`, a tag of its own), and
//     the ones that named a bed are closed at the lock: the lock screen shows numbers only, and the
//     OS notification is not behind it. (After an unlock the bed-naming ones are raised again for
//     alarms still waiting; so they are after an alarm fires again, and in each new session.)
//   * When the session ends — sign-out, another account, the server ending it — the sound stops at
//     once (alarmSound.js cuts the pulses already scheduled) and every notification this page raised
//     is closed; so they are when the page itself goes (`pagehide`). A notification is also closed
//     once a LIVE board says its alarm no longer waits.
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBoard } from "../data/BoardProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";
import { useSession } from "../session/SessionProvider.jsx";
import { PHASE, seesBoard } from "../session/sessionStore.js";
import { Announce, Button, MODAL_EXEMPT } from "../ui/index.js";
import { createAlarmSound } from "./alarmSound.js";
import { notifyFor, soundFor } from "./signals.js";

/** The per-browser choice: "on" | "off", off unless someone turned it on. */
export const SOUND_PREF = "alarmSound";
const SOUND_CHOICES = ["on", "off"];
/** What counts as the user's gesture for a browser's autoplay rule. */
const GESTURES = ["pointerdown", "keydown", "click"];
/** The previous workspace's vibration for a critical alarm (a phone or tablet only). */
export const VIBRATE = Object.freeze([300, 120, 300, 120, 300]);
/** The one notification raised while locked: it names no bed, so one stands for all of them. */
const LOCKED = "locked";
/** A notification's tag: the browser replaces a notification of the same tag instead of adding
 *  one, so two tabs of the ward PC show one per alarm. The locked one names no alarm. */
export const TAG_PREFIX = "homunculus-alarm:";

/** FNV-1a (32-bit) of a string, as 8 hex digits: deterministic, so every tab computes the same. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The tag of one alarm's notification: a hash of its key, never the key — the key is
 *  `<patient_id>::<kind>`, and the patient id stays out of what the page hands the operating
 *  system (Decision 21). Two different alarms sharing a 32-bit hash would replace each other's
 *  notification; with a ward's handful of open alarms that is about one in a hundred million. */
export const alarmTag = (key) => TAG_PREFIX + fnv1a(String(key));

const SignalsContext = createContext(null);

/** `{sound, setSound, resume, testSound, notify, askNotify, testNotify}` for the settings screen.
 *  `sound`: "off" | "waiting" (wanted, no gesture yet) | "on" | "unsupported"; `notify`:
 *  "unsupported" | "insecure" | "default" | "granted" | "denied". */
export function useAlarmSignals() {
  const value = useContext(SignalsContext);
  if (!value) throw new Error("useAlarmSignals: no <AlarmSignals> above this component");
  return value;
}

function notifyState() {
  // A plain-HTTP origin first: the browser refuses notifications there (Chrome silently; a browser
  // may not even expose the API), and the reason is the address, not the browser — the old
  // workspace learned that on a ward visit and said so. So does this.
  if (window.isSecureContext === false) return "insecure";
  if (typeof window.Notification !== "function") return "unsupported";
  return window.Notification.permission;
}

/** An alarm's notification stays until someone dismisses it (`sticky`), as the old one did; the
 *  settings screen's test does not. */
function raise(title, body, { sticky = true, tag } = {}) {
  try {
    const options = { body, requireInteraction: sticky, vibrate: VIBRATE };
    if (tag) options.tag = tag;
    const notification = new window.Notification(title, options);
    navigator.vibrate?.(VIBRATE);
    return notification;
  } catch {
    // Some browsers refuse the constructor outright (Chrome on Android wants a service worker).
    return null;
  }
}

/** Where the keyboard goes when the waiting button, which had it, is gone: the shell's main region
 *  (Shell.jsx `<main id="main" tabIndex={-1}>`), else the first control of the page's `<main>` —
 *  the lock screen's password. Never left on <body>. */
function landing() {
  const shell = document.getElementById("main");
  if (shell) return shell;
  return document.querySelector("main")?.querySelector(
    "input:not([disabled]):not([type='hidden']), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
  ) ?? null;
}

/** The button a wanted sound shows until the browser has started the audio. It hides while a
 *  dialog is open: a Modal makes the rest of the page inert (ui/Modal.jsx), this button with it,
 *  and drawn above the dialog's scrim it would be a control nobody can use — the toasts move out
 *  of the way by the same body attribute (ui/Toast.jsx). A key press still starts the sound then
 *  (the listener is on the window). When it goes because the sound started, the focus it had moves
 *  to the page (`landing`). */
function WaitingButton({ label, onClick }) {
  const holder = useRef(null);
  useLayoutEffect(() => () => {
    // A layout cleanup runs before React takes the node out: the focus can still be seen here.
    if (holder.current?.contains(document.activeElement)) landing()?.focus();
  }, []);
  return (
    <div ref={holder} className="fixed bottom-[22px] left-[22px] z-[210] [body[data-modal-open]_&]:hidden">
      <Button variant="primary" icon="bell" onClick={onClick}>{label}</Button>
    </div>
  );
}

export function AlarmSignals({ children }) {
  const { t } = useI18n();
  const { phase, user } = useSession();
  const board = useBoard();
  const active = seesBoard(phase, user);
  const locked = phase === PHASE.LOCKED;

  const [audio, setAudio] = useState("suspended");
  const [engine] = useState(() => createAlarmSound({ onState: (state) => setAudio(state) }));
  const [wanted, setWanted] = useState(() => readPref(SOUND_PREF, SOUND_CHOICES, "off") === "on");
  const [permission, setPermission] = useState(notifyState);
  const [hidden, setHidden] = useState(() => document.hidden === true);
  const raised = useRef(new Map());

  useEffect(() => setAudio(engine.state()), [engine]);
  useEffect(() => () => engine.close(), [engine]);

  // Called from a click or a key press — a browser starts audio for nothing else.
  const resume = useCallback(() => {
    engine.resume().then(() => setAudio(engine.state()));
  }, [engine]);

  const setSound = useCallback((on) => {
    writePref(SOUND_PREF, on ? "on" : "off");
    setWanted(on);
    if (on) resume();
  }, [resume]);

  // Another tab of this browser changed the choice: follow it.
  useEffect(() => {
    const follow = (event) => {
      if (event.key !== null && event.key !== PREF_PREFIX + SOUND_PREF) return;
      setWanted(readPref(SOUND_PREF, SOUND_CHOICES, "off") === "on");
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  // A wanted sound waits for the first click or key press anywhere — the sign-in, the unlock.
  useEffect(() => {
    if (!wanted || audio !== "suspended") return undefined;
    for (const type of GESTURES) window.addEventListener(type, resume, true);
    return () => { for (const type of GESTURES) window.removeEventListener(type, resume, true); };
  }, [wanted, audio, resume]);

  // The sound: the worst waiting pattern while this session may see the board, nothing otherwise.
  // The engine keeps it while the browser has the audio suspended and sounds it once the audio
  // runs again — by itself, since a suspend and a resume may reach React as no change at all.
  const pattern = active && wanted ? soundFor(board) : null;
  useEffect(() => {
    if (pattern) engine.play(pattern);
    else engine.stop();
  }, [pattern, engine]);

  // In the background or not; and the permission, read again whenever the page comes and goes —
  // it may have been changed in the browser's own site settings meanwhile.
  useEffect(() => {
    const follow = () => {
      setHidden(document.hidden === true);
      setPermission(notifyState());
    };
    document.addEventListener("visibilitychange", follow);
    return () => document.removeEventListener("visibilitychange", follow);
  }, []);

  // The page goes (a reload, the tab closed, the browser navigating away): nothing it raised may
  // outlive it into the next person's session at this PC.
  useEffect(() => {
    const closeAll = () => {
      for (const notification of [...raised.current.values()]) notification?.close?.();
      raised.current.clear();
    };
    window.addEventListener("pagehide", closeAll);
    return () => window.removeEventListener("pagehide", closeAll);
  }, []);

  // The notifications. Keyed by alarm id — or LOCKED, the one raised while locked.
  const { alerts, connection, loaded } = board;
  useEffect(() => {
    const open = raised.current;
    const close = (key) => { open.get(key)?.close?.(); open.delete(key); };
    // One closed from OUTSIDE — the user, the operating system, another tab closing the same tag —
    // is forgotten, so an alarm still waiting is raised again on the board's next change. Only that
    // same notification: a later one under the key is not.
    const keep = (key, notification) => {
      if (notification) notification.onclose = () => { if (open.get(key) === notification) open.delete(key); };
      open.set(key, notification);
    };
    if (!active || permission !== "granted") {
      for (const key of [...open.keys()]) close(key);
      return;
    }
    const { known, items } = notifyFor({ alerts, connection, loaded });
    const keys = locked ? (items.length ? [LOCKED] : []) : items.map((a) => a.id);
    for (const key of [...open.keys()]) {
      const lockChanged = locked !== (key === LOCKED);
      // Only a LIVE board may say an alarm stopped waiting; a lock or an unlock retires the other kind.
      if (lockChanged || (known && !keys.includes(key))) close(key);
    }
    if (!hidden) return;
    if (locked) {
      if (keys.length && !open.has(LOCKED)) {
        keep(LOCKED, raise(t("signals.notifyTitle"), t("signals.notifyBodyLocked"), { tag: TAG_PREFIX + LOCKED }));
      }
      return;
    }
    for (const alarm of items) {
      if (open.has(alarm.id)) continue;
      keep(alarm.id, raise(t("signals.notifyTitle"), t("signals.notifyBody", { bed: alarm.bedLabel || "—" }),
        { tag: alarmTag(alarm.id) }));
    }
  }, [active, permission, alerts, connection, loaded, locked, hidden, t]);

  const askNotify = useCallback(async () => {
    if (notifyState() !== "default") {
      setPermission(notifyState());
      return;
    }
    try {
      setPermission(await window.Notification.requestPermission());
    } catch {
      setPermission(notifyState());
    }
  }, []);

  const testNotify = useCallback(() => {
    if (notifyState() === "granted") raise(t("signals.testTitle"), t("signals.testBody"), { sticky: false });
  }, [t]);

  const sound = !wanted ? "off" : audio === "running" ? "on" : audio === "unsupported" ? "unsupported" : "waiting";
  const value = { sound, setSound, resume, testSound: () => engine.test(), notify: permission, askNotify, testNotify };
  const waiting = active && sound === "waiting";

  return (
    <SignalsContext.Provider value={value}>
      {children}
      {/* Said politely through a region that is on the page before the words are (ui/Alert.jsx):
          mounted with the wish for a sound, filled once the sound is waiting. It lives where the
          toasts do (ui/Toast.jsx): in <body>, exempt from a dialog's inert — an inert region is
          dropped from the accessibility tree, and the waiting must still be said under a dialog. */}
      {active && wanted ? createPortal(
        <div {...{ [MODAL_EXEMPT]: "" }}><Announce text={waiting ? t("signals.soundWaiting") : ""} /></div>,
        document.body,
      ) : null}
      {waiting ? <WaitingButton label={t("signals.soundWaiting")} onClick={resume} /> : null}
    </SignalsContext.Provider>
  );
}
