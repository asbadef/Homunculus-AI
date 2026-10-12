// src/live/screens/admin/useAdminData.js — what the three administration tabs read, loaded once.
//
// Ported from the old workspace's `liveStore.loadAdmin`, whose rules were learned the hard way:
//   * ASK ONLY WHAT THE RIGHTS ALLOW. `/admin/users` needs `users.manage`; `/admin/groups` takes
//     either `users.manage` or `groups.manage` (a user desk must be able to list the groups it may
//     give); `/admin/permissions` needs `groups.manage`. A call the session cannot make is not
//     made, and its read says so: "unasked".
//   * ONE REFUSAL DOES NOT EMPTY THE SCREEN. `Promise.allSettled`: a 403 on one call leaves the
//     others standing and lands in `failures`, named after its read, so a desk with half the
//     rights sees half the screen rather than none of it.
//   * A STALE LOAD NEVER OVERWRITES A NEWER ONE (`seq`), and nothing is written after unmount.
//   * EVERY CALL GOES THROUGH THE SESSION'S `track`, so a refused refresh ends the session here
//     too and a 403 `password_change_required` moves the shell on.
//
// EACH READ HAS A STATE, AND A FAILED READ IS NEVER AN EMPTY LIST. The first version turned a
// refused or failed read into `[]` — the same value as "this hospital has no users" — so a reload
// after a write whose re-read failed WIPED the list on screen (measured: three users to none, under
// an Alert that did not say which read had failed, above a tab that then said "no user matches").
// Now `data[read]` is the LAST ANSWER the server gave for that read, `null` until one arrived, and
// `reads[read]` says what it is:
//
//   "unasked" — the session's rights do not allow the call, so it was not made; `data` is null.
//   "loading" — asked, and no answer has arrived yet; `data` is null.
//   "known"   — the latest attempt answered; `data` is that answer.
//   "stale"   — the latest attempt failed and an earlier one answered; `data` is the EARLIER answer,
//               kept rather than wiped, and the frame's Alert says it is the last one received.
//   "failed"  — no attempt has answered; `data` is null.
//
// A list is shown when its read is "known" or "stale"; a COUNT (the unassigned users, a group's
// members) only when its read is "known" — the rule the clinical screens settled (amendments (b)).
//
// What it does NOT do, and why: the old version re-read `/auth/me` first, so a token minted before
// a key was added to this session's group would not grey out what the server allows. The new
// session store already re-reads the token's rights after every tracked call (`syncRights`) and
// re-reads `/auth/me` at restore and at sign-in, so the gap is at most one access token's life.
// And the greying is a HINT: the server decides every write, and its refusal is what the screen
// shows. One more call on every open of this screen is not worth closing a gap that closes itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/SessionProvider.jsx";
import { groupFromApi, userFromApi } from "./rules.js";
import { hasPerm } from "./catalogue.js";

/** The four reads, in the order the frame names their failures. */
export const READS = Object.freeze(["users", "groups", "catalogue", "unassigned"]);

const NOTHING = Object.freeze({ users: null, groups: null, catalogue: null, unassigned: null });

/** Which reads these rights allow. */
function allowed(perms) {
  return {
    users: hasPerm(perms, "users.manage"),
    groups: hasPerm(perms, "users.manage") || hasPerm(perms, "groups.manage"),
    catalogue: hasPerm(perms, "groups.manage"),
    unassigned: hasPerm(perms, "users.manage"),
  };
}

/** An answer as the tabs render it. A list the server answered with something that is not a list
 *  is an empty one; a count it did not send is null — still "known", the server answered. */
const ADAPT = {
  users: (value) => (Array.isArray(value) ? value.map(userFromApi) : []),
  groups: (value) => (Array.isArray(value) ? value.map(groupFromApi) : []),
  catalogue: (value) => (Array.isArray(value) ? value : []),
  unassigned: (value) => (Number.isFinite(value?.unassigned_users) ? value.unassigned_users : null),
};

/**
 * Returns `{ data, reads, failures, loading, reload }`:
 *   data      `{users, groups, catalogue, unassigned}` — each read's last answer, or null;
 *   reads     `{users, groups, catalogue, unassigned}` — each read's state (above);
 *   failures  `[{read, error}]` — the reads the latest load could not make, in `READS` order. They
 *             stay while a reload is in flight, so the Alert and its Retry are not pulled out from
 *             under the administrator who pressed it;
 *   loading   a load is in flight;
 *   reload()  load again — every write calls it, so the screen shows what the server holds.
 */
export function useAdminData() {
  const { user, store } = useSession();
  const api = store.api;
  const perms = user.perms;
  const [data, setData] = useState(NOTHING);
  const [reads, setReads] = useState(() => {
    const may = allowed(perms);
    return Object.fromEntries(READS.map((read) => [read, may[read] ? "loading" : "unasked"]));
  });
  const [failures, setFailures] = useState([]);
  const [loading, setLoading] = useState(true);
  /** The data and states the next load starts from — read synchronously, so a load's own answers
   *  are decided against what was on screen when it settled, not against a render that may lag. */
  const last = useRef({ data: NOTHING, reads: null });
  const seq = useRef(0);
  // Set true INSIDE the effect, as the house pattern does (auth/LockScreen.jsx): StrictMode's
  // rehearsal runs this cleanup and then the effect again, and a ref set true only at creation
  // stayed false after it — every answer was then dropped as "unmounted" and the screen said
  // "loading" for ever. Declared before the effect that loads, so it is true when the load starts.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    const now = store.getState().user?.perms ?? perms;
    const may = allowed(now);
    const call = {
      users: () => api.adminUsers(),
      groups: () => api.adminGroups(),
      catalogue: () => api.adminPermissions(),
      unassigned: () => api.unassignedScopes(),
    };
    const answers = await Promise.allSettled(
      READS.map((read) => (may[read] ? store.track(call[read]) : Promise.resolve(null))),
    );
    if (!mounted.current || seq.current !== mine) return;
    const was = last.current.data;
    const nextData = {};
    const nextReads = {};
    const failed = [];
    READS.forEach((read, at) => {
      const answer = answers[at];
      if (!may[read]) {
        // A read this session may no longer make is dropped, not kept: "unasked" is never stale.
        nextData[read] = null;
        nextReads[read] = "unasked";
      } else if (answer.status === "fulfilled") {
        nextData[read] = ADAPT[read](answer.value);
        nextReads[read] = "known";
      } else {
        // The previous answer STAYS: a failed re-read is not news that the list is empty.
        nextData[read] = was[read];
        nextReads[read] = was[read] === null ? "failed" : "stale";
        failed.push({ read, error: answer.reason });
      }
    });
    last.current = { data: nextData, reads: nextReads };
    setData(nextData);
    setReads(nextReads);
    setFailures(failed);
    setLoading(false);
  }, [api, store, perms]);


  useEffect(() => { reload(); }, [reload]);

  return { data, reads, failures, loading, reload };
}
