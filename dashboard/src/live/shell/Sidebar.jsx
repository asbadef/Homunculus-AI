// src/live/shell/Sidebar.jsx — the rail (the prototype's .rail / .ri): the screens this session may
// open, built ones only (routes.js), each a link with its icon AND its name — on a phone (62 px)
// its short name, never an icon alone (roadmap: "Daraltılmış sol menüde her madde kısa adıyla
// görünür"). The current screen is aria-current="page".
//
// A screen the rail does not list (routes.js `nav: false`) is open under the entry it was reached
// FROM: the patient screen is opened from the beds board, so the beds entry reads as current while
// a patient is on screen (`under` in routes.js; the Shell passes it). Wave 2 left this open and
// showed no entry as current, on the ground that the entry does not lead to that page — but a
// clinician spends most of her time on a patient, and a rail with nothing current says "you are
// nowhere" for the whole of it. The patient screen also carries a visible way back to the board,
// so the claim is not only implied (G1-11's decision; the deferred note of Wave 2).
//
// The alarms entry carries the count of unanswered alarms, under the same rule as the bell: a
// number only from a LIVE board.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { waitingAlarms } from "../data/boardStore.js";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { homePath, navRoutes } from "./routes.js";

/** The alarms entry's count: the alarms nobody has acknowledged, and ONLY from a LIVE board
 *  (`waitingAlarms` has Wave 2's Decision 18 applied). A board that may be out of date shows the dot
 *  bell wears rather than a number — a count a reader would take for current is worse than none —
 *  and one that cannot know shows nothing at all. A badge is never the only signal: the entry's
 *  accessible name says the same thing in words. */
function AlarmBadge({ routeId }) {
  const { t } = useI18n();
  const board = useBoard();
  const { known, stale, items } = waitingAlarms(board);
  if (routeId !== "alarms") return null;
  const count = items?.length ?? 0;
  if (known && count > 0) {
    return (
      <>
        <span aria-hidden="true" data-rail-badge="count" className="absolute right-1 top-1 min-w-[16px] rounded-full bg-crit px-1 font-text text-10 font-bold leading-[14px] text-oncrit">{count}</span>
        <span className="sr-only">{` · ${t("shell.bellCount", { count })}`}</span>
      </>
    );
  }
  if (stale) {
    return (
      <>
        <span aria-hidden="true" data-rail-badge="stale" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-mid" />
        <span className="sr-only">{` · ${t("shell.bellStale", { count })}`}</span>
      </>
    );
  }
  return null;
}

function RailLink({ route, current }) {
  const { t } = useI18n();
  const on = route.id === current;
  return (
    <li>
      <a
        href={`#${route.path}`}
        aria-current={on ? "page" : undefined}
        className={`relative flex flex-col items-center gap-1 rounded-box px-0.5 pb-2 pt-[9px] text-center font-text text-10.5 font-semibold leading-[1.15] ${on ? "bg-pri text-onpri" : "text-mute hover:bg-card2 hover:text-ink"} ${FOCUS_RING}`}
      >
        <Icon name={route.icon} size={21} />
        <span className="max-[640px]:hidden">{t(route.labelKey)}</span>
        <span className="hidden text-10 max-[640px]:block">{t(route.shortKey)}</span>
        <AlarmBadge routeId={route.id} />
      </a>
    </li>
  );
}

/** `current`: the id of the route on screen (null when none is). */
export function Sidebar({ perms, current }) {
  const { t } = useI18n();
  const { main, bottom } = navRoutes(perms);
  return (
    <nav aria-label={t("shell.rail")} className="z-30 flex min-h-0 flex-col gap-[3px] overflow-y-auto border-r border-line bg-rail px-2 py-2.5 max-[640px]:px-1">
      <div className="mb-1.5 border-b border-line pb-3 pt-1">
        <a href={`#${homePath(perms)}`} className={`flex flex-col items-center gap-[5px] rounded-box ${FOCUS_RING}`}>
          <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-ctl bg-ink font-display text-20 font-bold text-app">h</span>
          <small className="font-display text-10 font-bold text-mute max-[640px]:hidden">homunculus</small>
          <span className="sr-only">{t("shell.home")}</span>
        </a>
      </div>
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {main.map((route) => <RailLink key={route.id} route={route} current={current} />)}
      </ul>
      <div className="flex-1" />
      <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
        {bottom.map((route) => <RailLink key={route.id} route={route} current={current} />)}
      </ul>
    </nav>
  );
}
