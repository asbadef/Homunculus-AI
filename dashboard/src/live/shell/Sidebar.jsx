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
// number only from a LIVE board. The RRT entry (G2-B5, spec D7) carries the open calls under the
// same rule, in its own words.
//
// G3-05 (D17): the «Yatak başı ölçüm» entry carries how many unmatched readings wait — the shell's own read
// (data/UnmatchedProvider.jsx), not the board's — in a NEUTRAL tone: it is work waiting, not an alarm. A number only
// from a read that succeeded; nothing at all otherwise.
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { useBoard } from "../data/BoardProvider.jsx";
import { useUnmatched } from "../data/UnmatchedProvider.jsx";
import { waitingAlarms } from "../data/boardStore.js";
import { useSnoozeClock } from "../data/useSnoozeClock.js";
import { rrtQueue } from "../screens/rrt/rrt.js";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { homePath, navRoutes } from "./routes.js";
import { Mark } from "./Prefs.jsx";

/** The entries that carry a count, by route id: what each counts — `{known, stale, items}`, items null
 *  when the board cannot know — and the words its accessible name says it in. Every other entry has
 *  none. The alarms entry counts the alarms nobody has acknowledged (`waitingAlarms`); the RRT entry the
 *  open calls nobody has answered (`rrtQueue(board).called`, which an acknowledgement empties). */
const BADGES = Object.freeze({
  alarms: { read: waitingAlarms, countKey: "shell.bellCount", staleKey: "shell.bellStale" },
  rrt: {
    read: (board) => {
      const { known, stale, called } = rrtQueue(board);
      return { known, stale, items: called };
    },
    countKey: "rrt.badgeCount", staleKey: "rrt.badgeStale",
  },
});

/** An entry's count, and ONLY from a LIVE board (both readers have Wave 2's Decision 18 applied). A
 *  board that may be out of date shows the dot the bell wears rather than a number — a count a reader
 *  would take for current is worse than none — and one that cannot know shows nothing at all. A badge
 *  is never the only signal: the entry's accessible name says the same thing in words. */
function RailBadge({ routeId }) {
  // Only the entries with a badge have any use for the board: each reader filters and sorts the whole alert list,
  // and it was once computed for every entry on every render of the rail. So the hooks live in `Badge`, which
  // only those entries render (G2-B5b: the snooze clock with them).
  const badge = BADGES[routeId];
  return badge ? <Badge badge={badge} /> : null;
}

function Badge({ badge }) {
  const { t } = useI18n();
  const board = useBoard();
  // G2-B5b (spec D4): a snoozed alarm is out of the count until its `until`, by the board's clock (useSnoozeClock).
  const nowMs = useSnoozeClock();
  const { known, stale, items } = badge.read({ ...board, nowMs });
  const count = items?.length ?? 0;
  if (known && count > 0) {
    return (
      <>
        <span aria-hidden="true" data-rail-badge="count" className="absolute right-1 top-1 min-w-[16px] rounded-full bg-crit px-1 font-text text-10 font-bold leading-[14px] text-oncrit">{count}</span>
        <span className="sr-only">{` · ${t(badge.countKey, { count })}`}</span>
      </>
    );
  }
  if (stale) {
    return (
      <>
        <span aria-hidden="true" data-rail-badge="stale" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-mid" />
        <span className="sr-only">{` · ${t(badge.staleKey, { count })}`}</span>
      </>
    );
  }
  return null;
}

/** G3-05 (D17): the waiting unmatched sets, on the bedside page's entry. Neutral: no alarm colour. */
function UnmatchedBadge() {
  const { t } = useI18n();
  const { count } = useUnmatched();
  if (!count) return null;
  return (
    <>
      <span aria-hidden="true" data-rail-badge="unmatched" className="absolute right-1 top-1 min-w-[16px] rounded-full border border-line bg-card2 px-1 font-text text-10 font-bold leading-[14px] text-ink">{count}</span>
      <span className="sr-only">{` · ${t("kayit.badgeCount", { count })}`}</span>
    </>
  );
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
        <RailBadge routeId={route.id} />
        {route.id === "olcum" ? <UnmatchedBadge /> : null}
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
          <Mark />
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
