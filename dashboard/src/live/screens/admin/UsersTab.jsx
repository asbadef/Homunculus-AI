// src/live/screens/admin/UsersTab.jsx — the staff of this hospital, their groups and their unit
// scope (G1-12). The prototype's `admin.js` users tab, reduced to what the API can back.
//
// THE WHOLE LIST ARRIVES IN ONE ANSWER AND IS FILTERED HERE. `GET /admin/users` has no `limit`, no
// `offset`, no cursor and no `q` (`admin/router.list_users`): the answer is every account in the
// hospital. At a pilot's size that is the right trade — a dozen accounts, one request, a search
// and a sort with no round trip — and the user decided it deliberately (Needs the user, 10:
// option (a) for the pilot, `limit`/`offset` before a second hospital). What it must NOT become is
// a tab that silently depends on having the whole list, because then its search and its sort
// quietly start lying the day pagination arrives. So:
//
//   * the search and the role filter are applied to `admin.data.users` and the screen says HOW
//     MANY of how many it is showing, every time it is showing fewer;
//   * the list is capped for rendering at `PAGE` rows with a "show more", so an AD import of
//     several hundred accounts does not put six hundred rows and three thousand cells into one
//     commit — the slow screen is the first symptom, and it arrives long before the request does;
//   * and when the answer is at or over `MANY` accounts the tab says so once, in the reader's own
//     language, with the fact that it loaded them all. That line is the handover note to whoever
//     adds pagination: it is visible to the person who will ask for it.
//
// A REFUSED ACTION IS NOT DRAWN. `rules.canManageUser` decides, and where it refuses, the reason
// is in the row's own actions cell ONCE — the keys this desk lacks, or that the user's rights are
// unknown, or that this is your own account. N disabled buttons answer the same question N times,
// and a disabled button also drops a keyboard user's focus to <body> when it becomes disabled
// mid-write, which is why `Button` has `busy` and never `disabled`.
//
// THE UNITS COLUMN CANNOT BE FILLED FROM THE LIST. There is no bulk scope read: `GET /scope/{id}`
// is per user and `GET /scope/unassigned` answers a COUNT. So the cell does not claim anything it
// has not read — `admin.unitsNotRead`, not a dash and not a zero — and reading one user's scope
// (opening the editor) fills that row. Decision 6 in this wave's plan, with the fan-out of one
// request per account as the rejected alternative. What the cell says once it HAS read is
// `rules.scopeKind`'s, the rule the editor follows too: "scope unrestricted" only for a scope
// unrestricted by ROLE, "no unit assigned" for an account nobody has assigned — which at the pilot
// is `unrestricted: true` as well, and is a different statement about a different person.
//
// WHAT THE FRAME READ IS READ BY ITS STATE (`useAdminData`). Each read is its last answer or null,
// and a failed read is never `[]`: a users read that failed is said as that — not as "no user
// matches" — and the frame's Alert above names it; a list is drawn when it is known or stale; a
// COUNT (the unassigned users) only when its read is known, because a stale number is a claim
// about now that nobody has made.
import React, { useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Box, Button, Empty, Field, Input, Modal, Note, Pill, Select, StatusPill, Table, Tag, useToast } from "../../ui/index.js";
import { ddmmyyyy, hhmm } from "../../i18n/dates.js";
import { apiErrorKey, apiErrorText, readErrorText } from "../../apiErrors.js";
import { PASSWORD_MIN } from "../../auth/passwordRules.js";
import { norm } from "../beds/order.js";
import { FIELD_MAX, lengthOf } from "./limits.js";
import { canAssignScope, canManageUser, scopeFromApi, scopeKind } from "./rules.js";
import { doneFor, mayHaveLanded, refusedFor } from "./refusal.js";
import { UserForm, kindOf } from "./UserForm.jsx";
import { ScopeEditor } from "./ScopeEditor.jsx";

/** How many rows are rendered before "show more". Not a page of data — the whole list is already
 *  here — only a bound on one commit's DOM. */
export const PAGE = 50;
/** At or above this many accounts the tab says out loud that it loaded the whole hospital. */
export const MANY = 200;

/** The roles this account's groups give it — EVERY one: an account can hold two, and a cell that
 *  showed the first would hide the second — and everything else it holds, split as the form does.
 *  A membership link (`UserGroupOut`) carries no kind, so a group in the list is classified by the
 *  LISTED group's kind (`GroupOut.kind`, the API's answer, which the form and the role filter read
 *  too); the link's own mirror-made kind only for a group the list does not hold. */
export function membershipOf(user, groups = []) {
  const listed = new Map(groups.map((g) => [g.id, g]));
  const kind = (link) => kindOf(listed.get(link.id) ?? link);
  return {
    roles: user.groups.filter((g) => kind(g) === "role"),
    extras: user.groups.filter((g) => kind(g) === "extra"),
    others: user.groups.filter((g) => kind(g) === "other"),
  };
}

/** Does any group this user holds require two-step verification? The groups' own `mfa_required` is
 *  what the server reads when it decides `requires_mfa` for a token (spec §4), so a user in such a
 *  group with no authenticator is "required · not set up" and never "off": the two are a different
 *  statement about the same account, and only one of them is a thing to fix.
 *
 *  "unknown" when one of the user's groups is not in the list this screen was given: the rule
 *  may hold there and the screen cannot see it, so "off" would be a claim. The same row's actions
 *  already read "rights unknown" (`canManageUser`); the 2FA cell says the same thing for the
 *  same reason, rather than a confident "off" beside an honest "unknown". */
export function mfaState(user, groups) {
  if (user.mfa) return "on";
  const byId = new Map(groups.map((g) => [g.id, g]));
  if (user.groups.some((link) => !byId.has(link.id))) return "unknown";
  const required = user.groups.some((link) => byId.get(link.id)?.mfaRequired === true);
  return required ? "required" : "off";
}

/** One account's row against the search box: its name and its username, diacritics folded, so
 *  "aygun" finds "Ayşe Aygün" and "ayse" finds her too. `norm` is the bed board's — one copy. */
const matches = (user, query) => query === "" || norm(`${user.fullName} ${user.username}`).includes(query);

/** The sentence a row puts where its actions would be, or null when it has actions. */
function refusalKey(verdict, isSelf) {
  if (verdict.beyond === null) return { key: "admin.beyondUnknown", vars: {} };
  if (!verdict.within) return { key: "admin.beyond", vars: { keys: verdict.beyond.join(", ") } };
  if (isSelf) return { key: "admin.selfNote", vars: {} };
  return null;
}

export function UsersTab({ admin }) {
  const { t } = useI18n();
  const { user: me, store } = useSession();
  const toast = useToast();
  const api = store.api;
  const users = admin.data.users ?? [];
  const groups = admin.data.groups ?? [];
  const catalogue = admin.data.catalogue ?? [];
  const usersUnread = admin.data.users === null;
  const unassigned = admin.reads.unassigned === "known" && Number.isFinite(admin.data.unassigned)
    ? admin.data.unassigned
    : null;

  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [shown, setShown] = useState(PAGE);
  /** `{kind, user}` — which dialog is open and for whom. */
  const [open, setOpen] = useState(null);
  /** The scopes this session has actually read, by user id: nothing is claimed for a row that is
   *  not in here. */
  const [scopes, setScopes] = useState({});
  const [myScope, setMyScope] = useState(null);
  /** The account a request is in flight for — a confirmed write or a scope READ. While it is set,
   *  EVERY row's actions are busy, not only its own: the tab runs one request at a time, and a
   *  control that looked live and then did nothing (`write` declines while another is out) was a
   *  press the administrator was never told about. */
  const [busyId, setBusyId] = useState(null);
  /** Whether the request in flight is a scope READ (`openScope`), which the tab's own region names;
   *  a write is named by its dialog, the only region an open dialog leaves audible. */
  const [reading, setReading] = useState(false);

  // `kind` is the ADAPTED group's: the API's own answer when it sends one (`GroupOut.kind`), the
  // mirror's otherwise (`rules.groupFromApi`) — never the mirror directly, which would ignore
  // what the server said about a group it defines.
  const roleGroups = useMemo(() => groups.filter((g) => g.kind === "role"), [groups]);

  const picked = useMemo(() => {
    const q = norm(query);
    return users.filter((u) => matches(u, q) && (role === "" || u.groups.some((g) => g.id === role)));
  }, [users, query, role]);

  /** The session a request started in, as a test: "is it still this one?" (the source tab's
   *  `sessionNow`). An answer that arrives after that session ended — signed out, or another
   *  administrator's begun in this browser — is nobody's: nothing more is SENT on its behalf (the
   *  second half of an edit would go out under whatever token storage holds by then), nothing is
   *  re-read, and nothing is said into the screen that replaced it. `store.epoch()` moves when a
   *  session begins or ends; a screen lock does not move it — the shell holds a locked screen's
   *  toasts — so a write that lands behind a lock is still reported when it is unlocked. */
  const sessionNow = () => {
    const epoch = store.epoch();
    return () => store.epoch() === epoch;
  };

  /** Every write goes through this: the session's `track` (so a refused refresh ends the session
   *  here too), the toast named after the account, and a reload — the screen then shows what the
   *  server holds rather than what it hoped. A write with no answer may have landed
   *  (`mayHaveLanded`): the toast says so, and the list is reloaded then too. All of it only while
   *  the session that asked lasts. */
  const write = useCallback(async (user, run, doneText) => {
    if (busyId) return false;
    setBusyId(user.id);
    const ours = sessionNow();
    try {
      const answer = await store.track(run);
      // Its session is over: no reload, and no confirmation into another session's screen.
      if (!ours()) return false;
      // `doneText` may be a function of the server's ANSWER rather than a fixed sentence. The
      // unlock is the one that needs it: `POST /unlock-sign-in` answers 200 whether it let three
      // more binds through or found nothing to clear, and the two are a different thing to tell
      // an administrator. A fixed sentence claimed the first for both.
      toast(doneFor(t, user.fullName || user.username,
                    typeof doneText === "function" ? doneText(answer) : doneText));
      await admin.reload();
      return true;
    } catch (err) {
      if (!ours()) return false;
      toast(refusedFor(t, user.fullName || user.username, err), "error");
      if (mayHaveLanded(err)) await admin.reload();
      return false;
    } finally {
      setBusyId(null);
    }
  }, [admin, busyId, store, t, toast]);

  /** One user's scope, read when it is needed and remembered for the row — and, the first time, the
   *  desk's OWN scope, which is the only way to know whether it may assign one at all
   *  (`canAssignScope`). Two READS, one after the other, each failing on its own terms and each
   *  NAMED AFTER ITSELF: the desk's own scope failing is "your own scope could not be read" — the
   *  first version named the user for it, which blamed the wrong record — and the editor still
   *  opens, with no Save and the sentence that the right is unknown; the user's scope failing is a
   *  read about THAT user, and there is then nothing to edit. Neither is a refused write, so neither
   *  says a write's "it may have happened" (`readErrorText`). */
  const openScope = useCallback(async (user) => {
    if (busyId) return;
    setBusyId(user.id);
    setReading(true);
    // Two reads in sequence: the second is not asked for a session that ended during the first.
    const ours = sessionNow();
    try {
      let mine = myScope;
      if (!mine) {
        try {
          mine = scopeFromApi(await store.track(() => api.myScope()));
          if (!ours()) return;
          setMyScope(mine);
        } catch (err) {
          if (!ours()) return;
          toast(t("admin.readFailed", { read: t("admin.readMyScope"), reason: readErrorText(t, err) }), "error");
        }
      }
      let read;
      try {
        read = scopeFromApi(await store.track(() => api.userScope(user.id)));
      } catch (err) {
        if (ours()) {
          toast(t("admin.readFailed", {
            read: t("admin.readScopeOf", { name: user.fullName || user.username }), reason: readErrorText(t, err),
          }), "error");
        }
        return;
      }
      if (!ours()) return;
      setScopes((was) => ({ ...was, [user.id]: read }));
      // Only if nothing else was opened while the read ran (the "new user" form stays live): a late
      // answer that REPLACED that dialog unmounted a form with its write in flight, and the write's
      // refusal then had nowhere to land. The read is still remembered for the row.
      setOpen((was) => was ?? { kind: "scope", user, scope: read });
    } finally {
      setBusyId(null);
      setReading(false);
    }
  }, [api, busyId, myScope, store, t, toast]);

  /** Forget what this session read of one user's scope: the row's cell goes back to "not read".
   *  After an edit — a role is what makes a scope unrestricted, so the last read may no longer be
   *  the server's — and after a read-back that failed: "we did not look" is not "nothing is
   *  assigned", and neither is "we looked before she changed". */
  const forgetScope = useCallback((id) => {
    setScopes((was) => {
      if (!(id in was)) return was;
      const next = { ...was };
      delete next[id];
      return next;
    });
  }, []);

  /** The form's write. A NEW account is one call — and one that got no answer may have created the
   *  account (`mayHaveLanded`), so the list behind the form is read again. An EDIT is at most two,
   *  and each is sent only when it changes something (`UserForm`: the details that differ from
   *  what the form opened with; the memberships only when they differ, with the ones it opened
   *  with as `expected_group_ids`) — `PATCH /admin/users/{id}` and `PUT /admin/users/{id}/groups`. No
   *  endpoint takes both, so they go IN SEQUENCE, never at once: the groups are not sent when the
   *  details were refused, and when the details LANDED and the groups were refused, the account on
   *  the server has changed — so the list is reloaded, and the refusal says which half landed. A
   *  write that got no answer may have landed (`mayHaveLanded`): the list is reloaded then too,
   *  and the sentence says "may not have been saved", never "was not".
   *
   *  A 409 on the groups is another desk's change since this form read them (Task 14e's
   *  compare-and-swap): saving again from this form would be refused again, for ever — its
   *  `expected` is the list it read — so the list is read again, the form CLOSES, and the refusal
   *  says why and to reopen the account (`stale`). And nothing goes out for a session that ended
   *  while the details were in flight: the groups are not sent under whoever's token is stored by
   *  then (`sessionNow`).
   *
   *  The form is told which half landed, to keep its own baseline true: `detailsLanded` (the
   *  details are now the server's) and `detailsUnknown` (a details write with no answer). */
  const saveUser = async (body) => {
    const ours = sessionNow();
    if (open.kind !== "edit") {
      try {
        return await store.track(() => api.adminCreateUser(body));
      } catch (err) {
        // No answer: the account may exist now, so the list behind the form is read again.
        if (mayHaveLanded(err) && ours()) await admin.reload();
        throw err;
      }
    }
    const id = open.user.id;
    const { details, groupIds, expectedGroupIds } = body;
    const refresh = async () => {
      if (!ours()) return;
      forgetScope(id);
      await admin.reload();
    };
    let landed = false;
    if (Object.keys(details).length > 0) {
      try {
        await store.track(() => api.adminUpdateUser(id, details));
      } catch (err) {
        if (!mayHaveLanded(err)) throw err;
        await refresh();
        throw Object.assign(err, { detailsUnknown: true });
      }
      landed = true;
    }
    if (!groupIds || !ours()) return undefined;
    try {
      return await store.track(() => api.adminSetUserGroups(id, groupIds, expectedGroupIds));
    } catch (err) {
      const unknown = mayHaveLanded(err);
      const stale = apiErrorKey(err)?.key === "errors.concurrentChange";
      if (landed || unknown || stale) await refresh();
      if (stale) {
        const why = t("admin.changedElsewhere");
        throw Object.assign(new Error(landed ? t("admin.groupsNotSaved", { reason: why }) : why), { stale: true });
      }
      if (!landed) throw err;
      throw Object.assign(
        new Error(t(unknown ? "admin.groupsMaybeNotSaved" : "admin.groupsNotSaved", { reason: apiErrorText(t, err) })),
        { detailsLanded: true },
      );
    }
  };

  /** After a save, read the scope back rather than keeping the list we sent: the server's answer is
   *  the scope, and it normalises the keys it stores. A failed re-read leaves the row UNREAD
   *  (`undefined`), never an empty scope — "we did not look" is not "nothing is assigned".
   *  Resolves with the scope read, or null — the editor uses it after a save with no answer. */
  const rereadScope = useCallback(async (user) => {
    try {
      const theirs = scopeFromApi(await store.track(() => api.userScope(user.id)));
      setScopes((was) => ({ ...was, [user.id]: theirs }));
      return theirs;
    } catch {
      forgetScope(user.id);
      return null;
    }
  }, [api, forgetScope, store]);

  /** The units cell, by `rules.scopeKind` — the rule the editor follows too, so the two cannot
   *  disagree. "Scope unrestricted" ONLY for a scope unrestricted by role: an account unrestricted
   *  because nobody has assigned it anything — the pilot's normal state — has "no unit assigned",
   *  which is the different and true statement Decision 6 keeps apart; and a scope the engine
   *  could not place gets no invented summary. */
  const unitsCell = (user) => {
    const scope = scopes[user.id];
    const kind = scopeKind(scope);
    if (kind === "unread") return <span className="text-mute">{t("admin.unitsNotRead")}</span>;
    if (kind === "role") return t("admin.allUnits");
    if (kind === "unknown") return <span className="text-mute">{t("admin.unitsUnknown")}</span>;
    if (kind === "unassigned") return t("admin.noUnits");
    const units = scope.grants.filter((g) => g.unitId).length;
    const beds = scope.grants.filter((g) => g.bedId).length;
    if (units === 0 && beds === 0) return t("admin.noUnits");
    return [units ? t("admin.unitCount", { count: units }) : null, beds ? t("admin.bedCount", { count: beds }) : null]
      .filter(Boolean).join(" · ");
  };

  const rows = picked.slice(0, shown);

  return (
    <div className="flex flex-col gap-3">
      {/* "Everyone sees everything because nobody has been assigned yet" and "…because that is the
          policy" are the same screen without this number — and it is shown only when the read that
          produced it answered: a count this tab cannot know is never a zero. */}
      {unassigned === null
        ? <p className="m-0 text-12.5 text-mute">{t("admin.scopeUnassignedUnknown")}</p>
        : <p className="m-0 text-12.5 text-mute">{t("admin.scopeUnassigned", { count: unassigned })}</p>}

      {users.length >= MANY ? <Note tone="info" icon="list">{t("admin.wholeList", { count: users.length })}</Note> : null}

      <div className="flex flex-wrap items-end gap-2">
        <Field layout="col" label={t("admin.search")} className="mb-0 min-w-[220px] flex-1">
          {/* Never sent anywhere: it filters `"<name> <username>"` here (`matches`), so its limit is
              the longest text a row can hold, from the server's own two limits. */}
          <Input type="search" value={query} maxLength={FIELD_MAX.full_name + 1 + FIELD_MAX.username}
            onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} />
        </Field>
        <Field layout="col" label={t("admin.filterRole")} className="mb-0">
          <Select value={role} onChange={(e) => { setRole(e.target.value); setShown(PAGE); }}>
            <option value="">{t("admin.filterAll")}</option>
            {roleGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Button icon="userPlus" variant="primary" onClick={() => setOpen({ kind: "new", user: null })}>
          {t("admin.newUser")}
        </Button>
      </div>

      {picked.length < users.length ? (
        <p className="m-0 text-12.5 text-mute">{t("admin.filtered", { shown: picked.length, total: users.length })}</p>
      ) : null}

      {usersUnread ? <Empty icon="users">{t("admin.usersUnread")}</Empty> : picked.length === 0 ? <Empty icon="users">{t("admin.none")}</Empty> : (
        <Table caption={t("admin.caption")}>
          <thead>
            <tr>
              <th scope="col">{t("admin.colName")}</th>
              <th scope="col">{t("admin.colUsername")}</th>
              <th scope="col">{t("admin.colRole")}</th>
              <th scope="col">{t("admin.colUnits")}</th>
              <th scope="col">{t("admin.colState")}</th>
              <th scope="col">{t("admin.colMfa")}</th>
              <th scope="col">{t("admin.colLastLogin")}</th>
              <th scope="col">{t("admin.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => {
              const verdict = canManageUser(me.perms, user, groups, me.id, catalogue);
              const isSelf = user.id === me.id;
              const refused = refusalKey(verdict, isSelf);
              const { roles: ownRoles, extras, others } = membershipOf(user, groups);
              const mfa = mfaState(user, groups);
              // Busy while ANY request is out, not only this row's: one at a time, said as that
              // (the region below names the account in flight), never a live-looking no-op.
              const busy = busyId !== null;
              return (
                <tr key={user.id}>
                  {/* The row's own header is the USERNAME, not the display name: it is the
                      identifier the server knows, it is unique, and a screen reader repeats it
                      with every cell of the row. */}
                  <td>
                    <b>{user.fullName}</b>
                    <div className="font-data text-11.5 text-mute">{user.username}</div>
                  </td>
                  <th scope="row" className="font-data font-semibold">
                    {user.username}
                    <div className="text-11.5 font-normal text-mute">
                      {t(user.authSource === "ldap" ? "admin.sourceLdap" : "admin.sourceLocal")}
                    </div>
                  </th>
                  <td>
                    {ownRoles.length > 0
                      ? ownRoles.map((g) => g.name).join(", ")
                      : <span className="text-mute">{t("admin.noRole")}</span>}
                    {extras.length > 0 ? (
                      <div className="text-11.5 text-mute">{t("admin.extras", { list: extras.map((g) => g.name).join(", ") })}</div>
                    ) : null}
                    {others.length > 0 ? (
                      <div className="text-11.5 text-mute">{t("admin.otherGroups", { list: others.map((g) => g.name).join(", ") })}</div>
                    ) : null}
                  </td>
                  <td>{unitsCell(user)}</td>
                  <td>
                    {user.active
                      ? <StatusPill tone="ok">{t("admin.active")}</StatusPill>
                      : <Tag>{t("admin.inactive")}</Tag>}
                    {user.mustChangePassword ? <div className="mt-1"><Tag tone="warn">{t("admin.mustChange")}</Tag></div> : null}
                  </td>
                  <td>
                    {mfa === "on" ? <Pill icon="ok">{t("admin.mfaOn")}</Pill> : null}
                    {mfa === "required" ? <Tag tone="warn">{t("admin.mfaRequired")}</Tag> : null}
                    {mfa === "unknown" ? <Tag>{t("admin.mfaUnknown")}</Tag> : null}
                    {mfa === "off" ? <span className="text-mute">{t("admin.mfaOff")}</span> : null}
                  </td>
                  <td className="font-data text-mute">
                    {user.lastLoginAt
                      ? `${ddmmyyyy(Date.parse(user.lastLoginAt))} ${hhmm(Date.parse(user.lastLoginAt))}`
                      : t("admin.never")}
                  </td>
                  <td>
                    {refused ? <span className="text-12 text-mute">{t(refused.key, refused.vars)}</span> : null}
                    <div className="flex flex-wrap gap-1">
                      {verdict.edit ? (
                        <Button size="sm" variant="ghost" icon="edit" busy={busy}
                          label={`${t("admin.edit")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "edit", user })} />
                      ) : null}
                      {verdict.within ? (
                        <Button size="sm" variant="ghost" icon="bed" busy={busy}
                          label={`${t("admin.scope")}: ${user.username}`}
                          onClick={() => openScope(user)} />
                      ) : null}
                      {verdict.resetPassword ? (
                        <Button size="sm" variant="ghost" icon="key" busy={busy}
                          label={`${t("admin.resetPassword")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "password", user })} />
                      ) : null}
                      {verdict.resetMfa ? (
                        <Button size="sm" variant="ghost" icon="shield" busy={busy}
                          label={`${t("admin.resetMfa")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "mfa", user })} />
                      ) : null}
                      {verdict.unlockSignIn ? (
                        <Button size="sm" variant="ghost" icon="lock" busy={busy}
                          label={`${t("admin.unlockSignIn")}: ${user.username}`}
                          onClick={() => setOpen({ kind: "unlock", user })} />
                      ) : null}
                      {verdict.deactivate ? (
                        <Button size="sm" variant="ghost" icon={user.active ? "x" : "ok"} busy={busy}
                          label={`${t(user.active ? "admin.deactivate" : "admin.activate")}: ${user.username}`}
                          onClick={() => setOpen({ kind: user.active ? "deactivate" : "activate", user })} />
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {picked.length > rows.length ? (
        <Button icon="plus" onClick={() => setShown((n) => n + PAGE)}>
          {t("admin.showMore", { count: picked.length - rows.length })}
        </Button>
      ) : null}

      {/* A busy row's Button reads only "unavailable" to a screen reader: the words come from here,
          and they name the account, so an administrator moving down a list of twelve knows which
          row is in flight. Only for a scope READ, and said as a read — "saving" while nothing is
          written is a claim. A WRITE is named by its own dialog: an open dialog makes everything
          outside it inert, this region included, and an inert live region says nothing. */}
      <Announce text={busyId && reading ? t("admin.readingScopeFor", { subject: users.find((u) => u.id === busyId)?.username ?? "" }) : ""} />

      {open?.kind === "new" || open?.kind === "edit" ? (
        <UserForm
          user={open.kind === "edit" ? open.user : null}
          self={open.kind === "edit" && open.user.id === me.id}
          groups={groups}
          catalogue={catalogue}
          perms={me.perms}
          submit={saveUser}
          // `subject` is the account's name as the form saved it: a confirmation names what it is
          // about, as a refusal does. After an edit, the row's scope read is no longer claimed — a
          // role is what makes a scope unrestricted, and the role may just have changed.
          onSaved={async (subject) => {
            toast(doneFor(t, subject, t(open.kind === "edit" ? "admin.saved" : "admin.created")));
            if (open.kind === "edit") forgetScope(open.user.id);
            setOpen(null);
            await admin.reload();
          }}
          // `reason` is the failure, or a 422's `others` already in words; `subject` is the name typed
          // into the form, which is the only name a NEW account has.
          onRefused={(reason, subject) => toast(refusedFor(t,
            open.user ? open.user.fullName || open.user.username : subject, reason), "error")}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open?.kind === "scope" ? (
        <ScopeEditor
          user={open.user}
          scope={open.scope}
          mayAssign={canAssignScope(myScope)}
          save={(grants) => store.track(() => api.setScope(open.user.id, grants))}
          reread={() => rereadScope(open.user)}
          onSaved={async () => {
            toast(doneFor(t, open.user.fullName || open.user.username, t("admin.scopeSaved")));
            setOpen(null);
            await rereadScope(open.user);
          }}
          onRefused={(err) => toast(refusedFor(t, open.user.fullName || open.user.username, err), "error")}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {CONFIRMATIONS[open?.kind] ? (
        <Confirm
          user={open.user}
          kind={open.kind}
          busy={busyId === open.user.id}
          onConfirm={async (reason) => {
            const spec = CONFIRMATIONS[open.kind];
            // `done` is a key, or a function of the server's answer — `{key, vars}` — when the
            // server can answer more than one thing (the unlock).
            const said = typeof spec.done === "function"
              ? (answer) => { const { key, vars } = spec.done(answer); return t(key, vars); }
              : t(spec.done);
            const done = await write(open.user, spec.run(api, open.user, reason), said);
            if (done) setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** The three destructive writes and the unlock: what each one asks, what it sends and what it says
 *  afterwards. Each confirmation NAMES the account and the consequence — resetting a password or an
 *  authenticator ENDS that user's open sessions, and so does deactivating. */
const CONFIRMATIONS = {
  password: {
    title: "admin.resetPassword", body: "admin.confirmResetPassword", done: "admin.passwordReset",
    password: true,
    run: (api, user, password) => () => api.adminResetPassword(user.id, password),
  },
  mfa: {
    title: "admin.resetMfa", body: "admin.confirmResetMfa", done: "admin.mfaReset",
    run: (api, user) => () => api.adminResetMfa(user.id),
  },
  deactivate: {
    title: "admin.deactivate", body: "admin.confirmDeactivate", done: "admin.deactivated",
    run: (api, user) => () => api.adminUpdateUser(user.id, { is_active: false }),
  },
  activate: {
    title: "admin.activate", body: "admin.confirmActivate", done: "admin.activated",
    run: (api, user) => () => api.adminUpdateUser(user.id, { is_active: true }),
  },
  unlock: {
    title: "admin.unlockSignIn", body: "admin.confirmUnlock",
    // The only confirmation whose sentence depends on the ANSWER. `POST /unlock-sign-in` answers
    // 200 both when it lets three more binds through and when it finds nothing to clear — an
    // account with no failed bind in the current chain, or a local account — and `granted` is
    // what tells them apart. A fixed "the throttle was lifted" claimed the first for both, which
    // is the one place in this surface a screen said more than the server had told it. And the
    // NUMBER of attempts let through is the server's too — `allowed_after - allowed_before` —
    // never a "three" the screen knows from reading the chain's source: a figure the screen cannot
    // verify in the sentence that exists to stop over-claiming would be the same fault again.
    // Three sentences, each only what the server said: `granted: false` is "nothing to lift";
    // `granted: true` with the two numbers is the count; anything else — `granted: true` without
    // usable numbers, or a 200 that says nothing about `granted` — is only "accepted, the server
    // did not say how many" (`admin.unlockedUncounted`). "Nothing to lift" there would contradict
    // a server that said it granted. (The dialog before the write, `admin.confirmUnlock`, promises
    // no number either, for the same reason.)
    done: (answer) => {
      if (answer?.granted === false) return { key: "admin.unlockedNothing", vars: {} };
      const before = answer?.allowed_before;
      const after = answer?.allowed_after;
      if (answer?.granted === true && Number.isFinite(before) && Number.isFinite(after) && after > before) {
        return { key: "admin.unlocked", vars: { count: after - before } };
      }
      return { key: "admin.unlockedUncounted", vars: {} };
    },
    reason: true,
    run: (api, user, reason) => () => api.adminUnlockSignIn(user.id, reason),
  },
};

/** One confirmation. While the request is in flight the dialog CANNOT be dismissed (`Modal busy`):
 *  a refusal must land in an open form, or an administrator is told nothing about a write that did
 *  not happen. The unlock's reason is checked for the one thing the server will certainly refuse
 *  (nothing readable in it) before a request is sent, and the sentence says it is audited.
 *
 *  A field this dialog refuses itself TAKES THE FOCUS: the refusal is written under it, first in
 *  its aria-describedby, so arriving on the field is what says it — a screen-reader user left on
 *  the confirm button heard nothing, and pressed it again. */
function Confirm({ user, kind, busy, onConfirm, onClose }) {
  const { t } = useI18n();
  const spec = CONFIRMATIONS[kind];
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState(null);
  const field = useRef(null);
  const name = user.fullName || user.username;

  const refuse = (text) => {
    // Landed in the DOM before the focus moves, so the field the focus reaches already says it.
    flushSync(() => setProblem(text));
    field.current?.focus();
  };

  const confirm = () => {
    if (spec.reason && !/[\p{L}\p{N}]/u.test(reason)) {
      refuse(t("errors.reasonNeedsText"));
      return;
    }
    // In code points, as the server counts (`limits.lengthOf`): `.length` passed four emoji as eight
    // characters, and the server then refused them as four.
    if (spec.password && lengthOf(password) < PASSWORD_MIN) {
      refuse(t("errors.passwordTooShort"));
      return;
    }
    setProblem(null);
    onConfirm(spec.reason ? reason.trim() : password);
  };

  return (
    <Modal
      open
      title={t(spec.title)}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("admin.cancel")}</Button>
          <Button variant={kind === "activate" ? "primary" : "danger"} busy={busy} onClick={confirm}>
            {t(spec.title)}
          </Button>
        </>
      )}
    >
      <p className="m-0 mb-3 text-14">{t(spec.body, { name })}</p>
      {spec.password ? (
        <Field layout="col" required label={t("admin.fieldPassword")} hint={t("admin.fieldPasswordHint")} error={problem}>
          {/* Read-only, not disabled, while the write is out: disabling a field drops its focus. */}
          <Input ref={field} type="password" autoComplete="new-password" value={password} maxLength={FIELD_MAX.password}
            readOnly={busy} onChange={(e) => { setPassword(e.target.value); setProblem(null); }} />
        </Field>
      ) : null}
      {spec.reason ? (
        <Field layout="col" required label={t("admin.reasonLabel")} hint={t("admin.reasonHint")} error={problem}>
          <Input ref={field} value={reason} maxLength={FIELD_MAX.reason} readOnly={busy}
            onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
        </Field>
      ) : null}
      {/* Inside the dialog and naming the account: the tab's own region is inert while this is open. */}
      <Announce text={busy ? t("admin.savingFor", { subject: user.username }) : ""} />
    </Modal>
  );
}
