// src/live/shell/TopBar.jsx — the prototype's .top (shell.js topHtml): where you are, the unit
// chip, the clock, then the tools — language, theme, full screen, shortcuts, the alarm bell — and
// the account menu.
//
// Not here (plan "Not in this plan"): the shift-end chip (no source in Group 1 — a user decision),
// the patient/bed search (G1-09 brings the board UI it searches), the role preview.
import React, { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useSession } from "../session/SessionProvider.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { waitingAlarms } from "../data/boardStore.js";
import { CONNECTION } from "../../liveConnection.js";
import { Icon, RiskPill } from "../ui/index.js";
import { FOCUS_RING } from "../ui/focus.js";
import { MenuButton, Popover, TOOL_BUTTON } from "./Menu.jsx";
import { LanguageMenu, ThemeToggle } from "./Prefs.jsx";
import { useShell } from "./ShellContext.jsx";
import { ddmm, hhmm, weekdayKey } from "../i18n/dates.js";

export const BELL_LIST_MAX = 8;
/** The build this page came from (vite.config.js define; "" when the image was built without git). */
const BUILD_SHA = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";

function Clock() {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  // Re-armed to the next minute (useRetryHold.js's way), not an interval: on a 15-second one the
  // minute on screen could be a quarter of a minute behind the wall clock a nurse is charting
  // against, and a ward PC left open all night woke four times a minute to repaint the same
  // digits. A minute boundary is a whole number of minutes from the epoch in every timezone the
  // wards use, so the wait is simply what is left of this minute.
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      timer = setTimeout(tick, 60_000 - (at % 60_000));
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(timer);
  }, []);
  const day = `${t(weekdayKey(now))} ${ddmm(now)}`;
  return (
    <p className="m-0 hidden h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card2 px-2.5 text-11.5 font-semibold text-mute min-[641px]:flex">
      <Icon name="clock" size={14} />
      <span className="max-[860px]:hidden">{day}</span>
      <time dateTime={new Date(now).toISOString()} className="font-data text-ink">{hhmm(now)}</time>
    </p>
  );
}

/** The unit the board is shown for. Its list is the engine's own scope; while a load keeps failing
 *  the last list stands, and the chip wears the bell's "may be out of date" ring and says so in
 *  its name — otherwise a unit the engine has since revoked could stand there indefinitely with
 *  nothing said. A board with no scope at all offers nothing (ShellContext.jsx). */
function UnitChip() {
  const { t } = useI18n();
  const { unit, setUnit, units, stale } = useShell();
  if (units.length < 2) return null;
  return (
    <MenuButton
      label={stale ? `${t("shell.unitChoice")} · ${t("shell.unitsStale")}` : t("shell.unitChoice")}
      buttonClassName={`relative hidden h-9 shrink-0 items-center gap-2 rounded-ctl border border-line bg-card2 px-2.5 text-12.5 font-semibold text-ink min-[641px]:inline-flex ${FOCUS_RING}`}
      button={(
        <>
          <Icon name="building" size={16} />
          <span className="max-w-[160px] truncate">{unit ?? t("shell.units", { count: units.length })}</span>
          <Icon name="chevD" size={14} className="text-mute" />
          {stale ? (
            <span aria-hidden="true" data-unit="stale" className="absolute inset-0 rounded-ctl ring-2 ring-inset ring-mid" />
          ) : null}
        </>
      )}
      items={[
        { key: "", label: t("shell.allUnits"), checked: unit === null, onSelect: () => setUnit(null) },
        "separator",
        ...units.map((u) => ({ key: u, label: <span className="font-data">{u}</span>, checked: unit === u, onSelect: () => setUnit(u) })),
      ]}
    />
  );
}

function FullscreenButton() {
  const { t } = useI18n();
  const [on, setOn] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const sync = () => setOn(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  if (typeof document.documentElement.requestFullscreen !== "function") return null;
  const label = t(on ? "shell.exitFullscreen" : "shell.fullscreen");
  // A browser that refuses — or an older one that answers with nothing instead of a promise —
  // must not throw out of a click handler. Nothing clinical depends on full screen: if it does
  // not happen, the page carries on exactly as it was.
  const toggle = () => {
    try {
      Promise.resolve(on ? document.exitFullscreen() : document.documentElement.requestFullscreen())
        .catch(() => {});
    } catch {
      // refused outright (no user gesture, a policy, no exitFullscreen): nothing to do
    }
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={toggle}
      className={`${TOOL_BUTTON} max-[1100px]:hidden`}
    >
      <Icon name="fullscreen" size={19} />
    </button>
  );
}

function Keys() {
  const { t } = useI18n();
  const rows = [["Esc", "shell.keyClose"], ["Alt L", "shell.keyLock"], ["F11", "shell.keyFull"]];
  return (
    <Popover label={t("shell.keys")} buttonClassName={`${TOOL_BUTTON} max-[640px]:hidden`} button={<Icon name="keyboard" size={19} />}>
      {() => (
        <dl className="m-0 min-w-[260px] p-1 text-13">
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-1.5">
              <dt>{t(label)}</dt>
              <dd className="m-0"><kbd className="rounded-md border border-b-2 border-line2 bg-card2 px-1.5 py-1 font-data text-10.5 font-semibold text-mute">{key}</kbd></dd>
            </div>
          ))}
        </dl>
      )}
    </Popover>
  );
}

/** An alarm's severity as the pill may show it. "none" is a PATIENT's risk — "no alarm at all" —
 *  and never an alarm's own severity; shown as one, `measured` would make the pill read "no
 *  finding" beside an alarm nobody has answered. It is handed over as an unreported risk instead:
 *  riskStyle's attention look, never calm. A severity this build does not know keeps its text
 *  ("unknown risk: <it>"), and a missing one is already null here (liveAdapters). */
const pillRisk = (severity) => (severity === "none" ? null : severity);

/** The alarms nobody has acknowledged yet, in this session's scope. The board store answers with
 *  Decision 18 already applied (`waitingAlarms`): `known` — a LIVE board, the only one that may
 *  say "none"; `stale` — a DEGRADED one, what it last had, marked as possibly out of date;
 *  neither — `items` is null, and it says it cannot know (still loading, or no connection), never
 *  a 0 and never an empty bell.
 *
 *  The three states are told apart on the button itself, not only in its name: a board that
 *  stopped updating wears its own ring and amber dot, and the grey dot is kept for "cannot know".
 *  Without that, a DEGRADED bell with nothing waiting — no badge, one grey dot — looked at a
 *  glance exactly like a calm ward. */
function Bell() {
  const { t } = useI18n();
  const board = useBoard();
  const { known, stale, items } = waitingAlarms(board);
  const waiting = items ?? [];
  let status;
  if (known) status = waiting.length ? t("shell.bellCount", { count: waiting.length }) : t("shell.bellNone");
  else if (stale) status = t("shell.bellStale", { count: waiting.length });
  else status = t(board.connection === CONNECTION.CONNECTING ? "shell.bellConnecting" : "shell.bellUnavailable");
  return (
    <Popover
      label={`${t("shell.bell")} · ${status}`}
      // On a phone the panel spans the screen under the top bar: hung from the bell it would run
      // off the left edge.
      panelClassName="w-[400px] p-0 max-[640px]:fixed max-[640px]:inset-x-2 max-[640px]:top-[62px] max-[640px]:w-auto"
      button={(
        <>
          <Icon name="bell" size={19} />
          {waiting.length ? (
            <span aria-hidden="true" data-bell="count" className="absolute -right-1 -top-1 min-w-[16px] rounded-full border-2 border-rail bg-crit px-1 font-text text-10 font-bold leading-[14px] text-oncrit">{waiting.length}</span>
          ) : null}
          {stale ? (
            <>
              {/* `ring-inset`: a ring is drawn OUTSIDE its box by default, and this one lies over
                  the whole button in a tool row with a 2 px gap — it touched the neighbouring
                  tool and the count badge. */}
              <span aria-hidden="true" data-bell="stale" className="absolute inset-0 rounded-ctl ring-2 ring-inset ring-mid" />
              <span aria-hidden="true" className="absolute bottom-1 right-1 h-2 w-2 rounded-full border-2 border-rail bg-mid" />
            </>
          ) : null}
          {!known && !stale ? (
            <span aria-hidden="true" data-bell="unknown" className="absolute bottom-1 right-1 h-2 w-2 rounded-full border-2 border-rail bg-mute" />
          ) : null}
        </>
      )}
    >
      {() => (
        <div>
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">
            <h2 className="m-0 font-display text-15 font-bold">{t("shell.bell")}</h2>
          </div>
          <p className="m-0 px-3.5 py-2.5 text-12.5 text-mute">{status}</p>
          {waiting.length ? (
            <ul className="m-0 max-h-[min(460px,60vh)] list-none overflow-auto p-0">
              {waiting.slice(0, BELL_LIST_MAX).map((a) => (
                <li key={a.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2.5 border-t border-line px-3.5 py-2.5">
                  <RiskPill risk={pillRisk(a.severity)} measured />
                  <div className="min-w-0">
                    <b className="block font-data text-13">{a.bedLabel}</b>
                    <span className="block text-12 text-mute">{a.summary ?? a.kind}</span>
                  </div>
                  <span className="whitespace-nowrap font-data text-11 font-semibold text-mute">
                    {a.firstSeenAtMs ? t("shell.bellSince", { time: hhmm(a.firstSeenAtMs) }) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {waiting.length > BELL_LIST_MAX ? (
            <p className="m-0 border-t border-line bg-card2 px-3.5 py-2.5 text-12 text-mute">{t("shell.bellMore", { count: waiting.length - BELL_LIST_MAX })}</p>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function AccountMenu() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const initials = (user.fullName || user.username).split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("");
  return (
    <MenuButton
      label={t("shell.account")}
      buttonClassName={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-pri font-text text-12 font-bold text-onpri ${FOCUS_RING}`}
      button={<span aria-hidden="true">{initials}</span>}
      header={(
        <div className="px-2.5 pb-2 pt-1.5">
          <b className="block text-14">{user.fullName}</b>
          <small className="block text-12 text-mute">{user.groups.map((g) => g.name).join(" · ") || user.username}</small>
          <small className="mt-1 block font-data text-10.5 text-mute">
            {BUILD_SHA ? t("shell.version", { sha: BUILD_SHA }) : t("shell.versionUnknown")}
          </small>
        </div>
      )}
      items={[
        "separator",
        { key: "settings", label: t("nav.settings"), icon: "gear", onSelect: () => { window.location.hash = "#/settings"; } },
        { key: "lock", label: t("shell.lock"), icon: "lock", onSelect: () => store.lock("manual") },
        { key: "out", label: t("shell.signOut"), icon: "out", onSelect: () => store.signOut() },
      ]}
    />
  );
}

/** `title`: the page's name, for the breadcrumb after the hospital's. */
export function TopBar({ title }) {
  const { user } = useSession();
  const seesBoard = user.perms.includes("board.view");
  return (
    <header className="flex h-[58px] min-w-0 items-center gap-2.5 border-b border-line bg-rail px-4 max-[640px]:gap-1.5 max-[640px]:px-2">
      <p className="m-0 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap font-display text-17 font-bold">
        <span className="truncate text-mute max-[860px]:hidden">{user.tenantName || user.tenant}</span>
        <Icon name="chevR" size={16} className="shrink-0 text-mute max-[860px]:hidden" />
        <span className="truncate">{title}</span>
      </p>
      <UnitChip />
      <span className="ml-auto" />
      <Clock />
      <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-2 max-[640px]:border-l-0 max-[640px]:pl-0">
        <LanguageMenu />
        <ThemeToggle />
        <FullscreenButton />
        <Keys />
        {seesBoard ? <Bell /> : null}
      </div>
      <AccountMenu />
    </header>
  );
}
