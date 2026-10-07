// src/live/LiveApp.jsx — the live mode: the bare URL and ?live=1 (main.jsx), lazily loaded.
//
// One session store and one board store per page, both on the real API (roadmap D1: no demo store
// under them). The phase picks the screen: the session check, sign-in, the TOTP step, the forced
// password change, the shell, or the lock screen. The board runs while a session that may see it
// is open or locked (the lock screen counts its open alarms) and is emptied the moment the session
// ends; the toasts are emptied when it locks or ends. Every per-user thing the page held goes with
// the session (sessionStore.js `end`).
import "./theme/assets.js";
import React, { useEffect, useState } from "react";
import { backendApi } from "../backendApi.js";
import { ThemeProvider } from "./theme/ThemeProvider.jsx";
import { I18nProvider } from "./i18n/I18nProvider.jsx";
import { ToastProvider } from "./ui/index.js";
import { SessionProvider, useSession } from "./session/SessionProvider.jsx";
import { PHASE, createSessionStore } from "./session/sessionStore.js";
import { BoardProvider } from "./data/BoardProvider.jsx";
import { createBoardStore } from "./data/boardStore.js";
import { hasWorkRoute } from "./shell/routes.js";
import { PRODUCT, Shell } from "./shell/Shell.jsx";
import { SignIn } from "./auth/SignIn.jsx";
import { MfaStep } from "./auth/MfaStep.jsx";
import { PasswordStep } from "./auth/PasswordStep.jsx";
import { SessionWait } from "./auth/SessionWait.jsx";
import { LockScreen } from "./auth/LockScreen.jsx";

function Phases({ board }) {
  const { phase, user, store } = useSession();
  const open = phase === PHASE.READY || phase === PHASE.LOCKED;
  const watch = open && Boolean(user?.perms.includes("board.view"));
  const owner = watch ? user.id : null;

  useEffect(() => {
    if (owner) board.start();
    else board.clear();
  }, [owner, board]);

  // A ward workstation is shared, and the address bar is not part of the shell: the hash names a
  // patient (#/patients/P-001) and the window's title says who is on screen. When the shell goes
  // — a lock, a sign-out, a session the server ended, a step before one opens — both go with it,
  // or the next person signing in here is taken straight to the last one's patient. replaceState
  // rather than a new entry: the id must not be left one Back press away either.
  // The one address that stays is that of a session being CHECKED (a page load): it is still this
  // clinician's own, so a reload leaves her on the screen she was on.
  useEffect(() => {
    if (phase === PHASE.READY) return;
    document.title = PRODUCT;
    if (phase === PHASE.RESTORING || !window.location.hash) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [phase]);

  let screen;
  if (phase === PHASE.READY) screen = <Shell />;
  else if (phase === PHASE.LOCKED) screen = <LockScreen />;
  else if (phase === PHASE.MFA) screen = <MfaStep />;
  else if (phase === PHASE.PASSWORD) screen = <PasswordStep />;
  else if (phase === PHASE.RESTORING || phase === PHASE.UNREACHABLE) screen = <SessionWait />;
  else screen = <SignIn />;

  return (
    <ToastProvider resetKey={`${phase === PHASE.READY ? "open" : phase}:${store.epoch()}`}>
      <div className="h-full bg-page">{screen}</div>
    </ToastProvider>
  );
}

/** `api` and `openStream` are for the tests; the page uses the real ones. */
export default function LiveApp({ api = backendApi, openStream } = {}) {
  const [session] = useState(() => createSessionStore({ api, canEnter: hasWorkRoute }));
  const [board] = useState(() => createBoardStore({ api, track: session.track, openStream }));
  useEffect(() => {
    session.restore();
    return () => {
      session.dispose();
      board.clear();
    };
  }, [session, board]);
  return (
    <ThemeProvider>
      <I18nProvider>
        <SessionProvider store={session}>
          <BoardProvider store={board}>
            <Phases board={board} />
          </BoardProvider>
        </SessionProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
