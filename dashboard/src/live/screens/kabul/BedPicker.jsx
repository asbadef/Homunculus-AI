// src/live/screens/kabul/BedPicker.jsx — unit → room → bed, from the caller's structure (G2-B1a,
// spec §5.2). Only an open, AVAILABLE bed can be chosen; every other bed is shown dimmed WITH its
// reason (occupied, cleaning, closed…), so a nurse looking for a bed sees why one is not offered.
// A choice is a pressed button (aria-pressed); the beds of a room are one group with the room's
// name. Nothing here decides anything the server does not check again (admission/router.py).
//
// Before the first answer there is nothing to say about the scope: the picker says the beds are
// being read, or that the read failed (with a retry) — "no unit in your scope" is a thing only an
// answer can say.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Button, Tag } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { admissible, unavailableKey } from "../../data/structure.js";

/** A bed as the structure gives it, with whether it, its room and its unit are all open. */
const withOpen = (unit, room, bed) => ({
  ...bed, open: unit.is_active !== false && room.is_active !== false && bed.is_active !== false,
});

/** The beds of a unit an admission can take: open (bed, room and unit) and AVAILABLE. */
const freeBeds = (unit) => (unit.rooms ?? []).flatMap((room) =>
  (room.beds ?? []).filter((bed) => admissible(withOpen(unit, room, bed))));

/** `structure`: GET /tenant/structure's answer, null until the first; `phase` / `error`: the
 *  provider's (StructureProvider.jsx) — with no answer yet, "failed" says so and offers `onRetry`,
 *  anything else says the beds are being read. `unitId` / `bedId`: the choice; `onUnit(id)`,
 *  `onBed({id, unitId, label})` report a new one — `label` is "bed · room · unit", the words the
 *  screen names the admission by (choosing a unit clears the bed). `focusId` goes on the control
 *  a "the bed is missing" press focuses: the first bed the chosen unit can give, else that unit,
 *  else the first unit. */
export function BedPicker({ structure, phase, error, onRetry, unitId, bedId, onUnit, onBed, invalid = false, focusId }) {
  const { t } = useI18n();
  if (!structure) {
    if (phase === "failed") {
      return (
        <div className="grid justify-items-start gap-2">
          <Alert tone="crit">{t("kabul.listFailed", { reason: readErrorText(t, error) })}</Alert>
          <Button id={focusId} size="sm" onClick={() => onRetry?.()}>{t("admin.retry")}</Button>
        </div>
      );
    }
    return <p id={focusId} tabIndex={-1} role="status" className="m-0 text-13 text-mute">{t("kabul.loading")}</p>;
  }
  const units = (structure.sites ?? []).flatMap((site) => site.units ?? []);
  if (units.length === 0) {
    return <p id={focusId} tabIndex={-1} className="m-0 text-13 text-mute">{t("kabul.pickerNone")}</p>;
  }
  const unit = units.find((u) => u.id === unitId) ?? null;
  const firstFree = unit ? freeBeds(unit)[0]?.id ?? null : null;
  const unitFocus = firstFree ? null : (unit ?? units[0]).id;
  return (
    <div className={`grid gap-3 ${invalid ? "rounded-ctl ring-2 ring-crit ring-offset-2 ring-offset-card" : ""}`}>
      <div role="group" aria-label={t("kabul.pickUnit")} className="flex flex-wrap gap-2">
        {units.map((u) => {
          const open = u.is_active !== false;
          return (
            <button key={u.id} id={u.id === unitFocus ? focusId : undefined} type="button" aria-pressed={u.id === unitId}
              onClick={() => onUnit(u.id)}
              className={`rounded-ctl border px-3 py-1.5 text-13 font-semibold ${u.id === unitId ? "border-pri bg-pri-soft text-ink" : "border-line2 bg-card text-ink"} ${open ? "" : "opacity-60"} ${FOCUS_RING}`}>
              {u.name}
              <span className="ml-1.5 text-11.5 font-normal text-mute">
                {open ? t("kabul.freeBeds", { count: freeBeds(u).length }) : t("kabul.unitClosed")}
              </span>
            </button>
          );
        })}
      </div>
      {unit ? (
        <div className="grid gap-2.5">
          {(unit.rooms ?? []).map((room) => (
            <div key={room.id} role="group" aria-label={room.name}>
              <p className="m-0 mb-1 text-12 font-semibold text-mute">
                {room.name}{room.is_active === false ? ` · ${t("kabul.roomClosed")}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {(room.beds ?? []).map((b) => {
                  const why = unavailableKey(withOpen(unit, room, b));
                  const chosen = b.id === bedId;
                  return (
                    <button key={b.id} id={b.id === firstFree ? focusId : undefined} type="button" aria-pressed={chosen}
                      aria-disabled={why ? "true" : undefined}
                      aria-label={why ? `${b.label} · ${t(why)}` : b.label}
                      onClick={() => {
                        if (!why) onBed({ id: b.id, unitId: unit.id, label: `${b.label} · ${room.name} · ${unit.name}` });
                      }}
                      className={`grid min-w-[72px] place-items-center rounded-ctl border px-2.5 py-2 text-13 ${chosen ? "border-pri bg-pri text-onpri" : "border-line2 bg-card text-ink"} ${why ? "cursor-not-allowed opacity-55" : ""} ${FOCUS_RING}`}>
                      <b className="font-data text-15">{b.label}</b>
                      {why ? <span aria-hidden="true" className="text-10.5">{t(why)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="m-0 text-12 text-mute">
            {bedId ? <Tag tone="neutral" icon="bed">{t("kabul.bedChosen", { bed: labelOf(unit, bedId) })}</Tag> : t("kabul.pickHint")}
          </p>
        </div>
      ) : (
        <p className="m-0 text-12.5 text-mute">{t("kabul.pickUnitFirst")}</p>
      )}
    </div>
  );
}

function labelOf(unit, bedId) {
  for (const room of unit.rooms ?? []) {
    const bed = (room.beds ?? []).find((b) => b.id === bedId);
    if (bed) return `${bed.label} · ${room.name} · ${unit.name}`;
  }
  return "";
}
