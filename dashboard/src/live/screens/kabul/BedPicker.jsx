// src/live/screens/kabul/BedPicker.jsx — unit → room → bed, from the caller's structure (G2-B1a,
// spec §5.2). Only an open, AVAILABLE bed can be chosen; every other bed is shown dimmed WITH its
// reason (occupied, cleaning, closed…), so a nurse looking for a bed sees why one is not offered.
// A choice is a pressed button (aria-pressed); the beds of a room are one group with the room's
// name. Nothing here decides anything the server does not check again (admission/router.py).
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Tag } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { admissible, unavailableKey } from "../../data/structure.js";

/** `structure`: GET /tenant/structure's answer; `unitId` / `bedId`: the choice; `onUnit(id)`,
 *  `onBed({id, unitId, label})` report a new one — `label` is "bed · room · unit", the words the
 *  screen names the admission by (choosing a unit clears the bed). */
export function BedPicker({ structure, unitId, bedId, onUnit, onBed, invalid = false }) {
  const { t } = useI18n();
  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  if (units.length === 0) return <p className="m-0 text-13 text-mute">{t("kabul.pickerNone")}</p>;
  const unit = units.find((u) => u.id === unitId) ?? null;
  return (
    <div className={`grid gap-3 ${invalid ? "rounded-ctl ring-2 ring-crit ring-offset-2 ring-offset-card" : ""}`}>
      <div role="group" aria-label={t("kabul.pickUnit")} className="flex flex-wrap gap-2">
        {units.map((u) => {
          const open = u.is_active !== false;
          const free = (u.rooms ?? []).flatMap((r) => r.beds ?? []).filter((b) =>
            admissible({ ...b, open: open && b.is_active !== false })).length;
          return (
            <button key={u.id} type="button" aria-pressed={u.id === unitId}
              onClick={() => onUnit(u.id)}
              className={`rounded-ctl border px-3 py-1.5 text-13 font-semibold ${u.id === unitId ? "border-pri bg-pri-soft text-ink" : "border-line2 bg-card text-ink"} ${open ? "" : "opacity-60"} ${FOCUS_RING}`}>
              {u.name}
              <span className="ml-1.5 text-11.5 font-normal text-mute">
                {open ? t("kabul.freeBeds", { count: free }) : t("kabul.unitClosed")}
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
                  const bed = { ...b, open: unit.is_active !== false && room.is_active !== false && b.is_active !== false };
                  const why = unavailableKey(bed);
                  const chosen = b.id === bedId;
                  return (
                    <button key={b.id} type="button" aria-pressed={chosen}
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
