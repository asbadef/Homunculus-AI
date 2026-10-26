// src/live/screens/admin/StructureTab.jsx — Yönetim › Yapı (Group 2 · B1a, spec D10, §3.5, §5.6):
// the administrator builds the ward — sites, units of a type, rooms with their number and whether
// they isolate, beds — and renames, closes and reopens them. Nothing is deleted: a closed unit,
// room or bed stays, marked closed, and is offered to no admission. A bed holding a patient cannot
// be closed, nor a unit or room with an open bed under it — the server refuses (`bed_in_use`,
// `has_open_beds`, tenant/router.py) and the refusal goes on the toast, named after what it was
// about. `structure.manage`.
//
// It reads the shell's structure (data/StructureProvider.jsx) and reads it again after every write
// — and frees the buttons only once that read has answered, so none is pressed on the tree from
// before the write.
//
// EVERY CONTROL NAMES WHAT IT ACTS ON: "<action>: <subject>" — a unit or a room by its name, a bed
// as the header's rule names it, "label · room · unit" — and the toast names the same subject. A
// tab of forty buttons that all read "Close" tells a screen-reader user nothing.
//
// NOTHING HELD IS A SILENT NO-OP. One write is out at a time (a second submit in the same tick
// included): while it is, every other write is `aria-disabled` and points at the sentence naming
// what is being saved. A blank name is held with its reason (`kabul.invalid.name` / `.label`),
// which the button carries from the start and the box shows once she tries. A rename that keeps the
// name closes its editor and sends nothing.
import React, { useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { apiErrorKey, readErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Input, Select, Tag, useToast } from "../../ui/index.js";
import { BED_STATE_KEYS, isUuid } from "../../data/structure.js";
import { doneFor, refusedFor } from "./refusal.js";

const UNIT_TYPES = Object.freeze([
  { value: "ADULT_ICU", key: "kabul.unitType.adultIcu" }, { value: "NICU", key: "kabul.unitType.nicu" },
  { value: "PICU", key: "kabul.unitType.picu" }, { value: "CVICU", key: "kabul.unitType.cvicu" },
  { value: "BMT_ICU", key: "kabul.unitType.bmtIcu" },
]);
const UNIT_TYPE_KEYS = Object.freeze(Object.fromEntries(UNIT_TYPES.map((o) => [o.value, o.key])));

/** What each box takes: the columns of tenant/models.py (a site's and a unit's name 200, a room's
 *  100, a bed's label 50, a room's number 20). */
const MAX = Object.freeze({ site: 200, unit: 200, room: 100, bed: 50, roomNumber: 20 });

/** A refused write's reason, for `refusedFor`. A 404 the server did not code and whose words no map
 *  knows ("Room not found", tenant/router.py — a place gone from under the screen) is said by its
 *  status in the reader's language, never in the server's English (amendment A-9); every other
 *  failure as refusal.js says it. */
function reasonOf(t, err) {
  return err?.status === 404 && !apiErrorKey(err) ? t("errors.requestFailed", { status: 404 }) : err;
}

/** One text box and its button: add a child, or rename this node. The button's name is
 *  "<button>: <subject>". It is held — `aria-disabled`, pointing at why — while another write is
 *  out (`held`: the id of the sentence that says so) and while the box is blank (`blankKey`). */
function Line({ label, initial = "", subject, submitKey, blankKey, maxLength, onSubmit, busy, held, autoFocus, children }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [tried, setTried] = useState(false);
  const blankId = useId();
  const blank = !value.trim();
  const reason = busy ? undefined : held ?? (blank ? blankId : undefined);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
      event.preventDefault();
      if (busy || held) return;
      if (blank) {
        setTried(true);
        return;
      }
      if (await onSubmit(value.trim())) setValue(initial);
    }}>
      <Input aria-label={label} value={value} readOnly={busy} maxLength={maxLength} autoFocus={autoFocus}
        aria-invalid={tried && blank ? "true" : undefined} aria-describedby={tried && blank ? blankId : undefined}
        onChange={(e) => { setValue(e.target.value); setTried(false); }}
        className="!w-auto min-w-[160px] flex-1" />
      {children}
      <Button type="submit" size="sm" busy={busy} aria-label={subject ? `${t(submitKey)}: ${subject}` : undefined}
        aria-disabled={reason ? "true" : undefined} aria-describedby={reason}>{t(submitKey)}</Button>
      {blank ? (
        <p id={blankId} className={tried ? "m-0 basis-full text-12 font-semibold text-crit-ink" : "sr-only"}>{t(blankKey)}</p>
      ) : null}
    </form>
  );
}

/** "Add a unit" under a site, of the type chosen beside it — each site keeps its own choice. */
function UnitAdd({ site, busy, held, onAdd }) {
  const { t } = useI18n();
  const [unitType, setUnitType] = useState("ADULT_ICU");
  return (
    <Line label={t("kabul.newUnit", { site: site.name })} subject={site.name} submitKey="kabul.addUnit"
      blankKey="kabul.invalid.name" maxLength={MAX.unit} busy={busy} held={held}
      onSubmit={(name) => onAdd({ name, unit_type: unitType })}>
      <Select aria-label={`${t("kabul.unitTypeLabel")}: ${site.name}`} value={unitType}
        onChange={(e) => setUnitType(e.target.value)} className="!w-auto">
        {UNIT_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
      </Select>
    </Line>
  );
}

/** "Add a room" under a unit: its name, its number when it has one, and whether it isolates. */
function RoomAdd({ unit, busy, held, onAdd }) {
  const { t } = useI18n();
  const [number, setNumber] = useState("");
  const [isolation, setIsolation] = useState(false);
  return (
    <Line label={t("kabul.newRoom", { unit: unit.name })} subject={unit.name} submitKey="kabul.addRoom"
      blankKey="kabul.invalid.name" maxLength={MAX.room} busy={busy} held={held}
      onSubmit={async (name) => {
        const ok = await onAdd({ name, room_number: number.trim() || null, is_isolation: isolation });
        if (ok) {
          setNumber("");
          setIsolation(false);
        }
        return ok;
      }}>
      <Input aria-label={t("kabul.newRoomNumber", { unit: unit.name })} placeholder={t("kabul.roomNumber")}
        value={number} readOnly={busy} maxLength={MAX.roomNumber} onChange={(e) => setNumber(e.target.value)}
        className="!w-[120px]" />
      <label className="inline-flex items-center gap-1.5 text-13">
        <input type="checkbox" checked={isolation} aria-label={t("kabul.newRoomIsolation", { unit: unit.name })}
          onChange={(e) => setIsolation(e.target.checked)} />
        {t("kabul.isolation")}
      </label>
    </Line>
  );
}

/** A unit, a room or a bed: its name and what is known of it (`tags`), closed or not, and its
 *  actions, each named after `subject`. A rename hands the focus back to its own button. */
function Node({ kind, item, name, subject, tags, maxLength, busy, held, onRename, onToggle, children }) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const toggleRef = useRef(null);
  const closed = item.is_active === false;
  const toggleKey = closed ? "kabul.reopen" : "kabul.close";
  const closeEditor = () => {
    setRenaming(false);
    toggleRef.current?.focus();
  };
  return (
    <li className="grid gap-1.5 rounded-ctl border border-line bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <b className={kind === "bed" ? "font-data" : ""}>{name}</b>
        {closed ? <Tag>{t("kabul.closed")}</Tag> : null}
        {tags}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button ref={toggleRef} size="sm" variant="ghost" icon="edit" aria-expanded={renaming ? "true" : "false"}
            aria-label={`${t("kabul.rename")}: ${subject}`} onClick={() => setRenaming((on) => !on)}>{t("kabul.rename")}</Button>
          <Button size="sm" busy={busy} aria-label={`${t(toggleKey)}: ${subject}`}
            aria-disabled={held ? "true" : undefined} aria-describedby={held}
            onClick={held ? () => {} : onToggle}>{t(toggleKey)}</Button>
        </span>
      </div>
      {renaming ? (
        <Line label={t("kabul.renameOf", { name: subject })} initial={name} subject={subject} submitKey="common.save"
          blankKey={kind === "bed" ? "kabul.invalid.label" : "kabul.invalid.name"} maxLength={maxLength}
          busy={busy} held={held} autoFocus
          onSubmit={async (value) => {
            if (value === String(name ?? "").trim()) {      // the same name: nothing to send
              closeEditor();
              return true;
            }
            const ok = await onRename(value);
            if (ok) closeEditor();
            return ok;
          }} />
      ) : null}
      {children}
    </li>
  );
}

export function StructureTab() {
  const { t } = useI18n();
  const { store, user } = useSession();
  const { structure, phase, error, reload } = useStructure();
  const toast = useToast();
  const [busy, setBusy] = useState(null);          // {id, subject} of the write that is out
  const flight = useRef(null);                     // the same, read synchronously: two submits in one tick
  const heldId = useId();
  const api = store.api;
  // The add-site button's subject: the hospital, by name — never an id.
  const hospital = [user?.tenantName, user?.tenant].find((x) => x && !isUuid(x)) ?? "";

  /** One write: its subject for the toast, the call, what to say when it lands. True if it did. */
  async function write(id, subject, call, doneKey) {
    if (flight.current) return false;
    flight.current = id;
    setBusy({ id, subject });
    try {
      await store.track(call);
      toast(doneFor(t, subject, t(doneKey)));
      return true;
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      return false;
    } finally {
      await reload();
      flight.current = null;
      setBusy(null);
    }
  }
  const toggle = (item, patch, subject) => write(item.id, subject, () => patch(item.id, { is_active: item.is_active === false }),
    item.is_active === false ? "kabul.reopened" : "kabul.closedDone");
  /** This line's write is the one out. */
  const isBusy = (id) => busy?.id === id;
  /** Another line's write is out: the id of the sentence that says which, else undefined. */
  const holdFor = (id) => (busy && busy.id !== id ? heldId : undefined);
  const saying = busy ? t("admin.savingFor", { subject: busy.subject }) : "";

  if (structure === null) {
    return error ? <Alert tone="crit">{t("kabul.listFailed", { reason: readErrorText(t, error) })}</Alert>
      : <p className="m-0 text-13 text-mute">{t(phase === "unasked" ? "kabul.noView" : "kabul.loading")}</p>;
  }
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t("kabul.listStale", { reason: readErrorText(t, error) })}</Alert> : null}
      <p className="m-0 text-13 text-mute">{t("kabul.structureIntro")}</p>
      {busy ? <p id={heldId} className="m-0 text-12 font-semibold text-mute">{saying}</p> : null}
      <Announce text={saying} />
      <Line label={t("kabul.newSite")} subject={hospital} submitKey="kabul.addSite" blankKey="kabul.invalid.name"
        maxLength={MAX.site} busy={isBusy("site")} held={holdFor("site")}
        onSubmit={(name) => write("site", name, () => api.createSite(structure.tenant_id, { name }), "kabul.added")} />
      {(structure.sites ?? []).map((site) => (
        <Box key={site.id} title={site.name} icon="building" level={2}>
          <UnitAdd site={site} busy={isBusy(site.id)} held={holdFor(site.id)}
            onAdd={(body) => write(site.id, body.name, () => api.createUnit(site.id, body), "kabul.added")} />
          <ul className="m-0 mt-2 grid list-none gap-2 p-0">
            {(site.units ?? []).map((unit) => (
              <Node key={unit.id} kind="unit" item={unit} name={unit.name} subject={unit.name} maxLength={MAX.unit}
                tags={UNIT_TYPE_KEYS[unit.unit_type] ? <Tag>{t(UNIT_TYPE_KEYS[unit.unit_type])}</Tag> : null}
                busy={isBusy(unit.id)} held={holdFor(unit.id)}
                onRename={(name) => write(unit.id, unit.name, () => api.patchUnit(unit.id, { name }), "kabul.renamed")}
                onToggle={() => toggle(unit, api.patchUnit, unit.name)}>
                <RoomAdd unit={unit} busy={isBusy(`${unit.id}+`)} held={holdFor(`${unit.id}+`)}
                  onAdd={(body) => write(`${unit.id}+`, body.name, () => api.createRoom(unit.id, body), "kabul.added")} />
                <ul className="m-0 grid list-none gap-2 p-0 ps-4">
                  {(unit.rooms ?? []).map((room) => {
                    // A bed as the header's rule names it, on the toast and on every control.
                    const bedName = (label) => `${label} · ${room.name} · ${unit.name}`;
                    return (
                      <Node key={room.id} kind="room" item={room} name={room.name} subject={room.name} maxLength={MAX.room}
                        tags={(
                          <>
                            {room.room_number ? <Tag>{t("kabul.roomNumberIs", { number: room.room_number })}</Tag> : null}
                            {room.is_isolation ? <Tag>{t("kabul.isolation")}</Tag> : null}
                          </>
                        )}
                        busy={isBusy(room.id)} held={holdFor(room.id)}
                        onRename={(name) => write(room.id, room.name, () => api.patchRoom(room.id, { name }), "kabul.renamed")}
                        onToggle={() => toggle(room, api.patchRoom, room.name)}>
                        <Line label={t("kabul.newBed", { room: room.name })} subject={room.name} submitKey="kabul.addBed"
                          blankKey="kabul.invalid.label" maxLength={MAX.bed}
                          busy={isBusy(`${room.id}+`)} held={holdFor(`${room.id}+`)}
                          onSubmit={(label) => write(`${room.id}+`, bedName(label), () => api.createBed(room.id, { label }), "kabul.added")} />
                        <ul className="m-0 grid list-none gap-1.5 p-0 ps-4">
                          {(room.beds ?? []).map((bed) => (
                            <Node key={bed.id} kind="bed" item={bed} name={bed.label} subject={bedName(bed.label)} maxLength={MAX.bed}
                              tags={bed.state ? <Tag>{t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther")}</Tag> : null}
                              busy={isBusy(bed.id)} held={holdFor(bed.id)}
                              onRename={(label) => write(bed.id, bedName(bed.label), () => api.patchBed(bed.id, { label }), "kabul.renamed")}
                              onToggle={() => toggle(bed, api.patchBed, bedName(bed.label))} />
                          ))}
                        </ul>
                      </Node>
                    );
                  })}
                </ul>
              </Node>
            ))}
          </ul>
        </Box>
      ))}
    </div>
  );
}
