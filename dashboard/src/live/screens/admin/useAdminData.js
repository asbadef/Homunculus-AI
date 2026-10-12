// src/live/screens/admin/useAdminData.js — what the three administration tabs read, loaded once.
//
// Ported from the old workspace's `liveStore.loadAdmin`, whose rules were learned the hard way:
//   * ASK ONLY WHAT THE RIGHTS ALLOW. `/admin/users` needs `users.manage`; `/admin/groups` takes
//     either `users.manage` or `groups.manage` (a user desk must be able to list the groups it may
//     give); `/admin/permissions` needs `groups.manage`. A call the session cannot make is not
//     made — "not asked" is an empty list, never an error on the screen.
//   * ONE REFUSAL DOES NOT EMPTY THE SCREEN. `Promise.allSettled`: a 403 on one call leaves the
//     others standing and lands in `error`, so a desk with half the rights sees half the screen
//     rather than none of it.
//   * A STALE LOAD NEVER OVERWRITES A NEWER ONE (`seq`), and nothing is written after unmount.
//   * EVERY CALL GOES THROUGH THE SESSION'S `track`, so a refused refresh ends the session here
//     too and a 403 `password_change_required` moves the shell on.
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

const EMPTY = Object.freeze({ users: [], groups: [], catalogue: [], unassigned: null });

/**
 * Returns `{ data, loading, error, reload }`. `data` is never null — an unloaded screen shows empty
 * lists and its own "loading", not a blank.
 */
export function useAdminData() {
  const { user, store } = useSession();
  const api = store.api;
  const perms = user.perms;
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(async () => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    setError(null);
    const now = store.getState().user?.perms ?? perms;
    const may = {
      users: hasPerm(now, "users.manage"),
      groups: hasPerm(now, "users.manage") || hasPerm(now, "groups.manage"),
      catalogue: hasPerm(now, "groups.manage"),
    };
    const calls = [
      may.users ? store.track(() => api.adminUsers()) : null,
      may.groups ? store.track(() => api.adminGroups()) : null,
      may.catalogue ? store.track(() => api.adminPermissions()) : null,
      may.users ? store.track(() => api.unassignedScopes()) : null,
    ];
    const answers = await Promise.allSettled(calls.map((c) => c ?? Promise.resolve(null)));
    if (!mounted.current || seq.current !== mine) return;
    const value = (at) => (answers[at].status === "fulfilled" ? answers[at].value : null);
    const refused = answers.find((a) => a.status === "rejected");
    setData({
      users: (value(0) ?? []).map(userFromApi),
      groups: (value(1) ?? []).map(groupFromApi),
      catalogue: value(2) ?? [],
      unassigned: Number.isFinite(value(3)?.unassigned_users) ? value(3).unassigned_users : null,
    });
    setError(refused ? refused.reason : null);
    setLoading(false);
  }, [api, store, perms]);


  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}
