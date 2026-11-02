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
// The warning the shell and the step screens share (session/IdleWarning.jsx). Re-exported: the
// shell is where a reader of this file looks for it.
import { IDLE_SPOKEN_AGAIN_AT, IdleWarning } from "../session/IdleWarning.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { scopeUnits } from "../data/boardStore.js";
import { CONNECTION } from "../../liveConnection.js";
import { Icon } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { canReach, hashPath, homePath, matchRoute, screenOf } from "./routes.js";
import { ShellProvider } from "./ShellContext.jsx";
import { StructureProvider } from "../data/StructureProvider.jsx";   // G2-B1a
import { Sidebar } from "./Sidebar.jsx";
import { TopBar } from "./TopBar.jsx";

/** The page's title when a screen is on it, and on its own when none is (LiveApp, on a lock or a
 *  sign-out: a shared workstation must not keep naming the last person's page). */
export const PRODUCT = "Homunculus";

const pathOf = () => hashPath(window.location.hash);
const isEmptyPath = (path) => path === "" || path === "/";

export { IDLE_SPOKEN_AGAIN_AT };

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
      {/* G2-B1a: the ward's units and beds by name, for the top bar and every screen. */}
      <StructureProvider>
      <div className="grid h-full grid-cols-[86px_minmax(0,1fr)] bg-page font-text text-14.5 text-ink max-[640px]:grid-cols-[62px_minmax(0,1fr)]">
        <a
          href="#main"
          onClick={(e) => { e.preventDefault(); main.current?.focus(); }}
          className={`sr-only z-[300] rounded-ctl bg-pri px-3 py-2 text-13 font-semibold text-onpri focus:not-sr-only focus:fixed focus:left-2 focus:top-2 ${FOCUS_RING}`}
        >
          {t("shell.skip")}
        </a>
        <Sidebar perms={user.perms} current={match?.route.under ?? match?.route.id ?? null} />
        <div className="grid min-h-0 min-w-0 grid-rows-[58px_minmax(0,1fr)]">
          <TopBar title={title} />
          {/* `relative`: <main> is the containing block for every absolutely positioned descendant, above
              all the screen-reader-only spans (`sr-only` is `position: absolute`). Without it their
              containing block is the app scroller (main.jsx AppShell, `relative … overflow-y-auto`), and
              a span deep in a long screen — the patient screen's trend cards, at 900–1400 px of <main>'s
              content — sits at its static position INSIDE THE SCROLLER, which then has 890 px of scrollable
              overflow below the shell: once <main> reached its end the wheel chained to the scroller, the
              whole shell moved up and the body's dark background filled the window (the ward, 2026-10-26,
              every Chrome; reproduced headless at 1536×730, dpr 1.25: scroller 1525 px for 635 px, and 635
              with this). Positioned here, those spans are clipped and scrolled by <main> like everything else. */}
          <main ref={main} id="main" tabIndex={-1} className="relative min-h-0 overflow-auto px-5 pb-10 pt-[18px] outline-none max-[640px]:px-3 max-[640px]:pt-3.5">
            {content}
          </main>
        </div>
        {secondsLeft !== null ? <IdleWarning seconds={secondsLeft} onStay={stay} titleKey="shell.idle" spokenKey="shell.idleSpoken" /> : null}
      </div>
      </StructureProvider>
    </ShellProvider>
  );
}
