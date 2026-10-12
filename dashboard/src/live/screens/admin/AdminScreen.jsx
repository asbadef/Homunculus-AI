// src/live/screens/admin/AdminScreen.jsx — administration: one screen, three tabs (the
// prototype's `admin.js`, reduced to the three the API can back in Group 1).
//
//   Users            G1-12   `users.manage`                      /admin/users, /scope
//   Roles            G1-13   `groups.manage`                     /admin/groups, /admin/permissions
//   Sign-in source   G1-14   `users.manage` (reading)            /admin/ldap/*
//
// THE TAB IS HELD IN STATE, NOT IN THE ADDRESS. The hash belongs to the router, and a query inside
// it belongs to the screen (`routes.js hashPath`) — but reading one would need a second
// `hashchange` listener in every tabbed screen, and the shell deliberately settles the address
// once at mount and does not read the bar again. A tab is a view of one screen, the rail links to
// the screen, and nothing in the product links to a tab. *Rejected:* `#/admin?tab=roles` (a second
// listener, and an address that survives a lock into a shell that settled elsewhere).
//
// EVERY TAB IS GATED SEPARATELY, and the gate is the session's own rights. The route opens to
// `users.manage` OR `groups.manage` (routes.js), so a session can arrive holding one and not the
// other: the tabs it may not open are not shown, and the screen opens on the first it may. A
// session that may open none of them cannot reach the route at all.
//
// HOW A WAVE ADDS ITS TAB: its own commented import below and its own line in `TABS` — two lines
// nobody else touches, the same seam `shell/routes.js` and `i18n/catalog.js` have, so G1-12, G1-13
// and G1-14 can be built on parallel branches. A tab with no component shows "not built yet" and
// is NOT offered: never a dead tab.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, TabPanel, Tabs } from "../../ui/index.js";
import { hasPerm } from "./catalogue.js";
import { READS, useAdminData } from "./useAdminData.js";
// G1-12: import { UsersTab } from "./UsersTab.jsx";

// G1-13: import { RolesTab } from "./RolesTab.jsx";

// G1-14: import { SourceTab } from "./SourceTab.jsx";

const TAB_ID = "admin";

/** Each read's name, for the Alert that says which one failed. Written out, never built from the
 *  read's id: a key assembled at run time is one no check can see. */
const READ_LABEL = Object.freeze({
  users: "admin.readUsers",
  groups: "admin.readGroups",
  catalogue: "admin.readCatalogue",
  unassigned: "admin.readUnassigned",
});

/** The three tabs, in order: the id, the right that opens it and its label. Frozen, like the route
 *  table it is modelled on (`shell/routes.js`): which right opens which tab is the same for every
 *  session and every test, and nothing may widen it at run time. */
export const TABS = Object.freeze([
  Object.freeze({ id: "users", perm: "users.manage", labelKey: "admin.tabUsers" }),
  Object.freeze({ id: "roles", perm: "groups.manage", labelKey: "admin.tabRoles" }),
  Object.freeze({ id: "source", perm: "users.manage", labelKey: "admin.tabSource" }),
]);

/** The component each tab shows in THIS build — `null` until its wave sets it. THIS is the line a
 *  wave edits, and only its own; `resetTabs` puts it back whatever a test stood in for.
 *
 *  Each line has a BLANK LINE on either side, like the import block above, `i18n/catalog.js` and
 *  `shell/routes.js`'s `SCREENS`. The gaps are the whole mechanism: git merges line ranges, so
 *  three arms editing three ADJACENT lines of one object conflict on the second merge every time —
 *  which this block did until it was measured with `git merge` itself. Do not tidy them away. */
const TAB_SCREENS = Object.freeze({
  users: null, //    G1-12

  roles: null, //    G1-13

  source: null, //   G1-14
});

/** What `tabScreenOf` reads: this build's own tabs, until a test stands in for one. */
const BUILT = { ...TAB_SCREENS };

/** The component a tab shows, or null when this build has not built it. */
export function tabScreenOf(tab) {
  return (tab && BUILT[tab.id]) || null;
}

function testOnly(what) {
  if (import.meta.env?.MODE !== "test") {
    throw new Error(`${what} is a test seam: a build's tabs are the ones it was built with`);
  }
}

/** TEST ONLY — stand in for the tabs a later branch will build ({tabId: Component}); returns
 *  `resetTabs`, which an `afterEach` MUST call. The parallel branches of Wave 3 do NOT call this:
 *  each edits its own line in TAB_SCREENS above.
 *
 *  It ASSIGNS, so a tab it does not name keeps whatever this build has. A test whose subject is
 *  WHICH tabs exist must use `onlyTabs` instead — see there. */
export function stubTabs(screens) {
  testOnly("stubTabs");
  Object.assign(BUILT, screens);
  return resetTabs;
}

/** TEST ONLY — the tab table reduced to `screens`: every tab this call does not name has NO
 *  component, whatever this build built.
 *
 *  Why it exists, and it is the same lesson `shell/screens.testutil.js` carries for the routes.
 *  `stubTabs` only assigns, so "this build has nothing to show" and "this build has only the roles
 *  tab" could not be SAID — they could only be true by accident, of a build with no tabs. Three of
 *  the frame's own tests were written that way, and all three broke the moment the first tab was
 *  built, in a file none of the three parallel branches owns: exactly the collision the two-line
 *  seam exists to prevent, reintroduced in the tests. A test that cares which tabs exist states it;
 *  one that does not uses the build and asserts through `openTabs` / `tabScreenOf`. */
export function onlyTabs(screens = {}) {
  testOnly("onlyTabs");
  const table = {};
  for (const tab of TABS) table[tab.id] = null;
  return stubTabs({ ...table, ...screens });
}

/** TEST ONLY — every tab back to the component this build actually has. */
export function resetTabs() {
  testOnly("resetTabs");
  Object.assign(BUILT, TAB_SCREENS);
}

/** The tabs this session may open AND this build has built — in that order, so an unbuilt tab is
 *  not offered at all rather than offered and then refused. */
export function openTabs(perms) {
  return TABS.filter((tab) => hasPerm(perms, tab.perm) && tabScreenOf(tab));
}

export function AdminScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const admin = useAdminData();
  const tabs = useMemo(() => openTabs(user.perms), [user.perms]);
  const [tab, setTab] = useState(() => tabs[0]?.id ?? null);
  // A session whose rights changed under it (another tab, a refresh) may no longer open the tab it
  // is on: fall back to the first it may, as the old admin page did on every render.
  const current = tabs.find((x) => x.id === tab) ?? tabs[0] ?? null;
  const shown = tabs.map((x) => ({ value: x.id, label: t(x.labelKey) }));
  const Shown = tabScreenOf(current);
  // The first load only — a reload with rows already on screen leaves them there, and announcing
  // "loading" over a table a clinician is reading would be noise, not information. Nothing has
  // answered yet exactly when every read's data is still null.
  const firstLoad = admin.loading && READS.every((read) => admin.data[read] === null);

  // RETRY KEEPS ITS FOCUS. The failures stay while the reload runs (`useAdminData`), so the button
  // is still there, busy, holding a keyboard user's focus. When the reload answers, the Alert goes
  // and its button with it — and focus would fall to <body>, saying nothing. So a Retry pressed
  // from inside the Alert hands the focus to the screen's own heading once the Alert has gone; a
  // Retry that failed again keeps its button, and the focus on it.
  const heading = useRef(null);
  const alertBox = useRef(null);
  const [refocus, setRefocus] = useState(false);
  async function retry() {
    const held = Boolean(alertBox.current?.contains(document.activeElement));
    await admin.reload();
    if (held) setRefocus(true);
  }
  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    if (!alertBox.current) heading.current?.focus();
  }, [refocus]);

  return (
    <div className="flex min-h-0 max-w-[1100px] flex-col gap-3">
      <div>
        <h1 ref={heading} tabIndex={-1} className="m-0 font-display text-23 font-bold outline-none">{t("admin.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("admin.sub", { hospital: user.tenantName || user.tenant })}</p>
      </div>

      {/* One region, always mounted, empty until there is something to say. A live region that is
          born holding its text is not announced at all (ui/Alert.jsx, ANNOUNCE_DELAY_MS) — which is
          what a `<p role="status">{t("admin.loading")}</p>` rendered only while loading would be.
          The visible sentence below is therefore an ordinary paragraph, and this says it. */}
      <Announce text={firstLoad ? t("admin.loading") : ""} />

      {/* A refusal on ONE call does not empty the screen: it is shown, NAMED AFTER THE READ that
          failed, and whatever the other calls answered stands. A read that had answered before
          keeps that answer ("stale") and the sentence says it is the last one received. */}
      {admin.failures.length > 0 ? (
        <div ref={alertBox}>
          <Alert tone="crit">
            {admin.failures.map(({ read, error }) => (
              <p key={read} className="m-0">
                {t(admin.reads[read] === "stale" ? "admin.readStale" : "admin.readFailed", {
                  read: t(READ_LABEL[read]), reason: readErrorText(t, error),
                })}
              </p>
            ))}
            <Button size="sm" busy={admin.loading} onClick={retry}>{t("admin.retry")}</Button>
          </Alert>
        </div>
      ) : null}

      {tabs.length === 0 ? (
        <Empty icon="shield">{t("admin.noAccess")}</Empty>
      ) : (
        <>
          <Tabs id={TAB_ID} label={t("admin.sections")} tabs={shown} value={current.id} onChange={setTab} />
          <TabPanel id={TAB_ID} tabs={shown} value={current.id}>
            {firstLoad ? (
              <Box><p className="m-0 text-13 text-mute">{t("admin.loading")}</p></Box>
            ) : (
              <Shown admin={admin} />
            )}
          </TabPanel>
        </>
      )}
    </div>
  );
}
