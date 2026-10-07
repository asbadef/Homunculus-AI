// src/live/shell/Shell.jsx — the signed-in frame: skip link, rail, top bar, the screen, and the
// idle lock. The prototype's .shell (shell.js renderApp).
//
// Routing is the address's hash (#/beds, #/patients/P-1): no server rule and no new dependency.
// An address the session may not open is a "no access" page, one that names nothing (or a screen
// of a later wave) is "no such page" — never a blank, never a silent jump elsewhere. The empty
// address lands on the session's home (routes.js homePath). After a move between screens — back
// to the first one too — focus goes to <main>, so a screen reader starts at the new screen.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { useIdleLock } from "../session/useIdleLock.js";
import { useBoard } from "../data/BoardProvider.jsx";
import { scopeUnits } from "../data/boardStore.js";
import { CONNECTION } from "../../liveConnection.js";
import { Announce, Button, Icon } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { canReach, hashPath, homePath, matchRoute, screenOf } from "./routes.js";
import { ShellProvider } from "./ShellContext.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { TopBar } from "./TopBar.jsx";

/** The page's title when a screen is on it, and on its own when none is (LiveApp, on a lock or a
 *  sign-out: a shared workstation must not keep naming the last person's page). */
export const PRODUCT = "Homunculus";

const pathOf = () => hashPath(window.location.hash);
const isEmptyPath = (path) => path === "" || path === "/";

/** Seconds before the lock at which the warning is said once more (it is said when it opens). */
export const IDLE_SPOKEN_AGAIN_AT = 10;

function useHashPath() {
  const [path, setPath] = useState(pathOf);
  useEffect(() => {
    const sync = () => setPath(pathOf());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return path;
}

/** The router's two refusals. `icon`: a shield for a page this session may not open, a sheet of
 *  paper for one that does not exist — the same picture for both would read every mistyped
 *  address as "you are not allowed in here". */
function Blocked({ icon, title, help, home }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto my-[10vh] max-w-[460px] rounded-dlg border border-line bg-card px-6 py-7 text-center">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-pri-soft text-pri">
        <Icon name={icon} size={26} />
      </div>
      <h1 className="m-0 mb-1.5 font-display text-20 font-bold">{title}</h1>
      {help ? <p className="m-0 mb-4 text-mute">{help}</p> : null}
      <a href={`#${home}`} className={`inline-flex items-center gap-1.5 rounded-ctl bg-pri px-[13px] py-2 text-13 font-semibold text-onpri ${FOCUS_RING}`}>
        {t("shell.home")}
      </a>
    </div>
  );
}

/** The last minute before the idle lock. The count on screen moves every second; what a screen
 *  reader hears does not — it is said when the warning opens and once more IDLE_SPOKEN_AGAIN_AT
 *  seconds before the lock, not sixty times (ui/Alert.jsx `Announce`: one region that stays and
 *  takes its text afterwards, so the same text twice over is not said twice). */
function IdleWarning({ seconds, onStay }) {
  const { t } = useI18n();
  const opened = useRef(seconds);
  const spoken = seconds <= IDLE_SPOKEN_AGAIN_AT ? Math.min(opened.current, IDLE_SPOKEN_AGAIN_AT) : opened.current;
  return (
    <div className="fixed bottom-[22px] left-1/2 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-box border border-mid bg-card px-3.5 py-3 font-text text-13 text-ink shadow-pop">
      <Announce text={t("shell.idleSpoken", { seconds: spoken })} />
      <Icon name="lock" size={20} className="text-mid-ink" />
      <div aria-hidden="true">
        <b className="block">{t("shell.idle")}</b>
        <small className="text-mute">{t("shell.idleWhy", { seconds })}</small>
      </div>
      <Button variant="primary" size="sm" onClick={onStay}>{t("shell.idleStay")}</Button>
    </div>
  );
}

/** `resume`: the screen this session was on when its shell last went (LiveApp keeps it outside the
 *  URL). Used once, and only while the address is empty — a reload or a deep link wins over it. */
export function Shell({ resume = "" }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { scope, connection } = useBoard();
  // `scope` is null both while nothing has been loaded and after a load that FAILED, and the two
  // are not the same thing (ShellContext.jsx): a failed load leaves the session's units unknown,
  // so the chip and the clinician's choice survive it, marked out of date — while a board that
  // was never loaded, or one emptied because this session may not see it, has no units at all.
  const units = useMemo(() => scopeUnits(scope), [scope]);
  const scopeState = scope !== null ? "known"
    : connection === CONNECTION.CONNECTING ? "none" : "stale";
  const path = useHashPath();
  const home = homePath(user.perms);
  const main = useRef(null);
  const shownPath = useRef(path);

  // Where this shell opens. Settled ONCE, at mount, whatever the address bar says — because the
  // bar is not to be trusted at that moment: the entries a previous session's rail links pushed
  // outlive it (a sign-out replaces only the entry the page is on), so one press of Back at the
  // sign-in screen can put the last person's screen — with G1-11, her patient — back into the
  // bar, and a shell that honoured it would open there. `resume` is this session's own screen, or
  // the bookmark the page was opened with, or its home (LiveApp, routes.js resumePath).
  // Idempotent: the same write however often the effect runs (StrictMode runs each one twice).
  // In-session Back and forward are untouched — they happen after this.
  const firstPath = useRef(resume || home);
  useEffect(() => {
    window.location.replace(`#${firstPath.current}`);
  }, []);
  // And if the address is emptied later — by hand, or by a link that names nothing — home rather
  // than "no such page". Read from the live hash, not from `path`, which still holds the value
  // the effect above has just replaced.
  useEffect(() => {
    if (isEmptyPath(path) && isEmptyPath(hashPath(window.location.hash))) {
      window.location.replace(`#${home}`);
    }
  }, [path, home]);

  // Focus the new screen after every move — back to the first one too — but not when the page
  // has just loaded, nor when an empty address was sent home.
  useEffect(() => {
    const from = shownPath.current;
    if (from === path) return;
    shownPath.current = path;
    if (!isEmptyPath(from)) main.current?.focus();
  }, [path]);

  const { secondsLeft, stay } = useIdleLock({ minutes: user.lockIdleMinutes, onIdle: () => store.lock("idle") });

  useEffect(() => {
    // The key's place, not its letter: Alt+L on an Azerbaijani, Russian or Turkish layout — or a
    // Mac's Option+L, which types "¬" — is the same key.
    const onKey = (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyL") {
        event.preventDefault();
        store.lock("manual");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  const match = matchRoute(path);
  const Screen = screenOf(match?.route);
  let content;
  let title;
  if (!Screen) {
    title = t("shell.notFound");
    content = isEmptyPath(path) ? null : <Blocked icon="file" title={title} home={home} />;
  } else if (!canReach(match.route, user.perms)) {
    title = t("shell.deny");
    content = <Blocked icon="shield" title={title} help={t("shell.denyHelp")} home={home} />;
  } else {
    title = t(match.route.labelKey);
    content = <Screen params={match.params} />;
  }

  useEffect(() => {
    document.title = `${title} · ${PRODUCT}`;
  }, [title]);

  return (
    <ShellProvider units={units} scope={scopeState}>
      <div className="grid h-full grid-cols-[86px_minmax(0,1fr)] bg-page font-text text-14.5 text-ink max-[640px]:grid-cols-[62px_minmax(0,1fr)]">
        <a
          href="#main"
          onClick={(e) => { e.preventDefault(); main.current?.focus(); }}
          className={`sr-only z-[300] rounded-ctl bg-pri px-3 py-2 text-13 font-semibold text-onpri focus:not-sr-only focus:fixed focus:left-2 focus:top-2 ${FOCUS_RING}`}
        >
          {t("shell.skip")}
        </a>
        <Sidebar perms={user.perms} current={match?.route.id ?? null} />
        <div className="grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)]">
          <TopBar title={title} />
          <main ref={main} id="main" tabIndex={-1} className="min-h-0 overflow-auto px-5 pb-10 pt-[18px] outline-none max-[640px]:px-3 max-[640px]:pt-3.5">
            {content}
          </main>
        </div>
        {secondsLeft !== null ? <IdleWarning seconds={secondsLeft} onStay={stay} /> : null}
      </div>
    </ShellProvider>
  );
}
