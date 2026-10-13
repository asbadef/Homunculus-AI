// src/live/screens/admin/UserForm.jsx — the one form that creates a local account and the one that
// edits an existing one (G1-12, roadmap D3: "Rol + Ek görev + Birimler").
//
// WHAT THIS FORM DOES NOT DO, AND WHY — the prototype's own user dialog (`admin.js userModal`) is
// the specification for three things a live system must refuse:
//
//   * IT DOES NOT MAKE UP A PASSWORD. The prototype shows a plaintext one it generated
//     (`H.genPassword`) with a "regenerate" button, and keeps three mutually inconsistent password
//     policies in the browser. Here the administrator types the temporary password, the only rule
//     stated is the server's own (at least `PASSWORD_MIN` characters, `admin/schemas.py`) COUNTED
//     AS THE SERVER COUNTS — in code points (`limits.lengthOf`, `[...s].length`): four emoji are
//     eight to JavaScript's `.length` and four to Python's `len`, and a form that counted `.length`
//     sent them as long enough for the server to refuse. The field is `type="password"` and it is
//     cleared the moment the dialog closes. A password is never in a title, never in a toast, never
//     logged, and never in the DOM after the dialog has gone — `UsersTab.test.jsx` asserts the last
//     one, because it is the claim worth testing.
//
//   * IT DOES NOT POLICE THE USERNAME. The prototype enforces `^[a-z0-9._]{3,32}$` in the
//     browser, which is not the server's rule (`a-z 0-9 . _ @ -`, 2-128, after folding `İ`/`ı`):
//     it refuses addresses the API accepts. The only check here is for characters that can never
//     pass whatever the server thinks, and the server's own 422 lands on the field it is about
//     (`fieldRefusals`) in the reader's own language. Every field carries the server's own
//     `maxLength` (`limits.FIELD_MAX`), so a limit is met at the keyboard rather than refused after.
//
//   * IT DOES NOT SWALLOW A REFUSAL IT HAS NO FIELD FOR. `fieldRefusals` is told which fields this
//     form DRAWS; a 422 about anything else (`group_ids.0`, the body as a whole) comes back as its
//     `others` and goes to the toast, named after the account — never "a field was named, so show
//     nothing", which is how the first version lost it.
//
//   * IT DOES NOT HIDE A GROUP THE DESK MAY NOT GIVE. A group outside the session's own rights
//     (`canGrant`) is drawn, disabled, with `admin.cannotGrant` beside it. Hiding it would leave
//     an administrator unable to tell "this hospital has no such group" from "I may not give it",
//     which are the two answers she is choosing between.
//
// The memberships the DIRECTORY holds are listed read-only: `PUT /users/{id}/groups` replaces the
// MANUAL ones and leaves AD's alone (`admin/service.set_manual_groups`), so offering them would be
// offering a change the server discards.
//
// THE USERNAME CANNOT BE EDITED. `UserPatch` has no `username` and the API has no rename; the
// field is `disabled` on an edit and says so. The roadmap routes renaming to Group 4.
//
// AN EDIT SENDS WHAT THE ADMINISTRATOR CHANGED, AND NOTHING ELSE. The form opens on the list as
// it was last READ, and another desk may have changed the account since. Re-sending every field
// re-sent that stale copy: fixing a typo in a nurse's name re-activated an account another
// administrator had just deactivated, and undid groups changed elsewhere — and said "saved". So
// the details carry only the fields that differ from what the form opened with, and the groups
// are sent only when the role or the groups differ from the memberships it opened with — and then
// WITH those memberships (`expected`), so the server can refuse a replacement built on a list
// that is no longer the one it holds (Task 14e: 409 `concurrentChange`, nothing written). An account
// holding more than one role keeps every one of them: the role `<select>` shows the first and the
// rest are listed, ticked, under it — a second role is not dropped because a select holds one.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { fieldRefusals } from "../../apiErrors.js";
import { Announce, Button, Field, Input, Modal, Select } from "../../ui/index.js";
import { PASSWORD_MIN } from "../../auth/passwordRules.js";
import { groupKind } from "./catalogue.js";
import { FIELD_MAX, FIELD_MIN, lengthOf } from "./limits.js";
import { canGrant } from "./rules.js";

/** Which of the API's field names each control shows a refusal for. */
const FIELD = { fullName: "full_name", username: "username", email: "email", password: "password" };
/** The API fields this form DRAWS an editable control for, per mode — what `fieldRefusals` puts
 *  under a control. An edit sends no username and no password (`UserPatch`), so a refusal naming
 *  either cannot be about this write's controls and goes to the toast with everything else. */
const DRAWN = {
  create: ["full_name", "username", "email", "password"],
  edit: ["full_name", "email"],
};

/** What a group is to the form: the ADAPTED group's own `kind` — the API's answer
 *  (`GroupOut.kind`, read by `rules.groupFromApi`) — and the mirror (`catalogue.groupKind`) only
 *  for a group described without any kind, as `groupFromApi` itself falls back. Classifying by the
 *  mirror here while the list read the API made the form and the list disagree about a group the
 *  server describes and the mirror does not know (a hospital's own group the API calls a duty). */
export const kindOf = (group) => (group?.kind === undefined ? groupKind(group?.slug) : (group.kind ?? "other"));

/** The groups a desk may choose from, split the way the form offers them (`kindOf`): one role,
 *  any number of extra duties, any number of the hospital's own groups. */
export function splitGroups(groups) {
  const of = (kind) => groups.filter((g) => kindOf(g) === kind);
  return { roles: of("role"), extras: of("extra"), others: of("other") };
}

/** The same set of ids, whatever the order. */
const sameIds = (a, b) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/** One checkbox for a group, disabled with its reason when this desk may not give it. */
function GroupChoice({ group, checked, grantable, busy, onToggle }) {
  const { t } = useI18n();
  return (
    <label className="flex items-start gap-2 py-1 font-text text-13.5">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={!grantable || busy}
        onChange={(event) => onToggle(group.id, event.target.checked)}
      />
      <span className={grantable ? "" : "text-mute"}>
        {group.name}
        {grantable ? null : <span className="block text-11.5 text-mute">{t("admin.cannotGrant")}</span>}
      </span>
    </label>
  );
}

/**
 * `user` null: create. Otherwise edit that account.
 *
 * `submit(body)` sends the write and resolves when the server has taken it; it throws the API's
 * failure. A 422 about a field this form DRAWS is shown under that field and focus moves to the
 * first of them — that is where an administrator can act on it — and that text is not ALSO toasted,
 * so one refusal is announced once. Everything else — a refusal that is not a 422, and a 422's
 * `others` (`fieldRefusals`: about something no control here shows) — goes to
 * `onRefused(reason, subject)`, which puts it on the toast named after this account
 * (`refusal.js`). `reason` is the failure itself, or the `others` already in the reader's words;
 * `subject` is the name typed into this form, the only name a NEW account has.
 *
 * A NEW account's `submit` gets the `UserCreate` body. An EDIT's gets
 * `{ details, groupIds, expectedGroupIds }`: `details` is the `UserPatch` body with only the
 * fields that changed (possibly none); `groupIds` is the new manual membership list, or null when
 * it did not change; `expectedGroupIds` is the manual list the form opened with, sorted. An edit
 * that changed nothing sends nothing and closes. `onSaved(subject)` names the account. A failure
 * may say which half of an edit landed — `detailsLanded`, `detailsUnknown` — and `stale` when
 * another desk changed the account since this form read it: the form then closes.
 *
 * `self`: the account being edited is the session's own — its active state is not offered (the
 * server refuses it, and the row already says why).
 */
export function UserForm({
  user = null, self = false, groups = [], catalogue = [], perms = [], submit, onSaved, onRefused, onClose,
}) {
  const { t } = useI18n();
  const { store } = useSession();
  const isNew = user === null;
  const drawn = DRAWN[isNew ? "create" : "edit"];
  const { roles, extras, others } = useMemo(() => splitGroups(groups), [groups]);
  /** The manual memberships the form READ. Never moved, whatever lands: it is the `expected` of the
   *  memberships' compare-and-swap, and only a fresh read (reopening the account) may change it. */
  const held = new Set(isNew ? [] : user.manualGroupIds);
  /** The account's details as the server holds them, as far as this form knows — what is compared
   *  to decide what an edit sends. It opens as the list read them, and MOVES when a details write
   *  lands although the groups after it were refused: comparing against the opening copy then hid
   *  a change made and undone (deactivate, groups refused, re-activate — "nothing changed", while
   *  the server held the deactivation). A field a details write carried WITHOUT an answer is
   *  unknown (`undefined`), so it is sent again whatever it shows. */
  const baseline = useRef(isNew ? {} : {
    full_name: (user.fullName || "").trim(), email: (user.email || "").trim(), is_active: user.active,
  });
  const [fullName, setFullName] = useState(isNew ? "" : user.fullName || "");
  const [username, setUsername] = useState(isNew ? "" : user.username || "");
  const [email, setEmail] = useState(isNew ? "" : user.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(() => roles.find((g) => held.has(g.id))?.id ?? "");
  /** Every role the account holds beyond the one the select shows. Fixed at opening: they are
   *  listed, ticked, so that saving keeps them unless the administrator unticks one. */
  const [moreRoles] = useState(() => roles.filter((g) => held.has(g.id)).slice(1));
  const [chosen, setChosen] = useState(() => new Set(
    [...moreRoles, ...extras, ...others].filter((g) => held.has(g.id)).map((g) => g.id),
  ));
  const [active, setActive] = useState(isNew ? true : user.active);
  const [refusals, setRefusals] = useState({});
  const [busy, setBusy] = useState(false);
  const fields = useRef({});
  // Set true INSIDE the effect (the house pattern, `useAdminData`): StrictMode's rehearsal runs the
  // cleanup and then the effect again, and a ref set true only at creation stayed false after it —
  // every answer was then dropped as "unmounted".
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const grantable = (group) => canGrant(perms, group, catalogue);
  // Every membership that is not MANUAL is the directory's: the server spells it "ldap"
  // (`SOURCE_LDAP`), and a filter on any one spelling of "not ours" is a filter the next spelling
  // slips past — which is how an AD nurse's groups went unlisted here, beside a role select that
  // (rightly: it offers the MANUAL memberships) read "no role".
  const directoryGroups = isNew ? [] : user.groups.filter((g) => g.source !== "manual");

  const toggle = (id, on) => setChosen((was) => {
    const next = new Set(was);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  /** Only what can never pass, whatever the server's rule is. Everything else is the server's. Both
   *  lengths are counted in code points, as the server counts them (`lengthOf`). */
  function problems() {
    const out = {};
    if (!fullName.trim()) out.full_name = t("errors.mustNotBeBlank");
    if (isNew && lengthOf(username.trim()) < FIELD_MIN.username) out.username = t("errors.usernameRule");
    if (isNew && lengthOf(password) < PASSWORD_MIN) out.password = t("errors.passwordTooShort");
    return out;
  }

  // Called by the form's own submit (Enter in a field) AND by the footer's primary button, which
  // the dialog renders outside the <form>: a `type="submit" form="…"` button is not reliable in
  // every renderer this suite runs in, and one handler for both is one behaviour to test.
  async function onSubmit(event) {
    event?.preventDefault?.();
    if (busy) return;
    const mine = problems();
    if (Object.keys(mine).length > 0) {
      setRefusals(mine);
      fields.current[Object.keys(mine)[0]]?.focus();
      return;
    }
    setRefusals({});
    const groupIds = [...new Set([...(role ? [role] : []), ...chosen])];
    const subject = fullName.trim() || username.trim();
    let body;
    if (isNew) {
      body = { username: username.trim(), email: email.trim() || null, full_name: fullName.trim(), password, group_ids: groupIds };
    } else {
      // Only what differs from the server's copy as this form knows it (`baseline`): the rest may
      // have changed on the server since, and re-sending the copy this form read would undo that.
      const known = baseline.current;
      const details = {};
      if (fullName.trim() !== known.full_name) details.full_name = fullName.trim();
      // "" clears the e-mail (`UserPatch`), which is what an emptied field means.
      if (email.trim() !== known.email) details.email = email.trim();
      if (!self && active !== known.is_active) details.is_active = active;
      const groupsChanged = !sameIds(groupIds, held);
      if (Object.keys(details).length === 0 && !groupsChanged) {
        // Nothing to send, and nothing is claimed: the dialog closes as a Cancel does.
        onClose();
        return;
      }
      body = {
        details,
        groupIds: groupsChanged ? groupIds : null,
        expectedGroupIds: [...held].sort(),
      };
    }
    setBusy(true);
    // The session this write belongs to: an answer that arrives after it ended says nothing — not
    // a confirmation, not a refusal — into the screen that replaced it.
    const epoch = store.epoch();
    const ours = () => store.epoch() === epoch;
    try {
      await submit(body);
      // Nothing is kept: the password leaves this component's state in the same turn the dialog
      // closes, and `onSaved` unmounts it.
      setPassword("");
      if (mounted.current && ours()) onSaved(subject);
    } catch (err) {
      if (!ours()) {
        setPassword("");
        return;
      }
      // What the server now holds of the details, whatever the groups did (`baseline`).
      if (err?.detailsLanded) baseline.current = { ...baseline.current, ...body.details };
      if (err?.detailsUnknown) {
        baseline.current = { ...baseline.current };
        for (const key of Object.keys(body.details)) baseline.current[key] = undefined;
      }
      // Split between the controls this form draws and everything else (`fieldRefusals`); what no
      // control shows still reaches the administrator, once, on the toast.
      const { fields: named, others } = fieldRefusals(t, err, drawn);
      if (!mounted.current) {
        // The form is gone (its tab was left mid-write): the toast, which outlives it, is the only
        // place left to say the refusal at all — the whole of it, fields included.
        onRefused(err, subject);
        return;
      }
      if (err?.stale) {
        // Another desk changed the account since this form read it: saving again from here would
        // be refused again. Said, and the form closes — reopened, it reads the account as it is.
        setPassword("");
        onRefused(err, subject);
        onClose();
        return;
      }
      if (Object.keys(named).length > 0) {
        // `flushSync` lands the refusal under its field — and the form out of its busy state —
        // in the DOM before the focus call, instead of after this handler returns, so the field
        // the focus reaches already says what is wrong with it (its error is first in its
        // aria-describedby, which is what a screen reader reads on arrival).
        flushSync(() => {
          setBusy(false);
          setPassword("");
          setRefusals(named);
        });
        fields.current[Object.keys(named)[0]]?.focus();
        if (others.length > 0) onRefused(others.join(" "), subject);
      } else {
        setPassword("");
        onRefused(others.length > 0 ? others.join(" ") : err, subject);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  // Every field carries the server's own limit (`limits.FIELD_MAX`, held to admin/schemas.py by its
  // test): a limit met at the keyboard is a refusal the administrator never has to read. While the
  // write is out a field is READ-ONLY, not disabled: Enter in a field sends the form, and disabling
  // the field that has the focus drops it to <body> — the keyboard user's place, lost mid-write.
  const bind = (key) => ({
    ref: (el) => { fields.current[FIELD[key]] = el; },
    readOnly: busy,
    maxLength: FIELD_MAX[FIELD[key]],
  });

  return (
    <Modal
      open
      title={t(isNew ? "admin.formNew" : "admin.formEdit")}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("admin.cancel")}</Button>
          <Button variant="primary" busy={busy} onClick={onSubmit}>
            {t(isNew ? "admin.create" : "admin.save")}
          </Button>
        </>
      )}
    >
      <form noValidate onSubmit={onSubmit}>
        {/* Inside the dialog, naming the account: everything outside an open dialog is inert, and
            an inert live region is dropped from the accessibility tree. */}
        <Announce text={busy ? t("admin.savingFor", { subject: isNew ? username.trim() : user.username }) : ""} />
        <Field layout="col" required label={t("admin.fieldFullName")} error={refusals.full_name}>
          <Input {...bind("fullName")} value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </Field>
        <Field
          layout="col"
          required={isNew}
          label={t("admin.fieldUsername")}
          hint={t("admin.fieldUsernameHint")}
          error={refusals.username}
        >
          <Input
            {...bind("username")}
            value={username}
            disabled={!isNew}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field layout="col" label={t("admin.fieldEmail")} hint={t("admin.fieldEmailHint")} error={refusals.email}>
          <Input {...bind("email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {isNew ? (
          <Field
            layout="col"
            required
            label={t("admin.fieldPassword")}
            hint={t("admin.fieldPasswordHint")}
            error={refusals.password}
          >
            <Input
              {...bind("password")}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : null}

        <Field layout="col" label={t("admin.fieldRole")} hint={t("admin.fieldRoleHint")}>
          <Select value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t("admin.noRole")}</option>
            {roles.map((group) => (
              <option key={group.id} value={group.id} disabled={!grantable(group)}>
                {grantable(group) ? group.name : `${group.name} — ${t("admin.cannotGrant")}`}
              </option>
            ))}
          </Select>
        </Field>

        {moreRoles.length > 0 ? (
          <fieldset className="mb-2.5 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("admin.fieldMoreRoles")}</legend>
            {moreRoles.map((group) => (
              <GroupChoice
                key={group.id}
                group={group}
                checked={chosen.has(group.id)}
                grantable={grantable(group)}
                busy={busy}
                onToggle={toggle}
              />
            ))}
            <p className="m-0 text-12 text-mute">{t("admin.fieldMoreRolesHint")}</p>
          </fieldset>
        ) : null}

        {extras.length > 0 ? (
          <fieldset className="mb-2.5 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("admin.fieldExtras")}</legend>
            {extras.map((group) => (
              <GroupChoice
                key={group.id}
                group={group}
                checked={chosen.has(group.id)}
                grantable={grantable(group)}
                busy={busy}
                onToggle={toggle}
              />
            ))}
            <p className="m-0 text-12 text-mute">{t("admin.fieldExtrasHint")}</p>
          </fieldset>
        ) : null}

        {others.length > 0 ? (
          <fieldset className="mb-2.5 border-0 p-0">
            <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{t("admin.fieldOther")}</legend>
            {others.map((group) => (
              <GroupChoice
                key={group.id}
                group={group}
                checked={chosen.has(group.id)}
                grantable={grantable(group)}
                busy={busy}
                onToggle={toggle}
              />
            ))}
            <p className="m-0 text-12 text-mute">{t("admin.fieldOtherHint")}</p>
          </fieldset>
        ) : null}

        {directoryGroups.length > 0 ? (
          <p className="m-0 mb-2.5 text-12.5 text-mute">
            {t("admin.directoryGroups", { list: directoryGroups.map((g) => g.name).join(", ") })}
          </p>
        ) : null}

        {/* Your own account's active state is not offered: the server refuses it, and the row
            already says so in the same words. A checkbox here would be a control that cannot work. */}
        {isNew ? null : self ? (
          <p className="m-0 text-12.5 text-mute">{t("admin.selfNote")}</p>
        ) : (
          <label className="flex items-center gap-2 font-text text-13.5">
            <input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />
            {t("admin.fieldActive")}
          </label>
        )}
      </form>
    </Modal>
  );
}
