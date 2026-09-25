// src/admin/LiveUserAdmin.jsx — the staff list and local-account creation, backed by /admin/users.
// Only actions the backend implements exist here: create (local), edit manual groups, activate /
// deactivate, reset password (local only), reset MFA. Invitations, quick PINs, per-user MFA
// policy and unit assignment live only in the simulation and are deliberately absent.
//
// What is offered follows liveAdmin.js's rules, and those are HINTS: the server re-checks every
// write under the tenant lock, with the caller's rights read from the database, and its refusal —
// 403, 409, 422 — is shown through translateApiError, with the form kept open.
//   - Actions per user come from canManageUser. The ones it refuses are disabled, with the reason
//     in the server's words: rights beyond the session's, or yourself. A user in a group the list
//     does not hold has unknown rights and is not acted on.
//   - A password reset exists only for a local account.
//   - A group is offered only when canGrant holds; the others are disabled, with the reason.
//   - A custom group's keys the catalogue no longer holds (retired) are not rights: they are
//     dropped before judging. Without a catalogue (a users.manage desk cannot read it) a group is
//     judged with what is known.
//   - What the UI cannot see — an account shared with another tenant, a platform operator's, the
//     last administrator — the server refuses with a 409, shown as it arrives.
//   - The hints read the session token's perms. An older token under-reports a key added since it
//     was minted, until it refreshes; the server decides.
//   - While a request runs its dialog cannot be dismissed, so a refusal never lands in a closed
//     form.
//   - A password is never displayed: masked inputs, cleared after use, never in a message.
import React, { useId, useState } from "react";
import { KeyRound, Power, ShieldAlert, Users, Check, Lock, UserPlus } from "lucide-react";
import { Field, inputCls, btnCls, ActionOverlay } from "../ui.jsx";
import { hasPerm } from "../permissions.js";
import { canGrant, canManageUser, groupRights, rightsBeyond } from "../liveAdmin.js";
import { translateApiError, permLabel, cannotGrantReason } from "../clinicalI18n.js";

const BLANK = Object.freeze({ username: "", email: "", full_name: "", password: "", group_ids: [] });
const NONE = new Set();

const catalogueKeys = (catalogue) => (Array.isArray(catalogue) ? catalogue : [])
  .map((p) => (typeof p === "string" ? p : p?.key)).filter((k) => typeof k === "string");

/** The groups with a custom group's retired keys dropped, as the server counts rights. Without a
 *  catalogue they are taken as they are. The system group is left alone: groupRights gives it the
 *  whole catalogue by rule. */
function judgedGroups(groups, keys) {
  if (keys.length === 0) return groups;
  const known = new Set(keys);
  return groups.map((g) => (g.isSystem === true ? g : {
    ...g, permissions: (Array.isArray(g.permissions) ? g.permissions : []).filter((k) => known.has(k)),
  }));
}

// admin/schemas.py: the username is normalize_login-ed (trimmed, İ and ı folded to i, lower-cased)
// and must then be 2-128 of a-z 0-9 . _ @ -. The live hint flags what can never pass; the server
// decides the rest (and a too-short name).
const normalizeLogin = (value) => String(value ?? "").trim().replace(/İ/g, "i").toLowerCase()
  .replace(/ı/g, "i");
const usernameLooksWrong = (value) => {
  const key = normalizeLogin(value);
  return key.length > 128 || /[^a-z0-9._@-]/.test(key);
};

/** A template's {perms}, filled with permission names in `lang`. */
const fillPerms = (template, keys, lang, sep = ", ") =>
  template.replace("{perms}", () => keys.map((k) => permLabel(k, lang)).join(sep));

/** Why the session may not act on a user at all, or "" when it may — as the server would say it. */
function userLock(R, lang, perms, m) {
  if (!hasPerm(perms, "users.manage")) return fillPerms(R.err.permissionRequired, ["users.manage"], lang);
  if (m.beyond === null) return R.err.beyondOwnRights;           // a group the list does not hold
  if (m.beyond.length) return fillPerms(R.err.beyondOwnRightsList, m.beyond, lang);
  return "";
}

function ErrorBox({ err, lang }) {
  if (!err) return null;
  return (
    <div role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-500">
      {translateApiError(err, lang)}
    </div>
  );
}

/** Group checkboxes: a group beyond the session's rights is disabled with the reason; a membership
 *  the AD mapping holds is shown checked and locked. */
function GroupChoices({ T, R, lang, groups, perms, keys, selected, adIds = NONE, onToggle }) {
  const baseId = useId();
  return (
    <div className="max-h-56 space-y-1.5 overflow-y-auto">
      {groups.map((g, i) => {
        const fromAd = adIds.has(g.id);
        const reason = fromAd || canGrant(perms, g, keys) ? ""
          : cannotGrantReason(rightsBeyond(perms, groupRights(g, keys)), lang);
        const locked = fromAd || Boolean(reason);
        const reasonId = `${baseId}-${i}`;
        return (
          <div key={g.id} className={`rounded-lg border ${T.border} ${T.subtle} px-3 py-2 ${locked ? "opacity-60" : ""}`}>
            <label className={`flex items-center gap-2.5 text-sm ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}>
              <input type="checkbox" disabled={locked} checked={fromAd || selected.includes(g.id)}
                aria-describedby={reason ? reasonId : undefined} onChange={() => onToggle(g.id)} />
              <span className={T.text}>{g.name}</span>
              {fromAd && <span className={`ml-auto text-[10px] ${T.faint}`}>{R.fromAd}</span>}
            </label>
            {reason && (
              <div id={reasonId} className={`mt-1 flex items-start gap-1 pl-6 text-[11px] ${T.faint}`}>
                <Lock size={10} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{reason}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CreateUserForm({ T, R, lang, store, groups, perms, keys }) {
  const [f, setF] = useState(() => ({ ...BLANK, group_ids: [] }));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const lockId = useId();
  const lock = hasPerm(perms, "users.manage") ? ""
    : fillPerms(R.err.permissionRequired, ["users.manage"], lang);
  const set = (key) => (e) => setF((s) => ({ ...s, [key]: e.target.value }));
  const toggle = (id) => setF((s) => ({
    ...s, group_ids: s.group_ids.includes(id) ? s.group_ids.filter((x) => x !== id) : [...s.group_ids, id],
  }));
  const submit = async (e) => {
    e.preventDefault();
    if (busy || lock) return;
    setBusy(true);
    setErr(null);
    try {
      await store.adminCreateUser({
        username: f.username.trim(), email: f.email.trim() || null, full_name: f.full_name.trim(),
        password: f.password, group_ids: f.group_ids,
      });
      setF({ ...BLANK, group_ids: [] });
    } catch (ex) { setErr(ex); }                     // keep the form filled, say why
    finally { setBusy(false); }
  };
  const usernameHint = usernameLooksWrong(f.username)
    ? <span className="text-amber-600">{R.err.usernameRule}</span> : R.usernameHint;
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="create-user-form">
      <Field T={T} label={R.username} hint={usernameHint}>
        <input className={inputCls(T)} value={f.username} onChange={set("username")}
          autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field T={T} label={R.fullName}>
        <input className={inputCls(T)} value={f.full_name} onChange={set("full_name")} autoComplete="off" />
      </Field>
      <Field T={T} label={R.emailOptional}>
        <input className={inputCls(T)} value={f.email} onChange={set("email")} inputMode="email"
          autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field T={T} label={R.tempPassword} hint={R.tempPasswordHint}>
        <input className={inputCls(T)} type="password" autoComplete="new-password" value={f.password}
          onChange={set("password")} />
      </Field>
      <div className={`text-xs font-semibold uppercase ${T.faint}`}>{R.groupsLabel}</div>
      <GroupChoices T={T} R={R} lang={lang} groups={groups} perms={perms} keys={keys}
        selected={f.group_ids} onToggle={toggle} />
      <ErrorBox err={err} lang={lang} />
      {lock && <div id={lockId} className={`text-xs ${T.muted}`}>{lock}</div>}
      <button type="submit" disabled={busy || Boolean(lock)} aria-describedby={lock ? lockId : undefined}
        className={`${btnCls(T, "primary")} w-full`}><UserPlus size={15} /> {R.createUser}</button>
    </form>
  );
}

function when(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function UserRowLive({ T, R, lang, store, groups, perms, keys, selfId, u }) {
  const [modal, setModal] = useState(null);         // "groups" | "password" | null
  const [sel, setSel] = useState(u.manualGroupIds);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);             // the last refusal (an Error), row or dialog
  const [busy, setBusy] = useState(false);
  const noteId = useId();

  const m = canManageUser(perms, u, groups, selfId, keys);
  const lock = userLock(R, lang, perms, m);
  const local = u.authSource === "local";
  const why = {
    groups: m.setGroups ? "" : lock,
    password: local && !m.resetPassword ? (lock || R.err.selfCredentials) : "",
    mfa: m.resetMfa ? "" : (lock || R.err.selfCredentials),
    active: u.active ? (m.deactivate ? "" : (lock || R.err.selfDeactivate)) : (m.edit ? "" : lock),
  };
  const notes = [...new Set(Object.values(why).filter(Boolean))];
  const noteFor = (reason) => (reason ? `${noteId}-${notes.indexOf(reason)}` : undefined);
  const adIds = new Set(u.groups.filter((g) => g.source === "ldap").map((g) => g.id));

  const openModal = (name) => { setErr(null); setPw(""); setSel(u.manualGroupIds); setModal(name); };
  // Backdrop, X and Cancel: not while a request runs, or its refusal would land in a closed form.
  const dismiss = () => { if (!busy) { setModal(null); setPw(""); setErr(null); } };
  const run = async (call) => {
    setBusy(true);
    setErr(null);
    try { await call(); setModal(null); setPw(""); }
    catch (ex) { setErr(ex); }                       // keep the dialog open, say why
    finally { setBusy(false); }
  };
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const action = (reason, onClick, icon, label) => (
    <button type="button" onClick={onClick} disabled={busy || Boolean(reason)} title={reason || undefined}
      aria-describedby={noteFor(reason)} className={btnCls(T, "ghost")}>{icon} {label}</button>
  );

  return (
    <div className="px-3 py-2.5" data-testid={`user-${u.username}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className={`truncate text-sm font-semibold ${T.text}`}>{u.full_name || u.username}</div>
          <div className={`truncate text-xs ${T.faint}`}>{u.username}{u.email ? ` · ${u.email}` : ""}</div>
          <div className={`text-[11px] ${T.faint}`}>
            {R.lastLogin}: {u.lastLoginAt ? when(u.lastLoginAt) : R.never}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${T.chip}`}>{local ? R.sourceLocal : R.sourceLdap}</span>
          {u.groups.length === 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] ${T.chip}`}>{R.noGroupsAssigned}</span>}
          {u.groups.map((g) => (
            <span key={`${g.id}-${g.source}`} className={`rounded-full px-2 py-0.5 text-xs ${T.chip}`}>
              {g.name}{g.source === "ldap" ? ` (${R.fromAd})` : ""}
            </span>
          ))}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${u.active ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}>
            {u.active ? R.active : R.passive}
          </span>
          {u.mfa && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">MFA</span>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {action(why.groups, () => openModal("groups"), <Users size={14} />, R.editGroups)}
        {local && action(why.password, () => openModal("password"), <KeyRound size={14} />, R.resetPassword)}
        {action(why.mfa, () => run(() => store.adminResetMfa(u.id)), <ShieldAlert size={14} />, R.resetMfa)}
        {action(why.active, () => run(() => store.adminUpdateUser(u.id, { is_active: !u.active })),
          <Power size={14} />, u.active ? R.deactivate : R.activate)}
      </div>
      {notes.length > 0 && (
        <div className={`mt-1.5 space-y-0.5 text-[11px] ${T.faint}`}>
          {notes.map((note, i) => (
            <div key={note} id={`${noteId}-${i}`} className="flex items-start gap-1">
              <Lock size={10} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{note}</span>
            </div>
          ))}
        </div>
      )}
      {!modal && err && <div className="mt-2"><ErrorBox err={err} lang={lang} /></div>}

      {modal === "groups" && (
        <ActionOverlay T={T} title={R.editGroups} onClose={dismiss}>
          <div className="space-y-3">
            <p className={`text-sm ${T.muted}`}>{R.editGroupsHint}</p>
            <GroupChoices T={T} R={R} lang={lang} groups={groups} perms={perms} keys={keys}
              selected={sel} adIds={adIds} onToggle={toggle} />
            <ErrorBox err={err} lang={lang} />
            <div className="flex gap-2">
              <button type="button" onClick={dismiss} disabled={busy}
                className={`${btnCls(T, "ghost")} flex-1`}>{R.cancel}</button>
              <button type="button" onClick={() => run(() => store.adminSetUserGroups(u.id, sel))}
                disabled={busy} className={`${btnCls(T, "primary")} flex-1`}>
                <Check size={15} /> {R.saveGroups}
              </button>
            </div>
          </div>
        </ActionOverlay>
      )}

      {modal === "password" && (
        <ActionOverlay T={T} title={R.resetPassword} onClose={dismiss}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            if (pw) run(() => store.adminResetPassword(u.id, pw));
          }}>
            <Field T={T} label={R.newPassword} hint={R.tempPasswordHint}>
              <input type="password" autoComplete="new-password" className={inputCls(T)} value={pw}
                onChange={(e) => setPw(e.target.value)} autoFocus />
            </Field>
            <ErrorBox err={err} lang={lang} />
            <div className="flex gap-2">
              <button type="button" onClick={dismiss} disabled={busy}
                className={`${btnCls(T, "ghost")} flex-1`}>{R.cancel}</button>
              <button type="submit" disabled={busy || !pw} className={`${btnCls(T, "primary")} flex-1`}>
                <KeyRound size={15} /> {R.resetPassword}
              </button>
            </div>
          </form>
        </ActionOverlay>
      )}
    </div>
  );
}

export function LiveUserAdmin({ T, S, lang = "tr", store, state }) {
  const R = S.rbac;
  const users = Array.isArray(state.adminUsers) ? state.adminUsers : [];
  const keys = catalogueKeys(state.adminPermissions);
  const groups = judgedGroups(Array.isArray(state.adminGroups) ? state.adminGroups : [], keys);
  const perms = Array.isArray(state.user?.perms) ? state.user.perms : [];
  const selfId = state.user?.id ?? null;
  const shared = { T, R, lang, store, groups, perms, keys };
  return (
    <div className={`rounded-2xl border ${T.border} ${T.card} p-5`}>
      <h3 className={`mb-1 font-bold ${T.heading}`}>{R.usersTitle}</h3>
      <p className={`mb-4 text-sm ${T.muted}`}>{R.usersSub}</p>
      <CreateUserForm {...shared} />
      <div className={`mt-4 text-xs font-semibold uppercase ${T.faint}`}>{R.usersTitle}</div>
      <div className={`mt-2 divide-y ${T.divide} rounded-xl border ${T.border}`}>
        {users.map((u) => <UserRowLive key={u.id} {...shared} selfId={selfId} u={u} />)}
      </div>
    </div>
  );
}
