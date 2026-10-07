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
import { Announce, Button, Icon } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { canReach, homePath, matchRoute } from "./routes.js";
import { ShellProvider } from "./ShellContext.jsx";
import { Sidebar } from "./Sidebar.jsx";
import { TopBar } from "./TopBar.jsx";

const pathOf = () => window.location.hash.replace(/^#/, "");
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

function Blocked({ title, help, home }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto my-[10vh] max-w-[460px] rounded-dlg border border-line bg-card px-6 py-7 text-center">
      <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-pri-soft text-pri">
        <Icon name="shield" size={26} />
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

export function Shell() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { scope } = useBoard();
  const units = useMemo(() => scopeUnits(scope), [scope]);
  const path = useHashPath();
  const home = homePath(user.perms);
  const main = useRef(null);
  const shownPath = useRef(path);

  useEffect(() => {
    if (isEmptyPath(path)) window.location.replace(`#${home}`);
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
  let content;
  let title;
  if (!match || !match.route.screen) {
    title = t("shell.notFound");
    content = isEmptyPath(path) ? null : <Blocked title={title} home={home} />;
  } else if (!canReach(match.route, user.perms)) {
    title = t("shell.deny");
    content = <Blocked title={title} help={t("shell.denyHelp")} home={home} />;
  } else {
    title = t(match.route.labelKey);
    const Screen = match.route.screen;
    content = <Screen params={match.params} />;
  }

  useEffect(() => {
    document.title = `${title} · Homunculus`;
  }, [title]);

  return (
    <ShellProvider units={units}>
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
