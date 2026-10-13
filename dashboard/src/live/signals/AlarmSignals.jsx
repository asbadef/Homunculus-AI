// src/live/signals/AlarmSignals.jsx — the alarm sound and the critical-alarm notification, on the
// page. Ported (G1-16) from the previous workspace's ClinicalDemo.jsx and clinicalAudio.js before
// they were deleted (readable at e4cdf15); the VM's build behaves as those do.
//
// What the previous workspace did, and what this keeps:
//   * The sound is OPT-IN (it was a top-bar button, off on every page load). Here the choice is in
//     Settings and is kept in this browser (`hmc.alarmSound`) — a ward PC is the alarm station,
//     not a person's — so a reload does not quietly turn it off. A browser still starts audio only
//     after a click or a key press: until one happens a wanted sound is "waiting", and a button on
//     every screen, the lock screen included, says so and starts it.
//   * It plays the worst pattern among the alarms nobody has answered (signals.js), until they are
//     answered — the old one also honoured a snooze, which the live system does not have. On a
//     board whose stream has dropped it plays what the board last had, as the old store kept its
//     alarms then; on a board that cannot say what is open it plays nothing.
//   * A notification is raised for each critical alarm while the page is in the background
//     (`document.hidden`), once per alarm, staying until dismissed (`requireInteraction`), with the
//     old vibration pattern. Its text names the alarm's bed — the HIS bed label, else the patient id
//     (liveAdapters.js `bedLabel`), exactly as the old one did.
// What is new, because the old workspace had no lock screen and never ended a sound at sign-out:
//   * It sits OUTSIDE the phases (LiveApp.jsx): the shell is unmounted when the screen locks, and a
//     locked ward PC must still alert. The board runs while locked (`seesBoard`), so does the sound.
//   * While locked a notification names no bed (`signals.notifyBodyLocked`), and the ones that did
//     are closed at the lock: the lock screen shows numbers only, and the OS notification is not
//     behind it.
//   * When the session ends — sign-out, another account, the server ending it — the sound stops and
//     every notification this page raised is closed. A notification is also closed once a LIVE
//     board says its alarm no longer waits.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useBoard } from "../data/BoardProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";
import { useSession } from "../session/SessionProvider.jsx";
import { PHASE, seesBoard } from "../session/sessionStore.js";
import { Button } from "../ui/index.js";
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
  if (typeof window.Notification !== "function") return "unsupported";
  // Chrome refuses the Notification API on a plain-HTTP origin, silently: the old workspace learned
  // that on a ward visit and said so. So does this.
  if (window.isSecureContext === false) return "insecure";
  return window.Notification.permission;
}

/** An alarm's notification stays until someone dismisses it (`sticky`), as the old one did; the
 *  settings screen's test does not. */
function raise(title, body, sticky = true) {
  try {
    const notification = new window.Notification(title, { body, requireInteraction: sticky, vibrate: VIBRATE });
    navigator.vibrate?.(VIBRATE);
    return notification;
  } catch {
    // Some browsers refuse the constructor outright (Chrome on Android wants a service worker).
    return null;
  }
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
  const pattern = active && wanted ? soundFor(board) : null;
  useEffect(() => {
    if (pattern && audio === "running") engine.play(pattern);
    else engine.stop();
  }, [pattern, audio, engine]);

  useEffect(() => {
    const follow = () => setHidden(document.hidden === true);
    document.addEventListener("visibilitychange", follow);
    return () => document.removeEventListener("visibilitychange", follow);
  }, []);

  // The notifications. Keyed by alarm id — or LOCKED, the one raised while locked.
  const { alerts, connection } = board;
  useEffect(() => {
    const open = raised.current;
    const close = (key) => { open.get(key)?.close?.(); open.delete(key); };
    if (!active || permission !== "granted") {
      for (const key of [...open.keys()]) close(key);
      return;
    }
    const { known, items } = notifyFor({ alerts, connection });
    const keys = locked ? (items.length ? [LOCKED] : []) : items.map((a) => a.id);
    for (const key of [...open.keys()]) {
      const lockChanged = locked !== (key === LOCKED);
      // Only a LIVE board may say an alarm stopped waiting; a lock or an unlock retires the other kind.
      if (lockChanged || (known && !keys.includes(key))) close(key);
    }
    if (!hidden) return;
    if (locked) {
      if (keys.length && !open.has(LOCKED)) open.set(LOCKED, raise(t("signals.notifyTitle"), t("signals.notifyBodyLocked")));
      return;
    }
    for (const alarm of items) {
      if (open.has(alarm.id)) continue;
      open.set(alarm.id, raise(t("signals.notifyTitle"), t("signals.notifyBody", { bed: alarm.bedLabel || "—" })));
    }
  }, [active, permission, alerts, connection, locked, hidden, t]);

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
    if (notifyState() === "granted") raise(t("signals.testTitle"), t("signals.testBody"), false);
  }, [t]);

  const sound = !wanted ? "off" : audio === "running" ? "on" : audio === "unsupported" ? "unsupported" : "waiting";
  const value = { sound, setSound, resume, testSound: () => engine.test(), notify: permission, askNotify, testNotify };

  return (
    <SignalsContext.Provider value={value}>
      {children}
      {active && sound === "waiting" ? (
        <div className="fixed bottom-[22px] left-[22px] z-[210]">
          <Button variant="primary" icon="bell" onClick={resume}>{t("signals.soundWaiting")}</Button>
        </div>
      ) : null}
    </SignalsContext.Provider>
  );
}
