// src/admin/GroupAdmin.jsx — groups and their permission sets, backed by /admin/groups.
// Renders only what the API returned (state.adminGroups / state.adminPermissions); every change
// goes through the store, which reloads from the server afterwards.
//
// What is offered or greyed out follows liveAdmin.js's rules, and those are HINTS: the server
// re-checks every write (its members-aware rule included, which the client cannot see) and its
// refusal — 403, 409, 422 — is shown through translateApiError, with the form kept open.
//   - Without groups.manage the list is read-only (a users.manage desk lists groups to assign).
//   - The system group holds the whole catalogue by rule: its rights and MFA rule are read-only,
//     its name and description editable, and it is never offered for deletion.
//   - A group whose rights the session does not cover: rights and MFA read-only, no deletion,
//     with the reason. Its labels stay editable; the server decides those.
//   - A new or editable group is offered only the keys the session holds.
//   - A custom group's keys the catalogue no longer holds (retired) are not rights: they are
//     neither shown, nor judged, nor sent back (the server would refuse them as unknown).
import React, { useId, useState } from "react";
import { Plus, Pencil, Trash2, ShieldCheck, Lock } from "lucide-react";
import { Field, inputCls, btnCls, ActionOverlay } from "../ui.jsx";
import { hasPerm } from "../permissions.js";
import { groupRights, rightsBeyond } from "../liveAdmin.js";
import { translateApiError, permLabel, cannotGrantReason } from "../clinicalI18n.js";

const BLANK = Object.freeze({
  id: null, slug: "", name: "", description: "", mfaRequired: false, isSystem: false, permissions: [],
});

const catalogueKeys = (catalogue) => (Array.isArray(catalogue) ? catalogue : [])
  .map((p) => (typeof p === "string" ? p : p?.key)).filter((k) => typeof k === "string");

/** A group's rights as the server counts them, in catalogue order: `groupRights`, with a custom
 *  group's retired keys dropped. Without a catalogue (not loaded, or a users.manage desk), a
 *  custom group's keys are taken as they are. */
function rightsOf(group, keys) {
  const rights = groupRights(group, keys);
  if (keys.length === 0) return rights;
  const held = new Set(rights);
  const inCatalogue = keys.filter((k) => held.has(k));
  if (group.isSystem !== true) return inCatalogue;
  const known = new Set(keys);
  return [...inCatalogue, ...rights.filter((k) => !known.has(k))];
}

export function GroupAdmin({ T, S, lang = "tr", store, state }) {
  const R = S.rbac;
  const groups = Array.isArray(state.adminGroups) ? state.adminGroups : [];
  const keys = catalogueKeys(state.adminPermissions);
  const perms = Array.isArray(state.user?.perms) ? state.user.perms : [];
  const canManage = hasPerm(perms, "groups.manage");
  const [editing, setEditing] = useState(null);     // the editor's draft, or null
  const [deleting, setDeleting] = useState(null);   // the group awaiting confirmation, or null
  const [err, setErr] = useState(null);             // the open form's refusal (an Error)
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  /** Why a group's rights and MFA rule are read-only here, or "" when they are not. */
  const lockReason = (g) => {
    if (g.isSystem === true) return R.err.systemGroupRights;
    const missing = rightsBeyond(perms, rightsOf(g, keys));
    return missing.length ? cannotGrantReason(missing, lang) : "";
  };

  const openEditor = (g) => {
    setErr(null);
    setDeleting(null);
    setEditing(g ? {
      id: g.id, slug: g.slug, name: g.name || "", description: g.description || "",
      mfaRequired: g.mfaRequired === true, isSystem: g.isSystem === true,
      permissions: rightsOf(g, keys), source: g,
    } : { ...BLANK, source: null });
  };
  const openDelete = (g) => { setErr(null); setEditing(null); setDeleting(g); };
  const close = () => { setEditing(null); setDeleting(null); setErr(null); };

  const toggle = (key) => setEditing((g) => ({
    ...g,
    permissions: g.permissions.includes(key)
      ? g.permissions.filter((k) => k !== key) : [...g.permissions, key],
  }));

  const run = async (call) => {
    setBusy(true);
    setErr(null);
    try { await call(); close(); }
    catch (ex) { setErr(ex); }                       // keep the form open, say why
    finally { setBusy(false); }
  };

  const save = () => {
    const { source, ...draft } = editing;
    // Rights are sent in catalogue order and only as catalogue keys; without a catalogue they
    // were read-only, so the group's own keys go back unchanged (never an empty list).
    const chosen = new Set(draft.permissions);
    const permissions = keys.length ? keys.filter((k) => chosen.has(k)) : [...draft.permissions];
    return run(() => store.adminSaveGroup({ ...draft, permissions }));
  };
  const remove = () => run(() => store.adminDeleteGroup(deleting.id));

  const errorBox = err && (
    <div role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">
      {translateApiError(err, lang)}
    </div>
  );

  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className={`font-bold ${T.heading}`}>{R.groupsTitle}</h3>
        {canManage && (
          <button onClick={() => openEditor(null)} className={btnCls(T, "primary")}>
            <Plus size={15} /> {R.newGroup}
          </button>
        )}
      </div>
      <p className={`mb-4 text-sm ${T.muted}`}>{R.groupsSub}</p>
      {groups.length === 0 && <div className={`text-sm ${T.faint}`}>{R.noGroups}</div>}

      <div className={`divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {groups.map((g) => {
          const reason = canManage && g.isSystem !== true ? lockReason(g) : "";
          return (
            <div key={g.id} className="px-3 py-2.5" data-testid={`group-${g.slug}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <div className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${T.text}`}>
                    {g.name}
                    {g.isSystem && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${T.chip}`}>
                        <Lock size={10} className="mr-1 inline" />{R.system}
                      </span>
                    )}
                    {g.mfaRequired && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                        <ShieldCheck size={10} className="mr-1 inline" />MFA
                      </span>
                    )}
                  </div>
                  <div className={`truncate text-xs ${T.faint}`}>
                    {g.slug} · {g.memberCount} {R.members}{g.description ? ` · ${g.description}` : ""}
                  </div>
                  <div className={`mt-1 flex flex-wrap gap-1 text-[11px] ${T.muted}`}>
                    {rightsOf(g, keys).map((k) => (
                      <span key={k} className={`rounded-md px-1.5 py-0.5 ${T.subtle}`}>{permLabel(k, lang)}</span>
                    ))}
                  </div>
                  {reason && (
                    <div className={`mt-1 flex items-center gap-1 text-[11px] ${T.faint}`}>
                      <Lock size={10} className="shrink-0" /><span>{reason}</span>
                    </div>
                  )}
                </div>
                {canManage && (
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <button onClick={() => openEditor(g)} className={btnCls(T, "ghost")}
                      aria-label={`${R.editGroup} ${g.name}`}><Pencil size={14} /></button>
                    {!g.isSystem && (
                      <button onClick={() => openDelete(g)} disabled={Boolean(reason)}
                        title={reason || undefined} className={btnCls(T, "ghost")}
                        aria-label={`${R.delete} ${g.name}`}><Trash2 size={14} /></button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canManage && editing && (() => {
        // Judged on the group as the server last reported it (not on the draft), in the current
        // language; a group reloaded away meanwhile is judged as it was opened.
        const lock = editing.source
          ? lockReason(groups.find((g) => g.id === editing.id) || editing.source) : "";
        // Rows come from the catalogue; without one, the group's own keys, read-only.
        const rows = keys.length ? keys : editing.permissions;
        const rowLocked = (k) => Boolean(lock) || keys.length === 0 || !perms.includes(k);
        const note = lock || (keys.length === 0 ? R.loadFailed
          : (rows.some(rowLocked) ? R.err.beyondOwnRights : ""));
        const described = (locked) => (locked && note ? noteId : undefined);
        return (
          <ActionOverlay T={T} title={editing.id ? R.editGroup : R.newGroup} onClose={close}>
            <div className="space-y-3" data-testid="group-editor">
              <Field T={T} label={R.groupName}>
                <input className={inputCls(T)} value={editing.name} autoFocus
                  onChange={(e) => setEditing((g) => ({ ...g, name: e.target.value }))} />
              </Field>
              {!editing.id && (
                <Field T={T} label={R.groupSlug} hint={R.groupSlugHint}>
                  <input className={inputCls(T)} value={editing.slug}
                    onChange={(e) => setEditing((g) => ({ ...g, slug: e.target.value.toLowerCase() }))} />
                </Field>
              )}
              <Field T={T} label={R.groupDesc}>
                <input className={inputCls(T)} value={editing.description}
                  onChange={(e) => setEditing((g) => ({ ...g, description: e.target.value }))} />
              </Field>
              <div>
                <label className={`flex items-center gap-2 text-sm ${T.text}`}>
                  <input type="checkbox" checked={editing.mfaRequired} disabled={Boolean(lock)}
                    aria-describedby={described(Boolean(lock))}
                    onChange={(e) => setEditing((g) => ({ ...g, mfaRequired: e.target.checked }))} />
                  {R.mfaRequired}
                </label>
                <div className={`mt-0.5 pl-6 text-xs ${T.faint}`}>{R.mfaRequiredHint}</div>
              </div>
              <div className={`text-xs font-semibold uppercase ${T.faint}`}>{R.permissions}</div>
              {note && (
                <div id={noteId} className={`flex items-start gap-1.5 text-xs ${T.muted}`}>
                  <Lock size={12} className="mt-0.5 shrink-0" /><span>{note}</span>
                </div>
              )}
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {rows.map((k) => {
                  const locked = rowLocked(k);
                  return (
                    <label key={k} className={`flex items-center gap-2 rounded-lg border ${T.border} ${T.subtle} px-2.5 py-1.5 text-sm ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                      <input type="checkbox" checked={editing.permissions.includes(k)} disabled={locked}
                        aria-describedby={described(locked)} onChange={() => toggle(k)} />
                      <span className={T.text}>{permLabel(k, lang)}</span>
                      <span className={`ml-auto font-mono text-[10px] ${T.faint}`}>{k}</span>
                    </label>
                  );
                })}
              </div>
              {errorBox}
              <button onClick={save} disabled={busy} className={`${btnCls(T, "primary")} w-full`}>{R.save}</button>
            </div>
          </ActionOverlay>
        );
      })()}

      {canManage && deleting && (
        <ActionOverlay T={T} title={R.deleteConfirm} onClose={close}>
          <div className="space-y-3" data-testid="group-delete">
            <div>
              <div className={`text-sm font-semibold ${T.text}`}>{deleting.name}</div>
              <div className={`text-xs ${T.faint}`}>{deleting.slug} · {deleting.memberCount} {R.members}</div>
            </div>
            {errorBox}
            <div className="flex gap-2">
              <button onClick={close} className={`${btnCls(T, "ghost")} flex-1`}>{R.cancel}</button>
              <button onClick={remove} disabled={busy} className={`${btnCls(T, "danger")} flex-1`}>{R.delete}</button>
            </div>
          </div>
        </ActionOverlay>
      )}
    </div>
  );
}
