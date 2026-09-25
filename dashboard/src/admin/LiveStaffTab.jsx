// src/admin/LiveStaffTab.jsx — the "staff" tab of the admin page in LIVE mode: loads the
// administration data from the API once, then renders the panels the session's rights cover —
// the users with users.manage, the groups with users.manage or groups.manage (read-only without
// groups.manage) — the same split as liveStore.loadAdmin, which asks only for those.
//
// The rights read here are the session token's `perms`. They are not re-read when the tab opens:
// the store keeps the token's list and exposes no re-read of /auth/me, so an older token can
// under-report a key added since it was minted, until it refreshes. The panels' rules are hints;
// the server decides every write.
import React, { useEffect, useState } from "react";
import { LiveUserAdmin } from "./LiveUserAdmin.jsx";
import { GroupAdmin } from "./GroupAdmin.jsx";
import { hasPerm, hasAny } from "../permissions.js";
import { translateApiError, permLabel } from "../clinicalI18n.js";

export function LiveStaffTab({ T, S, lang = "tr", store, state }) {
  const R = S.rbac;
  const perms = Array.isArray(state.user?.perms) ? state.user.perms : [];
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => store.loadAdmin())
      .catch(() => {})                 // loadAdmin never rejects: a refusal lands in adminError
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [store]);

  const users = hasPerm(perms, "users.manage");
  const groups = hasAny(perms, ["users.manage", "groups.manage"]);
  return (
    <div className="space-y-4">
      {state.adminError && (
        <div role="alert" className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-600">
          {R.loadFailed}: {translateApiError(state.adminError, lang)}
        </div>
      )}
      {loading && <div role="status" className={`text-sm ${T.faint}`}>{R.loading}</div>}
      {!users && !groups && (
        <div className={`rounded-lg px-3 py-2 text-sm ${T.subtle} ${T.muted}`}>
          {R.err.permissionRequired.replace("{perms}", () => ["users.manage", "groups.manage"]
            .map((k) => permLabel(k, lang)).join(` ${R.listOr} `))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {users && <LiveUserAdmin T={T} S={S} lang={lang} store={store} state={state} />}
        {groups && <GroupAdmin T={T} S={S} lang={lang} store={store} state={state} />}
      </div>
    </div>
  );
}
