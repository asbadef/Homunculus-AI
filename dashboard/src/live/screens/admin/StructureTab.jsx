// src/live/screens/admin/StructureTab.jsx — Yönetim › Yapı (Group 2 · B1a, spec D10, §3.5, §5.6):
// the administrator builds the ward — sites, units, rooms, beds — and renames, closes and reopens
// them. Nothing is deleted: a closed unit, room or bed stays, dimmed, and is offered to no
// admission. A bed holding a patient cannot be closed, nor a unit or room with an open bed under
// it — the server refuses (`bed_in_use`, `has_open_beds`, tenant/router.py) and the refusal goes on
// the toast, named after what it was about. `structure.manage`.
//
// It reads the shell's structure (data/StructureProvider.jsx) and reads it again after every
// write, so the tree on screen is the server's.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { apiErrorKey, readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Input, Select, Tag, useToast } from "../../ui/index.js";
import { BED_STATE_KEYS } from "../../data/structure.js";
import { doneFor, refusedFor } from "./refusal.js";

const UNIT_TYPES = Object.freeze([
  { value: "ADULT_ICU", key: "kabul.unitType.adultIcu" }, { value: "NICU", key: "kabul.unitType.nicu" },
  { value: "PICU", key: "kabul.unitType.picu" }, { value: "CVICU", key: "kabul.unitType.cvicu" },
  { value: "BMT_ICU", key: "kabul.unitType.bmtIcu" },
]);

/** A refused write's reason, for `refusedFor`. A 404 the server did not code and whose words no map
 *  knows ("Room not found", tenant/router.py — a place gone from under the screen) is said by its
 *  status in the reader's language, never in the server's English (amendment A-9); every other
 *  failure as refusal.js says it. */
function reasonOf(t, err) {
  return err?.status === 404 && !apiErrorKey(err) ? t("errors.requestFailed", { status: 404 }) : err;
}

/** One text box and its button: add a child, or rename this node. */
function Line({ label, initial = "", submitKey, onSubmit, busy, children }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!value.trim() || busy) return;
      if (await onSubmit(value.trim())) setValue(initial);
    }}>
      <Input aria-label={label} value={value} readOnly={busy} onChange={(e) => setValue(e.target.value)}
        className="!w-auto min-w-[160px] flex-1" />
      {children}
      <Button type="submit" size="sm" busy={busy}>{t(submitKey)}</Button>
    </form>
  );
}

/** A unit, a room or a bed: its name, closed or not, and its three actions. */
function Node({ kind, item, name, state, busy, onRename, onToggle, children }) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const closed = item.is_active === false;
  return (
    <li className="grid gap-1.5 rounded-ctl border border-line bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <b className={kind === "bed" ? "font-data" : ""}>{name}</b>
        {closed ? <Tag>{t("kabul.closed")}</Tag> : null}
        {state ? <Tag>{t(BED_STATE_KEYS[state] ?? "kabul.bedOther")}</Tag> : null}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setRenaming((on) => !on)}>{t("kabul.rename")}</Button>
          <Button size="sm" busy={busy} onClick={onToggle}>{t(closed ? "kabul.reopen" : "kabul.close")}</Button>
        </span>
      </div>
      {renaming ? (
        <Line label={t("kabul.renameOf", { name })} initial={name} submitKey="common.save" busy={busy}
          onSubmit={async (value) => { const ok = await onRename(value); if (ok) setRenaming(false); return ok; }} />
      ) : null}
      {children}
    </li>
  );
}

export function StructureTab() {
  const { t } = useI18n();
  const { store } = useSession();
  const { structure, phase, error, reload } = useStructure();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [unitType, setUnitType] = useState("ADULT_ICU");
  const api = store.api;

  /** One write: its subject for the toast, the call, what to say when it lands. True if it did. */
  async function write(id, subject, call, doneKey) {
    if (busy) return false;
    setBusy(id);
    try {
      await store.track(call);
      toast(doneFor(t, subject, t(doneKey)));
      return true;
    } catch (err) {
      toast(refusedFor(t, subject, reasonOf(t, err)), "error");
      return false;
    } finally {
      setBusy(null);
      reload();
    }
  }
  const toggle = (item, patch, name) => write(item.id, name, () => patch(item.id, { is_active: item.is_active === false }),
    item.is_active === false ? "kabul.reopened" : "kabul.closedDone");

  if (structure === null) {
    return error ? <Alert tone="crit">{t("kabul.listFailed", { reason: readErrorText(t, error) })}</Alert>
      : <p className="m-0 text-13 text-mute">{t(phase === "unasked" ? "kabul.noView" : "kabul.loading")}</p>;
  }
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t("kabul.listStale", { reason: readErrorText(t, error) })}</Alert> : null}
      <p className="m-0 text-13 text-mute">{t("kabul.structureIntro")}</p>
      <Line label={t("kabul.newSite")} submitKey="kabul.addSite" busy={busy === "site"}
        onSubmit={(name) => write("site", name, () => api.createSite(structure.tenant_id, { name }), "kabul.added")} />
      {(structure.sites ?? []).map((site) => (
        <Box key={site.id} title={site.name} icon="building" level={2}>
          <Line label={t("kabul.newUnit", { site: site.name })} submitKey="kabul.addUnit" busy={busy === site.id}
            onSubmit={(name) => write(site.id, name, () => api.createUnit(site.id, { name, unit_type: unitType }), "kabul.added")}>
            <Select aria-label={t("kabul.unitTypeLabel")} value={unitType} onChange={(e) => setUnitType(e.target.value)} className="!w-auto">
              {UNIT_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Line>
          <ul className="m-0 mt-2 grid list-none gap-2 p-0">
            {(site.units ?? []).map((unit) => (
              <Node key={unit.id} kind="unit" item={unit} name={unit.name} busy={busy === unit.id}
                onRename={(name) => write(unit.id, unit.name, () => api.patchUnit(unit.id, { name }), "kabul.renamed")}
                onToggle={() => toggle(unit, api.patchUnit, unit.name)}>
                <Line label={t("kabul.newRoom", { unit: unit.name })} submitKey="kabul.addRoom" busy={busy === `${unit.id}+`}
                  onSubmit={(name) => write(`${unit.id}+`, name, () => api.createRoom(unit.id, { name }), "kabul.added")} />
                <ul className="m-0 grid list-none gap-2 p-0 ps-4">
                  {(unit.rooms ?? []).map((room) => (
                    <Node key={room.id} kind="room" item={room} name={room.name} busy={busy === room.id}
                      onRename={(name) => write(room.id, room.name, () => api.patchRoom(room.id, { name }), "kabul.renamed")}
                      onToggle={() => toggle(room, api.patchRoom, room.name)}>
                      <Line label={t("kabul.newBed", { room: room.name })} submitKey="kabul.addBed" busy={busy === `${room.id}+`}
                        onSubmit={(label) => write(`${room.id}+`, label, () => api.createBed(room.id, { label }), "kabul.added")} />
                      <ul className="m-0 grid list-none gap-1.5 p-0 ps-4">
                        {(room.beds ?? []).map((bed) => (
                          <Node key={bed.id} kind="bed" item={bed} name={bed.label} state={bed.state} busy={busy === bed.id}
                            onRename={(label) => write(bed.id, bed.label, () => api.patchBed(bed.id, { label }), "kabul.renamed")}
                            onToggle={() => toggle(bed, api.patchBed, `${bed.label} · ${room.name}`)} />
                        ))}
                      </ul>
                    </Node>
                  ))}
                </ul>
              </Node>
            ))}
          </ul>
        </Box>
      ))}
    </div>
  );
}
