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
import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../../i18n/I18nProvider.jsx";
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

/** The groups a desk may choose from, split the way the form offers them (catalogue.groupKind):
 *  one role, any number of extra duties, any number of the hospital's own groups. */
export function splitGroups(groups) {
  const of = (kind) => groups.filter((g) => groupKind(g.slug) === kind);
  return { roles: of("role"), extras: of("extra"), others: of("other") };
}

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
 */
export function UserForm({
  user = null, groups = [], catalogue = [], perms = [], submit, onSaved, onRefused, onClose,
}) {
  const { t } = useI18n();
  const isNew = user === null;
  const drawn = DRAWN[isNew ? "create" : "edit"];
  const { roles, extras, others } = useMemo(() => splitGroups(groups), [groups]);
  const held = new Set(isNew ? [] : user.manualGroupIds);
  const [fullName, setFullName] = useState(isNew ? "" : user.fullName || "");
  const [username, setUsername] = useState(isNew ? "" : user.username || "");
  const [email, setEmail] = useState(isNew ? "" : user.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(() => roles.find((g) => held.has(g.id))?.id ?? "");
  const [chosen, setChosen] = useState(() => new Set([...extras, ...others].filter((g) => held.has(g.id)).map((g) => g.id)));
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
  const directoryGroups = isNew ? [] : user.groups.filter((g) => g.source === "directory");

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
    setBusy(true);
    const groupIds = [...(role ? [role] : []), ...chosen];
    const body = isNew
      ? { username: username.trim(), email: email.trim() || null, full_name: fullName.trim(), password, group_ids: groupIds }
      : { full_name: fullName.trim(), email: email.trim(), is_active: active, group_ids: groupIds };
    try {
      await submit(body);
      // Nothing is kept: the password leaves this component's state in the same turn the dialog
      // closes, and `onSaved` unmounts it.
      setPassword("");
      if (mounted.current) onSaved();
    } catch (err) {
      if (!mounted.current) return;
      // Split between the controls this form draws and everything else (`fieldRefusals`); what no
      // control shows still reaches the administrator, once, on the toast.
      const { fields: named, others } = fieldRefusals(t, err, drawn);
      const subject = fullName.trim() || username.trim();
      if (Object.keys(named).length > 0) {
        // The field has to be ENABLED before it can take focus: the controls are `disabled`
        // while busy, and `focus()` on a disabled element is a no-op in a browser (jsdom is more
        // lenient, which is how a test could pass while the screen did not). `flushSync` lands
        // the two state updates in the DOM before the focus call, instead of after this
        // handler returns.
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
  // test): a limit met at the keyboard is a refusal the administrator never has to read.
  const bind = (key) => ({
    ref: (el) => { fields.current[FIELD[key]] = el; },
    disabled: busy,
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
        <Announce text={busy ? t("admin.saving") : ""} />
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
            disabled={busy || !isNew}
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

        {isNew ? null : (
          <label className="flex items-center gap-2 font-text text-13.5">
            <input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} />
            {t("admin.fieldActive")}
          </label>
        )}
      </form>
    </Modal>
  );
}
