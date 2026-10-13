// src/live/screens/admin/RolesTab.jsx — the group × permission table (G1-13).
//
// COLLECT AND SAVE, NOT APPLY ON THE CLICK. The prototype's matrix writes each checkbox to
// `localStorage` the moment it is pressed (`admin.js:874-882`), which in a live system would mean
// one mis-click grants a right and the audit trail records it as a decision somebody made. Here a
// checkbox collects a pending change, the group's column says how many are pending, and Save sends
// ONE `PATCH /admin/groups/{id}` with the WHOLE permission list.
//
// THE API OFFERS NO TRANSACTION ACROSS GROUPS, AND THIS SCREEN DOES NOT PRETEND OTHERWISE.
// `PATCH /admin/groups/{id}` is atomic for ONE group — the service takes the tenant's lock and the
// group's row lock, checks the caller's rights against the group's new rights, and answers 409
// `concurrentChange` when the list the body says it read (`expected_permissions`, Task 14e — the
// server keeps no row version) is not the one it holds. There is no endpoint that changes two
// groups at once. So the unit of saving here is the GROUP, not the table: each column has its own
// Save, each save is one request, and a column that fails leaves the others as they were and says
// which one failed. A single "Save everything" button would be a promise of atomicity the server
// cannot keep — three PATCHes of which the second is refused would leave the hospital's permission
// table in a state no administrator chose, with one toast to explain it.
//
// EVERY SAVE SAYS WHAT IT BELIEVED THE LIST WAS (`expected_permissions`). The PATCH body is the
// whole list, computed from what this screen last read, and `update_group` REPLACES the set — so a
// Save from an out-of-date column would silently undo what another administrator saved since. The
// body therefore carries the column's last-read list, sorted, and the server compares it with what
// it holds under the row lock and answers 409 `concurrentChange` when they differ (the plan's
// Task 14e; a server without it ignores the field). The column's "last read" is the GroupOut the
// last successful PATCH RETURNED until a newer read lands: a re-read that fails after a save must
// not put the pre-save list back on screen, or the next Save would revoke what was just "saved".
//
// A 409 RE-READS THE COLUMN AND KEEPS THE TICKS. The screen does the refresh itself, keeps the
// administrator's ticks (they are what she decided), and says in a Note that the column was re-read
// so she reviews them against the new state before saving again — and, when the re-read itself
// failed, says THAT instead, never that the column was re-read.
//
// A WRITE WITH NO ANSWER IS NOT A REFUSAL (`refusal.mayHaveLanded`: a timeout, a dropped
// connection, a server that could not answer). The toast says it may have gone through, and the
// groups are READ AGAIN — a Save keeps its ticks and its column shows what the server holds, so a
// Save that landed has nothing left to save; a delete's dialog closes; a new group's form stays.
//
// A COLUMN IN FLIGHT IS NOT EDITABLE. While a column's PATCH is out its cells are `aria-disabled`,
// pointing at the words that name the group being saved: a tick made then could not be in the body
// already sent, and on success only what was sent is cleared. And a Save is offered only when the
// column has something to save.
//
// WHAT IS READ-ONLY, AND WHY IT SAYS SO IN THE SERVER'S OWN WORDS.
//   * The SYSTEM group: the server refuses it (409 `Sistem grubunun izinleri ve MFA kuralı
//     değiştirilemez`) and reports its permissions as the whole catalogue whatever is stored.
//   * A group whose rights exceed the session's (`canGrant`): the server's rule is "no grant beyond
//     your own rights" (403), and the column says so rather than offering checkboxes that 403.
//   * A group holding a key this catalogue does not describe: a Save computed from the catalogue
//     would drop that key — revoke a right the screen never showed, silently — so the column is
//     read-only and names the keys. It cannot happen while `/admin/permissions` serves the whole
//     catalogue, and nothing enforces that it always will.
//   * In an editable column, an UNTICKED cell for a right the session does not hold: the server
//     checks the new list against the caller's rights (`_within(actor, new)`), so the tick is a
//     certain 403 (Decision 11: shown, not offered, with its reason). The new-group form likewise.
//   * Deleting a group whose KNOWN member count is above zero (`errors.groupHasMembers`). A count
//     that is not known leaves the delete offered, and the server decides.
//   A locked cell is `aria-disabled`, not `disabled`: a keyboard user can still land on it and hear
//   the reason, which a natively disabled control would skip.
//
// THE DESCRIPTIONS ARE TRANSLATED BY KEY (`strings/perms.js`), with the server's own English as
// the `lang="en"` fallback for a key this build does not know. The server's descriptions are
// developer prose, not the hospital's words, and this is the screen on which an administrator
// decides what a nurse may do: a mis-read permission is a misconfiguration. The KEY is printed under
// the description untranslated — it is what a support call quotes and what the table is searched by.
//
// A CELL READS AS "<group> · <permission>" to a screen reader, and "· change pending" while it
// holds a tick the server has not taken: the only visible marker is a tint on the cell, and a tint
// is not something a reader is told.
//
// A SAVE `canGrant` ALLOWED CAN STILL BE REFUSED, AND READS LIKE ANY OTHER REFUSAL. The server checks
// every current MEMBER's rights, before and after the change (`admin/service._members_within`):
// a desk whose rights cover the group's may still not change it if one of its members holds more
// than the desk does. The screen has the group's rights, not its members', so it cannot foresee
// that — it offers the Save, and the 403 is the answer: on the toast, named after the group, with
// the ticks kept, because they are still what the administrator decided.
//
// WHAT THE FRAME READ IS READ BY ITS STATE (`useAdminData`). A missing catalogue is "unasked" for a
// desk whose rights do not allow the read and "failed" for one whose read was refused — two
// sentences, decided by the read's own state, never guessed from the rights. A group list that
// failed is said as that. A member COUNT is shown only when the groups read answered THIS time: a
// stale read still draws its columns, but "4 people" from it is a claim about now nobody has made.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Announce, Button, Empty, Field, Input, Modal, Note, Pill, Table, Tag, useToast } from "../../ui/index.js";
import { apiErrorKey, fieldRefusals } from "../../apiErrors.js";
import { hasPerm } from "./catalogue.js";
import { FIELD_MAX } from "./limits.js";
import { canGrant, groupFromApi } from "./rules.js";
import { doneFor, mayHaveLanded, refusedFor } from "./refusal.js";

/** The key of a pending change. */
const cellKey = (groupId, permission) => `${groupId}|${permission}`;

/** Is this permission on for this group, taking any pending change into account? */
export function isOn(group, permission, pending) {
  const key = cellKey(group.id, permission);
  if (key in pending) return pending[key];
  return group.permissions.includes(permission);
}

/** The keys a group holds that `catalogue` does not describe. A Save built from the catalogue would
 *  drop them — revoke them silently — so a group with any is not saved from this screen. */
export function undescribedKeys(group, catalogue) {
  const described = new Set(catalogue.map((row) => row.key));
  return group.permissions.filter((key) => !described.has(key));
}

/** The permission list a Save would send for this group: its own, with the pending changes applied,
 *  in the catalogue's order — so the body is reproducible and a diff of two saves is readable.
 *  Only for a group every one of whose keys the catalogue describes (`undescribedKeys` empty). */
export function listToSend(group, catalogue, pending) {
  return catalogue.map((row) => row.key).filter((key) => isOn(group, key, pending));
}

/** How many of this group's cells are pending AND actually differ from what the server holds. A
 *  checkbox clicked twice is not a change, and a column that said "1 pending" for it would be
 *  asking an administrator to save nothing. */
export function pendingFor(group, pending) {
  return Object.entries(pending).filter(([key, on]) => {
    const [groupId, permission] = key.split("|");
    return groupId === group.id && on !== group.permissions.includes(permission);
  }).length;
}

/** Why a group's column cannot be edited — `{key, vars}` for `t()` — or null. The system group
 *  first: it is the stronger statement and the server's refusal for it is the more specific one. */
export function lockedBecause(group, perms, catalogue) {
  if (group.isSystem) return { key: "errors.systemGroupLocked", vars: {} };
  if (!canGrant(perms, group, catalogue)) return { key: "roles.cannotGrant", vars: {} };
  const missing = undescribedKeys(group, catalogue);
  if (missing.length > 0) return { key: "roles.undescribed", vars: { keys: missing.join(", ") } };
  return null;
}

/** A permission's description in the reader's language, or the server's own English when this
 *  build has no text for the key. Returns `{text, foreign}`; a caller that prints it marks a
 *  foreign one `lang="en"`. */
export function descriptionOf(t, row) {
  const key = `perms.${row.key}`;
  const own = t(key);
  return own === key ? { text: row.description, foreign: true } : { text: own, foreign: false };
}

/** The id of the one sentence an unticked cell for a right the session does not hold points at. */
const PERM_LOCK_ID = "roles-perm-lock";
/** `refocus` for the tab's own heading rather than a column's. */
const TAB = Symbol("the roles tab's heading");

export function RolesTab({ admin }) {
  const { t } = useI18n();
  const { user: me, store } = useSession();
  const toast = useToast();
  const api = store.api;
  /** The groups read's last answer, or null. A NEW answer is a new array (`useAdminData` adapts
   *  each answer afresh) and a failed re-read keeps the old one, so "has a newer read landed" is
   *  "is this a different array". */
  const read = admin.data.groups;
  const catalogue = admin.data.catalogue ?? [];
  const countsKnown = admin.reads.groups === "known";

  /** `{"<groupId>|<permission>": boolean}` — what a Save would change, and nothing else. */
  const [pending, setPending] = useState({});
  /** The groups whose PATCH or DELETE is in flight. A Set, not one id: every column has its own
   *  Save, each PATCH is atomic for its group, and the server serialises them on the tenant lock
   *  — so a second column's Save during the first's flight is a real request, not a press that
   *  silently does nothing. */
  //  Each id maps to what is in flight: "save" (a PATCH or a DELETE), or "reread" — the re-read after
  //  a 409, through which the column stays busy: a Save pressed then would carry the same stale
  //  `expected_permissions` and earn a second 409.
  const [inFlight, setInFlight] = useState(() => new Map());
  /** The groups whose Save met a 409, each with the read that was on screen when it did: the
   *  column was re-read once `read` is a different answer, and the re-read failed while it is not. */
  const [reread, setReread] = useState(() => new Map());
  /** groupId → `{group, basis}`: the GroupOut a successful PATCH RETURNED, shown in place of the
   *  read's copy while `basis` — the read on screen when the PATCH answered — is still the read.
   *  A newer read replaces it; a failed re-read does not put the pre-save list back. */
  const [saved, setSaved] = useState(() => new Map());
  const [newGroup, setNewGroup] = useState(false);
  const [removing, setRemoving] = useState(null);
  /** A column whose buttons a write or a discard just removed: its heading takes the focus, if the
   *  focus fell to <body> with them (the house pattern, `AdminScreen`'s Retry). `TAB` is the tab's
   *  own heading, for a deleted group whose whole column went. */
  const [refocus, setRefocus] = useState(null);
  const heads = useRef({});
  const heading = useRef(null);

  /** The read on screen, for a write that answers later. Kept from the last COMMITTED render. */
  const lastRead = useRef(read);
  useEffect(() => { lastRead.current = read; }, [read]);
  // A newer read makes every saved copy taken against an older one obsolete.
  useEffect(() => {
    setSaved((was) => {
      const kept = [...was].filter(([, entry]) => entry.basis === read);
      return kept.length === was.size ? was : new Map(kept);
    });
  }, [read]);
  useEffect(() => {
    if (refocus === null) return;
    setRefocus(null);
    const active = document.activeElement;
    if (!active || active === document.body) (refocus === TAB ? heading.current : heads.current[refocus])?.focus();
  }, [refocus]);

  /** The columns as this screen believes the server holds them. */
  const groups = useMemo(() => (read ?? []).map((g) => {
    const mine = saved.get(g.id);
    return mine && mine.basis === read ? mine.group : g;
  }), [read, saved]);

  const locks = useMemo(
    () => new Map(groups.map((g) => [g.id, lockedBecause(g, me.perms, catalogue)])),
    [groups, me.perms, catalogue],
  );
  const lockId = (group) => `roles-lock-${group.id}`;
  const busyId = (group) => `roles-busy-${group.id}`;
  const membersId = (group) => `roles-members-${group.id}`;
  /** An unticked cell for a right this session does not hold: ticking it is a certain 403. */
  const cannotGive = (group, key) => !group.permissions.includes(key) && !hasPerm(me.perms, key);

  const toggle = (group, permission, on) => setPending((was) => ({ ...was, [cellKey(group.id, permission)]: on }));

  const forgetReread = (group) => setReread((was) => {
    if (!was.has(group.id)) return was;
    const next = new Map(was);
    next.delete(group.id);
    return next;
  });

  const dropPending = (group) => {
    setPending((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key.split("|")[0] !== group.id)));
    forgetReread(group);
    setRefocus(group.id);
  };

  /** `kind` is "save", "reread", or null when nothing is in flight for the group any more. */
  const flying = (group, kind) => setInFlight((was) => {
    const next = new Map(was);
    if (kind) next.set(group.id, kind);
    else next.delete(group.id);
    return next;
  });

  async function save(group) {
    if (inFlight.has(group.id)) return;
    // What this Save sends: the ticks as they stand now. The column's cells are locked until it
    // answers, and on success exactly these are cleared — nothing ticked later can be lost.
    const sent = Object.fromEntries(Object.entries(pending).filter(([key]) => key.split("|")[0] === group.id));
    const permissions = listToSend(group, catalogue, pending);
    let reload = false;
    // After a 409, or a Save that got no answer, the column is busy until its re-read answers.
    let reread = false;
    flying(group, "save");
    try {
      const answer = await store.track(() => api.adminUpdateGroup(group.id, {
        permissions,
        // What this screen believed the list WAS (the plan's decision X1). `update_group` replaces
        // the set, so without it a Save on a stale column silently undoes another administrator's
        // change; with it the server answers 409 `concurrentChange` instead.
        expected_permissions: [...group.permissions].sort(),
      }));
      // The column now shows what the server says it took — or, for an answer that is not this
      // group's, the list it was sent — until a newer read lands.
      const took = groupFromApi(answer);
      setSaved((was) => new Map(was).set(group.id, {
        group: took.id === group.id ? took : { ...group, permissions },
        basis: lastRead.current,
      }));
      setPending((was) => Object.fromEntries(
        Object.entries(was).filter(([key, on]) => !(key in sent && sent[key] === on)),
      ));
      forgetReread(group);
      setRefocus(group.id);
      toast(doneFor(t, group.name, t("roles.saved")));
      reload = true;
    } catch (err) {
      // The pending changes STAY: they are what the administrator decided, the server did not take
      // them, and throwing them away would make her reconstruct the decision from memory. That
      // holds for a refusal no hint here could foresee too — a MEMBER of the group holding more
      // than this desk (`_members_within`).
      toast(refusedFor(t, group.name, err), "error");
      if (apiErrorKey(err)?.key === "errors.concurrentChange") {
        // Somebody else saved this group meanwhile. Re-read, so the next Save is computed against
        // what the server holds now rather than silently overwriting their change; keep the ticks;
        // say so. The Note is not an Alert: the refusal was announced once already, on the toast.
        setReread((was) => new Map(was).set(group.id, lastRead.current));
        reload = true;
        reread = true;
      } else if (mayHaveLanded(err)) {
        // No answer — a timeout, a dropped connection, a server that could not answer — so the
        // PATCH may have landed, and the toast says it may have gone through. The column is READ
        // AGAIN, as the users tab does: if it landed, the re-read column holds the ticks and has
        // nothing left to save; if it did not, the ticks stay pending, to be saved against what
        // the server holds. Never the 409's Note: nobody else changed the group.
        reload = true;
        reread = true;
      }
    } finally {
      // Until the re-read answers the column stays busy: the only list it could send as
      // `expected_permissions` is the one the server refused, or may no longer hold.
      flying(group, reread ? "reread" : null);
    }
    // A READ, after the write's own try: its failure is the frame's to show, never this write's.
    if (reload) await admin.reload();
    if (reread) flying(group, null);
  }

  async function remove(group) {
    if (inFlight.has(group.id)) return;
    // Whether the groups are read again: after a delete that landed, or one that may have.
    let reread = false;
    flying(group, "save");
    try {
      await store.track(() => api.adminDeleteGroup(group.id));
      toast(doneFor(t, group.name, t("roles.removed")));
      setRemoving(null);
      reread = true;
    } catch (err) {
      toast(refusedFor(t, group.name, err), "error");
      // No answer: the group may be gone. The dialog closes rather than offer to delete a group
      // the engine may no longer hold, and the re-read below decides whether its column stays.
      if (mayHaveLanded(err)) {
        setRemoving(null);
        reread = true;
      }
    } finally {
      flying(group, null);
    }
    if (!reread) return;
    // A READ, after the write's own try (as in `save`).
    await admin.reload();
    // The column went with the group — its trash button too, which is where the dialog handed the
    // focus back. The tab's heading takes it rather than <body> (and only then: a column still
    // there got its trash button's focus back from the dialog).
    setRefocus(TAB);
  }

  // What the one live region says: whose column is being saved, and whose is being re-read.
  const namesIn = (kind) => groups.filter((g) => inFlight.get(g.id) === kind).map((g) => g.name).join(", ");
  const savingNames = namesIn("save");
  const rereadingNames = namesIn("reread");
  const inFlightSaid = [
    savingNames ? t("admin.savingFor", { subject: savingNames }) : "",
    rereadingNames ? t("roles.rereading", { group: rereadingNames }) : "",
  ].filter(Boolean).join(" ");

  // Without the catalogue there is no table to draw: its rows ARE the catalogue. Which sentence
  // depends on WHY it is missing, and the read's own state says why: "unasked" — a desk without
  // `groups.manage` is never asked for it (the frame asks only what the rights allow) — or
  // anything else, which for a desk with the right means the read failed, where the frame's own
  // Alert already carries the server's reason.
  if (catalogue.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="m-0 font-display text-17 font-bold">{t("roles.title")}</h2>
        <Empty icon="shield">{t(admin.reads.catalogue === "unasked" ? "roles.noCatalogue" : "roles.catalogueUnread")}</Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <h2 ref={heading} tabIndex={-1} className="m-0 font-display text-17 font-bold outline-none">{t("roles.title")}</h2>
          <p className="m-0 text-13 text-mute">{t("roles.sub")}</p>
        </div>
        <Button icon="plus" variant="primary" onClick={() => setNewGroup(true)}>{t("roles.newGroup")}</Button>
      </div>

      {/* After a 409: "re-read" only once a newer read has actually landed; "could not be re-read"
          once the re-read has failed; nothing while it is in flight. And only while the group
          still has ticks to review — the sentence is about them. */}
      {groups.filter((g) => reread.has(g.id) && pendingFor(g, pending) > 0).map((g) => {
        if (read !== reread.get(g.id)) {
          return <Note key={g.id} tone="warn" icon="swap">{t("roles.reread", { group: g.name })}</Note>;
        }
        if (!admin.loading && admin.reads.groups !== "known") {
          return <Note key={g.id} tone="warn" icon="swap">{t("roles.rereadFailed", { group: g.name })}</Note>;
        }
        return null;
      })}

      {groups.length === 0 ? <Empty icon="users">{t("roles.noGroups")}</Empty> : (
        <Table caption={t("roles.caption")} className="[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:bg-card [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[1] [&_th:first-child]:bg-card2">
          <thead>
            <tr>
              <th scope="col">{t("roles.colPermission")}</th>
              {groups.map((group) => {
                const locked = locks.get(group.id);
                const count = pendingFor(group, pending);
                const busy = inFlight.has(group.id);
                // A delete the server will refuse, by a count it answered this time.
                const hasMembers = countsKnown && group.memberCount !== null && group.memberCount > 0;
                return (
                  <th key={group.id} scope="col">
                    <div className="normal-case tracking-normal">
                      <div ref={(el) => { heads.current[group.id] = el; }} tabIndex={-1}
                        className="text-12 font-bold text-ink outline-none">{group.name}</div>
                      {/* A member count only when the read that produced it answered, this time:
                          `memberCount` is null for a group the API described without one, a zero
                          would read as "nobody is in this group" — a different and possibly false
                          statement — and a stale read's count is a claim about now. */}
                      <div className="text-10.5 font-semibold text-mute">
                        {group.memberCount === null || !countsKnown
                          ? t("roles.membersUnknown")
                          : t("roles.members", { count: group.memberCount })}
                      </div>
                      <div className="mt-1">
                        {group.mfaRequired ? <Tag tone="warn">{t("roles.mfaOn")}</Tag> : <Pill>{t("roles.mfaOff")}</Pill>}
                      </div>
                      {locked ? (
                        <p id={lockId(group)} className="m-0 mt-1 max-w-[190px] whitespace-normal text-10.5 font-normal text-mute">
                          {t(locked.key, locked.vars)}
                        </p>
                      ) : (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {/* Save and Discard only when there is something to save: a Save on a
                              column with nothing pending sends the list back unchanged, at best. */}
                          {count > 0 ? (
                            <>
                              <Tag tone="warn">{t("roles.pending", { count })}</Tag>
                              <Button size="sm" variant="primary" busy={busy}
                                onClick={() => save(group)}>{t("roles.save")}</Button>
                              <Button size="sm" variant="ghost" icon="swap" busy={busy}
                                label={`${t("roles.discard")}: ${group.name}`} onClick={() => dropPending(group)} />
                            </>
                          ) : null}
                          <Button size="sm" variant="ghost" icon="trash" busy={busy}
                            label={`${t("roles.remove")}: ${group.name}`}
                            aria-disabled={hasMembers ? "true" : undefined}
                            aria-describedby={hasMembers ? membersId(group) : undefined}
                            // The reason as the tooltip too, in place of "Delete the group: …" — which
                            // is what the dimmed button cannot do.
                            {...(hasMembers ? { title: t("errors.groupHasMembers") } : {})}
                            onClick={hasMembers ? () => {} : () => setRemoving(group)} />
                          {/* What a cell of this column points at while its Save is in flight, or while
                              the re-read after a 409 is. */}
                          {busy ? (
                            <span id={busyId(group)} className="sr-only">
                              {inFlight.get(group.id) === "reread"
                                ? t("roles.rereading", { group: group.name })
                                : t("admin.savingFor", { subject: group.name })}
                            </span>
                          ) : null}
                          {/* Why the trash is dimmed, where a sighted reader sees it — not only to a
                              screen reader. */}
                          {hasMembers ? (
                            <p id={membersId(group)} className="m-0 basis-full max-w-[190px] whitespace-normal text-10.5 font-normal text-mute">
                              {t("errors.groupHasMembers")}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {catalogue.map((row) => {
              const { text, foreign } = descriptionOf(t, row);
              return (
                <tr key={row.key}>
                  {/* The description in the reader's language — or the server's English, marked as
                      such — and the permission's own key under it: the key is what a support call
                      quotes and what this table is searched by. */}
                  <th scope="row">
                    <div className="normal-case tracking-normal">
                      <div className="text-12.5 font-semibold text-ink" lang={foreign ? "en" : undefined}>{text}</div>
                      <div className="font-data text-10.5 font-normal text-mute">{row.key}</div>
                    </div>
                  </th>
                  {groups.map((group) => {
                    const locked = locks.get(group.id);
                    const on = locked ? group.permissions.includes(row.key) || group.isSystem : isOn(group, row.key, pending);
                    const changed = !locked && on !== group.permissions.includes(row.key);
                    const name = `${t("roles.cell", { group: group.name, permission: text })}${changed ? ` · ${t("roles.cellPending")}` : ""}`;
                    // Why this cell cannot be changed, as the id of the sentence that says so: the
                    // column's own reason, its Save in flight, or a right this desk does not hold.
                    const reason = locked ? lockId(group)
                      : inFlight.has(group.id) ? busyId(group)
                        : cannotGive(group, row.key) ? PERM_LOCK_ID
                          : null;
                    return (
                      <td key={group.id} className={changed ? "bg-card2" : ""}>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={name}
                          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                          // A locked cell is reachable, says it is locked, and points at its reason
                          // — never `disabled`, which would skip it in the Tab order and tell a
                          // keyboard user nothing. It is controlled with a no-op onChange, so a click
                          // leaves it as it was: React puts the prop back after the event. Not
                          // `preventDefault` on the click — a browser reverts a cancelled checkbox
                          // click AFTER React's restore, and jsdom reverts by toggling again, which
                          // would leave the cell flipped in the test and not in the field.
                          aria-disabled={reason ? "true" : undefined}
                          aria-describedby={reason || undefined}
                          onChange={reason ? () => {} : (event) => toggle(group, row.key, event.target.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* The one sentence every unticked cell for a right this desk does not hold points at — drawn
          only when such a cell exists. */}
      {groups.some((g) => !locks.get(g.id) && catalogue.some((row) => cannotGive(g, row.key))) ? (
        <p id={PERM_LOCK_ID} className="m-0 text-12 text-mute">{t("roles.cannotGrantPerm")}</p>
      ) : null}

      <Note tone="info" icon="shield">{t("roles.note")}</Note>

      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here, and
          they name the group(s) whose column is in flight. */}
      <Announce text={inFlightSaid} />

      {newGroup ? (
        <GroupForm
          catalogue={catalogue}
          perms={me.perms}
          submit={(body) => store.track(() => api.adminCreateGroup(body))}
          onSaved={async (name) => {
            toast(doneFor(t, name, t("roles.created")));
            setNewGroup(false);
            await admin.reload();
          }}
          onRefused={(err, name) => {
            toast(refusedFor(t, name, err), "error");
            // No answer: the group may exist now, so the columns are read again behind the form.
            // The form stays: a second press on a group that did land is refused as a taken slug,
            // on its field — which is the check the toast asks for.
            if (mayHaveLanded(err)) admin.reload();
          }}
          onClose={() => setNewGroup(false)}
        />
      ) : null}

      {removing ? (
        <Modal
          open
          title={t("roles.remove")}
          busy={inFlight.has(removing.id)}
          onClose={() => setRemoving(null)}
          actions={(
            <>
              <Button onClick={() => setRemoving(null)} busy={inFlight.has(removing.id)}>{t("roles.cancel")}</Button>
              <Button variant="danger" busy={inFlight.has(removing.id)} onClick={() => remove(removing)}>
                {t("roles.remove")}
              </Button>
            </>
          )}
        >
          <p className="m-0 text-14">{t("roles.confirmRemove", { group: removing.name })}</p>
        </Modal>
      ) : null}
    </div>
  );
}

/** The API fields the new-group form DRAWS a control for — what `fieldRefusals` puts under a
 *  control. A 422 about anything else (a permission entry, the body as a whole) is its `others`,
 *  and goes to the toast named after the group: never "a field was named, so show nothing". */
const GROUP_FIELDS = ["slug", "name", "description"];

/** The id of the form's one sentence for a right the session does not hold. */
const FORM_PERM_LOCK_ID = "roles-form-perm-lock";

/** A new group: slug, name, description, the MFA rule and its starting permissions. The slug cannot
 *  be changed afterwards (`GroupPatch` has no `slug`), which the hint says; a duplicate answers 409
 *  `slugTaken` and a malformed one 422 `badSlug`, and both land on the slug field. Every field
 *  carries the server's own limit (`limits.FIELD_MAX`). A right the session does not hold is shown
 *  and not offered, with its reason: `create_group` checks the list against the caller's rights. */
function GroupForm({ catalogue, perms, submit, onSaved, onRefused, onClose }) {
  const { t } = useI18n();
  const mayGive = (key) => hasPerm(perms, key);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mfa, setMfa] = useState(false);
  const [chosen, setChosen] = useState(() => new Set());
  const [refusals, setRefusals] = useState({});
  const [busy, setBusy] = useState(false);
  const fields = useRef({});
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function onSubmit(event) {
    event?.preventDefault?.();
    if (busy) return;
    const mine = {};
    if (!slug.trim()) mine.slug = t("errors.badSlug");
    if (!name.trim()) mine.name = t("errors.mustNotBeBlank");
    if (Object.keys(mine).length > 0) {
      setRefusals(mine);
      fields.current[Object.keys(mine)[0]]?.focus();
      return;
    }
    setRefusals({});
    setBusy(true);
    try {
      await submit({
        slug: slug.trim(), name: name.trim(), description: description.trim() || null,
        mfa_required: mfa, permissions: catalogue.map((row) => row.key).filter((key) => chosen.has(key)),
      });
      if (mounted.current) onSaved(name.trim());
    } catch (err) {
      if (!mounted.current) return;
      const { fields: named, others } = fieldRefusals(t, err, GROUP_FIELDS);
      // A 409 on the slug has no `fieldErrors` — it is a message, not a validator — so it is put
      // on the slug field by its KEY, which is where an administrator can act on it.
      const slugTaken = apiErrorKey(err)?.key === "errors.slugTaken";
      if (Object.keys(named).length > 0 || slugTaken) {
        const shown = slugTaken ? { slug: t("errors.slugTaken"), ...named } : named;
        // Out of busy before focused: the fields are read-only while busy, and the refusal under
        // the field must be in the DOM, and the field editable, when the focus reaches it.
        // `flushSync` lands both updates first.
        flushSync(() => {
          setBusy(false);
          setRefusals(shown);
        });
        fields.current[Object.keys(shown)[0]]?.focus();
        // What no field of this form shows still reaches the administrator, once.
        if (others.length > 0) onRefused(others.join(" "), name.trim());
      } else {
        onRefused(others.length > 0 ? others.join(" ") : err, name.trim());
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={t("roles.formNew")}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("roles.cancel")}</Button>
          <Button variant="primary" busy={busy} onClick={onSubmit}>{t("roles.create")}</Button>
        </>
      )}
    >
      <form noValidate onSubmit={onSubmit}>
        {/* A busy control's words name their subject (Decision 25): the group being created. */}
        <Announce text={busy ? t("admin.savingFor", { subject: name.trim() }) : ""} />
        {/* Read-only, never disabled, while the group is being created: Enter in a field sends the
            form, and a field that then becomes natively disabled drops the keyboard user's focus
            to <body> mid-write (as `UserForm`, `ScopeEditor` and `SourceTab` hold theirs). */}
        <Field layout="col" required label={t("roles.fieldSlug")} hint={t("roles.fieldSlugHint")} error={refusals.slug}>
          <Input ref={(el) => { fields.current.slug = el; }} value={slug} maxLength={FIELD_MAX.slug}
            readOnly={busy} autoFocus onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field layout="col" required label={t("roles.fieldName")} error={refusals.name}>
          <Input ref={(el) => { fields.current.name = el; }} value={name} maxLength={FIELD_MAX.group_name}
            readOnly={busy} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field layout="col" label={t("roles.fieldDescription")} error={refusals.description}>
          <Input ref={(el) => { fields.current.description = el; }} value={description}
            maxLength={FIELD_MAX.description} readOnly={busy} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="mb-2.5 flex items-center gap-2 font-text text-13.5">
          <input type="checkbox" checked={mfa} disabled={busy} onChange={(e) => setMfa(e.target.checked)} />
          {t("roles.fieldMfa")}
        </label>
        <fieldset className="border-0 p-0">
          <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("roles.colPermission")}</legend>
          {catalogue.some((row) => !mayGive(row.key)) ? (
            <p id={FORM_PERM_LOCK_ID} className="m-0 mb-1 text-12 text-mute">{t("roles.cannotGrantPerm")}</p>
          ) : null}
          {catalogue.map((row) => {
            const { text, foreign } = descriptionOf(t, row);
            const given = mayGive(row.key);
            return (
              <label key={row.key} className="flex items-start gap-2 py-0.5 font-text text-13">
                <input
                  type="checkbox"
                  className="mt-0.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  checked={chosen.has(row.key)}
                  disabled={busy}
                  aria-disabled={given ? undefined : "true"}
                  aria-describedby={given ? undefined : FORM_PERM_LOCK_ID}
                  onChange={given ? (e) => setChosen((was) => {
                    const next = new Set(was);
                    if (e.target.checked) next.add(row.key);
                    else next.delete(row.key);
                    return next;
                  }) : () => {}}
                />
                <span>
                  <span lang={foreign ? "en" : undefined}>{text}</span>
                  <span className="block font-data text-10.5 text-mute">{row.key}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </form>
    </Modal>
  );
}
