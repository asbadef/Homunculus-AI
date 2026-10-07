// src/live/shell/Sidebar.jsx — the rail (the prototype's .rail / .ri): the screens this session may
// open, built ones only (routes.js), each a link with its icon AND its name — on a phone (62 px)
// its short name, never an icon alone (roadmap: "Daraltılmış sol menüde her madde kısa adıyla
// görünür"). The current screen is aria-current="page".
import React from "react";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { Icon } from "../ui/Icon.jsx";
import { FOCUS_RING } from "../ui/focus.js";
import { homePath, navRoutes } from "./routes.js";

function RailLink({ route, current }) {
  const { t } = useI18n();
  const on = route.id === current;
  return (
    <li>
      <a
        href={`#${route.path}`}
        aria-current={on ? "page" : undefined}
        className={`flex flex-col items-center gap-1 rounded-box px-0.5 pb-2 pt-[9px] text-center font-text text-10.5 font-semibold leading-[1.15] ${on ? "bg-pri text-onpri" : "text-mute hover:bg-card2 hover:text-ink"} ${FOCUS_RING}`}
      >
        <Icon name={route.icon} size={21} />
        <span className="max-[640px]:hidden">{t(route.labelKey)}</span>
        <span className="hidden text-10 max-[640px]:block">{t(route.shortKey)}</span>
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
