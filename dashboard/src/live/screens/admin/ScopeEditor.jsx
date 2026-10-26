// src/live/screens/admin/ScopeEditor.jsx — which units and beds one member of staff may see
// (G1-12; `PUT /scope/{user_id}`).
//
// THERE IS STILL NO ENDPOINT THAT LISTS THE KEYS A SCOPE MAY NAME — but since G2-B1a there is one
// that NAMES them: `GET /tenant/structure`, which `users.manage` opens for exactly this (X52) and
// the shell reads once (data/StructureProvider.jsx). Since B1a a scope's keys are the tenant's
// database UUIDs (spec D9) and no screen shows one: every key is shown by its unit's or bed's name
// from that tree, in the order of the names. The structure may not be known yet (still being read,
// or unreadable, then retried): the keys are then numbered placeholders ("Şöbə 1") under a warning
// that says so — never «unknown», which would read as a grant to nothing. A key the tree does not
// hold, once it is known, is «unknown unit» / «unknown bed» (a caller without `structure.manage`
// is sent only her own units, so the others read so); a key typed by hand — an old free-text grant from the
// site's `bed-mapping.json` (`BED_MAPPING_PATH`, `tenant/bedmap.py` `BedRef.unit_id` / `bed_id`)
// survives as typed and is shown as typed. The keys themselves still come from three sources, and
// the editor says in one line which they are:
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
// EVERY SAVE SAYS WHAT IT READ (`expected_grants`). A replacement built from an out-of-date read
// silently revoked whatever another administrator had granted since; so the body also carries the
// grants this editor last had from the engine (`base` — the opening read, or the read-back after a
// save with no answer), and the server compares them, as a set, with what it holds and refuses a
// mismatch, 409 `concurrentChange`, writing nothing (the third whole-set write's compare-and-swap,
// as the roles and the account form have theirs). Saving again from here would be refused again —
// the expectation is still the old read — so a 409 CLOSES the editor, as the account form closes:
// the toast says the account changed since this window read it — at another desk, or by an
// earlier save of hers that got no answer (both are possible, so it names both) — the row's scope and the
// frame's counter are read again, and reopened, the editor reads the scope as it is.
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
//
// A WRITE WITH NO ANSWER IS NOT A REFUSAL. A save that timed out, or met a server that could not
// answer, may have landed. Putting the previous list back and saying "the engine refused" would
// show the old list as her access when the new one may be in force — the same over-claim the
// rollback exists to prevent, the other way round. So that case is not rolled back: the scope is
// READ BACK, the list becomes what the engine holds, and the screen says the save may or may not
// have landed (`mayHaveLanded`, the one copy all three tabs read: `refusal.js`).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiErrorKey } from "../../apiErrors.js";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { Announce, Button, Field, Input, Modal, Note, Table } from "../../ui/index.js";
import { boardKnown } from "../common/BoardState.jsx";
import { FIELD_MAX } from "./limits.js";
import { mayHaveLanded } from "./refusal.js";
import { scopeKind } from "./rules.js";
import { useBedNames, useStructure, useUnitNames } from "../../data/StructureProvider.jsx"; // G2-B1a

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
/** Grants as `PUT /scope/{id}` takes them (`ScopeGrantIn`): one key each, the other left out. */
const asBody = (list) => list.map((g) => (g.bedId ? { bed_id: g.bedId } : { unit_id: g.unitId }));

/** The unit and bed keys this board can offer, plus the ones the user already holds. Sorted by key
 *  — a stable base order, the one a placeholder is numbered in while the structure is not known
 *  (data/structure.js) — with duplicates removed; a card the bed table did not place carries
 *  neither and contributes nothing. The editor SHOWS them in the order of their names. */
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

/** What the editor says about its last save, when it says anything: refused and put back, or no
 *  answer — read back, or not even that. */
const OUTCOME_NOTE = {
  reverted: "admin.scopeRevert",
  maybe: "admin.scopeMaybe",
  maybeRead: "admin.scopeMaybeRead",
};

/**
 * `scope` is `rules.scopeFromApi(GET /scope/{id})`; `mayAssign` is `canAssignScope(myScope)` —
 * true, false, or null while the caller's own scope is still unknown. `save(grants, expected)`
 * sends `PUT /scope/{id}` with the WHOLE list and, as `expected_grants`, the grants this editor
 * last read, and resolves with the scope the server answered. `reread()` reads this user's scope
 * again and resolves with it (adapted), or with null when that read failed — asked after a save
 * that got no answer, and after one refused as changed elsewhere.
 */
export function ScopeEditor({ user, scope, mayAssign, save, reread, onSaved, onRefused, onClose }) {
  const { t } = useI18n();
  const { store } = useSession();
  const board = useBoard();
  /** What the engine last told this editor: the opening read, or the read-back after a save that
   *  got no answer. A refusal puts THIS back — never an older list. */
  const [base, setBase] = useState(scope);
  const [grants, setGrants] = useState(() => scope.grants.map((g) => asGrant(g.unitId, g.bedId)));
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  /** null, or a key of `OUTCOME_NOTE`. */
  const [outcome, setOutcome] = useState(null);
  // True inside the effect (the house pattern), so StrictMode's rehearsal does not leave it false.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const kind = scopeKind(base);
  const keys = useMemo(() => offeredKeys(board.patients, grants), [board.patients, grants]);
  // G2-B1a: a key by its name from the structure — since B1a the keys are the tenant's UUIDs, and
  // no screen shows one (spec D9). A key someone typed by hand is no UUID and is shown as typed.
  // Until the structure is known a key is a numbered placeholder under a warning, never «unknown».
  const { known: namesKnown } = useStructure();
  const unitNames = useUnitNames(keys.units);
  const bedNames = useBedNames(keys.beds);
  const unitName = unitNames.nameOf;
  const bedName = bedNames.nameOf;
  const offered = useMemo(() => ({ units: unitNames.sorted, beds: bedNames.sorted }), [unitNames, bedNames]);
  const has = (grant) => grants.some((g) => sameGrant(g, grant));
  const known = boardKnown(board.connection);

  const toggle = (grant, on) => {
    setOutcome(null);
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
    setOutcome(null);
    // The session this save belongs to: after it ends, nothing is re-read and nothing is said —
    // a read-back would go out under whoever's token is stored by then.
    const epoch = store.epoch();
    const ours = () => store.epoch() === epoch;
    try {
      // What the engine last told this editor, as the server's expectation: the opening read, or
      // the read-back after a save with no answer (`base` moves with it).
      await save(asBody(previous), asBody(base.grants));
      if (mounted.current && ours()) onSaved();
    } catch (err) {
      if (!ours()) return;
      const stale = apiErrorKey(err)?.key === "errors.concurrentChange";
      // The toast first, whether or not this editor is still on screen: the toast outlives it,
      // and a refusal that waited for a mounted editor was a refusal nobody read.
      onRefused(stale ? t("admin.changedElsewhere") : err);
      if (!mounted.current) return;
      if (stale) {
        // Another desk changed this scope since it was read, and nothing was written. Saving
        // again from here would be refused again, so the editor closes (as the account form
        // does) and what the save was about is read again — the row's scope and the counter.
        onClose();
        await reread();
        return;
      }
      if (mayHaveLanded(err)) {
        // No answer: the new list may be in force. Not rolled back — read back, and said so.
        setOutcome("maybe");
        const fresh = await reread();
        if (mounted.current && ours() && fresh) {
          setBase(fresh);
          setGrants(fresh.grants.map((g) => asGrant(g.unitId, g.bedId)));
          setOutcome("maybeRead");
        }
      } else {
        // Back to what the server last told us, and said out loud: a list left on screen that the
        // engine refused is a list an administrator would read as the user's access.
        setGrants(base.grants.map((g) => asGrant(g.unitId, g.bedId)));
        setOutcome("reverted");
      }
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

  const choices = (label, items, make, nameOf) => (
    <fieldset className="mb-3 border-0 p-0">
      <legend className="mb-1 font-text text-13.5 font-semibold text-mute">{label}</legend>
      {items.length === 0 ? null : items.map((key) => {
        const grant = make(key);
        return (
          <label key={key} className="flex items-center gap-2 py-0.5 font-text text-13.5">
            <input type="checkbox" checked={has(grant)} disabled={busy} onChange={(e) => toggle(grant, e.target.checked)} />
            <span>{nameOf(key)}</span>
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
      {kind === "unassigned" ? <Note tone="info" icon="shield">{t(unassignedNoteKey(base))}</Note> : null}

      {/* Where the list comes from, and what is not in it. Not optional: an administrator who
          cannot find an empty unit in a list that looks complete concludes it does not exist. */}
      <p className="m-0 mb-2 text-12.5 text-mute">{t("admin.scopeFromBoard")}</p>
      {known ? null : <Note tone="warn" icon="plug">{t("admin.scopeBoardUnknown")}</Note>}
      {/* G2-B1a: until the structure is read the names below are numbers — say so, once. */}
      {namesKnown ? null : <Note tone="warn" icon="plug">{t("kabul.namesPending")}</Note>}

      {offered.units.length === 0 && offered.beds.length === 0
        ? <p className="m-0 mb-2 text-12.5 text-mute">{t("admin.scopeNoKeys")}</p>
        : (
          <>
            {choices(t("admin.scopeUnits"), offered.units, (key) => asGrant(key, ""), unitName)}
            {choices(t("admin.scopeBeds"), offered.beds, (key) => asGrant("", key), bedName)}
          </>
        )}

      <Field layout="col" label={t("admin.scopeManual")} hint={t("admin.scopeManualHint")}>
        <Input
          value={manual}
          // Read-only, not disabled, while the save is out: a disabled field drops the focus it has
          // to <body>, which is where a keyboard user who pressed Enter in it would be left.
          readOnly={busy}
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
              <th scope="row">{grant.unitId ? unitName(grant.unitId) : "—"}</th>
              <td>{grant.bedId ? bedName(grant.bedId) : "—"}</td>
              <td>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  busy={busy}
                  label={`${t("admin.remove")}: ${grant.unitId ? unitName(grant.unitId) : bedName(grant.bedId)}`}
                  onClick={() => toggle(grant, false)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* A `Note`, not an `Alert`: the refusal itself is already announced once, on the toast, and
          `Alert` tone `crit` is a `role="alert"` of its own — the two together would read one
          refusal twice. This sentence is the VISIBLE explanation of why the list changed (back,
          or to what the engine holds) under the reader's hands, which is a thing to see rather
          than a second thing to hear. */}
      {outcome ? <Note tone="warn" icon="swap" className="mt-3">{t(OUTCOME_NOTE[outcome])}</Note> : null}
      {/* A busy Button reads only "unavailable" to a screen reader; the words come from here — and
          from HERE, inside the dialog: everything outside an open dialog is inert, and an inert
          live region is dropped from the accessibility tree, so the tab's own region cannot say it. */}
      <Announce text={busy ? t("admin.savingFor", { subject: user.username }) : ""} />
    </Modal>
  );
}
