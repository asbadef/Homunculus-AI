// src/live/screens/admin/ScopeEditor.jsx — which units and beds one member of staff may see
// (G1-12; `PUT /scope/{user_id}`).
//
// THERE IS NO ENDPOINT THAT LISTS THE UNITS AND BEDS A SCOPE MAY NAME. The keys are the values in
// the site's `bed-mapping.json` (`BED_MAPPING_PATH`, a read-only bind mount; `tenant/bedmap.py`
// `BedRef.unit_id` / `bed_id`), written by an operator from the discovery report. `/tenant/*` does
// carry a unit and bed tree, but it needs `structure.manage` — which `users.manage` does not imply
// — and its ids are database UUIDs that nothing forces the mapping file to use. So this editor
// offers three sources and says in one line which they are:
//
//   1. the `identity.unit_id` / `identity.bed_id` of the cards on the board this session already
//      has (an unrestricted administrator sees them all);
//   2. the grants this user already holds, which `GET /scope/{id}` reports;
//   3. a free-text field, for a key with no patient on it right now.
//
// An empty unit has no card, so it is not in (1) — which is why (3) exists and why the sentence
// saying so is not optional. A grant whose key matches no card is not an error either: `/patients`
// reports it under `scope.unmatched_grants` and the clinician's own board shows that sentence.
//
// THE WRITE IS A REPLACEMENT, NOT A DIFF (`scope/schemas.ScopeAssignment`): two administrators
// saving diffs would merge into the union of both, the more permissive outcome, chosen by neither.
// The screen shows its own list at once and PUTS THE PREVIOUS LIST BACK when the server refuses,
// saying so — the only optimism in this surface, and it is reversible because the list is local.
//
// ONE GRANT NAMES A UNIT OR A BED, NEVER BOTH (`ScopeGrantIn._exactly_one`, 422): a grant naming
// neither "reads as access while granting nothing", which is the dangerous half.
//
// WHO MAY SAVE AT ALL is not a permission key. `PUT /scope/{id}` is refused with 403 unless the
// CALLER's own scope is unrestricted by ROLE (`scope/router.put_scope`), so `users.manage` alone
// is not enough and nothing in the token says otherwise: the only honest source is the caller's own
// `/scope/me` (`canAssignScope`). Until that answer arrives the Save is not offered and the screen
// says the right is unknown — never a button that cannot work.
//
// ONLY A SCOPE UNRESTRICTED BY ROLE HAS NOTHING TO ASSIGN (`rules.scopeKind`, the one rule this
// editor and the units cell both follow). The first version read ANY `unrestricted: true` as
// "nothing to assign here" — and at the pilot every non-administrator's `/scope/{id}` answers
// `unrestricted: true, reason: "unassigned"`, because `SCOPE_ENFORCE_UNASSIGNED` is off by default.
// No first assignment could have been made from this screen. An UNASSIGNED account gets the editor
// and one sentence saying what she sees until it is used — every patient while enforcement is off,
// only her own while it is on — and that sentence is the one place the flag is read, after
// `scopeKind` has said "unassigned". An "unknown" scope is editable too: the server decides the write.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Announce, Button, Field, Input, Modal, Note, Table } from "../../ui/index.js";
import { boardKnown } from "../common/BoardState.jsx";
import { FIELD_MAX } from "./limits.js";
import { scopeKind } from "./rules.js";

/** What an UNASSIGNED account sees until this editor is used — asked only of a scope `scopeKind`
 *  has already called "unassigned". With enforcement off (the pilot) the engine shows her every
 *  patient; with it on, only those whose care team names her or that she opened by break-glass. */
const unassignedNoteKey = (scope) => (scope.unrestricted === true
  ? "admin.scopeUnassignedOpen"
  : "admin.scopeUnassignedClosed");

/** A grant as this editor holds it: exactly one of the two keys, trimmed. */
const asGrant = (unitId, bedId) => ({ unitId: unitId || "", bedId: bedId || "" });
const sameGrant = (a, b) => a.unitId === b.unitId && a.bedId === b.bedId;
const keyOf = (g) => `${g.unitId}|${g.bedId}`;

/** The unit and bed keys this board can offer, plus the ones the user already holds. Sorted, with
 *  duplicates removed; a card the bed table did not place carries neither and contributes nothing. */
export function offeredKeys(patients, grants) {
  const units = new Set();
  const beds = new Set();
  for (const patient of Array.isArray(patients) ? patients : []) {
    if (patient?.unitId) units.add(patient.unitId);
    if (patient?.bedId) beds.add(patient.bedId);
  }
  for (const grant of Array.isArray(grants) ? grants : []) {
    if (grant.unitId) units.add(grant.unitId);
    if (grant.bedId) beds.add(grant.bedId);
  }
  const order = (a, b) => a.localeCompare(b, "en");
  return { units: [...units].sort(order), beds: [...beds].sort(order) };
}

/**
 * `scope` is `rules.scopeFromApi(GET /scope/{id})`; `mayAssign` is `canAssignScope(myScope)` —
 * true, false, or null while the caller's own scope is still unknown. `save(grants)` sends
 * `PUT /scope/{id}` with the WHOLE list and resolves with the scope the server answered.
 */
export function ScopeEditor({ user, scope, mayAssign, save, onSaved, onRefused, onClose }) {
  const { t } = useI18n();
  const board = useBoard();
  const [grants, setGrants] = useState(() => scope.grants.map((g) => asGrant(g.unitId, g.bedId)));
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [reverted, setReverted] = useState(false);
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const kind = scopeKind(scope);

  const offered = useMemo(() => offeredKeys(board.patients, grants), [board.patients, grants]);
  const has = (grant) => grants.some((g) => sameGrant(g, grant));
  const known = boardKnown(board.connection);

  const toggle = (grant, on) => {
    setReverted(false);
    setGrants((was) => (on ? [...was, grant] : was.filter((g) => !sameGrant(g, grant))));
  };

  const addManual = () => {
    const key = manual.trim();
    if (!key) return;
    const grant = asGrant(key, "");
    if (!has(grant)) toggle(grant, true);
    setManual("");
  };

  async function onSave() {
    if (busy) return;
    const previous = grants;
    setBusy(true);
    setReverted(false);
    try {
      await save(previous.map((g) => (g.bedId ? { bed_id: g.bedId } : { unit_id: g.unitId })));
      if (mounted.current) onSaved();
    } catch (err) {
      if (!mounted.current) return;
      // Back to what the server last told us, and said out loud: a list left on screen that the
      // engine refused is a list an administrator would read as the user's access.
      setGrants(scope.grants.map((g) => asGrant(g.unitId, g.bedId)));
      setReverted(true);
      onRefused(err);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const title = t("admin.scopeTitle", { name: user.fullName || user.username });

  // Unrestricted BY ROLE, and only that: there is nothing to assign, and the reason is the whole
  // answer. An account unrestricted only because nothing is assigned yet is NOT this case.
  if (kind === "role") {
    return (
      <Modal open title={title} onClose={onClose} actions={<Button onClick={onClose}>{t("admin.cancel")}</Button>}>
        <Note tone="info" icon="shield">
          {t("admin.scopeUnrestricted", { reason: t("admin.scopeReasonRole") })}
        </Note>
      </Modal>
    );
  }

  const choices = (label, items, make) => (
    <fieldset className="mb-3 border-0 p-0">
      <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{label}</legend>
      {items.length === 0 ? null : items.map((key) => {
        const grant = make(key);
        return (
          <label key={key} className="flex items-center gap-2 py-0.5 font-text text-13.5">
            <input type="checkbox" checked={has(grant)} disabled={busy} onChange={(e) => toggle(grant, e.target.checked)} />
            <span className="font-data">{key}</span>
          </label>
        );
      })}
    </fieldset>
  );

  return (
    <Modal
      open
      title={title}
      busy={busy}
      onClose={onClose}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("admin.cancel")}</Button>
          {mayAssign === true
            ? <Button variant="primary" busy={busy} onClick={onSave}>{t("admin.scopeSave")}</Button>
            : null}
        </>
      )}
    >
      {mayAssign === false ? <Note tone="warn" icon="shield">{t("errors.scopeAdminOnly")}</Note> : null}
      {mayAssign === null ? <Note tone="warn" icon="shield">{t("admin.scopeMayUnknown")}</Note> : null}
      {kind === "unassigned" ? <Note tone="info" icon="shield">{t(unassignedNoteKey(scope))}</Note> : null}

      {/* Where the list comes from, and what is not in it. Not optional: an administrator who
          cannot find an empty unit in a list that looks complete concludes it does not exist. */}
      <p className="m-0 mb-2 text-12.5 text-mute">{t("admin.scopeFromBoard")}</p>
      {known ? null : <Note tone="warn" icon="plug">{t("admin.scopeBoardUnknown")}</Note>}

      {offered.units.length === 0 && offered.beds.length === 0
        ? <p className="m-0 mb-2 text-12.5 text-mute">{t("admin.scopeNoKeys")}</p>
        : (
          <>
            {choices(t("admin.scopeUnits"), offered.units, (key) => asGrant(key, ""))}
            {choices(t("admin.scopeBeds"), offered.beds, (key) => asGrant("", key))}
          </>
        )}

      <Field layout="col" label={t("admin.scopeManual")} hint={t("admin.scopeManualHint")}>
        <Input
          value={manual}
          disabled={busy}
          // The column's own limit: `ScopeGrantIn` states none, and a longer key is a database
          // error rather than a refusal anyone can read (`limits.FIELD_MAX.scope_key`).
          maxLength={FIELD_MAX.scope_key}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
        />
      </Field>
      <Button icon="plus" busy={busy} onClick={addManual}>{t("admin.scopeAdd")}</Button>

      <Table caption={t("admin.scopeTitle", { name: user.username })} className="mt-3">
        <thead>
          <tr>
            <th scope="col">{t("admin.scopeUnits")}</th>
            <th scope="col">{t("admin.scopeBeds")}</th>
            <th scope="col">{t("admin.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {grants.length === 0 ? (
            <tr><td colSpan={3}>{t("admin.scopeEmpty")}</td></tr>
          ) : grants.map((grant) => (
            <tr key={keyOf(grant)}>
              <th scope="row" className="font-data">{grant.unitId || "—"}</th>
              <td className="font-data">{grant.bedId || "—"}</td>
              <td>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  busy={busy}
                  label={`${t("admin.remove")}: ${grant.unitId || grant.bedId}`}
                  onClick={() => toggle(grant, false)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* A `Note`, not an `Alert`: the refusal itself is already announced once, on the toast, and
          `Alert` tone `crit` is a `role="alert"` of its own — the two together would read one
          refusal twice. This sentence is the VISIBLE explanation of why the list changed back
          under the reader's hands, which is a thing to see rather than a second thing to hear. */}
      {reverted ? <Note tone="warn" icon="swap" className="mt-3">{t("admin.scopeRevert")}</Note> : null}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
      <Announce text={busy ? t("admin.saving") : ""} />
    </Modal>
  );
}
